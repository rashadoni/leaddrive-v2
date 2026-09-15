import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
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
vi.mock("@/lib/workforce/mobile-write-fence", () => ({
  evaluateWorkforceMobileWriteAccess: vi.fn(),
  workforceMobileWriteFenceResponse: vi.fn((access) => Response.json({
    error: access.message,
    code: access.code,
    mode: access.mode,
  }, { status: 403 })),
}))

import { GET } from "@/app/api/v1/mtm/week/route"
import { POST as POST_WORKDAY } from "@/app/api/v1/mtm/week/workday/route"
import { requireAuth } from "@/lib/api-auth"
import { getMobileAuth, resolveMobileAuth } from "@/lib/mobile-auth"
import { resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import { checkRateLimit } from "@/lib/rate-limit"
import { writeMtmAudit } from "@/lib/mtm-audit"
import { prisma } from "@/lib/prisma"
import {
  evaluateWorkforceMobileWriteAccess,
  workforceMobileWriteFenceResponse,
} from "@/lib/workforce/mobile-write-fence"
import { requireWorkforceAttendanceSecurityMfa } from "@/lib/workforce/attendance-route"
import { WORKFORCE_GRANULAR_ACCESS_FLAG } from "@/lib/workforce/granular-access-rollout"

const ORG = "org-1"
const SESSION = {
  orgId: ORG,
  userId: "manager-user",
  role: "user",
  email: "manager@example.com",
  name: "Manager",
}
const MANAGER = {
  agentId: "manager-agent",
  role: "MANAGER",
  scopedAgentIds: ["agent-1", "manager-agent"],
}
const SELECTED_AGENT = {
  id: "agent-1",
  name: "Aysel",
  role: "AGENT",
  teamId: "team-1",
  team: {
    id: "team-1",
    name: "Baku North",
    regionId: "region-1",
    region: { id: "region-1", name: "Baku" },
  },
}

function weekRequest(query = "") {
  return new NextRequest(`http://localhost:3000/api/v1/mtm/week${query}`)
}

function workdayRequest(body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost:3000/api/v1/mtm/week/workday", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  })
}

function route(overrides: Record<string, unknown> = {}) {
  return {
    id: "route-1",
    name: "Published day",
    date: new Date("2026-07-15T00:00:00.000Z"),
    status: "PLANNED",
    version: 3,
    publishedVersion: 3,
    publishedAt: new Date("2026-07-14T12:00:00.000Z"),
    agentId: "agent-1",
    totalPoints: 0,
    visitedPoints: 0,
    startedAt: null,
    completedAt: null,
    notes: null,
    updatedAt: new Date("2026-07-14T12:00:00.000Z"),
    assignments: [],
    points: [],
    ...overrides,
  }
}

function point(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    customerId: "customer-1",
    contactId: null,
    orderIndex: id === "point-1" ? 0 : 1,
    status: "PENDING",
    plannedTime: null,
    visitedAt: null,
    notes: null,
    customer: {
      id: "customer-1",
      name: "Clinic One",
      objectType: "CLINIC",
      address: "Baku",
      city: "Baku",
    },
    contact: null,
    ...overrides,
  }
}

function visit(overrides: Record<string, unknown> = {}) {
  return {
    id: "visit-1",
    agentId: "agent-1",
    customerId: "customer-1",
    contactId: null,
    routeId: "route-1",
    routePointId: "point-1",
    status: "CHECKED_OUT",
    checkInAt: new Date("2026-07-15T08:00:00.000Z"),
    checkOutAt: new Date("2026-07-15T08:30:00.000Z"),
    outcome: "SUCCESSFUL",
    notes: null,
    resultNotes: null,
    updatedAt: new Date("2026-07-15T08:30:00.000Z"),
    customer: { id: "customer-1", name: "Clinic One", objectType: "CLINIC", address: "Baku", city: "Baku" },
    contact: null,
    participants: [],
    ...overrides,
  }
}

function taskRow(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    title: `Task ${id}`,
    description: null,
    status: "IN_PROGRESS",
    priority: "MEDIUM",
    scheduledStartAt: null,
    dueDate: null,
    completedAt: null,
    returnReason: null,
    version: 1,
    customerId: null,
    createdAt: new Date("2026-07-01T08:00:00.000Z"),
    updatedAt: new Date("2026-07-01T08:00:00.000Z"),
    customer: null,
    ...overrides,
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date("2026-07-15T08:00:00.000Z"))
  vi.clearAllMocks()
  vi.mocked(getMobileAuth).mockReturnValue(null)
  vi.mocked(resolveMobileAuth).mockResolvedValue(null)
  vi.mocked(requireAuth).mockResolvedValue(SESSION as never)
  vi.mocked(resolveMtmRouteActor).mockResolvedValue(MANAGER as never)
  vi.mocked(checkRateLimit).mockReturnValue(true)
  vi.mocked(writeMtmAudit).mockResolvedValue(undefined as never)
  vi.mocked(prisma.mtmSetting.findMany).mockResolvedValue([])
  vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue(SELECTED_AGENT as never)
  vi.mocked(prisma.mtmAgent.findMany).mockResolvedValue([SELECTED_AGENT] as never)
  vi.mocked(prisma.mtmRoute.findMany).mockResolvedValue([])
  vi.mocked(prisma.mtmVisit.findMany).mockResolvedValue([])
  vi.mocked(prisma.mtmAgentWorkday.findMany).mockResolvedValue([])
  vi.mocked(prisma.mtmAgentWorkday.findFirst).mockResolvedValue(null as never)
  vi.mocked(prisma.mtmAgentWorkdayEvent.findFirst).mockResolvedValue(null as never)
  vi.mocked(prisma.mtmAgentLocation.findFirst).mockResolvedValue(null as never)
  vi.mocked(prisma.mtmTask.findMany).mockResolvedValue([])
  vi.mocked(prisma.mtmRouteChangeRequest.findMany).mockResolvedValue([])
  vi.mocked(prisma.workforcePolicy.findMany).mockResolvedValue([])
  vi.mocked(prisma.organization.findUnique).mockResolvedValue({
    plan: "enterprise",
    addons: [],
    features: [],
    modules: { mtm: true },
  } as never)
  vi.mocked(evaluateWorkforceMobileWriteAccess).mockResolvedValue({
    allowed: true,
    mode: "LEGACY_ALLOWED",
    deviceId: null,
    cohortEpoch: null,
  } as never)
})

afterEach(() => {
  vi.useRealTimers()
})

