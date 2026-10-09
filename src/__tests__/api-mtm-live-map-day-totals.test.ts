/**
 * GET /api/v1/mtm/locations/day-totals — «Пробег сегодня» and «В движении»
 * for the selected employee's card on the live map (owner, 2026-10-09:
 * «добей до 100 %» of the Navixy tracking screen).
 *
 * The real route behind the real Route & Field wrapper, and beside it the
 * real «История за день» route, so the card's numbers can be held against
 * History's for the same day. The database is stood in for by a few small
 * tables that answer both routes' own queries — the filters, the order, the
 * cap and the list of columns are applied to the rows, not merely looked at —
 * and the road server by one that answers like OSRM.
 */
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

vi.mock("@/lib/mtm/route-permissions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/mtm/route-permissions")>()),
  resolveMtmRouteActor: vi.fn(),
}))

vi.mock("@/lib/mtm-audit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/mtm-audit")>()),
  writeMtmAudit: vi.fn(() => Promise.resolve()),
}))

import { GET } from "@/app/api/v1/mtm/locations/day-totals/route"
import { resetLiveMapDayTotalsCacheForTests } from "@/lib/mtm/live-map-day-totals-cache"
import { GET as historyGET } from "@/app/api/v1/mtm/location-history/route"
import { prisma } from "@/lib/prisma"
import { getOrgId, requireAuth } from "@/lib/api-auth"
import { calculateDistance } from "@/lib/geo-utils"
import { getMobileAuth, resolveMobileAuth } from "@/lib/mobile-auth"
import { writeMtmAudit } from "@/lib/mtm-audit"
import { resetMapMatchingState } from "@/lib/mtm/map-matching"
import { resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import { resetRateLimit } from "@/lib/rate-limit"

const ORG = "org-1"
const USER = "user-manager"
const AGENT = "agent-1"
const ROAD_SERVER = "http://127.0.0.1:5055"
// 14:00 in Baku, the organization's time zone by default: its day is 20:00Z–20:00Z.
const NOW = new Date("2026-10-09T10:00:00.000Z")
const request = (query = `?agentId=${AGENT}`) => new NextRequest(new URL(`http://localhost:3000/api/v1/mtm/locations/day-totals${query}`))
const historyRequest = (query: string) => new NextRequest(new URL(`http://localhost:3000/api/v1/mtm/location-history${query}`))
const read = async (query?: string) => {
  const response = await GET(request(query))
  return { status: response.status, body: await response.json() as { data: Record<string, unknown> } & Record<string, unknown> }
}

type Row = Record<string, unknown>
const utc = (clock: string, day = "2026-10-09") => new Date(`${day}T${clock}Z`)

let sequence = 0
/** A raw fix as the table holds it — with the columns the count must not read. */
const fix = (at: Date, latitude: number, over: Row = {}): Row => ({
  id: `f${String(sequence++).padStart(6, "0")}`, organizationId: ORG, agentId: AGENT, latitude, longitude: 49.85, accuracy: 8,
  speed: 14, heading: 0, altitude: 12, battery: 77, isMoving: true, recordedAt: at, workdayId: "w1", ...over,
})
/** Ten minutes north from `start`, a fix every thirty seconds, about 56 m a step. */
const drive = (start: Date, startLatitude: number, over: Row = {}) =>
  Array.from({ length: 21 }, (_unused, index) => fix(new Date(start.getTime() + index * 30_000), startLatitude + index * 0.0005, over))
/** Standing at one door, a fix every thirty seconds. */
const stand = (start: Date, minutes: number, latitude: number) =>
  Array.from({ length: minutes * 2 + 1 }, (_unused, index) => fix(new Date(start.getTime() + index * 30_000), latitude))
const straightMeters = (rows: Row[]) => Math.round(rows.reduce<number>((sum, row, index) => index === 0 ? sum
  : sum + calculateDistance(rows[index - 1].latitude as number, rows[index - 1].longitude as number, row.latitude as number, row.longitude as number), 0))

let fixes: Row[]
let visits: Row[]
let shifts: Row[]
let shiftEvents: Row[]

/** A Prisma `where`, applied: equality, null, a date, `in`, a range of dates, OR. */
function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, condition]) => {
    if (key === "OR") return (condition as Row[]).some((branch) => matches(row, branch))
    const value = row[key]
    if (condition === null || typeof condition !== "object") return value === condition
    if (condition instanceof Date) return value instanceof Date && value.getTime() === condition.getTime()
    const filter = condition as { in?: unknown[]; gte?: Date; lte?: Date; lt?: Date }
    if (filter.in) return filter.in.includes(value)
    if (!(value instanceof Date)) return false
    return (!filter.gte || value >= filter.gte) && (!filter.lte || value <= filter.lte) && (!filter.lt || value < filter.lt)
  })
}
/** Only the columns asked for come back: a column the route did not select is not there to be used. */
function pick(row: Row, select: Row | undefined): Row {
  if (!select) return { ...row }
  return Object.fromEntries(Object.entries(select).filter(([, on]) => on).map(([key, on]) => {
    const value = row[key]
    return [key, on !== true && value && typeof value === "object" ? pick(value as Row, (on as { select?: Row }).select) : value]
  }))
}
const table = (rows: () => Row[], time: string) => (async (args: { where: Row; take?: number; select?: Row }) =>
  rows()
    .filter((row) => matches(row, args.where))
    .sort((left, right) => (left[time] as Date).getTime() - (right[time] as Date).getTime() || String(left.id).localeCompare(String(right.id)))
    .slice(0, args.take ?? Number.POSITIVE_INFINITY)
    .map((row) => pick(row, args.select))) as never

