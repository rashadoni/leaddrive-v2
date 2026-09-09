import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

/**
 * Drill-down list endpoint (slice 3): conversations behind an analytics segment.
 * Org-scoped raw query + org-scoped agent-name resolve; ageBucket validation; limit clamp.
 */
vi.mock("@/lib/prisma", () => ({
  prisma: { $queryRaw: vi.fn(), user: { findMany: vi.fn(async () => []) } },
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

import { GET } from "@/app/api/v1/inbox/analytics/conversations/route"
import { getOrgId } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"

const fn = (x: unknown) => x as ReturnType<typeof vi.fn>

const ROW = {
  id: "c1", contactName: "Anar", channel: "whatsapp", status: "open",
  lastMessageAt: new Date("2026-06-01T10:00:00Z"), age_h: 26.04, assignedTo: "u1", unreadCount: 2,
}

describe("GET /api/v1/inbox/analytics/conversations (drill-down)", () => {
  beforeEach(() => { vi.clearAllMocks(); fn(prisma.user.findMany).mockResolvedValue([]) })

  it("401 without an org — and runs no query", async () => {
    fn(getOrgId).mockResolvedValue(null)
    expect((await GET(new NextRequest("http://localhost/x"))).status).toBe(401)
    expect(prisma.$queryRaw).not.toHaveBeenCalled()
  })

  it("400 on an unknown ageBucket (whitelist, not interpolation)", async () => {
    fn(getOrgId).mockResolvedValue("org_1")
    const res = await GET(new NextRequest("http://localhost/api?ageBucket=evil'); DROP TABLE--"))
    expect(res.status).toBe(400)
    expect(prisma.$queryRaw).not.toHaveBeenCalled()
  })

  it("400 on an unknown frtBucket; a whitelisted one queries (slice 4)", async () => {
    fn(getOrgId).mockResolvedValue("org_1")
    const bad = await GET(new NextRequest("http://localhost/api?frtBucket=nope"))
    expect(bad.status).toBe(400)
    expect(prisma.$queryRaw).not.toHaveBeenCalled()
    fn(prisma.$queryRaw).mockResolvedValue([ROW])
    const ok = await GET(new NextRequest("http://localhost/api?frtBucket=gt60m"))
    expect(ok.status).toBe(200)
    expect((await ok.json()).data.conversations).toHaveLength(1)
  })

  it("maps rows + resolves agent names org-scoped + rounds ageHours", async () => {
    fn(getOrgId).mockResolvedValue("org_1")
    fn(prisma.$queryRaw).mockResolvedValue([ROW])
    fn(prisma.user.findMany).mockResolvedValue([{ id: "u1", name: "Aysel" }])
    const res = await GET(new NextRequest("http://localhost/api?ageBucket=gt24h"))
    expect(res.status).toBe(200)
    const d = (await res.json()).data
    expect(d.conversations[0]).toMatchObject({
      id: "c1", contactName: "Anar", channel: "whatsapp", ageHours: 26, agentName: "Aysel", unreadCount: 2,
    })
    expect(d.truncated).toBe(false)
    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ organizationId: "org_1" }) }),
    )
  })

  it("clamps ?limit= to 200 and flags truncation when the page is full", async () => {
    fn(getOrgId).mockResolvedValue("org_1")
    fn(prisma.$queryRaw).mockResolvedValue(Array.from({ length: 200 }, (_, i) => ({ ...ROW, id: `c${i}`, assignedTo: null })))
    const res = await GET(new NextRequest("http://localhost/api?limit=99999"))
    const d = (await res.json()).data
    expect(d.limit).toBe(200)
    expect(d.truncated).toBe(true)
    expect(d.conversations[0].agentName).toBeNull()
  })
})
