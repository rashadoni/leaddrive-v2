/**
 * Tests for /api/v1/mtm/locations — web fleet-overview + agent history + POST.
 *
 * Route file: src/app/api/v1/mtm/locations/route.ts
 */
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
    expect(byId["agent-1"].latitude).toBe(40.41)
    expect(byId["agent-1"].freshness).toBe("ONLINE")
    expect(byId["agent-1"].workdayState).toBe("ACTIVE")
    expect(byId["agent-2"].fieldStatus).toBe("OFFLINE")
    expect(byId["agent-2"].freshness).toBe("NO_LOCATION")
    expect(byId["agent-2"].locationState).toBe("NO_LOCATION_REPORTED")
    expect(byId["agent-2"].routeCompletion).toBe(0)
    expect(byId["agent-3"].freshness).toBe("ONLINE")
    expect(byId["agent-3"].workdayState).toBe("CLOSED")

    expect(json.data.statusCounts).toEqual({ total: 3, checkedIn: 1, onRoad: 1, late: 0, offline: 1 })
    expect(json.data.contract).toMatchObject({
      maxRosterSize: 500,
      returnedAgents: 3,
      rosterTruncated: false,
      markerCount: 1,
      today: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      timezone: "Asia/Baku",
      freshnessThresholds: { onlineSeconds: 300, delayedSeconds: 600 },
      maxAccuracyMeters: 100,
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
      for (const call of vi.mocked(prisma.mtmVisit.findMany).mock.calls) {
        expect((call[0] as any).where.checkInAt).toEqual({
          gte: new Date("2026-08-01T12:00:00.000Z"),
          lt: new Date("2026-08-02T12:00:00.000Z"),
        })
      }
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
