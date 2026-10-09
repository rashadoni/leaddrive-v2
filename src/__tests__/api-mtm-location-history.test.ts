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
    expect(body.data.policy.distanceFormula).toBe("haversine-driving-v2")
    expect(writeMtmAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: "GPS_HISTORY_VIEW",
      entityId: "agent-1",
      metadataKind: "gps_history_access",
    }))
  })

  it("reports a workday opened on an earlier day that still covers the selected date (audit 2026-09-14)", async () => {
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({
      id: "agent-1", name: "Aysel", role: "AGENT", team: null,
    } as never)
    vi.mocked(prisma.mtmAgentLocation.findMany).mockResolvedValue([] as never)
    vi.mocked(prisma.mtmVisit.findMany).mockResolvedValue([] as never)
    vi.mocked(prisma.mtmRoute.findMany).mockResolvedValue([] as never)
    const carried = {
      id: "workday-prev",
      status: "STARTED",
      workDate: new Date("2026-09-11T00:00:00.000Z"),
      startedAt: new Date("2026-09-11T16:57:00.000Z"),
      completedAt: null,
    }
    // First lookup: no row dated on the selected day; second: the carried-over one.
    vi.mocked(prisma.mtmAgentWorkday.findFirst)
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce(carried as never)

    const response = await GET(request("?agentId=agent-1&date=2026-09-12"))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data.workday).toBeNull()
    expect(body.data.carriedOverWorkday).toMatchObject({ id: "workday-prev", status: "STARTED", completedAt: null })
    // The evidence pack stays tied to the selected date's own row.
    expect(body.data.evidencePack.workdayId).toBeNull()
    const lookup = vi.mocked(prisma.mtmAgentWorkday.findFirst).mock.calls[1]?.[0] as unknown as { where: Record<string, unknown> & { startedAt: { lte: unknown } }; orderBy: unknown }
    expect(lookup.where).toMatchObject({
      organizationId: ORG,
      agentId: "agent-1",
      workDate: { lt: new Date("2026-09-12T00:00:00.000Z") },
      OR: [{ completedAt: null }, { completedAt: { gte: expect.any(Date) } }],
    })
    expect(lookup.where.startedAt.lte).toBeInstanceOf(Date)
    expect(lookup.orderBy).toEqual([{ startedAt: "desc" }, { id: "desc" }])
  })

  it("does not report a carried-over workday that closed before the selected window", async () => {
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({
      id: "agent-1", name: "Aysel", role: "AGENT", team: null,
    } as never)
    vi.mocked(prisma.mtmAgentLocation.findMany).mockResolvedValue([] as never)
    vi.mocked(prisma.mtmVisit.findMany).mockResolvedValue([] as never)
    vi.mocked(prisma.mtmRoute.findMany).mockResolvedValue([] as never)
    // Started 11 Sep 20:57 Baku, closed 12 Sep 02:00 Baku; the window opens 12 Sep 07:00 Baku.
    vi.mocked(prisma.mtmAgentWorkday.findFirst)
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce({
        id: "workday-prev",
        status: "COMPLETED",
        workDate: new Date("2026-09-11T00:00:00.000Z"),
        startedAt: new Date("2026-09-11T16:57:00.000Z"),
        completedAt: new Date("2026-09-11T22:00:00.000Z"),
      } as never)

    const body = await (await GET(request("?agentId=agent-1&date=2026-09-12&from=07%3A00&to=19%3A00&timezone=Asia%2FBaku"))).json()
    expect(body.data.workday).toBeNull()
    expect(body.data.carriedOverWorkday).toBeNull()
    const lookup = vi.mocked(prisma.mtmAgentWorkday.findFirst).mock.calls[1]?.[0] as unknown as { where: { OR: Array<{ completedAt: unknown }> } }
    expect(lookup.where.OR).toEqual([{ completedAt: null }, { completedAt: { gte: new Date("2026-09-12T03:00:00.000Z") } }])
  })

  it("does not look for a carried-over workday when the selected date has its own", async () => {
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({
      id: "agent-1", name: "Aysel", role: "AGENT", team: null,
    } as never)
    vi.mocked(prisma.mtmAgentLocation.findMany).mockResolvedValue([] as never)
    vi.mocked(prisma.mtmVisit.findMany).mockResolvedValue([] as never)
    vi.mocked(prisma.mtmRoute.findMany).mockResolvedValue([] as never)
    vi.mocked(prisma.mtmAgentWorkday.findFirst).mockResolvedValue({
      id: "workday-1", status: "STARTED", startedAt: new Date("2026-09-12T05:00:00.000Z"),
      pausedAt: null, completedAt: null, totalPausedSeconds: 0,
      startLatitude: null, startLongitude: null, endLatitude: null, endLongitude: null,
    } as never)

    const body = await (await GET(request("?agentId=agent-1&date=2026-09-12"))).json()
    expect(body.data.workday.id).toBe("workday-1")
    expect(body.data.carriedOverWorkday).toBeNull()
    expect(prisma.mtmAgentWorkday.findFirst).toHaveBeenCalledTimes(1)
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

  // Owner 2026-09-22: «where was he these days and his path».
  it("shows a range of days: points, routes and each day's shift across the window", async () => {
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ id: "agent-1", name: "Anar", role: "AGENT", team: null } as never)
    vi.mocked(prisma.mtmAgentLocation.findMany).mockResolvedValue([] as never)
    vi.mocked(prisma.mtmVisit.findMany).mockResolvedValue([] as never)
    vi.mocked(prisma.mtmRoute.findMany).mockResolvedValue([] as never)
    vi.mocked(prisma.mtmAgentWorkday.findFirst).mockClear()
    vi.mocked(prisma.mtmAgentWorkday.findMany).mockResolvedValue([
      { id: "wd-20", status: "COMPLETED", workDate: new Date("2026-09-20T00:00:00.000Z"), startedAt: new Date("2026-09-20T05:00:00.000Z"), completedAt: new Date("2026-09-20T14:00:00.000Z") },
    ] as never)

    const response = await GET(request("?agentId=agent-1&date=2026-09-20&toDate=2026-09-22&from=00%3A00&to=23%3A59"))
    expect(response.status).toBe(200)
    const body = await response.json()

    expect(body.data.range).toMatchObject({ date: "2026-09-20", toDate: "2026-09-22", days: 3 })
    // 00:00 on the 20th to 23:59:59 on the 22nd, Baku time.
    expect(body.data.range.from).toBe("2026-09-19T20:00:00.000Z")
    expect(body.data.range.to).toBe("2026-09-22T19:59:59.999Z")
    expect(prisma.mtmAgentLocation.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ recordedAt: { gte: new Date("2026-09-19T20:00:00.000Z"), lte: new Date("2026-09-22T19:59:59.999Z") } }),
    }))
    expect(prisma.mtmRoute.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ date: { gte: new Date("2026-09-20T00:00:00.000Z"), lte: new Date("2026-09-22T00:00:00.000Z") } }),
    }))
    expect(body.data.workday).toBeNull()
    expect(body.data.workdays).toEqual([expect.objectContaining({ id: "wd-20", workDate: "2026-09-20" })])
  })

  it("refuses a range longer than two weeks or ending before it starts", async () => {
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ id: "agent-1", name: "Anar", role: "AGENT", team: null } as never)
    expect((await GET(request("?agentId=agent-1&date=2026-09-01&toDate=2026-09-15"))).status).toBe(400)
    expect((await GET(request("?agentId=agent-1&date=2026-09-10&toDate=2026-09-09"))).status).toBe(400)
    expect((await GET(request("?agentId=agent-1&date=2026-09-01&toDate=2026-09-14"))).status).toBe(200)
  })

  // Found 2026-10-09 beside the live map's «День в цифрах»: the two screens
  // told the same day differently, and History was the wrong one. The day's
  // trip starts at its earliest anchor, and a visit begun on an earlier day
  // was handed to it as one.
  describe("the day's trip and a visit begun before the day", () => {
    const utc = (clock: string, day = "2026-10-09") => new Date(`${day}T${clock}.000Z`)
    // 08:00–08:50 Baku: fifty minutes on the road, a fix every thirty seconds.
    const DRIVE_SECONDS = 50 * 60
    const drive = Array.from({ length: 101 }, (_, index) => ({
      id: `loc-${String(index).padStart(3, "0")}`,
      latitude: 40.38 + 0.12 * index / 100,
      longitude: 49.83 + 0.17 * index / 100,
      accuracy: 8, speed: null, heading: null, battery: 80, isMoving: true,
      recordedAt: new Date(utc("04:00:00").getTime() + index * 30_000),
      workdayId: null,
    }))
    // Where the drive ended he went in for twenty minutes; the phone said nothing.
    const atTheDoor = {
      id: "at-the-door", customerId: "customer-1", status: "CHECKED_OUT",
      checkInAt: utc("04:50:00"), checkOutAt: utc("05:10:00"), checkInLat: 40.5, checkInLng: 50,
      customer: { name: "Pharmacy on the corner", address: null, latitude: 40.5, longitude: 50 },
    }
    // Three days earlier, 10:30 Baku, on the other side of town.
    const begunEarlier = {
      id: "begun-earlier", customerId: "customer-9", status: "CHECKED_IN",
      checkInAt: utc("06:30:00", "2026-10-06"), checkOutAt: null as Date | null, checkInLat: 40.39, checkInLng: 49.85,
      customer: { name: "Clinic 9", address: null, latitude: 40.39, longitude: 49.85 },
    }

    type DateBound = { gte?: Date; gt?: Date; lte?: Date; lt?: Date } | null
    type VisitWhere = { checkInAt?: DateBound; checkOutAt?: DateBound; OR?: VisitWhere[] }
    const within = (value: Date | null, bound: DateBound | undefined): boolean => {
      if (bound === undefined) return true
      if (bound === null || value === null) return bound === null && value === null
      return (bound.gte == null || value >= bound.gte) && (bound.gt == null || value > bound.gt)
        && (bound.lte == null || value <= bound.lte) && (bound.lt == null || value < bound.lt)
    }
    const visitMatches = (row: typeof begunEarlier, where: VisitWhere): boolean =>
      within(row.checkInAt, where.checkInAt) && within(row.checkOutAt, where.checkOutAt)
      && (!where.OR || where.OR.some((alternative) => visitMatches(row, alternative)))

    /** The day as History tells it, the visits table answering the route's own question. */
    async function read(visits: Array<typeof begunEarlier>) {
      vi.mocked(prisma.mtmVisit.findMany).mockImplementation((async (args: { where: VisitWhere }) =>
        visits.filter((row) => visitMatches(row, args.where))) as never)
      const response = await GET(request("?agentId=agent-1&date=2026-10-09"))
      expect(response.status).toBe(200)
      return (await response.json()).data
    }

    beforeEach(() => {
      vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ id: "agent-1", name: "Agent One", role: "AGENT", team: null } as never)
      vi.mocked(prisma.mtmAgentLocation.findMany).mockResolvedValue(drive as never)
      vi.mocked(prisma.mtmAgentWorkday.findFirst).mockResolvedValue(null as never)
      vi.mocked(prisma.mtmRoute.findMany).mockResolvedValue([] as never)
    })

    it("a visit forgotten open three days earlier does not turn fifty minutes on the road into seventy hours", async () => {
      const plain = await read([atTheDoor])
      expect(plain.trip.summary).toMatchObject({ movingSeconds: DRIVE_SECONDS, staySeconds: 20 * 60, visitCount: 1 })

      const day = await read([begunEarlier, atTheDoor])
      // Was 253 200 — «В пути 70 ч 20 мин»: from the forgotten check-in to the end of today's drive.
      expect(day.trip.summary.movingSeconds).toBe(DRIVE_SECONDS)
      expect(day.trip).toEqual(plain.trip)
      // The visit itself is still the day's to show: it is open, and somebody has to close it.
      expect(day.visits.map((visit: { id: string }) => visit.id)).toEqual(["begun-earlier", "at-the-door"])
      expect(day.visits[0]).toMatchObject({ checkInAt: "2026-10-06T06:30:00.000Z", checkOutAt: null })
      expect(day.summary.visitCount).toBe(2)
      expect(day.evidencePack.visitIds).toEqual(["begun-earlier", "at-the-door"])
      expect(day.timeline.map((event: { id: string }) => event.id)).toContain("visit-begun-earlier")
    })

    it("nor does one closed only this morning become three days of standing", async () => {
      const plain = await read([atTheDoor])
      // Closed at 07:30 Baku, half an hour before he set off.
      const day = await read([{ ...begunEarlier, status: "CHECKED_OUT", checkOutAt: utc("03:30:00") }, atTheDoor])

      expect(day.trip.summary).toMatchObject({ movingSeconds: DRIVE_SECONDS, staySeconds: 20 * 60, visitCount: 1 })
      expect(day.trip).toEqual(plain.trip)
      expect(day.visits[0]).toMatchObject({ id: "begun-earlier", checkOutAt: "2026-10-09T03:30:00.000Z" })
    })

    it("a visit that ended before the day is not the day's at all", async () => {
      const day = await read([{ ...begunEarlier, status: "CHECKED_OUT", checkOutAt: utc("07:00:00", "2026-10-06") }, atTheDoor])
      expect(day.visits.map((visit: { id: string }) => visit.id)).toEqual(["at-the-door"])
    })
  })
})