/** Every model method the request touched, as «model.method». */
const touched = () => Object.entries(prisma as unknown as Record<string, Record<string, { mock?: { calls: unknown[] } }>>)
  .flatMap(([model, methods]) => Object.entries(methods ?? {})
    .filter(([, method]) => (method?.mock?.calls.length ?? 0) > 0)
    .map(([method]) => `${model}.${method}`))
const daysRead = () => vi.mocked(prisma.mtmAgentLocation.findMany).mock.calls.length

/** The company's road server, as OSRM answers: 70 m of road a step, 4.2 km across a silence. */
let roadServer: (url: URL) => unknown
const fetchMock = vi.fn(async (input: unknown) => {
  const body = roadServer(new URL(String(input)))
  return { ok: true, status: 200, json: async () => body }
})
function roads(url: URL): unknown {
  const [, service, , , path] = url.pathname.split("/")
  const coordinates = decodeURIComponent(path).split(";").map((pair) => pair.split(",").map(Number))
  if (service === "route") return { code: "Ok", routes: [{ distance: 4_200 }] }
  return {
    code: "Ok",
    matchings: [{ geometry: { coordinates }, legs: Array.from({ length: coordinates.length - 1 }, () => ({ distance: 70 })) }],
    tracepoints: coordinates.map((_unused, index) => ({ matchings_index: 0, waypoint_index: index })),
  }
}

// Drove 09:00–09:10 Baku time, the phone silent until 09:40, drove on until 09:50.
const MORNING = () => [...drive(utc("05:00:00"), 40.40), ...drive(utc("05:40:00"), 40.43)]

