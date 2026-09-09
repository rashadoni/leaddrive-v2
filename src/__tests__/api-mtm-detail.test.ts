import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

// ── Mocks ───────────────────────────────────────────────────────────────────

vi.mock("@/lib/prisma", async () => {
  const { makeMtmPrismaMock } = await import("./mocks/mtm-prisma")
  return { prisma: makeMtmPrismaMock() }
})

vi.mock("@/lib/api-auth", () => ({
  getOrgId: vi.fn(),
  requireAuth: vi.fn(),
  isAuthError: (value: unknown) => value instanceof Response,
}))

vi.mock("@/lib/mobile-auth", async () => {
  const { makeMobileAuthMock } = await import("./mocks/mobile-auth")
  return makeMobileAuthMock()
})

vi.mock("@/lib/geo-utils", () => ({
  calculateDistance: vi.fn(() => 150),
}))

import { prisma } from "@/lib/prisma"
import { getOrgId, requireAuth } from "@/lib/api-auth"
import { getMobileAuth, resolveMobileAuth } from "@/lib/mobile-auth"

const ORG = "org-1"

function routeMobileAuth(agentId: string, role = "AGENT", workforceHrm = true) {
  return {
    orgId: ORG,
    agentId,
    role,
    tenantCapabilities: { routeField: true, workforceHrm },
  }
}

function makeReq(url: string, method = "GET"): NextRequest {
  return new NextRequest(new URL(url, "http://localhost:3000"), { method })
}

function makeJsonReq(url: string, body: unknown, method = "PUT"): NextRequest {
  return new NextRequest(new URL(url, "http://localhost:3000"), {
    method,
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  })
}

function params(id: string) {
  return { params: Promise.resolve({ id }) }
}

beforeEach(() => {
  vi.clearAllMocks()
  // vi.clearAllMocks() clears calls, not implementations: a mockResolvedValue
  // set inside one test would otherwise leak into every test after it. The
  // honest default is "this shift has no pause events".
  vi.mocked(prisma.mtmAgentWorkdayEvent.findMany).mockResolvedValue([] as never)
  vi.mocked(getMobileAuth).mockReturnValue(null)
  vi.mocked(resolveMobileAuth).mockResolvedValue(null)
  vi.mocked(requireAuth).mockResolvedValue({
    orgId: ORG,
    userId: "admin-user",
    role: "admin",
    email: "admin@example.com",
    name: "Admin",
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// MTM Routes [id]
// ═══════════════════════════════════════════════════════════════════════════

describe("GET /api/v1/mtm/routes/[id]", () => {
  let GET: typeof import("@/app/api/v1/mtm/routes/[id]/route").GET
  beforeEach(async () => {
    GET = (await import("@/app/api/v1/mtm/routes/[id]/route")).GET
  })

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(requireAuth).mockResolvedValue(new Response(null, { status: 401 }) as any)
    const res = await GET(makeReq("/api/v1/mtm/routes/r1"), params("r1"))
    expect(res.status).toBe(401)
  })

  it("returns 404 when route not found", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG)
    vi.mocked(prisma.mtmRoute.findFirst).mockResolvedValue(null)
    const res = await GET(makeReq("/api/v1/mtm/routes/r1"), params("r1"))
    expect(res.status).toBe(404)
  })

  it("returns route with distance annotations", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG)
    vi.mocked(prisma.mtmRoute.findFirst).mockResolvedValue({
      id: "r1",
      organizationId: ORG,
      agentId: "a1",
      status: "PLANNED",
      date: new Date("2026-07-13T00:00:00.000Z"),
      publishedVersion: null,
      assignments: [],
      points: [{ id: "p1", customer: { latitude: 40.4, longitude: 49.8 } }],
    } as any)

    const res = await GET(makeReq("/api/v1/mtm/routes/r1?latitude=40.5&longitude=49.9"), params("r1"))
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data.points[0].distanceMeters).toBe(150)
  })
})

