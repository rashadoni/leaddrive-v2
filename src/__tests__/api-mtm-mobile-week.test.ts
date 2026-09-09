import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/prisma", async () => {
  const { makeMtmPrismaMock } = await import("./mocks/mtm-prisma")
  return { prisma: makeMtmPrismaMock() }
})

vi.mock("@/lib/mobile-auth", async () => {
  const { makeMobileAuthMock } = await import("./mocks/mobile-auth")
  return makeMobileAuthMock()
})

import { GET } from "@/app/api/v1/mtm/mobile/week/route"
import { resolveMobileAuth } from "@/lib/mobile-auth"
import { prisma } from "@/lib/prisma"

const ORG = "org-1"
const AGENT_ID = "agent-1"
const AUTH_CONTEXT = { orgId: ORG, agentId: AGENT_ID }

function makeReq(query = ""): NextRequest {
  return new NextRequest(
    new URL(`http://localhost:3000/api/v1/mtm/mobile/week${query}`),
    { headers: { Authorization: "Bearer valid-token" } },
  )
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date("2026-07-15T08:00:00.000Z"))
  vi.clearAllMocks()
  vi.mocked(resolveMobileAuth).mockResolvedValue(AUTH_CONTEXT as any)
  vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({
    id: AGENT_ID,
    teamId: "team-1",
    role: "AGENT",
    canPlanOwnRoutes: true,
    canSelfPublishRoutes: false,
  } as any)
  vi.mocked(prisma.mtmCustomer.findFirst).mockImplementation(async (args: any) => ({
    id: args?.where?.id ?? "customer-1",
    category: "B",
    objectType: "CLINIC",
  }) as any)
  vi.mocked(prisma.mtmSetting.findFirst).mockResolvedValue(null)
  vi.mocked(prisma.mtmVisitPolicy.findMany).mockResolvedValue([])
  vi.mocked(prisma.mtmSetting.findMany).mockResolvedValue([])
  vi.mocked(prisma.mtmRoute.findMany).mockResolvedValue([])
  vi.mocked(prisma.mtmTask.findMany).mockResolvedValue([])
  vi.mocked(prisma.mtmVisit.findMany).mockResolvedValue([])
  vi.mocked(prisma.mtmWorkCalendarDay.findMany).mockResolvedValue([])
  vi.mocked(prisma.mtmNotification.findMany).mockResolvedValue([])
  vi.mocked(prisma.mtmMessageReceipt.findFirst).mockResolvedValue(null)
})

afterEach(() => {
  vi.useRealTimers()
})