beforeEach(() => {
  vi.clearAllMocks()
  vi.unstubAllEnvs()
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(NOW)
  resetLiveMapDayTotalsCacheForTests()
  resetMapMatchingState()
  resetRateLimit(`mtm-live-map-day-totals:${ORG}:${USER}`)
  vi.mocked(getOrgId).mockResolvedValue(ORG)
  vi.mocked(getMobileAuth).mockReturnValue(null)
  vi.mocked(resolveMobileAuth).mockResolvedValue(null)
  vi.mocked(requireAuth).mockResolvedValue({ orgId: ORG, userId: USER, role: "manager", email: "manager@example.com", name: "Manager" })
  vi.mocked(resolveMtmRouteActor).mockResolvedValue({ agentId: null, role: "ADMIN", scopedAgentIds: null } as never)
  vi.mocked(prisma.organization.findUnique).mockResolvedValue({ plan: "pro", addons: [], features: ["mtm"], modules: { mtm: true }, settings: {} } as never)
  vi.mocked(prisma.mtmAgent.findFirst).mockImplementation((async (args: { where: Row }) =>
    args.where.id === AGENT && args.where.organizationId === ORG && args.where.status === "ACTIVE" ? { id: AGENT, name: "Сотрудник", role: "AGENT", team: null } : null) as never)

  fixes = MORNING()
  visits = []
  shifts = []
  shiftEvents = []
  vi.mocked(prisma.mtmAgentLocation.findMany).mockImplementation(table(() => fixes, "recordedAt"))
  vi.mocked(prisma.mtmVisit.findMany).mockImplementation(table(() => visits, "checkInAt"))
  vi.mocked(prisma.mtmAgentWorkdayEvent.findMany).mockImplementation(table(() => shiftEvents, "occurredAt"))
  vi.mocked(prisma.mtmAgentWorkday.findFirst).mockImplementation((async (args: { where: Row; select?: Row }) => {
    // History also looks for a shift carried over from an earlier day; there is none here.
    if (!(args.where.workDate instanceof Date)) return null
    const shift = shifts.find((row) => matches(row, args.where))
    return shift ? pick(shift, args.select) : null
  }) as never)

  roadServer = roads
  vi.stubGlobal("fetch", fetchMock)
  vi.stubEnv("MTM_MAP_MATCHING_URL", ROAD_SERVER)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe("GET /api/v1/mtm/locations/day-totals", () => {
  it("counts today's kilometres along the roads, the time he was driving and the time the phone said nothing", async () => {
    const { status, body } = await read()
    expect(status).toBe(200)
    expect(body).toEqual({
      success: true,
      data: {
        date: "2026-10-09",
        timezone: "Asia/Baku",
        // Forty steps of 70 m of road and 4.2 km of road across the silence.
        distanceMeters: 40 * 70 + 4_200,
        distanceBasis: "ROADS",
        movingSeconds: 20 * 60,
        unknownSeconds: 30 * 60,
        firstPointAt: "2026-10-09T05:00:00.000Z",
        lastPointAt: "2026-10-09T05:50:00.000Z",
        complete: true,
        generatedAt: NOW.toISOString(),
      },
    })
  })

  it("shows the numbers «История за день» shows for the same employee and day — and, unlike History, leaves no audit row", async () => {
    // A day with everything History feeds its count: a shift, a visit at a door, a silence.
    fixes = [
      ...drive(utc("05:00:00"), 40.40),
      ...stand(utc("05:10:00"), 20, 40.41).slice(1),
      ...drive(utc("05:30:00"), 40.41).slice(1),
      ...drive(utc("06:10:00"), 40.44),
      // A fix the organization's accuracy limit rejects: neither screen counts it.
      fix(utc("06:21:00"), 40.50, { accuracy: 900 }),
    ]
    visits = [{
      id: "v1", organizationId: ORG, agentId: AGENT, customerId: "c1", routeId: null, routePointId: null, status: "CHECKED_OUT", deletedAt: null,
      checkInAt: utc("05:11:00"), checkOutAt: utc("05:29:00"), checkInLat: 40.41, checkInLng: 49.85,
      checkOutLat: 40.41, checkOutLng: 49.85, checkInCustomerLat: 40.41, checkInCustomerLng: 49.85, checkInGeofenceRadius: 100,
      customer: { name: "Аптека на углу", address: "ул. Примерная, 1", latitude: 40.41, longitude: 49.85, geofenceRadius: 100 },
    }]
    shifts = [{
      id: "w1", organizationId: ORG, agentId: AGENT, workDate: new Date("2026-10-09T00:00:00.000Z"), status: "STARTED",
      startedAt: utc("04:58:00"), pausedAt: null, completedAt: null, totalPausedSeconds: 0,
      startLatitude: 40.40, startLongitude: 49.85, endLatitude: null, endLongitude: null,
    }]

    const card = (await read()).body.data
    expect(writeMtmAudit).not.toHaveBeenCalled()
    expect(prisma.mtmAuditLog.create).not.toHaveBeenCalled()

    const response = await historyGET(historyRequest(`?agentId=${AGENT}&date=2026-10-09`))
    expect(response.status).toBe(200)
    const history = (await response.json()).data
    expect(history.quality).toMatchObject({ rejectedByAccuracy: 1, rawTruncated: false })
    expect({
      distanceMeters: card.distanceMeters,
      distanceBasis: card.distanceBasis,
      movingSeconds: card.movingSeconds,
      unknownSeconds: card.unknownSeconds,
      firstPointAt: card.firstPointAt,
      lastPointAt: card.lastPointAt,
    }).toEqual({
      distanceMeters: history.summary.distanceMeters,
      distanceBasis: history.summary.distanceBasis,
      movingSeconds: history.trip.summary.movingSeconds,
      unknownSeconds: history.trip.summary.unknownSeconds,
      firstPointAt: history.summary.firstPointAt,
      lastPointAt: history.summary.lastPointAt,
    })
    // Not two empty answers agreeing: there was a day to count.
    expect(card.distanceMeters).toBeGreaterThan(4_000)
    expect(card.movingSeconds).toBeGreaterThan(20 * 60)
    // Opening History is still written down; the card's numbers were not.
    expect(vi.mocked(writeMtmAudit).mock.calls.map(([row]) => row.action)).toEqual(["GPS_HISTORY_VIEW"])
  })

  it("lets only numbers leave the server: no coordinate, no point, no stop, no client — and does not even read what it has no use for", async () => {
    visits = [{
      id: "v1", organizationId: ORG, agentId: AGENT, customerId: "c1", status: "CHECKED_OUT", deletedAt: null,
      checkInAt: utc("05:41:00"), checkOutAt: utc("05:42:00"), checkInLat: 40.43, checkInLng: 49.85,
      customer: { name: "Аптека на углу", address: "ул. Примерная, 1", latitude: 40.43, longitude: 49.85 },
    }]
    const { body } = await read()
    expect(Object.keys(body.data).sort()).toEqual([
      "complete", "date", "distanceBasis", "distanceMeters", "firstPointAt", "generatedAt",
      "lastPointAt", "movingSeconds", "timezone", "unknownSeconds",
    ])
    const text = JSON.stringify(body)
    expect(text).not.toMatch(/latitude|longitude|"lat"|"lng"|points|stops|visits|customer|Аптека|Примерная/)
    // No number of the answer is a coordinate of the day.
    expect(text).not.toMatch(/40\.4\d|49\.85/)

    const fixColumns = vi.mocked(prisma.mtmAgentLocation.findMany).mock.calls[0]?.[0]?.select as Row
    // Time in motion is not read off the phone's own «speed» and «moving».
    expect(Object.keys(fixColumns).sort()).toEqual(["accuracy", "id", "latitude", "longitude", "recordedAt"])
    // Of the client, only where he is: his name and address stay in the database.
    const visitColumns = vi.mocked(prisma.mtmVisit.findMany).mock.calls[0]?.[0]?.select as Row
    expect(Object.keys((visitColumns.customer as { select: Row }).select).sort()).toEqual(["latitude", "longitude"])
  })

  it("«today» is the organization's day — not the server's, and not one the browser names", async () => {
    // 21:30Z on the 9th is 01:30 on the 10th in Baku: the morning of the 9th is yesterday.
    vi.setSystemTime(new Date("2026-10-09T21:30:00.000Z"))
    const night = [fix(utc("20:10:00"), 40.40), fix(utc("20:10:30"), 40.4005), fix(utc("20:11:00"), 40.4010)]
    fixes = [...MORNING(), ...night]
    const { body } = await read(`?agentId=${AGENT}&date=2026-10-09`)
    expect(body.data).toMatchObject({
      date: "2026-10-10",
      distanceMeters: 2 * 70,
      firstPointAt: "2026-10-09T20:10:00.000Z",
      lastPointAt: "2026-10-09T20:11:00.000Z",
    })
    const where = vi.mocked(prisma.mtmAgentLocation.findMany).mock.calls[0]?.[0]?.where as { recordedAt: { gte: Date; lt: Date } }
    expect([where.recordedAt.gte.toISOString(), where.recordedAt.lt.toISOString()])
      .toEqual(["2026-10-09T20:00:00.000Z", "2026-10-10T20:00:00.000Z"])
  })

  it("an employee outside the viewer's team is «not found» — nothing of his is read, not even a day somebody else has just had counted", async () => {
    // The administrator opens his card: the day is counted and kept for a minute.
    expect((await read()).status).toBe(200)
    vi.clearAllMocks()

    vi.mocked(resolveMtmRouteActor).mockResolvedValue({ agentId: "sup-1", role: "SUPERVISOR", scopedAgentIds: ["agent-2", "agent-3"] } as never)
    const refused = await read()
    expect([refused.status, refused.body]).toEqual([404, { error: "Agent not found" }])
    // The module check of the Route & Field wrapper is the only read.
    expect(touched().filter((name) => name !== "organization.findUnique")).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("a manager or supervisor reads the day of an employee of his own team", async () => {
    vi.mocked(resolveMtmRouteActor).mockResolvedValue({ agentId: "sup-1", role: "SUPERVISOR", scopedAgentIds: [AGENT, "agent-2"] } as never)
    const { status, body } = await read()
    expect([status, body.data.distanceMeters]).toEqual([200, 7_000])
  })

  it("an employee who is not there — unknown, another company's, switched off — is «not found», and no fix is read", async () => {
    const { status, body } = await read("?agentId=agent-of-another-company")
    expect([status, body]).toEqual([404, { error: "Agent not found" }])
    expect(vi.mocked(prisma.mtmAgent.findFirst).mock.calls[0]?.[0]?.where).toEqual({ id: "agent-of-another-company", organizationId: ORG, status: "ACTIVE" })
    expect(daysRead()).toBe(0)

    const nobody = await read("")
    expect([nobody.status, nobody.body.code]).toEqual([400, "MTM_LIVE_MAP_DAY_TOTALS_INVALID"])
    expect(daysRead()).toBe(0)
  })

  it("is the managers' screen: a field agent is refused, and so is a web user without an MTM card — before anything is read", async () => {
    vi.mocked(resolveMtmRouteActor).mockResolvedValue({ agentId: AGENT, role: "AGENT", scopedAgentIds: [AGENT] } as never)
    expect((await read()).status).toBe(403)
    vi.mocked(resolveMtmRouteActor).mockResolvedValue(null as never)
    expect((await read()).status).toBe(403)
    expect(touched().filter((name) => name !== "organization.findUnique")).toEqual([])
  })

  it("is for signed-in people of an organization that has the module", async () => {
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({ plan: "starter", addons: [], features: [], modules: {}, settings: {} } as never)
    const denied = await read()
    expect([denied.status, denied.body.code]).toEqual([403, "TENANT_CAPABILITY_DISABLED"])

    vi.mocked(requireAuth).mockResolvedValue(new Response(null, { status: 401 }) as never)
    expect((await GET(request())).status).toBe(401)
    expect(daysRead()).toBe(0)
  })

  it("a day with more fixes than one reading holds is not counted at all — no kilometres from its beginning — and the road server is not asked", async () => {
    // A fix every five seconds since the organization's midnight: more than the 5,001 one reading takes.
    const midnight = utc("20:00:00", "2026-10-08").getTime()
    fixes = Array.from({ length: 5_200 }, (_unused, index) => fix(new Date(midnight + index * 5_000), 40.40 + index * 0.00002))
    const { status, body } = await read()
    expect(status).toBe(200)
    expect(body.data).toMatchObject({
      complete: false,
      distanceMeters: null,
      distanceBasis: null,
      movingSeconds: null,
      unknownSeconds: null,
      firstPointAt: "2026-10-08T20:00:00.000Z",
    })
    expect(vi.mocked(prisma.mtmAgentLocation.findMany).mock.calls[0]?.[0]?.take).toBe(5_001)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("two looks within a minute are one reading of the day; after the minute it is read again", async () => {
    const first = (await read()).body.data
    vi.setSystemTime(new Date(NOW.getTime() + 59_000))
    const second = (await read()).body.data
    expect(daysRead()).toBe(1)
    // The kept answer says when it was counted, not when it was handed out.
    expect(second).toEqual(first)

    // He drove on meanwhile.
    fixes = [...fixes, ...drive(utc("05:50:30"), 40.4405)]
    vi.setSystemTime(new Date(NOW.getTime() + 61_000))
    const third = (await read()).body.data
    expect(daysRead()).toBe(2)
    expect(third.generatedAt).toBe(new Date(NOW.getTime() + 61_000).toISOString())
    expect(third.distanceMeters).toBeGreaterThan(first.distanceMeters as number)
  })

  it("a kept day is each employee's own, and each organization's", async () => {
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ id: "any" } as never)
    fixes = [...MORNING(), ...drive(utc("06:00:00"), 40.50, { agentId: "agent-2" })]
    const one = (await read()).body.data
    const two = (await read("?agentId=agent-2")).body.data
    expect([one.distanceMeters, two.distanceMeters]).toEqual([7_000, 20 * 70])
    expect(daysRead()).toBe(2)
  })

  it("a day the road server answered only in part is not kept: the next look asks again and gets the whole", async () => {
    // The stretch of the second drive comes back without an answer the first time.
    let refusals = 1
    roadServer = (url) => {
      if (url.pathname.startsWith("/match/") && url.pathname.includes(",40.43") && refusals > 0) {
        refusals -= 1
        return { code: "TooBig" }
      }
      return roads(url)
    }
    const partial = (await read()).body.data
    const secondDrive = straightMeters(fixes.slice(21))
    expect(partial).toMatchObject({ distanceBasis: "PARTIAL", distanceMeters: 20 * 70 + 4_200 + secondDrive })

    const whole = (await read()).body.data
    expect(whole).toMatchObject({ distanceBasis: "ROADS", distanceMeters: 7_000 })
    expect(daysRead()).toBe(2)
  })

  it("without a road server the kilometres are straight lines between fixes, nothing is added across the silence, and the answer says so", async () => {
    vi.stubEnv("MTM_MAP_MATCHING_URL", "off")
    const { body } = await read()
    expect(body.data).toMatchObject({
      distanceBasis: "STRAIGHT",
      distanceMeters: straightMeters(fixes.slice(0, 21)) + straightMeters(fixes.slice(21)),
      movingSeconds: 20 * 60,
      unknownSeconds: 30 * 60,
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("asks nothing outside the server: the only host spoken to is the company's own road server", async () => {
    await read()
    // Two stretches of track and the silence between them.
    expect(fetchMock).toHaveBeenCalledTimes(3)
    for (const [url] of fetchMock.mock.calls) expect(new URL(String(url)).origin).toBe(ROAD_SERVER)
  })

  it("a visit forgotten open on an earlier day does not turn today into days of driving", async () => {
    const plain = (await read()).body.data
    resetLiveMapDayTotalsCacheForTests()
    visits = [{
      id: "forgotten", organizationId: ORG, agentId: AGENT, customerId: "c9", status: "CHECKED_IN", deletedAt: null,
      checkInAt: utc("10:00:00", "2026-10-06"), checkOutAt: null, checkInLat: 40.39, checkInLng: 49.85,
      customer: { name: "Клиника", address: null, latitude: 40.39, longitude: 49.85 },
    }]
    const withForgotten = (await read()).body.data
    expect(withForgotten.movingSeconds).toBe(20 * 60)
    expect(withForgotten).toEqual(plain)
  })

  it("a visit of today at a door where the phone was silent is standing, not driving", async () => {
    // He stood at the client's from 09:12 to 09:38 while the phone said nothing.
    visits = [{
      id: "v1", organizationId: ORG, agentId: AGENT, customerId: "c1", status: "CHECKED_OUT", deletedAt: null,
      checkInAt: utc("05:12:00"), checkOutAt: utc("05:38:00"), checkInLat: 40.42, checkInLng: 49.85,
      customer: { name: "Аптека на углу", address: null, latitude: 40.42, longitude: 49.85 },
    }]
    const { body } = await read()
    // Of the half hour of silence only the four minutes around the visit are unknown.
    expect(body.data).toMatchObject({ movingSeconds: 20 * 60, unknownSeconds: 4 * 60 })
  })

  describe("the shift and its breaks", () => {
    beforeEach(() => {
      shifts = [{
        id: "w1", organizationId: ORG, agentId: AGENT, workDate: new Date("2026-10-09T00:00:00.000Z"), status: "STARTED",
        startedAt: utc("05:00:00"), pausedAt: null, completedAt: null, totalPausedSeconds: 0,
      }]
      shiftEvents = [
        { id: "e1", organizationId: ORG, agentId: AGENT, type: "PAUSE", occurredAt: utc("05:10:20") },
        { id: "e2", organizationId: ORG, agentId: AGENT, type: "RESUME", occurredAt: utc("05:39:40") },
        // Somebody else's break is not his.
        { id: "e3", organizationId: ORG, agentId: "agent-2", type: "PAUSE", occurredAt: utc("05:00:00") },
      ]
    })

    it("a break he pressed himself is not «нет данных»", async () => {
      const { body } = await read()
      expect(body.data).toMatchObject({ unknownSeconds: 0, movingSeconds: 20 * 60 })
    })

    it("without the workforce module neither the shift nor its breaks are read: the silence stays unexplained", async () => {
      vi.mocked(prisma.organization.findUnique).mockResolvedValue({
        plan: "pro", addons: [], features: ["mtm"], modules: { mtm: true, "workforce-hrm": false }, settings: {},
      } as never)
      const { body } = await read()
      expect(body.data).toMatchObject({ unknownSeconds: 30 * 60, movingSeconds: 20 * 60 })
      expect(prisma.mtmAgentWorkday.findFirst).not.toHaveBeenCalled()
      expect(prisma.mtmAgentWorkdayEvent.findMany).not.toHaveBeenCalled()
    })
  })

  it("a day without a single fix is a counted day with nothing in it", async () => {
    fixes = []
    const { body } = await read()
    expect(body.data).toMatchObject({
      complete: true, distanceMeters: 0, movingSeconds: 0, unknownSeconds: 0, firstPointAt: null, lastPointAt: null,
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("when the day cannot be read it says so — an error, not a zero — and keeps nothing", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {})
    vi.mocked(prisma.mtmAgentLocation.findMany).mockRejectedValueOnce(new Error("connection lost") as never)
    const failed = await read()
    expect([failed.status, failed.body.code]).toEqual([500, "MTM_LIVE_MAP_DAY_TOTALS_FAILED"])
    expect(JSON.stringify(failed.body)).not.toContain("connection lost")
    quiet.mockRestore()

    expect((await read()).body.data.distanceMeters).toBe(7_000)
  })

  it("is asked for when a card is opened and every couple of minutes, not on the map's timer: thirty a minute", async () => {
    let last: Response | null = null
    for (let turn = 0; turn < 31; turn += 1) last = await GET(request())
    expect(last?.status).toBe(429)
    expect(last?.headers.get("retry-after")).toBe("60")
    // Thirty looks, one reading of the day.
    expect(daysRead()).toBe(1)
  })
})
