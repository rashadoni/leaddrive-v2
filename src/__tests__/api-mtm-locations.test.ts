/**
 * Tests for /api/v1/mtm/locations — web fleet-overview + agent history + POST.
 *
 * Route file: src/app/api/v1/mtm/locations/route.ts
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
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

vi.mock("@/lib/mtm/route-permissions", () => ({
  resolveMtmRouteActor: vi.fn(),
  isAgentInRouteScope: (
    actor: { scopedAgentIds: readonly string[] | null },
    agentId: string,
  ) => actor.scopedAgentIds === null || actor.scopedAgentIds.includes(agentId),
}))

import { GET, POST } from "@/app/api/v1/mtm/locations/route"
import { prisma } from "@/lib/prisma"
import { getOrgId, getSession, requireAuth } from "@/lib/api-auth"
import { getMobileAuth, resolveMobileAuth } from "@/lib/mobile-auth"
import { resolveMtmRouteActor } from "@/lib/mtm/route-permissions"

const ORG = "org-1"

function makeReq(qs = ""): NextRequest {
  return new NextRequest(new URL(`http://localhost:3000/api/v1/mtm/locations${qs}`))
}

function makePostReq(body: unknown): NextRequest {
  return new NextRequest(new URL("http://localhost:3000/api/v1/mtm/locations"), {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getOrgId).mockResolvedValue(ORG)
  vi.mocked(getSession).mockResolvedValue({ orgId: ORG, userId: "user-admin", role: "admin" } as any)
  vi.mocked(getMobileAuth).mockReturnValue(null)
  vi.mocked(resolveMobileAuth).mockResolvedValue(null)
  vi.mocked(requireAuth).mockResolvedValue({
    orgId: ORG,
    userId: "user-admin",
    role: "admin",
    email: "admin@example.com",
    name: "Admin",
  })
  vi.mocked(resolveMtmRouteActor).mockResolvedValue({
    agentId: null,
    role: "ADMIN",
    scopedAgentIds: null,
  })
  // Existing MTM customers keep Workforce through the compatibility mapping
  // until provisioning writes an explicit `workforce-hrm: false` marker.
  vi.mocked(prisma.organization.findUnique).mockResolvedValue({
    plan: "pro",
    addons: [],
    features: ["mtm"],
    modules: { mtm: true },
  } as never)
  // getMtmSettings (mtmSetting.findMany) rides the factory default ([]) —
  // pure MTM_SETTING_DEFAULTS apply.
})

// ─── GET /api/v1/mtm/locations ───────────────────────────────────────────────

describe("GET /api/v1/mtm/locations", () => {
  it("returns 401 when not authenticated", async () => {
    vi.mocked(requireAuth).mockResolvedValue(new Response(null, { status: 401 }) as never)
    const res = await GET(makeReq())
    expect(res.status).toBe(401)
  })

  it("preserves module read denial before resolving any employee scope", async () => {
    vi.mocked(requireAuth).mockResolvedValue(new Response(null, { status: 403 }) as never)

    const res = await GET(makeReq())

    expect(res.status).toBe(403)
    expect(resolveMtmRouteActor).not.toHaveBeenCalled()
    expect(prisma.mtmAgent.findMany).not.toHaveBeenCalled()
  })

  it("agentId param switches to bounded tenant-day replay with admissible coordinates", async () => {
    const rows = [
      { id: "loc-2", agentId: "agent-1", latitude: 40.41, longitude: 49.87, recordedAt: new Date() },
      { id: "loc-1", agentId: "agent-1", latitude: 40.4, longitude: 49.86, recordedAt: new Date() },
    ]
    vi.mocked(prisma.mtmAgentLocation.findMany).mockResolvedValue(rows as any)

    const res = await GET(makeReq("?agentId=agent-1&date=2026-08-01"))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data.locations).toHaveLength(2)

    const args = vi.mocked(prisma.mtmAgentLocation.findMany).mock.calls[0][0] as any
    expect(args.where).toMatchObject({
      organizationId: ORG,
      agentId: "agent-1",
      recordedAt: { gte: expect.any(Date), lt: expect.any(Date) },
      latitude: { gte: -90, lte: 90 },
      longitude: { gte: -180, lte: 180 },
      OR: [{ accuracy: null }, { accuracy: { gte: 0, lte: 100 } }],
    })
    expect(args.take).toBe(200)
    expect(json.data.contract).toMatchObject({
      date: "2026-08-01",
      timezone: "Asia/Baku",
      maxPoints: 200,
      maxAccuracyMeters: 100,
    })
    // history mode must not run the fleet-overview queries
    expect(vi.mocked(prisma.mtmAgent.findMany)).not.toHaveBeenCalled()
  })

  it("rejects an invalid replay date before reading coordinate facts", async () => {
    const res = await GET(makeReq("?agentId=agent-1&date=2026-02-31"))

    expect(res.status).toBe(400)
    expect(prisma.mtmAgentLocation.findMany).not.toHaveBeenCalled()
  })

  it("negative scope: an employee outside the manager scope is absent", async () => {
    vi.mocked(getSession).mockResolvedValue({ orgId: ORG, userId: "manager-user", role: "user" } as any)
    vi.mocked(resolveMtmRouteActor).mockResolvedValue({
      agentId: "manager-1",
      role: "MANAGER",
      scopedAgentIds: ["manager-1", "agent-in-scope"],
    })
    vi.mocked(prisma.mtmRoute.findMany).mockResolvedValue([] as any)
    vi.mocked(prisma.mtmVisit.findMany).mockResolvedValue([] as any)
    vi.mocked(prisma.mtmAlert.findMany).mockResolvedValue([] as any)

    const res = await GET(makeReq("?agentId=agent-outside"))
    expect(res.status).toBe(200)
    expect((await res.json()).data.locations).toEqual([])
    expect(prisma.mtmAgentLocation.findMany).not.toHaveBeenCalled()
  })

  it("fleet mode: returns agentLocations with fieldStatus, statusCounts and liveFeed", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-08-01T12:00:00.000Z"))
    try {
    const now = new Date()
    vi.mocked(prisma.mtmAgent.findMany).mockResolvedValue([
      // online + active visit today → CHECKED_IN
      {
        id: "agent-1", name: "Ali", isOnline: true, lastSeenAt: now,
        teamId: "team-1", team: { name: "North" },
        workdays: [{ status: "STARTED", workDate: new Date(`${now.toISOString().slice(0, 10)}T00:00:00.000Z`), startedAt: now }],
        locations: [{ latitude: 40.41, longitude: 49.87, accuracy: 5, speed: 0, heading: 0, battery: 80, isMoving: false, recordedAt: now }],
      },
      // offline (isOnline false) → OFFLINE
      { id: "agent-2", name: "Vali", isOnline: false, lastSeenAt: null, teamId: "team-1", team: { name: "North" }, workdays: [], locations: [] },
      // the last coordinate may still be fresh after FINISH, but it is no longer a live marker
      {
        id: "agent-3", name: "Leyla", isOnline: true, lastSeenAt: now,
        teamId: "team-1", team: { name: "North" },
        workdays: [{
          status: "COMPLETED",
          // Work dates are canonical UTC date keys, not tenant-midnight instants.
          workDate: new Date("2026-08-01T00:00:00.000Z"),
          startedAt: new Date("2026-08-01T06:00:00.000Z"),
        }],
        locations: [{ latitude: 40.42, longitude: 49.88, accuracy: 5, speed: 0, heading: 0, battery: 75, isMoving: false, recordedAt: now }],
      },
    ] as any)
    vi.mocked(prisma.mtmRoute.findMany).mockResolvedValue([
      { agentId: "agent-1", totalPoints: 10, visitedPoints: 5, status: "IN_PROGRESS" },
    ] as any)
    // 1st mtmVisit.findMany call = active visits, 2nd = recent visits feed
    vi.mocked(prisma.mtmVisit.findMany)
      .mockResolvedValueOnce([{ agentId: "agent-1" }] as any)
      .mockResolvedValueOnce([
        {
          id: "visit-1", status: "CHECKED_IN", checkInAt: now, checkOutAt: null,
          agent: { name: "Ali" }, customer: { name: "Store A" },
        },
      ] as any)
    vi.mocked(prisma.mtmAlert.findMany).mockResolvedValue([
      { id: "alert-1", title: "Route deviation", createdAt: now, agent: { name: "Ali" } },
    ] as any)

    const res = await GET(makeReq())
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)

    const byId = Object.fromEntries(json.data.agentLocations.map((a: any) => [a.agentId, a]))
    expect(byId["agent-1"].fieldStatus).toBe("CHECKED_IN")
    expect(byId["agent-1"].routeCompletion).toBe(50)
    // «5 of 10» goes out with every card, not only for a selected employee.
    expect([byId["agent-1"].routeVisited, byId["agent-1"].routeTotal]).toEqual([5, 10])
    expect([byId["agent-2"].routeVisited, byId["agent-2"].routeTotal]).toEqual([0, 0])
    expect(byId["agent-1"].latitude).toBe(40.41)
    expect(byId["agent-1"].freshness).toBe("ONLINE")
    expect(byId["agent-1"].workdayState).toBe("ACTIVE")
    expect(byId["agent-2"].fieldStatus).toBe("OFFLINE")
    expect(byId["agent-2"].freshness).toBe("NO_LOCATION")
    expect(byId["agent-2"].locationState).toBe("NO_LOCATION_REPORTED")
    expect(byId["agent-2"].routeCompletion).toBe(0)
    expect(byId["agent-3"].freshness).toBe("ONLINE")
    expect(byId["agent-3"].workdayState).toBe("CLOSED")

    // agent-3 is online with a fresh, motionless point: that is «Dayanıb», not
    // «Yolda». "On the road" used to mean only "the phone is on".
    expect(byId["agent-3"].fieldStatus).toBe("STOPPED")
    expect(json.data.statusCounts).toEqual({ total: 3, checkedIn: 1, onRoad: 0, stopped: 1, routeFinished: 0, late: 0, offline: 1 })
    expect(json.data.contract).toMatchObject({
      maxRosterSize: 500,
      returnedAgents: 3,
      rosterTruncated: false,
      markerCount: 1,
      today: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      timezone: "Asia/Baku",
      freshnessThresholds: { onlineSeconds: 300, delayedSeconds: 600 },
      maxAccuracyMeters: 100,
      // The organization's check-in radius, for the client zones on the map.
      geofenceRadiusMeters: 100,
    })

    // live feed merges visit + alert events
    const types = json.data.liveFeed.map((e: any) => e.type).sort()
    expect(types).toEqual(["ALERT", "CHECK_IN"])
    } finally {
      vi.useRealTimers()
    }
  })

  it("uses the own field-session boundary on a Routes-only live map", async () => {
    const now = new Date("2026-08-01T12:00:00.000Z")
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({
      plan: "pro",
      addons: [],
      features: ["mtm"],
      modules: { mtm: true, "workforce-hrm": false },
    } as never)
    vi.mocked(prisma.mtmAgent.findMany).mockResolvedValue([{
      id: "agent-1", name: "Ali", isOnline: true, lastSeenAt: now,
      teamId: null, team: null,
      workdays: [{ status: "STARTED", workDate: now, startedAt: now }],
      locations: [{ latitude: 40.41, longitude: 49.87, accuracy: 5, speed: 0, heading: 0, battery: 80, isMoving: false, recordedAt: now }],
    }] as never)
    vi.mocked(prisma.mtmRoute.findMany).mockResolvedValue([] as never)
    vi.mocked(prisma.mtmVisit.findMany).mockResolvedValue([] as never)
    vi.mocked(prisma.mtmAlert.findMany).mockResolvedValue([] as never)

    const response = await GET(makeReq())
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.data.contract.workforceEnabled).toBe(false)
    expect(json.data.contract.fieldSessionEnabled).toBe(true)
    expect(json.data.agentLocations[0]).toMatchObject({
      workdayState: "ACTIVE",
      workdayDate: now.toISOString(),
      workdayStartedAt: now.toISOString(),
      workdayCarryover: true,
    })
    const rosterQuery = vi.mocked(prisma.mtmAgent.findMany).mock.calls[0]?.[0] as any
    expect(rosterQuery.select.workdays).toMatchObject({
      where: expect.objectContaining({ OR: expect.any(Array) }),
    })
  })

  it("uses closed tenant-local activity ranges and UTC date keys around midnight", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-08-01T12:30:00.000Z"))
    try {
      vi.mocked(prisma.mtmSetting.findMany).mockResolvedValueOnce([
        { key: "timezone", value: "Pacific/Auckland" },
      ] as never)

      const res = await GET(makeReq())

      expect(res.status).toBe(200)
      const rosterQuery = vi.mocked(prisma.mtmAgent.findMany).mock.calls[0]?.[0] as any
      expect(rosterQuery.select.workdays.where).toEqual({
        OR: [
          { status: { in: ["STARTED", "PAUSED"] } },
          { workDate: new Date("2026-08-02T00:00:00.000Z") },
        ],
      })
      const routeQuery = vi.mocked(prisma.mtmRoute.findMany).mock.calls[0]?.[0] as any
      expect(routeQuery.where.date).toEqual({
        gte: new Date("2026-08-02T00:00:00.000Z"),
        lt: new Date("2026-08-03T00:00:00.000Z"),
      })
      const [openVisits, visitFeed] = vi.mocked(prisma.mtmVisit.findMany).mock.calls.map((call: unknown[]) => (call[0] as any).where)
      // The day's feed is the tenant's day. A visit that is open is open
      // whatever day it was opened on, so that query has no date in it.
      expect(visitFeed.checkInAt).toEqual({
        gte: new Date("2026-08-01T12:00:00.000Z"),
        lt: new Date("2026-08-02T12:00:00.000Z"),
      })
      expect(openVisits).toMatchObject({ status: "CHECKED_IN", deletedAt: null })
      expect(openVisits.checkInAt).toBeUndefined()
      expect((vi.mocked(prisma.mtmAlert.findMany).mock.calls[0]?.[0] as any).where.createdAt).toEqual({
        gte: new Date("2026-08-01T12:00:00.000Z"),
        lt: new Date("2026-08-02T12:00:00.000Z"),
      })
      const json = await res.json()
      expect(json.data.contract).toMatchObject({
        today: "2026-08-02",
        timezone: "Pacific/Auckland",
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it("uses the newest admissible coordinate instead of an older more accurate point", async () => {
    const newest = new Date("2026-08-01T11:59:00.000Z")
    const older = new Date("2026-08-01T11:58:00.000Z")
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-08-01T12:00:00.000Z"))
    try {
      vi.mocked(prisma.mtmAgent.findMany).mockResolvedValue([{
        id: "agent-1", name: "Ali", isOnline: true, lastSeenAt: newest,
        teamId: null, team: null, workdays: [],
        locations: [
          { latitude: 40.42, longitude: 49.88, accuracy: 80, speed: 0, heading: 0, battery: 70, isMoving: false, recordedAt: newest },
          { latitude: 40.41, longitude: 49.87, accuracy: 5, speed: 0, heading: 0, battery: 80, isMoving: false, recordedAt: older },
        ],
      }] as any)

      const res = await GET(makeReq())
      const json = await res.json()

      expect(json.data.agentLocations[0]).toMatchObject({
        latitude: 40.42,
        longitude: 49.88,
        accuracy: 80,
      })
      const rosterQuery = vi.mocked(prisma.mtmAgent.findMany).mock.calls[0]?.[0] as any
      expect(rosterQuery.select.locations).toMatchObject({ take: 5, orderBy: { recordedAt: "desc" } })
      expect(rosterQuery.select.locations.where).toEqual({
        latitude: { gte: -90, lte: 90 },
        longitude: { gte: -180, lte: 180 },
        OR: [{ accuracy: null }, { accuracy: { gte: 0, lte: 100 } }],
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it("defensively skips an invalid legacy coordinate and keeps the employee in the roster", async () => {
    const now = new Date()
    vi.mocked(prisma.mtmAgent.findMany).mockResolvedValue([{
      id: "agent-1", name: "Ali", isOnline: true, lastSeenAt: now,
      teamId: null, team: null,
      workdays: [{ status: "STARTED", workDate: now, startedAt: now }],
      locations: [
        { latitude: Number.NaN, longitude: 49.88, accuracy: 8, speed: 0, heading: 0, battery: 70, isMoving: false, recordedAt: now },
        { latitude: 40.41, longitude: 49.87, accuracy: 9, speed: 0, heading: 0, battery: 69, isMoving: false, recordedAt: new Date(now.getTime() - 1_000) },
      ],
    }] as any)

    const res = await GET(makeReq())
    const json = await res.json()

    expect(json.data.agentLocations[0]).toMatchObject({ latitude: 40.41, longitude: 49.87 })
    expect(json.data.contract.markerCount).toBe(1)
  })

  it("shows an unfinished prior-day workday as a carryover instead of not started", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-08-01T12:00:00.000Z"))
    try {
      vi.mocked(prisma.mtmAgent.findMany).mockResolvedValue([{
        id: "agent-1", name: "Ali", isOnline: false, lastSeenAt: null,
        teamId: null, team: null, locations: [],
        workdays: [{
          status: "PAUSED",
          workDate: new Date("2026-07-31T00:00:00.000Z"),
          startedAt: new Date("2026-07-31T06:00:00.000Z"),
        }],
      }] as any)

      const res = await GET(makeReq())
      const json = await res.json()

      expect(json.data.agentLocations[0]).toMatchObject({
        workdayState: "PAUSED",
        workdayCarryover: true,
        workdayDate: "2026-07-31T00:00:00.000Z",
      })
    } finally {
      vi.useRealTimers()
    }
  })

  // «Отдел» cannot be filled in from the product; the card's «Руководитель»
  // can. The list groups and filters by him, so he goes out with each row.
  it("sends whom each employee reports to, or nobody", async () => {
    const now = new Date("2026-08-01T12:00:00.000Z")
    vi.mocked(prisma.mtmAgent.findMany).mockResolvedValue([
      { id: "agent-1", name: "Ali", isOnline: false, lastSeenAt: null, teamId: null, team: null, managerId: "mgr-1", manager: { name: "Старший" }, workdays: [], locations: [] },
      { id: "agent-2", name: "Vali", isOnline: false, lastSeenAt: now, teamId: null, team: null, managerId: null, manager: null, workdays: [], locations: [] },
    ] as any)

    const json = await (await GET(makeReq())).json()

    expect(json.data.agentLocations.map((agent: any) => [agent.agentId, agent.managerId, agent.managerName])).toEqual([
      ["agent-1", "mgr-1", "Старший"],
      ["agent-2", null, null],
    ])
    const rosterQuery = vi.mocked(prisma.mtmAgent.findMany).mock.calls[0]?.[0] as any
    expect(rosterQuery.select).toMatchObject({ managerId: true, manager: { select: { name: true } } })
  })

  // The card on the live map says «перерыв с 13:05» and «рабочий день закрыт
  // в 18:02» (2026-10-09). Each time goes out only with the state it explains:
  // a break that was ended leaves `pausedAt` behind on the row, and a shift
  // that is still open must not be given a closing time.
  it("sends when the break began and when the shift was closed — each only with its own state", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-08-01T12:00:00.000Z"))
    try {
      const day = new Date("2026-08-01T00:00:00.000Z")
      const startedAt = new Date("2026-08-01T05:00:00.000Z")
      const pausedAt = new Date("2026-08-01T09:05:00.000Z")
      const completedAt = new Date("2026-08-01T11:30:00.000Z")
      const row = (id: string, workday: Record<string, unknown>) => ({
        id, name: id, isOnline: false, lastSeenAt: null, teamId: null, team: null, locations: [],
        workdays: [{ workDate: day, startedAt, ...workday }],
      })
      vi.mocked(prisma.mtmAgent.findMany).mockResolvedValue([
        row("on-break", { status: "PAUSED", pausedAt, completedAt: null }),
        row("closed", { status: "COMPLETED", pausedAt, completedAt }),
        row("working", { status: "STARTED", pausedAt, completedAt: null }),
      ] as any)

      const json = await (await GET(makeReq())).json()
      const byId = Object.fromEntries(json.data.agentLocations.map((agent: any) => [agent.agentId, agent]))

      expect([byId["on-break"].workdayPausedAt, byId["on-break"].workdayCompletedAt]).toEqual([pausedAt.toISOString(), null])
      expect([byId.closed.workdayPausedAt, byId.closed.workdayCompletedAt]).toEqual([null, completedAt.toISOString()])
      expect([byId.working.workdayPausedAt, byId.working.workdayCompletedAt]).toEqual([null, null])
      const rosterQuery = vi.mocked(prisma.mtmAgent.findMany).mock.calls[0]?.[0] as any
      expect(rosterQuery.select.workdays.select).toMatchObject({ pausedAt: true, completedAt: true })

      // A Routes-only tenant's field session discloses its state, date and
      // start — the break and the closing time are Workforce facts, and the
      // card of such a tenant says nothing of the workday anywhere else.
      vi.mocked(prisma.organization.findUnique).mockResolvedValue({
        plan: "pro", addons: [], features: ["mtm"], modules: { mtm: true, "workforce-hrm": false },
      } as never)
      const routesOnly = await (await GET(makeReq())).json()
      expect(routesOnly.data.contract.workforceEnabled).toBe(false)
      expect(routesOnly.data.agentLocations.map((agent: any) => [agent.workdayState, agent.workdayPausedAt, agent.workdayCompletedAt])).toEqual([
        ["PAUSED", null, null],
        ["CLOSED", null, null],
        ["ACTIVE", null, null],
      ])
    } finally {
      vi.useRealTimers()
    }
  })

  // Owner's own agent, 2026-10-08: checked in at 22:14, still in that visit
  // the next morning. The app showed the open visit and the server refused any
  // other check-in because of it, while the map counted him «Gecikir» and
  // showed zero on «Yerində» — it only looked at visits opened today.
  it("keeps an agent «on site» in a visit he opened before midnight instead of calling him late", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-08-01T12:00:00.000Z"))
    try {
      const now = new Date()
      const agent = {
        id: "agent-1", name: "Ali", isOnline: true, lastSeenAt: now, teamId: null, team: null,
        workdays: [{ status: "STARTED", workDate: new Date("2026-08-01T00:00:00.000Z"), startedAt: now }],
        locations: [{ latitude: 40.41, longitude: 49.87, accuracy: 5, speed: 0, heading: 0, battery: 80, isMoving: false, recordedAt: now }],
      }
      // Today's route is published and untouched, and it is past the late hour.
      const todaysRoute = [{ agentId: "agent-1", totalPoints: 3, visitedPoints: 0, status: "PLANNED" }]
      const ask = async (openVisits: unknown[]) => {
        vi.mocked(prisma.mtmAgent.findMany).mockResolvedValue([agent] as any)
        vi.mocked(prisma.mtmRoute.findMany).mockResolvedValue(todaysRoute as any)
        vi.mocked(prisma.mtmVisit.findMany).mockResolvedValueOnce(openVisits as any).mockResolvedValueOnce([] as any)
        vi.mocked(prisma.mtmAlert.findMany).mockResolvedValue([] as any)
        const json = await (await GET(makeReq())).json()
        return { row: json.data.agentLocations[0], counts: json.data.statusCounts }
      }

      // With no visit open he really is late: this is what the map said.
      const without = await ask([])
      expect(without.row.fieldStatus).toBe("LATE")
      expect(without.row.openVisitSince).toBeNull()

      // The visit opened yesterday evening is still open.
      const openedYesterday = new Date("2026-07-31T18:14:00.000Z")
      const within = await ask([{ agentId: "agent-1", checkInAt: openedYesterday }])
      expect(within.row.fieldStatus).toBe("CHECKED_IN")
      expect(within.row.openVisitSince).toBe(openedYesterday.toISOString())
      expect(within.counts).toMatchObject({ checkedIn: 1, late: 0 })
    } finally {
      vi.useRealTimers()
    }
  })

  it("says a finished route is finished and collapses repeated deviation alerts into one localized feed row (audit 2026-09-14)", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-09-14T15:30:00.000Z"))
    try {
      const now = new Date()
      vi.mocked(prisma.mtmAgent.findMany).mockResolvedValue([{
        id: "agent-anar", name: "Anar Mammadov", isOnline: true, lastSeenAt: now,
        teamId: null, team: null,
        workdays: [{ status: "STARTED", workDate: new Date("2026-09-14T00:00:00.000Z"), startedAt: now }],
        locations: [{ latitude: 40.41, longitude: 49.87, accuracy: 5, speed: 0, heading: 0, battery: 70, isMoving: false, recordedAt: now }],
      }] as any)
      vi.mocked(prisma.mtmRoute.findMany).mockResolvedValue([
        { agentId: "agent-anar", totalPoints: 2, visitedPoints: 2, status: "IN_PROGRESS" },
      ] as any)
      vi.mocked(prisma.mtmVisit.findMany)
        .mockResolvedValueOnce([] as any)
        .mockResolvedValueOnce([] as any)
      vi.mocked(prisma.mtmAlert.findMany).mockResolvedValue(Array.from({ length: 10 }, (_, index) => ({
        id: `alert-${index}`,
        agentId: "agent-anar",
        type: "OUT_OF_ZONE",
        title: "Route deviation detected",
        createdAt: new Date(Date.UTC(2026, 8, 14, 13, 50 - index * 4)),
        metadata: {
          deviationMeters: 7000 + index * 70,
          messageKey: "routeDeviation",
          messageParams: { deviationMeters: 7000 + index * 70, thresholdMeters: 500 },
        },
        agent: { name: "Anar Mammadov" },
      })) as any)

      const res = await GET(makeReq())
      const json = await res.json()

      expect(json.data.agentLocations[0].fieldStatus).toBe("ROUTE_FINISHED")
      expect(json.data.statusCounts).toMatchObject({ routeFinished: 1, onRoad: 0 })
      const alertQuery = vi.mocked(prisma.mtmAlert.findMany).mock.calls[0]?.[0] as any
      expect(alertQuery.where.organizationId).toBe(ORG)
      expect(alertQuery.select).toMatchObject({ agentId: true, type: true, metadata: true })

      const alerts = json.data.liveFeed.filter((event: any) => event.type === "ALERT")
      // 13:14–13:50 UTC is 17:14–17:50 in Baku: one local hour, one row.
      expect(alerts).toHaveLength(1)
      expect(alerts[0]).toMatchObject({
        agentId: "agent-anar",
        agent: "Anar Mammadov",
        alert: {
          alertType: "OUT_OF_ZONE",
          count: 10,
          message: { key: "routeDeviation", distanceMeters: 7630 },
          firstAt: "2026-09-14T13:14:00.000Z",
          lastAt: "2026-09-14T13:50:00.000Z",
        },
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it("combines an agent's routes for the day and keeps a red-light stop «on the road» (review of #205)", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-09-14T11:00:00.000Z"))
    try {
      const now = new Date()
      const standing = { latitude: 40.41, longitude: 49.87, accuracy: 5, speed: 0, heading: 0, battery: 70, isMoving: false, recordedAt: now }
      vi.mocked(prisma.mtmAgent.findMany).mockResolvedValue([
        { id: "agent-a", name: "A", isOnline: true, lastSeenAt: now, teamId: null, team: null, workdays: [], locations: [standing] },
        { id: "agent-b", name: "B", isOnline: true, lastSeenAt: now, teamId: null, team: null, workdays: [], locations: [standing] },
      ] as any)
      // agent-a: the cancelled route comes last, as the database is free to return it.
      vi.mocked(prisma.mtmRoute.findMany).mockResolvedValue([
        { agentId: "agent-a", totalPoints: 3, visitedPoints: 1, status: "IN_PROGRESS" },
        { agentId: "agent-a", totalPoints: 2, visitedPoints: 0, status: "CANCELLED" },
        { agentId: "agent-b", totalPoints: 2, visitedPoints: 2, status: "COMPLETED" },
        { agentId: "agent-b", totalPoints: 2, visitedPoints: 0, status: "PLANNED" },
      ] as any)
      vi.mocked(prisma.mtmVisit.findMany).mockResolvedValueOnce([] as any).mockResolvedValueOnce([] as any)
      vi.mocked(prisma.mtmAlert.findMany).mockResolvedValue([] as any)
      // agent-a was driving 40 seconds ago; the newest sample is a red light.
      vi.mocked(prisma.mtmAgentLocation.groupBy).mockResolvedValueOnce([
        { agentId: "agent-a", _max: { recordedAt: new Date(now.getTime() - 40_000) } },
      ] as any)

      const res = await GET(makeReq())
      const json = await res.json()
      const byId = Object.fromEntries(json.data.agentLocations.map((agent: any) => [agent.agentId, agent]))

      expect(byId["agent-a"].fieldStatus).toBe("ON_ROAD")
      expect(byId["agent-a"].routeCompletion).toBe(33)
      expect(byId["agent-b"].fieldStatus).toBe("STOPPED")
      expect(byId["agent-b"].routeCompletion).toBe(50)
      const movementQuery = vi.mocked(prisma.mtmAgentLocation.groupBy).mock.calls[0]?.[0] as any
      expect(movementQuery.where).toMatchObject({
        organizationId: ORG,
        agentId: { in: ["agent-a", "agent-b"] },
        recordedAt: { gte: new Date("2026-09-14T10:55:00.000Z"), lte: now },
      })
    } finally {
      vi.useRealTimers()
    }
  })

  // «Стоит N минут» (owner, 2026-10-09). The anchor of the stop is kept with
  // the latest position by every GPS write; the roster shows it only for a
  // standing employee and only when it is about the very point on the map.
  describe("since when a standing employee has stood", () => {
    const NOW = new Date("2026-09-14T11:00:00.000Z")
    const minutesAgo = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000)
    const point = { latitude: 40.41, longitude: 49.87, accuracy: 5, speed: 0, heading: 0, battery: 70, isMoving: false, recordedAt: NOW }
    // A position is on the map only during the working day: so is everything said about it.
    const working = [{ status: "STARTED", workDate: new Date("2026-09-14T00:00:00.000Z"), startedAt: minutesAgo(180), pausedAt: null, completedAt: null }]
    const agent = (id: string, over: Record<string, unknown> = {}) =>
      ({ id, name: id, isOnline: true, lastSeenAt: NOW, teamId: null, team: null, workdays: working, locations: [point], ...over })
    const anchor = (agentId: string, over: Record<string, unknown> = {}) =>
      ({ agentId, recordedAt: NOW, stationarySince: minutesAgo(42), stationaryLatitude: 40.41, stationaryLongitude: 49.87, ...over })
    async function roster(agents: unknown[], anchors: unknown[], moving: string[] = []) {
      vi.mocked(prisma.mtmAgent.findMany).mockResolvedValue(agents as never)
      vi.mocked(prisma.mtmRoute.findMany).mockResolvedValue([] as never)
      vi.mocked(prisma.mtmVisit.findMany).mockResolvedValue([] as never)
      vi.mocked(prisma.mtmAlert.findMany).mockResolvedValue([] as never)
      vi.mocked(prisma.mtmAgentLocation.groupBy).mockResolvedValue(
        moving.map((agentId) => ({ agentId, _max: { recordedAt: minutesAgo(1) } })) as never,
      )
      vi.mocked(prisma.mtmAgentLatestLocation.findMany).mockResolvedValue(anchors as never)
      const res = await GET(makeReq())
      expect(res.status).toBe(200)
      const json = await res.json()
      return Object.fromEntries(json.data.agentLocations.map((row: { agentId: string }) => [row.agentId, row])) as Record<string, { fieldStatus: string; stationarySince: string | null }>
    }
    beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW) })
    afterEach(() => { vi.useRealTimers() })

    it("says it for somebody who is standing, from the anchor kept with his latest position", async () => {
      const byId = await roster([agent("stands")], [anchor("stands")])
      expect(byId.stands.fieldStatus).toBe("STOPPED")
      expect(byId.stands.stationarySince).toBe(minutesAgo(42).toISOString())
      // One narrow read, inside the organization, for the people on this roster who have an anchor.
      const query = vi.mocked(prisma.mtmAgentLatestLocation.findMany).mock.calls[0]?.[0] as { where: unknown; select: Record<string, boolean> }
      expect(query.where).toEqual({ organizationId: ORG, agentId: { in: ["stands"] }, stationarySince: { not: null } })
      expect(Object.keys(query.select).sort()).toEqual(["agentId", "recordedAt", "stationaryLatitude", "stationaryLongitude", "stationarySince"])
    })

    it("says nothing for anybody who is not standing, whatever his row holds", async () => {
      const byId = await roster(
        [agent("drives"), agent("silent", { locations: [{ ...point, recordedAt: minutesAgo(180) }] }), agent("no-anchor")],
        [anchor("drives"), anchor("silent", { recordedAt: minutesAgo(180), stationarySince: minutesAgo(400) })],
        ["drives"],
      )
      expect(byId.drives.fieldStatus).toBe("ON_ROAD")
      expect(byId.drives.stationarySince).toBeNull()
      expect(byId.silent.fieldStatus).toBe("OFFLINE")
      expect(byId.silent.stationarySince).toBeNull()
      expect(byId["no-anchor"].fieldStatus).toBe("STOPPED")
      expect(byId["no-anchor"].stationarySince).toBeNull()
    })

    it("says nothing about somebody whose position the map does not show — the working day is over or has not begun", async () => {
      const closed = [{ ...working[0], status: "COMPLETED", completedAt: minutesAgo(20) }]
      const byId = await roster(
        [agent("went-home", { workdays: closed }), agent("not-started", { workdays: [] })],
        [anchor("went-home"), anchor("not-started")],
      )
      expect(byId["went-home"].stationarySince).toBeNull()
      expect(byId["not-started"].stationarySince).toBeNull()
    })

    it("leaves it out whenever the anchor is not about the point on the map — a missing duration, never a wrong one", async () => {
      const byId = await roster(
        [agent("far"), agent("behind"), agent("ahead"), agent("half")],
        [
          // The anchor says he stands about eighty metres from where the map shows him.
          anchor("far", { stationaryLatitude: 40.41072 }),
          // The projection has not caught up with the point on the map.
          anchor("behind", { recordedAt: minutesAgo(3) }),
          // The stop «began» after the point on the map was recorded.
          anchor("ahead", { recordedAt: new Date(NOW.getTime() + 60_000), stationarySince: new Date(NOW.getTime() + 30_000) }),
          // A row with half an anchor.
          anchor("half", { stationaryLongitude: null }),
        ],
      )
      for (const id of ["far", "behind", "ahead", "half"]) {
        expect(byId[id].fieldStatus, id).toBe("STOPPED")
        expect(byId[id].stationarySince, id).toBeNull()
      }
    })

    it("does not ask at all when the roster is empty", async () => {
      await roster([], [])
      expect(prisma.mtmAgentLatestLocation.findMany).not.toHaveBeenCalled()
    })
  })

  it("fetches one sentinel row and explicitly marks a roster over the 500-person contract", async () => {
    vi.mocked(prisma.mtmAgent.findMany).mockResolvedValue(Array.from({ length: 501 }, (_, index) => ({
      id: `agent-${index.toString().padStart(3, "0")}`,
      name: `Agent ${index}`,
      isOnline: false,
      lastSeenAt: null,
      teamId: null,
      team: null,
      workdays: [],
      locations: [],
    })) as any)

    const res = await GET(makeReq())
    const json = await res.json()

    expect(json.data.agentLocations).toHaveLength(500)
    expect(json.data.contract).toMatchObject({
      maxRosterSize: 500,
      returnedAgents: 500,
      rosterTruncated: true,
    })
    expect((vi.mocked(prisma.mtmAgent.findMany).mock.calls[0]?.[0] as any).take).toBe(501)
  })

  it("returns 500 with a stable error message when a query fails", async () => {
    vi.mocked(prisma.mtmAgent.findMany).mockRejectedValue(new Error("boom"))
    const res = await GET(makeReq())
    expect(res.status).toBe(500)
    const json = await res.json()
    expect(json.error).toBe("Failed to load locations")
  })
})

// ─── POST /api/v1/mtm/locations ──────────────────────────────────────────────

describe("POST /api/v1/mtm/locations", () => {
  it("returns 401 when not authenticated", async () => {
    vi.mocked(requireAuth).mockResolvedValue(new Response(null, { status: 401 }) as any)
    const res = await POST(makePostReq({ agentId: "agent-1", latitude: "40.41", longitude: "49.87" }))
    expect(res.status).toBe(401)
  })

  it("creates validated telemetry transactionally and conditionally marks the tenant agent online", async () => {
    vi.mocked(prisma.mtmAgentLocation.create).mockResolvedValue({ id: "loc-1" } as any)
    vi.mocked(prisma.mtmAgent.updateMany).mockResolvedValue({ count: 1 } as any)
    vi.mocked(prisma.mtmAgentLatestLocation.updateMany).mockResolvedValue({ count: 1 } as any)

    const res = await POST(makePostReq({
      agentId: "agent-1",
      latitude: "40.4093",
      longitude: "49.8671",
      accuracy: "8.5",
      battery: "76",
      isMoving: true,
    }))
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.success).toBe(true)

    const createArgs = vi.mocked(prisma.mtmAgentLocation.create).mock.calls[0][0] as any
    expect(createArgs.data).toMatchObject({
      organizationId: ORG,
      agentId: "agent-1",
      latitude: 40.4093,
      longitude: 49.8671,
      accuracy: 8.5,
      battery: 76,
      isMoving: true,
    })
    expect(createArgs.data.recordedAt).toBeInstanceOf(Date)
    // Optional telemetry absent -> null.
    expect(createArgs.data.speed).toBeNull()
    expect(createArgs.data.heading).toBeNull()
    expect(createArgs.data.altitude).toBeNull()

    // The web-only writer has the same monotonic, transaction-local latest
    // projection guarantee as the v1/v2 Field GPS writers. It is a derived
    // projection, not a second authoritative GPS write path.
    expect(prisma.mtmAgentLatestLocation.updateMany).toHaveBeenCalledWith({
      where: {
        organizationId: ORG,
        agentId: "agent-1",
        recordedAt: { lte: createArgs.data.recordedAt },
      },
      data: expect.objectContaining({
        sourceLocationId: "loc-1",
        payloadSha256: null,
        latitude: 40.4093,
        longitude: 49.8671,
        accuracy: 8.5,
        battery: 76,
        recordedAt: createArgs.data.recordedAt,
      }),
    })
    expect(prisma.mtmAgentLatestLocation.findUnique).not.toHaveBeenCalled()

    const updateArgs = vi.mocked(prisma.mtmAgent.updateMany).mock.calls[0][0] as any
    expect(updateArgs.where).toEqual({ id: "agent-1", organizationId: ORG, status: "ACTIVE" })
    expect(updateArgs.data.isOnline).toBe(true)
    expect(updateArgs.data.lastSeenAt).toBeInstanceOf(Date)
    expect(prisma.$transaction).toHaveBeenCalledTimes(1)
  })

  it("a still coordinate looks at the row once, to tell the same stop from a new one, and is written all the same", async () => {
    vi.mocked(prisma.mtmAgentLocation.create).mockResolvedValue({ id: "loc-1" } as any)
    vi.mocked(prisma.mtmAgent.updateMany).mockResolvedValue({ count: 1 } as any)
    vi.mocked(prisma.mtmAgentLatestLocation.findUnique).mockResolvedValue(null as any)
    vi.mocked(prisma.mtmAgentLatestLocation.updateMany).mockResolvedValue({ count: 1 } as any)

    const res = await POST(makePostReq({ agentId: "agent-1", latitude: 40.4093, longitude: 49.8671, accuracy: 8.5, isMoving: false }))
    expect(res.status).toBe(201)
    const recordedAt = (vi.mocked(prisma.mtmAgentLocation.create).mock.calls[0][0] as any).data.recordedAt
    expect(prisma.mtmAgentLatestLocation.findUnique).toHaveBeenCalledTimes(1)
    expect(prisma.mtmAgentLatestLocation.updateMany).toHaveBeenCalledWith({
      where: { organizationId: ORG, agentId: "agent-1", recordedAt: { lte: recordedAt } },
      data: expect.objectContaining({ stationarySince: recordedAt, stationaryLatitude: 40.4093, stationaryLongitude: 49.8671 }),
    })
  })

  it("rejects a valid mobile principal on the web-only writer without touching GPS rows", async () => {
    const mobile = {
      orgId: ORG,
      agentId: "agent-1",
      userId: "agent-user",
      role: "AGENT",
      email: "agent@example.com",
      name: "Agent",
      tenantCapabilities: { routeField: true, workforceHrm: true },
    }
    vi.mocked(getMobileAuth).mockReturnValue(mobile)
    vi.mocked(resolveMobileAuth).mockResolvedValue(mobile)
    // The web-only wrapper delegates to requireAuth, which rejects mobile
    // JWTs before tenant capability or GPS writes are reached.
    vi.mocked(requireAuth).mockResolvedValue(new Response(null, { status: 401 }) as never)

    const res = await POST(makePostReq({ agentId: "agent-1", latitude: 40.41, longitude: 49.87 }))

    expect(res.status).toBe(401)
    expect(requireAuth).toHaveBeenCalled()
    expect(prisma.$transaction).not.toHaveBeenCalled()
    expect(prisma.mtmAgentLocation.create).not.toHaveBeenCalled()
  })

  it("allows an AGENT to write only their own coordinate", async () => {
    vi.mocked(requireAuth).mockResolvedValue({
      orgId: ORG,
      userId: "agent-user",
      role: "user",
      email: "agent@example.com",
      name: "Agent",
    })
    vi.mocked(resolveMtmRouteActor).mockResolvedValue({
      agentId: "agent-self",
      role: "AGENT",
      scopedAgentIds: ["agent-self"],
    })

    const res = await POST(makePostReq({ agentId: "agent-other", latitude: 40.41, longitude: 49.87 }))

    expect(res.status).toBe(404)
    expect(prisma.mtmAgent.updateMany).not.toHaveBeenCalled()
    expect(prisma.mtmAgentLocation.create).not.toHaveBeenCalled()
  })

  it("accepts an AGENT's self coordinate through the conditional tenant guard", async () => {
    vi.mocked(requireAuth).mockResolvedValue({
      orgId: ORG,
      userId: "agent-user",
      role: "user",
      email: "agent@example.com",
      name: "Agent",
    })
    vi.mocked(resolveMtmRouteActor).mockResolvedValue({
      agentId: "agent-self",
      role: "AGENT",
      scopedAgentIds: ["agent-self"],
    })
    vi.mocked(prisma.mtmAgent.updateMany).mockResolvedValue({ count: 1 } as any)
    vi.mocked(prisma.mtmAgentLocation.create).mockResolvedValue({ id: "loc-self" } as any)

    const res = await POST(makePostReq({ agentId: "agent-self", latitude: 40.41, longitude: 49.87 }))

    expect(res.status).toBe(201)
    expect(prisma.mtmAgentLocation.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ organizationId: ORG, agentId: "agent-self" }),
    }))
  })

  it.each(["MANAGER", "SUPERVISOR"] as const)(
    "keeps a %s's outside-scope target absent and performs no writes",
    async (role) => {
      vi.mocked(requireAuth).mockResolvedValue({
        orgId: ORG,
        userId: "leader-user",
        role: "user",
        email: "leader@example.com",
        name: "Leader",
      })
      vi.mocked(resolveMtmRouteActor).mockResolvedValue({
        agentId: "leader-1",
        role,
        scopedAgentIds: ["leader-1", "agent-in-scope"],
      })

      const res = await POST(makePostReq({ agentId: "agent-outside", latitude: 40.41, longitude: 49.87 }))

      expect(res.status).toBe(404)
      expect(prisma.$transaction).not.toHaveBeenCalled()
      expect(prisma.mtmAgent.updateMany).not.toHaveBeenCalled()
      expect(prisma.mtmAgentLocation.create).not.toHaveBeenCalled()
    },
  )

  it("conditionally rejects a cross-tenant agent for ADMIN before creating a coordinate", async () => {
    vi.mocked(prisma.mtmAgent.updateMany).mockResolvedValue({ count: 0 } as any)

    const res = await POST(makePostReq({ agentId: "agent-from-other-org", latitude: 40.41, longitude: 49.87 }))

    expect(res.status).toBe(404)
    expect(prisma.mtmAgent.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "agent-from-other-org", organizationId: ORG, status: "ACTIVE" },
    }))
    expect(prisma.mtmAgentLocation.create).not.toHaveBeenCalled()
  })

  it("resolves current actor scope independently on every request", async () => {
    const inScope = {
      agentId: "manager-1",
      role: "MANAGER" as const,
      scopedAgentIds: ["manager-1", "agent-target"],
    }
    const movedOutOfScope = {
      agentId: "manager-1",
      role: "MANAGER" as const,
      scopedAgentIds: ["manager-1"],
    }
    vi.mocked(resolveMtmRouteActor)
      .mockResolvedValueOnce(inScope)
      .mockResolvedValueOnce(movedOutOfScope)
    vi.mocked(prisma.mtmAgent.updateMany).mockResolvedValue({ count: 1 } as any)
    vi.mocked(prisma.mtmAgentLocation.create).mockResolvedValue({ id: "loc-1" } as any)

    const first = await POST(makePostReq({ agentId: "agent-target", latitude: 40.41, longitude: 49.87 }))
    const second = await POST(makePostReq({ agentId: "agent-target", latitude: 40.41, longitude: 49.87 }))

    expect(first.status).toBe(201)
    expect(second.status).toBe(404)
    expect(resolveMtmRouteActor).toHaveBeenCalledTimes(2)
    expect(prisma.mtmAgentLocation.create).toHaveBeenCalledTimes(1)
  })

  it.each([
    ["NaN latitude", { latitude: "NaN", longitude: 49.87 }],
    ["Infinity longitude", { latitude: 40.41, longitude: "Infinity" }],
    ["latitude below range", { latitude: -90.0001, longitude: 49.87 }],
    ["latitude above range", { latitude: 90.0001, longitude: 49.87 }],
    ["longitude below range", { latitude: 40.41, longitude: -180.0001 }],
    ["longitude above range", { latitude: 40.41, longitude: 180.0001 }],
    ["partially numeric coordinate", { latitude: "40.41north", longitude: 49.87 }],
  ])("rejects %s without attempting a write", async (_label, telemetry) => {
    const res = await POST(makePostReq({ agentId: "agent-1", ...telemetry }))

    expect(res.status).toBe(400)
    expect(resolveMtmRouteActor).not.toHaveBeenCalled()
    expect(prisma.$transaction).not.toHaveBeenCalled()
    expect(prisma.mtmAgentLocation.create).not.toHaveBeenCalled()
  })

  it.each([
    ["negative accuracy", { accuracy: -0.1 }],
    ["infinite accuracy", { accuracy: "Infinity" }],
    ["battery above 100", { battery: 100.1 }],
    ["NaN battery", { battery: "NaN" }],
    ["invalid recordedAt", { recordedAt: "not-a-date" }],
    ["backdated web recordedAt", { recordedAt: Date.now() - 24 * 60 * 60 * 1000 }],
    ["future recordedAt", { recordedAt: Date.now() + 6 * 60 * 1000 }],
  ])("rejects %s according to the telemetry contract", async (_label, telemetry) => {
    const res = await POST(makePostReq({
      agentId: "agent-1",
      latitude: 40.41,
      longitude: 49.87,
      ...telemetry,
    }))

    expect(res.status).toBe(400)
    expect(resolveMtmRouteActor).not.toHaveBeenCalled()
    expect(prisma.$transaction).not.toHaveBeenCalled()
    expect(prisma.mtmAgentLocation.create).not.toHaveBeenCalled()
  })

  it("returns a stable 500 when the transactional create fails", async () => {
    vi.mocked(prisma.mtmAgent.updateMany).mockResolvedValue({ count: 1 } as any)
    vi.mocked(prisma.mtmAgentLocation.create).mockRejectedValue(new Error("bad payload"))
    const res = await POST(makePostReq({ agentId: "agent-1", latitude: "40.41", longitude: "49.87" }))
    expect(res.status).toBe(500)
    const json = await res.json()
    expect(json.error).toBe("Failed to save location")
  })
})
