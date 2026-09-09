import { describe, it, expect, vi, beforeEach } from "vitest"
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

import { GET, POST } from "@/app/api/v1/mtm/routes/route"
import { prisma } from "@/lib/prisma"
import { getOrgId, requireAuth } from "@/lib/api-auth"
import { getMobileAuth, resolveMobileAuth } from "@/lib/mobile-auth"

const ORG = "org-1"

const sampleRoute = {
  id: "route-1",
  organizationId: ORG,
  agentId: "agent-1",
  date: new Date("2026-04-10"),
  name: "Morning Run",
  notes: null,
  version: 1,
  publishedVersion: 1,
  publishedAt: new Date("2026-04-09T08:00:00.000Z"),
  totalPoints: 2,
  visitedPoints: 0,
  startedAt: null,
  completedAt: null,
  status: "PLANNED",
  updatedAt: new Date("2026-04-09T08:00:00.000Z"),
  agent: { id: "agent-1", name: "John" },
  assignments: [{
    agentId: "agent-1",
    role: "PRIMARY",
    assignedAt: new Date("2026-04-09T08:00:00.000Z"),
  }],
  points: [
    {
      id: "p1",
      routeId: "route-1",
      customerId: "c1",
      contactId: null,
      orderIndex: 0,
      status: "PENDING",
      version: 1,
      plannedTime: null,
      visitedAt: null,
      updatedAt: new Date("2026-04-09T08:00:00.000Z"),
      customer: { id: "c1", name: "Customer A", address: "Main St" },
    },
    {
      id: "p2",
      routeId: "route-1",
      customerId: "c2",
      contactId: null,
      orderIndex: 1,
      status: "PENDING",
      version: 1,
      plannedTime: null,
      visitedAt: null,
      updatedAt: new Date("2026-04-09T08:00:00.000Z"),
      customer: { id: "c2", name: "Customer B", address: "2nd Ave" },
    },
  ],
}

function createdRoute(overrides: Record<string, unknown> = {}) {
  return { ...sampleRoute, ...overrides }
}

function makeReq(url: string): NextRequest {
  return new NextRequest(new URL(url, "http://localhost:3000"))
}

function makePostReq(body: unknown): NextRequest {
  return new NextRequest(new URL("http://localhost:3000/api/v1/mtm/routes"), {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  })
}

function unauthorizedResponse(): Response {
  return new Response(JSON.stringify({ error: "Unauthorized" }), {
    status: 401,
    headers: { "content-type": "application/json" },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getMobileAuth).mockReturnValue(null)
  vi.mocked(resolveMobileAuth).mockResolvedValue(null)
  vi.mocked(requireAuth).mockResolvedValue({
    orgId: ORG,
    userId: "admin-user",
    role: "admin",
    email: "admin@example.com",
    name: "Admin",
  })
  vi.mocked(prisma.mtmAgent.findMany).mockResolvedValue([
    { id: "agent-1" },
    { id: "agent-legacy" },
    { id: "bad" },
  ] as any)
  vi.mocked(prisma.mtmCustomer.findMany).mockResolvedValue([
    { id: "c1" },
    { id: "c2" },
    { id: "customer-1" },
  ] as any)
  vi.mocked(prisma.mtmRoute.findFirst).mockResolvedValue(null)
  vi.mocked(prisma.mtmRoute.findMany).mockResolvedValue([])
})

