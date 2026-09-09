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

import { GET as GET_LIST } from "@/app/api/v1/mtm/routes/route"
import { GET as GET_DETAIL } from "@/app/api/v1/mtm/routes/[id]/route"
import { requireAuth } from "@/lib/api-auth"
import { getMobileAuth, resolveMobileAuth } from "@/lib/mobile-auth"
import { prisma } from "@/lib/prisma"

const ORG = "org-1"
const ACTOR = "agent-1"

function request(path: string) {
  return new NextRequest(`http://localhost:3000${path}`)
}

function detailContext(id: string) {
  return { params: Promise.resolve({ id }) }
}

function route(overrides: Record<string, unknown> = {}) {
  return {
    id: "route-historical",
    organizationId: ORG,
    agentId: "agent-outside",
    date: new Date("2026-04-10T00:00:00.000Z"),
    name: "Historical published route",
    notes: null,
    status: "PLANNED",
    version: 3,
    publishedVersion: 3,
    publishedAt: new Date("2026-04-09T12:00:00.000Z"),
    totalPoints: 0,
    visitedPoints: 0,
    startedAt: null,
    completedAt: null,
    createdAt: new Date("2026-04-09T12:00:00.000Z"),
    updatedAt: new Date("2026-04-09T12:00:00.000Z"),
    agent: { id: "agent-outside", name: "Outside primary" },
    assignments: [
      {
        id: "assignment-historical",
        agentId: ACTOR,
        role: "PARTICIPANT",
        assignedAt: new Date("2026-04-10T02:00:00.000Z"),
        removedAt: new Date("2026-04-10T12:00:00.000Z"),
        agent: { id: ACTOR, name: "Historical participant", role: "AGENT" },
      },
      {
        id: "assignment-outside-active",
        agentId: "agent-secret-participant",
        role: "PARTICIPANT",
        assignedAt: new Date("2026-04-10T03:00:00.000Z"),
        removedAt: null,
        agent: { id: "agent-secret-participant", name: "Secret participant", role: "AGENT" },
      },
      {
        id: "assignment-outside-observer",
        agentId: "agent-secret-observer",
        role: "OBSERVER",
        assignedAt: new Date("2026-04-10T03:00:00.000Z"),
        removedAt: null,
        agent: { id: "agent-secret-observer", name: "Secret observer", role: "AGENT" },
      },
    ],
    changeRequests: [],
    points: [],
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getMobileAuth).mockReturnValue(null)
  vi.mocked(resolveMobileAuth).mockResolvedValue(null)
  vi.mocked(requireAuth).mockResolvedValue({
    orgId: ORG,
    userId: "agent-user",
    agentId: ACTOR,
    role: "user",
    email: "agent@example.com",
    name: "Agent",
  } as never)
  vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ id: ACTOR, role: "AGENT" } as never)
  vi.mocked(prisma.mtmRoute.findFirst).mockResolvedValue(null)
  vi.mocked(prisma.mtmRoute.findMany).mockResolvedValue([])
  vi.mocked(prisma.mtmRoute.count).mockResolvedValue(0)
  vi.mocked(prisma.mtmSetting.findMany).mockResolvedValue([])
})