describe("GET /api/v1/mtm/mobile/week", () => {
  it("returns 401 for an unauthenticated mobile request", async () => {
    vi.mocked(resolveMobileAuth).mockResolvedValue(null as any)
    const response = await GET(makeReq())
    expect(response.status).toBe(401)
  })

  it("rejects an invalid start date before querying week data", async () => {
    const response = await GET(makeReq("?start=2026-02-29"))
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ code: "MTM_WEEK_START_INVALID" })
    expect(prisma.mtmRoute.findMany).not.toHaveBeenCalled()
  })

  it("normalizes to Monday, uses organization-local boundaries and scopes every query", async () => {
    const response = await GET(makeReq("?start=2026-07-15"))
    expect(response.status).toBe(200)
    const json = await response.json()

    expect(json.data).toMatchObject({
      protocolVersion: 2,
      timezone: "Asia/Baku",
      weekStart: "2026-07-13",
      weekEndExclusive: "2026-07-20",
      today: "2026-07-15",
      calendarSource: "WORK_CALENDAR_V1",
      capabilities: {
        createOwnDraft: true,
        editOwnDraft: true,
        selfPublish: false,
        requestRouteChange: true,
        requestCustomer: true,
      },
      operational: {
        announcement: null,
        support: { email: null, phone: null },
      },
    })
    expect(json.data.days).toHaveLength(7)
    expect(json.data.days[5]).toMatchObject({
      date: "2026-07-18",
      isWeekend: true,
      isWorkingDay: false,
      nonWorkingReason: null,
      calendarKind: "WEEKEND",
      calendarSource: "WEEKEND_DEFAULT",
      routePlanningAllowed: false,
    })

    const routeArgs = vi.mocked(prisma.mtmRoute.findMany).mock.calls[0][0] as any
    expect(routeArgs.where).toMatchObject({
      organizationId: ORG,
      deletedAt: null,
      OR: [
        { agentId: AGENT_ID },
        { assignments: { some: { agentId: AGENT_ID, removedAt: null } } },
      ],
      date: {
        gte: new Date("2026-07-13T00:00:00.000Z"),
        lt: new Date("2026-07-20T00:00:00.000Z"),
      },
    })
    expect(routeArgs.select).toMatchObject({ version: true })
    const taskArgs = vi.mocked(prisma.mtmTask.findMany).mock.calls[0][0] as any
    expect(taskArgs.where.organizationId).toBe(ORG)
    expect(taskArgs.where.agentId).toBe(AGENT_ID)
    expect(taskArgs.where.OR[0].dueDate).toEqual({
      gte: new Date("2026-07-12T20:00:00.000Z"),
      lt: new Date("2026-07-19T20:00:00.000Z"),
    })
    const visitArgs = vi.mocked(prisma.mtmVisit.findMany).mock.calls[0][0] as any
    expect(visitArgs.where).toMatchObject({
      organizationId: ORG,
      agentId: AGENT_ID,
      deletedAt: null,
      checkInAt: {
        gte: new Date("2026-07-12T20:00:00.000Z"),
        lt: new Date("2026-07-19T20:00:00.000Z"),
      },
    })
    expect(visitArgs.select).toMatchObject({
      routeId: true,
      routePointId: true,
      potential: true,
      notes: true,
      resultNotes: true,
    })
    const calendarArgs = vi.mocked(prisma.mtmWorkCalendarDay.findMany).mock.calls[0][0] as any
    expect(calendarArgs.where).toMatchObject({
      organizationId: ORG,
      deletedAt: null,
      date: {
        gte: new Date("2026-07-13T00:00:00.000Z"),
        lt: new Date("2026-07-20T00:00:00.000Z"),
      },
      OR: [
        { teamId: null, agentId: null },
        { teamId: "team-1", agentId: null },
        { teamId: null, agentId: AGENT_ID },
      ],
    })
  })

  it("stops offering a closed day for execution while keeping its stops in the week's coverage", async () => {
    vi.mocked(prisma.mtmRoute.findMany).mockResolvedValue([{
      id: "route-closed",
      name: "Yesterday",
      date: new Date("2026-07-14T00:00:00.000Z"),
      status: "INCOMPLETE",
      version: 3,
      agentId: AGENT_ID,
      totalPoints: 2,
      visitedPoints: 1,
      startedAt: new Date("2026-07-14T06:00:00.000Z"),
      completedAt: null,
      notes: null,
      assignments: [],
      points: [
        {
          id: "point-1", customerId: "customer-1", orderIndex: 0, status: "VISITED",
          plannedTime: null, visitedAt: new Date("2026-07-14T08:00:00.000Z"), notes: null,
          customer: {
            id: "customer-1", name: "Clinic One", code: "C-1", objectType: "CLINIC",
            category: "A", address: "Baku", city: "Baku", phone: null, latitude: 40.4, longitude: 49.8,
          },
        },
        {
          id: "point-2", customerId: "customer-2", orderIndex: 1, status: "PENDING",
          plannedTime: null, visitedAt: null, notes: null,
          customer: {
            id: "customer-2", name: "Clinic Two", code: "C-2", objectType: "CLINIC",
            category: "B", address: "Baku", city: "Baku", phone: null, latitude: 40.41, longitude: 49.81,
          },
        },
      ],
    }] as any)

    const json = await (await GET(makeReq("?start=2026-07-13"))).json()
    const tuesday = json.data.days[1]

    expect(tuesday.routes[0]).toMatchObject({
      persistedStatus: "INCOMPLETE",
      // The stored decision stands; MISSED is not derived over it.
      effectiveStatus: "INCOMPLETE",
      // The server closed this day, so the app must not offer to work it.
      canExecute: false,
      canEdit: false,
    })
    // The plan still existed, so its stops stay in the denominator. Dropping
    // them would make a failed day look like a day with nothing planned.
    expect(json.data.summary).toMatchObject({ plannedStops: 2, visitedStops: 1 })
    expect(tuesday.routes[0].points.map((point: any) => point.effectiveStatus)).toEqual(["VISITED", "MISSED"])
  })

  it("returns participant routes and derives missed route/stop states without mutating storage", async () => {
    vi.mocked(prisma.mtmRoute.findMany).mockResolvedValue([{
      id: "route-1",
      name: "North clinics",
      date: new Date("2026-07-14T00:00:00.000Z"),
      status: "PLANNED",
      version: 7,
      agentId: "primary-agent",
      totalPoints: 2,
      visitedPoints: 1,
      startedAt: null,
      completedAt: null,
      notes: null,
      assignments: [{
        agentId: AGENT_ID,
        role: "PARTICIPANT",
        assignedAt: new Date("2026-07-13T08:00:00.000Z"),
        agent: { id: AGENT_ID, name: "Ali", role: "AGENT" },
      }],
      points: [
        {
          id: "point-1",
          customerId: "customer-1",
          orderIndex: 0,
          status: "VISITED",
          plannedTime: null,
          visitedAt: new Date("2026-07-14T08:00:00.000Z"),
          notes: null,
          customer: {
            id: "customer-1", name: "Clinic One", code: "C-1",
            objectType: "CLINIC", category: "A", address: "Baku", city: "Baku",
            phone: null, latitude: 40.4, longitude: 49.8,
          },
        },
        {
          id: "point-2",
          customerId: "customer-2",
          orderIndex: 1,
          status: "PENDING",
          plannedTime: null,
          visitedAt: null,
          notes: null,
          customer: {
            id: "customer-2", name: "Clinic Two", code: "C-2",
            objectType: "CLINIC", category: "B", address: "Baku", city: "Baku",
            phone: null, latitude: 40.41, longitude: 49.81,
          },
        },
      ],
    }] as any)

    const response = await GET(makeReq("?start=2026-07-13"))
    const json = await response.json()
    const tuesday = json.data.days[1]

    expect(tuesday.routes[0]).toMatchObject({
      id: "route-1",
      version: 7,
      persistedStatus: "PLANNED",
      effectiveStatus: "MISSED",
      assignmentRole: "PARTICIPANT",
      canExecute: true,
      canEdit: false,
      canPublish: false,
    })
    expect(tuesday.routes[0].points.map((point: any) => point.effectiveStatus)).toEqual([
      "VISITED",
      "MISSED",
    ])
    expect(tuesday.routes[0].points[0].visitPolicy.requirements).toEqual(expect.arrayContaining([
      expect.objectContaining({ actionKey: "VISIT_NOTE", mode: "OPTIONAL", minCount: 1 }),
    ]))
    expect(json.data.summary).toMatchObject({
      routes: 1,
      plannedStops: 2,
      visitedStops: 1,
      missedStops: 1,
      coverage: { plannedCustomers: 2, coveredCustomers: 1, percentage: 50 },
    })
  })

  it("exposes the route context and result fields required by the mobile visit workspace", async () => {
    vi.mocked(prisma.mtmVisit.findMany).mockResolvedValue([{
      id: "visit-1",
      customerId: "customer-1",
      contactId: "contact-1",
      routeId: "route-1",
      routePointId: "point-1",
      status: "CHECKED_IN",
      checkInAt: new Date("2026-07-15T08:00:00.000Z"),
      checkOutAt: null,
      outcome: null,
      potential: "HIGH",
      notes: "Discuss the launch",
      resultNotes: null,
      customer: { id: "customer-1", name: "Clinic One", objectType: "CLINIC" },
      contact: { id: "contact-1", displayName: "Dr Ali", type: "DOCTOR" },
    }] as any)

    const response = await GET(makeReq("?start=2026-07-13"))
    const json = await response.json()
    expect(json.data.days[2].visits.items[0]).toMatchObject({
      id: "visit-1",
      routeId: "route-1",
      routePointId: "point-1",
      potential: "HIGH",
      notes: "Discuss the launch",
      resultNotes: null,
    })
  })

  it("exposes self-publish only when the organization and manager both enable it", async () => {
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({
      id: AGENT_ID,
      teamId: "team-1",
      role: "AGENT",
      canPlanOwnRoutes: true,
      canSelfPublishRoutes: true,
    } as any)
    vi.mocked(prisma.mtmSetting.findMany).mockResolvedValue([{
      key: "routeSelfPublish",
      value: true,
    }] as any)
    vi.mocked(prisma.mtmRoute.findMany).mockResolvedValue([{
      id: "draft-1",
      name: "My draft",
      date: new Date("2026-07-15T00:00:00.000Z"),
      status: "DRAFT",
      agentId: AGENT_ID,
      totalPoints: 1,
      visitedPoints: 0,
      startedAt: null,
      completedAt: null,
      notes: null,
      assignments: [],
      points: [],
    }] as any)

    const response = await GET(makeReq("?start=2026-07-15"))
    const json = await response.json()
    expect(json.data.capabilities.selfPublish).toBe(true)
    expect(json.data.days[2].routes[0]).toMatchObject({
      canEdit: true,
      canPublish: true,
      assignmentRole: "PRIMARY",
      effectiveStatus: "DRAFT",
    })
  })

  it("includes the localized active key message, acknowledgement and tenant support", async () => {
    vi.mocked(prisma.mtmSetting.findMany).mockResolvedValue([
      { key: "supportEmail", value: "support@swissmed.example" },
      { key: "supportPhone", value: "+994 12 555 01 01" },
    ] as any)
    vi.mocked(prisma.mtmNotification.findMany).mockResolvedValue([{
      id: "notification-1",
      title: "Important",
      body: "Fallback",
      metadata: {
        keyMessage: true,
        messageId: "message-1",
        threadId: "thread-1",
        effectiveFrom: "2026-07-15T00:00:00.000Z",
        effectiveUntil: "2026-07-22T00:00:00.000Z",
        fallbackBody: "Fallback",
        localizations: { ru: "План изменён", en: "Plan changed" },
      },
      createdAt: new Date("2026-07-15T06:00:00.000Z"),
    }] as any)
    vi.mocked(prisma.mtmMessageReceipt.findFirst).mockResolvedValue({
      occurredAt: new Date("2026-07-15T07:30:00.000Z"),
    } as any)

    const response = await GET(makeReq("?start=2026-07-15&locale=ru"))
    const json = await response.json()
    expect(json.data.operational).toMatchObject({
      announcement: {
        notificationId: "notification-1",
        messageId: "message-1",
        body: "План изменён",
        acknowledgementRequired: true,
        acknowledgedAt: "2026-07-15T07:30:00.000Z",
      },
      support: {
        email: "support@swissmed.example",
        phone: "+994 12 555 01 01",
      },
    })
  })

  it("applies an agent calendar override before deriving missed status", async () => {
    vi.mocked(prisma.mtmWorkCalendarDay.findMany).mockResolvedValue([{
      id: "calendar-1",
      date: new Date("2026-07-14T00:00:00.000Z"),
      kind: "PUBLIC_HOLIDAY",
      name: "National holiday",
      teamId: null,
      agentId: AGENT_ID,
      movedToDate: null,
      routePlanningAllowed: false,
    }] as any)
    vi.mocked(prisma.mtmRoute.findMany).mockResolvedValue([{
      id: "route-holiday",
      name: "Was planned before holiday",
      date: new Date("2026-07-14T00:00:00.000Z"),
      status: "PLANNED",
      agentId: AGENT_ID,
      totalPoints: 1,
      visitedPoints: 0,
      startedAt: null,
      completedAt: null,
      notes: null,
      assignments: [],
      points: [],
    }] as any)

    const response = await GET(makeReq("?start=2026-07-13"))
    const json = await response.json()
    const tuesday = json.data.days[1]
    expect(tuesday).toMatchObject({
      isWorkingDay: false,
      nonWorkingReason: "National holiday",
      calendarKind: "PUBLIC_HOLIDAY",
      calendarSource: "AGENT_OVERRIDE",
      routePlanningAllowed: false,
    })
    expect(tuesday.routes[0]).toMatchObject({
      persistedStatus: "PLANNED",
      effectiveStatus: "PLANNED",
    })
  })

  it("groups task and visit activity by the organization timezone", async () => {
    vi.mocked(prisma.mtmTask.findMany).mockResolvedValue([{
      id: "task-1",
      title: "Confirm stock",
      description: null,
      status: "COMPLETED",
      priority: "HIGH",
      dueDate: new Date("2026-07-14T21:00:00.000Z"),
      completedAt: new Date("2026-07-15T07:00:00.000Z"),
      customer: null,
    }] as any)
    vi.mocked(prisma.mtmVisit.findMany).mockResolvedValue([{
      id: "visit-1",
      customerId: "customer-1",
      status: "CHECKED_OUT",
      checkInAt: new Date("2026-07-14T21:30:00.000Z"),
      checkOutAt: new Date("2026-07-14T22:00:00.000Z"),
      outcome: "SUCCESSFUL",
      customer: { id: "customer-1", name: "Night pharmacy", objectType: "PHARMACY" },
    }] as any)

    const response = await GET(makeReq("?start=2026-07-15"))
    const json = await response.json()
    const wednesday = json.data.days[2]
    expect(wednesday.date).toBe("2026-07-15")
    expect(wednesday.tasks).toMatchObject({ total: 1, completed: 1 })
    expect(wednesday.visits).toMatchObject({ total: 1, completed: 1 })
    expect(json.data.summary).toMatchObject({
      tasks: 1,
      tasksCompleted: 1,
      visits: 1,
      visitsCompleted: 1,
    })
  })

  it("hands the field app no coordinates instead of Null Island for a pre-migration stop", async () => {
    // A customer row written before 20260905160000 can still carry (0, 0).
    // Passed through, the app draws the stop in the Gulf of Guinea and tells
    // the agent it is 6745 km away (field UX audit A1).
    vi.mocked(prisma.mtmRoute.findMany).mockResolvedValue([{
      id: "route-legacy",
      name: "Tuesday",
      date: new Date("2026-07-14T00:00:00.000Z"),
      status: "PUBLISHED",
      version: 1,
      agentId: AGENT_ID,
      totalPoints: 1,
      visitedPoints: 0,
      startedAt: null,
      completedAt: null,
      notes: null,
      assignments: [],
      points: [
        {
          id: "point-legacy", customerId: "customer-legacy", orderIndex: 0, status: "PENDING",
          plannedTime: null, visitedAt: null, notes: null,
          customer: {
            id: "customer-legacy", name: "Clinic Zero", code: "C-0", objectType: "CLINIC",
            category: "A", address: "Baku", city: "Baku", phone: null, latitude: 0, longitude: 0,
          },
        },
      ],
    }] as any)

    const json = await (await GET(makeReq("?start=2026-07-13"))).json()
    const stop = json.data.days[1].routes[0].points[0]
    expect(stop.customer).toMatchObject({ id: "customer-legacy", latitude: null, longitude: null })
  })

  it("returns a sanitized 500 response when week loading fails", async () => {
    vi.mocked(prisma.mtmRoute.findMany).mockRejectedValue(new Error("db down"))
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    const response = await GET(makeReq())
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: "Failed to load mobile week" })
    errorSpy.mockRestore()
  })
})
