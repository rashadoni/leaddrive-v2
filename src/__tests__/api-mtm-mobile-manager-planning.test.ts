import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/prisma", async () => {
  const { makeMtmPrismaMock } = await import("./mocks/mtm-prisma")
  return { prisma: makeMtmPrismaMock() }
})

vi.mock("@/lib/mobile-auth", async () => {
  const { makeMobileAuthMock } = await import("./mocks/mobile-auth")
  return makeMobileAuthMock()
})

vi.mock("@/lib/mtm/territory-scope", () => ({ resolveAgentScope: vi.fn() }))

import { GET } from "@/app/api/v1/mtm/mobile/manager/planning/route"
import { resolveMobileAuth } from "@/lib/mobile-auth"
import { prisma } from "@/lib/prisma"
import { resolveAgentScope } from "@/lib/mtm/territory-scope"

const AUTH = {
  orgId: "org-1",
  agentId: "manager-1",
  userId: "user-1",
  email: "manager@example.com",
  name: "Manager",
  role: "MANAGER",
}

function request(query = "") {
  return new NextRequest(`http://localhost/api/v1/mtm/mobile/manager/planning${query}`, {
    headers: { Authorization: "Bearer mobile" },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(resolveMobileAuth).mockResolvedValue(AUTH as never)
  vi.mocked(resolveAgentScope).mockResolvedValue({ agentIds: ["agent-1", "manager-1"] } as never)
  vi.mocked(prisma.mtmAgent.findMany).mockResolvedValue([{
    id: "agent-1",
    name: "Aysel",
    role: "AGENT",
    status: "ACTIVE",
    teamId: "team-1",
  }] as never)
  vi.mocked(prisma.mtmRoute.findMany).mockResolvedValue([{
    id: "route-1",
    agentId: "agent-1",
    date: new Date("2026-08-20T00:00:00.000Z"),
    name: "Thursday plan",
    status: "PLANNED",
    totalPoints: 6,
    visitedPoints: 2,
    startedAt: null,
    completedAt: null,
    agent: { id: "agent-1", name: "Aysel" },
  }] as never)
})

describe("GET /api/v1/mtm/mobile/manager/planning", () => {
  it("keeps the legacy date contract while adding calendar metadata and active agents", async () => {
    const response = await GET(request("?date=2026-08-20"))
    expect(response.status).toBe(200)
    const body = await response.json()

    expect(body).toMatchObject({
      success: true,
      data: {
        date: "2026-08-20",
        from: "2026-08-20",
        to: "2026-08-20",
        days: 1,
        maxRangeDays: 42,
        truncated: false,
        scope: "TEAM_OR_REGION",
        agents: [{ id: "agent-1", name: "Aysel" }],
        routes: [{
          id: "route-1",
          totalPoints: 6,
          visitedPoints: 2,
          agent: { id: "agent-1", name: "Aysel" },
        }],
      },
    })

    expect(prisma.mtmAgent.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        organizationId: "org-1",
        status: "ACTIVE",
        id: { in: ["agent-1", "manager-1"] },
      },
    }))
    expect(prisma.mtmRoute.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        organizationId: "org-1",
        date: {
          gte: new Date("2026-08-20T00:00:00.000Z"),
          lt: new Date("2026-08-21T00:00:00.000Z"),
        },
        deletedAt: null,
        agentId: { in: ["agent-1", "manager-1"] },
      },
    }))
  })

  it("accepts an inclusive 42-day range and uses an exclusive database upper bound", async () => {
    const response = await GET(request("?from=2026-08-01&to=2026-09-11"))
    expect(response.status).toBe(200)
    const body = await response.json()

    expect(body.data).toMatchObject({
      from: "2026-08-01",
      to: "2026-09-11",
      days: 42,
    })
    expect(body.data).not.toHaveProperty("date")
    expect(prisma.mtmRoute.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        date: {
          gte: new Date("2026-08-01T00:00:00.000Z"),
          lt: new Date("2026-09-12T00:00:00.000Z"),
        },
      }),
    }))
  })

  it.each([
    "?from=2026-08-01",
    "?to=2026-08-20",
    "?from=2026-08-20&to=2026-08-01",
    "?from=2026-02-30&to=2026-03-01",
    "?from=2026-08-01&to=2026-09-12",
    "?date=2026-08-20&from=2026-08-20&to=2026-08-20",
    "?date=20-08-2026",
  ])("rejects an invalid or ambiguous range before resolving scope: %s", async (query) => {
    const response = await GET(request(query))
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ code: "MTM_MANAGER_PLANNING_RANGE_INVALID" })
    expect(resolveAgentScope).not.toHaveBeenCalled()
    expect(prisma.mtmAgent.findMany).not.toHaveBeenCalled()
    expect(prisma.mtmRoute.findMany).not.toHaveBeenCalled()
  })

  it("keeps organization-wide admin scope tenant-bound without an agent-id filter", async () => {
    vi.mocked(resolveMobileAuth).mockResolvedValue({ ...AUTH, role: "ADMIN" } as never)
    vi.mocked(resolveAgentScope).mockResolvedValue({ agentIds: null } as never)

    const response = await GET(request("?from=2026-08-01&to=2026-08-07"))
    expect(response.status).toBe(200)
    expect((await response.json()).data.scope).toBe("ORGANIZATION")

    const agentQuery = vi.mocked(prisma.mtmAgent.findMany).mock.calls[0][0] as any
    const routeQuery = vi.mocked(prisma.mtmRoute.findMany).mock.calls[0][0] as any
    const agentWhere = agentQuery.where
    const routeWhere = routeQuery.where
    expect(agentWhere).toEqual({ organizationId: "org-1", status: "ACTIVE" })
    expect(routeWhere.organizationId).toBe("org-1")
    expect(routeWhere).not.toHaveProperty("agentId")
  })

  it("rejects field agents without TEAM_READ before any planning query", async () => {
    vi.mocked(resolveMobileAuth).mockResolvedValue({ ...AUTH, role: "AGENT" } as never)

    const response = await GET(request("?date=2026-08-20"))
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({
      code: "MTM_MOBILE_CAPABILITY_REQUIRED",
      capability: "TEAM_READ",
    })
    expect(resolveAgentScope).not.toHaveBeenCalled()
    expect(prisma.mtmRoute.findMany).not.toHaveBeenCalled()
  })
})