describe("GET /api/v1/mtm/week", () => {
  it("enforces mtm/read auth before resolving actor or reading facts", async () => {
    vi.mocked(requireAuth).mockResolvedValue(Response.json({ error: "Unauthorized" }, { status: 401 }) as never)
    const req = weekRequest("?agentId=agent-1")
    const response = await GET(req)
    expect(response.status).toBe(401)
    expect(requireAuth).toHaveBeenCalledWith(req, "mtm", "read")
    expect(resolveMtmRouteActor).not.toHaveBeenCalled()
    expect(prisma.mtmAgent.findFirst).not.toHaveBeenCalled()
    expect(prisma.mtmRoute.findMany).not.toHaveBeenCalled()
  })

  it("keeps route facts available but omits Workforce facts for a Routes-only tenant", async () => {
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({
      plan: "enterprise",
      addons: [],
      features: [],
      modules: { mtm: true, "workforce-hrm": false },
    } as never)

    const response = await GET(weekRequest("?agentId=agent-1&days=1&anchor=2026-07-15"))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      data: { capabilities: { workday: { enabled: false, canMutateSelf: false } } },
    })
    expect(prisma.mtmAgentWorkday.findMany).not.toHaveBeenCalled()
    expect(prisma.mtmAgentWorkday.findFirst).not.toHaveBeenCalled()
  })

  it("returns a scoped filters-only bootstrap without reading week facts", async () => {
    const response = await GET(weekRequest("?regionId=region-1"))
    expect(response.status).toBe(200)
    const json = await response.json()
    expect(json.data).toMatchObject({
      mode: "FILTERS_ONLY",
      selectionRequired: true,
      timezone: "Asia/Baku",
      filters: {
        selected: { regionId: "region-1", teamId: "", agentId: null },
        agents: [{ id: "agent-1", teamId: "team-1", regionId: "region-1" }],
      },
    })
    expect(prisma.mtmAgent.findFirst).not.toHaveBeenCalled()
    expect(prisma.mtmRoute.findMany).not.toHaveBeenCalled()
    expect(prisma.mtmVisit.findMany).not.toHaveBeenCalled()
    expect(prisma.mtmAgentWorkday.findMany).not.toHaveBeenCalled()
    expect(prisma.mtmAgentLocation.findFirst).not.toHaveBeenCalled()
  })

  it("returns 404 for an out-of-scope employee before every fact read", async () => {
    const response = await GET(weekRequest("?agentId=outside-agent&days=5&anchor=2026-07-15"))
    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ code: "MTM_WEEK_AGENT_NOT_FOUND" })
    expect(prisma.mtmAgent.findFirst).not.toHaveBeenCalled()
    expect(prisma.mtmRoute.findMany).not.toHaveBeenCalled()
    expect(prisma.mtmVisit.findMany).not.toHaveBeenCalled()
    expect(prisma.mtmTask.findMany).not.toHaveBeenCalled()
    expect(prisma.mtmAgentLocation.findFirst).not.toHaveBeenCalled()
  })

  it("keeps an AGENT principal self-only even when another employee is requested", async () => {
    vi.mocked(resolveMtmRouteActor).mockResolvedValue({
      agentId: "agent-1",
      role: "AGENT",
      scopedAgentIds: ["agent-1"],
    } as never)
    const response = await GET(weekRequest("?agentId=agent-2"))
    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ code: "MTM_WEEK_AGENT_NOT_FOUND" })
    expect(prisma.mtmAgent.findFirst).not.toHaveBeenCalled()
    expect(prisma.mtmRoute.findMany).not.toHaveBeenCalled()
  })

  it("accepts a revoked-checked mobile principal and resolves the fresh actor by auth agentId", async () => {
    const mobileAuth = {
      orgId: ORG,
      agentId: "agent-1",
      userId: "",
      role: "AGENT",
      email: "aysel@example.com",
      name: "Aysel",
    }
    vi.mocked(getMobileAuth).mockReturnValue(mobileAuth as never)
    vi.mocked(resolveMobileAuth).mockResolvedValue(mobileAuth as never)
    vi.mocked(resolveMtmRouteActor).mockResolvedValue({
      agentId: "agent-1",
      role: "AGENT",
      scopedAgentIds: ["agent-1"],
    } as never)
    const response = await GET(new NextRequest("http://localhost:3000/api/v1/mtm/week?days=1&anchor=2026-07-15", {
      headers: { authorization: "Bearer mobile-token" },
    }))
    expect(response.status).toBe(200)
    expect(requireAuth).not.toHaveBeenCalled()
    expect(resolveMtmRouteActor).toHaveBeenCalledWith(prisma, expect.objectContaining({
      organizationId: ORG,
      agentId: "agent-1",
    }))
  })

  it("rate-limits a principal before selected-agent enumeration or fact reads", async () => {
    vi.mocked(checkRateLimit).mockReturnValue(false)
    const response = await GET(weekRequest("?agentId=arbitrary-id"))
    expect(response.status).toBe(429)
    expect(response.headers.get("retry-after")).toBe("15")
    expect(resolveMtmRouteActor).not.toHaveBeenCalled()
    expect(prisma.mtmAgent.findFirst).not.toHaveBeenCalled()
    expect(prisma.mtmRoute.findMany).not.toHaveBeenCalled()
  })

  it("preserves current actor scope together with region/team filters in the selected-agent lookup", async () => {
    const response = await GET(weekRequest("?agentId=agent-1&regionId=region-1&teamId=team-1&days=1&anchor=2026-07-15"))
    expect(response.status).toBe(200)
    const selectedWhere = (vi.mocked(prisma.mtmAgent.findFirst).mock.calls[0][0] as any).where
    expect(selectedWhere.AND).toEqual(expect.arrayContaining([
      { id: "agent-1" },
      expect.objectContaining({
        organizationId: ORG,
        status: "ACTIVE",
        id: { in: ["agent-1", "manager-agent"] },
        teamId: "team-1",
        team: { is: { regionId: "region-1" } },
      }),
    ]))
  })

  it.each([
    ["1", "2026-07-15", "2026-07-16", "2026-07-14T20:00:00.000Z", "2026-07-15T20:00:00.000Z"],
    ["5", "2026-07-13", "2026-07-18", "2026-07-12T20:00:00.000Z", "2026-07-17T20:00:00.000Z"],
    ["7", "2026-07-13", "2026-07-20", "2026-07-12T20:00:00.000Z", "2026-07-19T20:00:00.000Z"],
  ])("uses Asia/Baku boundaries for days=%s", async (days, start, end, activityStart, activityEnd) => {
    const response = await GET(weekRequest(`?agentId=agent-1&days=${days}&anchor=2026-07-15`))
    expect(response.status).toBe(200)
    const json = await response.json()
    expect(json.data.period).toMatchObject({ start, endExclusive: end, days: Number(days), timezone: "Asia/Baku" })
    expect(json.data.days).toHaveLength(Number(days))

    const routeQuery = vi.mocked(prisma.mtmRoute.findMany).mock.calls[0][0] as any
    expect(routeQuery.where).toMatchObject({
      organizationId: ORG,
      deletedAt: null,
      publishedVersion: { not: null },
      date: { gte: new Date(`${start}T00:00:00.000Z`), lt: new Date(`${end}T00:00:00.000Z`) },
    })
    const visitQuery = vi.mocked(prisma.mtmVisit.findMany).mock.calls[0][0] as any
    expect(visitQuery.where.checkInAt).toEqual({ gte: new Date(activityStart), lt: new Date(activityEnd) })
  })

  it("does not expose a START action when tenant-today is outside the selected window", async () => {
    vi.mocked(resolveMtmRouteActor).mockResolvedValue({
      agentId: "agent-1",
      role: "AGENT",
      scopedAgentIds: ["agent-1"],
    } as never)
    const response = await GET(weekRequest("?days=1&anchor=2026-07-01"))
    const json = await response.json()
    expect(json.data.capabilities.workday).toEqual({
      enabled: true,
      canMutateSelf: true,
      endpoint: "/api/v1/mtm/week/workday",
      date: "2026-07-15",
      workdayId: null,
      requiresPriorDayClosure: false,
      availableActions: [],
    })
    expect(json.data.days[0].workday.availableActions).toEqual([])
  })

  it("exposes prior-day active workday remediation instead of advertising a deadlocked START", async () => {
    vi.mocked(resolveMtmRouteActor).mockResolvedValue({
      agentId: "agent-1",
      role: "AGENT",
      scopedAgentIds: ["agent-1"],
    } as never)
    vi.mocked(prisma.mtmAgentWorkday.findFirst).mockResolvedValue({
      id: "workday-yesterday",
      workDate: new Date("2026-07-14T00:00:00.000Z"),
      status: "STARTED",
      startedAt: new Date("2026-07-14T05:00:00.000Z"),
      pausedAt: null,
      completedAt: null,
      totalPausedSeconds: 0,
      updatedAt: new Date("2026-07-14T05:00:00.000Z"),
    } as never)
    const response = await GET(weekRequest("?days=1&anchor=2026-07-15"))
    const json = await response.json()
    expect(json.data.workdayContext.activeWorkday).toMatchObject({
      id: "workday-yesterday",
      date: "2026-07-14",
      workedSeconds: null,
      durationAnomalous: true,
      durationReason: "ACTIVE_FROM_PRIOR_DAY",
      requiresPriorDayClosure: true,
      outsideSelectedWindow: true,
    })
    expect(json.data.capabilities.workday).toMatchObject({
      date: "2026-07-14",
      workdayId: "workday-yesterday",
      requiresPriorDayClosure: true,
      availableActions: ["PAUSE", "FINISH"],
    })
    expect(json.data.days[0].workday.availableActions).toEqual([])
  })

  it("reads only published routes, retains a published cancellation and applies historical assignment boundaries", async () => {
    vi.mocked(prisma.mtmRoute.findMany).mockResolvedValue([
      route({ id: "draft", publishedVersion: null, status: "DRAFT" }),
      route({
        id: "cancelled",
        status: "CANCELLED",
        publishedVersion: 4,
        notes: "Territory closed",
        totalPoints: 1,
        points: [point("cancelled-point")],
      }),
      route({
        id: "removed-at-boundary",
        agentId: "outside-primary",
        assignments: [{
          id: "assignment-1",
          agentId: "agent-1",
          role: "PARTICIPANT",
          assignedAt: new Date("2026-07-14T08:00:00.000Z"),
          removedAt: new Date("2026-07-14T20:00:00.000Z"),
        }],
      }),
    ] as never)

    const response = await GET(weekRequest("?agentId=agent-1&days=1&anchor=2026-07-15"))
    const json = await response.json()
    expect(json.data.days[0].routes.map((item: any) => item.id)).toEqual(["cancelled"])
    expect(json.data.days[0].routes[0]).toMatchObject({ status: "CANCELLED", publishedVersion: 4 })
    expect(json.data.days[0].routes[0].points[0].cancellationEvidence).toMatchObject({
      source: "PUBLISHED_ROUTE_STATUS",
      reason: "Territory closed",
    })
    expect(json.data.contract.cancelledPublishedRoutesRetained).toBe(true)
  })

  it("attributes historical participant visits without serializing an out-of-scope primary or requester", async () => {
    vi.mocked(prisma.mtmRoute.findMany).mockResolvedValue([route({
      agentId: "outside-primary-secret",
      assignments: [{
        id: "assignment-1",
        agentId: "agent-1",
        role: "PARTICIPANT",
        assignedAt: new Date("2026-07-14T08:00:00.000Z"),
        removedAt: null,
      }],
      points: [point("point-1")],
      totalPoints: 1,
    })] as never)
    vi.mocked(prisma.mtmVisit.findMany).mockResolvedValue([visit({
      agentId: "outside-primary-secret",
      participants: [{
        id: "participant-1",
        agentId: "agent-1",
        role: "PARTICIPANT",
        joinedAt: new Date("2026-07-15T07:00:00.000Z"),
        leftAt: null,
      }],
    })] as never)
    vi.mocked(prisma.mtmRouteChangeRequest.findMany).mockResolvedValue([{
      id: "change-1",
      routeId: "route-1",
      routePointId: "point-1",
      requestedByAgentId: "outside-requester-secret",
      changeType: "REMOVE_STOP",
      status: "APPROVED",
      reason: "Clinic closed",
      payload: { reasonCode: "CUSTOMER_UNAVAILABLE" },
      decisionComment: "Confirmed",
      submittedAt: new Date("2026-07-15T09:00:00.000Z"),
      reviewedAt: new Date("2026-07-15T09:10:00.000Z"),
      updatedAt: new Date("2026-07-15T09:10:00.000Z"),
      requestedByAgent: { name: "Agent Outside" },
      route: {
        id: "route-1",
        date: new Date("2026-07-15T00:00:00.000Z"),
        agentId: "outside-primary-secret",
        publishedVersion: 3,
        assignments: [{
          id: "assignment-1",
          agentId: "agent-1",
          role: "PARTICIPANT",
          assignedAt: new Date("2026-07-14T08:00:00.000Z"),
          removedAt: null,
        }],
      },
      routePoint: { id: "point-1", customer: { id: "customer-1", name: "Clinic One" }, contact: null },
    }] as never)

    const response = await GET(weekRequest("?agentId=agent-1&days=1&anchor=2026-07-15"))
    const json = await response.json()
    expect(json.data.days[0].routes[0].points[0].actualEvidence).toMatchObject({ visitId: "visit-1" })
    expect(json.data.days[0]).not.toHaveProperty("visits")
    expect(json.data.queues.planChanges[0]).toMatchObject({
      id: "change-1",
      status: "APPROVED",
      requestedBySelectedAgent: false,
      requestedByName: "Agent Outside",
      reasonCode: "CUSTOMER_UNAVAILABLE",
      canReview: false,
      impact: { plannedStops: -1, eligibleStops: -1, actualStops: 0 },
    })
    const serialized = JSON.stringify(json)
    expect(serialized).not.toContain("outside-primary-secret")
    expect(serialized).not.toContain("outside-requester-secret")
  })

  it("consumes one actual visit once and preserves explicit point linkage across duplicate subjects", async () => {
    vi.mocked(prisma.mtmRoute.findMany).mockResolvedValue([route({
      totalPoints: 2,
      points: [point("point-1"), point("point-2")],
    })] as never)
    vi.mocked(prisma.mtmVisit.findMany).mockResolvedValue([visit({ routePointId: "point-2" })] as never)

    const response = await GET(weekRequest("?agentId=agent-1&days=1&anchor=2026-07-15"))
    const json = await response.json()
    const points = json.data.days[0].routes[0].points
    expect(points.map((item: any) => item.executionState)).toEqual(["PLANNED", "ACTUAL"])
    expect(json.data.coverage.actualStops).toBe(1)
  })

  it("returns N/A coverage when every published stop is cancelled", async () => {
    vi.mocked(prisma.mtmRoute.findMany).mockResolvedValue([route({
      status: "CANCELLED",
      notes: "Territory closed",
      totalPoints: 1,
      points: [point("point-1")],
    })] as never)

    const response = await GET(weekRequest("?agentId=agent-1&days=1&anchor=2026-07-15"))
    const json = await response.json()

    expect(json.data.coverage).toMatchObject({
      plannedStops: 1,
      cancelledStops: 1,
      eligibleStops: 0,
      actualStops: 0,
      percentage: null,
    })
  })

  it("places a completed task on its completion day even when its due date was earlier", async () => {
    vi.mocked(prisma.mtmTask.findMany)
      .mockResolvedValueOnce([taskRow("task-1", {
        title: "Send follow-up",
        status: "COMPLETED",
        priority: "HIGH",
        scheduledStartAt: new Date("2026-07-10T07:00:00.000Z"),
        dueDate: new Date("2026-07-10T08:00:00.000Z"),
        completedAt: new Date("2026-07-15T09:00:00.000Z"),
        version: 2,
        customerId: "customer-1",
        createdAt: new Date("2026-07-09T08:00:00.000Z"),
        updatedAt: new Date("2026-07-15T09:00:00.000Z"),
        customer: { id: "customer-1", name: "Clinic One" },
      })] as never)
      .mockResolvedValueOnce([])
    const response = await GET(weekRequest("?agentId=agent-1&days=1&anchor=2026-07-15"))
    const json = await response.json()
    expect(json.data.days[0].tasks).toEqual([expect.objectContaining({ id: "task-1", status: "COMPLETED" })])
    expect(json.data.queues.activeTasks).toEqual([])
  })

  it("keeps future-due and returned work in the separately scoped active queue", async () => {
    const startInWindow = taskRow("active-task", {
      title: "Prepare visit",
      status: "PENDING",
      priority: "URGENT",
      scheduledStartAt: new Date("2026-07-15T09:00:00.000Z"),
      dueDate: new Date("2026-07-20T10:00:00.000Z"),
      version: 4,
      customerId: "customer-1",
      createdAt: new Date("2026-07-12T08:00:00.000Z"),
      updatedAt: new Date("2026-07-15T07:00:00.000Z"),
      customer: { id: "customer-1", name: "Clinic One" },
    })
    const futureReturned = taskRow("returned-task", {
      title: "Fix evidence",
      description: "Attach a readable photo",
      status: "IN_PROGRESS",
      priority: "LOW",
      scheduledStartAt: new Date("2026-07-20T07:30:00.000Z"),
      dueDate: new Date("2026-07-20T08:30:00.000Z"),
      returnReason: "Photo is unreadable",
      version: 7,
      createdAt: new Date("2026-07-10T08:00:00.000Z"),
      updatedAt: new Date("2026-07-15T07:45:00.000Z"),
    })
    const overdue = taskRow("overdue-task", {
      title: "Call pharmacy",
      status: "IN_PROGRESS",
      priority: "MEDIUM",
      dueDate: new Date("2026-07-15T07:59:59.999Z"),
      version: 3,
      customerId: "customer-2",
      createdAt: new Date("2026-07-11T08:00:00.000Z"),
      updatedAt: new Date("2026-07-15T07:59:59.999Z"),
      customer: { id: "customer-2", name: "Pharmacy Two" },
    })
    vi.mocked(prisma.mtmTask.findMany)
      .mockResolvedValueOnce([startInWindow] as never)
      .mockResolvedValueOnce([startInWindow, futureReturned, overdue] as never)

    const response = await GET(weekRequest("?agentId=agent-1&days=1&anchor=2026-07-15"))
    const json = await response.json()
    const periodTaskQuery = vi.mocked(prisma.mtmTask.findMany).mock.calls[0][0] as any
    const activeTaskQuery = vi.mocked(prisma.mtmTask.findMany).mock.calls[1][0] as any

    expect(prisma.mtmTask.findMany).toHaveBeenCalledTimes(2)
    expect(periodTaskQuery.where.OR).toContainEqual({
      scheduledStartAt: {
        gte: new Date("2026-07-14T20:00:00.000Z"),
        lt: new Date("2026-07-15T20:00:00.000Z"),
      },
    })
    expect(activeTaskQuery.where).toEqual({
      organizationId: ORG,
      agentId: "agent-1",
      deletedAt: null,
      status: { in: ["PENDING", "IN_PROGRESS", "OVERDUE"] },
    })
    expect(activeTaskQuery.select).toMatchObject({
      id: true,
      status: true,
      priority: true,
      scheduledStartAt: true,
      dueDate: true,
      returnReason: true,
      version: true,
      createdAt: true,
    })
    expect(json.data.days[0].tasks).toEqual([
      expect.objectContaining({ id: "active-task", scheduledStartAt: "2026-07-15T09:00:00.000Z" }),
    ])
    expect(json.data.queues.activeTasks.map((item: any) => ({
      id: item.id,
      attention: item.attention,
      status: item.status,
      version: item.version,
    }))).toEqual([
      { id: "overdue-task", attention: "OVERDUE", status: "IN_PROGRESS", version: 3 },
      { id: "returned-task", attention: "RETURNED", status: "IN_PROGRESS", version: 7 },
      { id: "active-task", attention: "ACTIVE", status: "PENDING", version: 4 },
    ])
  })

  it("prevents a full period cap of terminal rows from masking active exceptions", async () => {
    const terminalRows = Array.from({ length: 1_001 }, (_, index) => taskRow(`completed-${index}`, {
      status: "COMPLETED",
      dueDate: new Date("2026-07-15T09:00:00.000Z"),
      completedAt: new Date("2026-07-15T10:00:00.000Z"),
    }))
    const futureReturned = taskRow("future-returned", {
      status: "IN_PROGRESS",
      scheduledStartAt: new Date("2026-07-20T08:00:00.000Z"),
      dueDate: new Date("2026-07-20T09:00:00.000Z"),
      returnReason: "Rework the evidence",
      updatedAt: new Date("2026-07-15T07:30:00.000Z"),
    })
    vi.mocked(prisma.mtmTask.findMany)
      .mockResolvedValueOnce(terminalRows as never)
      .mockResolvedValueOnce([futureReturned] as never)

    const json = await (await GET(weekRequest("?agentId=agent-1&days=1&anchor=2026-07-15"))).json()
    const activeTaskQuery = vi.mocked(prisma.mtmTask.findMany).mock.calls[1][0] as any

    expect(activeTaskQuery.where).toMatchObject({
      organizationId: ORG,
      agentId: "agent-1",
      deletedAt: null,
      status: { in: ["PENDING", "IN_PROGRESS", "OVERDUE"] },
    })
    expect(json.data.queues.activeTasks).toEqual([
      expect.objectContaining({ id: "future-returned", attention: "RETURNED" }),
    ])
    expect(json.data.completeness).toMatchObject({
      authoritative: false,
      truncatedSources: ["TASKS"],
      limits: { tasks: 1_000, activeTasks: 1_000 },
      returned: { tasks: 1_000, activeTasks: 1 },
    })
  })

  it("marks a bounded active queue non-authoritative without admitting terminal statuses", async () => {
    const activeRows = Array.from({ length: 1_001 }, (_, index) => taskRow(`active-${index}`, {
      status: index % 2 === 0 ? "PENDING" : "IN_PROGRESS",
      dueDate: new Date(`2026-07-${String(20 + (index % 8)).padStart(2, "0")}T09:00:00.000Z`),
    }))
    vi.mocked(prisma.mtmTask.findMany)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(activeRows as never)

    const json = await (await GET(weekRequest("?agentId=agent-1&days=1&anchor=2026-07-15"))).json()

    expect(json.data.queues.activeTasks).toHaveLength(1_000)
    expect(json.data.completeness).toMatchObject({
      authoritative: false,
      truncatedSources: ["ACTIVE_TASKS"],
      returned: { tasks: 0, activeTasks: 1_000 },
    })
  })

  it("keeps snapshot identity stable when a task crosses the strict overdue boundary", async () => {
    const crossing = taskRow("crossing-task", {
      status: "PENDING",
      dueDate: new Date("2026-07-15T08:00:01.000Z"),
      updatedAt: new Date("2026-07-15T07:00:00.000Z"),
    })
    vi.mocked(prisma.mtmTask.findMany).mockResolvedValue([crossing] as never)

    const first = await (await GET(weekRequest("?agentId=agent-1&days=1&anchor=2026-07-15"))).json()
    vi.setSystemTime(new Date("2026-07-15T08:00:02.000Z"))
    const second = await (await GET(weekRequest("?agentId=agent-1&days=1&anchor=2026-07-15"))).json()

    expect(first.data.queues.activeTasks[0].attention).toBe("ACTIVE")
    expect(second.data.queues.activeTasks[0].attention).toBe("OVERDUE")
    expect(second.data.snapshotId).toBe(first.data.snapshotId)
    expect(second.data.lastSourceAt).toBe(first.data.lastSourceAt)
  })

  it("keeps paused workday state independent from delayed GPS freshness and audits metadata without coordinates", async () => {
    vi.mocked(resolveMtmRouteActor).mockResolvedValue({
      agentId: "agent-1",
      role: "AGENT",
      scopedAgentIds: ["agent-1"],
    } as never)
    vi.mocked(prisma.mtmAgentWorkday.findMany).mockResolvedValue([{
      id: "workday-1",
      workDate: new Date("2026-07-15T00:00:00.000Z"),
      status: "PAUSED",
      startedAt: new Date("2026-07-15T05:00:00.000Z"),
      pausedAt: new Date("2026-07-15T07:30:00.000Z"),
      completedAt: null,
      totalPausedSeconds: 300,
      updatedAt: new Date("2026-07-15T07:30:00.000Z"),
      events: [],
    }] as never)
    vi.mocked(prisma.mtmAgentLocation.findFirst).mockResolvedValue({
      id: "location-1",
      recordedAt: new Date("2026-07-15T07:54:00.000Z"),
      latitude: 40.4,
      longitude: 49.8,
      accuracy: 12,
      battery: 71,
    } as never)

    const response = await GET(weekRequest("?agentId=agent-1&days=1&anchor=2026-07-15"))
    const json = await response.json()
    expect(json.data.gps).toMatchObject({ freshness: "DELAYED", accuracy: 12, battery: 71 })
    expect(json.data.days[0].workday).toMatchObject({
      state: "PAUSED",
      availableActions: ["RESUME", "FINISH"],
    })
    expect(writeMtmAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: "WEEK_GPS_LATEST_READ",
      newData: expect.not.objectContaining({ latitude: expect.anything(), longitude: expect.anything() }),
    }))
  })

  it("selects the newest admissible GPS row instead of a newer invalid or inaccurate sample", async () => {
    // The database predicate excludes a hypothetical newer 91° / 500 m row;
    // this is the older row that remains first among admissible evidence.
    vi.mocked(prisma.mtmAgentLocation.findFirst).mockResolvedValue({
      id: "location-admissible",
      recordedAt: new Date("2026-07-15T07:57:00.000Z"),
      latitude: 40.4,
      longitude: 49.8,
      accuracy: 25,
      battery: 68,
    } as never)

    const response = await GET(weekRequest("?agentId=agent-1&days=1&anchor=2026-07-15"))
    const json = await response.json()
    const locationQuery = vi.mocked(prisma.mtmAgentLocation.findFirst).mock.calls[0][0] as any

    expect(locationQuery).toMatchObject({
      where: {
        organizationId: ORG,
        agentId: "agent-1",
        latitude: { gte: -90, lte: 90 },
        longitude: { gte: -180, lte: 180 },
        OR: [
          { accuracy: null },
          { accuracy: { gte: 0, lte: 100 } },
        ],
      },
      orderBy: [{ recordedAt: "desc" }, { id: "desc" }],
    })
    expect(json.data.gps).toMatchObject({
      freshness: "ONLINE",
      recordedAt: "2026-07-15T07:57:00.000Z",
      accuracy: 25,
      battery: 68,
    })
  })

  it("fails closed if a legacy client returns GPS evidence outside the quality predicate", async () => {
    vi.mocked(prisma.mtmAgentLocation.findFirst).mockResolvedValue({
      id: "location-corrupt",
      recordedAt: new Date("2026-07-15T07:59:00.000Z"),
      latitude: 91,
      longitude: 49.8,
      accuracy: 500,
      battery: 99,
    } as never)

    const response = await GET(weekRequest("?agentId=agent-1&days=1&anchor=2026-07-15"))
    const json = await response.json()

    expect(json.data.gps).toMatchObject({
      freshness: "NO_LOCATION",
      recordedAt: null,
      accuracy: null,
      battery: null,
      reason: "NO_LOCATION_REPORTED",
    })
    expect(writeMtmAudit).not.toHaveBeenCalled()
  })

  it("keeps snapshotId source-stable while worked time advances and GPS crosses a freshness threshold", async () => {
    vi.mocked(resolveMtmRouteActor).mockResolvedValue({
      agentId: "agent-1",
      role: "AGENT",
      scopedAgentIds: ["agent-1"],
    } as never)
    const active = {
      id: "workday-1",
      workDate: new Date("2026-07-15T00:00:00.000Z"),
      status: "STARTED",
      startedAt: new Date("2026-07-15T07:00:00.000Z"),
      pausedAt: null,
      completedAt: null,
      totalPausedSeconds: 0,
      updatedAt: new Date("2026-07-15T07:00:00.000Z"),
    }
    vi.mocked(prisma.mtmAgentWorkday.findMany).mockResolvedValue([{ ...active, events: [] }] as never)
    vi.mocked(prisma.mtmAgentWorkday.findFirst).mockResolvedValue(active as never)
    vi.mocked(prisma.mtmAgentLocation.findFirst).mockResolvedValue({
      id: "location-1",
      recordedAt: new Date("2026-07-15T07:55:00.000Z"),
      latitude: 40.4,
      longitude: 49.8,
      accuracy: 12,
      battery: 71,
    } as never)

    const first = await (await GET(weekRequest("?days=1&anchor=2026-07-15"))).json()
    vi.setSystemTime(new Date("2026-07-15T08:00:01.000Z"))
    const second = await (await GET(weekRequest("?days=1&anchor=2026-07-15"))).json()
    expect(first.data.gps.freshness).toBe("ONLINE")
    expect(second.data.gps.freshness).toBe("DELAYED")
    expect(second.data.days[0].workday.workedSeconds).toBeGreaterThan(first.data.days[0].workday.workedSeconds)
    expect(second.data.snapshotId).toBe(first.data.snapshotId)
    expect(second.data.lastSourceAt).toBe(first.data.lastSourceAt)
  })

  it("keeps the source snapshot stable across tenant midnight and marks an overnight active duration unknown", async () => {
    vi.setSystemTime(new Date("2026-07-14T19:59:59.000Z")) // 23:59:59 Asia/Baku
    vi.mocked(resolveMtmRouteActor).mockResolvedValue({
      agentId: "agent-1",
      role: "AGENT",
      scopedAgentIds: ["agent-1"],
    } as never)
    const active = {
      id: "workday-midnight",
      workDate: new Date("2026-07-14T00:00:00.000Z"),
      status: "STARTED",
      startedAt: new Date("2026-07-14T05:00:00.000Z"),
      pausedAt: null,
      completedAt: null,
      totalPausedSeconds: 0,
      updatedAt: new Date("2026-07-14T05:00:00.000Z"),
    }
    vi.mocked(prisma.mtmAgentWorkday.findMany).mockResolvedValue([{ ...active, events: [] }] as never)
    vi.mocked(prisma.mtmAgentWorkday.findFirst).mockResolvedValue(active as never)

    const first = await (await GET(weekRequest("?days=1&anchor=2026-07-14"))).json()
    vi.setSystemTime(new Date("2026-07-14T20:00:01.000Z")) // 00:00:01 Asia/Baku
    const second = await (await GET(weekRequest("?days=1&anchor=2026-07-14"))).json()

    expect(first.data.workdayContext.activeWorkday).toMatchObject({
      workedSeconds: expect.any(Number),
      durationAnomalous: false,
      durationReason: null,
      requiresPriorDayClosure: false,
    })
    expect(second.data.workdayContext.activeWorkday).toMatchObject({
      workedSeconds: null,
      durationAnomalous: true,
      durationReason: "ACTIVE_FROM_PRIOR_DAY",
      requiresPriorDayClosure: true,
    })
    expect(second.data.days[0].workday).toMatchObject({
      workedSeconds: null,
      durationAnomalous: true,
      durationReason: "ACTIVE_FROM_PRIOR_DAY",
    })
    expect(second.data.snapshotId).toBe(first.data.snapshotId)
    expect(second.data.lastSourceAt).toBe(first.data.lastSourceAt)
  })

  it("reports deterministic cap completeness and keeps snapshotId independent of generatedAt", async () => {
    vi.mocked(prisma.mtmRoute.findMany).mockResolvedValue(Array.from({ length: 101 }, (_, index) => route({
      id: `route-${String(index).padStart(3, "0")}`,
    })) as never)
    const first = await (await GET(weekRequest("?agentId=agent-1&days=1&anchor=2026-07-15"))).json()
    vi.setSystemTime(new Date("2026-07-15T08:00:10.000Z"))
    const second = await (await GET(weekRequest("?agentId=agent-1&days=1&anchor=2026-07-15"))).json()
    expect(first.data.completeness).toMatchObject({ authoritative: false, truncatedSources: ["ROUTES"] })
    expect(first.data.completeness.returned.routes).toBe(100)
    expect(second.data.generatedAt).not.toBe(first.data.generatedAt)
    expect(second.data.snapshotId).toBe(first.data.snapshotId)
  })

  it("enforces deterministic per-source and total point cap contracts", async () => {
    vi.mocked(prisma.mtmRoute.findMany).mockResolvedValue([route({
      totalPoints: 51,
      points: Array.from({ length: 51 }, (_, index) => point(`point-${index}`, {
        customerId: `customer-${index}`,
        customer: {
          id: `customer-${index}`,
          name: `Clinic ${index}`,
          objectType: "CLINIC",
          address: "Baku",
          city: "Baku",
        },
      })),
    })] as never)
    const response = await GET(weekRequest("?agentId=agent-1&days=1&anchor=2026-07-15"))
    const json = await response.json()
    expect(json.data.days[0].routes[0].points).toHaveLength(50)
    expect(json.data.completeness).toMatchObject({
      authoritative: false,
      truncatedSources: ["ROUTE_POINTS"],
      limits: { routes: 100, pointsPerRoute: 50, routePointsTotal: 500, visits: 2_000, tasks: 1_000, planChanges: 500 },
    })
    const routeQuery = vi.mocked(prisma.mtmRoute.findMany).mock.calls[0][0] as any
    expect(routeQuery.take).toBe(101)
    expect(routeQuery.select.points.take).toBe(51)
    expect((vi.mocked(prisma.mtmVisit.findMany).mock.calls[0][0] as any).take).toBe(2_001)
    expect((vi.mocked(prisma.mtmTask.findMany).mock.calls[0][0] as any).take).toBe(1_001)
    expect((vi.mocked(prisma.mtmTask.findMany).mock.calls[1][0] as any).take).toBe(1_001)
    expect((vi.mocked(prisma.mtmRouteChangeRequest.findMany).mock.calls[0][0] as any).take).toBe(501)
    const workdayQuery = vi.mocked(prisma.mtmAgentWorkday.findMany).mock.calls[0][0] as any
    expect(workdayQuery.select.events.take).toBe(101)
  })

  it("bounds a multi-day rendered week to 500 route points and marks a later hidden route", async () => {
    vi.mocked(prisma.mtmRoute.findMany).mockResolvedValue(Array.from({ length: 11 }, (_, routeIndex) => route({
      id: `route-dense-${routeIndex}`,
      date: new Date(routeIndex === 10 ? "2026-07-16T00:00:00.000Z" : "2026-07-15T00:00:00.000Z"),
      totalPoints: 50,
      points: Array.from({ length: 50 }, (_, pointIndex) => point(`dense-${routeIndex}-${pointIndex}`, {
        customerId: `customer-${routeIndex}-${pointIndex}`,
        customer: {
          id: `customer-${routeIndex}-${pointIndex}`,
          name: `Clinic ${routeIndex}-${pointIndex}`,
          objectType: "CLINIC",
          address: "Baku",
          city: "Baku",
        },
      })),
    })) as never)

    const response = await GET(weekRequest("?agentId=agent-1&days=5&anchor=2026-07-15"))
    const json = await response.json()
    const returnedPoints = json.data.days.flatMap((day: any) => day.routes.flatMap((item: any) => item.points))
    const laterDay = json.data.days.find((day: any) => day.date === "2026-07-16")

    expect(returnedPoints).toHaveLength(500)
    expect(laterDay.routes).toEqual([
      expect.objectContaining({ id: "route-dense-10", points: [], pointsTruncated: true }),
    ])
    expect(json.data.completeness).toMatchObject({
      authoritative: false,
      truncatedSources: ["ROUTE_POINTS"],
      limits: { routePointsTotal: 500 },
      returned: { routePoints: 500 },
    })
  })

  it("caps the serialized unmatched-visit agenda independently from matching reads", async () => {
    vi.mocked(prisma.mtmVisit.findMany).mockResolvedValue(Array.from({ length: 101 }, (_, index) => visit({
      id: `unplanned-${index}`,
      customerId: `customer-${index}`,
      routeId: null,
      routePointId: null,
      customer: { id: `customer-${index}`, name: `Clinic ${index}`, objectType: "CLINIC", address: "Baku", city: "Baku" },
    })) as never)

    const response = await GET(weekRequest("?agentId=agent-1&days=1&anchor=2026-07-15"))
    const json = await response.json()

    expect(json.data.days[0].unplannedVisits).toHaveLength(100)
    expect(json.data.days[0]).not.toHaveProperty("visits")
    expect(json.data.completeness).toMatchObject({
      authoritative: false,
      truncatedSources: ["UNPLANNED_VISITS"],
      limits: { unplannedVisits: 100 },
      returned: { visits: 101, unplannedVisits: 100 },
    })
  })
})

