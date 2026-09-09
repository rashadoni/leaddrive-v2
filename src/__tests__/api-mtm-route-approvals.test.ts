import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/prisma", async () => {
  const { makeMtmPrismaMock } = await import("./mocks/mtm-prisma")
  return { prisma: makeMtmPrismaMock() }
})

vi.mock("@/lib/api-auth", () => ({
  requireAuth: vi.fn(),
  isAuthError: (value: unknown) => value instanceof Response,
}))

vi.mock("@/lib/mobile-auth", async () => {
  const { makeMobileAuthMock } = await import("./mocks/mobile-auth")
  return makeMobileAuthMock()
})

vi.mock("@/lib/mtm-audit", () => ({
  writeMtmAudit: vi.fn(() => Promise.resolve()),
}))

import { POST as publishRoute } from "@/app/api/v1/mtm/routes/[id]/publish/route"
import { POST as createChangeRequest } from "@/app/api/v1/mtm/routes/[id]/change-requests/route"
import { GET as listChangeRequests } from "@/app/api/v1/mtm/route-change-requests/route"
import { POST as decideChangeRequest } from "@/app/api/v1/mtm/route-change-requests/[id]/decision/route"
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/lib/api-auth"
import { getMobileAuth, resolveMobileAuth } from "@/lib/mobile-auth"
import { writeMtmAudit } from "@/lib/mtm-audit"

const ORG = "org-1"
const adminAuth = {
  orgId: ORG,
  userId: "admin-user",
  role: "admin",
  email: "admin@example.com",
  name: "Admin",
}

const draftRoute = {
  id: "route-1",
  organizationId: ORG,
  agentId: "agent-1",
  date: new Date("2026-07-13"),
  name: "North route",
  notes: null,
  status: "DRAFT",
  version: 3,
  publishedVersion: null,
  publishedAt: null,
  visitedPoints: 0,
  startedAt: null,
  completedAt: null,
  updatedAt: new Date("2026-07-12T09:00:00.000Z"),
  dedupeKey: "fingerprint-1",
  totalPoints: 1,
  assignments: [{ agentId: "agent-1", role: "PRIMARY", assignedAt: new Date("2026-07-12T08:00:00.000Z") }],
  points: [{
    id: "point-1",
    routeId: "route-1",
    customerId: "customer-1",
    contactId: null,
    orderIndex: 0,
    status: "PENDING",
    version: 1,
    plannedTime: null,
    visitedAt: null,
    updatedAt: new Date("2026-07-12T09:00:00.000Z"),
    deletedAt: null,
    visits: [],
  }],
}

