/**
 * D8 Loyalty — applyAutoEarn shared pipeline.
 *
 * applyAutoEarn takes its prisma client as a PARAMETER (so it works in-request
 * and under cron RLS-bypass), which means we can hand it a plain mock — no
 * vi.mock plumbing. Covers the branches the inline storefront route never had:
 * master-switch gating, referenceId idempotency, contact/rule no-ops, and the
 * referenceId-column write (the bug fix).
 */
import { describe, it, expect, vi } from "vitest"
import { Prisma } from "@prisma/client"
import { applyAutoEarn, reverseAutoEarn } from "@/lib/loyalty/auto-earn"

const ACCOUNT = { id: "acc-1", organizationId: "org-1", contactId: "c-1", points: 0, lifetimePoints: 0, tier: null }
const RULE = {
  id: "r-1", name: "1pt", trigger: "purchase",
  pointsRate: null, pointsFlat: 100, minOrderAmount: null, productCategory: null,
  priority: 0, applyTierMultiplier: false, isActive: true,
  validFrom: null, validUntil: null, createdAt: new Date("2026-01-01"),
}

function makePrisma(over: Record<string, unknown> = {}) {
  const mock = {
    organization: { findFirst: vi.fn().mockResolvedValue({ settings: { loyaltyAutoEarn: true } }) },
    contact: { findFirst: vi.fn().mockResolvedValue({ id: "c-1" }) },
    loyaltyEarnRule: { findMany: vi.fn().mockResolvedValue([]) },
    loyaltyTier: { findMany: vi.fn().mockResolvedValue([]) },
    loyaltyAccount: { findFirst: vi.fn().mockResolvedValue({ ...ACCOUNT }), create: vi.fn() },
    loyaltyTransaction: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn() },
    $transaction: vi.fn(),
    ...over,
  }
  return mock as typeof mock & Parameters<typeof applyAutoEarn>[0]
}

const BASE = {
  orgId: "org-1", contactId: "c-1", trigger: "purchase" as const,
  orderAmount: 100, referenceId: "inv-1", now: new Date("2026-06-20"),
}

// a $transaction that runs the callback against a tx client; returns the txn id
function txOk(create = vi.fn().mockResolvedValue({ id: "txn-1" })) {
  return vi.fn().mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
    fn({ loyaltyAccount: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) }, loyaltyTransaction: { create } }),
  )
}

describe("applyAutoEarn", () => {
  it("no-ops with auto_earn_disabled when the hook requires the flag and it's off", async () => {
    const p = makePrisma({ organization: { findFirst: vi.fn().mockResolvedValue({ settings: {} }) } })
    const r = await applyAutoEarn(p, { ...BASE, requireAutoEarnEnabled: true })
    expect(r).toMatchObject({ status: "no_op", reason: "auto_earn_disabled" })
  })

  it("explicit call (no requireAutoEarnEnabled) still earns even when the flag is unset", async () => {
    const create = vi.fn().mockResolvedValue({ id: "txn-1" })
    const p = makePrisma({
      organization: { findFirst: vi.fn().mockResolvedValue({ settings: {} }) },
      loyaltyEarnRule: { findMany: vi.fn().mockResolvedValue([RULE]) },
      $transaction: txOk(create),
    })
    const r = await applyAutoEarn(p, BASE)
    expect(r).toMatchObject({ status: "earned", earned: 100, transactionId: "txn-1" })
  })

  it("is idempotent: an existing earn row for the referenceId returns already_awarded", async () => {
    const p = makePrisma({
      loyaltyTransaction: { findFirst: vi.fn().mockResolvedValue({ id: "old", loyaltyAccountId: "acc-1" }), create: vi.fn() },
    })
    const r = await applyAutoEarn(p, BASE)
    expect(r).toMatchObject({ status: "no_op", reason: "already_awarded", transactionId: "old" })
  })

  it("no-ops with contact_not_found when the contact isn't in the org", async () => {
    const p = makePrisma({ contact: { findFirst: vi.fn().mockResolvedValue(null) } })
    const r = await applyAutoEarn(p, BASE)
    expect(r).toMatchObject({ status: "no_op", reason: "contact_not_found" })
  })

  it("no-ops with no_matching_rule and creates NO account when no rule fires", async () => {
    // Guards the signup-hook side effect: firing on every contact-create when
    // the tenant has no (or a non-matching) signup rule must NOT auto-enrol them
    // with a 0-pt account — the award is evaluated before the account is created.
    const p = makePrisma()
    const r = await applyAutoEarn(p, BASE)
    expect(r).toMatchObject({ status: "no_op", reason: "no_matching_rule" })
    expect(p.loyaltyAccount.create).not.toHaveBeenCalled()
  })

  it("earns and WRITES the referenceId column (the bug fix)", async () => {
    const create = vi.fn().mockResolvedValue({ id: "txn-1" })
    const p = makePrisma({
      loyaltyEarnRule: { findMany: vi.fn().mockResolvedValue([RULE]) },
      $transaction: txOk(create),
    })
    const r = await applyAutoEarn(p, { ...BASE, reason: "Invoice X paid" })
    expect(r).toMatchObject({ status: "earned", earned: 100, transactionId: "txn-1" })
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ referenceId: "inv-1", type: "earn", delta: 100, lifetimeDelta: 100, reason: "Invoice X paid" }),
      }),
    )
  })
})

