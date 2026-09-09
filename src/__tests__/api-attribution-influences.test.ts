/**
 * C9 per-campaign influence report tests.
 * GET /api/v1/attribution-models/[id]/influences — groups campaign_influences
 * by campaign, joins names, sorts by attributed revenue desc, Decimal→number.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest, NextResponse } from "next/server"

vi.mock("@/lib/api-auth", () => ({
  requireAuth: vi.fn(),
  isAuthError: (v: unknown) => v instanceof NextResponse,
}))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    attributionModel: { findFirst: vi.fn() },
    campaignInfluence: { groupBy: vi.fn() },
    campaign: { findMany: vi.fn() },
  },
}))

import { GET } from "@/app/api/v1/attribution-models/[id]/influences/route"
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/lib/api-auth"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pr = prisma as any
const AUTH = { orgId: "org-1", userId: "u1" }
const req = () => new NextRequest("http://localhost/api/v1/attribution-models/m1/influences")
const ctx = (id = "m1") => ({ params: Promise.resolve({ id }) })
const dec = (n: number) => ({ toNumber: () => n })

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireAuth).mockResolvedValue(AUTH as never)
  pr.attributionModel.findFirst.mockResolvedValue({ id: "m1", name: "Linear", modelType: "linear" })
})

describe("GET /api/v1/attribution-models/[id]/influences", () => {
  it("404 when the model is not in the tenant", async () => {
    pr.attributionModel.findFirst.mockResolvedValue(null)
    const res = await GET(req(), ctx())
    expect(res.status).toBe(404)
    expect(pr.campaignInfluence.groupBy).not.toHaveBeenCalled()
  })

  it("groups by campaign, joins names, sorts by revenue desc, Decimal→number", async () => {
    pr.campaignInfluence.groupBy.mockResolvedValue([
      { campaignId: "cam1", _count: { _all: 2 }, _sum: { attributedRevenue: dec(1000), touchpointCount: 4 }, _avg: { weight: 0.5 } },
      { campaignId: "cam2", _count: { _all: 1 }, _sum: { attributedRevenue: dec(3000), touchpointCount: 1 }, _avg: { weight: 1 } },
    ])
    pr.campaign.findMany.mockResolvedValue([
      { id: "cam1", name: "Spring Blast" },
      { id: "cam2", name: "Webinar" },
    ])
    const res = await GET(req(), ctx())
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.campaignCount).toBe(2)
    expect(json.totalAttributedRevenue).toBe(4000)
    // sorted by revenue desc → Webinar ($3000) first
    expect(json.campaigns[0]).toMatchObject({ campaignId: "cam2", campaignName: "Webinar", dealCount: 1, attributedRevenue: 3000 })
    expect(json.campaigns[1]).toMatchObject({ campaignId: "cam1", campaignName: "Spring Blast", dealCount: 2, attributedRevenue: 1000 })
    expect(typeof json.campaigns[0].attributedRevenue).toBe("number")
  })

  it("returns empty breakdown with no influences (skips campaign lookup)", async () => {
    pr.campaignInfluence.groupBy.mockResolvedValue([])
    const res = await GET(req(), ctx())
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.campaigns).toEqual([])
    expect(json.totalAttributedRevenue).toBe(0)
    expect(pr.campaign.findMany).not.toHaveBeenCalled()
  })

  it("passes auth errors through (401)", async () => {
    vi.mocked(requireAuth).mockResolvedValueOnce(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }) as never,
    )
    const res = await GET(req(), ctx())
    expect(res.status).toBe(401)
  })

  it("falls back to '—' when a campaign was deleted (name not resolvable)", async () => {
    pr.campaignInfluence.groupBy.mockResolvedValue([
      { campaignId: "gone", _count: { _all: 1 }, _sum: { attributedRevenue: dec(500), touchpointCount: 1 }, _avg: { weight: 1 } },
    ])
    pr.campaign.findMany.mockResolvedValue([]) // campaign no longer exists
    const res = await GET(req(), ctx())
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.campaigns[0].campaignName).toBe("—")
    expect(json.campaigns[0].attributedRevenue).toBe(500)
  })
})
