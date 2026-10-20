import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/prisma", async () => {
  const { makeMtmPrismaMock } = await import("./mocks/mtm-prisma")
  return { prisma: makeMtmPrismaMock() }
})

vi.mock("@/lib/mobile-auth", async () => {
  const { makeMobileAuthMock } = await import("./mocks/mobile-auth")
  return makeMobileAuthMock()
})

vi.mock("@/lib/mtm/territory-scope", () => ({ resolveAgentScope: vi.fn() }))

import { GET as ManagerLocations } from "@/app/api/v1/mtm/mobile/manager/locations/route"
import { POST as MobileHeartbeat } from "@/app/api/v1/mtm/mobile/ping/route"
import { resolveMobileAuth } from "@/lib/mobile-auth"
import { prisma } from "@/lib/prisma"
import { resolveAgentScope } from "@/lib/mtm/territory-scope"

const AUTH = {
  orgId: "org-1",
  agentId: "manager-1",
  userId: "user-1",
  email: "manager@example.com",
  name: "Manager",
  role: "MANAGER",
}

function request(path: string, method = "GET") {
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers: { Authorization: "Bearer mobile" },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useRealTimers()
  vi.mocked(resolveMobileAuth).mockResolvedValue(AUTH as never)
  vi.mocked(resolveAgentScope).mockResolvedValue({ agentIds: ["agent-1", "manager-1"] } as never)
})

describe("POST /api/v1/mtm/mobile/ping", () => {
  it("acknowledges an authenticated legacy heartbeat without fabricating online presence", async () => {
    const response = await MobileHeartbeat(request("/api/v1/mtm/mobile/ping", "POST"))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ success: true, data: { presence: "GPS_REQUIRED" } })
    expect(prisma.mtmAgent.update).not.toHaveBeenCalled()
  })

  it("keeps legacy heartbeat acknowledgements behind mobile authentication", async () => {
    vi.mocked(resolveMobileAuth).mockResolvedValue(null)

    const response = await MobileHeartbeat(request("/api/v1/mtm/mobile/ping", "POST"))

    expect(response.status).toBe(401)
    expect(prisma.mtmAgent.update).not.toHaveBeenCalled()
  })
})