// ─── GET /api/v1/mtm/routes ─────────────────────────────────
describe("GET /api/v1/mtm/routes", () => {
  it("returns 401 when not authenticated", async () => {
    vi.mocked(requireAuth).mockResolvedValue(unauthorizedResponse() as any)
    const res = await GET(makeReq("/api/v1/mtm/routes"))
    expect(res.status).toBe(401)
    const json = await res.json()
    expect(json.error).toBe("Unauthorized")
  })

  it("returns paginated routes", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG)
    vi.mocked(prisma.mtmRoute.findMany).mockResolvedValue([sampleRoute] as any)
    vi.mocked(prisma.mtmRoute.count).mockResolvedValue(1)

    const res = await GET(makeReq("/api/v1/mtm/routes"))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data.routes).toHaveLength(1)
    expect(json.data.total).toBe(1)
    expect(json.data.page).toBe(1)
    expect(json.data.limit).toBe(50)
    expect(json.data.capabilities).toEqual({
      canCreateRoute: true,
      canPublish: true,
      canReview: true,
      canRequestCustomer: false,
      actorAgentId: null,
    })
  })

  it("accepts a revoked-checked mobile JWT and scopes routes to that agent", async () => {
    const mobileAuth = {
      orgId: ORG,
      agentId: "agent-mobile",
      userId: "",
      role: "AGENT",
      email: "agent@example.com",
      name: "Mobile Agent",
      tenantCapabilities: { routeField: true, workforceHrm: false },
    }
    vi.mocked(getMobileAuth).mockReturnValue(mobileAuth)
    vi.mocked(resolveMobileAuth).mockResolvedValue(mobileAuth)
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ id: "agent-mobile", role: "AGENT" } as any)
    vi.mocked(prisma.mtmRoute.count).mockResolvedValue(0)

    const res = await GET(new NextRequest("http://localhost:3000/api/v1/mtm/routes", {
      headers: { authorization: "Bearer mobile-token" },
    }))

    expect(res.status).toBe(200)
    expect(requireAuth).not.toHaveBeenCalled()
    expect(prisma.mtmRoute.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        organizationId: ORG,
        OR: [
          { agentId: { in: ["agent-mobile"] } },
          { assignments: { some: { agentId: { in: ["agent-mobile"] }, removedAt: null } } },
        ],
      }),
    }))
  })

  it("reports self-planning as disabled for a field agent blocked by an administrator", async () => {
    const mobileAuth = {
      orgId: ORG,
      agentId: "agent-mobile",
      userId: "",
      role: "AGENT",
      email: "agent@example.com",
      name: "Mobile Agent",
      tenantCapabilities: { routeField: true, workforceHrm: false },
    }
    vi.mocked(getMobileAuth).mockReturnValue(mobileAuth)
    vi.mocked(resolveMobileAuth).mockResolvedValue(mobileAuth)
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({
      id: "agent-mobile",
      role: "AGENT",
      canPlanOwnRoutes: false,
      canSelfPublishRoutes: true,
    } as any)
    vi.mocked(prisma.mtmRoute.count).mockResolvedValue(0)

    const response = await GET(new NextRequest("http://localhost:3000/api/v1/mtm/routes", {
      headers: { authorization: "Bearer mobile-token" },
    }))
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.data.capabilities).toMatchObject({
      canCreateRoute: false,
      canPublish: false,
      actorAgentId: "agent-mobile",
    })
  })

  it("does not advertise self-publishing until that individual agent is granted it", async () => {
    const mobileAuth = {
      orgId: ORG,
      agentId: "agent-mobile",
      userId: "",
      role: "AGENT",
      email: "agent@example.com",
      name: "Mobile Agent",
      tenantCapabilities: { routeField: true, workforceHrm: false },
    }
    vi.mocked(getMobileAuth).mockReturnValue(mobileAuth)
    vi.mocked(resolveMobileAuth).mockResolvedValue(mobileAuth)
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({
      id: "agent-mobile",
      role: "AGENT",
      canPlanOwnRoutes: true,
      canSelfPublishRoutes: false,
    } as any)
    vi.mocked(prisma.mtmSetting.findUnique).mockResolvedValue({ value: true } as any)
    vi.mocked(prisma.mtmRoute.count).mockResolvedValue(0)

    const deniedPayload = await (await GET(new NextRequest("http://localhost:3000/api/v1/mtm/routes", {
      headers: { authorization: "Bearer mobile-token" },
    }))).json()

    expect(deniedPayload.data.capabilities.canPublish).toBe(false)

    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({
      id: "agent-mobile",
      role: "AGENT",
      canPlanOwnRoutes: true,
      canSelfPublishRoutes: true,
    } as any)

    const grantedPayload = await (await GET(new NextRequest("http://localhost:3000/api/v1/mtm/routes", {
      headers: { authorization: "Bearer mobile-token" },
    }))).json()

    expect(grantedPayload.data.capabilities.canPublish).toBe(true)
  })

  it("preserves the legacy top-level primary agent contract", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG)
    vi.mocked(prisma.mtmRoute.findMany).mockResolvedValue([sampleRoute] as any)
    vi.mocked(prisma.mtmRoute.count).mockResolvedValue(1)

    const res = await GET(makeReq("/api/v1/mtm/routes?agentId=agent-1"))
    const json = await res.json()

    expect(json.data.routes[0]).toMatchObject({
      agentId: "agent-1",
      agent: { id: "agent-1", name: "John" },
    })
  })

  it("orders by date DESC then createdAt DESC (regression: stale-route picked when two routes share a date)", async () => {
    // Before commit 3b7b1978 this was only `{ date: "desc" }`. With two
    // PLANNED routes for the same day, in-day ordering was undefined,
    // and mobile's ASC re-sort then picked the older route. This test
    // pins the explicit tiebreaker so a future refactor can't silently
    // regress to the broken state.
    vi.mocked(getOrgId).mockResolvedValue(ORG)
    vi.mocked(prisma.mtmRoute.findMany).mockResolvedValue([])
    vi.mocked(prisma.mtmRoute.count).mockResolvedValue(0)

    await GET(makeReq("/api/v1/mtm/routes"))

    const callArgs = vi.mocked(prisma.mtmRoute.findMany).mock.calls[0][0] as any
    expect(callArgs.orderBy).toEqual([{ date: "desc" }, { createdAt: "desc" }])
  })

  it("filters by agentId", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG)
    vi.mocked(prisma.mtmRoute.findMany).mockResolvedValue([])
    vi.mocked(prisma.mtmRoute.count).mockResolvedValue(0)

    await GET(makeReq("/api/v1/mtm/routes?agentId=agent-1"))

    const callArgs = vi.mocked(prisma.mtmRoute.findMany).mock.calls[0][0] as any
    expect(callArgs.where.AND).toEqual([{
      OR: [
        { agentId: "agent-1" },
        { assignments: { some: { agentId: "agent-1", removedAt: null } } },
      ],
    }])
  })

  it("filters by status", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG)
    vi.mocked(prisma.mtmRoute.findMany).mockResolvedValue([])
    vi.mocked(prisma.mtmRoute.count).mockResolvedValue(0)

    await GET(makeReq("/api/v1/mtm/routes?status=COMPLETED"))

    const callArgs = vi.mocked(prisma.mtmRoute.findMany).mock.calls[0][0] as any
    expect(callArgs.where.status).toBe("COMPLETED")
  })

  it("filters by date with day range", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG)
    vi.mocked(prisma.mtmRoute.findMany).mockResolvedValue([])
    vi.mocked(prisma.mtmRoute.count).mockResolvedValue(0)

    await GET(makeReq("/api/v1/mtm/routes?date=2026-04-10"))

    const callArgs = vi.mocked(prisma.mtmRoute.findMany).mock.calls[0][0] as any
    expect(callArgs.where.date.gte).toEqual(new Date("2026-04-10"))
    expect(callArgs.where.date.lt).toEqual(new Date("2026-04-11"))
  })

  it("filters a bounded calendar range without changing route scope", async () => {
    vi.mocked(prisma.mtmRoute.findMany).mockResolvedValue([])
    vi.mocked(prisma.mtmRoute.count).mockResolvedValue(0)

    const response = await GET(makeReq("/api/v1/mtm/routes?start=2026-04-01&endExclusive=2026-05-01&limit=200"))

    expect(response.status).toBe(200)
    const callArgs = vi.mocked(prisma.mtmRoute.findMany).mock.calls[0][0] as any
    expect(callArgs.where).toMatchObject({
      organizationId: ORG,
      date: {
        gte: new Date("2026-04-01T00:00:00.000Z"),
        lt: new Date("2026-05-01T00:00:00.000Z"),
      },
    })
  })

  it.each([
    "/api/v1/mtm/routes?start=2026-04-01",
    "/api/v1/mtm/routes?start=2026-05-01&endExclusive=2026-04-01",
    "/api/v1/mtm/routes?date=2026-04-10&start=2026-04-01&endExclusive=2026-05-01",
    "/api/v1/mtm/routes?start=2026-04-31&endExclusive=2026-05-02",
  ])("rejects an invalid or ambiguous calendar range: %s", async (url) => {
    const response = await GET(makeReq(url))

    expect(response.status).toBe(400)
    expect(prisma.mtmRoute.findMany).not.toHaveBeenCalled()
  })

  it("respects page and limit params", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG)
    vi.mocked(prisma.mtmRoute.findMany).mockResolvedValue([])
    vi.mocked(prisma.mtmRoute.count).mockResolvedValue(100)

    const res = await GET(makeReq("/api/v1/mtm/routes?page=3&limit=10"))
    const json = await res.json()
    expect(json.data.page).toBe(3)
    expect(json.data.limit).toBe(10)

    const callArgs = vi.mocked(prisma.mtmRoute.findMany).mock.calls[0][0] as any
    expect(callArgs.skip).toBe(20) // (3-1)*10
    expect(callArgs.take).toBe(10)
  })

  it("clamps limit to max 200", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG)
    vi.mocked(prisma.mtmRoute.findMany).mockResolvedValue([])
    vi.mocked(prisma.mtmRoute.count).mockResolvedValue(0)

    await GET(makeReq("/api/v1/mtm/routes?limit=999"))

    const callArgs = vi.mocked(prisma.mtmRoute.findMany).mock.calls[0][0] as any
    expect(callArgs.take).toBe(200)
  })

  it("returns 500 on prisma error (was silent-success — fixed by F-05)", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG)
    vi.mocked(prisma.mtmRoute.findMany).mockRejectedValue(new Error("DB error"))
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {})

    const res = await GET(makeReq("/api/v1/mtm/routes"))
    const json = await res.json()
    expect(res.status).toBe(500)
    expect(json.error).toBeDefined()
    expect(consoleErrorSpy).toHaveBeenCalled()
    consoleErrorSpy.mockRestore()
  })
})