describe("MTM route exact drilldown scope", () => {
  it("returns a published route for a non-observer assignment active on its route day, outside list limits", async () => {
    vi.mocked(prisma.mtmRoute.findFirst).mockResolvedValue(route() as never)

    const response = await GET_DETAIL(
      request("/api/v1/mtm/routes/route-historical"),
      detailContext("route-historical"),
    )
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.data.id).toBe("route-historical")
    expect(json.data.agentId).toBeNull()
    expect(json.data.agent).toBeNull()
    expect(json.data.assignments).toEqual([])
    expect(json.data.hiddenAssignmentCount).toBe(2)
    expect(json.data.historicalAccessOnly).toBe(true)
    expect(json.data.travelPlan).toMatchObject({
      schemaVersion: 1,
      state: "NOT_CONFIGURED",
      reasonCode: "MTM_ROUTE_TRAVEL_PROVIDER_NOT_CONFIGURED",
      provider: null,
      source: {
        routeId: "route-historical",
        routeVersion: 3,
        orderedPointIds: [],
      },
      coordinateCoverage: { totalPoints: 0, locatedPoints: 0, missingPoints: 0 },
      manualOrder: { preserved: true, orderedPointIds: [] },
    })
    expect(JSON.stringify(json.data)).not.toContain("agent-outside")
    expect(JSON.stringify(json.data)).not.toContain("Outside primary")
    expect(JSON.stringify(json.data)).not.toContain("agent-secret-participant")
    expect(JSON.stringify(json.data)).not.toContain("Secret participant")
    expect(JSON.stringify(json.data)).not.toContain("agent-secret-observer")
    expect(JSON.stringify(json.data)).not.toContain("Secret observer")
    expect(prisma.mtmRoute.findMany).not.toHaveBeenCalled()
    expect(prisma.mtmRoute.count).not.toHaveBeenCalled()
    expect(prisma.mtmRoute.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: "route-historical",
        organizationId: ORG,
        OR: expect.any(Array),
      }),
      include: expect.objectContaining({
        assignments: expect.not.objectContaining({ where: { removedAt: null } }),
      }),
    }))
  })

  it("returns 404 for an exact route with no primary or assignment in current scope", async () => {
    vi.mocked(prisma.mtmRoute.findFirst).mockResolvedValue(route({
      id: "route-outside",
      assignments: [{
        id: "assignment-outside",
        agentId: "agent-outside-2",
        role: "PARTICIPANT",
        assignedAt: new Date("2026-04-10T02:00:00.000Z"),
        removedAt: null,
        agent: { id: "agent-outside-2", name: "Outside", role: "AGENT" },
      }],
    }) as never)

    const response = await GET_DETAIL(
      request("/api/v1/mtm/routes/route-outside"),
      detailContext("route-outside"),
    )

    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ code: "MTM_ROUTE_NOT_FOUND" })
  })

  it("does not treat removal at the tenant-local route-day boundary as historical access", async () => {
    vi.mocked(prisma.mtmRoute.findFirst).mockResolvedValue(route({
      id: "route-boundary",
      assignments: [{
        id: "assignment-boundary",
        agentId: ACTOR,
        role: "PARTICIPANT",
        assignedAt: new Date("2026-04-09T10:00:00.000Z"),
        // Asia/Baku 2026-04-10 starts at this UTC instant; removal is exclusive.
        removedAt: new Date("2026-04-09T20:00:00.000Z"),
        agent: { id: ACTOR, name: "Historical participant", role: "AGENT" },
      }],
    }) as never)

    const response = await GET_DETAIL(
      request("/api/v1/mtm/routes/route-boundary"),
      detailContext("route-boundary"),
    )

    expect(response.status).toBe(404)
  })

  it("does not authorize or serialize an active observer assignment", async () => {
    vi.mocked(prisma.mtmRoute.findFirst).mockResolvedValue(route({
      id: "route-observer",
      assignments: [{
        id: "assignment-observer",
        agentId: ACTOR,
        role: "OBSERVER",
        assignedAt: new Date("2026-04-10T02:00:00.000Z"),
        removedAt: null,
        agent: { id: ACTOR, name: "Observer identity", role: "AGENT" },
      }],
    }) as never)

    const response = await GET_DETAIL(
      request("/api/v1/mtm/routes/route-observer"),
      detailContext("route-observer"),
    )

    expect(response.status).toBe(404)
    expect(JSON.stringify(await response.json())).not.toContain("Observer identity")
  })

  it("fails closed before list facts when agentId is outside the fresh actor scope", async () => {
    const response = await GET_LIST(request("/api/v1/mtm/routes?agentId=agent-outside"))

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ code: "MTM_ROUTE_SCOPE_DENIED" })
    expect(prisma.mtmRoute.findMany).not.toHaveBeenCalled()
    expect(prisma.mtmRoute.count).not.toHaveBeenCalled()
  })
})