describe("GET /api/v1/mtm/mobile/manager/locations", () => {
  it("separates live coordinates from delayed, stale, and missing last-known evidence", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-08-21T10:00:00.000Z"))
    vi.mocked(prisma.mtmAgent.findMany).mockResolvedValue([
      {
        id: "agent-fresh",
        name: "Fresh Agent",
        role: "AGENT",
        isOnline: true,
        lastSeenAt: new Date("2026-08-21T09:59:00.000Z"),
        locations: [{
          latitude: 40.4,
          longitude: 49.8,
          accuracy: 8,
          speed: 0,
          heading: 0,
          battery: 80,
          isMoving: false,
          recordedAt: new Date("2026-08-21T09:56:00.000Z"),
        }],
      },
      {
        id: "agent-delayed",
        name: "Delayed Agent",
        role: "AGENT",
        isOnline: true,
        lastSeenAt: new Date("2026-08-21T09:59:00.000Z"),
        locations: [{
          latitude: 40.5,
          longitude: 49.9,
          accuracy: 10,
          speed: null,
          heading: null,
          battery: 50,
          isMoving: null,
          recordedAt: new Date("2026-08-21T09:50:00.000Z"),
        }],
      },
      {
        id: "agent-stale",
        name: "Stale Agent",
        role: "AGENT",
        isOnline: false,
        lastSeenAt: new Date("2026-06-25T15:27:00.000Z"),
        locations: [{
          latitude: 40.6,
          longitude: 49.7,
          accuracy: 20,
          speed: null,
          heading: null,
          battery: null,
          isMoving: null,
          recordedAt: new Date("2026-06-25T15:27:00.000Z"),
        }],
      },
      {
        id: "agent-missing",
        name: "No GPS Agent",
        role: "AGENT",
        isOnline: false,
        lastSeenAt: null,
        locations: [],
      },
    ] as never)

    const response = await ManagerLocations(request("/api/v1/mtm/mobile/manager/locations"))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data).toMatchObject({
      scope: "TEAM_OR_REGION",
      contract: {
        generatedAt: "2026-08-21T10:00:00.000Z",
        freshnessThresholds: { onlineSeconds: 300, delayedSeconds: 900 },
        locationSemantics: "LIVE_ONLY",
        lastKnownLocationSemantics: "LAST_RECORDED",
      },
    })
    expect(body.data.locations[0]).toMatchObject({
      id: "agent-fresh",
      freshness: "ONLINE",
      hasLiveLocation: true,
      location: { latitude: 40.4, longitude: 49.8 },
      liveLocation: { latitude: 40.4, longitude: 49.8 },
      lastKnownLocation: { latitude: 40.4, longitude: 49.8 },
    })
    expect(body.data.locations[1]).toMatchObject({
      id: "agent-delayed",
      freshness: "DELAYED",
      hasLiveLocation: false,
      location: null,
      liveLocation: null,
      lastKnownLocation: { latitude: 40.5, longitude: 49.9 },
    })
    expect(body.data.locations[2]).toMatchObject({
      id: "agent-stale",
      freshness: "STALE",
      hasLiveLocation: false,
      location: null,
      liveLocation: null,
      lastKnownLocation: { latitude: 40.6, longitude: 49.7 },
    })
    expect(body.data.locations[3]).toMatchObject({
      id: "agent-missing",
      freshness: "NO_LOCATION",
      hasLiveLocation: false,
      location: null,
      liveLocation: null,
      lastKnownLocation: null,
    })

    expect(prisma.mtmAgent.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        organizationId: "org-1",
        status: "ACTIVE",
        id: { in: ["agent-1", "manager-1"] },
      },
    }))
  })

  it("uses newer raw evidence during a rolling projection deployment instead of moving a live marker backwards", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-08-21T10:00:00.000Z"))
    vi.mocked(prisma.mtmAgent.findMany).mockResolvedValue([{
      id: "agent-1",
      name: "Agent",
      role: "AGENT",
      isOnline: true,
      lastSeenAt: new Date("2026-08-21T09:59:00.000Z"),
      latestLocation: {
        latitude: 40.4,
        longitude: 49.8,
        accuracy: 8,
        speed: 0,
        heading: 0,
        battery: 80,
        isMoving: false,
        recordedAt: new Date("2026-08-21T09:55:00.000Z"),
      },
      locations: [{
        latitude: 40.5,
        longitude: 49.9,
        accuracy: 8,
        speed: 1,
        heading: 0,
        battery: 80,
        isMoving: false,
        recordedAt: new Date("2026-08-21T09:59:00.000Z"),
      }],
    }] as never)

    const body = await (await ManagerLocations(request("/api/v1/mtm/mobile/manager/locations"))).json()

    expect(body.data.locations[0]).toMatchObject({
      liveLocation: { latitude: 40.5, longitude: 49.9, recordedAt: "2026-08-21T09:59:00.000Z" },
    })
  })

  // The web map shows an employee on a break as the grey point he left
  // before it (demo clip «Marşrut & Sahə», owner 2026-10-20); the manager's
  // phone was handed that point as his live position for the first five
  // minutes of every break, and again just after it.
  describe("an employee on a break, or just back from one", () => {
    const NOW = new Date("2026-08-21T10:00:00.000Z")
    const minutesAgo = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000)
    const fix = (minutes: number) => ({
      latitude: 40.4, longitude: 49.8, accuracy: 8, speed: 12, heading: 0, battery: 80, isMoving: true, recordedAt: minutesAgo(minutes),
    })
    const employee = (id: string, minutes: number, workdays: unknown[]) => ({
      id, name: id, role: "AGENT", isOnline: true, lastSeenAt: minutesAgo(minutes), locations: [fix(minutes)], workdays,
    })
    const journal = [
      { workdayId: "wd-back", type: "PAUSE", occurredAt: minutesAgo(30), appliedAt: minutesAgo(30) },
      { workdayId: "wd-back", type: "RESUME", occurredAt: minutesAgo(2), appliedAt: minutesAgo(2) },
    ]
    beforeEach(() => {
      vi.useFakeTimers()
      vi.setSystemTime(NOW)
      vi.mocked(prisma.mtmAgentWorkdayEvent.findMany).mockImplementation((async (query: {
        where: { organizationId: string; workdayId: { in: string[] }; type: { in: string[] } }
      }) => journal.filter((event) => query.where.organizationId === "org-1" &&
        query.where.workdayId.in.includes(event.workdayId) && query.where.type.in.includes(event.type))) as never)
    })

    it("hands over no live position — only the timestamped last known one", async () => {
      vi.mocked(prisma.mtmAgent.findMany).mockResolvedValue([
        employee("on-break", 1, [{ id: "wd-break", status: "PAUSED", totalPausedSeconds: 0 }]),
        employee("back-no-fix-yet", 3, [{ id: "wd-back", status: "STARTED", totalPausedSeconds: 28 * 60 }]),
        employee("back-moving", 1, [{ id: "wd-back", status: "STARTED", totalPausedSeconds: 28 * 60 }]),
        employee("working", 1, [{ id: "wd-work", status: "STARTED", totalPausedSeconds: 0 }]),
      ] as never)

      const body = await (await ManagerLocations(request("/api/v1/mtm/mobile/manager/locations"))).json()
      const byId = Object.fromEntries(body.data.locations.map((row: { id: string }) => [row.id, row]))

      for (const id of ["on-break", "back-no-fix-yet"]) {
        expect(byId[id]).toMatchObject({ freshness: "STALE", hasLiveLocation: false, location: null, liveLocation: null })
        expect(byId[id].lastKnownLocation).toMatchObject({ latitude: 40.4, longitude: 49.8 })
      }
      for (const id of ["back-moving", "working"]) {
        expect(byId[id]).toMatchObject({ freshness: "ONLINE", hasLiveLocation: true, location: { latitude: 40.4 } })
      }
      // The shift is read to decide this, and none of it goes out.
      expect(Object.keys(byId["on-break"])).not.toContain("workdays")
    })
  })

  it("rejects field agents before resolving team scope or querying coordinates", async () => {
    vi.mocked(resolveMobileAuth).mockResolvedValue({ ...AUTH, role: "AGENT" } as never)

    const response = await ManagerLocations(request("/api/v1/mtm/mobile/manager/locations"))

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({
      code: "MTM_MOBILE_CAPABILITY_REQUIRED",
      capability: "TEAM_READ",
    })
    expect(resolveAgentScope).not.toHaveBeenCalled()
    expect(prisma.mtmAgent.findMany).not.toHaveBeenCalled()
  })
})