describe("PUT /api/v1/mtm/routes/[id]", () => {
  let PUT: typeof import("@/app/api/v1/mtm/routes/[id]/route").PUT
  beforeEach(async () => {
    PUT = (await import("@/app/api/v1/mtm/routes/[id]/route")).PUT
  })

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(requireAuth).mockResolvedValue(new Response(null, { status: 401 }) as any)
    const res = await PUT(makeJsonReq("/api/v1/mtm/routes/r1", { agentId: "a1", date: "2026-04-10" }), params("r1"))
    expect(res.status).toBe(401)
  })

  it("updates route and replaces points", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG)
    // Handler now does findFirst → exists check → updateMany. Test mocked
    // updateMany but skipped findFirst, so the handler returned 404 on
    // "not-found" path even when test mocked updateMany rows count=1.
    // Stub findFirst to a non-null row so handler proceeds to update.
    vi.mocked(prisma.mtmRoute.findFirst)
      .mockResolvedValueOnce({
        id: "r1",
        agentId: "a1",
        date: new Date("2026-04-10"),
        status: "DRAFT",
        version: 1,
        updatedAt: new Date("2026-04-09T12:00:00.000Z"),
        totalPoints: 0,
        assignments: [{ agentId: "a1", role: "PRIMARY" }],
        points: [],
      } as any)
      .mockResolvedValueOnce(null)
    vi.mocked(prisma.mtmAgent.findMany).mockResolvedValue([{ id: "a1" }] as any)
    vi.mocked(prisma.mtmCustomer.findMany).mockResolvedValue([{ id: "c1" }, { id: "c2" }] as any)
    vi.mocked(prisma.mtmRoute.updateMany).mockResolvedValue({ count: 1 } as any)
    // M2-1d soft-delete: PUT cascades to mtmRoutePoint.updateMany
    vi.mocked(prisma.mtmRoutePoint.updateMany).mockResolvedValue({ count: 0 } as any)
    vi.mocked(prisma.mtmRoutePoint.createMany).mockResolvedValue({ count: 2 } as any)

    const res = await PUT(
      makeJsonReq("/api/v1/mtm/routes/r1", { expectedVersion: 1, agentId: "a1", date: "2026-04-10", points: [{ customerId: "c1" }, { customerId: "c2" }] }),
      params("r1"),
    )
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data).toEqual({ id: "r1", version: 2 })
    expect(prisma.mtmRoutePoint.createMany).toHaveBeenCalled()
    // Canonical v2 database triggers journal route and point mutations. The
    // application handler must not maintain the retired manual journal.
    expect(prisma.mtmMobileSyncChange.create).not.toHaveBeenCalled()
  })

  it("persists a draft route date change for canonical database-trigger sync", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG)
    vi.mocked(prisma.mtmRoute.findFirst)
      .mockResolvedValueOnce({
        id: "r1",
        agentId: "a1",
        date: new Date("2026-04-10T00:00:00.000Z"),
        status: "DRAFT",
        version: 1,
        updatedAt: new Date("2026-04-09T12:00:00.000Z"),
        totalPoints: 0,
        assignments: [{ agentId: "a1", role: "PRIMARY" }],
        points: [],
      } as any)
      .mockResolvedValueOnce(null)
    vi.mocked(prisma.mtmAgent.findMany).mockResolvedValue([{ id: "a1" }] as any)
    vi.mocked(prisma.mtmRoute.updateMany).mockResolvedValue({ count: 1 } as any)

    const response = await PUT(
      makeJsonReq("/api/v1/mtm/routes/r1", {
        expectedVersion: 1,
        date: "2026-04-17",
      }),
      params("r1"),
    )

    expect(response.status).toBe(200)
    expect(prisma.mtmRoute.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ date: new Date("2026-04-17") }),
    }))
    expect(prisma.mtmMobileSyncScopeRevision.upsert).not.toHaveBeenCalled()
  })

  it("lets a revoked-checked mobile agent reorder their own draft route", async () => {
    const mobileAuth = {
      orgId: ORG,
      agentId: "agent-mobile",
      userId: "",
      role: "AGENT",
      email: "agent@example.com",
      name: "Mobile Agent",
      tenantCapabilities: { routeField: true, workforceHrm: true },
    }
    vi.mocked(getMobileAuth).mockReturnValue(mobileAuth)
    vi.mocked(resolveMobileAuth).mockResolvedValue(mobileAuth)
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ id: "agent-mobile", role: "AGENT" } as never)
    vi.mocked(prisma.mtmRoute.findFirst)
      .mockResolvedValueOnce({
        id: "r1",
        agentId: "agent-mobile",
        date: new Date("2026-04-10"),
        status: "DRAFT",
        version: 5,
        updatedAt: new Date("2026-04-09T12:00:00.000Z"),
        totalPoints: 2,
        assignments: [{ agentId: "agent-mobile", role: "PRIMARY" }],
        points: [
          { id: "p1", customerId: "c1", plannedTime: null, orderIndex: 0, status: "PENDING" },
          { id: "p2", customerId: "c2", plannedTime: null, orderIndex: 1, status: "PENDING" },
        ],
      } as never)
      .mockResolvedValueOnce(null)
    vi.mocked(prisma.mtmAgent.findMany).mockResolvedValue([{ id: "agent-mobile", teamId: null }] as never)
    vi.mocked(prisma.mtmCustomer.findMany).mockResolvedValue([{ id: "c1" }, { id: "c2" }] as never)
    vi.mocked(prisma.mtmRoute.updateMany).mockResolvedValue({ count: 1 } as never)
    vi.mocked(prisma.mtmRoutePoint.updateMany).mockResolvedValue({ count: 2 } as never)
    vi.mocked(prisma.mtmRoutePoint.createMany).mockResolvedValue({ count: 2 } as never)

    const response = await PUT(
      makeJsonReq("/api/v1/mtm/routes/r1", {
        expectedVersion: 5,
        name: "Reordered in field",
        points: [{ customerId: "c2" }, { customerId: "c1" }],
      }),
      params("r1"),
    )

    expect(response.status).toBe(200)
    expect(requireAuth).not.toHaveBeenCalled()
    expect(prisma.mtmRoutePoint.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: [
        expect.objectContaining({ customerId: "c2", orderIndex: 0 }),
        expect.objectContaining({ customerId: "c1", orderIndex: 1 }),
      ],
    }))
    expect(prisma.mtmMobileSyncChange.create).not.toHaveBeenCalled()
  })

  it("persists a draft participant removal for canonical database-trigger tombstones", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG)
    vi.mocked(prisma.mtmRoute.findFirst)
      .mockResolvedValueOnce({
        id: "r1",
        agentId: "a1",
        date: new Date("2026-04-10"),
        status: "DRAFT",
        version: 1,
        updatedAt: new Date("2026-04-09T12:00:00.000Z"),
        totalPoints: 1,
        assignments: [
          { agentId: "a1", role: "PRIMARY" },
          { agentId: "a2", role: "OBSERVER" },
        ],
        points: [{ id: "p1", customerId: "c1", contactId: null, plannedTime: null, orderIndex: 0, status: "PENDING" }],
      } as any)
      .mockResolvedValueOnce(null)
    vi.mocked(prisma.mtmAgent.findMany).mockResolvedValue([{ id: "a1" }] as any)
    vi.mocked(prisma.mtmCustomer.findMany).mockResolvedValue([{ id: "c1" }] as any)
    vi.mocked(prisma.mtmRoute.updateMany).mockResolvedValue({ count: 1 } as any)

    const response = await PUT(
      makeJsonReq("/api/v1/mtm/routes/r1", {
        expectedVersion: 1,
        assignments: [{ agentId: "a1", role: "PRIMARY" }],
      }),
      params("r1"),
    )

    expect(response.status).toBe(200)
    expect(prisma.mtmRouteAssignment.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ routeId: "r1", organizationId: ORG, removedAt: null }),
    }))
    expect(prisma.mtmRouteAssignment.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { routeId_agentId: { routeId: "r1", agentId: "a1" } },
    }))
    expect(prisma.mtmMobileSyncChange.create).not.toHaveBeenCalled()
    expect(prisma.mtmMobileSyncScopeRevision.upsert).not.toHaveBeenCalled()
  })

  it("blocks a mobile agent from adding an unassigned draft stop", async () => {
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
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ id: "agent-mobile", role: "AGENT" } as never)
    vi.mocked(prisma.mtmRoute.findFirst).mockResolvedValue({
      id: "r1",
      agentId: "agent-mobile",
      date: new Date("2026-04-10"),
      status: "DRAFT",
      version: 5,
      updatedAt: new Date("2026-04-09T12:00:00.000Z"),
      totalPoints: 1,
      assignments: [{ agentId: "agent-mobile", role: "PRIMARY" }],
      points: [{ id: "p1", customerId: "assigned-customer", contactId: null, plannedTime: null, orderIndex: 0, status: "PENDING" }],
    } as never)
    vi.mocked(prisma.mtmAgent.findMany).mockResolvedValue([{ id: "agent-mobile", teamId: null }] as never)
    // The validator asks mtmCustomer twice, and the two questions differ:
    // which targets exist, then which the SHARED eligibility accepts. Only the
    // assigned customer passes the second one — nothing ties the other to this
    // agent, neither an assignment nor an actionable route — so the stop is
    // still refused. Answering both with one list would let it through.
    vi.mocked(prisma.mtmCustomer.findMany).mockImplementation(((args: { where?: { AND?: unknown } }) =>
      Promise.resolve(args?.where?.AND
        ? [{ id: "assigned-customer" }]
        : [
            { id: "assigned-customer", agentAssignments: [{ id: "assignment-1" }] },
            { id: "unassigned-customer", agentAssignments: [] },
          ])) as never)

    const response = await PUT(
      makeJsonReq("/api/v1/mtm/routes/r1", {
        expectedVersion: 5,
        points: [{ customerId: "assigned-customer" }, { customerId: "unassigned-customer" }],
      }),
      params("r1"),
    )

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ code: "MTM_ROUTE_TARGET_ASSIGNMENT_REQUIRED" })
    expect(prisma.mtmRoute.updateMany).not.toHaveBeenCalled()
    expect(prisma.mtmRoutePoint.createMany).not.toHaveBeenCalled()
  })

  it("keeps a published route immutable even for an administrator", async () => {
    vi.mocked(prisma.mtmRoute.findFirst).mockResolvedValue({
      id: "r1",
      agentId: "a1",
      date: new Date("2026-04-10"),
      status: "PLANNED",
      version: 2,
      updatedAt: new Date("2026-04-09T12:00:00.000Z"),
      totalPoints: 1,
      assignments: [{ agentId: "a1", role: "PRIMARY" }],
      points: [{ id: "p1", customerId: "c1", plannedTime: null, orderIndex: 0, status: "PENDING" }],
    } as any)

    const res = await PUT(
      makeJsonReq("/api/v1/mtm/routes/r1", { expectedVersion: 2, agentId: "a1", points: [{ customerId: "c1" }, { customerId: "c2" }] }),
      params("r1"),
    )
    const response = await res.json()
    expect({ status: res.status, response }).toMatchObject({
      status: 409,
      response: { code: "ROUTE_PUBLISHED_IMMUTABLE", currentVersion: 2 },
    })
    expect(prisma.mtmRoute.updateMany).not.toHaveBeenCalled()
    expect(prisma.mtmRoutePoint.updateMany).not.toHaveBeenCalled()
  })

  it("requires the change-request workflow for an in-progress route", async () => {
    vi.mocked(prisma.mtmRoute.findFirst).mockResolvedValue({
      id: "r1",
      agentId: "a1",
      date: new Date("2026-04-10"),
      status: "IN_PROGRESS",
      version: 4,
      updatedAt: new Date("2026-04-09T12:00:00.000Z"),
      totalPoints: 1,
      assignments: [{ agentId: "a1", role: "PRIMARY" }],
      points: [{ id: "p1", customerId: "c1", plannedTime: null, orderIndex: 0, status: "VISITED" }],
    } as any)

    const res = await PUT(
      makeJsonReq("/api/v1/mtm/routes/r1", { expectedVersion: 4, points: [{ customerId: "c2" }] }),
      params("r1"),
    )
    const response = await res.json()
    expect({ status: res.status, response }).toMatchObject({
      status: 409,
      response: { code: "ROUTE_PUBLISHED_IMMUTABLE" },
    })
  })

  it("rejects a stale draft update before replacing points", async () => {
    vi.mocked(prisma.mtmRoute.findFirst).mockResolvedValue({
      id: "r1",
      agentId: "a1",
      date: new Date("2026-04-10"),
      status: "DRAFT",
      version: 7,
      updatedAt: new Date("2026-04-09T12:00:00.000Z"),
      totalPoints: 1,
      assignments: [{ agentId: "a1", role: "PRIMARY" }],
      points: [{ id: "p1", customerId: "c1", contactId: null, plannedTime: null, orderIndex: 0, status: "PENDING" }],
    } as any)

    const res = await PUT(
      makeJsonReq("/api/v1/mtm/routes/r1", { expectedVersion: 6, name: "Stale name" }),
      params("r1"),
    )

    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({
      code: "ROUTE_VERSION_CONFLICT",
      currentVersion: 7,
    })
    expect(prisma.mtmRoute.updateMany).not.toHaveBeenCalled()
  })
})

