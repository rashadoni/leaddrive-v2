import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/prisma", async () => {
  const { makeMtmPrismaMock } = await import("./mocks/mtm-prisma")
  return { prisma: makeMtmPrismaMock() }
})
vi.mock("@/lib/api-auth", () => ({
  getOrgId: vi.fn(),
  getSession: vi.fn().mockResolvedValue(null),
  requireAuth: vi.fn(),
  isAuthError: (value: unknown) => value instanceof Response,
}))
vi.mock("@/lib/mobile-auth", async () => {
  const { makeMobileAuthMock } = await import("./mocks/mobile-auth")
  return makeMobileAuthMock()
})
vi.mock("@/lib/mtm/route-permissions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/mtm/route-permissions")>()
  return { ...actual, resolveMtmRouteActor: vi.fn() }
})
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: vi.fn() }))
vi.mock("@/lib/mtm-audit", () => ({ writeMtmAudit: vi.fn(() => Promise.resolve()) }))

import { GET } from "@/app/api/v1/mtm/week/team/route"
import { requireAuth } from "@/lib/api-auth"
import { getMobileAuth, resolveMobileAuth } from "@/lib/mobile-auth"
import { resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import { checkRateLimit } from "@/lib/rate-limit"
import { writeMtmAudit } from "@/lib/mtm-audit"
import { prisma } from "@/lib/prisma"

const ORG = "org-1"

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getMobileAuth).mockReturnValue(null)
  vi.mocked(resolveMobileAuth).mockResolvedValue(null)
  vi.mocked(requireAuth).mockResolvedValue({ orgId: ORG, userId: "manager-user", role: "user", email: "m@example.com", name: "M" } as never)
  vi.mocked(resolveMtmRouteActor).mockResolvedValue({ agentId: "manager-agent", role: "MANAGER", scopedAgentIds: ["anar"] } as never)
  vi.mocked(checkRateLimit).mockReturnValue(true)
  vi.mocked(prisma.mtmSetting.findMany).mockResolvedValue([])
  vi.mocked(prisma.organization.findUnique).mockResolvedValue({ plan: "enterprise", addons: [], features: [], modules: { mtm: true } } as never)
  vi.mocked(prisma.mtmAgent.findMany).mockResolvedValue([{ id: "anar", name: "Anar Mammadov", lastSeenAt: null, team: { id: "t1", name: "Baku" } }] as never)
  vi.mocked(prisma.mtmAgentLocation.findMany).mockResolvedValue([{ agentId: "anar", recordedAt: new Date() }] as never)
  vi.mocked(prisma.mtmRoute.findMany).mockResolvedValue([{ agentId: "anar", status: "COMPLETED", totalPoints: 2, visitedPoints: 2 }] as never)
  vi.mocked(prisma.mtmVisit.findMany).mockResolvedValue([
    { id: "v1", agentId: "anar", status: "CHECKED_OUT", checkInAt: new Date(), checkOutAt: new Date(), customer: { name: "Aptek" } },
    { id: "leak", agentId: "outside", status: "CHECKED_OUT", checkInAt: new Date(), checkOutAt: null, customer: { name: "Hidden" } },
  ] as never)
  vi.mocked(prisma.mtmAlert.groupBy).mockResolvedValue([{ agentId: "anar", _count: { _all: 18 } }] as never)
  vi.mocked(prisma.mtmAgentWorkday.findMany).mockResolvedValue([
    { agentId: "anar", status: "STARTED", workDate: new Date("2020-01-01T00:00:00.000Z"), startedAt: new Date("2020-01-01T10:00:00.000Z"), pausedAt: null, completedAt: null },
  ] as never)
})

describe("GET /api/v1/mtm/week/team", () => {
  it("returns one row per scoped agent with GPS time, route x/y, visits, open alerts and the manager workday", async () => {
    const response = await GET(new NextRequest("http://localhost:3000/api/v1/mtm/week/team?teamId=t1"))
    expect(response.status).toBe(200)
    const json = await response.json()
    expect(json.data.mode).toBe("TEAM_TODAY")
    expect(json.data.rows).toHaveLength(1)
    expect(json.data.rows[0]).toMatchObject({
      agent: { id: "anar", name: "Anar Mammadov" },
      route: { visited: 2, total: 2 },
      openAlerts: 18,
      workday: { kind: "left-open" },
    })
    expect(json.data.rows[0].visits.map((visit: { id: string }) => visit.id)).toEqual(["v1"])
    expect(JSON.stringify(json.data)).not.toContain("Hidden")
    expect(JSON.stringify(json.data)).not.toContain("latitude")
  })

  it("bounds every read to the resolved scope and the requested team", async () => {
    await GET(new NextRequest("http://localhost:3000/api/v1/mtm/week/team?teamId=t1"))
    const agentWhere = (vi.mocked(prisma.mtmAgent.findMany).mock.calls[0][0] as any).where
    expect(agentWhere).toMatchObject({ organizationId: ORG, status: "ACTIVE", id: { in: ["anar"] }, teamId: "t1" })
    for (const call of [
      vi.mocked(prisma.mtmAgentLocation.findMany).mock.calls[0],
      vi.mocked(prisma.mtmRoute.findMany).mock.calls[0],
      vi.mocked(prisma.mtmVisit.findMany).mock.calls[0],
      vi.mocked(prisma.mtmAlert.groupBy).mock.calls[0],
      vi.mocked(prisma.mtmAgentWorkday.findMany).mock.calls[0],
    ]) {
      expect((call[0] as any).where).toMatchObject({ organizationId: ORG, agentId: { in: ["anar"] } })
    }
    expect(writeMtmAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "WEEK_TEAM_GPS_LATEST_READ" }))
  })

  it("keeps an AGENT to their own row and skips workday facts without Workforce", async () => {
    vi.mocked(resolveMtmRouteActor).mockResolvedValue({ agentId: "anar", role: "AGENT", scopedAgentIds: ["anar", "someone"] } as never)
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({ plan: "enterprise", addons: [], features: [], modules: { mtm: true, "workforce-hrm": false } } as never)
    const json = await (await GET(new NextRequest("http://localhost:3000/api/v1/mtm/week/team"))).json()
    expect((vi.mocked(prisma.mtmAgent.findMany).mock.calls[0][0] as any).where.id).toEqual({ in: ["anar"] })
    expect(prisma.mtmAgentWorkday.findMany).not.toHaveBeenCalled()
    expect(json.data.rows[0].workday).toBeNull()
  })

  it("does not read facts when nobody is in scope", async () => {
    vi.mocked(prisma.mtmAgent.findMany).mockResolvedValue([] as never)
    const json = await (await GET(new NextRequest("http://localhost:3000/api/v1/mtm/week/team"))).json()
    expect(json.data.rows).toEqual([])
    expect(prisma.mtmVisit.findMany).not.toHaveBeenCalled()
    expect(prisma.mtmAlert.groupBy).not.toHaveBeenCalled()
  })
})