function jsonRequest(path: string, body: unknown): NextRequest {
  return new NextRequest(new URL(path, "http://localhost:3000"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

function routeParams(id = "route-1") {
  return { params: Promise.resolve({ id }) }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getMobileAuth).mockReturnValue(null)
  vi.mocked(resolveMobileAuth).mockResolvedValue(null)
  vi.mocked(requireAuth).mockResolvedValue(adminAuth as any)
  vi.mocked(writeMtmAudit).mockResolvedValue(undefined as never)
  vi.mocked(prisma.mtmRoute.findMany).mockResolvedValue([])
  vi.mocked(prisma.mtmSetting.findUnique).mockResolvedValue(null)
  vi.mocked(prisma.mtmRouteChangeRequest.findFirst).mockResolvedValue(null)
  vi.mocked(prisma.mtmRouteChangeRequest.findMany).mockResolvedValue([])
  vi.mocked(prisma.mtmRoute.updateMany).mockResolvedValue({ count: 1 } as any)
  vi.mocked(prisma.mtmRoutePoint.updateMany).mockResolvedValue({ count: 1 } as any)
  vi.mocked(prisma.mtmRoutePoint.count).mockResolvedValue(0)
  vi.mocked(prisma.mtmRoutePoint.aggregate).mockResolvedValue({ _max: { orderIndex: 2 } } as never)
})

describe("POST /mtm/routes/[id]/publish", () => {
  it("publishes a conflict-free draft and audits the transition", async () => {
    vi.mocked(prisma.mtmRoute.findFirst).mockResolvedValueOnce(draftRoute as any)

    const response = await publishRoute(jsonRequest("/api/v1/mtm/routes/route-1/publish", { expectedVersion: 3 }), routeParams())
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      success: true,
      data: { status: "PLANNED", version: 4, publishedVersion: 4 },
    })
    expect(prisma.mtmRoute.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: "DRAFT", version: 3 }),
      data: expect.objectContaining({
        status: "PLANNED",
        version: { increment: 1 },
        publishedVersion: 4,
        publishedBy: "admin-user",
      }),
    }))
    expect(prisma.mtmRouteNotificationOutbox.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        agentId: "agent-1",
        metadata: expect.objectContaining({ routeId: "route-1", publishedVersion: 4 }),
      }),
      update: {},
    }))
    expect(prisma.mtmMobileSyncChange.create).not.toHaveBeenCalled()
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1)
    expect(writeMtmAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "ROUTE_PUBLISH" }))
  })

  it("publishes with a non-blocking coordination notice for another agent at the same customer and time", async () => {
    const plannedTime = new Date("2026-07-13T09:00:00.000Z")
    vi.mocked(prisma.mtmRoute.findFirst)
      .mockResolvedValueOnce({
        ...draftRoute,
        points: [{ ...draftRoute.points[0], plannedTime }],
      } as any)
    vi.mocked(prisma.mtmRoute.findMany).mockResolvedValue([{
      id: "colleague-route",
      status: "PLANNED",
      agentId: "agent-2",
      assignments: [],
      points: [{
        customerId: "customer-1",
        contactId: null,
        plannedTime,
        deletedAt: null,
      }],
    }] as any)

    const response = await publishRoute(
      jsonRequest("/api/v1/mtm/routes/route-1/publish", { expectedVersion: 3 }),
      routeParams(),
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      success: true,
      data: { status: "PLANNED", version: 4, publishedVersion: 4 },
      meta: {
        coordination: [{
          code: "COORDINATED_MEETING",
          routeId: "colleague-route",
          agentIds: ["agent-2"],
          customerIds: ["customer-1"],
          plannedTimes: ["2026-07-13T09:00:00.000Z"],
        }],
      },
    })
    expect(prisma.mtmRoute.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: "DRAFT", version: 3 }),
    }))
    expect(prisma.mtmRouteChangeRequest.create).not.toHaveBeenCalled()
    expect(writeMtmAudit).toHaveBeenCalledWith(expect.objectContaining({
      newData: expect.objectContaining({
        coordination: [expect.objectContaining({ code: "COORDINATED_MEETING" })],
      }),
    }))
  })

  it("rejects a direct agent publish when the tenant switch is on but the manager did not grant that agent", async () => {
    vi.mocked(requireAuth).mockResolvedValue({
      orgId: ORG,
      userId: "agent-user",
      role: "sales",
      email: "agent@example.com",
      name: "Agent",
    } as any)
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({
      id: "agent-1",
      role: "AGENT",
      canPlanOwnRoutes: true,
      canSelfPublishRoutes: false,
    } as any)
    vi.mocked(prisma.mtmSetting.findUnique).mockResolvedValue({ value: true } as any)
    vi.mocked(prisma.mtmRoute.findFirst).mockResolvedValue(draftRoute as any)

    const response = await publishRoute(
      jsonRequest("/api/v1/mtm/routes/route-1/publish", { expectedVersion: 3 }),
      routeParams(),
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({ code: "MTM_ROUTE_SCOPE_DENIED" })
    expect(prisma.mtmRoute.updateMany).not.toHaveBeenCalled()
  })

  it("replays a successful publish after the client loses the response", async () => {
    const publishedAt = new Date("2026-07-13T08:00:00.000Z")
    vi.mocked(prisma.mtmRoute.findFirst).mockResolvedValue({
      ...draftRoute,
      status: "PLANNED",
      version: 4,
      publishedVersion: 4,
      publishedAt,
    } as any)

    const response = await publishRoute(jsonRequest("/api/v1/mtm/routes/route-1/publish", { expectedVersion: 3 }), routeParams())

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      success: true,
      idempotent: true,
      data: {
        id: "route-1",
        status: "PLANNED",
        version: 4,
        publishedVersion: 4,
        publishedAt: publishedAt.toISOString(),
      },
    })
    expect(prisma.mtmRoute.updateMany).not.toHaveBeenCalled()
    expect(writeMtmAudit).not.toHaveBeenCalled()
  })

  it("returns structured conflicts without publishing", async () => {
    vi.mocked(prisma.mtmRoute.findFirst).mockResolvedValue(draftRoute as any)
    vi.mocked(prisma.mtmRoute.findMany).mockResolvedValue([{
      id: "route-existing",
      status: "PLANNED",
      agentId: "agent-1",
      assignments: [],
      points: [],
    }] as any)

    const response = await publishRoute(jsonRequest("/api/v1/mtm/routes/route-1/publish", { expectedVersion: 3 }), routeParams())
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({
      code: "ROUTE_CONFLICT",
      conflicts: [{ code: "AGENT_SCHEDULE_CONFLICT", routeId: "route-existing" }],
    })
    expect(prisma.$transaction).toHaveBeenCalledTimes(1)
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1)
    expect(prisma.mtmRoute.updateMany).not.toHaveBeenCalled()
  })

  it("blocks duplicate stop times inside a draft before publishing", async () => {
    vi.mocked(prisma.mtmRoute.findFirst).mockResolvedValue({
      ...draftRoute,
      totalPoints: 2,
      points: [
        { ...draftRoute.points[0], plannedTime: new Date("2026-07-13T09:00:00.000Z") },
        {
          id: "point-2",
          customerId: "customer-2",
          contactId: null,
          plannedTime: new Date("2026-07-13T09:00:00.000Z"),
          status: "PENDING",
          deletedAt: null,
          visits: [],
        },
      ],
    } as any)

    const response = await publishRoute(jsonRequest("/api/v1/mtm/routes/route-1/publish", { expectedVersion: 3 }), routeParams())

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({
      code: "ROUTE_POINT_TIME_CONFLICT",
      conflicts: [{
        plannedTime: "2026-07-13T09:00:00.000Z",
        pointIndexes: [0, 1],
        customerIds: ["customer-1", "customer-2"],
      }],
    })
    expect(prisma.mtmRoute.findMany).not.toHaveBeenCalled()
    expect(prisma.mtmRoute.updateMany).not.toHaveBeenCalled()
  })

  it("records a manager override reason before publishing a conflicting draft", async () => {
    vi.mocked(prisma.mtmRoute.findFirst).mockResolvedValue(draftRoute as any)
    vi.mocked(prisma.mtmRoute.findMany).mockResolvedValue([{
      id: "route-existing",
      status: "PLANNED",
      agentId: "agent-1",
      assignments: [],
      points: [],
    }] as any)
    vi.mocked(prisma.mtmRouteChangeRequest.create).mockResolvedValue({ id: "override-1" } as any)

    const response = await publishRoute(jsonRequest("/api/v1/mtm/routes/route-1/publish", {
      expectedVersion: 3,
      overrideReason: "Coverage is shared for the joint visit",
    }), routeParams())
    expect(response.status).toBe(200)
    expect(prisma.mtmRouteChangeRequest.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: "APPROVED",
        changeType: "CONFLICT_OVERRIDE",
        payload: expect.objectContaining({
          evidence: expect.objectContaining({
            before: expect.objectContaining({ route: expect.objectContaining({ id: "route-1", version: 3, status: "DRAFT" }) }),
            outcomes: expect.arrayContaining([expect.objectContaining({
              decision: "APPROVED",
              after: expect.objectContaining({ route: expect.objectContaining({ version: 4, status: "PLANNED" }) }),
            })]),
          }),
        }),
      }),
    }))
  })

  it("denies agent self-publish when the setting is disabled", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ ...adminAuth, userId: "user-agent", role: "sales" } as any)
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ id: "agent-1", role: "AGENT" } as any)
    vi.mocked(prisma.mtmRoute.findFirst).mockResolvedValue(draftRoute as any)

    const response = await publishRoute(jsonRequest("/api/v1/mtm/routes/route-1/publish", { expectedVersion: 3 }), routeParams())
    expect(response.status).toBe(403)
    expect(prisma.mtmRoute.updateMany).not.toHaveBeenCalled()
  })

  it("rejects a stale publish without changing the route", async () => {
    vi.mocked(prisma.mtmRoute.findFirst).mockResolvedValue(draftRoute as any)

    const response = await publishRoute(jsonRequest("/api/v1/mtm/routes/route-1/publish", {
      expectedVersion: 2,
    }), routeParams())

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({
      code: "ROUTE_VERSION_CONFLICT",
      currentVersion: 3,
    })
    expect(prisma.mtmRoute.updateMany).not.toHaveBeenCalled()
    expect(prisma.mtmRouteNotificationOutbox.upsert).not.toHaveBeenCalled()
  })
})