// ─── POST /api/v1/mtm/routes ────────────────────────────────
describe("POST /api/v1/mtm/routes", () => {
  it("returns 401 when not authenticated", async () => {
    vi.mocked(requireAuth).mockResolvedValue(unauthorizedResponse() as any)
    const res = await POST(makePostReq({ agentId: "a1", date: "2026-04-10" }))
    expect(res.status).toBe(401)
  })

  it("creates a route with points and returns 201", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG)
    vi.mocked(prisma.mtmRoute.create).mockResolvedValue(createdRoute({
      id: "new-route",
      points: sampleRoute.points.map((point) => ({ ...point, routeId: "new-route" })),
    }) as any)

    const body = {
      agentId: "agent-1",
      date: "2026-04-10",
      name: "Morning Run",
      points: [
        { customerId: "c1", plannedTime: "2026-04-10T09:00:00Z" },
        { customerId: "c2" },
      ],
    }

    const res = await POST(makePostReq(body))
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.success).toBe(true)

    const createArgs = vi.mocked(prisma.mtmRoute.create).mock.calls[0][0] as any
    expect(createArgs.data.organizationId).toBe(ORG)
    expect(createArgs.data.agentId).toBe("agent-1")
    expect(createArgs.data.status).toBe("PLANNED")
    expect(createArgs.data.publishedVersion).toBe(1)
    expect(createArgs.data.assignments.create).toEqual([
      expect.objectContaining({ agentId: "agent-1", role: "PRIMARY" }),
    ])
    expect(createArgs.data.totalPoints).toBe(2)
    expect(createArgs.data.points.create).toHaveLength(2)
    expect(createArgs.data.points.create[0].orderIndex).toBe(0)
    expect(createArgs.data.points.create[1].orderIndex).toBe(1)
    expect(prisma.mtmRouteNotificationOutbox.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        agentId: "agent-1",
        metadata: expect.objectContaining({ routeId: "new-route", publishedVersion: 1 }),
      }),
      update: {},
    }))
    // Canonical mobile-sync v2 uses database triggers for route journal
    // emission. The route writer must not duplicate those writes here.
    expect(prisma.mtmMobileSyncChange.create).not.toHaveBeenCalled()
    expect(prisma.mtmMobileSyncScopeRevision.upsert).not.toHaveBeenCalled()
  })

  it("creates a route without points", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG)
    vi.mocked(prisma.mtmRoute.create).mockResolvedValue(createdRoute({ id: "r2", totalPoints: 0, points: [] }) as any)

    const body = { agentId: "agent-1", date: "2026-04-10" }
    const res = await POST(makePostReq(body))
    expect(res.status).toBe(201)

    const createArgs = vi.mocked(prisma.mtmRoute.create).mock.calls[0][0] as any
    expect(createArgs.data.totalPoints).toBe(0)
    expect(createArgs.data.points).toBeUndefined()
  })

  it("rejects a mobile route target outside the selected agent's effective assignments", async () => {
    const mobileAuth = {
      orgId: ORG,
      agentId: "agent-mobile",
      userId: "",
      role: "AGENT",
      email: "agent@example.com",
      name: "Mobile Agent",
      tenantCapabilities: { routeField: true, workforceHrm: false },
    }
    vi.mocked(getMobileAuth).mockReturnValue(mobileAuth)
    vi.mocked(resolveMobileAuth).mockResolvedValue(mobileAuth)
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({
      id: "agent-mobile",
      role: "AGENT",
      canPlanOwnRoutes: true,
    } as any)
    vi.mocked(prisma.mtmAgent.findMany).mockResolvedValue([{ id: "agent-mobile" }] as any)
    // The validator asks mtmCustomer twice and the questions differ: which
    // targets exist, and which the SHARED eligibility accepts. This customer
    // has neither an assignment nor an actionable route, so the second answer
    // is empty and the stop must still be refused.
    vi.mocked(prisma.mtmCustomer.findMany).mockImplementation(((args: { where?: { AND?: unknown } }) =>
      Promise.resolve(args?.where?.AND ? [] : [{ id: "customer-1", agentAssignments: [] }])) as any)

    const response = await POST(makePostReq({
      agentId: "agent-mobile",
      date: "2026-04-10",
      points: [{ customerId: "customer-1" }],
    }))

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ code: "MTM_ROUTE_TARGET_ASSIGNMENT_REQUIRED" })
    expect(prisma.mtmRoute.create).not.toHaveBeenCalled()
  })

  it("creates separate doctor stops at the same clinic", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG)
    vi.mocked(prisma.mtmAgent.findMany).mockResolvedValue([{ id: "agent-1" }] as any)
    vi.mocked(prisma.mtmCustomer.findMany).mockResolvedValue([{ id: "clinic-1" }] as any)
    vi.mocked(prisma.mtmContact.findMany).mockResolvedValue([
      { id: "doctor-1", workplaces: [{ customerId: "clinic-1" }] },
      { id: "doctor-2", workplaces: [{ customerId: "clinic-1" }] },
    ] as any)
    vi.mocked(prisma.mtmRoute.create).mockResolvedValue(createdRoute({ id: "doctor-route", totalPoints: 2 }) as any)

    const res = await POST(makePostReq({
      date: "2026-04-10",
      assignments: [{ agentId: "agent-1", role: "PRIMARY" }],
      points: [
        { customerId: "clinic-1", contactId: "doctor-1" },
        { customerId: "clinic-1", contactId: "doctor-2" },
      ],
    }))

    expect(res.status).toBe(201)
    const createArgs = vi.mocked(prisma.mtmRoute.create).mock.calls[0][0] as any
    expect(createArgs.data.points.create).toEqual([
      expect.objectContaining({ customerId: "clinic-1", contactId: "doctor-1", orderIndex: 0 }),
      expect.objectContaining({ customerId: "clinic-1", contactId: "doctor-2", orderIndex: 1 }),
    ])
  })

  it("accepts the legacy single-agent create payload", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG)
    vi.mocked(prisma.mtmRoute.create).mockResolvedValue(createdRoute({
      id: "legacy-route",
      agentId: "agent-legacy",
      assignments: [{ agentId: "agent-legacy", role: "PRIMARY", assignedAt: new Date("2026-04-09T08:00:00.000Z") }],
      points: sampleRoute.points.map((point) => ({ ...point, routeId: "legacy-route" })),
    }) as any)

    const res = await POST(makePostReq({
      agentId: "agent-legacy",
      date: "2026-04-10",
      points: [{ customerId: "customer-1" }],
    }))

    expect(res.status).toBe(201)
    expect(prisma.mtmRoute.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ agentId: "agent-legacy" }),
    }))
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1)
  })

  it("blocks a legacy planned route when its agent is already busy", async () => {
    vi.mocked(prisma.mtmRoute.findMany).mockResolvedValue([{
      id: "existing-route",
      status: "PLANNED",
      agentId: "agent-legacy",
      assignments: [],
      points: [{ customerId: "c2", plannedTime: new Date("2026-04-10T09:00:00.000Z"), deletedAt: null }],
    }] as any)

    const res = await POST(makePostReq({
      agentId: "agent-legacy",
      date: "2026-04-10",
      points: [{ customerId: "customer-1", plannedTime: "2026-04-10T09:00:00.000Z" }],
    }))

    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({
      code: "ROUTE_CONFLICT",
      conflicts: [{ code: "AGENT_SCHEDULE_CONFLICT", routeId: "existing-route" }],
    })
    expect(prisma.$transaction).toHaveBeenCalledTimes(1)
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1)
    expect(prisma.mtmRoute.create).not.toHaveBeenCalled()
  })

  it("blocks duplicate meeting times when a legacy client publishes directly", async () => {
    const res = await POST(makePostReq({
      agentId: "agent-legacy",
      date: "2026-04-10",
      points: [
        { customerId: "c1", plannedTime: "2026-04-10T09:00:00.000Z" },
        { customerId: "c2", plannedTime: "2026-04-10T09:00:00Z" },
      ],
    }))

    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({
      code: "ROUTE_POINT_TIME_CONFLICT",
      conflicts: [{ plannedTime: "2026-04-10T09:00:00.000Z", pointIndexes: [0, 1] }],
    })
    expect(prisma.mtmRoute.create).not.toHaveBeenCalled()
  })

  it("creates a new multi-agent payload as DRAFT and returns conflicts separately", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG)
    vi.mocked(prisma.mtmAgent.findMany).mockResolvedValue([
      { id: "agent-1" },
      { id: "agent-2" },
    ] as any)
    vi.mocked(prisma.mtmRoute.findMany).mockResolvedValue([{
      id: "existing-route",
      status: "PLANNED",
      agentId: "agent-2",
      assignments: [],
      points: [{ customerId: "customer-1", plannedTime: new Date("2026-04-10T09:00:00.000Z"), deletedAt: null }],
    }] as any)
    vi.mocked(prisma.mtmRoute.create).mockResolvedValue(createdRoute({
      id: "draft-route",
      status: "DRAFT",
      publishedVersion: null,
      publishedAt: null,
      totalPoints: 1,
      assignments: [
        { agentId: "agent-1", role: "PRIMARY", assignedAt: new Date("2026-04-09T08:00:00.000Z") },
        { agentId: "agent-2", role: "PARTICIPANT", assignedAt: new Date("2026-04-09T08:00:00.000Z") },
      ],
      points: [sampleRoute.points[0]],
    }) as any)

    const res = await POST(makePostReq({
      date: "2026-04-10",
      assignments: [
        { agentId: "agent-1", role: "PRIMARY" },
        { agentId: "agent-2", role: "PARTICIPANT" },
      ],
      points: [{ customerId: "customer-1", plannedTime: "2026-04-10T09:00:00.000Z" }],
    }))

    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.meta.conflicts).toEqual([
      { code: "AGENT_SCHEDULE_CONFLICT", routeId: "existing-route", agentIds: ["agent-2"] },
    ])
    expect(json.meta.coordination).toEqual([])
    const createArgs = vi.mocked(prisma.mtmRoute.create).mock.calls[0][0] as any
    expect(createArgs.data.status).toBe("DRAFT")
    expect(createArgs.data.publishedVersion).toBeNull()
    expect(createArgs.data.assignments.create).toHaveLength(2)
    expect(prisma.mtmRouteNotificationOutbox.upsert).not.toHaveBeenCalled()
    expect(prisma.$executeRaw).not.toHaveBeenCalled()
  })

  it("returns a non-blocking coordination notice when another agent meets the same customer at the same time", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG)
    vi.mocked(prisma.mtmAgent.findMany).mockResolvedValue([
      { id: "agent-1" },
      { id: "agent-2" },
    ] as any)
    vi.mocked(prisma.mtmRoute.findMany).mockResolvedValue([{
      id: "colleague-route",
      status: "PLANNED",
      agentId: "agent-2",
      assignments: [],
      points: [{ customerId: "customer-1", plannedTime: new Date("2026-04-10T09:00:00.000Z"), deletedAt: null }],
    }] as any)
    vi.mocked(prisma.mtmRoute.create).mockResolvedValue(createdRoute({
      id: "draft-route",
      status: "DRAFT",
      publishedVersion: null,
      publishedAt: null,
      totalPoints: 1,
      points: [sampleRoute.points[0]],
    }) as any)

    const res = await POST(makePostReq({
      date: "2026-04-10",
      assignments: [{ agentId: "agent-1", role: "PRIMARY" }],
      points: [{ customerId: "customer-1", plannedTime: "2026-04-10T09:00:00.000Z" }],
    }))

    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.meta).toEqual({
      conflicts: [],
      coordination: [{
        code: "COORDINATED_MEETING",
        routeId: "colleague-route",
        agentIds: ["agent-2"],
        customerIds: ["customer-1"],
        contactIds: [],
        plannedTimes: ["2026-04-10T09:00:00.000Z"],
      }],
    })
  })

  it("returns ROUTE_DUPLICATE before creating an exact duplicate", async () => {
    vi.mocked(prisma.mtmRoute.findFirst).mockResolvedValue({
      id: "existing-route",
      name: "Existing",
      date: new Date("2026-04-10"),
      status: "DRAFT",
    } as any)

    const res = await POST(makePostReq({ agentId: "agent-1", date: "2026-04-10" }))
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({
      code: "ROUTE_DUPLICATE",
      duplicate: { id: "existing-route" },
    })
    expect(prisma.mtmRoute.create).not.toHaveBeenCalled()
  })

  it("blocks a non-working route date when calendar enforcement is enabled", async () => {
    vi.mocked(prisma.mtmSetting.findMany).mockResolvedValue([{
      key: "enforceWorkCalendarForRoutes",
      value: true,
    }] as any)
    vi.mocked(prisma.mtmAgent.findMany).mockResolvedValue([{
      id: "agent-1",
      teamId: "team-1",
    }] as any)

    const response = await POST(makePostReq({ agentId: "agent-1", date: "2026-04-11" }))
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({
      code: "MTM_ROUTE_NON_WORKING_DAY",
      calendarDay: {
        date: "2026-04-11",
        kind: "WEEKEND",
        routePlanningAllowed: false,
      },
    })
    expect(prisma.mtmRoute.create).not.toHaveBeenCalled()
  })

  it("rejects references to agents outside the organization", async () => {
    vi.mocked(prisma.mtmAgent.findMany).mockResolvedValue([])
    const res = await POST(makePostReq({ agentId: "outside-agent", date: "2026-04-10" }))
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({
      code: "MTM_ROUTE_REFERENCE_INVALID",
      details: { missingAgentIds: ["outside-agent"] },
    })
  })

  it("returns 400 on create failure", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG)
    vi.mocked(prisma.mtmRoute.create).mockRejectedValue(new Error("FK violation"))

    const res = await POST(makePostReq({ agentId: "bad", date: "2026-04-10" }))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBe("FK violation")
  })
})