describe("reverseAutoEarn", () => {
  const REV = { orgId: "org-1", referenceId: "inv-1" }

  it("no-op nothing_earned when no earn txn exists for the reference", async () => {
    const p = makePrisma({ loyaltyTransaction: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn() } })
    expect(await reverseAutoEarn(p, REV)).toMatchObject({ status: "no_op", reason: "nothing_earned" })
  })

  it("no-op already_reversed when a reverse marker already exists", async () => {
    const findFirst = vi.fn()
      .mockResolvedValueOnce({ id: "earn-1", loyaltyAccountId: "acc-1", delta: 100 }) // earn lookup
      .mockResolvedValueOnce({ id: "rev-old" }) // existing reverse:inv-1
    const p = makePrisma({ loyaltyTransaction: { findFirst, create: vi.fn() } })
    expect(await reverseAutoEarn(p, REV)).toMatchObject({ status: "no_op", reason: "already_reversed" })
  })

  it("reverses: debits the earned points as an adjustment_debit with lifetimeDelta 0", async () => {
    const findFirst = vi.fn()
      .mockResolvedValueOnce({ id: "earn-1", loyaltyAccountId: "acc-1", delta: 100 })
      .mockResolvedValueOnce(null)
    const create = vi.fn().mockResolvedValue({ id: "rev-1" })
    const p = makePrisma({
      loyaltyTransaction: { findFirst, create: vi.fn() },
      loyaltyAccount: { findFirst: vi.fn().mockResolvedValue({ id: "acc-1", points: 150 }), create: vi.fn() },
      $transaction: txOk(create),
    })
    const r = await reverseAutoEarn(p, REV)
    expect(r).toMatchObject({ status: "reversed", removed: 100, transactionId: "rev-1" })
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: "adjustment_debit", delta: -100, lifetimeDelta: 0, referenceId: "reverse:inv-1" }),
      }),
    )
  })

  it("floors at the current balance — claws back only what's left if some were already spent", async () => {
    const findFirst = vi.fn()
      .mockResolvedValueOnce({ id: "earn-1", loyaltyAccountId: "acc-1", delta: 100 })
      .mockResolvedValueOnce(null)
    const create = vi.fn().mockResolvedValue({ id: "rev-1" })
    const p = makePrisma({
      loyaltyTransaction: { findFirst, create: vi.fn() },
      loyaltyAccount: { findFirst: vi.fn().mockResolvedValue({ id: "acc-1", points: 30 }), create: vi.fn() },
      $transaction: txOk(create),
    })
    expect(await reverseAutoEarn(p, REV)).toMatchObject({ status: "reversed", removed: 30 })
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ delta: -30 }) }))
  })

  it("no-op nothing_redeemable when the balance is already 0 (all spent)", async () => {
    const findFirst = vi.fn()
      .mockResolvedValueOnce({ id: "earn-1", loyaltyAccountId: "acc-1", delta: 100 })
      .mockResolvedValueOnce(null)
    const p = makePrisma({
      loyaltyTransaction: { findFirst, create: vi.fn() },
      loyaltyAccount: { findFirst: vi.fn().mockResolvedValue({ id: "acc-1", points: 0 }), create: vi.fn() },
    })
    expect(await reverseAutoEarn(p, REV)).toMatchObject({ status: "no_op", reason: "nothing_redeemable" })
  })

  it("treats a P2002 on the reverse marker as already_reversed (concurrent double-delete)", async () => {
    const findFirst = vi.fn()
      .mockResolvedValueOnce({ id: "earn-1", loyaltyAccountId: "acc-1", delta: 100 })
      .mockResolvedValueOnce(null)
    const p2002 = new Prisma.PrismaClientKnownRequestError("unique", { code: "P2002", clientVersion: "x" })
    const p = makePrisma({
      loyaltyTransaction: { findFirst, create: vi.fn() },
      loyaltyAccount: { findFirst: vi.fn().mockResolvedValue({ id: "acc-1", points: 150 }), create: vi.fn() },
      $transaction: vi.fn().mockRejectedValue(p2002),
    })
    expect(await reverseAutoEarn(p, REV)).toMatchObject({ status: "no_op", reason: "already_reversed" })
  })
})