describe("route change requests", () => {
  it("submits stop removal without changing the stop", async () => {
    vi.mocked(prisma.mtmRoute.findFirst).mockResolvedValue({ ...draftRoute, status: "PLANNED" } as any)
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ name: "Agent One", managerId: "manager-1" } as any)
    vi.mocked(prisma.mtmRouteChangeRequest.create).mockResolvedValue({
      id: "request-1",
      routeId: "route-1",
      routePointId: "point-1",
      status: "SUBMITTED",
    } as any)

    const response = await createChangeRequest(jsonRequest("/api/v1/mtm/routes/route-1/change-requests", {
      changeType: "REMOVE_STOP",
      routePointId: "point-1",
      reason: "Customer requested a different day",
      payload: { reasonCode: "CUSTOMER_REQUEST", source: "OPERATIONAL_WEEK" },
    }), routeParams())
    expect(response.status).toBe(201)
    expect(prisma.mtmRoutePoint.updateMany).not.toHaveBeenCalled()
    expect(prisma.mtmRouteChangeRequest.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        requestedByAgentId: "agent-1",
        status: "SUBMITTED",
        payload: expect.objectContaining({
          reasonCode: "CUSTOMER_REQUEST",
          source: "OPERATIONAL_WEEK",
          evidence: expect.objectContaining({
            schemaVersion: 1,
            before: expect.objectContaining({
              route: expect.objectContaining({ id: "route-1", version: 3, totalPoints: 1 }),
              routePoint: expect.objectContaining({ id: "point-1", orderIndex: 0, status: "PENDING" }),
            }),
          }),
        }),
      }),
    }))
    expect(prisma.mtmRouteNotificationOutbox.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ agentId: "manager-1", type: "task" }),
      update: {},
    }))
    expect(prisma.mtmNotification.create).not.toHaveBeenCalled()
    expect(prisma.mtmAuditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "ROUTE_REMOVAL_REQUEST",
        metadataKind: "route_removal_request",
        entityId: "request-1",
      }),
    })
  })

  it("rejects an unknown cancellation reason code", async () => {
    vi.mocked(prisma.mtmRoute.findFirst).mockResolvedValue({ ...draftRoute, status: "PLANNED" } as any)

    const response = await createChangeRequest(jsonRequest("/api/v1/mtm/routes/route-1/change-requests", {
      changeType: "REMOVE_STOP",
      routePointId: "point-1",
      reason: "Unclassified cancellation",
      payload: { reasonCode: "MADE_UP_REASON" },
    }), routeParams())

    expect(response.status).toBe(400)
    expect(prisma.mtmRouteChangeRequest.create).not.toHaveBeenCalled()
  })

  it("blocks a removal request after the stop visit has started", async () => {
    vi.mocked(prisma.mtmRoute.findFirst).mockResolvedValue({
      ...draftRoute,
      status: "IN_PROGRESS",
      points: [{ ...draftRoute.points[0], visits: [{ id: "visit-1" }] }],
    } as any)

    const response = await createChangeRequest(jsonRequest("/api/v1/mtm/routes/route-1/change-requests", {
      changeType: "REMOVE_STOP",
      routePointId: "point-1",
      reason: "Customer asked to stop",
    }), routeParams())

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: "ROUTE_POINT_VISIT_STARTED" })
    expect(prisma.mtmRouteChangeRequest.create).not.toHaveBeenCalled()
  })

  it("returns an open request idempotently", async () => {
    vi.mocked(prisma.mtmRoute.findFirst).mockResolvedValue({ ...draftRoute, status: "PLANNED" } as any)
    vi.mocked(prisma.mtmRouteChangeRequest.findMany).mockResolvedValue([{ id: "request-open", status: "SUBMITTED" }] as any)

    const response = await createChangeRequest(jsonRequest("/api/v1/mtm/routes/route-1/change-requests", {
      changeType: "REMOVE_STOP",
      routePointId: "point-1",
      reason: "Customer requested a different day",
    }), routeParams())
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ idempotent: true, data: { id: "request-open" } })
    expect(prisma.mtmRouteChangeRequest.create).not.toHaveBeenCalled()
  })

  it("submits a published-route stop addition for approval", async () => {
    vi.mocked(prisma.mtmRoute.findFirst).mockResolvedValue({
      ...draftRoute,
      status: "PLANNED",
      points: [{ ...draftRoute.points[0], customerId: "customer-1" }],
    } as never)
    vi.mocked(prisma.mtmCustomer.findMany).mockResolvedValue([{ id: "customer-2" }] as never)
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ name: "Agent One", managerId: "manager-1" } as never)
    vi.mocked(prisma.mtmRouteChangeRequest.create).mockResolvedValue({ id: "request-add", status: "SUBMITTED" } as never)

    const response = await createChangeRequest(jsonRequest("/api/v1/mtm/routes/route-1/change-requests", {
      changeType: "ADD_STOP",
      reason: "Newly approved customer",
      payload: { customerId: "customer-2" },
    }), routeParams())

    expect(response.status).toBe(201)
    expect(prisma.mtmRouteChangeRequest.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ changeType: "ADD_STOP", payload: expect.objectContaining({ customerId: "customer-2" }) }),
    }))
    expect(prisma.mtmRoutePoint.create).not.toHaveBeenCalled()
  })

  it("blocks a mobile add-stop request outside the route owner's effective assignments", async () => {
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
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({
      id: "agent-mobile",
      role: "AGENT",
      canPlanOwnRoutes: true,
    } as never)
    vi.mocked(prisma.mtmRoute.findFirst).mockResolvedValue({
      ...draftRoute,
      agentId: "agent-mobile",
      status: "PLANNED",
      assignments: [{ agentId: "agent-mobile", role: "PRIMARY" }],
      points: [],
    } as never)
    // Two different questions to the same model: existence, then shared
    // eligibility. Nothing ties this customer to the owner, so the second
    // answer is empty and the add-stop request stays refused.
    vi.mocked(prisma.mtmCustomer.findMany).mockImplementation(((args: { where?: { AND?: unknown } }) =>
      Promise.resolve(args?.where?.AND ? [] : [{ id: "unassigned-customer", agentAssignments: [] }])) as never)

    const response = await createChangeRequest(jsonRequest("/api/v1/mtm/routes/route-1/change-requests", {
      changeType: "ADD_STOP",
      reason: "Requested from field",
      payload: { customerId: "unassigned-customer" },
    }), routeParams())

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ code: "MTM_ROUTE_TARGET_ASSIGNMENT_REQUIRED" })
    expect(prisma.mtmRouteChangeRequest.create).not.toHaveBeenCalled()
  })

  it("keeps approval requests for two doctors at one clinic separate", async () => {
    vi.mocked(prisma.mtmRoute.findFirst).mockResolvedValue({
      ...draftRoute,
      status: "PLANNED",
      points: [],
    } as never)
    vi.mocked(prisma.mtmCustomer.findMany).mockResolvedValue([{ id: "clinic-1" }] as never)
    vi.mocked(prisma.mtmContact.findMany).mockResolvedValue([{
      id: "doctor-2",
      workplaces: [{ customerId: "clinic-1" }],
    }] as never)
    vi.mocked(prisma.mtmRouteChangeRequest.findMany).mockResolvedValue([{
      id: "doctor-1-request",
      payload: { customerId: "clinic-1", contactId: "doctor-1" },
    }] as never)
    vi.mocked(prisma.mtmRouteChangeRequest.create).mockResolvedValue({ id: "doctor-2-request" } as never)

    const response = await createChangeRequest(jsonRequest("/api/v1/mtm/routes/route-1/change-requests", {
      changeType: "ADD_STOP",
      reason: "Doctor requested a separate visit",
      payload: { customerId: "clinic-1", contactId: "doctor-2" },
    }), routeParams())

    expect(response.status).toBe(201)
    expect(prisma.mtmRouteChangeRequest.create).toHaveBeenCalled()
  })

  it("lists the manager approval queue with additive evidence and honest legacy markers", async () => {
    vi.mocked(prisma.mtmRouteChangeRequest.findMany).mockResolvedValue([{
      id: "request-1",
      payload: {
        evidence: {
          schemaVersion: 1,
          capturedAt: "2026-07-13T08:00:00.000Z",
          before: {
            route: {
              id: "route-1",
              version: 3,
              publishedVersion: null,
              status: "PLANNED",
              date: "2026-07-13T00:00:00.000Z",
              totalPoints: 1,
              agentId: "agent-1",
            },
            routePoint: null,
          },
          proposed: { changeType: "ADD_STOP", routePointId: null, target: { customerId: "customer-2", contactId: null } },
          outcomes: [],
        },
      },
    }, { id: "legacy-request", payload: { customerId: "customer-legacy" } }] as any)
    const response = await listChangeRequests(new NextRequest("http://localhost:3000/api/v1/mtm/route-change-requests"))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      data: {
        requests: [
          { id: "request-1", legacySnapshot: false, evidence: { before: { route: { version: 3 } } } },
          { id: "legacy-request", legacySnapshot: true, evidence: null },
        ],
      },
    })
  })

  it("approves removal atomically and recalculates route totals", async () => {
    vi.mocked(prisma.mtmRouteChangeRequest.findFirst).mockResolvedValue({
      id: "request-1",
      organizationId: ORG,
      routeId: "route-1",
      routePointId: "point-1",
      requestedByAgentId: "agent-1",
      changeType: "REMOVE_STOP",
      status: "SUBMITTED",
      route: { id: "route-1", agentId: "agent-1", date: new Date("2026-07-13"), status: "PLANNED", version: 4, publishedVersion: 4, totalPoints: 1, assignments: [] },
      routePoint: { id: "point-1", status: "PENDING", deletedAt: null, visits: [] },
    } as any)
    vi.mocked(prisma.mtmRouteChangeRequest.updateMany).mockResolvedValue({ count: 1 } as any)
    const response = await decideChangeRequest(jsonRequest("/api/v1/mtm/route-change-requests/request-1/decision", {
      decision: "APPROVED",
      comment: "Approved",
    }), routeParams("request-1"))
    expect(response.status).toBe(200)
    expect(prisma.mtmRoutePoint.updateMany).toHaveBeenCalled()
    expect(prisma.mtmRoute.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ version: 4 }),
      data: {
        totalPoints: 0,
        version: { increment: 1 },
        publishedVersion: 5,
      },
    }))
    expect(prisma.mtmMobileSyncChange.create).not.toHaveBeenCalled()
    expect(prisma.mtmRouteNotificationOutbox.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ agentId: "agent-1", type: "info" }),
      update: {},
    }))
    expect(prisma.mtmNotification.create).not.toHaveBeenCalled()
    expect(prisma.mtmAuditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "ROUTE_REMOVAL_DECISION",
        metadataKind: "route_removal_decision",
        newData: expect.objectContaining({
          status: "APPROVED",
          impact: { plannedStops: -1, eligibleStops: -1, routeVersion: 5 },
        }),
      }),
    })
  })

  it("appends a version-bound after snapshot for evidence-bearing requests", async () => {
    vi.mocked(prisma.mtmRouteChangeRequest.findFirst).mockResolvedValue({
      id: "request-evidence",
      organizationId: ORG,
      routeId: "route-1",
      routePointId: "point-1",
      requestedByAgentId: "agent-1",
      changeType: "REMOVE_STOP",
      status: "SUBMITTED",
      payload: {
        evidence: {
          schemaVersion: 1,
          capturedAt: "2026-07-12T09:00:00.000Z",
          before: {
            route: {
              id: "route-1",
              version: 4,
              publishedVersion: 4,
              status: "PLANNED",
              date: "2026-07-13T00:00:00.000Z",
              totalPoints: 1,
              agentId: "agent-1",
            },
            routePoint: {
              id: "point-1",
              customerId: "customer-1",
              contactId: null,
              orderIndex: 0,
              status: "PENDING",
              plannedTime: "2026-07-13T09:00:00.000Z",
              deletedAt: null,
            },
          },
          proposed: { changeType: "REMOVE_STOP", routePointId: "point-1", target: null },
          outcomes: [],
        },
      },
      route: { id: "route-1", agentId: "agent-1", date: new Date("2026-07-13"), status: "PLANNED", version: 4, publishedVersion: 4, totalPoints: 1, assignments: [] },
      routePoint: { id: "point-1", customerId: "customer-1", contactId: null, orderIndex: 0, plannedTime: new Date("2026-07-13T09:00:00.000Z"), status: "PENDING", deletedAt: null, visits: [] },
    } as any)
    vi.mocked(prisma.mtmRouteChangeRequest.updateMany).mockResolvedValue({ count: 1 } as any)
    const response = await decideChangeRequest(jsonRequest("/api/v1/mtm/route-change-requests/request-evidence/decision", {
      decision: "APPROVED",
      comment: "Approved",
    }), routeParams("request-evidence"))

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      data: {
        legacySnapshot: false,
        evidence: {
          outcomes: [{
            decision: "APPROVED",
            after: {
              route: { id: "route-1", version: 5, publishedVersion: 5, totalPoints: 0 },
              routePoint: { id: "point-1", deletedAt: expect.any(String) },
            },
          }],
        },
      },
    })
    expect(prisma.mtmRouteChangeRequest.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        payload: expect.objectContaining({ evidence: expect.objectContaining({ outcomes: expect.any(Array) }) }),
      }),
    }))
    expect(prisma.mtmAuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        newData: expect.objectContaining({ legacySnapshot: false, evidence: expect.objectContaining({ outcomes: expect.any(Array) }) }),
      }),
    }))
  })

  it("blocks approval if a visit started after the request was submitted", async () => {
    vi.mocked(prisma.mtmRouteChangeRequest.findFirst).mockResolvedValue({
      id: "request-1",
      organizationId: ORG,
      routeId: "route-1",
      routePointId: "point-1",
      requestedByAgentId: "agent-1",
      changeType: "REMOVE_STOP",
      status: "SUBMITTED",
      route: { id: "route-1", agentId: "agent-1", date: new Date("2026-07-13"), status: "IN_PROGRESS", version: 4, publishedVersion: 4, totalPoints: 1, assignments: [] },
      routePoint: { id: "point-1", status: "PENDING", deletedAt: null, visits: [{ id: "visit-1" }] },
    } as any)

    const response = await decideChangeRequest(jsonRequest("/api/v1/mtm/route-change-requests/request-1/decision", {
      decision: "APPROVED",
    }), routeParams("request-1"))

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: "ROUTE_POINT_VISIT_STARTED" })
    expect(prisma.mtmRoutePoint.updateMany).not.toHaveBeenCalled()
  })

  it("adds a stop only after manager approval", async () => {
    vi.mocked(prisma.mtmRouteChangeRequest.findFirst).mockResolvedValue({
      id: "request-add",
      organizationId: ORG,
      routeId: "route-1",
      routePointId: null,
      requestedByAgentId: "agent-1",
      changeType: "ADD_STOP",
      status: "SUBMITTED",
      payload: { customerId: "customer-2" },
      route: { id: "route-1", agentId: "agent-1", date: new Date("2026-07-13"), status: "PLANNED", version: 8, publishedVersion: 8, totalPoints: 1, assignments: [] },
      routePoint: null,
    } as never)
    vi.mocked(prisma.mtmCustomer.findMany).mockResolvedValue([{ id: "customer-2" }] as never)
    vi.mocked(prisma.mtmRoutePoint.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.mtmRouteChangeRequest.updateMany).mockResolvedValue({ count: 1 } as never)
    vi.mocked(prisma.mtmRoutePoint.count).mockResolvedValue(2)
    vi.mocked(prisma.mtmRoutePoint.create).mockResolvedValue({ id: "point-added" } as never)
    const response = await decideChangeRequest(jsonRequest("/api/v1/mtm/route-change-requests/request-add/decision", {
      decision: "APPROVED",
    }), routeParams("request-add"))

    expect(response.status).toBe(200)
    expect(prisma.mtmRoutePoint.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ routeId: "route-1", customerId: "customer-2", contactId: null, orderIndex: 3 }),
    }))
    expect(prisma.mtmRoute.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ version: 8 }),
      data: {
        totalPoints: 2,
        version: { increment: 1 },
        publishedVersion: 9,
      },
    }))
    expect(prisma.mtmMobileSyncChange.create).not.toHaveBeenCalled()
  })

  it("reschedules a cancelled stop into a scoped draft route atomically", async () => {
    vi.mocked(prisma.mtmRouteChangeRequest.findFirst).mockResolvedValue({
      id: "request-reschedule",
      organizationId: ORG,
      routeId: "route-1",
      routePointId: "point-1",
      requestedByAgentId: "agent-1",
      changeType: "REMOVE_STOP",
      status: "SUBMITTED",
      payload: { reasonCode: "CUSTOMER_REQUEST" },
      route: { id: "route-1", agentId: "agent-1", date: new Date("2026-07-13"), status: "PLANNED", version: 4, publishedVersion: 4, totalPoints: 1, assignments: [] },
      routePoint: { id: "point-1", status: "PENDING", customerId: "customer-1", contactId: null, plannedTime: new Date("2026-07-13T09:30:00.000Z"), notes: "Bring samples", deletedAt: null, visits: [] },
    } as never)
    vi.mocked(prisma.mtmRouteChangeRequest.updateMany).mockResolvedValue({ count: 1 } as never)
    vi.mocked(prisma.mtmRoute.findFirst).mockResolvedValue({ id: "route-draft", version: 2 } as never)
    vi.mocked(prisma.mtmRoutePoint.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.mtmRoutePoint.aggregate).mockResolvedValue({ _max: { orderIndex: 1 } } as never)
    vi.mocked(prisma.mtmRoutePoint.create).mockResolvedValue({ id: "point-replacement" } as never)
    vi.mocked(prisma.mtmRoutePoint.count).mockResolvedValueOnce(0).mockResolvedValueOnce(2)
    vi.mocked(prisma.mtmCustomer.findMany).mockResolvedValue([{ id: "customer-1" }] as never)
    const response = await decideChangeRequest(jsonRequest("/api/v1/mtm/route-change-requests/request-reschedule/decision", {
      decision: "RESCHEDULE",
      rescheduleDate: "2026-07-20",
    }), routeParams("request-reschedule"))

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      data: { status: "APPROVED", resolution: "RESCHEDULE" },
    })
    expect(prisma.mtmRoutePoint.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        routeId: "route-draft",
        customerId: "customer-1",
        orderIndex: 2,
        plannedTime: new Date("2026-07-20T09:30:00.000Z"),
      }),
      select: { id: true },
    })
    expect(prisma.mtmRouteChangeRequest.update).toHaveBeenCalledWith({
      where: { id: "request-reschedule" },
      data: { payload: expect.objectContaining({
        resolution: "RESCHEDULE",
        rescheduleDate: "2026-07-20",
        rescheduledRouteId: "route-draft",
        rescheduledRoutePointId: "point-replacement",
      }) },
    })
    expect(prisma.mtmRoute.updateMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: expect.objectContaining({ id: "route-draft", version: 2, status: "DRAFT" }),
      data: { totalPoints: 2, version: { increment: 1 } },
    }))
    expect(prisma.mtmMobileSyncChange.create).not.toHaveBeenCalled()
  })

  it("creates a primary assignment for a new reschedule destination", async () => {
    vi.mocked(prisma.mtmRouteChangeRequest.findFirst).mockResolvedValue({
      id: "request-reschedule-create",
      organizationId: ORG,
      routeId: "route-1",
      routePointId: "point-1",
      requestedByAgentId: "agent-requester",
      changeType: "REMOVE_STOP",
      status: "SUBMITTED",
      payload: { reasonCode: "CUSTOMER_REQUEST" },
      route: { id: "route-1", agentId: "agent-1", date: new Date("2026-07-13"), status: "PLANNED", version: 4, publishedVersion: 4, totalPoints: 1, assignments: [] },
      routePoint: { id: "point-1", status: "PENDING", customerId: "customer-1", contactId: null, plannedTime: new Date("2026-07-13T09:30:00.000Z"), notes: "Bring samples", deletedAt: null, visits: [] },
    } as never)
    vi.mocked(prisma.mtmRouteChangeRequest.updateMany).mockResolvedValue({ count: 1 } as never)
    vi.mocked(prisma.mtmCustomer.findMany).mockResolvedValue([{ id: "customer-1" }] as never)
    vi.mocked(prisma.mtmRoute.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.mtmRoute.create).mockResolvedValue({ id: "route-new", version: 1 } as never)
    vi.mocked(prisma.mtmRoutePoint.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.mtmRoutePoint.create).mockResolvedValue({ id: "point-replacement" } as never)
    vi.mocked(prisma.mtmRoutePoint.count).mockResolvedValue(0)
    const response = await decideChangeRequest(jsonRequest("/api/v1/mtm/route-change-requests/request-reschedule-create/decision", {
      decision: "RESCHEDULE",
      rescheduleDate: "2026-07-20",
    }), routeParams("request-reschedule-create"))

    expect(response.status).toBe(200)
    expect(prisma.mtmRoute.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: ORG,
        agentId: "agent-1",
        assignments: {
          create: {
            organizationId: ORG,
            agentId: "agent-1",
            role: "PRIMARY",
            assignedBy: "admin-user",
          },
        },
      }),
      select: { id: true, version: true },
    })
    expect(prisma.mtmMobileSyncScopeRevision.upsert).not.toHaveBeenCalled()
  })

  it("rejects a reschedule date that does not follow the original route", async () => {
    vi.mocked(prisma.mtmRouteChangeRequest.findFirst).mockResolvedValue({
      id: "request-reschedule",
      requestedByAgentId: "agent-1",
      changeType: "REMOVE_STOP",
      status: "SUBMITTED",
      payload: {},
      route: { id: "route-1", agentId: "agent-1", date: new Date("2026-07-13"), status: "PLANNED", version: 4, publishedVersion: 4, totalPoints: 1, assignments: [] },
      routePoint: { id: "point-1", status: "PENDING", customerId: "customer-1", contactId: null, plannedTime: null, notes: null, deletedAt: null, visits: [] },
    } as never)

    const response = await decideChangeRequest(jsonRequest("/api/v1/mtm/route-change-requests/request-reschedule/decision", {
      decision: "RESCHEDULE",
      rescheduleDate: "2026-07-13",
    }), routeParams("request-reschedule"))

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ code: "MTM_RESCHEDULE_DATE_INVALID" })
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it("rejects rescheduling to a non-working day when calendar enforcement is enabled", async () => {
    vi.mocked(prisma.mtmRouteChangeRequest.findFirst).mockResolvedValue({
      id: "request-reschedule",
      requestedByAgentId: "agent-1",
      changeType: "REMOVE_STOP",
      status: "SUBMITTED",
      payload: {},
      route: { id: "route-1", agentId: "agent-1", date: new Date("2026-07-13"), status: "PLANNED", version: 4, publishedVersion: 4, totalPoints: 1, assignments: [] },
      routePoint: { id: "point-1", status: "PENDING", customerId: "customer-1", contactId: null, plannedTime: null, notes: null, deletedAt: null, visits: [] },
    } as never)
    vi.mocked(prisma.mtmCustomer.findMany).mockResolvedValue([{ id: "customer-1" }] as never)
    vi.mocked(prisma.mtmSetting.findMany).mockResolvedValue([{
      key: "enforceWorkCalendarForRoutes",
      value: true,
    }] as never)
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ id: "agent-1", teamId: "team-1" } as never)

    const response = await decideChangeRequest(jsonRequest("/api/v1/mtm/route-change-requests/request-reschedule/decision", {
      decision: "RESCHEDULE",
      rescheduleDate: "2026-07-18",
    }), routeParams("request-reschedule"))

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({
      code: "MTM_ROUTE_NON_WORKING_DAY",
      calendarDay: {
        date: "2026-07-18",
        kind: "WEEKEND",
        routePlanningAllowed: false,
      },
    })
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it("returns the same completed decision idempotently", async () => {
    vi.mocked(prisma.mtmRouteChangeRequest.findFirst).mockResolvedValue({
      id: "request-1",
      requestedByAgentId: "agent-1",
      status: "APPROVED",
      changeType: "REMOVE_STOP",
      route: { id: "route-1", agentId: "agent-1", status: "PLANNED", version: 5, publishedVersion: 5, totalPoints: 0, assignments: [] },
      routePoint: { id: "point-1", status: "PENDING", deletedAt: new Date() },
    } as any)

    const response = await decideChangeRequest(jsonRequest("/api/v1/mtm/route-change-requests/request-1/decision", {
      decision: "APPROVED",
    }), routeParams("request-1"))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ idempotent: true })
    expect(prisma.mtmRouteChangeRequest.updateMany).not.toHaveBeenCalled()
    expect(prisma.mtmMobileSyncChange.create).not.toHaveBeenCalled()
  })

  it("does not journal a decision that only changes the request", async () => {
    vi.mocked(prisma.mtmRouteChangeRequest.findFirst).mockResolvedValue({
      id: "request-conflict",
      organizationId: ORG,
      routeId: "route-1",
      routePointId: null,
      requestedByAgentId: "agent-1",
      changeType: "CONFLICT_OVERRIDE",
      status: "SUBMITTED",
      payload: {},
      route: { id: "route-1", agentId: "agent-1", date: new Date("2026-07-13"), status: "PLANNED", version: 5, publishedVersion: 5, totalPoints: 1, assignments: [] },
      routePoint: null,
    } as never)
    vi.mocked(prisma.mtmRouteChangeRequest.updateMany).mockResolvedValue({ count: 1 } as never)

    const response = await decideChangeRequest(jsonRequest("/api/v1/mtm/route-change-requests/request-conflict/decision", {
      decision: "REJECTED",
      comment: "The conflict override is not approved",
    }), routeParams("request-conflict"))

    expect(response.status).toBe(200)
    expect(prisma.mtmMobileSyncChange.create).not.toHaveBeenCalled()
    expect(prisma.mtmRoute.findMany).not.toHaveBeenCalled()
  })
})