describe("POST /api/v1/mtm/week/workday", () => {
  it("enforces workforce/write before resolving a workday actor", async () => {
    vi.mocked(requireAuth).mockResolvedValue(Response.json({ error: "Forbidden" }, { status: 403 }) as never)
    const req = workdayRequest({
      clientEventId: "event-1",
      action: "START",
      id: "workday-1",
      occurredAt: "2026-07-15T08:00:00.000Z",
    })
    const response = await POST_WORKDAY(req)
    expect(response.status).toBe(403)
    expect(requireAuth).toHaveBeenCalledWith(req, "workforce", "write")
    expect(resolveMtmRouteActor).not.toHaveBeenCalled()
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it("blocks the legacy workday transport for a Routes-only tenant", async () => {
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({
      plan: "enterprise",
      addons: [],
      features: [],
      modules: { mtm: true, "workforce-hrm": false },
    } as never)

    const response = await POST_WORKDAY(workdayRequest({
      clientEventId: "event-routes-only",
      action: "START",
      id: "workday-1",
      occurredAt: "2026-07-15T08:00:00.000Z",
    }))

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({
      code: "TENANT_CAPABILITY_DISABLED",
      capabilityId: "workforce-hrm",
    })
    expect(resolveMtmRouteActor).not.toHaveBeenCalled()
  })

  it.each(["MANAGER", "SUPERVISOR", "ADMIN"])("keeps %s week views read-only", async (role) => {
    vi.mocked(resolveMtmRouteActor).mockResolvedValue({
      agentId: role === "ADMIN" ? null : "manager-agent",
      role,
      scopedAgentIds: role === "ADMIN" ? null : ["agent-1", "manager-agent"],
    } as never)
    const response = await POST_WORKDAY(workdayRequest({
      clientEventId: "event-1",
      action: "START",
      id: "workday-1",
      occurredAt: "2026-07-15T08:00:00.000Z",
    }))
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ code: "MTM_WEEK_WORKDAY_SELF_ONLY" })
    expect(prisma.mtmAgentWorkday.findFirst).not.toHaveBeenCalled()
    expect(prisma.mtmAgentWorkdayEvent.findFirst).not.toHaveBeenCalled()
  })

  it("applies the device-aware freeze to the mobile compatibility transport before parsing or writing", async () => {
    const mobileAuth = {
      orgId: ORG,
      agentId: "agent-1",
      userId: "agent-user",
      role: "AGENT",
      email: "agent@example.test",
      name: "Agent",
      tenantCapabilities: { routeField: false, workforceHrm: true },
    }
    vi.mocked(getMobileAuth).mockReturnValue(mobileAuth as never)
    vi.mocked(resolveMobileAuth).mockResolvedValue(mobileAuth as never)
    vi.mocked(resolveMtmRouteActor).mockResolvedValue({
      agentId: "agent-1",
      role: "AGENT",
      scopedAgentIds: ["agent-1"],
    } as never)
    vi.mocked(evaluateWorkforceMobileWriteAccess).mockResolvedValue({
      allowed: false,
      mode: "FROZEN",
      code: "WORKFORCE_MOBILE_WRITE_FENCE_FROZEN",
      message: "Mobile Workforce writes are temporarily frozen for this tenant.",
      deviceId: "device-fence",
    } as never)

    const response = await POST_WORKDAY(workdayRequest({
      clientEventId: "event-fenced-mobile",
      action: "START",
      id: "workday-1",
      occurredAt: "2026-07-15T08:00:00.000Z",
    }, { authorization: "Bearer mobile-token", "x-field-device-id": "device-fence" }))

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({
      code: "WORKFORCE_MOBILE_WRITE_FENCE_FROZEN",
      mode: "FROZEN",
    })
    expect(evaluateWorkforceMobileWriteAccess).toHaveBeenCalledWith({
      auth: { orgId: ORG, agentId: "agent-1" },
      deviceId: "device-fence",
    })
    expect(workforceMobileWriteFenceResponse).toHaveBeenCalledTimes(1)
    expect(prisma.mtmAgentWorkdayEvent.findFirst).not.toHaveBeenCalled()
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it("re-checks the mobile fence inside the workday transaction before any state write", async () => {
    const mobileAuth = {
      orgId: ORG,
      agentId: "agent-1",
      userId: "agent-user",
      role: "AGENT",
      email: "agent@example.test",
      name: "Agent",
      tenantCapabilities: { routeField: false, workforceHrm: true },
    }
    vi.mocked(getMobileAuth).mockReturnValue(mobileAuth as never)
    vi.mocked(resolveMobileAuth).mockResolvedValue(mobileAuth as never)
    vi.mocked(resolveMtmRouteActor).mockResolvedValue({
      agentId: "agent-1",
      role: "AGENT",
      scopedAgentIds: ["agent-1"],
    } as never)
    vi.mocked(evaluateWorkforceMobileWriteAccess)
      .mockResolvedValueOnce({
        allowed: true,
        mode: "LEGACY_ALLOWED",
        deviceId: "device-fence",
        cohortEpoch: null,
      } as never)
      .mockResolvedValueOnce({
        allowed: false,
        mode: "FROZEN",
        code: "WORKFORCE_MOBILE_WRITE_FENCE_FROZEN",
        message: "Mobile Workforce writes are temporarily frozen for this tenant.",
        deviceId: "device-fence",
      } as never)

    const response = await POST_WORKDAY(workdayRequest({
      clientEventId: "event-fence-race-mobile",
      action: "START",
      id: "workday-fence-race-mobile",
      occurredAt: "2026-07-15T08:00:00.000Z",
    }, { authorization: "Bearer mobile-token", "x-field-device-id": "device-fence" }))

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({
      code: "WORKFORCE_MOBILE_WRITE_FENCE_FROZEN",
      mode: "FROZEN",
    })
    expect(evaluateWorkforceMobileWriteAccess).toHaveBeenNthCalledWith(1, {
      auth: { orgId: ORG, agentId: "agent-1" },
      deviceId: "device-fence",
    })
    expect(evaluateWorkforceMobileWriteAccess).toHaveBeenNthCalledWith(2, expect.objectContaining({
      auth: { orgId: ORG, agentId: "agent-1" },
      deviceId: "device-fence",
      tx: prisma,
    }))
    expect(prisma.mtmAgentWorkday.create).not.toHaveBeenCalled()
    expect(prisma.mtmAgentWorkdayEvent.create).not.toHaveBeenCalled()
  })

  it("rejects a new workday mutation from an expired mobile version without changing state", async () => {
    const mobileAuth = {
      orgId: ORG,
      agentId: "agent-1",
      userId: "agent-user",
      role: "AGENT",
      email: "agent@example.test",
      name: "Agent",
      tenantCapabilities: { routeField: false, workforceHrm: true },
    }
    vi.mocked(getMobileAuth).mockReturnValue(mobileAuth as never)
    vi.mocked(resolveMobileAuth).mockResolvedValue(mobileAuth as never)
    vi.mocked(resolveMtmRouteActor).mockResolvedValue({
      agentId: "agent-1",
      role: "AGENT",
      scopedAgentIds: ["agent-1"],
    } as never)
    vi.stubEnv("WORKFORCE_ANDROID_MIN_VERSION_CODE", "100")
    vi.stubEnv("WORKFORCE_ANDROID_RECOMMENDED_VERSION_CODE", "120")
    try {
      const response = await POST_WORKDAY(workdayRequest({
        clientEventId: "event-expired-mobile",
        action: "START",
        id: "workday-expired-mobile",
        occurredAt: "2026-07-15T08:00:00.000Z",
      }, {
        authorization: "Bearer mobile-token",
        "x-field-device-id": "device-expired",
        "x-workforce-app-version-code": "99",
      }))

      expect(response.status).toBe(426)
      await expect(response.json()).resolves.toMatchObject({
        code: "WORKFORCE_ANDROID_UPDATE_REQUIRED",
        release: {
          status: "UPDATE_REQUIRED",
          minimumVersionCode: 100,
          recommendedVersionCode: 120,
          maySubmitNewWorkforceActions: false,
          recovery: "DRAIN_THEN_UPDATE",
        },
      })
      expect(prisma.$transaction).not.toHaveBeenCalled()
      expect(prisma.mtmAgentWorkday.create).not.toHaveBeenCalled()
      expect(prisma.mtmAgentWorkdayEvent.create).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it("does not send a browser Workforce request through the mobile device fence", async () => {
    vi.mocked(resolveMtmRouteActor).mockResolvedValue({
      agentId: "agent-1",
      role: "AGENT",
      scopedAgentIds: ["agent-1"],
    } as never)

    const response = await POST_WORKDAY(workdayRequest({}))

    expect(response.status).toBe(400)
    expect(evaluateWorkforceMobileWriteAccess).not.toHaveBeenCalled()
    expect(workforceMobileWriteFenceResponse).not.toHaveBeenCalled()
  })

  it("rejects a new web workday event submitted too far in the past", async () => {
    vi.mocked(resolveMtmRouteActor).mockResolvedValue({
      agentId: "agent-1",
      role: "AGENT",
      scopedAgentIds: ["agent-1"],
    } as never)
    vi.mocked(prisma.mtmAgentWorkdayEvent.findFirst).mockResolvedValue(null as never)

    const response = await POST_WORKDAY(workdayRequest({
      clientEventId: "event-backdated",
      action: "START",
      id: "workday-backdated",
      occurredAt: "2026-07-15T07:54:59.000Z",
    }))

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ code: "MTM_WEEK_WORKDAY_INVALID" })
    expect(prisma.$transaction).not.toHaveBeenCalled()
    expect(prisma.mtmAgentWorkday.create).not.toHaveBeenCalled()
    expect(prisma.mtmAgentWorkdayEvent.create).not.toHaveBeenCalled()
  })

  it("returns an additive structured upgrade response for an unsupported workday schema", async () => {
    vi.mocked(resolveMtmRouteActor).mockResolvedValue({
      agentId: "agent-1",
      role: "AGENT",
      scopedAgentIds: ["agent-1"],
    } as never)

    const response = await POST_WORKDAY(workdayRequest({
      clientEventId: "event-unsupported-schema",
      action: "START",
      id: "workday-unsupported-schema",
      occurredAt: "2026-07-15T08:00:00.000Z",
      schemaVersion: 5,
    }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      code: "WORKFORCE_WORKDAY_SCHEMA_UNSUPPORTED",
      schemaSupport: { min: 1, max: 4, action: "UPGRADE_CLIENT" },
    })
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it("applies an agent self transition transactionally and records the immutable event", async () => {
    vi.mocked(resolveMtmRouteActor).mockResolvedValue({
      agentId: "agent-1",
      role: "AGENT",
      scopedAgentIds: ["agent-1"],
    } as never)
    vi.mocked(prisma.mtmAgentWorkdayEvent.findFirst).mockResolvedValue(null as never)
    vi.mocked(prisma.mtmAgentWorkday.findFirst).mockResolvedValue(null as never)
    vi.mocked(prisma.mtmAgentWorkday.create).mockResolvedValue({
      id: "workday-1",
      workDate: new Date("2026-07-15T00:00:00.000Z"),
      status: "STARTED",
      startedAt: new Date("2026-07-15T08:00:00.000Z"),
      pausedAt: null,
      completedAt: null,
      totalPausedSeconds: 0,
      startLatitude: null,
      startLongitude: null,
      endLatitude: null,
      endLongitude: null,
      createdAt: new Date("2026-07-15T08:00:00.000Z"),
      updatedAt: new Date("2026-07-15T08:00:00.000Z"),
    } as never)
    vi.mocked(prisma.mtmAgentWorkdayEvent.create).mockResolvedValue({
      id: "server-event-1",
      workdayId: "workday-1",
      clientEventId: "event-1",
      type: "START",
      occurredAt: new Date("2026-07-15T08:00:00.000Z"),
      latitude: null,
      longitude: null,
      accuracy: null,
      note: null,
      attendanceReviewState: "NOT_REQUIRED",
      attendanceReviewReasonCode: null,
      createdAt: new Date("2026-07-15T08:00:00.000Z"),
    } as never)

    const response = await POST_WORKDAY(workdayRequest({
      clientEventId: "event-1",
      action: "START",
      id: "workday-1",
      occurredAt: "2026-07-15T08:00:00.000Z",
    }))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      success: true,
      idempotent: false,
      data: {
        workday: { id: "workday-1", status: "STARTED" },
        review: { state: "NOT_REQUIRED", reasonCode: null },
        availableActions: ["PAUSE", "FINISH"],
      },
    })
    expect(prisma.$transaction).toHaveBeenCalledTimes(1)
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(2)
    const lockCall = vi.mocked(prisma.$executeRaw).mock.calls[0] as unknown as [TemplateStringsArray, string]
    expect(lockCall[0].join("?")).toContain("pg_advisory_xact_lock")
    expect(lockCall[1]).toBe("mtm-workday:org-1:agent-1")
    expect((vi.mocked(prisma.$executeRaw).mock.calls[1] as unknown as [TemplateStringsArray, string])[1])
      .toBe("mtm-workday:org-1:agent-1")
    expect(vi.mocked(prisma.$executeRaw).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(prisma.mtmAgentWorkdayEvent.findFirst).mock.invocationCallOrder[1])
    expect(vi.mocked(prisma.$executeRaw).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(prisma.mtmAgentWorkday.findFirst).mock.invocationCallOrder[0])
    expect(prisma.mtmAgentWorkday.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ organizationId: ORG, agentId: "agent-1", id: "workday-1" }),
    }))
    expect(prisma.mtmAgentWorkdayEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ clientEventId: "event-1", type: "START" }),
    }))
    // Both commercial H5 add-ons are absent in the default tenant fixture.
    // A published policy must still be consulted, so it can fail closed rather
    // than being bypassed by toggling its entitlement off.
    expect(prisma.workforcePolicy.findMany).toHaveBeenCalled()
    expect(prisma.mtmAuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        action: "WORKDAY_START",
        metadataKind: "workday_transition",
        oldData: { exists: false },
        newData: expect.objectContaining({
          channel: "web",
          clientEventId: "event-1",
          action: "START",
          workday: expect.objectContaining({ exists: true, id: "workday-1", status: "STARTED" }),
        }),
      }),
    }))
    const audit = vi.mocked(prisma.mtmAuditLog.create).mock.calls[0][0] as { data: unknown }
    expect(JSON.stringify(audit.data))
      .not.toMatch(/latitude|longitude|accuracy|battery/i)
  })

  it("replays the same clientEventId without another state mutation", async () => {
    vi.mocked(resolveMtmRouteActor).mockResolvedValue({
      agentId: "agent-1",
      role: "AGENT",
      scopedAgentIds: ["agent-1"],
    } as never)
    vi.mocked(prisma.mtmAgentWorkdayEvent.findFirst).mockResolvedValue({
      id: "server-event-1",
      workdayId: "workday-1",
      clientEventId: "event-1",
      type: "START",
      occurredAt: new Date("2026-07-15T08:00:00.000Z"),
      latitude: null,
      longitude: null,
      accuracy: null,
      note: null,
      createdAt: new Date("2026-07-15T08:00:00.000Z"),
      workday: {
        id: "workday-1",
        workDate: new Date("2026-07-15T00:00:00.000Z"),
        status: "STARTED",
        startedAt: new Date("2026-07-15T08:00:00.000Z"),
        pausedAt: null,
        completedAt: null,
        totalPausedSeconds: 0,
        startLatitude: null,
        startLongitude: null,
        endLatitude: null,
        endLongitude: null,
        createdAt: new Date("2026-07-15T08:00:00.000Z"),
        updatedAt: new Date("2026-07-15T08:00:00.000Z"),
      },
    } as never)

    const response = await POST_WORKDAY(workdayRequest({
      clientEventId: "event-1",
      action: "START",
      id: "workday-1",
      occurredAt: "2026-07-15T08:00:00.000Z",
    }))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ idempotent: true, data: { workday: { id: "workday-1" } } })
    expect(prisma.$transaction).not.toHaveBeenCalled()
    expect(prisma.mtmAgentWorkday.create).not.toHaveBeenCalled()
    expect(prisma.mtmAgentWorkdayEvent.create).not.toHaveBeenCalled()
  })

  it("rechecks a concurrently committed replay only after taking the shared workday fence", async () => {
    vi.mocked(resolveMtmRouteActor).mockResolvedValue({
      agentId: "agent-1",
      role: "AGENT",
      scopedAgentIds: ["agent-1"],
    } as never)
    const replay = {
      id: "server-event-1",
      workdayId: "workday-1",
      clientEventId: "event-concurrent",
      type: "START",
      occurredAt: new Date("2026-07-15T08:00:00.000Z"),
      latitude: null,
      longitude: null,
      accuracy: null,
      note: null,
      createdAt: new Date("2026-07-15T08:00:00.000Z"),
      workday: {
        id: "workday-1",
        workDate: new Date("2026-07-15T00:00:00.000Z"),
        status: "STARTED",
        startedAt: new Date("2026-07-15T08:00:00.000Z"),
        pausedAt: null,
        completedAt: null,
        totalPausedSeconds: 0,
        startLatitude: null,
        startLongitude: null,
        endLatitude: null,
        endLongitude: null,
        createdAt: new Date("2026-07-15T08:00:00.000Z"),
        updatedAt: new Date("2026-07-15T08:00:00.000Z"),
      },
    }
    vi.mocked(prisma.mtmAgentWorkdayEvent.findFirst)
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce(replay as never)

    const response = await POST_WORKDAY(workdayRequest({
      clientEventId: "event-concurrent",
      action: "START",
      id: "workday-1",
      occurredAt: "2026-07-15T08:00:00.000Z",
    }))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ idempotent: true, data: { workday: { id: "workday-1" } } })
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1)
    expect(vi.mocked(prisma.$executeRaw).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(prisma.mtmAgentWorkdayEvent.findFirst).mock.invocationCallOrder[1])
    expect(prisma.mtmAgentWorkday.findFirst).not.toHaveBeenCalled()
    expect(prisma.mtmAgentWorkday.create).not.toHaveBeenCalled()
    expect(prisma.mtmAgentWorkdayEvent.create).not.toHaveBeenCalled()
  })

  it("rejects reuse of a clientEventId when any normalized operation field differs", async () => {
    vi.mocked(resolveMtmRouteActor).mockResolvedValue({
      agentId: "agent-1",
      role: "AGENT",
      scopedAgentIds: ["agent-1"],
    } as never)
    vi.mocked(prisma.mtmAgentWorkdayEvent.findFirst).mockResolvedValue({
      id: "server-event-1",
      workdayId: "workday-1",
      clientEventId: "event-1",
      type: "START",
      occurredAt: new Date("2026-07-15T08:00:00.000Z"),
      latitude: null,
      longitude: null,
      accuracy: null,
      note: null,
      createdAt: new Date("2026-07-15T08:00:00.000Z"),
      workday: {
        id: "workday-1",
        workDate: new Date("2026-07-15T00:00:00.000Z"),
        status: "STARTED",
        startedAt: new Date("2026-07-15T08:00:00.000Z"),
        pausedAt: null,
        completedAt: null,
        totalPausedSeconds: 0,
        startLatitude: null,
        startLongitude: null,
        endLatitude: null,
        endLongitude: null,
        createdAt: new Date("2026-07-15T08:00:00.000Z"),
        updatedAt: new Date("2026-07-15T08:00:00.000Z"),
      },
    } as never)
    const response = await POST_WORKDAY(workdayRequest({
      clientEventId: "event-1",
      action: "START",
      id: "workday-1",
      occurredAt: "2026-07-15T08:00:00.000Z",
      note: "different payload",
    }))
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({
      code: "MTM_WEEK_WORKDAY_IDEMPOTENCY_MISMATCH",
      data: {
        workday: { id: "workday-1", status: "STARTED" },
        recovery: {
          canonicalState: "STARTED",
          reason: { messageKey: "operationMismatch" },
          allowedActions: ["PAUSE", "FINISH"],
          refreshRequired: true,
        },
      },
    })
    expect(prisma.$transaction).not.toHaveBeenCalled()
    expect(prisma.mtmAgentWorkday.update).not.toHaveBeenCalled()
  })

  it("takes the per-agent advisory lock before resolving a distinct-key START conflict", async () => {
    vi.mocked(resolveMtmRouteActor).mockResolvedValue({
      agentId: "agent-1",
      role: "AGENT",
      scopedAgentIds: ["agent-1"],
    } as never)
    vi.mocked(prisma.mtmAgentWorkdayEvent.findFirst).mockResolvedValue(null as never)
    vi.mocked(prisma.mtmAgentWorkday.findFirst).mockResolvedValue({
      id: "existing-workday",
      workDate: new Date("2026-07-15T00:00:00.000Z"),
      status: "STARTED",
      startedAt: new Date("2026-07-15T07:00:00.000Z"),
      pausedAt: null,
      completedAt: null,
      totalPausedSeconds: 0,
      startLatitude: null,
      startLongitude: null,
      endLatitude: null,
      endLongitude: null,
      createdAt: new Date("2026-07-15T07:00:00.000Z"),
      updatedAt: new Date("2026-07-15T07:00:00.000Z"),
    } as never)
    const response = await POST_WORKDAY(workdayRequest({
      clientEventId: "event-distinct",
      action: "START",
      id: "workday-new",
      occurredAt: "2026-07-15T08:00:00.000Z",
    }))
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: "MTM_WORKDAY_ALREADY_EXISTS" })
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(2)
    expect(vi.mocked(prisma.$executeRaw).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(prisma.mtmAgentWorkday.findFirst).mock.invocationCallOrder[0])
    expect(prisma.mtmAgentWorkday.create).not.toHaveBeenCalled()
    expect(prisma.mtmAgentWorkdayEvent.create).not.toHaveBeenCalled()
  })

  it("does not let a second permitted mobile device create another active workday", async () => {
    const mobileAuth = {
      orgId: ORG,
      agentId: "agent-1",
      userId: "agent-user",
      role: "AGENT",
      email: "agent@example.test",
      name: "Agent",
      tenantCapabilities: { routeField: false, workforceHrm: true },
    }
    vi.mocked(getMobileAuth).mockReturnValue(mobileAuth as never)
    vi.mocked(resolveMobileAuth).mockResolvedValue(mobileAuth as never)
    vi.mocked(resolveMtmRouteActor).mockResolvedValue({
      agentId: "agent-1",
      role: "AGENT",
      scopedAgentIds: ["agent-1"],
    } as never)
    vi.mocked(prisma.mtmAgentWorkdayEvent.findFirst).mockResolvedValue(null as never)
    vi.mocked(prisma.mtmAgentWorkday.findFirst).mockResolvedValue({
      id: "workday-device-a",
      workDate: new Date("2026-07-15T00:00:00.000Z"),
      status: "STARTED",
      startedAt: new Date("2026-07-15T07:00:00.000Z"),
      pausedAt: null,
      completedAt: null,
      totalPausedSeconds: 0,
      startLatitude: null,
      startLongitude: null,
      endLatitude: null,
      endLongitude: null,
      createdAt: new Date("2026-07-15T07:00:00.000Z"),
      updatedAt: new Date("2026-07-15T07:00:00.000Z"),
    } as never)

    const response = await POST_WORKDAY(workdayRequest({
      clientEventId: "event-device-b-start",
      action: "START",
      id: "workday-device-b",
      occurredAt: "2026-07-15T08:00:00.000Z",
    }, { authorization: "Bearer mobile-token", "x-field-device-id": "device-b" }))

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({
      code: "MTM_WORKDAY_ALREADY_EXISTS",
      data: {
        recovery: {
          canonicalState: "STARTED",
          reason: { messageKey: "alreadyExists" },
          allowedActions: ["PAUSE", "FINISH"],
        },
      },
    })
    expect(evaluateWorkforceMobileWriteAccess).toHaveBeenNthCalledWith(1, {
      auth: { orgId: ORG, agentId: "agent-1" },
      deviceId: "device-b",
    })
    expect(evaluateWorkforceMobileWriteAccess).toHaveBeenNthCalledWith(2, expect.objectContaining({
      auth: { orgId: ORG, agentId: "agent-1" },
      deviceId: "device-b",
      tx: prisma,
    }))
    expect(prisma.mtmAgentWorkday.create).not.toHaveBeenCalled()
    expect(prisma.mtmAgentWorkdayEvent.create).not.toHaveBeenCalled()
  })
})

