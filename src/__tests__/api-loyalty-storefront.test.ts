/**
 * D8 Loyalty slice-2-full — Storefront earn endpoint tests.
 *
 * POST /api/v1/loyalty-storefront/earn
 *
 * Coverage:
 *  1. Auth error → 401
 *  2. Missing contactId → 400
 *  3. Invalid trigger → 400
 *  4. Negative orderAmount → 400
 *  5. Contact not found in org → 404
 *  6. No matching earn rule → 200 earned: 0, reason: no_matching_rule
 *  7. Rule matches but award rounds to 0 → 200 earned: 0, reason: rounded_to_zero
 *  8. Happy path: purchase earn → 200 with earned points + transactionId
 *  9. Happy path: tier promotion detected → tierChanged: true
 * 10. CAS miss on first attempt, success on second → 200
 * 11. All retries exhausted → 409
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock("@/lib/prisma", () => ({
  prisma: {
    contact:         { findFirst: vi.fn() },
    loyaltyEarnRule: { findMany: vi.fn() },
    loyaltyTier:     { findMany: vi.fn() },
    organization:    { findFirst: vi.fn() },
    loyaltyAccount:  { findFirst: vi.fn(), create: vi.fn() },
    $transaction:    vi.fn(),
  },
}))

vi.mock("@/lib/api-auth", () => ({
  requireAuth: vi.fn(),
  isAuthError: vi.fn().mockImplementation((r: any) => r instanceof NextResponse),
}))


import { POST } from "@/app/api/v1/loyalty-storefront/earn/route"
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/lib/api-auth"

const AUTH = { orgId: "org-1", userId: "user-1", role: "admin" }

function makeReq(body: object) {
  return new Request("http://localhost/api/v1/loyalty-storefront/earn", {
    method: "POST",
    body: JSON.stringify(body),
  }) as any
}

const CONTACT = { id: "contact-1" }
const EARN_RULE = {
  id: "rule-1",
  name: "Purchase 1pt per $",
  trigger: "purchase",
  pointsRate: 1.0,
  pointsFlat: null,
  minOrderAmount: null,
  productCategory: null,
  priority: 0,
  applyTierMultiplier: true,
  isActive: true,
  validFrom: null,
  validUntil: null,
  createdAt: new Date("2026-01-01"),
}
const ACTIVE_TIER = { code: "bronze", minLifetimePoints: 0, multiplier: 1.0 }
const ACCOUNT = {
  id: "acct-1",
  organizationId: "org-1",
  contactId: "contact-1",
  points: 50,
  lifetimePoints: 50,
  tier: "bronze",
}
const ORG_NO_EXPIRY = { settings: {} }

function setupHappyPath() {
  vi.mocked(prisma.contact.findFirst).mockResolvedValue(CONTACT as any)
  vi.mocked(prisma.loyaltyEarnRule.findMany).mockResolvedValue([EARN_RULE] as any)
  vi.mocked(prisma.loyaltyTier.findMany).mockResolvedValue([ACTIVE_TIER] as any)
  vi.mocked(prisma.organization.findFirst).mockResolvedValue(ORG_NO_EXPIRY as any)
  vi.mocked(prisma.loyaltyAccount.findFirst).mockResolvedValue(ACCOUNT as any)
  vi.mocked(prisma.$transaction as any).mockImplementation(async (fn: any) => {
    const fakeTx = {
      loyaltyAccount: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      loyaltyTransaction: {
        create: vi.fn().mockResolvedValue({ id: "txn-1", createdAt: new Date() }),
      },
    }
    return fn(fakeTx)
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireAuth).mockResolvedValue(AUTH as any)
})

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("POST /api/v1/loyalty-storefront/earn", () => {
  it("returns 401 on auth error", async () => {
    vi.mocked(requireAuth).mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }) as any,
    )
    const res = await POST(makeReq({ contactId: "c", trigger: "purchase" }))
    expect(res.status).toBe(401)
  })

  it("returns 400 when contactId missing", async () => {
    const res = await POST(makeReq({ trigger: "purchase" }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/contactId/i)
  })

  it("returns 400 when contactId is empty string", async () => {
    const res = await POST(makeReq({ contactId: "  ", trigger: "purchase" }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/contactId/i)
  })

  it("returns 400 for invalid trigger", async () => {
    const res = await POST(makeReq({ contactId: "c-1", trigger: "invalid_event" }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/trigger/i)
  })

  it("returns 400 for negative orderAmount", async () => {
    const res = await POST(makeReq({ contactId: "c-1", trigger: "purchase", orderAmount: -10 }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/orderAmount/i)
  })

  it("returns 404 when contact not found in org", async () => {
    vi.mocked(prisma.contact.findFirst).mockResolvedValue(null)
    const res = await POST(makeReq({ contactId: "c-999", trigger: "purchase", orderAmount: 50 }))
    expect(res.status).toBe(404)
    expect((await res.json()).error).toMatch(/contact not found/i)
  })

  it("returns 200 with earned: 0 when no matching rule", async () => {
    vi.mocked(prisma.contact.findFirst).mockResolvedValue(CONTACT as any)
    vi.mocked(prisma.loyaltyEarnRule.findMany).mockResolvedValue([]) // no rules
    vi.mocked(prisma.loyaltyTier.findMany).mockResolvedValue([ACTIVE_TIER] as any)
    vi.mocked(prisma.organization.findFirst).mockResolvedValue(ORG_NO_EXPIRY as any)
    vi.mocked(prisma.loyaltyAccount.findFirst).mockResolvedValue(ACCOUNT as any)

    const res = await POST(makeReq({ contactId: "contact-1", trigger: "purchase", orderAmount: 50 }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.earned).toBe(0)
    expect(body.reason).toBe("no_matching_rule")
  })

  it("returns 200 with earned: 0 when flat rule × sub-1.0 multiplier rounds to zero (rounded_to_zero)", async () => {
    // pickEarnRule pre-filters rate rules when Math.floor(rate * amount) <= 0,
    // so rounded_to_zero requires a flat rule (passes the filter) combined with a
    // sub-1.0 tier multiplier: pointsFlat=1, multiplier=0.4 → Math.floor(0.4)=0.
    const flatRule = { ...EARN_RULE, pointsRate: null, pointsFlat: 1, applyTierMultiplier: true }
    const lowMultiplierTier = { code: "bronze", minLifetimePoints: 0, multiplier: 0.4 }
    vi.mocked(prisma.contact.findFirst).mockResolvedValue(CONTACT as any)
    vi.mocked(prisma.loyaltyEarnRule.findMany).mockResolvedValue([flatRule] as any)
    vi.mocked(prisma.loyaltyTier.findMany).mockResolvedValue([lowMultiplierTier] as any)
    vi.mocked(prisma.organization.findFirst).mockResolvedValue(ORG_NO_EXPIRY as any)
    vi.mocked(prisma.loyaltyAccount.findFirst).mockResolvedValue(ACCOUNT as any)

    const res = await POST(makeReq({ contactId: "contact-1", trigger: "purchase", orderAmount: 0 }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.earned).toBe(0)
    expect(body.reason).toBe("rounded_to_zero")
  })

  it("happy path: earns points and returns transactionId", async () => {
    setupHappyPath()
    const res = await POST(
      makeReq({ contactId: "contact-1", trigger: "purchase", orderAmount: 100 }),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.earned).toBe(100)       // 100 × 1pt/$ = 100, × 1.0 multiplier = 100
    expect(body.transactionId).toBe("txn-1")
    expect(body.tierChanged).toBe(false) // still bronze
  })

  it("creates account on first-touch and earns points", async () => {
    vi.mocked(prisma.contact.findFirst).mockResolvedValue(CONTACT as any)
    vi.mocked(prisma.loyaltyEarnRule.findMany).mockResolvedValue([EARN_RULE] as any)
    vi.mocked(prisma.loyaltyTier.findMany).mockResolvedValue([ACTIVE_TIER] as any)
    vi.mocked(prisma.organization.findFirst).mockResolvedValue(ORG_NO_EXPIRY as any)
    // findFirst returns null (no account yet); create returns the new wallet.
    // Only one findFirst call happens in this request (account = created, no retry).
    // Using a single mockResolvedValueOnce so no stale queue leaks to later tests.
    vi.mocked(prisma.loyaltyAccount.findFirst).mockResolvedValueOnce(null)
    vi.mocked(prisma.loyaltyAccount.create).mockResolvedValue({
      ...ACCOUNT,
      points: 0,
      lifetimePoints: 0,
      tier: null,
    } as any)
    vi.mocked(prisma.$transaction as any).mockImplementation(async (fn: any) => {
      const fakeTx = {
        loyaltyAccount: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
        loyaltyTransaction: {
          create: vi.fn().mockResolvedValue({ id: "txn-2", createdAt: new Date() }),
        },
      }
      return fn(fakeTx)
    })

    const res = await POST(
      makeReq({ contactId: "contact-1", trigger: "purchase", orderAmount: 50 }),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.earned).toBe(50)
    expect(vi.mocked(prisma.loyaltyAccount.create)).toHaveBeenCalledOnce()
  })

  it("detects tier promotion when lifetime points cross threshold", async () => {
    // Account at 950 lifetime, earning 100 points will cross 1000 (silver threshold).
    const nearThreshold = { ...ACCOUNT, points: 950, lifetimePoints: 950, tier: "bronze" }
    const silverTier = { code: "silver", minLifetimePoints: 1000, multiplier: 1.1 }
    const tiers = [ACTIVE_TIER, silverTier]

    vi.mocked(prisma.contact.findFirst).mockResolvedValue(CONTACT as any)
    vi.mocked(prisma.loyaltyEarnRule.findMany).mockResolvedValue([EARN_RULE] as any)
    vi.mocked(prisma.loyaltyTier.findMany).mockResolvedValue(tiers as any)
    vi.mocked(prisma.organization.findFirst).mockResolvedValue(ORG_NO_EXPIRY as any)
    vi.mocked(prisma.loyaltyAccount.findFirst).mockResolvedValue(nearThreshold as any)
    vi.mocked(prisma.$transaction as any).mockImplementation(async (fn: any) => {
      const fakeTx = {
        loyaltyAccount: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
        loyaltyTransaction: {
          create: vi.fn().mockResolvedValue({ id: "txn-3", createdAt: new Date() }),
        },
      }
      return fn(fakeTx)
    })

    const res = await POST(
      makeReq({ contactId: "contact-1", trigger: "purchase", orderAmount: 100 }),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.tierChanged).toBe(true)
    expect(body.tier).toBe("silver")
    expect(body.previousTier).toBe("bronze")
  })

  it("retries on CAS miss and succeeds on second attempt", async () => {
    vi.mocked(prisma.contact.findFirst).mockResolvedValue(CONTACT as any)
    vi.mocked(prisma.loyaltyEarnRule.findMany).mockResolvedValue([EARN_RULE] as any)
    vi.mocked(prisma.loyaltyTier.findMany).mockResolvedValue([ACTIVE_TIER] as any)
    vi.mocked(prisma.organization.findFirst).mockResolvedValue(ORG_NO_EXPIRY as any)
    vi.mocked(prisma.loyaltyAccount.findFirst).mockResolvedValue(ACCOUNT as any)

    // First $transaction returns null (CAS miss). Second returns success.
    let callCount = 0
    vi.mocked(prisma.$transaction as any).mockImplementation(async (fn: any) => {
      callCount++
      const fakeTx = {
        loyaltyAccount: {
          updateMany: vi.fn().mockResolvedValue({ count: callCount === 1 ? 0 : 1 }),
        },
        loyaltyTransaction: {
          create: vi.fn().mockResolvedValue({ id: "txn-cas", createdAt: new Date() }),
        },
      }
      return fn(fakeTx)
    })

    const res = await POST(
      makeReq({ contactId: "contact-1", trigger: "purchase", orderAmount: 100 }),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.transactionId).toBe("txn-cas")
    expect(callCount).toBe(2)
  })

  it("returns 409 when all retries exhausted (persistent CAS miss)", async () => {
    vi.mocked(prisma.contact.findFirst).mockResolvedValue(CONTACT as any)
    vi.mocked(prisma.loyaltyEarnRule.findMany).mockResolvedValue([EARN_RULE] as any)
    vi.mocked(prisma.loyaltyTier.findMany).mockResolvedValue([ACTIVE_TIER] as any)
    vi.mocked(prisma.organization.findFirst).mockResolvedValue(ORG_NO_EXPIRY as any)
    vi.mocked(prisma.loyaltyAccount.findFirst).mockResolvedValue(ACCOUNT as any)
    // Always CAS-miss
    vi.mocked(prisma.$transaction as any).mockImplementation(async (fn: any) => {
      const fakeTx = {
        loyaltyAccount: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
        loyaltyTransaction: { create: vi.fn() },
      }
      return fn(fakeTx)
    })

    const res = await POST(
      makeReq({ contactId: "contact-1", trigger: "purchase", orderAmount: 100 }),
    )
    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch(/concurrent/i)
  })

  // ─── P2002 concurrent-create retry ─────────────────────────────────────────

  it("retries after P2002 on first-touch account create (concurrent race)", async () => {
    // Scenario: two concurrent storefront earns for the same (org, contact) pair.
    // First findFirst → null (no account). create → P2002 (other request won the race).
    // Second findFirst (via continue) → returns the winner's account.
    // CAS succeeds on second attempt.
    vi.mocked(prisma.contact.findFirst).mockResolvedValue(CONTACT as any)
    vi.mocked(prisma.loyaltyEarnRule.findMany).mockResolvedValue([EARN_RULE] as any)
    vi.mocked(prisma.loyaltyTier.findMany).mockResolvedValue([ACTIVE_TIER] as any)
    vi.mocked(prisma.organization.findFirst).mockResolvedValue(ORG_NO_EXPIRY as any)

    // Attempt 1: findFirst → null, create → P2002
    // Attempt 2: findFirst → existing account, CAS → success
    vi.mocked(prisma.loyaltyAccount.findFirst)
      .mockResolvedValueOnce(null)                       // attempt 1: no account yet
      .mockResolvedValue(ACCOUNT as any)                 // attempt 2+: concurrent-winner's account

    const p2002 = new Prisma.PrismaClientKnownRequestError(
      "Unique constraint failed on the constraint: `loyalty_accounts_org_contact_uniq`",
      { code: "P2002", clientVersion: "5.0.0" },
    )
    vi.mocked(prisma.loyaltyAccount.create).mockRejectedValue(p2002)

    vi.mocked(prisma.$transaction as any).mockImplementation(async (fn: any) => {
      const fakeTx = {
        loyaltyAccount: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
        loyaltyTransaction: {
          create: vi.fn().mockResolvedValue({ id: "txn-p2002", createdAt: new Date() }),
        },
      }
      return fn(fakeTx)
    })

    const res = await POST(
      makeReq({ contactId: "contact-1", trigger: "purchase", orderAmount: 100 }),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.earned).toBe(100)
    expect(body.transactionId).toBe("txn-p2002")
    // create was attempted once (P2002), then the retry used findFirst
    expect(vi.mocked(prisma.loyaltyAccount.create)).toHaveBeenCalledOnce()
  })

  it("returns 500 when first-touch account create fails with non-P2002 error", async () => {
    vi.mocked(prisma.contact.findFirst).mockResolvedValue(CONTACT as any)
    vi.mocked(prisma.loyaltyEarnRule.findMany).mockResolvedValue([EARN_RULE] as any)
    vi.mocked(prisma.loyaltyTier.findMany).mockResolvedValue([ACTIVE_TIER] as any)
    vi.mocked(prisma.organization.findFirst).mockResolvedValue(ORG_NO_EXPIRY as any)
    vi.mocked(prisma.loyaltyAccount.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.loyaltyAccount.create).mockRejectedValue(new Error("Connection reset"))

    const res = await POST(
      makeReq({ contactId: "contact-1", trigger: "purchase", orderAmount: 100 }),
    )
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/failed to create loyalty account/i)
  })

  // ─── expiresAt stamping (Phase E) ──────────────────────────────────────────

  it("stamps expiresAt on earn transaction when loyaltyPointsExpiryDays is set", async () => {
    setupHappyPath()
    // Override org settings to include a 30-day expiry window.
    vi.mocked(prisma.organization.findFirst).mockResolvedValue({
      settings: { loyaltyPointsExpiryDays: 30 },
    } as any)

    let capturedCreate: any
    vi.mocked(prisma.$transaction as any).mockImplementation(async (fn: any) => {
      const fakeTx = {
        loyaltyAccount: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
        loyaltyTransaction: {
          create: vi.fn().mockImplementation(async (args: any) => {
            capturedCreate = args
            return { id: "txn-expiry", createdAt: new Date() }
          }),
        },
      }
      return fn(fakeTx)
    })

    const before = new Date()
    const res = await POST(
      makeReq({ contactId: "contact-1", trigger: "purchase", orderAmount: 100 }),
    )
    const after = new Date()

    expect(res.status).toBe(200)
    expect(capturedCreate).toBeDefined()
    expect(capturedCreate.data.expiresAt).toBeInstanceOf(Date)
    // expiresAt should be approximately 30 days from now
    const expected = new Date(before.getTime() + 30 * 24 * 60 * 60 * 1000)
    const diff = Math.abs(capturedCreate.data.expiresAt.getTime() - expected.getTime())
    expect(diff).toBeLessThan(5000) // within 5s of expected
  })

  it("does not stamp expiresAt when loyaltyPointsExpiryDays is not configured", async () => {
    setupHappyPath()

    let capturedCreate: any
    vi.mocked(prisma.$transaction as any).mockImplementation(async (fn: any) => {
      const fakeTx = {
        loyaltyAccount: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
        loyaltyTransaction: {
          create: vi.fn().mockImplementation(async (args: any) => {
            capturedCreate = args
            return { id: "txn-no-expiry", createdAt: new Date() }
          }),
        },
      }
      return fn(fakeTx)
    })

    await POST(makeReq({ contactId: "contact-1", trigger: "purchase", orderAmount: 100 }))
    expect(capturedCreate.data.expiresAt).toBeUndefined()
  })

  // ─── Cross-tenant organizationId scoping ───────────────────────────────────

  it("scopes contact lookup to organizationId (cross-tenant guard)", async () => {
    vi.mocked(prisma.contact.findFirst).mockResolvedValue(null)

    await POST(makeReq({ contactId: "contact-1", trigger: "purchase", orderAmount: 50 }))

    const contactCall = vi.mocked(prisma.contact.findFirst).mock.calls[0][0]
    expect((contactCall as any).where.organizationId).toBe("org-1")
    expect((contactCall as any).where.id).toBe("contact-1")
  })
})
