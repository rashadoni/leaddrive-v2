/**
 * D8 Loyalty — birthday cron helper (runLoyaltyBirthday).
 *
 * The org-scoped birthday match is a raw query (mocked here); the per-contact
 * credit delegates to the shared applyAutoEarn (mocked). We assert the
 * aggregation, the result-status mapping, error isolation, and that each call
 * carries the right trigger / flat order / year-scoped idempotency key / master
 * switch gate / UTC month+day.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/loyalty/auto-earn", () => ({ applyAutoEarn: vi.fn() }))

import { runLoyaltyBirthday } from "@/lib/loyalty/birthday-cron"
import { applyAutoEarn } from "@/lib/loyalty/auto-earn"

// Minimal prisma stub: only $queryRaw is used by the lib.
function mkPrisma(rows: { id: string }[]) {
  return { $queryRaw: vi.fn().mockResolvedValue(rows) } as never
}

const earned = (n: number) =>
  ({
    status: "earned",
    earned: n,
    accountId: "a",
    base: n,
    appliedMultiplier: 1,
    source: "flat",
    rule: { id: "r", name: "BD" },
    tier: null,
    previousTier: null,
    tierChanged: false,
    transactionId: "t",
  }) as never
const noop = (reason: string) => ({ status: "no_op", accountId: null, earned: 0, reason }) as never
const errRes = { status: "error", error: "x" } as never

beforeEach(() => vi.clearAllMocks())

describe("runLoyaltyBirthday", () => {
  it("no matched contacts → all zeros, applyAutoEarn never called", async () => {
    const r = await runLoyaltyBirthday(mkPrisma([]), "org-1", new Date("2026-05-15T06:00:00Z"))
    expect(r.contactsMatched).toBe(0)
    expect(r).toMatchObject({ awarded: 0, alreadyAwarded: 0, skipped: 0, errors: 0, totalPoints: 0 })
    expect(applyAutoEarn).not.toHaveBeenCalled()
  })

  it("awards matched contacts and aggregates points", async () => {
    vi.mocked(applyAutoEarn).mockResolvedValueOnce(earned(100)).mockResolvedValueOnce(earned(50))
    const r = await runLoyaltyBirthday(
      mkPrisma([{ id: "c-1" }, { id: "c-2" }]),
      "org-1",
      new Date("2026-05-15T06:00:00Z"),
    )
    expect(r).toMatchObject({ contactsMatched: 2, awarded: 2, totalPoints: 150, alreadyAwarded: 0, skipped: 0, errors: 0 })
  })

  it("maps already_awarded / skipped (no rule, disabled) / error distinctly", async () => {
    vi.mocked(applyAutoEarn)
      .mockResolvedValueOnce(noop("already_awarded"))
      .mockResolvedValueOnce(noop("no_matching_rule"))
      .mockResolvedValueOnce(noop("auto_earn_disabled"))
      .mockResolvedValueOnce(errRes)
    const r = await runLoyaltyBirthday(
      mkPrisma([{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }]),
      "org-1",
      new Date(),
    )
    expect(r).toMatchObject({ contactsMatched: 4, awarded: 0, alreadyAwarded: 1, skipped: 2, errors: 1 })
  })

  it("isolates a throw from applyAutoEarn (counts as error, keeps going)", async () => {
    vi.mocked(applyAutoEarn).mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce(earned(10))
    const r = await runLoyaltyBirthday(mkPrisma([{ id: "c-1" }, { id: "c-2" }]), "org-1", new Date())
    expect(r).toMatchObject({ contactsMatched: 2, awarded: 1, errors: 1, totalPoints: 10 })
  })

  it("calls applyAutoEarn with birthday trigger, flat order, year-scoped referenceId, master-switch gate", async () => {
    vi.mocked(applyAutoEarn).mockResolvedValueOnce(earned(100))
    await runLoyaltyBirthday(mkPrisma([{ id: "c-9" }]), "org-7", new Date("2026-05-15T06:00:00Z"))
    expect(applyAutoEarn).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        orgId: "org-7",
        contactId: "c-9",
        trigger: "birthday",
        orderAmount: 0,
        referenceId: "birthday:c-9:2026",
        requireAutoEarnEnabled: true,
      }),
    )
  })

  it("matches on the UTC month+day of `now` (parameterized, org-scoped)", async () => {
    const prisma = mkPrisma([])
    // 23:00 UTC on Dec 9 — getUTCDate stays 9 (no local-tz drift).
    await runLoyaltyBirthday(prisma, "org-1", new Date("2026-12-09T23:00:00Z"))
    // tagged template → mock.calls[0] = [stringsArray, orgId, month, day]
    const callArgs = (prisma as unknown as { $queryRaw: { mock: { calls: unknown[][] } } }).$queryRaw.mock.calls[0]
    expect(callArgs).toContain("org-1")
    expect(callArgs).toContain(12) // December
    expect(callArgs).toContain(9) // 9th
  })
})