// ─── Prod audit 2026-09-14: the Panel has to be truthful for a manager ───
describe("GET /api/v1/mtm/week — manager truth (prod audit 2026-09-14)", () => {
  function alertRow(id: string, createdAt: string, distanceMeters: number) {
    return {
      id,
      type: "OUT_OF_ZONE",
      category: "WARNING",
      title: "Out of zone",
      description: `Agent is ${distanceMeters}m away`,
      metadata: { messageKey: "outOfZoneCheckIn", messageParams: { distanceMeters, geofenceRadius: 150 } },
      createdAt: new Date(createdAt),
    }
  }

  it("includes the selected agent's unresolved alerts, scoped and grouped per type per hour", async () => {
    vi.mocked(prisma.mtmAlert.findMany).mockResolvedValue([
      alertRow("a3", "2026-07-15T07:50:00.000Z", 900),
      alertRow("a2", "2026-07-15T07:20:00.000Z", 400),
      alertRow("a1", "2026-07-15T06:10:00.000Z", 300),
    ] as never)

    const response = await GET(weekRequest("?agentId=agent-1&days=1&anchor=2026-07-15"))
    expect(response.status).toBe(200)
    const json = await response.json()

    const where = (vi.mocked(prisma.mtmAlert.findMany).mock.calls[0][0] as any).where
    expect(where).toMatchObject({ organizationId: ORG, agentId: "agent-1", isResolved: false })
    expect(where.createdAt.gte).toBeInstanceOf(Date)

    expect(json.data.queues.alerts.items).toHaveLength(3)
    expect(json.data.queues.alerts.groups).toEqual([
      expect.objectContaining({ type: "OUT_OF_ZONE", date: "2026-07-15", hour: 11, count: 2, maxDistanceMeters: 900 }),
      expect.objectContaining({ type: "OUT_OF_ZONE", date: "2026-07-15", hour: 10, count: 1, maxDistanceMeters: 300 }),
    ])
    expect(json.data.days[0].alertGroups).toHaveLength(2)
    expect(json.data.queues.alerts.groups[0].latest).toMatchObject({ messageKey: "outOfZoneCheckIn", messageParams: { distanceMeters: 900 } })
  })

  it("never reads alerts for an out-of-scope employee or in the filters-only bootstrap", async () => {
    await GET(weekRequest("?agentId=outside-agent&days=1&anchor=2026-07-15"))
    await GET(weekRequest(""))
    expect(prisma.mtmAlert.findMany).not.toHaveBeenCalled()
  })

  it("marks alert truncation instead of silently dropping rows", async () => {
    vi.mocked(prisma.mtmAlert.findMany).mockResolvedValue(
      Array.from({ length: 201 }, (_, index) => alertRow(`a${index}`, "2026-07-15T07:00:00.000Z", 100)) as never,
    )
    const json = await (await GET(weekRequest("?agentId=agent-1&days=1&anchor=2026-07-15"))).json()
    expect(json.data.queues.alerts.truncated).toBe(true)
    expect(json.data.queues.alerts.items).toHaveLength(200)
    expect(json.data.completeness.truncatedSources).toContain("ALERTS")
  })

  it("reports a shift left open since an earlier day as one manager state", async () => {
    vi.mocked(prisma.mtmAgentWorkday.findFirst).mockResolvedValue({
      id: "workday-old",
      workDate: new Date("2026-07-12T00:00:00.000Z"),
      status: "STARTED",
      startedAt: new Date("2026-07-12T16:57:00.000Z"),
      pausedAt: null,
      completedAt: null,
      totalPausedSeconds: 0,
      updatedAt: new Date("2026-07-12T16:57:00.000Z"),
    } as never)
    const json = await (await GET(weekRequest("?agentId=agent-1&days=1&anchor=2026-07-15"))).json()
    expect(json.data.workdayContext.managerState).toMatchObject({ kind: "left-open", workDate: "2026-07-12", days: 3 })
    // The manager cannot close someone else's shift.
    expect(json.data.capabilities.workday.canMutateSelf).toBe(false)
  })

  it("carries visit evidence as counts only: duration, photos, signature, note", async () => {
    vi.mocked(prisma.mtmRoute.findMany).mockResolvedValue([
      route({ points: [point("point-1")], totalPoints: 1 }),
    ] as never)
    vi.mocked(prisma.mtmVisit.findMany).mockResolvedValue([
      visit({
        checkInAt: new Date("2026-07-15T12:46:00.000Z"),
        checkOutAt: new Date("2026-07-15T13:09:00.000Z"),
        notes: "private text",
        _count: { photos: 3 },
        actionResults: [{ actionKey: "SIGNATURE" }],
      }),
    ] as never)
    const response = await GET(weekRequest("?agentId=agent-1&days=1&anchor=2026-07-15"))
    const json = await response.json()
    const visitQuery = vi.mocked(prisma.mtmVisit.findMany).mock.calls[0][0] as any
    expect(visitQuery.select._count).toEqual({ select: { photos: true } })
    expect(visitQuery.select.actionResults.where).toEqual({ status: "COMPLETED", actionKey: { in: ["SIGNATURE", "VISIT_NOTE"] } })
    expect(json.data.days[0].routes[0].points[0].actualEvidence).toMatchObject({
      visitId: "visit-1",
      durationMinutes: 23,
      photoCount: 3,
      hasSignature: true,
      hasNote: true,
      // Review of #210: note text is not sent for a completed visit.
      reason: null,
    })
    expect(JSON.stringify(json.data)).not.toContain("private text")
  })
})

