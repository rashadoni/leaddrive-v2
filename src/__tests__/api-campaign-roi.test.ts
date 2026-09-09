/**
 * C9 #10 — Campaign ROI multi-touch attribution overlay.
 *
 * The route keeps the legacy direct-attribution revenue (won deals whose
 * Deal.campaignId points at the campaign) AND adds `attributedRevenue` per
 * campaign from the org's default/active attribution model's influences.
 * Verifies: overlay present + correct when a model exists; graceful nulls when
 * none; direct fields untouched either way.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    campaign: { findMany: vi.fn() },
    attributionModel: { findFirst: vi.fn() },
    campaignInfluence: { groupBy: vi.fn() },
    pipelineStage: { findMany: vi.fn() },
    // orgStageVocabulary reads the spellings the org actually stores, so the
    // won-set is no longer just PipelineStage.isWon ∪ "WON".
    deal: { groupBy: vi.fn().mockResolvedValue([]), findMany: vi.fn().mockResolvedValue([]) },
  },
}))
vi.mock("@/lib/api-auth", () => ({ getOrgId: vi.fn(), getSession: vi.fn().mockResolvedValue(null) }))

import { GET } from "@/app/api/v1/campaign-roi/route"
import { prisma } from "@/lib/prisma"
import { getOrgId } from "@/lib/api-auth"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pr = prisma as any

const CAMPAIGNS = [
  {
    id: "cam1", name: "Spring", status: "sent", type: "email", budget: 1000,
    totalRecipients: 100, totalSent: 100, totalOpened: 50, totalClicked: 10,
    sentAt: null, createdAt: new Date("2026-01-01"),
    deals: [
      { id: "d1", name: "Deal A", stage: "WON", valueAmount: 5000, currency: "USD" },
      { id: "d2", name: "Deal B", stage: "LOST", valueAmount: 9000, currency: "USD" },
    ],
  },
  {
    id: "cam2", name: "Fall", status: "draft", type: "sms", budget: 500,
    totalRecipients: 0, totalSent: 0, totalOpened: 0, totalClicked: 0,
    sentAt: null, createdAt: new Date("2026-02-01"),
    deals: [],
  },
]

function req() {
  return new NextRequest("http://localhost/api/v1/campaign-roi")
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getOrgId).mockResolvedValue("org-1")
  pr.campaign.findMany.mockResolvedValue(CAMPAIGNS)
  pr.pipelineStage.findMany.mockResolvedValue([]) // no custom won stages → {"WON"}
})

describe("C9 #10 — campaign ROI attribution overlay", () => {
  it("adds attributedRevenue from the default model's influences", async () => {
    pr.attributionModel.findFirst.mockResolvedValue({ id: "m1", name: "Linear", modelType: "linear" })
    // cam1 attributed 2000 (less than its 5000 direct — multi-touch split),
    // cam2 attributed 1500 (credited even though it has no directly-linked deal).
    pr.campaignInfluence.groupBy.mockResolvedValue([
      { campaignId: "cam1", _sum: { attributedRevenue: 2000 } },
      { campaignId: "cam2", _sum: { attributedRevenue: 1500 } },
    ])

    const res = await GET(req())
    const json = await res.json()
    expect(res.status).toBe(200)

    const byId = Object.fromEntries(json.data.campaigns.map((c: any) => [c.id, c]))
    // Direct revenue untouched (cam1 = its one WON deal; cam2 = 0).
    expect(byId.cam1.revenue).toBe(5000)
    expect(byId.cam2.revenue).toBe(0)
    // Attributed overlay from influences.
    expect(byId.cam1.attributedRevenue).toBe(2000)
    expect(byId.cam2.attributedRevenue).toBe(1500)
    // ROI uses each measure against the budget.
    expect(byId.cam1.roi).toBeCloseTo((5000 - 1000) / 1000 * 100) // 400
    expect(byId.cam1.attributedRoi).toBeCloseTo((2000 - 1000) / 1000 * 100) // 100
    expect(byId.cam2.attributedRoi).toBeCloseTo((1500 - 500) / 500 * 100) // 200

    expect(json.data.summary.attributionModel).toEqual({ name: "Linear", modelType: "linear" })
    expect(json.data.summary.totalAttributedRevenue).toBe(3500)
    expect(json.data.summary.totalRevenue).toBe(5000)
    // groupBy scoped to the org + the chosen model.
    expect(pr.campaignInfluence.groupBy.mock.calls[0][0].where).toMatchObject({
      organizationId: "org-1", modelId: "m1",
    })
  })

  it("degrades gracefully when no attribution model exists", async () => {
    pr.attributionModel.findFirst.mockResolvedValue(null)

    const res = await GET(req())
    const json = await res.json()
    expect(res.status).toBe(200)

    // Never queries influences without a model.
    expect(pr.campaignInfluence.groupBy).not.toHaveBeenCalled()
    const byId = Object.fromEntries(json.data.campaigns.map((c: any) => [c.id, c]))
    expect(byId.cam1.revenue).toBe(5000) // direct intact
    expect(byId.cam1.attributedRevenue).toBe(0)
    // attributedRoi follows the same formula (0 revenue − 1000 cost → −100%); it
    // is a don't-care here — the UI only surfaces the overlay when a model exists
    // (summary.attributionModel != null, asserted below).
    expect(byId.cam1.attributedRoi).toBe(-100)
    expect(json.data.summary.attributionModel).toBeNull()
    expect(json.data.summary.totalAttributedRevenue).toBe(0)
  })

  it("counts custom won stages (PipelineStage.isWon), not just literal 'WON'", async () => {
    // Closes the won-stage asymmetry: direct revenue must use the same
    // resolution as the recompute worker (isWon ∪ "WON"), so an org with a
    // custom 'Closed Won' stage credits those deals too.
    pr.attributionModel.findFirst.mockResolvedValue(null)
    pr.pipelineStage.findMany.mockResolvedValue([{ name: "Closed Won" }])
    pr.campaign.findMany.mockResolvedValue([
      {
        id: "cam1", name: "X", status: "sent", type: "email", budget: 100,
        totalRecipients: 0, totalSent: 0, totalOpened: 0, totalClicked: 0, sentAt: null, createdAt: new Date(),
        deals: [
          { id: "d1", name: "A", stage: "Closed Won", valueAmount: 3000, currency: "USD" },
          { id: "d2", name: "B", stage: "WON", valueAmount: 1000, currency: "USD" },
          { id: "d3", name: "C", stage: "NEGOTIATION", valueAmount: 9000, currency: "USD" },
        ],
      },
    ])
    const res = await GET(req())
    const json = await res.json()
    const cam = json.data.campaigns[0]
    expect(cam.revenue).toBe(4000) // "Closed Won" + "WON", NOT the open deal
    expect(cam.wonDeals).toBe(2)
  })

  it("401 without an org", async () => {
    vi.mocked(getOrgId).mockResolvedValue(null)
    const res = await GET(req())
    expect(res.status).toBe(401)
  })
})