describe("DELETE /api/v1/mtm/routes/[id]", () => {
  let DELETE: typeof import("@/app/api/v1/mtm/routes/[id]/route").DELETE
  beforeEach(async () => {
    DELETE = (await import("@/app/api/v1/mtm/routes/[id]/route")).DELETE
  })

  it("returns 404 when route not found", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG)
    // Handler short-circuits on findFirst === null before touching deleteMany.
    vi.mocked(prisma.mtmRoute.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.mtmRoutePoint.deleteMany).mockResolvedValue({ count: 0 } as any)
    vi.mocked(prisma.mtmRoute.deleteMany).mockResolvedValue({ count: 0 } as any)
    const res = await DELETE(makeReq("/api/v1/mtm/routes/r1", "DELETE"), params("r1"))
    expect(res.status).toBe(404)
  })

  it("deletes route and its points", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG)
    vi.mocked(prisma.mtmRoute.findFirst).mockResolvedValue({
      id: "r1",
      agentId: "a1",
      date: new Date(),
      status: "DRAFT",
      assignments: [{ agentId: "a1" }],
      points: [{ id: "p1" }, { id: "p2" }],
    } as any)
    // M2-1d soft-delete: DELETE cascades to mtmRoutePoint.updateMany
    // (sets deletedAt) + mtmRoute.updateMany (also sets deletedAt) — not
    // physical deleteMany rows.
    vi.mocked(prisma.mtmRoutePoint.updateMany).mockResolvedValue({ count: 2 } as any)
    vi.mocked(prisma.mtmRoute.updateMany).mockResolvedValue({ count: 1 } as any)
    const res = await DELETE(makeReq("/api/v1/mtm/routes/r1", "DELETE"), params("r1"))
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(prisma.mtmRoutePoint.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ routeId: "r1", deletedAt: null }),
    }))
    expect(prisma.mtmRouteAssignment.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ routeId: "r1", organizationId: ORG, removedAt: null }),
    }))
    expect(prisma.mtmRoute.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: "r1", organizationId: ORG, deletedAt: null }),
    }))
    expect(prisma.mtmMobileSyncChange.create).not.toHaveBeenCalled()
    expect(prisma.mtmMobileSyncScopeRevision.upsert).not.toHaveBeenCalled()
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// MTM Visits [id]
// ═══════════════════════════════════════════════════════════════════════════

describe("GET /api/v1/mtm/visits/[id]", () => {
  let GET: typeof import("@/app/api/v1/mtm/visits/[id]/route").GET
  beforeEach(async () => { GET = (await import("@/app/api/v1/mtm/visits/[id]/route")).GET })

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(requireAuth).mockResolvedValue(new Response(null, { status: 401 }) as any)
    const res = await GET(makeReq("/api/v1/mtm/visits/v1"), params("v1"))
    expect(res.status).toBe(401)
  })

  it("returns visit data", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG)
    vi.mocked(prisma.mtmVisit.findFirst).mockResolvedValue({ id: "v1", agent: { name: "Agent" }, customer: { name: "Customer" } } as any)
    const res = await GET(makeReq("/api/v1/mtm/visits/v1"), params("v1"))
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data.id).toBe("v1")
  })
})

