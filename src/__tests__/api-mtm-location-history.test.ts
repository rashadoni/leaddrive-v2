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

vi.mock("@/lib/mtm-audit", () => ({
  writeMtmAudit: vi.fn(() => Promise.resolve()),
}))

import { GET } from "@/app/api/v1/mtm/location-history/route"
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/lib/api-auth"
import { writeMtmAudit } from "@/lib/mtm-audit"

const ORG = "org-1"
const admin = {
  orgId: ORG,
  userId: "admin-user",
  role: "admin",
  email: "admin@example.com",
  name: "Admin",
}

function request(query = "") {
  return new NextRequest(`http://localhost:3000/api/v1/mtm/location-history${query}`)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireAuth).mockResolvedValue(admin as never)
  vi.mocked(writeMtmAudit).mockResolvedValue(undefined as never)
  vi.mocked(prisma.organization.findUnique).mockResolvedValue({
    plan: "pro",
    addons: [],
    features: ["mtm"],
    modules: { mtm: true },
  } as never)
  vi.mocked(prisma.organization.findUnique).mockResolvedValue({
    plan: "enterprise",
    addons: [],
    features: [],
    modules: { mtm: true },
  } as never)
})

describe("GET /api/v1/mtm/location-history", () => {
  it("returns a server-scoped roster and tenant policy", async () => {
    vi.mocked(prisma.mtmAgent.findMany).mockResolvedValue([
      { id: "agent-1", name: "Aysel", role: "AGENT", team: { id: "team-1", name: "Baku" } },
    ] as never)

    const response = await GET(request())
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      success: true,
      data: {
        agents: [{ id: "agent-1", name: "Aysel" }],
        timezone: "Asia/Baku",
        policy: {
          maxAccuracyMeters: 100,
          stopRadiusMeters: 50,
          stopMinimumMinutes: 5,
          autoTrackingSupported: false,
        },
      },
    })
  })

  it("returns quality-filtered history with workday, stops, gaps and confirmed visits", async () => {
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({
      id: "agent-1",
      name: "Aysel",
      role: "AGENT",
      team: { id: "team-1", name: "Baku" },
    } as never)
    vi.mocked(prisma.mtmAgentLocation.findMany).mockResolvedValue([
      {
        id: "loc-1", latitude: 40.4093, longitude: 49.8671, accuracy: 8,
        speed: 0, heading: null, battery: 80, isMoving: false,
        recordedAt: new Date("2026-07-15T04:00:00.000Z"), workdayId: "workday-1",
      },
      {
        id: "loc-2", latitude: 40.40931, longitude: 49.8671, accuracy: 9,
        speed: 0, heading: null, battery: 79, isMoving: false,
        recordedAt: new Date("2026-07-15T04:06:00.000Z"), workdayId: "workday-1",
      },
    ] as never)
    vi.mocked(prisma.mtmAgentWorkday.findFirst).mockResolvedValue({
      id: "workday-1",
      status: "COMPLETED",
      startedAt: new Date("2026-07-15T04:00:00.000Z"),
      pausedAt: null,
      completedAt: new Date("2026-07-15T14:00:00.000Z"),
      totalPausedSeconds: 0,
      startLatitude: 40.4093,
      startLongitude: 49.8671,
      endLatitude: 40.40931,
      endLongitude: 49.8671,
    } as never)
    vi.mocked(prisma.mtmVisit.findMany).mockResolvedValue([{
      id: "visit-1",
      customerId: "customer-1",
      status: "CHECKED_OUT",
      checkInAt: new Date("2026-07-15T04:01:00.000Z"),
      checkOutAt: new Date("2026-07-15T04:05:00.000Z"),
      checkInLat: 40.4093,
      checkInLng: 49.8671,
      customer: {
        name: "Clinic 14",
        address: "Baku",
        latitude: 40.4093,
        longitude: 49.8671,
      },
    }] as never)
    vi.mocked(prisma.mtmRoute.findMany).mockResolvedValue([{
      id: "route-1",
      name: "Baku day route",
      status: "PUBLISHED",
      version: 3,
      publishedVersion: 3,
      publishedAt: new Date("2026-07-14T12:00:00.000Z"),
      startedAt: new Date("2026-07-15T04:00:00.000Z"),
      completedAt: new Date("2026-07-15T14:00:00.000Z"),
      points: [{
        id: "route-point-1",
        orderIndex: 0,
        status: "VISITED",
        plannedTime: new Date("2026-07-15T05:00:00.000Z"),
        visitedAt: new Date("2026-07-15T05:04:00.000Z"),
        customerId: "customer-1",
        contactId: null,
        customer: {
          name: "Clinic 14",
          address: "Baku",
          latitude: 40.4093,
          longitude: 49.8671,
        },
        contact: null,
      }],
    }] as never)

    const response = await GET(request("?agentId=agent-1&date=2026-07-15&from=07%3A00&to=19%3A00&timezone=Asia%2FBaku"))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.data.summary).toMatchObject({ stopCount: 1, visitCount: 1, gapCount: 1 })
    expect(body.data.stops[0]).toMatchObject({ batteryStart: 80, batteryEnd: 79 })
    expect(body.data.stops[0].visit).toMatchObject({ id: "visit-1", confirmed: true })
    expect(body.data.evidencePack).toMatchObject({
      id: "workday-1",
      workdayId: "workday-1",
      routeIds: ["route-1"],
      locationWorkdayIds: ["workday-1"],
      visitIds: ["visit-1"],
    })
    expect(body.data.plannedRoutes[0].points[0]).toMatchObject({
      id: "route-point-1",
      label: "Clinic 14",
    })
    expect(body.data.timeline.map((event: { kind: string }) => event.kind)).toContain("PLANNED_STOP")
    expect(body.data.policy.distanceFormula).toBe("haversine-r6371000-filtered-v1")
    expect(writeMtmAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: "GPS_HISTORY_VIEW",
      entityId: "agent-1",
      metadataKind: "gps_history_access",
    }))
  })

  it("does not query or expose Workforce workday evidence for a Routes-only tenant", async () => {
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({
      plan: "pro",
      addons: [],
      features: ["mtm"],
      modules: { mtm: true, "workforce-hrm": false },
    } as never)
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({
      id: "agent-1", name: "Aysel", role: "AGENT", team: null,
    } as never)
    vi.mocked(prisma.mtmAgentLocation.findMany).mockResolvedValue([{
      id: "loc-1", latitude: 40.4093, longitude: 49.8671, accuracy: 8,
      speed: 0, heading: null, battery: 80, isMoving: false,
      recordedAt: new Date("2026-07-15T04:00:00.000Z"),
    }] as never)
    vi.mocked(prisma.mtmVisit.findMany).mockResolvedValue([] as never)
    vi.mocked(prisma.mtmRoute.findMany).mockResolvedValue([] as never)

    const response = await GET(request("?agentId=agent-1&date=2026-07-15"))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data.capabilities).toEqual({ workforce: false })
    expect(body.data.workday).toBeNull()
    expect(body.data.evidencePack).toMatchObject({
      id: "day:agent-1:2026-07-15",
      workdayId: null,
      locationWorkdayIds: [],
    })
    expect(prisma.mtmAgentWorkday.findFirst).not.toHaveBeenCalled()
    const locationQuery = vi.mocked(prisma.mtmAgentLocation.findMany).mock.calls[0]?.[0] as any
    expect(locationQuery.select.workdayId).toBeUndefined()
  })

  it("redacts Workforce facts while preserving route history for a Routes-only tenant", async () => {
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({
      plan: "enterprise",
      addons: [],
      features: ["mtm"],
      modules: { mtm: true, "workforce-hrm": false },
    } as never)
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({
      id: "agent-1", name: "Aysel", role: "AGENT", team: null,
    } as never)
    vi.mocked(prisma.mtmAgentLocation.findMany).mockResolvedValue([{
      id: "loc-1", latitude: 40.4093, longitude: 49.8671, accuracy: 8,
      speed: 0, heading: null, battery: 80, isMoving: false,
      recordedAt: new Date("2026-07-15T04:00:00.000Z"),
    }] as never)
    vi.mocked(prisma.mtmVisit.findMany).mockResolvedValue([] as never)
    vi.mocked(prisma.mtmRoute.findMany).mockResolvedValue([] as never)

    const response = await GET(request("?agentId=agent-1&date=2026-07-15&from=07%3A00&to=19%3A00&timezone=Asia%2FBaku"))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data.capabilities.workforce).toBe(false)
    expect(body.data.workday).toBeNull()
    expect(body.data.points[0].workdayId).toBeNull()
    expect(body.data.evidencePack.locationWorkdayIds).toEqual([])
    expect(prisma.mtmAgentWorkday.findFirst).not.toHaveBeenCalled()
    const locationQuery = vi.mocked(prisma.mtmAgentLocation.findMany).mock.calls[0]?.[0] as any
    expect(locationQuery.select.workdayId).toBeUndefined()
  })

  it("rejects a target outside a manager's resolved scope before history queries", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ ...admin, role: "manager", userId: "manager-user" } as never)
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({
      id: "manager-agent",
      role: "MANAGER",
    } as never)
    vi.mocked(prisma.mtmAgent.findUnique).mockResolvedValue({
      id: "manager-agent",
      teamId: null,
    } as never)
    vi.mocked(prisma.mtmAgent.findMany).mockResolvedValue([] as never)

    const response = await GET(request("?agentId=agent-outside&date=2026-07-15"))
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ code: "MTM_GPS_AGENT_OUT_OF_SCOPE" })
    expect(prisma.mtmAgentLocation.findMany).not.toHaveBeenCalled()
  })

  it("rejects invalid or inverted local time ranges", async () => {
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({
      id: "agent-1", name: "Aysel", role: "AGENT", team: null,
    } as never)
    const response = await GET(request("?agentId=agent-1&date=2026-07-15&from=19%3A00&to=07%3A00"))
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ code: "MTM_GPS_INVALID_RANGE" })
  })

  it("keeps the tenant timezone authoritative so the historical day cannot drift", async () => {
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({
      id: "agent-1", name: "Aysel", role: "AGENT", team: null,
    } as never)
    const response = await GET(request("?agentId=agent-1&date=2026-07-15&timezone=UTC"))
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: "MTM_GPS_TIMEZONE_FIXED" })
    expect(prisma.mtmAgentLocation.findMany).not.toHaveBeenCalled()
  })

  it("exports the scoped evidence timeline as CSV and audits the export", async () => {
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({
      id: "agent-1", name: "Aysel", role: "AGENT", team: null,
    } as never)
    vi.mocked(prisma.mtmAgentLocation.findMany).mockResolvedValue([] as never)
    vi.mocked(prisma.mtmVisit.findMany).mockResolvedValue([] as never)
    vi.mocked(prisma.mtmRoute.findMany).mockResolvedValue([] as never)

    const response = await GET(request("?agentId=agent-1&date=2026-07-15&format=csv"))
    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toContain("text/csv")
    expect(response.headers.get("content-disposition")).toContain("mtm-day-2026-07-15.csv")
    expect(await response.text()).toContain("\"Agent\",\"Aysel\"")
    expect(writeMtmAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: "GPS_HISTORY_EXPORT",
      metadataKind: "gps_history_access",
    }))
  })
})
