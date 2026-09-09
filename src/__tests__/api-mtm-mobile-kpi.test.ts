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

import { GET } from "@/app/api/v1/mtm/mobile/kpi/route"
import { resolveMobileAuth } from "@/lib/mobile-auth"
import { prisma } from "@/lib/prisma"

const ORG = "org-1"
const AGENT = "agent-1"
const AUTH = {
  orgId: ORG,
  agentId: AGENT,
  userId: "user-1",
  email: "agent@example.com",
  name: "Agent One",
  role: "AGENT",
  tenantCapabilities: { routeField: true, workforceHrm: true },
}

function request(query = "") {
  return new NextRequest(`http://localhost/api/v1/mtm/mobile/kpi${query}`, {
    headers: {
      Authorization: "Bearer valid-token",
    },
  })
}

describe("GET /api/v1/mtm/mobile/kpi", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-07-15T08:00:00.000Z"))
    vi.clearAllMocks()
    vi.mocked(resolveMobileAuth).mockResolvedValue(AUTH as any)
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ id: AGENT } as any)
    vi.mocked(prisma.mtmSetting.findMany).mockResolvedValue([])
    vi.mocked(prisma.mtmRoute.findMany).mockResolvedValue([])
    vi.mocked(prisma.mtmRoutePoint.findMany).mockResolvedValue([])
    vi.mocked(prisma.mtmVisit.findMany).mockResolvedValue([])
    vi.mocked(prisma.mtmTask.findMany).mockResolvedValue([])
    vi.mocked(prisma.mtmAgentWorkday.findMany).mockResolvedValue([])
    vi.mocked(prisma.mtmAgentLocation.findMany).mockResolvedValue([])
    vi.mocked(prisma.mtmAgentLocation.count).mockResolvedValue(0 as any)
    vi.mocked(prisma.mtmAuditLog.findMany).mockResolvedValue([] as any)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("requires mobile authentication", async () => {
    vi.mocked(resolveMobileAuth).mockResolvedValue(null as any)
    expect((await GET(request())).status).toBe(401)
  })

  it("validates period and anchor before querying KPI rows", async () => {
    expect((await GET(request("?period=quarter"))).status).toBe(400)
    expect((await GET(request("?period=week&anchor=2026-02-29"))).status).toBe(400)
    expect(prisma.mtmRoute.findMany).not.toHaveBeenCalled()
  })

  it("keeps Routes-only KPI available without reading Workforce workdays", async () => {
    vi.mocked(resolveMobileAuth).mockResolvedValue({
      ...AUTH,
      tenantCapabilities: { routeField: true, workforceHrm: false },
    } as any)

    const response = await GET(request("?period=day&anchor=2026-07-15"))
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.data.contract.workforceEnabled).toBe(false)
    expect(prisma.mtmAgentWorkday.findMany).not.toHaveBeenCalled()
  })

  it("narrows every fact query to the anchored local day and forwards the day period", async () => {
    const response = await GET(request("?period=day&anchor=2026-07-15"))
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.data.period).toMatchObject({
      kind: "day",
      anchor: "2026-07-15",
      start: "2026-07-15",
      endExclusive: "2026-07-16",
      from: "2026-07-14T20:00:00.000Z",
      to: "2026-07-15T20:00:00.000Z",
    })
    expect(prisma.mtmRoute.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        date: { gte: new Date("2026-07-15T00:00:00.000Z"), lt: new Date("2026-07-16T00:00:00.000Z") },
      }),
    }))
    expect(prisma.mtmVisit.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        checkInAt: { gte: new Date("2026-07-14T20:00:00.000Z"), lt: new Date("2026-07-15T20:00:00.000Z") },
      }),
    }))
    expect(prisma.mtmAgentLocation.count).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        recordedAt: { gte: new Date("2026-07-14T20:00:00.000Z"), lt: new Date("2026-07-15T20:00:00.000Z") },
      }),
    }))
  })

  it("does not count a stop still pending on the anchored day as missed", async () => {
    vi.mocked(prisma.mtmRoute.findMany).mockResolvedValue([{
      id: "route-1",
      agentId: AGENT,
      date: new Date("2026-07-15T00:00:00.000Z"),
      status: "PLANNED",
      assignments: [],
    }] as any)
    vi.mocked(prisma.mtmRoutePoint.findMany).mockResolvedValue([{
      id: "point-1",
      routeId: "route-1",
      customerId: "pharmacy-1",
      contactId: null,
      status: "PENDING",
      customer: { name: "Aptek 1", objectType: "PHARMACY" },
    }] as any)

    const json = await (await GET(request("?period=day&anchor=2026-07-15"))).json()

    // The day is still running, so an unvisited stop is outstanding work rather
    // than a miss — the dashboard must not accuse the agent mid-shift.
    expect(json.data.visits).toMatchObject({
      planned: 1,
      completedPlanned: 0,
      missed: 0,
      fulfillment: { numerator: 0, denominator: 1, percentage: 0 },
    })
    expect(json.data.drilldown.missedStopIds).toEqual([])
  })

  it("uses tenant, agent and local-time boundaries", async () => {
    vi.mocked(prisma.mtmRoute.findMany).mockResolvedValue([{
      id: "route-1",
      agentId: AGENT,
      date: new Date("2026-07-14T00:00:00.000Z"),
      status: "PLANNED",
      assignments: [],
    }] as any)
    vi.mocked(prisma.mtmRoutePoint.findMany).mockResolvedValue([{
      id: "point-1",
      routeId: "route-1",
      customerId: "pharmacy-1",
      contactId: null,
      status: "VISITED",
      customer: { name: "Aptek 1", objectType: "PHARMACY" },
    }] as any)
    vi.mocked(prisma.mtmVisit.findMany).mockResolvedValue([{
      id: "visit-1",
      agentId: AGENT,
      customerId: "pharmacy-1",
      contactId: null,
      routePointId: "point-1",
      status: "CHECKED_OUT",
      checkInAt: new Date("2026-07-14T08:00:00.000Z"),
      checkInLat: 40.4,
      checkInLng: 49.8,
      checkOutLat: 40.4,
      checkOutLng: 49.8,
      customer: { name: "Aptek 1", objectType: "PHARMACY" },
      participants: [],
    }] as any)
    vi.mocked(prisma.mtmTask.findMany).mockResolvedValue([{
      id: "task-1",
      status: "COMPLETED",
      dueDate: new Date("2026-07-14T08:00:00.000Z"),
      completedAt: new Date("2026-07-14T09:00:00.000Z"),
    }] as any)
    vi.mocked(prisma.mtmAgentLocation.count).mockResolvedValue(2 as any)
    const response = await GET(request("?period=week&anchor=2026-07-15"))
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.data).toMatchObject({
      protocolVersion: 2,
      source: "LEADDRIVE",
      timezone: "Asia/Baku",
      period: {
        kind: "week",
        start: "2026-07-13",
        endExclusive: "2026-07-20",
        from: "2026-07-12T20:00:00.000Z",
        to: "2026-07-19T20:00:00.000Z",
      },
      visits: {
        planned: 1,
        completedPlanned: 1,
        fulfillment: { numerator: 1, denominator: 1, percentage: 100 },
      },
      gps: {
        visitConfirmation: { numerator: 1, denominator: 1, percentage: 100 },
      },
      coverage: {
        pharmacies: { numerator: 1, denominator: 1, percentage: 100 },
      },
      tasks: {
        assigned: 1,
        completed: 1,
        completion: { numerator: 1, denominator: 1, percentage: 100 },
      },
    })
    expect(prisma.mtmRoute.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        organizationId: ORG,
        date: { gte: new Date("2026-07-13T00:00:00.000Z"), lt: new Date("2026-07-20T00:00:00.000Z") },
      }),
      take: 401,
    }))
    const routeQuery = vi.mocked(prisma.mtmRoute.findMany).mock.calls[0][0] as any
    expect(routeQuery.select.assignments).toEqual({
      where: { agentId: AGENT, role: { not: "OBSERVER" } },
      orderBy: { assignedAt: "asc" },
      select: { assignedAt: true, removedAt: true },
    })
    expect(prisma.mtmRoutePoint.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { routeId: { in: ["route-1"] }, deletedAt: null },
      take: 10_001,
    }))
    const visitQuery = vi.mocked(prisma.mtmVisit.findMany).mock.calls[0][0] as any
    expect(visitQuery.select.participants).toEqual({
      where: { agentId: AGENT, role: { not: "OBSERVER" } },
      orderBy: { joinedAt: "asc" },
      select: { joinedAt: true, leftAt: true },
    })
    expect(prisma.mtmTask.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 10_001 }))
    expect(prisma.mtmAgentWorkday.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 10_001 }))
    expect(prisma.mtmAgentLocation.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 50_001 }))
    expect(prisma.mtmAuditLog.findMany).toHaveBeenCalledWith(expect.objectContaining({
      take: 10_001,
      select: { id: true, action: true, entityId: true, newData: true, createdAt: true },
    }))
    expect(prisma.mtmVisit.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        organizationId: ORG,
        OR: [
          { agentId: AGENT },
          {
            participants: {
              some: {
                agentId: AGENT,
                role: { not: "OBSERVER" },
              },
            },
          },
        ],
        checkInAt: { gte: new Date("2026-07-12T20:00:00.000Z"), lt: new Date("2026-07-19T20:00:00.000Z") },
      }),
      take: 10_001,
    }))
  })

  it("evaluates historical route assignments against the Asia/Baku local-day boundaries", async () => {
    vi.mocked(prisma.mtmSetting.findMany).mockResolvedValue([
      { key: "timezone", value: "Asia/Baku" },
    ] as any)
    const route = (
      id: string,
      assignment: { assignedAt: Date; removedAt: Date | null },
    ) => ({
      id,
      agentId: "agent-primary",
      date: new Date("2026-07-14T00:00:00.000Z"),
      status: "PLANNED",
      assignments: [assignment],
    })
    vi.mocked(prisma.mtmRoute.findMany).mockResolvedValue([
      route("route-assigned-inside", {
        assignedAt: new Date("2026-07-13T21:00:00.000Z"),
        removedAt: null,
      }),
      route("route-removed-at-day-start", {
        assignedAt: new Date("2026-07-01T00:00:00.000Z"),
        removedAt: new Date("2026-07-13T20:00:00.000Z"),
      }),
      route("route-removed-before-day", {
        assignedAt: new Date("2026-07-01T00:00:00.000Z"),
        removedAt: new Date("2026-07-13T19:59:00.000Z"),
      }),
      route("route-assigned-at-next-day", {
        assignedAt: new Date("2026-07-14T20:00:00.000Z"),
        removedAt: null,
      }),
    ] as any)
    vi.mocked(prisma.mtmRoutePoint.findMany).mockResolvedValue([
      {
        id: "point-assigned-inside",
        routeId: "route-assigned-inside",
        customerId: "clinic-1",
        contactId: null,
        status: "VISITED",
        customer: { name: "Clinic 1", objectType: "CLINIC" },
      },
      {
        id: "point-removed-at-day-start",
        routeId: "route-removed-at-day-start",
        customerId: "clinic-2",
        contactId: null,
        status: "VISITED",
        customer: { name: "Clinic 2", objectType: "CLINIC" },
      },
      {
        id: "point-removed-before-day",
        routeId: "route-removed-before-day",
        customerId: "clinic-3",
        contactId: null,
        status: "VISITED",
        customer: { name: "Clinic 3", objectType: "CLINIC" },
      },
      {
        id: "point-assigned-at-next-day",
        routeId: "route-assigned-at-next-day",
        customerId: "clinic-4",
        contactId: null,
        status: "VISITED",
        customer: { name: "Clinic 4", objectType: "CLINIC" },
      },
    ] as any)

    const response = await GET(request("?period=week&anchor=2026-07-15"))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data.timezone).toBe("Asia/Baku")
    expect(prisma.mtmRoutePoint.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        routeId: {
          in: ["route-assigned-inside", "route-removed-at-day-start"],
        },
        deletedAt: null,
      },
    }))
    expect(body.data.visits).toMatchObject({
      planned: 2,
      completedPlanned: 2,
    })
    expect(body.data.drilldown.missedStopIds).toEqual([])
  })

  it("counts historical joint facts and mirrors an audited GPS exclusion without shrinking the denominator", async () => {
    vi.mocked(prisma.mtmRoute.findMany).mockResolvedValue([{
      id: "route-joint",
      agentId: "agent-primary",
      date: new Date("2026-07-14T00:00:00.000Z"),
      status: "PLANNED",
      assignments: [{
        assignedAt: new Date("2026-07-01T00:00:00.000Z"),
        removedAt: new Date("2026-07-15T00:00:00.000Z"),
      }],
    }] as any)
    vi.mocked(prisma.mtmRoutePoint.findMany).mockResolvedValue([{
      id: "point-joint",
      routeId: "route-joint",
      customerId: "clinic-1",
      contactId: "doctor-1",
      status: "VISITED",
      customer: { name: "Joint Clinic", objectType: "CLINIC" },
    }] as any)
    vi.mocked(prisma.mtmVisit.findMany).mockResolvedValue([{
      id: "visit-joint",
      agentId: "agent-primary",
      customerId: "clinic-1",
      contactId: "doctor-1",
      routePointId: "point-joint",
      status: "CHECKED_OUT",
      checkInAt: new Date("2026-07-14T08:00:00.000Z"),
      checkInLat: 40.4,
      checkInLng: 49.8,
      checkOutLat: 40.4,
      checkOutLng: 49.8,
      customer: { name: "Joint Clinic", objectType: "CLINIC" },
      participants: [{
        joinedAt: new Date("2026-07-01T00:00:00.000Z"),
        leftAt: new Date("2026-07-14T09:00:00.000Z"),
      }],
    }] as any)
    vi.mocked(prisma.mtmAuditLog.findMany).mockResolvedValue([
      {
        id: "audit-exclude",
        action: "KPI_FACT_EXCLUDED",
        entityId: "visit-joint",
        newData: {
          factType: "GPS_VISIT",
          reason: "GPS evidence failed manual verification",
          formulaVersion: "SWM_PLAN_GPS_V1",
        },
        createdAt: new Date("2026-07-15T07:00:00.000Z"),
      },
      {
        id: "audit-restore",
        action: "KPI_FACT_RESTORED",
        entityId: "visit-joint",
        newData: {
          factType: "GPS_VISIT",
          reason: "Earlier restoration decision",
          formulaVersion: "SWM_PLAN_GPS_V1",
        },
        createdAt: new Date("2026-07-14T07:00:00.000Z"),
      },
    ] as any)

    const response = await GET(request("?period=week&anchor=2026-07-15"))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(prisma.mtmRoute.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        organizationId: ORG,
        OR: [
          { agentId: AGENT },
          {
            assignments: {
              some: {
                agentId: AGENT,
                role: { not: "OBSERVER" },
              },
            },
          },
        ],
      }),
    }))
    expect(prisma.mtmVisit.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        organizationId: ORG,
        OR: [
          { agentId: AGENT },
          {
            participants: {
              some: {
                agentId: AGENT,
                role: { not: "OBSERVER" },
              },
            },
          },
        ],
      }),
    }))
    expect(prisma.mtmAuditLog.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        organizationId: ORG,
        entity: "kpi_fact",
        entityId: { in: ["point-joint", "visit-joint"] },
        action: { in: ["KPI_FACT_EXCLUDED", "KPI_FACT_RESTORED"] },
      },
      take: 10_001,
    }))
    expect(body.data.visits).toMatchObject({
      planned: 1,
      completedPlanned: 1,
      completedTotal: 1,
    })
    expect(body.data.gps.visitConfirmation).toEqual({
      numerator: 0,
      denominator: 1,
      percentage: 0,
    })
    expect(body.data.formula.adjustments).toEqual([
      {
        factType: "GPS_VISIT",
        factId: "visit-joint",
        action: "RESTORE",
        reason: "Earlier restoration decision",
        createdAt: "2026-07-14T07:00:00.000Z",
        auditId: "audit-restore",
      },
      {
        factType: "GPS_VISIT",
        factId: "visit-joint",
        action: "EXCLUDE",
        reason: "GPS evidence failed manual verification",
        createdAt: "2026-07-15T07:00:00.000Z",
        auditId: "audit-exclude",
      },
    ])
  })

  it("caps location loading and exposes a non-authoritative truncated GPS result", async () => {
    vi.mocked(prisma.mtmAgentLocation.findMany).mockResolvedValue([{
      latitude: 40.4,
      longitude: 49.8,
      accuracy: 12,
      recordedAt: new Date("2026-07-14T08:00:00.000Z"),
    }] as any)
    vi.mocked(prisma.mtmAgentLocation.count).mockResolvedValue(50_001 as any)

    const response = await GET(request("?period=week&anchor=2026-07-15"))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(prisma.mtmAgentLocation.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        organizationId: ORG,
        agentId: AGENT,
        recordedAt: {
          gte: new Date("2026-07-12T20:00:00.000Z"),
          lt: new Date("2026-07-19T20:00:00.000Z"),
        },
      },
      take: 50_001,
    }))
    expect(body.data.gps).toMatchObject({
      points: 50_001,
      distanceMeters: null,
      truncated: true,
      lastRecordedAt: "2026-07-14T08:00:00.000Z",
    })
    expect(body.data.formula).toMatchObject({
      completeness: "PARTIAL",
      authoritative: false,
    })
    expect(body.data.contract).toEqual({
      workforceEnabled: true,
      maxRoutes: 400,
      maxFactsPerCohort: 10_000,
      maxAdjustments: 10_000,
      maxLocations: 50_000,
      truncated: true,
      historicalAttribution: "primary ownership or non-observer assignment/participation active on the route date or visit timestamp",
      adjustmentSemantics: {
        PLAN_POINT: "plan formula only; coverage and missed-stop facts remain unchanged",
        GPS_VISIT: "GPS numerator evidence only; completed-visit denominator remains unchanged",
      },
    })
  })

})
