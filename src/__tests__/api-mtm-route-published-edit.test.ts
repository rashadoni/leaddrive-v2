import { Prisma } from "@prisma/client"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

/**
 * Web PUT /api/v1/mtm/routes/[id] on a published route (owner decision
 * 2026-09-15): managers, supervisors and admins in scope change stops of a
 * PLANNED or IN_PROGRESS route through the same diff as Route Field's
 * UPDATE_PUBLISHED; agents keep ROUTE_PUBLISHED_IMMUTABLE.
 */

const actorMock = vi.hoisted(() => ({ resolveMtmRouteActor: vi.fn() }))

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
vi.mock("@/lib/mtm/route-permissions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/mtm/route-permissions")>()),
  resolveMtmRouteActor: actorMock.resolveMtmRouteActor,
}))

import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/lib/api-auth"
import { getMobileAuth, resolveMobileAuth } from "@/lib/mobile-auth"
import { PUT } from "@/app/api/v1/mtm/routes/[id]/route"

const ORG = "org-1"
const manager = { agentId: "m1", role: "MANAGER", canPlanOwnRoutes: true, canSelfPublishRoutes: false, scopedAgentIds: ["m1", "a1"] }

function put(body: unknown) {
  return PUT(
    new NextRequest(new URL("/api/v1/mtm/routes/r1", "http://localhost:3000"), {
      method: "PUT",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    }),
    { params: Promise.resolve({ id: "r1" }) },
  )
}

function stop(id: string, customerId: string, orderIndex: number, status = "PENDING", visits = 0, changeRequests = 0) {
  return { id, customerId, contactId: null, orderIndex, plannedTime: null, status, _count: { visits, changeRequests } }
}

function givenRoute(
  status: string,
  points: ReturnType<typeof stop>[],
  assignments: Array<{ agentId: string; role: string }> = [{ agentId: "a1", role: "PRIMARY" }],
) {
  vi.mocked(prisma.mtmRoutePoint.findMany).mockResolvedValue(points as never)
  vi.mocked(prisma.mtmRoute.findFirst)
    .mockResolvedValueOnce({
      id: "r1",
      agentId: "a1",
      date: new Date("2026-09-16T00:00:00.000Z"),
      status,
      version: 3,
      publishedVersion: 3,
      updatedAt: new Date("2026-09-15T08:00:00.000Z"),
      totalPoints: points.length,
      assignments,
      points,
    } as never)
    .mockResolvedValueOnce(null as never)
}

beforeEach(() => {
  vi.clearAllMocks()
  // Unconsumed mockResolvedValueOnce rows survive clearAllMocks.
  vi.mocked(prisma.mtmRoute.findFirst).mockReset().mockResolvedValue(null as never)
  vi.mocked(prisma.mtmRoutePoint.updateMany).mockReset()
  vi.mocked(getMobileAuth).mockReturnValue(null)
  vi.mocked(resolveMobileAuth).mockResolvedValue(null)
  vi.mocked(requireAuth).mockResolvedValue({
    orgId: ORG,
    userId: "manager-user",
    role: "manager",
    email: "manager@example.com",
    name: "Manager",
  } as never)
  actorMock.resolveMtmRouteActor.mockResolvedValue(manager)
  vi.mocked(prisma.mtmAgent.findMany).mockResolvedValue([{ id: "a1", teamId: null }] as never)
  vi.mocked(prisma.mtmCustomer.findMany).mockResolvedValue([{ id: "c1" }, { id: "c2" }, { id: "c3" }] as never)
  vi.mocked(prisma.mtmRoute.updateMany).mockResolvedValue({ count: 1 } as never)
  vi.mocked(prisma.mtmRoute.findMany).mockResolvedValue([] as never)
  vi.mocked(prisma.mtmRoutePoint.updateMany).mockResolvedValue({ count: 1 } as never)
  vi.mocked(prisma.mtmRoutePoint.createMany).mockResolvedValue({ count: 1 } as never)
  vi.mocked(prisma.mtmRouteNotificationOutbox.upsert).mockResolvedValue({ id: "outbox-1" } as never)
})