describe("PUT /api/v1/mtm/visits/[id]", () => {
  let PUT: typeof import("@/app/api/v1/mtm/visits/[id]/route").PUT
  beforeEach(async () => { PUT = (await import("@/app/api/v1/mtm/visits/[id]/route")).PUT })

  it("completes a checked-in visit when required actions are satisfied", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG)
    vi.mocked(prisma.mtmVisit.findFirst).mockResolvedValue({
      id: "v1",
      agentId: "a1",
      customerId: "c1",
      contactId: null,
      status: "CHECKED_IN",
      checkInAt: new Date("2026-07-13T08:00:00.000Z"),
      checkOutAt: null,
      routeId: null,
      routePointId: null,
      requirementSnapshot: { requirements: [] },
      actionResults: [],
      _count: { photos: 0 },
    })
    vi.mocked(prisma.mtmVisit.update).mockResolvedValue({
      id: "v1",
      agentId: "a1",
      status: "CHECKED_OUT",
      checkOutAt: new Date("2026-07-13T08:30:00.000Z"),
      duration: 30,
      routeId: null,
      routePointId: null,
    })
    const res = await PUT(
      makeJsonReq("/api/v1/mtm/visits/v1", {
        status: "CHECKED_OUT",
        checkOutAt: "2026-07-13T08:30:00.000Z",
      }),
      params("v1"),
    )
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(prisma.mtmVisit.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "CHECKED_OUT", duration: 30 }),
    }))
  })

  it("validates a contact workplace against the visit date", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG)
    const checkInAt = new Date("2026-01-15T09:00:00.000Z")
    vi.mocked(prisma.mtmVisit.findFirst).mockResolvedValue({
      customerId: "clinic-1",
      contactId: null,
      checkInAt,
    } as never)
    vi.mocked(prisma.mtmCustomer.findFirst).mockResolvedValue({ id: "clinic-1" } as never)
    vi.mocked(prisma.mtmContact.findFirst).mockResolvedValue({ id: "doctor-1" } as never)
    vi.mocked(prisma.mtmCustomer.findMany).mockResolvedValue([{ id: "clinic-1" }] as never)
    vi.mocked(prisma.mtmContact.findMany).mockResolvedValue([{
      id: "doctor-1",
      workplaces: [{ customerId: "clinic-1" }],
    }] as never)
    vi.mocked(prisma.mtmVisit.updateMany).mockResolvedValue({ count: 1 } as never)

    const response = await PUT(
      makeJsonReq("/api/v1/mtm/visits/v1", { contactId: "doctor-1" }),
      params("v1"),
    )

    expect(response.status).toBe(200)
    expect(prisma.mtmContact.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: { in: ["doctor-1"] },
      }),
    }))
    const contactQuery = vi.mocked(prisma.mtmContact.findMany).mock.calls[0][0] as any
    expect(contactQuery.select.workplaces.where.AND).toEqual([
      { OR: [{ startedOn: null }, { startedOn: { lte: checkInAt } }] },
      { OR: [{ endedOn: null }, { endedOn: { gt: checkInAt } }] },
    ])
  })
})

describe("DELETE /api/v1/mtm/visits/[id]", () => {
  let DELETE: typeof import("@/app/api/v1/mtm/visits/[id]/route").DELETE
  beforeEach(async () => { DELETE = (await import("@/app/api/v1/mtm/visits/[id]/route")).DELETE })

  it("returns 404 when not found", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG)
    // M2-1d soft-delete: visit DELETE handler now uses updateMany (sets
    // deletedAt), not physical deleteMany. 404 path is gated on
    // `deleted.count === 0`, not on `findFirst === null`.
    vi.mocked(prisma.mtmVisit.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.mtmVisit.updateMany).mockResolvedValue({ count: 0 } as any)
    const res = await DELETE(makeReq("/api/v1/mtm/visits/v1", "DELETE"), params("v1"))
    expect(res.status).toBe(404)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// MTM Photos [id] (PATCH + DELETE)
// ═══════════════════════════════════════════════════════════════════════════

describe("PATCH /api/v1/mtm/photos/[id]", () => {
  let PATCH: typeof import("@/app/api/v1/mtm/photos/[id]/route").PATCH
  beforeEach(async () => { PATCH = (await import("@/app/api/v1/mtm/photos/[id]/route")).PATCH })

  it("returns 404 when photo not found (F-19: atomic updateMany returns count:0)", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG)
    vi.mocked(prisma.mtmPhoto.updateMany).mockResolvedValue({ count: 0 } as any)
    const req = makeJsonReq("/api/v1/mtm/photos/ph1", { status: "APPROVED" }, "PATCH")
    const res = await PATCH(req, params("ph1"))
    expect(res.status).toBe(404)
  })

  it("updates photo status with reviewedAt (F-19: now uses atomic updateMany)", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG)
    vi.mocked(prisma.mtmPhoto.findFirst).mockResolvedValue({ id: "ph1", status: "PENDING", agentId: "a1" } as any)
    vi.mocked(prisma.mtmPhoto.updateMany).mockResolvedValue({ count: 1 } as any)
    vi.mocked(prisma.mtmPhoto.findUnique).mockResolvedValue({ id: "ph1", status: "APPROVED" } as any)
    const req = makeJsonReq("/api/v1/mtm/photos/ph1", { status: "APPROVED", reviewedBy: "user-1" }, "PATCH")
    const res = await PATCH(req, params("ph1"))
    const json = await res.json()
    expect(json.success).toBe(true)
    const call = vi.mocked(prisma.mtmPhoto.updateMany).mock.calls[0][0] as any
    expect(call.where.organizationId).toBe(ORG)
    expect(call.data.reviewedAt).toBeInstanceOf(Date)
  })
})

describe("DELETE /api/v1/mtm/photos/[id]", () => {
  let DELETE: typeof import("@/app/api/v1/mtm/photos/[id]/route").DELETE
  beforeEach(async () => { DELETE = (await import("@/app/api/v1/mtm/photos/[id]/route")).DELETE })

  it("returns 404 when photo not found", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG)
    vi.mocked(prisma.mtmPhoto.deleteMany).mockResolvedValue({ count: 0 } as any)
    const res = await DELETE(makeReq("/api/v1/mtm/photos/ph1", "DELETE"), params("ph1"))
    expect(res.status).toBe(404)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// MTM Alerts [id] (PATCH + DELETE)
// ═══════════════════════════════════════════════════════════════════════════

describe("PATCH /api/v1/mtm/alerts/[id]", () => {
  let PATCH: typeof import("@/app/api/v1/mtm/alerts/[id]/route").PATCH
  beforeEach(async () => { PATCH = (await import("@/app/api/v1/mtm/alerts/[id]/route")).PATCH })

  it("resolves alert with resolvedAt timestamp", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG)
    vi.mocked(prisma.mtmAlert.findFirst).mockResolvedValue({ id: "al1", type: "OUT_OF_ZONE", isResolved: false, agentId: "a1" } as any)
    vi.mocked(prisma.mtmAlert.updateMany).mockResolvedValue({ count: 1 } as any)
    const req = makeJsonReq("/api/v1/mtm/alerts/al1", { isResolved: true, resolvedBy: "user-1" }, "PATCH")
    const res = await PATCH(req, params("al1"))
    const json = await res.json()
    expect(json.success).toBe(true)
    const call = vi.mocked(prisma.mtmAlert.updateMany).mock.calls[0][0] as any
    expect(call.data.resolvedAt).toBeInstanceOf(Date)
  })

  it("returns 404 when alert not found", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG)
    vi.mocked(prisma.mtmAlert.findFirst).mockResolvedValue(null)
    const req = makeJsonReq("/api/v1/mtm/alerts/al1", { isResolved: true }, "PATCH")
    const res = await PATCH(req, params("al1"))
    expect(res.status).toBe(404)
  })
})

