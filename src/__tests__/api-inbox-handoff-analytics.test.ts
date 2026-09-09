import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRaw: vi.fn(),
    user: { findMany: vi.fn() },
  },
}))

vi.mock("@/lib/api-auth", () => {
  const getOrgId = vi.fn()
  return {
    getSession: vi.fn().mockResolvedValue(null),
    getOrgId,
    requireAuth: vi.fn(async (req: NextRequest) => {
      const orgId = await getOrgId(req)
      return orgId
        ? { orgId, userId: "support-1", role: "support", email: "", name: "" }
        : new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 })
    }),
    isAuthError: (value: unknown) => value instanceof Response,
  }
})

import { GET } from "@/app/api/v1/inbox/analytics/handoff/route"
import { getOrgId } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"

const fn = (value: unknown) => value as ReturnType<typeof vi.fn>

describe("GET /api/v1/inbox/analytics/handoff", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fn(prisma.user.findMany).mockResolvedValue([])
  })

  it("returns 401 without a tenant and does not query reporting data", async () => {
    fn(getOrgId).mockResolvedValue(null)

    const response = await GET(new NextRequest("http://localhost/api/v1/inbox/analytics/handoff"))

    expect(response.status).toBe(401)
    expect(prisma.$queryRaw).not.toHaveBeenCalled()
  })

  it("returns the marketing-to-sales funnel with employee attribution", async () => {
    fn(getOrgId).mockResolvedValue("org-1")
    fn(prisma.$queryRaw)
      .mockResolvedValueOnce([{ agent_id: "marketing-1", contacted: 8 }])
      .mockResolvedValueOnce([
        { marketer_id: "marketing-1", seller_id: "seller-1", stage: "potential", reported: true, count: 2 },
        { marketer_id: "marketing-1", seller_id: "seller-1", stage: "sold", reported: true, count: 1 },
        { marketer_id: "marketing-1", seller_id: "seller-2", stage: "potential", reported: false, count: 1 },
      ])
    fn(prisma.user.findMany).mockResolvedValue([
      { id: "marketing-1", name: "Aysel", email: "aysel@example.com" },
      { id: "seller-1", name: "Kenan", email: "kenan@example.com" },
      { id: "seller-2", name: "Samir", email: "samir@example.com" },
    ])

    const response = await GET(new NextRequest(
      "http://localhost/api/v1/inbox/analytics/handoff?from=2026-07-01&to=2026-07-31&channel=tiktok",
    ))
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.data.totals).toEqual({
      marketingContacted: 8,
      leadsCreated: 4,
      salesReported: 3,
      awaitingSalesReport: 1,
      sold: 1,
      marketingToLeadRate: 50,
      salesReportRate: 75,
      soldRate: 33.3,
    })
    expect(payload.data.marketing).toContainEqual(expect.objectContaining({
      agentName: "Aysel",
      conversationsContacted: 8,
      leadsCreated: 4,
    }))
    expect(payload.data.sellers).toContainEqual(expect.objectContaining({
      agentName: "Kenan",
      assignedLeads: 3,
      reported: 3,
      outcomes: { potential: 2, sold: 1 },
    }))
    expect(prisma.user.findMany).toHaveBeenCalledWith({
      where: {
        id: { in: ["marketing-1", "seller-1", "seller-2"] },
        organizationId: "org-1",
      },
      select: { id: true, name: true, email: true },
    })
  })
})