describe("PUT /api/v1/mtm/routes/[id] on a published route", () => {
  it("lets a manager in scope change stops without recreating kept points", async () => {
    givenRoute("PLANNED", [stop("p1", "c1", 0), stop("p2", "c2", 1)])

    // The builder resends the whole form, date and crew included.
    const res = await put({
      expectedVersion: 3,
      name: "Tuesday",
      date: "2026-09-16",
      agentId: "a1",
      assignments: [{ agentId: "a1", role: "PRIMARY" }],
      points: [{ customerId: "c2" }, { customerId: "c3" }],
    })

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ success: true, data: { id: "r1", version: 4 } })
    expect(prisma.mtmRoute.updateMany).toHaveBeenCalledWith({
      where: { id: "r1", organizationId: ORG, status: "PLANNED", version: 3, deletedAt: null },
      data: expect.objectContaining({ publishedVersion: 4, totalPoints: 2, name: "Tuesday", version: { increment: 1 } }),
    })
    const routeData = (vi.mocked(prisma.mtmRoute.updateMany).mock.calls[0]![0] as { data: Record<string, unknown> }).data
    expect(routeData).not.toHaveProperty("status")
    expect(routeData).not.toHaveProperty("date")
    expect(prisma.mtmRoutePoint.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: { in: ["p1"] }, status: "PENDING" }),
      data: expect.objectContaining({ version: { increment: 1 } }),
    }))
    expect(prisma.mtmRoutePoint.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: "p2" }),
      data: { orderIndex: 0, plannedTime: null, version: { increment: 1 } },
    }))
    expect(prisma.mtmRoutePoint.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ customerId: "c3", orderIndex: 1 })],
    })
    // Assignments are proven unchanged and never rewritten: assignedAt bounds history.
    expect(prisma.mtmRouteAssignment.updateMany).not.toHaveBeenCalled()
    expect(prisma.mtmRouteAssignment.upsert).not.toHaveBeenCalled()
    expect(prisma.mtmRouteNotificationOutbox.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { organizationId_dedupeKey: { organizationId: ORG, dedupeKey: "route:r1:published:4:a1" } },
    }))
  })

  it("keeps visited stops of a started route locked for a manager too", async () => {
    givenRoute("IN_PROGRESS", [stop("p1", "c1", 0, "VISITED", 1), stop("p2", "c2", 1)])

    const res = await put({ expectedVersion: 3, points: [{ customerId: "c2" }] })

    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: "ROUTE_VISITED_POINTS_LOCKED", pointIds: ["p1"] })
    expect(prisma.mtmRoute.updateMany).not.toHaveBeenCalled()
  })

  it("adds a stop to a started route after the visited ones", async () => {
    givenRoute("IN_PROGRESS", [stop("p1", "c1", 0, "VISITED", 1), stop("p2", "c2", 1)])

    const res = await put({ expectedVersion: 3, points: [{ customerId: "c1" }, { customerId: "c3" }, { customerId: "c2" }] })

    expect(res.status).toBe(200)
    expect(prisma.mtmRoute.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: "IN_PROGRESS" }),
    }))
    expect(prisma.mtmRoutePoint.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ customerId: "c3", orderIndex: 1 })],
    })
  })

  it("refuses to remove a stop with a pending change request", async () => {
    givenRoute("PLANNED", [stop("p1", "c1", 0, "PENDING", 0, 1), stop("p2", "c2", 1)])

    const res = await put({ expectedVersion: 3, points: [{ customerId: "c2" }] })

    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: "ROUTE_POINT_CHANGE_PENDING", pointIds: ["p1"] })
  })

  it("refuses to move a published route to another date or employee", async () => {
    givenRoute("PLANNED", [stop("p1", "c1", 0)])
    const res = await put({ expectedVersion: 3, date: "2026-09-17", points: [{ customerId: "c1" }] })
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: "ROUTE_PUBLISHED_FIELDS_LOCKED" })
    expect(prisma.mtmRoute.updateMany).not.toHaveBeenCalled()
  })

  it("answers a check-in that landed during the save with a version conflict", async () => {
    givenRoute("PLANNED", [stop("p1", "c1", 0), stop("p2", "c2", 1)])
    vi.mocked(prisma.mtmRoutePoint.updateMany).mockResolvedValueOnce({ count: 0 } as never)

    const res = await put({ expectedVersion: 3, points: [{ customerId: "c2" }] })

    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: "ROUTE_VERSION_CONFLICT" })
  })

  it("locks points before the route row, in sorted order, and re-reads them in a new statement", async () => {
    givenRoute("PLANNED", [stop("p2", "c2", 0), stop("p1", "c1", 1)])

    const res = await put({ expectedVersion: 3, points: [{ customerId: "c1" }] })

    expect(res.status).toBe(200)
    const pointLocks = vi.mocked(prisma.$executeRaw).mock.calls
      .map((call, index) => ({ key: String(call[1]), index }))
      .filter((call) => call.key.startsWith("mtm-route-point-check-in:"))
    expect(pointLocks.map((call) => call.key)).toEqual(["mtm-route-point-check-in:org-1:p1", "mtm-route-point-check-in:org-1:p2"])
    const order = (fn: { mock: { invocationCallOrder: number[] } }, index = 0) => fn.mock.invocationCallOrder[index]!
    expect(order(vi.mocked(prisma.$executeRaw), pointLocks.at(-1)!.index)).toBeLessThan(order(vi.mocked(prisma.$queryRaw)))
    expect(order(vi.mocked(prisma.$queryRaw))).toBeLessThan(order(vi.mocked(prisma.mtmRoutePoint.findMany)))
    expect(order(vi.mocked(prisma.mtmRoutePoint.findMany))).toBeLessThan(order(vi.mocked(prisma.mtmRoute.updateMany)))
  })

  it("refuses when a check-in committed while the save waited for the point lock", async () => {
    givenRoute("PLANNED", [stop("p1", "c1", 0), stop("p2", "c2", 1)])
    vi.mocked(prisma.mtmRoutePoint.findMany).mockResolvedValue([stop("p1", "c1", 0, "PENDING", 1), stop("p2", "c2", 1)] as never)

    const res = await put({ expectedVersion: 3, points: [{ customerId: "c2" }] })

    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: "ROUTE_VERSION_CONFLICT" })
    expect(prisma.mtmRoute.updateMany).not.toHaveBeenCalled()
  })

  it("maps a deadlock to a version conflict", async () => {
    givenRoute("PLANNED", [stop("p1", "c1", 0)])
    vi.mocked(prisma.mtmRoute.updateMany).mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError("deadlock detected", { code: "P2010", clientVersion: "6", meta: { code: "40P01" } }),
    )
    const res = await put({ expectedVersion: 3, points: [{ customerId: "c1" }, { customerId: "c2" }] })
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: "ROUTE_VERSION_CONFLICT" })
  })

  it("maps a Prisma transaction timeout (P2028) to a version conflict", async () => {
    givenRoute("PLANNED", [stop("p1", "c1", 0)])
    vi.mocked(prisma.$transaction).mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError("Transaction API error: Transaction already closed", { code: "P2028", clientVersion: "6" }),
    )
    const res = await put({ expectedVersion: 3, points: [{ customerId: "c1" }, { customerId: "c2" }] })
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body).toMatchObject({ code: "ROUTE_VERSION_CONFLICT" })
    expect(JSON.stringify(body)).not.toContain("Transaction API error")
  })

  it("never echoes a raw Prisma error to the browser", async () => {
    givenRoute("PLANNED", [stop("p1", "c1", 0)])
    vi.mocked(prisma.$transaction).mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('Invalid `tx.mtmRoute.updateMany()` column "secret_column"', { code: "P2022", clientVersion: "6" }),
    )
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {})
    const res = await put({ expectedVersion: 3, points: [{ customerId: "c1" }, { customerId: "c2" }] })
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body).toEqual({ error: "Failed to update route", code: "MTM_ROUTE_UPDATE_FAILED" })
    errorLog.mockRestore()
  })

  it("saves a route with an observer although the builder never sends observers", async () => {
    givenRoute("PLANNED", [stop("p1", "c1", 0)], [
      { agentId: "a1", role: "PRIMARY" },
      { agentId: "o1", role: "OBSERVER" },
    ])
    actorMock.resolveMtmRouteActor.mockResolvedValue({ ...manager, scopedAgentIds: ["m1", "a1", "o1"] })

    const res = await put({
      expectedVersion: 3,
      date: "2026-09-16",
      agentId: "a1",
      assignments: [{ agentId: "a1", role: "PRIMARY" }],
      points: [{ customerId: "c1" }, { customerId: "c2" }],
    })

    expect(res.status).toBe(200)
    expect(prisma.mtmRouteAssignment.updateMany).not.toHaveBeenCalled()
  })

  it("runs publish's planning-conflict check and accepts it only with a manager's reason", async () => {
    const busyRoute = {
      id: "r2",
      status: "PLANNED",
      agentId: "a1",
      assignments: [],
      points: [{ customerId: "c7", contactId: null, plannedTime: null, deletedAt: null }],
    }
    givenRoute("PLANNED", [stop("p1", "c1", 0)])
    vi.mocked(prisma.mtmRoute.findMany).mockResolvedValue([busyRoute] as never)

    const refused = await put({ expectedVersion: 3, points: [{ customerId: "c1" }, { customerId: "c2" }] })
    expect(refused.status).toBe(409)
    expect(await refused.json()).toMatchObject({ code: "ROUTE_CONFLICT", conflicts: [{ code: "AGENT_SCHEDULE_CONFLICT", routeId: "r2" }] })
    expect(prisma.mtmRoute.updateMany).not.toHaveBeenCalled()

    givenRoute("PLANNED", [stop("p1", "c1", 0)])
    vi.mocked(prisma.mtmRoute.findMany).mockResolvedValue([busyRoute] as never)
    const accepted = await put({
      expectedVersion: 3,
      overrideReason: "Agent covers both clinics today",
      points: [{ customerId: "c1" }, { customerId: "c2" }],
    })
    expect(accepted.status).toBe(200)
    expect(prisma.mtmRouteChangeRequest.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        routeId: "r1",
        changeType: "CONFLICT_OVERRIDE",
        status: "APPROVED",
        reason: "Agent covers both clinics today",
      }),
    })
  })

  it("does not re-validate targets of stops with field history", async () => {
    givenRoute("IN_PROGRESS", [stop("p1", "c1", 0, "VISITED", 1)])

    const res = await put({ expectedVersion: 3, points: [{ customerId: "c1" }, { customerId: "c2" }] })

    expect(res.status).toBe(200)
    const customerLookups = JSON.stringify(vi.mocked(prisma.mtmCustomer.findMany).mock.calls)
    expect(customerLookups).toContain("c2")
    expect(customerLookups).not.toContain("\"c1\"")
  })

  it("keeps a published route immutable for a field agent on the web path", async () => {
    actorMock.resolveMtmRouteActor.mockResolvedValue({
      agentId: "a1",
      role: "AGENT",
      canPlanOwnRoutes: true,
      canSelfPublishRoutes: true,
      scopedAgentIds: ["a1"],
    })
    givenRoute("PLANNED", [stop("p1", "c1", 0)])

    const res = await put({ expectedVersion: 3, points: [{ customerId: "c1" }, { customerId: "c2" }] })

    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: "ROUTE_PUBLISHED_IMMUTABLE" })
    expect(prisma.mtmRoute.updateMany).not.toHaveBeenCalled()
  })

  it("refuses a manager whose scope does not include the route's employee", async () => {
    actorMock.resolveMtmRouteActor.mockResolvedValue({ ...manager, scopedAgentIds: ["m1", "a9"] })
    givenRoute("PLANNED", [stop("p1", "c1", 0)])

    const res = await put({ expectedVersion: 3, points: [{ customerId: "c1" }, { customerId: "c2" }] })

    expect(res.status).toBe(403)
    expect(prisma.mtmRoute.updateMany).not.toHaveBeenCalled()
  })
})
