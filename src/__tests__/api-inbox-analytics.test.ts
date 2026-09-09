import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    channelMessage: { groupBy: vi.fn() },
    socialConversation: { groupBy: vi.fn() },
    deal: { groupBy: vi.fn() },
    pipelineStage: { findMany: vi.fn() },
    user: { findMany: vi.fn() },
    $queryRaw: vi.fn(), // avg-lifetime raw query
  },
}))
vi.mock("@/lib/api-auth", () => {
  const getOrgId = vi.fn()
  return {
    getOrgId,
    getSession: vi.fn().mockResolvedValue(null),
    requireAuth: vi.fn(async (req: NextRequest) => {
      const orgId = await getOrgId(req)
      return orgId
        ? { orgId, userId: "support-1", role: "support", email: "", name: "" }
        : new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 })
    }),
    isAuthError: (value: unknown) => value instanceof Response,
  }
})

import { GET } from "@/app/api/v1/inbox/analytics/route"
import { getOrgId } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"

const fn = (x: unknown) => x as ReturnType<typeof vi.fn>

describe("GET /api/v1/inbox/analytics", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fn(prisma.socialConversation.groupBy).mockResolvedValue([]) // default: no conversations
    fn(prisma.deal.groupBy).mockResolvedValue([])
    fn(prisma.pipelineStage.findMany).mockResolvedValue([])
    fn(prisma.user.findMany).mockResolvedValue([])
    fn(prisma.$queryRaw).mockResolvedValue([{ avg_hours: null }]) // default: no resolved lifetime
  })

  it("401 without an org — and does not query", async () => {
    fn(getOrgId).mockResolvedValue(null)
    expect((await GET(new NextRequest("http://localhost/x"))).status).toBe(401)
    expect(prisma.channelMessage.groupBy).not.toHaveBeenCalled()
  })

  it("org-scoped groupBy → summarized payload", async () => {
    fn(getOrgId).mockResolvedValue("org_1")
    fn(prisma.channelMessage.groupBy).mockResolvedValue([
      { channelType: "email", direction: "inbound", _count: { _all: 4 } },
      { channelType: "email", direction: "outbound", _count: { _all: 1 } },
    ])
    const res = await GET(new NextRequest("http://localhost/api/v1/inbox/analytics"))
    expect(res.status).toBe(200)
    expect((await res.json()).data).toMatchObject({ total: 5, inbound: 4, outbound: 1 })
    expect(prisma.channelMessage.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ organizationId: "org_1" }) }),
    )
  })

  it("applies ?from= as a createdAt.gte filter", async () => {
    fn(getOrgId).mockResolvedValue("org_1")
    fn(prisma.channelMessage.groupBy).mockResolvedValue([])
    await GET(new NextRequest("http://localhost/api/v1/inbox/analytics?from=2025-01-01"))
    const arg = fn(prisma.channelMessage.groupBy).mock.calls[0][0]
    expect(arg.where.createdAt?.gte).toBeInstanceOf(Date)
  })

  it("ignores an invalid ?from= (no date filter applied)", async () => {
    fn(getOrgId).mockResolvedValue("org_1")
    fn(prisma.channelMessage.groupBy).mockResolvedValue([])
    await GET(new NextRequest("http://localhost/api/v1/inbox/analytics?from=not-a-date"))
    const arg = fn(prisma.channelMessage.groupBy).mock.calls[0][0]
    expect(arg.where.createdAt).toBeUndefined()
  })

  it("applies ?to= as a createdAt.lte filter (full range with ?from=)", async () => {
    fn(getOrgId).mockResolvedValue("org_1")
    fn(prisma.channelMessage.groupBy).mockResolvedValue([])
    await GET(new NextRequest("http://localhost/api/v1/inbox/analytics?from=2025-01-01&to=2025-02-01"))
    const arg = fn(prisma.channelMessage.groupBy).mock.calls[0][0]
    expect(arg.where.createdAt?.gte).toBeInstanceOf(Date)
    expect(arg.where.createdAt?.lte).toBeInstanceOf(Date)
  })

  it("adds org-scoped social-channel conversation stats (resolution rate)", async () => {
    fn(getOrgId).mockResolvedValue("org_1")
    fn(prisma.channelMessage.groupBy).mockResolvedValue([])
    fn(prisma.socialConversation.groupBy).mockResolvedValue([
      { status: "open", _count: { _all: 3 } },
      { status: "resolved", _count: { _all: 7 } },
    ])
    const res = await GET(new NextRequest("http://localhost/api/v1/inbox/analytics"))
    const json = await res.json()
    // slice-1 message fields stay top-level (non-breaking) + conversations added
    expect(json.data).toHaveProperty("byChannel")
    expect(json.data.conversations).toMatchObject({ total: 10, open: 3, resolved: 7, resolutionRate: 70 })
    expect(prisma.socialConversation.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ by: ["status"], where: expect.objectContaining({ organizationId: "org_1" }) }),
    )
  })

  it("adds per-channel breakdown (resolved channel) + avg conversation lifetime", async () => {
    fn(getOrgId).mockResolvedValue("org_1")
    fn(prisma.channelMessage.groupBy).mockResolvedValue([])
    fn(prisma.socialConversation.groupBy).mockResolvedValue([{ status: "resolved", _count: { _all: 2 } }])
    // byPlatform comes from the FIRST $queryRaw (resolved-channel groupBy); lifetime from the SECOND.
    fn(prisma.$queryRaw)
      .mockResolvedValueOnce([
        { channel: "whatsapp", status: "resolved", count: 2 },
        { channel: "email", status: "open", count: 1 }, // email resolved from metadata.channel
      ])
      .mockResolvedValueOnce([{ avg_hours: 12.34 }])
    const res = await GET(new NextRequest("http://localhost/api/v1/inbox/analytics"))
    const json = await res.json()
    expect(json.data.byPlatform).toEqual([
      { platform: "whatsapp", total: 2, open: 0, resolved: 2 },
      { platform: "email", total: 1, open: 1, resolved: 0 },
    ])
    expect(json.data.avgLifetimeHours).toBe(12.3)
  })

  it("applies ?channel= (channelType for messages; resolved-channel OR for conversations)", async () => {
    fn(getOrgId).mockResolvedValue("org_1")
    fn(prisma.channelMessage.groupBy).mockResolvedValue([])
    await GET(new NextRequest("http://localhost/api/v1/inbox/analytics?channel=email"))
    expect(fn(prisma.channelMessage.groupBy).mock.calls[0][0].where.channelType).toBe("email")
    // conversations filter by an OR (platform=email OR inbox-bucket with metadata.channel=email),
    // never a bare platform=email (which never exists for email/sms/web-chat).
    const convWhere = fn(prisma.socialConversation.groupBy).mock.calls[0][0].where
    expect(convWhere.platform).toBeUndefined()
    expect(convWhere.OR).toEqual([
      { platform: "email" },
      { platform: "inbox", metadata: { path: ["channel"], equals: "email" } },
    ])
  })

  it("applies customer-stage and delivery-status filters consistently", async () => {
    fn(getOrgId).mockResolvedValue("org_1")
    fn(prisma.channelMessage.groupBy).mockResolvedValue([])

    await GET(new NextRequest(
      "http://localhost/api/v1/inbox/analytics?customerStage=potential&messageStatus=read",
    ))

    const msgWhere = fn(prisma.channelMessage.groupBy).mock.calls[0][0].where
    expect(msgWhere).toMatchObject({
      organizationId: "org_1",
      status: "read",
      conversation: {
        is: {
          OR: [
            { customerStage: "potential" },
            { salesCallOutcomes: { has: "potential" } },
          ],
        },
      },
    })
    const convWhere = fn(prisma.socialConversation.groupBy).mock.calls[0][0].where
    expect(convWhere).toMatchObject({
      organizationId: "org_1",
      AND: [{
        OR: [
          { customerStage: "potential" },
          { salesCallOutcomes: { has: "potential" } },
        ],
      }],
      messages: { some: { status: "read" } },
    })
  })

  it("reports actual CRM deal cohorts per agent separately from conversation outcomes", async () => {
    fn(getOrgId).mockResolvedValue("org_1")
    fn(prisma.channelMessage.groupBy).mockResolvedValue([])
    fn(prisma.deal.groupBy).mockResolvedValue([
      { assignedTo: "u1", stage: "LEAD", _count: { _all: 2 } },
      { assignedTo: "u1", stage: "CLOSED_WON", _count: { _all: 3 } },
    ])
    fn(prisma.user.findMany).mockResolvedValue([{ id: "u1", name: "Kenan", email: "kenan@example.com" }])

    const res = await GET(new NextRequest("http://localhost/api/v1/inbox/analytics?from=2026-07-01"))
    const json = await res.json()

    expect(json.data.managerSegments).toContainEqual(expect.objectContaining({
      agentId: "u1",
      agentName: "Kenan",
      createdDeals: 5,
      wonDeals: 3,
    }))
    expect(fn(prisma.deal.groupBy).mock.calls[0][0].where).toMatchObject({
      organizationId: "org_1",
      createdAt: { gte: expect.any(Date) },
    })
  })
})
