/**
 * GET /api/v1/campaign-roi on a tenant that holds deals in several currencies.
 *
 * The old route added every won deal's valueAmount into one number — 4 000 USD
 * plus 5 000 AZN came out as "9 000", printed with a "$" — and divided it by
 * the budget of every campaign, drafts and cancelled ones included. There are
 * no exchange rates in the product, so neither the sum nor an ROI built on it
 * means anything. These tests pin the behaviour on mixed data: money grouped
 * by currency, cost = budgets of campaigns that went out, ROI only where
 * revenue and cost share a currency, and a named reason everywhere else.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    campaign: { findMany: vi.fn() },
    attributionModel: { findFirst: vi.fn() },
    campaignInfluence: { findMany: vi.fn() },
    pipelineStage: { findMany: vi.fn() },
    deal: { groupBy: vi.fn() },
  },
}))
vi.mock("@/lib/api-auth", () => ({ getOrgId: vi.fn(), getSession: vi.fn().mockResolvedValue(null) }))

import { GET } from "@/app/api/v1/campaign-roi/route"
import { prisma } from "@/lib/prisma"
import { getOrgId } from "@/lib/api-auth"
import { roiVerdict } from "@/lib/campaigns/roi"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pr = prisma as any

const base = { totalRecipients: 100, totalOpened: 0, totalClicked: 0, sentAt: null, createdAt: new Date("2026-09-01") }

/*
 * One org, the way production looks: a localized won stage configured in the
 * pipeline ("Qazanıldı"), an imported CLOSED_WON next to it, and deals in AZN
 * and USD side by side.
 */
const CAMPAIGNS = [
  {
    ...base, id: "spring", name: "Spring", status: "sent", type: "email", budget: 1000, totalSent: 100,
    deals: [
      { id: "d1", name: "Export", stage: "Qazanıldı", valueAmount: 4000, currency: "USD" },
      { id: "d2", name: "Local", stage: "Qazanıldı", valueAmount: 3000, currency: "AZN" },
      { id: "d3", name: "Lost", stage: "Uduzdu", valueAmount: 9000, currency: "AZN" },
    ],
  },
  {
    ...base, id: "summer", name: "Summer", status: "sent", type: "sms", budget: 500, totalSent: 80,
    deals: [{ id: "d4", name: "Imported", stage: "CLOSED_WON", valueAmount: 2000, currency: "AZN" }],
  },
  { ...base, id: "draft", name: "Draft", status: "draft", type: "email", budget: 700, totalSent: 0, deals: [] },
  { ...base, id: "cancelled", name: "Cancelled", status: "cancelled", type: "email", budget: 300, totalSent: 0, deals: [] },
]

function req() {
  return new NextRequest("http://localhost/api/v1/campaign-roi")
}

async function load() {
  const res = await GET(req())
  expect(res.status).toBe(200)
  const json = await res.json()
  return {
    summary: json.data.summary,
    byId: Object.fromEntries(json.data.campaigns.map((c: { id: string }) => [c.id, c])),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getOrgId).mockResolvedValue("org-1")
  pr.campaign.findMany.mockResolvedValue(CAMPAIGNS)
  pr.attributionModel.findFirst.mockResolvedValue(null)
  pr.campaignInfluence.findMany.mockResolvedValue([])
  pr.pipelineStage.findMany.mockImplementation(({ where }: { where: { isWon?: boolean; isLost?: boolean } }) =>
    Promise.resolve(where.isWon ? [{ name: "Qazanıldı" }] : where.isLost ? [{ name: "Uduzdu" }] : []),
  )
  pr.deal.groupBy.mockResolvedValue([
    { stage: "Qazanıldı" }, { stage: "Uduzdu" }, { stage: "CLOSED_WON" },
  ])
})