describe("DELETE /api/v1/mtm/alerts/[id]", () => {
  let DELETE: typeof import("@/app/api/v1/mtm/alerts/[id]/route").DELETE
  beforeEach(async () => { DELETE = (await import("@/app/api/v1/mtm/alerts/[id]/route")).DELETE })

  it("deletes alert", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG)
    vi.mocked(prisma.mtmAlert.findFirst).mockResolvedValue({ id: "al1", type: "OUT_OF_ZONE", title: "t", agentId: "a1" } as any)
    vi.mocked(prisma.mtmAlert.deleteMany).mockResolvedValue({ count: 1 } as any)
    const res = await DELETE(makeReq("/api/v1/mtm/alerts/al1", "DELETE"), params("al1"))
    const json = await res.json()
    expect(json.success).toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// MTM Activity (GET)
// ═══════════════════════════════════════════════════════════════════════════

describe("GET /api/v1/mtm/activity", () => {
  let GET: typeof import("@/app/api/v1/mtm/activity/route").GET
  beforeEach(async () => { GET = (await import("@/app/api/v1/mtm/activity/route")).GET })

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(requireAuth).mockResolvedValue(new Response(null, { status: 401 }) as never)
    const res = await GET(makeReq("/api/v1/mtm/activity"))
    expect(res.status).toBe(401)
  })

  it("returns KPI counts and activity logs", async () => {
    vi.mocked(requireAuth).mockResolvedValue({
      orgId: ORG, userId: "admin-user", role: "admin", email: "admin@example.com", name: "Admin",
    } as never)
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({
      plan: "enterprise",
      addons: [],
      features: ["route-field", "workforce-hrm"],
      modules: { "route-field": true, "workforce-hrm": true },
      settings: {},
    } as never)
    vi.mocked(prisma.mtmVisit.count).mockResolvedValue(5)
    vi.mocked(prisma.mtmPhoto.count).mockResolvedValue(3)
    vi.mocked(prisma.mtmAuditLog.count).mockResolvedValue(10)
    vi.mocked(prisma.mtmAuditLog.findMany).mockResolvedValue([])
    const res = await GET(makeReq("/api/v1/mtm/activity"))
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data.kpi).toBeDefined()
    expect(json.data.logs).toEqual([])
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// MTM Locations (GET + POST)
// ═══════════════════════════════════════════════════════════════════════════

describe("GET /api/v1/mtm/locations", () => {
  let GET: typeof import("@/app/api/v1/mtm/locations/route").GET
  beforeEach(async () => {
    GET = (await import("@/app/api/v1/mtm/locations/route")).GET
  })

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(requireAuth).mockResolvedValue(new Response(null, { status: 401 }) as never)
    const res = await GET(makeReq("/api/v1/mtm/locations"))
    expect(res.status).toBe(401)
  })

  it("returns single agent history when agentId provided", async () => {
    vi.mocked(requireAuth).mockResolvedValue({
      orgId: ORG, userId: "admin-user", role: "admin", email: "admin@example.com", name: "Admin",
    } as never)
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({
      plan: "enterprise",
      addons: [],
      features: ["route-field"],
      modules: { "route-field": true },
      settings: {},
    } as never)
    vi.mocked(prisma.mtmAgentLocation.findMany).mockResolvedValue([{
      id: "loc1",
      latitude: 40.4,
      longitude: 49.8,
      accuracy: 12,
    }] as any)
    const res = await GET(makeReq("/api/v1/mtm/locations?agentId=agent-1"))
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
    expect(json.data.locations).toHaveLength(1)
  })
})

describe("POST /api/v1/mtm/locations", () => {
  let POST: typeof import("@/app/api/v1/mtm/locations/route").POST
  beforeEach(async () => { POST = (await import("@/app/api/v1/mtm/locations/route")).POST })

  it("creates location and updates agent status", async () => {
    vi.mocked(requireAuth).mockResolvedValue({
      orgId: ORG, userId: "admin-user", role: "admin", email: "admin@example.com", name: "Admin",
    } as never)
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({
      plan: "enterprise",
      addons: [],
      features: ["route-field"],
      modules: { "route-field": true },
      settings: {},
    } as never)
    vi.mocked(prisma.mtmAgentLocation.create).mockResolvedValue({ id: "loc-new" } as any)
    vi.mocked(prisma.mtmAgent.updateMany).mockResolvedValue({ count: 1 } as any)
    const req = makeJsonReq("/api/v1/mtm/locations", { agentId: "a1", latitude: "40.4", longitude: "49.8" }, "POST")
    const res = await POST(req)
    expect(res.status).toBe(201)
    expect(await res.json()).toMatchObject({ success: true, data: { id: "loc-new" } })
    expect(prisma.mtmAgent.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "a1", organizationId: ORG, status: "ACTIVE" },
    }))
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// MTM Mobile Location (POST + GET)
// ═══════════════════════════════════════════════════════════════════════════

describe("POST /api/v1/mtm/mobile/location", () => {
  let POST: typeof import("@/app/api/v1/mtm/mobile/location/route").POST
  beforeEach(async () => {
    POST = (await import("@/app/api/v1/mtm/mobile/location/route")).POST
    vi.mocked(prisma.mtmAgentWorkday.findFirst).mockResolvedValue({
      id: "workday-active",
      status: "STARTED",
      startedAt: new Date("2026-01-01T00:00:00.000Z"),
      completedAt: null,
    } as never)
  })

  it("returns 401 when mobile auth fails", async () => {
    // withMobileRls treats a null resolveMobileAuth result as unauthenticated → 401.
    vi.mocked(resolveMobileAuth).mockResolvedValue(null as any)
    const req = makeJsonReq("/api/v1/mtm/mobile/location", { latitude: 40.4, longitude: 49.8 }, "POST")
    const res = await POST(req)
    expect(res.status).toBe(401)
  })

  it("returns 400 when lat/lng missing", async () => {
    vi.mocked(resolveMobileAuth).mockResolvedValue(routeMobileAuth("a1") as any)
    const req = makeJsonReq("/api/v1/mtm/mobile/location", {}, "POST")
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it("saves location successfully", async () => {
    vi.mocked(resolveMobileAuth).mockResolvedValue(routeMobileAuth("a1") as any)
    vi.mocked(prisma.mtmAgentLocation.create).mockResolvedValue({} as any)
    vi.mocked(prisma.mtmAgent.updateMany).mockResolvedValue({ count: 1 } as any)
    const req = makeJsonReq("/api/v1/mtm/mobile/location", { latitude: 40.4, longitude: 49.8, speed: 5 }, "POST")
    const res = await POST(req)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(prisma.mtmAgent.updateMany).toHaveBeenCalledWith({
      where: { id: "a1", organizationId: ORG, status: "ACTIVE" },
      data: { isOnline: true, lastSeenAt: expect.any(Date) },
    })
    expect(prisma.$transaction).toHaveBeenCalledTimes(1)
    expect(prisma.mtmAgentLocation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ workdayId: "workday-active" }),
    })
  })

  it("requires an explicit self-share mode before a manager can submit their own location", async () => {
    vi.mocked(resolveMobileAuth).mockResolvedValue(routeMobileAuth("manager-1", "MANAGER") as any)

    const res = await POST(makeJsonReq(
      "/api/v1/mtm/mobile/location",
      { latitude: 40.4, longitude: 49.8 },
      "POST",
    ))

    expect(res.status).toBe(403)
    expect(prisma.mtmAgentLocation.create).not.toHaveBeenCalled()
  })

  it("does not let an agent bypass field-workday tracking through self-share mode", async () => {
    vi.mocked(resolveMobileAuth).mockResolvedValue(routeMobileAuth("agent-1") as any)

    const res = await POST(makeJsonReq(
      "/api/v1/mtm/mobile/location",
      { mode: "SELF_SHARE", latitude: 40.4, longitude: 49.8 },
      "POST",
    ))

    expect(res.status).toBe(403)
    expect(prisma.mtmAgentLocation.create).not.toHaveBeenCalled()
  })

  it("stores an explicit manager self-share without a workday or route checks", async () => {
    vi.mocked(resolveMobileAuth).mockResolvedValue(routeMobileAuth("manager-1", "MANAGER") as any)
    vi.mocked(prisma.mtmAgentLocation.create).mockResolvedValue({ id: "manager-location" } as any)
    vi.mocked(prisma.mtmAgent.updateMany).mockResolvedValue({ count: 1 } as any)
    vi.mocked(prisma.mtmAgentWorkday.findFirst).mockResolvedValue(null)

    const res = await POST(makeJsonReq("/api/v1/mtm/mobile/location", {
      mode: "SELF_SHARE",
      workdayId: "must-be-ignored",
      latitude: 40.4,
      longitude: 49.8,
    }, "POST"))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
    expect(prisma.mtmAgentWorkday.findFirst).not.toHaveBeenCalled()
    expect(prisma.mtmRoute.findFirst).not.toHaveBeenCalled()
    expect(prisma.mtmAgentLocation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: ORG,
        agentId: "manager-1",
        workdayId: null,
      }),
    })
  })

  it("rejects live tracking when no active workday exists", async () => {
    vi.mocked(resolveMobileAuth).mockResolvedValue(routeMobileAuth("a1") as any)
    vi.mocked(prisma.mtmAgentWorkday.findFirst).mockResolvedValue(null)

    const res = await POST(makeJsonReq(
      "/api/v1/mtm/mobile/location",
      { latitude: 40.4, longitude: 49.8 },
      "POST",
    ))
    const json = await res.json()

    expect(res.status).toBe(409)
    expect(json.code).toBe("MTM_LOCATION_WORKDAY_REQUIRED")
    expect(prisma.mtmAgent.updateMany).not.toHaveBeenCalled()
    expect(prisma.mtmAgentLocation.create).not.toHaveBeenCalled()
  })

  it("preserves offline capture time, client id and legitimate zero telemetry", async () => {
    vi.mocked(resolveMobileAuth).mockResolvedValue(routeMobileAuth("a1") as any)
    vi.mocked(prisma.mtmAgentLocation.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.mtmAgentLocation.create).mockResolvedValue({ id: "loc-offline" } as any)
    vi.mocked(prisma.mtmAgent.updateMany).mockResolvedValue({ count: 1 } as any)
    vi.mocked(prisma.mtmAgentWorkday.findFirst).mockResolvedValue({
      id: "workday-completed",
      status: "COMPLETED",
      startedAt: new Date("2026-07-14T05:00:00.000Z"),
      completedAt: new Date("2026-07-14T06:00:00.000Z"),
    } as never)
    const req = makeJsonReq("/api/v1/mtm/mobile/location", {
      clientLocationId: "mobile-location-1",
      workdayId: "workday-completed",
      latitude: 0,
      longitude: 0,
      accuracy: 0,
      speed: 0,
      heading: 0,
      altitude: 0,
      battery: 0,
      recordedAt: "2026-07-14T05:30:00.000Z",
    }, "POST")
    const res = await POST(req)

    expect(res.status).toBe(200)
    expect(prisma.mtmAgentLocation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        clientLocationId: "mobile-location-1",
        workdayId: "workday-completed",
        latitude: 0,
        longitude: 0,
        accuracy: 0,
        speed: 0,
        heading: 0,
        altitude: 0,
        battery: 0,
        isMoving: false,
        recordedAt: new Date("2026-07-14T05:30:00.000Z"),
      }),
    })
  })

  it("rejects an offline point outside its explicit completed workday", async () => {
    vi.mocked(resolveMobileAuth).mockResolvedValue(routeMobileAuth("a1") as any)
    vi.mocked(prisma.mtmAgentLocation.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.mtmAgentWorkday.findFirst).mockResolvedValue({
      id: "workday-completed",
      status: "COMPLETED",
      startedAt: new Date("2026-07-14T05:00:00.000Z"),
      completedAt: new Date("2026-07-14T06:00:00.000Z"),
    } as never)

    const res = await POST(makeJsonReq("/api/v1/mtm/mobile/location", {
      clientLocationId: "mobile-location-late",
      workdayId: "workday-completed",
      latitude: 40.4,
      longitude: 49.8,
      recordedAt: "2026-07-14T06:00:01.000Z",
    }, "POST"))
    const json = await res.json()

    expect(res.status).toBe(409)
    expect(json.code).toBe("MTM_LOCATION_OUTSIDE_WORKDAY")
    expect(prisma.mtmAgentLocation.create).not.toHaveBeenCalled()
  })

  it("refuses a point recorded during a break (audit A7)", async () => {
    // The agent is at lunch, not on route: banking the point would put the
    // break into the day's work and into travelled distance.
    vi.mocked(resolveMobileAuth).mockResolvedValue(routeMobileAuth("a1") as any)
    vi.mocked(prisma.mtmAgentLocation.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.mtmAgentWorkday.findFirst).mockResolvedValue({
      id: "workday-paused",
      status: "PAUSED",
      startedAt: new Date("2026-07-14T05:00:00.000Z"),
      completedAt: null,
    } as never)
    vi.mocked(prisma.mtmAgentWorkdayEvent.findMany).mockResolvedValue([
      { type: "PAUSE", occurredAt: new Date("2026-07-14T09:05:00.000Z") },
    ] as never)

    const res = await POST(makeJsonReq("/api/v1/mtm/mobile/location", {
      latitude: 40.4,
      longitude: 49.8,
      recordedAt: "2026-07-14T09:20:00.000Z",
    }, "POST"))
    const json = await res.json()

    expect(res.status).toBe(409)
    expect(json.code).toBe("MTM_LOCATION_WORKDAY_PAUSED")
    expect(prisma.mtmAgentLocation.create).not.toHaveBeenCalled()
  })

  it("accepts a point captured before the break and delivered during it", async () => {
    // The offline queue drains late. What matters is when the point was
    // taken, not when it arrived — that work happened.
    vi.mocked(resolveMobileAuth).mockResolvedValue(routeMobileAuth("a1") as any)
    vi.mocked(prisma.mtmAgentLocation.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.mtmAgentWorkday.findFirst).mockResolvedValue({
      id: "workday-paused",
      status: "PAUSED",
      startedAt: new Date("2026-07-14T05:00:00.000Z"),
      completedAt: null,
    } as never)
    vi.mocked(prisma.mtmAgentWorkdayEvent.findMany).mockResolvedValue([
      { type: "PAUSE", occurredAt: new Date("2026-07-14T09:05:00.000Z") },
    ] as never)

    const res = await POST(makeJsonReq("/api/v1/mtm/mobile/location", {
      latitude: 40.4,
      longitude: 49.8,
      recordedAt: "2026-07-14T08:55:00.000Z",
    }, "POST"))

    expect(res.status).toBe(200)
    expect(prisma.mtmAgentLocation.create).toHaveBeenCalled()
  })

  it("rechecks the workday window inside the coordinate write transaction", async () => {
    vi.mocked(resolveMobileAuth).mockResolvedValue(routeMobileAuth("a1") as any)
    vi.mocked(prisma.mtmAgentWorkday.findFirst)
      .mockResolvedValueOnce({
        id: "workday-active",
        status: "STARTED",
        startedAt: new Date("2026-01-01T00:00:00.000Z"),
        completedAt: null,
      } as never)
      .mockResolvedValueOnce({
        id: "workday-active",
        status: "COMPLETED",
        startedAt: new Date("2026-01-01T00:00:00.000Z"),
        completedAt: new Date("2026-07-14T05:00:00.000Z"),
      } as never)

    const res = await POST(makeJsonReq("/api/v1/mtm/mobile/location", {
      latitude: 40.4,
      longitude: 49.8,
      recordedAt: "2026-07-14T05:30:00.000Z",
    }, "POST"))
    const json = await res.json()

    expect(res.status).toBe(409)
    expect(json.code).toBe("MTM_LOCATION_OUTSIDE_WORKDAY")
    expect(prisma.mtmAgent.updateMany).not.toHaveBeenCalled()
    expect(prisma.mtmAgentLocation.create).not.toHaveBeenCalled()
  })

  it("replays an already accepted client location without a duplicate write", async () => {
    vi.mocked(resolveMobileAuth).mockResolvedValue(routeMobileAuth("a1") as any)
    vi.mocked(prisma.mtmAgentLocation.findFirst).mockResolvedValue({ id: "loc-existing" } as any)
    const req = makeJsonReq("/api/v1/mtm/mobile/location", {
      clientLocationId: "mobile-location-1",
      latitude: 40.4,
      longitude: 49.8,
      recordedAt: "2026-07-14T05:30:00.000Z",
    }, "POST")
    const res = await POST(req)
    const json = await res.json()

    expect(json.data).toMatchObject({ location: { id: "loc-existing" }, replayed: true })
    expect(prisma.mtmAgentLocation.create).not.toHaveBeenCalled()
    expect(prisma.mtmAgent.updateMany).not.toHaveBeenCalled()
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it("does not expose a Workforce workday id in a Routes-only replay", async () => {
    vi.mocked(resolveMobileAuth).mockResolvedValue(routeMobileAuth("a1", "AGENT", false) as any)
    vi.mocked(prisma.mtmAgentLocation.findFirst).mockResolvedValue({
      id: "loc-existing",
      workdayId: "workday-private",
      latitude: 40.4,
      longitude: 49.8,
    } as any)

    const response = await POST(makeJsonReq("/api/v1/mtm/mobile/location", {
      clientLocationId: "mobile-location-route-only",
      latitude: 40.4,
      longitude: 49.8,
      recordedAt: "2026-07-14T05:30:00.000Z",
    }, "POST"))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data.location).toMatchObject({ id: "loc-existing", latitude: 40.4, longitude: 49.8 })
    expect(body.data.location).not.toHaveProperty("workdayId")
  })

  it("rejects a stale or cross-tenant mobile actor before creating a coordinate", async () => {
    vi.mocked(resolveMobileAuth).mockResolvedValue(routeMobileAuth("foreign-agent") as any)
    vi.mocked(prisma.mtmAgent.updateMany).mockResolvedValue({ count: 0 } as any)

    const req = makeJsonReq("/api/v1/mtm/mobile/location", { latitude: 40.4, longitude: 49.8 }, "POST")
    const res = await POST(req)

    expect(res.status).toBe(401)
    expect(prisma.mtmAgent.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "foreign-agent", organizationId: ORG, status: "ACTIVE" },
    }))
    expect(prisma.mtmAgentLocation.create).not.toHaveBeenCalled()
  })
})

