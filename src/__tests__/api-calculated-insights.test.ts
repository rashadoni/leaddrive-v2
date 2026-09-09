/**
 * GET /api/v1/calculated-insights — read-route handler test.
 *
 * Calculator math is covered in lib-calculated-insights.test.ts. This locks the
 * route's behavior:
 *  - P2 invoice attribution: a profile that absorbed multiple contacts pulls
 *    invoices from ALL its contact sources (shared invoice-link helper).
 *  - W1.1 currency consistency: LTV sums only the profile's primaryCurrency
 *    (matching materialized totalSpent), while churn/engagement count ALL orders.
 *  - W1.4 true-count: totalProfiles is the real org count, not the page size.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    unifiedProfile: { findMany: vi.fn(), count: vi.fn() },
    invoice: { findMany: vi.fn() },
    customerInsightsSnapshot: { findMany: vi.fn() },
  },
}))
vi.mock("@/lib/api-auth", () => ({ getOrgId: vi.fn(), getSession: vi.fn().mockResolvedValue(null) }))

import { GET } from "@/app/api/v1/calculated-insights/route"
import { prisma } from "@/lib/prisma"
import { getOrgId } from "@/lib/api-auth"

const mockFindMany = () => prisma.unifiedProfile.findMany as ReturnType<typeof vi.fn>
const mockCount = () => prisma.unifiedProfile.count as ReturnType<typeof vi.fn>
const mockInvoices = () => prisma.invoice.findMany as ReturnType<typeof vi.fn>
const mockSnapshots = () => prisma.customerInsightsSnapshot.findMany as ReturnType<typeof vi.fn>

function req(): NextRequest {
  return new NextRequest(new URL("http://localhost:3000/api/v1/calculated-insights"))
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(getOrgId as ReturnType<typeof vi.fn>).mockResolvedValue("org-1")
  mockSnapshots().mockResolvedValue([]) // default: no trend history (cold start)
})

describe("GET /api/v1/calculated-insights — multi-contact invoice attribution (P2 read side)", () => {
  it("pulls invoices from ALL of a profile's contact sources + reports the true totalProfiles", async () => {
    mockFindMany().mockResolvedValue([
      {
        id: "p1",
        emailNormalized: "dup@x.com",
        phoneNormalized: null,
        displayEmail: "dup@x.com",
        displayPhone: null,
        displayName: "Dup Buyer",
        primaryContactId: "c1",
        primaryCompanyId: null,
        totalSpent: 300,
        lifetimeOrderCount: 2,
        lastSeenAt: new Date("2026-05-01"),
        firstSeenAt: new Date("2026-01-01"),
        channelsActive: ["contact"],
        primaryCurrency: "AZN",
        lastRefreshedAt: new Date("2026-06-01"),
        sources: [
          { sourceType: "contact", sourceId: "c1" },
          { sourceType: "contact", sourceId: "c2" }, // merged — NOT primaryContactId
        ],
      },
    ])
    mockCount().mockResolvedValue(568) // true org total (page shows 1)

    mockInvoices().mockImplementation(async ({ where }: { where: { OR?: Array<{ contactId?: { in: string[] } }> } }) => {
      const all = [
        { contactId: "c1", companyId: null, paidAt: new Date("2026-02-01"), totalAmount: 100, currency: "AZN" },
        { contactId: "c2", companyId: null, paidAt: new Date("2026-03-01"), totalAmount: 200, currency: "AZN" },
      ]
      const queried = (where.OR ?? []).flatMap((o) => o.contactId?.in ?? [])
      return all.filter((i) => queried.includes(i.contactId))
    })

    const res = await GET(req())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.totalItems).toBe(1) // page size
    expect(body.totalProfiles).toBe(568) // W1.4 — true count, not the page size

    const queriedContacts = (mockInvoices().mock.calls[0][0].where.OR ?? []).flatMap(
      (o: { contactId?: { in: string[] } }) => o.contactId?.in ?? [],
    )
    expect(queriedContacts).toContain("c1")
    expect(queriedContacts).toContain("c2") // merged source — the P2 path

    const p = body.items[0]
    expect(p.insights.ltv.confidence).toBeCloseTo(0.67, 2) // 2 AZN invoices reached LTV
    expect(p.insights.ltv.value).toBeGreaterThanOrEqual(300)
  })

  it("W1.1: LTV counts only primaryCurrency, but churn/engagement count ALL orders", async () => {
    mockFindMany().mockResolvedValue([
      {
        id: "p1",
        emailNormalized: "intl@x.com",
        phoneNormalized: null,
        displayEmail: "intl@x.com",
        displayPhone: null,
        displayName: "Intl Buyer",
        primaryContactId: "c1",
        primaryCompanyId: null,
        totalSpent: 1000,
        lifetimeOrderCount: 2,
        lastSeenAt: new Date("2026-05-01"),
        firstSeenAt: new Date("2026-01-01"),
        channelsActive: ["contact"],
        primaryCurrency: "AZN",
        lastRefreshedAt: new Date("2026-06-01"),
        sources: [{ sourceType: "contact", sourceId: "c1" }],
      },
    ])
    mockCount().mockResolvedValue(1)
    // One AZN order + one USD order, both paid, same contact.
    mockInvoices().mockResolvedValue([
      { contactId: "c1", companyId: null, paidAt: new Date("2026-02-01"), totalAmount: 1000, currency: "AZN" },
      { contactId: "c1", companyId: null, paidAt: new Date("2026-03-01"), totalAmount: 500, currency: "USD" },
    ])

    const res = await GET(req())
    const p = (await res.json()).items[0]

    // LTV saw ONLY the 1 AZN invoice (currency-filtered) → confidence 1/3 ≈ 0.33.
    // If it had mixed in the USD one (the old bug) it'd be 2 datapoints → 0.67.
    expect(p.insights.ltv.confidence).toBeCloseTo(0.33, 2)
    // Churn saw BOTH orders (currency-agnostic; needs ≥2 for a cadence) → confidence 1.
    // If churn had been wrongly currency-filtered to 1 order it'd be 0.
    expect(p.insights.churnRisk.confidence).toBe(1)
  })

  it("returns the empty shape (totalProfiles 0) when the tenant has no profiles", async () => {
    mockFindMany().mockResolvedValue([])
    mockCount().mockResolvedValue(0)
    const res = await GET(req())
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.totalItems).toBe(0)
    expect(body.totalProfiles).toBe(0)
    expect(body.items).toEqual([])
    expect(prisma.invoice.findMany).not.toHaveBeenCalled()
  })
})

describe("GET /api/v1/calculated-insights — KPI trends (slice-2)", () => {
  it("returns empty trends (points 0) when no snapshots exist yet — cold start", async () => {
    mockFindMany().mockResolvedValue([])
    mockCount().mockResolvedValue(0)
    mockSnapshots().mockResolvedValue([])

    const body = await (await GET(req())).json()
    expect(body.trends.points).toBe(0)
    expect(body.trends.totalProfiles.series).toEqual([])
    expect(body.trends.totalProfiles.delta).toBeNull()
    expect(body.trends.totalProfiles.deltaPct).toBeNull()
  })

  it("builds per-KPI chronological series + day-over-day delta from snapshots", async () => {
    mockFindMany().mockResolvedValue([])
    mockCount().mockResolvedValue(0)
    // The route reads snapshotDate DESC (newest first) then reverses to chrono.
    mockSnapshots().mockResolvedValue([
      { totalProfiles: 30, highRiskCount: 5, avgEngagement: 22, dominantLtv: 300 }, // newest
      { totalProfiles: 20, highRiskCount: 3, avgEngagement: 20, dominantLtv: 200 },
      { totalProfiles: 10, highRiskCount: 1, avgEngagement: 18, dominantLtv: 100 }, // oldest
    ])

    const body = await (await GET(req())).json()
    expect(body.trends.points).toBe(3)
    // oldest → newest
    expect(body.trends.totalProfiles.series).toEqual([10, 20, 30])
    // delta = latest − previous
    expect(body.trends.totalProfiles.delta).toBe(10)
    expect(body.trends.highRiskCount.delta).toBe(2)
    expect(body.trends.dominantLtv.delta).toBe(100)
    // deltaPct = (10 / |20|) * 100
    expect(body.trends.totalProfiles.deltaPct).toBeCloseTo(50, 5)
  })
})