describe("campaign ROI on mixed-currency data", () => {
  it("groups won revenue by currency instead of adding USD to AZN", async () => {
    const { summary, byId } = await load()

    expect(byId.spring.revenue).toEqual([
      { currency: "USD", value: 4000, count: 1 },
      { currency: "AZN", value: 3000, count: 1 },
    ])
    // AZN 3 000 + 2 000 leads; USD is named next to it, never folded into it.
    expect(summary.revenue).toEqual([
      { currency: "AZN", value: 5000, count: 2 },
      { currency: "USD", value: 4000, count: 1 },
    ])
    expect(summary).not.toHaveProperty("totalRevenue")
  })

  it("counts as cost only the budgets of campaigns that went out", async () => {
    const { summary, byId } = await load()

    // 1000 + 500 — the draft's 700 and the cancelled 300 were never spent.
    expect(summary.cost).toEqual({ currency: "AZN", value: 1500 })
    expect(summary.costBasis).toBe("budget-of-launched")
    expect(summary.launchedCount).toBe(2)
    expect(summary.campaignCount).toBe(4)
    expect(byId.draft.cost.value).toBe(0)
    expect(byId.cancelled.cost.value).toBe(0)
  })

  it("computes ROI only where revenue and cost share a currency", async () => {
    const { summary, byId } = await load()

    // Summer: 2 000 ₼ won against a 500 ₼ budget → +300%.
    expect(byId.summer.roi).toEqual({ kind: "value", percent: 300, currency: "AZN" })
    // Spring earned in two currencies: no ROI, and the reason names them.
    expect(byId.spring.roi).toEqual({ kind: "currency-mismatch", revenueCurrencies: ["USD", "AZN"], costCurrency: "AZN" })
    // Same for the total — the USD deal makes any single figure a fiction.
    expect(summary.roi.kind).toBe("currency-mismatch")
    // Nothing won and nothing sent: no ROI, not −100%.
    expect(byId.draft.roi).toEqual({ kind: "no-revenue" })
  })

  it("gives the total an ROI once every won deal is in the budget currency", async () => {
    pr.campaign.findMany.mockResolvedValue(CAMPAIGNS.filter((c) => c.id !== "spring"))
    const { summary } = await load()
    // 2 000 ₼ against 500 ₼ of spent budget (draft and cancelled excluded).
    expect(summary.roi).toEqual({ kind: "value", percent: 300, currency: "AZN" })
  })

  it("buckets attributed revenue by the currency of the deal it was split from", async () => {
    pr.attributionModel.findFirst.mockResolvedValue({ id: "m1", name: "Linear", modelType: "linear" })
    pr.campaignInfluence.findMany.mockResolvedValue([
      { campaignId: "summer", attributedRevenue: 1200, deal: { currency: "AZN" } },
      { campaignId: "summer", attributedRevenue: 800, deal: { currency: "USD" } },
      { campaignId: "spring", attributedRevenue: 1800, deal: { currency: "AZN" } },
    ])
    const { summary, byId } = await load()

    expect(byId.summer.attributedRevenue).toEqual([
      { currency: "AZN", value: 1200, count: 1 },
      { currency: "USD", value: 800, count: 1 },
    ])
    expect(byId.summer.attributedRoi.kind).toBe("currency-mismatch")
    expect(byId.spring.attributedRoi).toEqual({ kind: "value", percent: 80, currency: "AZN" })
    expect(summary.attributedRevenue).toEqual([
      { currency: "AZN", value: 3000, count: 2 },
      { currency: "USD", value: 800, count: 1 },
    ])
    expect(pr.campaignInfluence.findMany.mock.calls[0][0].where).toMatchObject({
      organizationId: "org-1", modelId: "m1", kind: "won",
    })
  })
})

describe("roiVerdict", () => {
  const azn = (value: number) => ({ currency: "AZN", value, count: 1 })

  it("says why there is no figure, in a fixed order", () => {
    expect(roiVerdict([], { currency: "AZN", value: 100 })).toEqual({ kind: "no-revenue" })
    expect(roiVerdict([azn(0)], { currency: "AZN", value: 100 })).toEqual({ kind: "no-revenue" })
    expect(roiVerdict([azn(500)], { currency: "AZN", value: 100 }, { launched: false })).toEqual({ kind: "not-launched" })
    expect(roiVerdict([azn(500)], { currency: "AZN", value: 0 })).toEqual({ kind: "no-cost" })
    expect(roiVerdict([{ currency: "USD", value: 500, count: 1 }], { currency: "AZN", value: 100 })).toEqual({
      kind: "currency-mismatch", revenueCurrencies: ["USD"], costCurrency: "AZN",
    })
  })

  it("ignores empty buckets when deciding the revenue currency", () => {
    expect(roiVerdict([azn(300), { currency: "USD", value: 0, count: 1 }], { currency: "AZN", value: 100 })).toEqual({
      kind: "value", percent: 200, currency: "AZN",
    })
  })
})