// ─── Owner decision 2026-09-15: a manager reopens today's finished workday ───
describe("GET /api/v1/mtm/week — manager reopen actions", () => {
  const WEEK_QUERY = "?agentId=agent-1&days=1&anchor=2026-07-15"
  const AGENT_USER_ID = "agent-1-user"
  // Asia/Baku (the tenant default) is UTC+4: 08:00Z is noon of 15 July there.
  const TODAY = new Date("2026-07-15T00:00:00.000Z")
  const STARTED_AT = new Date("2026-07-15T05:00:00.000Z")
  const FINISHED_AT = new Date("2026-07-15T07:30:00.000Z")
  const FINISH_SAVED_AT = new Date("2026-07-15T07:30:01.000Z")
  const REOPENED_AT = new Date("2026-07-15T07:40:00.000Z")
  const MANAGER_SESSION = { ...SESSION, role: "manager", principalType: "session" }
  /** The endpoints' MFA policy: required for the user, with an enrolled factor. */
  const MFA_USER = { require2fa: true, totpEnabled: true, smsAuthEnabled: false, verifiedPhone: null }
  const NO_MFA_USER = { ...MFA_USER, require2fa: false }

  function todayWorkday(overrides: Record<string, unknown> = {}) {
    return {
      id: "workday-today",
      organizationId: ORG,
      agentId: "agent-1",
      workDate: TODAY,
      status: "COMPLETED",
      startedAt: STARTED_AT,
      pausedAt: null,
      completedAt: FINISHED_AT,
      totalPausedSeconds: 0,
      updatedAt: FINISH_SAVED_AT,
      agent: { userId: AGENT_USER_ID },
      ...overrides,
    }
  }

  function reopenedWorkday(overrides: Record<string, unknown> = {}) {
    return todayWorkday({ status: "PAUSED", pausedAt: FINISHED_AT, completedAt: null, updatedAt: REOPENED_AT, ...overrides })
  }

  function journalEvent(id: string, type: string, occurredAt: Date, appliedAt: Date = occurredAt, clientEventId = `${type.toLowerCase()}-${id}`) {
    return { id, type, occurredAt, appliedAt, clientEventId }
  }

  const finishedJournal = [
    journalEvent("event-1", "START", STARTED_AT),
    journalEvent("event-2", "FINISH", FINISHED_AT),
  ]
  const reopenedJournal = [
    ...finishedJournal,
    journalEvent("event-3", "REOPEN", FINISHED_AT, REOPENED_AT, "reopen:operation-1"),
  ]

  const timeApproverGrant = {
    id: "grant-time-approver-1",
    organizationId: ORG,
    principalUserId: SESSION.userId,
    role: "TIME_APPROVER",
    scopeKind: "AGENT",
    scopeTeamId: null,
    scopeSiteId: null,
    scopeAgentId: "agent-1",
    effectiveFrom: new Date("2026-07-01T00:00:00.000Z"),
    effectiveUntil: null,
    revocation: null,
  }

  /**
   * The week reads the open shift by status; the manager actions read today's
   * row by date and, for a reopen, any other open shift by excluded id.
   */
  function mockWorkdays(today: Record<string, unknown> | null, options: { otherOpenWorkday?: boolean } = {}) {
    vi.mocked(prisma.mtmAgentWorkday.findFirst).mockImplementation((async (query: { where?: Record<string, unknown> }) => {
      const where = query?.where ?? {}
      const workDate = where.workDate
      if (workDate instanceof Date) return today && workDate.getTime() === TODAY.getTime() ? today : null
      if ((where.id as { not?: string } | undefined)?.not) return options.otherOpenWorkday ? { id: "workday-other" } : null
      const statuses = (where.status as { in?: string[] } | undefined)?.in ?? []
      return today && statuses.includes(String(today.status)) ? today : null
    }) as never)
  }

  async function managerActions(query = WEEK_QUERY) {
    const response = await GET(weekRequest(query))
    expect(response.status).toBe(200)
    return (await response.json()).data.workdayContext.managerActions
  }

  function managerActionsRead(): boolean {
    return vi.mocked(prisma.mtmAgentWorkday.findFirst).mock.calls
      .some(([query]) => (query as { where?: { workDate?: unknown } } | undefined)?.where?.workDate instanceof Date)
  }

  beforeEach(() => {
    vi.mocked(requireAuth).mockResolvedValue(MANAGER_SESSION as never)
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ ...SELECTED_AGENT, userId: AGENT_USER_ID } as never)
    mockWorkdays(todayWorkday())
    vi.mocked(prisma.mtmAgentWorkdayEvent.findMany).mockResolvedValue(finishedJournal as never)
    vi.mocked(prisma.workforceTimesheetApproval.findFirst).mockResolvedValue(null as never)
    vi.mocked(prisma.mtmHrmRequest.findFirst).mockResolvedValue(null as never)
    vi.mocked(prisma.workforceTimeCorrection.findMany).mockResolvedValue([] as never)
    vi.mocked(prisma.workforceWorkdayReopen.findFirst).mockResolvedValue(null as never)
    vi.mocked(prisma.workforceAccessGrant.findMany).mockResolvedValue([] as never)
    vi.mocked(prisma.user.findFirst).mockResolvedValue(MFA_USER as never)
  })

  afterEach(() => {
    vi.mocked(prisma.mtmAgentWorkdayEvent.findMany).mockResolvedValue([] as never)
  })

  it("offers a manager in scope the reopen of today's finished day, with the version to send", async () => {
    expect(await managerActions()).toEqual({
      reopen: {
        allowed: true,
        workdayId: "workday-today",
        updatedAt: FINISH_SAVED_AT.toISOString(),
        blockedReason: null,
      },
      undoReopen: {
        allowed: false,
        workdayId: "workday-today",
        updatedAt: FINISH_SAVED_AT.toISOString(),
        blockedReason: "WORKFORCE_WORKDAY_REOPEN_UNDO_NOT_REOPENED",
      },
    })
    // Row, journal and blockers are read on one snapshot.
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "RepeatableRead" })
    expect(prisma.mtmAgentWorkday.findFirst).toHaveBeenCalledWith({
      where: { organizationId: ORG, agentId: "agent-1", workDate: TODAY },
      select: expect.objectContaining({ updatedAt: true, agent: { select: { userId: true } } }),
    })
    expect(prisma.workforceTimesheetApproval.findFirst).toHaveBeenCalledWith({
      where: { organizationId: ORG, agentId: "agent-1", periodStart: { lte: TODAY }, periodEnd: { gte: TODAY } },
      select: { id: true },
    })
  })

  it("keeps the manager actions out of the snapshot identity", async () => {
    const offered = await (await GET(weekRequest(WEEK_QUERY))).json()
    vi.mocked(requireAuth).mockResolvedValue({ ...MANAGER_SESSION, principalType: "api_key" } as never)
    const withheld = await (await GET(weekRequest(WEEK_QUERY))).json()

    expect(offered.data.workdayContext.managerActions.reopen.allowed).toBe(true)
    expect(withheld.data.workdayContext.managerActions).toBeNull()
    expect(withheld.data.snapshotId).toBe(offered.data.snapshotId)
  })

  it.each([
    ["an approved timesheet", "WORKFORCE_WORKDAY_REOPEN_TIMESHEET_APPROVED", () => {
      vi.mocked(prisma.workforceTimesheetApproval.findFirst).mockResolvedValue({ id: "approval-1" } as never)
      // The service's order: the approval is named even when the day was also corrected.
      vi.mocked(prisma.workforceTimeCorrection.findMany).mockResolvedValue([{ id: "correction-1" }] as never)
    }],
    ["a pending time-correction request", "WORKFORCE_WORKDAY_REOPEN_CORRECTION_PENDING", () => {
      vi.mocked(prisma.mtmHrmRequest.findFirst).mockResolvedValue({ id: "request-1" } as never)
    }],
    ["a corrected day", "WORKFORCE_WORKDAY_REOPEN_CORRECTED", () => {
      vi.mocked(prisma.workforceTimeCorrection.findMany).mockResolvedValue([{ id: "correction-1" }] as never)
    }],
    ["another open shift", "WORKFORCE_WORKDAY_REOPEN_OPEN_SHIFT_EXISTS", () => {
      mockWorkdays(todayWorkday(), { otherOpenWorkday: true })
    }],
    ["a journal that no longer reproduces the day", "WORKFORCE_WORKDAY_REOPEN_HISTORY_INVALID", () => {
      vi.mocked(prisma.mtmAgentWorkdayEvent.findMany).mockResolvedValue([finishedJournal[0]] as never)
    }],
  ])("refuses the reopen for %s with the service's 409 code", async (_label, code, arrange) => {
    arrange()
    const actions = await managerActions()
    expect(actions.reopen).toEqual({
      allowed: false,
      workdayId: "workday-today",
      updatedAt: FINISH_SAVED_AT.toISOString(),
      blockedReason: code,
    })
    expect(actions.undoReopen.allowed).toBe(false)
  })

  it("reports a running or not yet started day by its state, without reading authority or blockers", async () => {
    mockWorkdays(todayWorkday({ status: "STARTED", completedAt: null }))
    expect(await managerActions()).toEqual({
      reopen: {
        allowed: false,
        workdayId: "workday-today",
        updatedAt: FINISH_SAVED_AT.toISOString(),
        blockedReason: "WORKFORCE_WORKDAY_REOPEN_NOT_COMPLETED",
      },
      undoReopen: {
        allowed: false,
        workdayId: "workday-today",
        updatedAt: FINISH_SAVED_AT.toISOString(),
        blockedReason: "WORKFORCE_WORKDAY_REOPEN_UNDO_NOT_REOPENED",
      },
    })
    expect(prisma.workforceTimesheetApproval.findFirst).not.toHaveBeenCalled()
    expect(prisma.mtmAgentWorkdayEvent.findMany).not.toHaveBeenCalled()
    expect(prisma.workforceAccessGrant.findMany).not.toHaveBeenCalled()

    mockWorkdays(null)
    expect(await managerActions()).toEqual({
      reopen: { allowed: false, workdayId: null, updatedAt: null, blockedReason: "WORKFORCE_WORKDAY_REOPEN_NOT_COMPLETED" },
      undoReopen: { allowed: false, workdayId: null, updatedAt: null, blockedReason: "WORKFORCE_WORKDAY_REOPEN_UNDO_NOT_REOPENED" },
    })
  })

  it("tells a session whose CRM role lacks Workforce write why it cannot reopen", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ ...MANAGER_SESSION, role: "support" } as never)

    expect((await managerActions()).reopen).toMatchObject({
      allowed: false,
      blockedReason: "WORKFORCE_SESSION_PERMISSION_REQUIRED",
    })
    expect(prisma.workforceTimesheetApproval.findFirst).not.toHaveBeenCalled()
  })

  it("requires a TIME_CORRECT grant once the tenant is on granular Workforce access", async () => {
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({
      plan: "enterprise",
      addons: [],
      features: [WORKFORCE_GRANULAR_ACCESS_FLAG],
      modules: { mtm: true },
    } as never)

    expect((await managerActions()).reopen).toMatchObject({ allowed: false, blockedReason: "WORKFORCE_SCOPE_DENIED" })
    expect(prisma.workforceTimesheetApproval.findFirst).not.toHaveBeenCalled()

    vi.mocked(prisma.workforceAccessGrant.findMany).mockResolvedValue([timeApproverGrant] as never)
    expect((await managerActions()).reopen).toMatchObject({ allowed: true, blockedReason: null })
  })

  it("offers the undo while the manager's reopen is still the day's last event", async () => {
    mockWorkdays(reopenedWorkday())
    vi.mocked(prisma.mtmAgentWorkdayEvent.findMany).mockResolvedValue(reopenedJournal as never)
    vi.mocked(prisma.workforceWorkdayReopen.findFirst).mockResolvedValue({ id: "reopen-1" } as never)

    expect(await managerActions()).toEqual({
      reopen: {
        allowed: false,
        workdayId: "workday-today",
        updatedAt: REOPENED_AT.toISOString(),
        blockedReason: "WORKFORCE_WORKDAY_REOPEN_NOT_COMPLETED",
      },
      undoReopen: {
        allowed: true,
        workdayId: "workday-today",
        updatedAt: REOPENED_AT.toISOString(),
        blockedReason: null,
      },
    })
    expect(prisma.workforceWorkdayReopen.findFirst).toHaveBeenCalledWith({
      where: { organizationId: ORG, agentId: "agent-1", workdayId: "workday-today", eventId: "event-3" },
      select: { id: true },
    })
  })

  it.each([
    ["an ordinary break", false, () => {
      const pausedAt = new Date("2026-07-15T07:00:00.000Z")
      mockWorkdays(todayWorkday({ status: "PAUSED", pausedAt, completedAt: null }))
      vi.mocked(prisma.mtmAgentWorkdayEvent.findMany).mockResolvedValue([
        finishedJournal[0],
        journalEvent("event-2", "PAUSE", pausedAt),
      ] as never)
    }],
    ["a reopen the agent already resumed and paused again", false, () => {
      const pausedAgainAt = new Date("2026-07-15T07:50:00.000Z")
      mockWorkdays(reopenedWorkday({ pausedAt: pausedAgainAt, totalPausedSeconds: 600 }))
      vi.mocked(prisma.mtmAgentWorkdayEvent.findMany).mockResolvedValue([
        ...reopenedJournal,
        journalEvent("event-4", "RESUME", REOPENED_AT),
        journalEvent("event-5", "PAUSE", pausedAgainAt),
      ] as never)
      vi.mocked(prisma.workforceWorkdayReopen.findFirst).mockResolvedValue({ id: "reopen-1" } as never)
    }],
    ["a REOPEN event without its ledger row", true, () => {
      mockWorkdays(reopenedWorkday())
      vi.mocked(prisma.mtmAgentWorkdayEvent.findMany).mockResolvedValue(reopenedJournal as never)
    }],
  ])("does not offer the undo for %s", async (_label, ledgerRead, arrange) => {
    arrange()
    expect((await managerActions()).undoReopen).toMatchObject({
      allowed: false,
      blockedReason: "WORKFORCE_WORKDAY_REOPEN_UNDO_NOT_REOPENED",
    })
    expect(prisma.workforceWorkdayReopen.findFirst).toHaveBeenCalledTimes(ledgerRead ? 1 : 0)
  })

  it("refuses the undo when the journal no longer reproduces the reopened day", async () => {
    mockWorkdays(reopenedWorkday({ totalPausedSeconds: 60 }))
    vi.mocked(prisma.mtmAgentWorkdayEvent.findMany).mockResolvedValue(reopenedJournal as never)
    vi.mocked(prisma.workforceWorkdayReopen.findFirst).mockResolvedValue({ id: "reopen-1" } as never)

    expect((await managerActions()).undoReopen).toMatchObject({
      allowed: false,
      blockedReason: "WORKFORCE_WORKDAY_REOPEN_UNDO_HISTORY_INVALID",
    })
  })

  it("reports the endpoints' missing MFA before the manager writes a reason, with the route's own code", async () => {
    vi.mocked(prisma.user.findFirst).mockResolvedValue(NO_MFA_USER as never)
    const actions = await managerActions()

    expect(actions.reopen).toEqual({
      allowed: false,
      workdayId: "workday-today",
      updatedAt: FINISH_SAVED_AT.toISOString(),
      blockedReason: "WORKFORCE_ATTENDANCE_MFA_REQUIRED",
    })
    // Exactly the check the reopen/undo routes run, on the viewer's own user.
    expect(prisma.user.findFirst).toHaveBeenCalledWith({
      where: { id: SESSION.userId, organizationId: ORG, isActive: true },
      select: { require2fa: true, totpEnabled: true, smsAuthEnabled: true, verifiedPhone: true },
    })
    const routeDenial = await requireWorkforceAttendanceSecurityMfa(ORG, { userId: SESSION.userId, principalType: "session" })
    expect(routeDenial?.status).toBe(403)
    expect((await routeDenial?.json())?.code).toBe(actions.reopen.blockedReason)

    mockWorkdays(reopenedWorkday())
    vi.mocked(prisma.mtmAgentWorkdayEvent.findMany).mockResolvedValue(reopenedJournal as never)
    vi.mocked(prisma.workforceWorkdayReopen.findFirst).mockResolvedValue({ id: "reopen-1" } as never)
    expect((await managerActions()).undoReopen).toEqual({
      allowed: false,
      workdayId: "workday-today",
      updatedAt: REOPENED_AT.toISOString(),
      blockedReason: "WORKFORCE_ATTENDANCE_MFA_REQUIRED",
    })
  })

  it.each([
    ["a running day", () => mockWorkdays(todayWorkday({ status: "STARTED", completedAt: null })), "WORKFORCE_WORKDAY_REOPEN_NOT_COMPLETED"],
    ["an ordinary break", () => {
      const pausedAt = new Date("2026-07-15T07:00:00.000Z")
      mockWorkdays(todayWorkday({ status: "PAUSED", pausedAt, completedAt: null }))
      vi.mocked(prisma.mtmAgentWorkdayEvent.findMany).mockResolvedValue([
        finishedJournal[0],
        journalEvent("event-2", "PAUSE", pausedAt),
      ] as never)
    }, "WORKFORCE_WORKDAY_REOPEN_NOT_COMPLETED"],
    ["an approved timesheet", () => {
      vi.mocked(prisma.workforceTimesheetApproval.findFirst).mockResolvedValue({ id: "approval-1" } as never)
    }, "WORKFORCE_WORKDAY_REOPEN_TIMESHEET_APPROVED"],
    ["a role without Workforce write", () => {
      vi.mocked(requireAuth).mockResolvedValue({ ...MANAGER_SESSION, role: "support" } as never)
    }, "WORKFORCE_SESSION_PERMISSION_REQUIRED"],
  ])("names missing MFA only on a day the manager could otherwise change, not on %s", async (_label, arrange, reopenReason) => {
    vi.mocked(prisma.user.findFirst).mockResolvedValue(NO_MFA_USER as never)
    arrange()
    const actions = await managerActions()

    expect(actions.reopen.blockedReason).toBe(reopenReason)
    expect(actions.undoReopen.blockedReason).not.toBe("WORKFORCE_ATTENDANCE_MFA_REQUIRED")
    expect(prisma.user.findFirst).not.toHaveBeenCalled()
  })

  it("gives the agent's own view no manager actions", async () => {
    vi.mocked(resolveMtmRouteActor).mockResolvedValue({
      agentId: "agent-1",
      role: "AGENT",
      scopedAgentIds: ["agent-1"],
    } as never)
    expect(await managerActions("?days=1&anchor=2026-07-15")).toBeNull()

    // A manager looking at their own card, and a web admin at the card linked to their user.
    vi.mocked(resolveMtmRouteActor).mockResolvedValue(MANAGER as never)
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ ...SELECTED_AGENT, id: "manager-agent", userId: SESSION.userId } as never)
    expect(await managerActions("?agentId=manager-agent&days=1&anchor=2026-07-15")).toBeNull()
    vi.mocked(resolveMtmRouteActor).mockResolvedValue({ agentId: null, role: "ADMIN", scopedAgentIds: null } as never)
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ ...SELECTED_AGENT, userId: SESSION.userId } as never)
    expect(await managerActions()).toBeNull()

    expect(managerActionsRead()).toBe(false)
  })

  it("gives a mobile token, an API key and a Routes-only tenant no manager actions", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ ...MANAGER_SESSION, principalType: "api_key" } as never)
    expect(await managerActions()).toBeNull()

    vi.mocked(requireAuth).mockResolvedValue(MANAGER_SESSION as never)
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({
      plan: "enterprise",
      addons: [],
      features: [],
      modules: { mtm: true, "workforce-hrm": false },
    } as never)
    expect(await managerActions()).toBeNull()

    const mobileAuth = {
      orgId: ORG,
      agentId: "manager-agent",
      userId: SESSION.userId,
      role: "MANAGER",
      email: "manager@example.com",
      name: "Manager",
    }
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({
      plan: "enterprise",
      addons: [],
      features: [],
      modules: { mtm: true },
    } as never)
    vi.mocked(getMobileAuth).mockReturnValue(mobileAuth as never)
    vi.mocked(resolveMobileAuth).mockResolvedValue(mobileAuth as never)
    const response = await GET(new NextRequest(`http://localhost:3000/api/v1/mtm/week${WEEK_QUERY}`, {
      headers: { authorization: "Bearer mobile-token" },
    }))
    expect(response.status).toBe(200)
    expect((await response.json()).data.workdayContext.managerActions).toBeNull()

    expect(managerActionsRead()).toBe(false)
  })

  it("keeps the week readable and offers nothing when the actions cannot be evaluated", async () => {
    vi.mocked(prisma.workforceTimesheetApproval.findFirst).mockRejectedValue(new Error("database unavailable"))
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    try {
      expect(await managerActions()).toBeNull()
      expect(warn).toHaveBeenCalledWith("[MTM/week GET] Workforce manager actions unavailable", expect.any(Error))
    } finally {
      warn.mockRestore()
    }
  })
})