describe("GET /api/v1/mtm/mobile/location", () => {
  let GET: typeof import("@/app/api/v1/mtm/mobile/location/route").GET
  beforeEach(async () => { GET = (await import("@/app/api/v1/mtm/mobile/location/route")).GET })

  it("uses organization-local day boundaries and returns travelled distance", async () => {
    vi.mocked(resolveMobileAuth).mockResolvedValue(routeMobileAuth("a1") as any)
    vi.mocked(prisma.mtmAgentLocation.findMany).mockResolvedValue([
      { id: "loc-1", latitude: 40.4, longitude: 49.8 },
      { id: "loc-2", latitude: 40.5, longitude: 49.9 },
    ] as any)
    const res = await GET(makeReq("/api/v1/mtm/mobile/location?date=2026-07-15"))
    const json = await res.json()

    expect(json.data).toMatchObject({
      date: "2026-07-15",
      timezone: "Asia/Baku",
      gpsIntervalSeconds: 30,
      distanceMeters: 150,
    })
    expect(prisma.mtmAgentLocation.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        organizationId: ORG,
        agentId: "a1",
        recordedAt: {
          gte: new Date("2026-07-14T20:00:00.000Z"),
          lt: new Date("2026-07-15T20:00:00.000Z"),
        },
      },
    }))
  })

  it("redacts Workforce workday ids from Routes-only location history", async () => {
    vi.mocked(resolveMobileAuth).mockResolvedValue(routeMobileAuth("a1", "AGENT", false) as any)
    vi.mocked(prisma.mtmAgentLocation.findMany).mockResolvedValue([{
      id: "loc-route-only",
      workdayId: "workday-private",
      latitude: 40.4,
      longitude: 49.8,
    }] as any)

    const response = await GET(makeReq("/api/v1/mtm/mobile/location?date=2026-07-15"))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data.locations[0]).toMatchObject({ id: "loc-route-only" })
    expect(body.data.locations[0]).not.toHaveProperty("workdayId")
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// MTM Mobile Profile (GET)
// ═══════════════════════════════════════════════════════════════════════════

describe("GET /api/v1/mtm/mobile/profile", () => {
  let GET: typeof import("@/app/api/v1/mtm/mobile/profile/route").GET
  beforeEach(async () => { GET = (await import("@/app/api/v1/mtm/mobile/profile/route")).GET })

  it("returns 401 when mobile auth fails", async () => {
    // withMobileRls treats a null resolveMobileAuth result as unauthenticated → 401.
    vi.mocked(resolveMobileAuth).mockResolvedValue(null as any)
    const res = await GET(makeReq("/api/v1/mtm/mobile/profile"))
    expect(res.status).toBe(401)
  })

  it("returns 404 when agent not found", async () => {
    vi.mocked(resolveMobileAuth).mockResolvedValue(routeMobileAuth("a1") as any)
    vi.mocked(prisma.mtmAgent.findUnique).mockResolvedValue(null)
    const res = await GET(makeReq("/api/v1/mtm/mobile/profile"))
    expect(res.status).toBe(404)
  })

  it("returns agent profile with today summary", async () => {
    vi.mocked(resolveMobileAuth).mockResolvedValue(routeMobileAuth("a1") as any)
    vi.mocked(prisma.mtmAgent.findUnique).mockResolvedValue({
      id: "a1", name: "Agent", email: "a@test.com", phone: "+1", role: "FIELD", status: "ACTIVE",
      avatar: null, isOnline: true, organizationId: ORG,
      organization: { id: ORG, name: "TestOrg" }, manager: null,
    } as any)
    vi.mocked(prisma.mtmVisit.count).mockResolvedValue(3)
    vi.mocked(prisma.mtmTask.count).mockResolvedValue(2)
    vi.mocked(prisma.mtmRoute.findFirst).mockResolvedValue({ totalPoints: 5, visitedPoints: 3, status: "IN_PROGRESS" } as any)

    const res = await GET(makeReq("/api/v1/mtm/mobile/profile"))
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data.agent.name).toBe("Agent")
    expect(json.data.todaySummary.visits).toBe(3)
    expect(json.data.todaySummary.tasksCompleted).toBe(2)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// MTM Reports (GET)
// ═══════════════════════════════════════════════════════════════════════════

describe("GET /api/v1/mtm/reports", () => {
  let GET: typeof import("@/app/api/v1/mtm/reports/route").GET
  beforeEach(async () => { GET = (await import("@/app/api/v1/mtm/reports/route")).GET })

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(requireAuth).mockResolvedValue(new Response(null, { status: 401 }) as never)
    const res = await GET(makeReq("/api/v1/mtm/reports"))
    expect(res.status).toBe(401)
  })

  it("returns report counts with default period=week", async () => {
    vi.mocked(requireAuth).mockResolvedValue({
      orgId: ORG, userId: "admin-user", role: "admin", email: "admin@example.com", name: "Admin",
    } as never)
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({
      plan: "enterprise",
      addons: [],
      features: ["route-field"],
      modules: { "route-field": true },
      settings: {},
    } as never)
    vi.mocked(prisma.mtmAuditLog.count).mockResolvedValue(10)
    vi.mocked(prisma.mtmAgent.count).mockResolvedValue(5)
    vi.mocked(prisma.mtmRoute.count).mockResolvedValue(8)
    vi.mocked(prisma.mtmVisit.count).mockResolvedValue(20)
    vi.mocked(prisma.mtmAgentLocation.count).mockResolvedValue(100)
    vi.mocked(prisma.mtmPhoto.count).mockResolvedValue(15)

    const res = await GET(makeReq("/api/v1/mtm/reports"))
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data.counts.agent).toBe(5)
    expect(json.data.counts.visit).toBe(20)
    expect(json.data.period).toBe("week")
    expect(json.data.reportData).toBeNull()
  })

  it("returns rows + summary + series when type=visit (daily/gps report types were dropped)", async () => {
    vi.mocked(requireAuth).mockResolvedValue({
      orgId: ORG, userId: "admin-user", role: "admin", email: "admin@example.com", name: "Admin",
    } as never)
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({
      plan: "enterprise",
      addons: [],
      features: ["route-field"],
      modules: { "route-field": true },
      settings: {},
    } as never)
    vi.mocked(prisma.mtmAgent.count).mockResolvedValue(5)
    vi.mocked(prisma.mtmRoute.count).mockResolvedValue(8)
    vi.mocked(prisma.mtmVisit.count).mockResolvedValue(20)
    vi.mocked(prisma.mtmPhoto.count).mockResolvedValue(15)
    vi.mocked(prisma.mtmVisit.groupBy).mockResolvedValue([{ status: "CHECKED_OUT", _count: { _all: 1 } }] as any)
    vi.mocked(prisma.mtmVisit.aggregate).mockResolvedValue({ _avg: { duration: 30 } } as any)
    vi.mocked(prisma.mtmVisit.findMany).mockResolvedValue([
      { id: "v1", createdAt: new Date(), agentId: "a1", status: "CHECKED_OUT", duration: 30, agent: { name: "Farid" }, customer: { name: "Store" } },
    ] as any)

    const res = await GET(makeReq("/api/v1/mtm/reports?type=visit&period=today"))
    const json = await res.json()
    expect(json.data.type).toBe("visit")
    expect(json.data.period).toBe("today")
    expect(json.data.reportData).toHaveLength(1)
    expect(json.data.reportData[0].agent).toBe("Farid")
    // completion% + avg duration summary present; series is a daily-bucket array
    expect(json.data.summary.length).toBeGreaterThan(0)
    expect(Array.isArray(json.data.series)).toBe(true)
  })
})
