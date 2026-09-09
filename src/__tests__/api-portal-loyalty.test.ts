/**
 * D8 Loyalty — member portal read API (Slice 3 step 1).
 *
 * GET /api/v1/public/portal-loyalty — portal-JWT member view: points / tier /
 * progress / benefits / history / eligible promos. Auth + scoping + the
 * loyalty_portal flag gate + per-customer promo filtering.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/rls-context", () => ({
  runWithTenant: (_orgId: string, fn: () => unknown) => fn(),
}))
vi.mock("@/lib/portal-auth", () => ({ getPortalUser: vi.fn() }))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    organization: { findFirst: vi.fn() },
    loyaltyAccount: { findFirst: vi.fn() },
    loyaltyTier: { findMany: vi.fn() },
    loyaltyTransaction: { findMany: vi.fn() },
    loyaltyReward: { findMany: vi.fn() },
    loyaltyRedemption: { count: vi.fn() },
    promoCode: { findMany: vi.fn() },
    promoCodeRedemption: { count: vi.fn() },
  },
}))

import { GET } from "@/app/api/v1/public/portal-loyalty/route"
import { getPortalUser } from "@/lib/portal-auth"
import { prisma } from "@/lib/prisma"

const USER = { contactId: "c-1", organizationId: "org-1", companyId: null, fullName: "Jane", email: "j@x.com" }
const TIERS = [
  { code: "bronze", name: "Bronze", minLifetimePoints: 0, multiplier: 1, benefits: ["welcome"] },
  { code: "gold", name: "Gold", minLifetimePoints: 1000, multiplier: 2, benefits: ["priority_support"] },
]

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getPortalUser).mockResolvedValue(USER as never)
  vi.mocked(prisma.organization.findFirst).mockResolvedValue({ features: ["loyalty_portal"] } as never)
  vi.mocked(prisma.loyaltyTier.findMany).mockResolvedValue(TIERS as never)
  vi.mocked(prisma.loyaltyTransaction.findMany).mockResolvedValue([] as never)
  vi.mocked(prisma.loyaltyReward.findMany).mockResolvedValue([] as never)
  vi.mocked(prisma.promoCode.findMany).mockResolvedValue([] as never)
})

describe("GET /api/v1/public/portal-loyalty", () => {
  it("401 when not a portal member", async () => {
    vi.mocked(getPortalUser).mockResolvedValue(null as never)
    const r = await GET()
    expect(r.status).toBe(401)
  })

  it("returns enabled:false (no data) when the loyalty_portal flag is off", async () => {
    vi.mocked(prisma.organization.findFirst).mockResolvedValue({ features: ["whatsapp"] } as never)
    const r = await GET()
    const j = await r.json()
    expect(j).toEqual({ success: true, enabled: false })
    expect(prisma.loyaltyAccount.findFirst).not.toHaveBeenCalled()
  })

  it("synthesizes a zero-state when the member has no account", async () => {
    vi.mocked(prisma.loyaltyAccount.findFirst).mockResolvedValue(null as never)
    const j = await (await GET()).json()
    expect(j.enabled).toBe(true)
    expect(j.data.account).toMatchObject({ points: 0, lifetimePoints: 0, tier: null })
    // 0 lifetime → bronze (min 0), next is gold (1000)
    expect(j.data.tier.current).toMatchObject({ code: "bronze" })
    expect(j.data.tier.next).toMatchObject({ code: "gold", minLifetimePoints: 1000 })
    expect(j.data.tier.pointsToNext).toBe(1000)
    expect(j.data.tier.progressPct).toBe(0)
    expect(j.data.history).toEqual([])
  })

  it("computes tier + progress for a mid-tier member", async () => {
    vi.mocked(prisma.loyaltyAccount.findFirst).mockResolvedValue({ id: "a-1", points: 300, lifetimePoints: 500, tier: "bronze", tierUpgradedAt: null } as never)
    vi.mocked(prisma.loyaltyTransaction.findMany).mockResolvedValue([{ type: "earn", delta: 120, lifetimeDelta: 120, reason: "Invoice paid", createdAt: new Date() }] as never)
    const j = await (await GET()).json()
    expect(j.data.account).toMatchObject({ points: 300, lifetimePoints: 500 })
    expect(j.data.tier.current).toMatchObject({ code: "bronze", multiplier: 1 })
    expect(j.data.tier.pointsToNext).toBe(500) // 1000 - 500
    expect(j.data.tier.progressPct).toBe(50) // (500-0)/(1000-0)
    expect(j.data.benefits).toEqual(["welcome"])
    expect(j.data.history).toHaveLength(1)
    // history must NOT leak internal fields
    expect(j.data.history[0]).not.toHaveProperty("createdBy")
    expect(j.data.history[0]).not.toHaveProperty("referenceId")
  })

  it("excludes a promo the member has already hit the per-customer limit on", async () => {
    vi.mocked(prisma.loyaltyAccount.findFirst).mockResolvedValue({ id: "a-1", points: 0, lifetimePoints: 0, tier: null, tierUpgradedAt: null } as never)
    vi.mocked(prisma.promoCode.findMany).mockResolvedValue([
      { id: "p-open", code: "OPEN", description: null, discountType: "percentage", discountValue: 10, currency: null, minOrderAmount: null, perCustomerLimit: null, validUntil: null },
      { id: "p-capped", code: "CAPPED", description: null, discountType: "percentage", discountValue: 20, currency: null, minOrderAmount: null, perCustomerLimit: 1, validUntil: null },
    ] as never)
    vi.mocked(prisma.promoCodeRedemption.count).mockResolvedValue(1 as never) // already used the capped one once
    const j = await (await GET()).json()
    const codes = j.data.promoCodes.map((p: { code: string }) => p.code)
    expect(codes).toContain("OPEN")
    expect(codes).not.toContain("CAPPED")
  })

  it("includes a digital card: member name, short number, and a QR data URL", async () => {
    vi.mocked(prisma.loyaltyAccount.findFirst).mockResolvedValue({ id: "a-1", points: 300, lifetimePoints: 500, tier: "bronze", tierUpgradedAt: null } as never)
    const j = await (await GET()).json()
    expect(j.data.card.memberName).toBe("Jane")
    expect(j.data.card.memberNumber).toBe("C-1") // last-8 of contactId "c-1", uppercased
    expect(typeof j.data.card.qrDataUrl).toBe("string")
    expect(j.data.card.qrDataUrl).toMatch(/^data:image\/png;base64,/)
  })
})
