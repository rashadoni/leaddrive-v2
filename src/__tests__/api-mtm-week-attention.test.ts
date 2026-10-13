import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

/**
 * «Ждёт решения» on the Panel is a count of lists that live on other pages.
 * A count that disagrees with the list it opens would be the second source of
 * truth this repository keeps removing, so the test does not compare `where`
 * objects: it keeps rows in memory, lets every handler filter them through its
 * own query, and checks that the number on the Panel is the number of rows the
 * queue returns to the same person.
 *
 * The day is the one the owner looked at: Sunday 11 October 2026, 18:54 in Baku.
 */

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

import { GET } from "@/app/api/v1/mtm/week/attention/route"
import { GET as contactRequestQueue } from "@/app/api/v1/mtm/contact-create-requests/route"
import { GET as customerRequestQueue } from "@/app/api/v1/mtm/customer-create-requests/route"
import { GET as routeChangeQueue } from "@/app/api/v1/mtm/route-change-requests/route"
import { GET as locationRequestQueue } from "@/app/api/v1/mtm/customer-location-requests/route"
import { GET as alertList } from "@/app/api/v1/mtm/alerts/route"
import { GET as photoList } from "@/app/api/v1/mtm/photos/route"
import { requireAuth } from "@/lib/api-auth"
import { getMobileAuth, resolveMobileAuth } from "@/lib/mobile-auth"
import { resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import { resetMtmFieldScopeMemo } from "@/lib/mtm/field-access"
import { checkRateLimit } from "@/lib/rate-limit"
import { prisma } from "@/lib/prisma"
import { serveRows as serve, type Row } from "./mocks/in-memory-rows"

const ORG = "org-zeytun"
const NOW = new Date("2026-10-11T14:54:00.000Z") // 18:54 in Baku, a Sunday
const TODAY_START = new Date("2026-10-10T20:00:00.000Z") // midnight in Baku

const at = (iso: string) => new Date(iso)
const day = (key: string) => new Date(`${key}T00:00:00.000Z`)

const AGENTS: Row[] = [
  { id: "a1", organizationId: ORG, name: "Agent North", role: "AGENT", status: "ACTIVE", teamId: "t1", team: { regionId: "r1" } },
  { id: "a2", organizationId: ORG, name: "Agent South", role: "AGENT", status: "ACTIVE", teamId: "t2", team: { regionId: "r2" } },
  { id: "a3", organizationId: ORG, name: "Agent Gone", role: "AGENT", status: "INACTIVE", teamId: "t1", team: { regionId: "r1" } },
  { id: "m1", organizationId: ORG, name: "Office Manager", role: "MANAGER", status: "ACTIVE", teamId: null, team: null },
  { id: "adm", organizationId: ORG, name: "Director", role: "ADMIN", status: "ACTIVE", teamId: null, team: null },
  { id: "x1", organizationId: "org-other", name: "Other tenant", role: "AGENT", status: "ACTIVE", teamId: null, team: null },
]

const CONTACT_REQUESTS: Row[] = [
  { id: "cr1", organizationId: ORG, requestedByAgentId: "a1", status: "SUBMITTED", submittedAt: at("2026-10-07T22:01:40.000Z") },
  { id: "cr2", organizationId: ORG, requestedByAgentId: "a2", status: "IN_REVIEW", submittedAt: at("2026-10-09T08:00:00.000Z") },
  { id: "cr3", organizationId: ORG, requestedByAgentId: "a1", status: "APPROVED", submittedAt: at("2026-10-01T08:00:00.000Z") },
  { id: "cr4", organizationId: "org-other", requestedByAgentId: "x1", status: "SUBMITTED", submittedAt: at("2026-10-01T08:00:00.000Z") },
]

const CUSTOMER_REQUESTS: Row[] = [
  { id: "cu1", organizationId: ORG, requestedByAgentId: "a2", status: "NEEDS_INFO", submittedAt: null, createdAt: at("2026-10-06T07:00:00.000Z"), name: "Aptek", externalCode: null, phone: null },
  { id: "cu2", organizationId: ORG, requestedByAgentId: "a1", status: "DRAFT", submittedAt: null, createdAt: at("2026-10-05T07:00:00.000Z"), name: "Klinika", externalCode: null, phone: null },
]

/** What the queue of «Клиент здесь» reads of a request, besides who sent it and when. */
const locationRequest = (row: Row): Row => ({
  reviewedAt: null, comment: null, decisionComment: null,
  previousLatitude: 40.37, previousLongitude: 49.83, proposedLatitude: 40.41, proposedLongitude: 49.87,
  agentLatitude: 40.41, agentLongitude: 49.87, agentAccuracyMeters: 17, agentFixAt: at("2026-10-11T14:39:30.000Z"),
  movedMeters: 5600, agentToProposedMeters: 12, customerId: `customer-${row.id}`,
  customer: { id: `customer-${row.id}`, name: "Klinika", address: null, city: null, latitude: 40.37, longitude: 49.83 },
  requestedByAgent: { id: row.requestedByAgentId, name: "Agent" }, visits: [],
  ...row,
})

const LOCATION_REQUESTS: Row[] = [
  // Sent a quarter of an hour ago, from the door: 18:40 in Baku, today.
  locationRequest({ id: "lr1", organizationId: ORG, requestedByAgentId: "a1", status: "SUBMITTED", submittedAt: at("2026-10-11T14:40:00.000Z") }),
  locationRequest({ id: "lr2", organizationId: ORG, requestedByAgentId: "a2", status: "SUBMITTED", submittedAt: at("2026-10-10T09:00:00.000Z") }),
  // Decided ones wait for nobody; another tenant's is not ours.
  locationRequest({ id: "lr3", organizationId: ORG, requestedByAgentId: "a1", status: "APPROVED", submittedAt: at("2026-10-09T09:00:00.000Z") }),
  locationRequest({ id: "lr4", organizationId: ORG, requestedByAgentId: "a2", status: "REJECTED", submittedAt: at("2026-10-09T10:00:00.000Z") }),
  locationRequest({ id: "lr5", organizationId: "org-other", requestedByAgentId: "x1", status: "SUBMITTED", submittedAt: at("2026-10-11T14:00:00.000Z") }),
]

const ROUTE_CHANGES: Row[] = [
  { id: "rc1", organizationId: ORG, requestedByAgentId: "a1", status: "SUBMITTED", submittedAt: at("2026-10-09T10:00:00.000Z"), payload: {}, route: { agentId: "a1" } },
  // Asked by the office about the southern agent's route: in that agent's scope through the route.
  { id: "rc2", organizationId: ORG, requestedByAgentId: "m1", status: "SUBMITTED", submittedAt: at("2026-10-10T10:00:00.000Z"), payload: {}, route: { agentId: "a2" } },
  { id: "rc3", organizationId: ORG, requestedByAgentId: "a1", status: "REJECTED", submittedAt: at("2026-10-02T10:00:00.000Z"), payload: {}, route: { agentId: "a1" } },
]

const ROUTES: Row[] = [
  // A draft with stops for Monday: somebody is waiting for it to be published.
  { id: "d1", organizationId: ORG, agentId: "a1", status: "DRAFT", date: day("2026-10-12"), deletedAt: null, publishedVersion: null, points: [{ deletedAt: null }] },
  // Last week's draft is history, an empty one was abandoned, a deleted one is gone.
  { id: "d2", organizationId: ORG, agentId: "a1", status: "DRAFT", date: day("2026-10-06"), deletedAt: null, publishedVersion: null, points: [{ deletedAt: null }] },
  { id: "d3", organizationId: ORG, agentId: "a2", status: "DRAFT", date: day("2026-10-13"), deletedAt: null, publishedVersion: null, points: [] },
  { id: "d4", organizationId: ORG, agentId: "a2", status: "DRAFT", date: day("2026-10-14"), deletedAt: at("2026-10-10T00:00:00.000Z"), publishedVersion: null, points: [{ deletedAt: null }] },
  // The southern agent has a published route for Monday.
  { id: "p1", organizationId: ORG, agentId: "a2", status: "PLANNED", date: day("2026-10-12"), deletedAt: null, publishedVersion: 1, points: [{ deletedAt: null }] },
]

const ALERTS: Row[] = [
  ...Array.from({ length: 6 }, (_unused, index): Row => ({
    id: `al-${index}`, organizationId: ORG, agentId: "a1", isResolved: false, type: index === 0 ? "LONG_BREAK" : "OUT_OF_ZONE",
    createdAt: at(`2026-10-08T${String(9 + index).padStart(2, "0")}:00:00.000Z`),
  })),
  // 23:30 on the 10th in Baku: an earlier day. 00:30 on the 11th in Baku: today, which the agent's row already shows.
  { id: "al-late", organizationId: ORG, agentId: "a2", isResolved: false, type: "OUT_OF_ZONE", createdAt: at("2026-10-10T19:30:00.000Z") },
  { id: "al-today", organizationId: ORG, agentId: "a2", isResolved: false, type: "OUT_OF_ZONE", createdAt: at("2026-10-10T20:30:00.000Z") },
  { id: "al-closed", organizationId: ORG, agentId: "a2", isResolved: true, type: "OUT_OF_ZONE", createdAt: at("2026-10-01T09:00:00.000Z") },
]

const PHOTOS: Row[] = [
  // Two photos of the northern agent's visits nobody has looked at, one already approved.
  { id: "ph1", organizationId: ORG, agentId: "a1", status: "PENDING", createdAt: at("2026-10-07T18:20:00.000Z"), visit: { agentId: "a1" } },
  { id: "ph2", organizationId: ORG, agentId: "a1", status: "PENDING", createdAt: at("2026-10-08T12:02:00.000Z"), visit: { agentId: "a1" } },
  { id: "ph3", organizationId: ORG, agentId: "a2", status: "APPROVED", createdAt: at("2026-10-08T12:02:00.000Z"), visit: { agentId: "a2" } },
  // Taken by the office manager on the southern agent's visit: in that agent's scope through the visit.
  { id: "ph4", organizationId: ORG, agentId: "m1", status: "PENDING", createdAt: at("2026-10-09T09:00:00.000Z"), visit: { agentId: "a2" } },
  { id: "ph5", organizationId: "org-other", agentId: "x1", status: "PENDING", createdAt: at("2026-10-09T09:00:00.000Z"), visit: null },
]

type Actor = { agentId: string | null; role: "ADMIN" | "MANAGER" | "SUPERVISOR" | "AGENT"; scopedAgentIds: string[] | null }
const ADMIN: Actor = { agentId: "adm", role: "ADMIN", scopedAgentIds: null }
const MANAGER_NORTH: Actor = { agentId: "m1", role: "MANAGER", scopedAgentIds: ["a1", "a3"] }
const SUPERVISOR_SOUTH: Actor = { agentId: "s1", role: "SUPERVISOR", scopedAgentIds: ["a2"] }
const FIELD_AGENT: Actor = { agentId: "a1", role: "AGENT", scopedAgentIds: ["a1"] }

function signIn(actor: Actor) {
  // A user id per actor: the read-side scope is memoized by reader.
  vi.mocked(requireAuth).mockResolvedValue({ orgId: ORG, userId: `user-${actor.agentId}`, role: actor.role === "ADMIN" ? "admin" : "user", email: "u@example.com", name: "U" } as never)
  vi.mocked(resolveMtmRouteActor).mockResolvedValue(actor as never)
}

async function attention(query = "") {
  const response = await GET(new NextRequest(`http://localhost:3000/api/v1/mtm/week/attention${query}`))
  const json = await response.json()
  return {
    status: response.status,
    data: json.data as {
      today: string
      timezone: string
      todayIsWorkingDay: boolean
      week: Array<{ date: string; isWorkingDay: boolean }>
      items: Array<{ kind: string; count: number; date: string | null; people: string[]; peopleCount: number; types: Array<{ type: string; count: number }>; since?: string }>
      nextWorkday: { date: string; agents: number; withoutRoute: number; agentId: string | null; people: string[] } | null
    },
  }
}

async function listLength(handler: (req: NextRequest) => Promise<Response> | Response, path: string, key: string): Promise<number> {
  const response = await handler(new NextRequest(`http://localhost:3000${path}`))
  if (response.status === 403) return 0
  expect(response.status).toBe(200)
  const json = await response.json()
  return (json.data[key] as unknown[]).length
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(NOW)
  resetMtmFieldScopeMemo()
  vi.mocked(getMobileAuth).mockReturnValue(null)
  vi.mocked(resolveMobileAuth).mockResolvedValue(null)
  vi.mocked(checkRateLimit).mockReturnValue(true)
  vi.mocked(prisma.mtmSetting.findMany).mockResolvedValue([])
  serve(prisma.mtmAgent, AGENTS)
  serve(prisma.mtmContactCreateRequest, CONTACT_REQUESTS)
  serve(prisma.mtmCustomerCreateRequest, CUSTOMER_REQUESTS)
  serve(prisma.mtmRouteChangeRequest, ROUTE_CHANGES)
  // Nothing of «Клиент здесь» waits on the owner's Sunday; its own tests bring the rows.
  serve(prisma.mtmCustomerLocationRequest, [])
  serve(prisma.mtmRoute, ROUTES)
  serve(prisma.mtmAlert, ALERTS)
  serve(prisma.mtmPhoto, PHOTOS)
  serve(prisma.mtmWorkCalendarDay, [])
})

afterEach(() => {
  vi.useRealTimers()
})

describe("GET /api/v1/mtm/week/attention", () => {
  it.each([
    ["an administrator", ADMIN],
    ["a manager of the northern agents", MANAGER_NORTH],
    ["a supervisor of the southern agent", SUPERVISOR_SOUTH],
  ])("shows %s the same number of rows each queue returns to them", async (_label, actor) => {
    signIn(actor)
    const { status, data } = await attention()
    expect(status).toBe(200)
    const shown = Object.fromEntries(data.items.map((item) => [item.kind, item.count]))

    const queued = {
      contactCreateRequests: await listLength(contactRequestQueue, "/api/v1/mtm/contact-create-requests", "requests"),
      customerCreateRequests: await listLength(customerRequestQueue, "/api/v1/mtm/customer-create-requests", "requests"),
      routeChangeRequests: await listLength(routeChangeQueue, "/api/v1/mtm/route-change-requests", "requests"),
    }
    for (const [kind, count] of Object.entries(queued)) {
      // A queue with nothing in it is not a row at all.
      expect(shown[kind] ?? 0, kind).toBe(count)
    }

    // The gallery, as the same person reads it with the «not reviewed» filter.
    const gallery = await photoList(new NextRequest("http://localhost:3000/api/v1/mtm/photos?status=PENDING&limit=200"))
    expect(gallery.status).toBe(200)
    expect(shown.photosPendingReview ?? 0).toBe((await gallery.json()).data.total)

    // The alert list, as the same person reads it: unresolved, raised before today.
    const response = await alertList(new NextRequest("http://localhost:3000/api/v1/mtm/alerts?resolved=false&limit=200"))
    const alerts = (await response.json()).data.alerts as Array<{ createdAt: string }>
    expect(shown.olderAlerts ?? 0).toBe(alerts.filter((alert) => new Date(alert.createdAt) < TODAY_START).length)
  })

  it("counts what the owner's screen hid on 11 October: the request of the 8th and the alerts of earlier days", async () => {
    signIn(ADMIN)
    const { data } = await attention()
    expect(data.timezone).toBe("Asia/Baku")
    expect(data.today).toBe("2026-10-11")
    expect(data.items.map(({ kind, count, date }) => ({ kind, count, date }))).toEqual([
      // Sent at 02:01 on the 8th in Baku — the 7th in UTC.
      { kind: "contactCreateRequests", count: 2, date: "2026-10-08" },
      // Never submitted: it has waited since it was written.
      { kind: "customerCreateRequests", count: 1, date: "2026-10-06" },
      { kind: "routeChangeRequests", count: 2, date: "2026-10-09" },
      { kind: "routesAwaitingPublish", count: 1, date: "2026-10-12" },
      // Six of the 8th and one of 23:30 on the 10th; the one of 00:30 today is not «earlier».
      { kind: "olderAlerts", count: 7, date: "2026-10-10" },
      // Three unreviewed photos, the oldest taken at 22:20 on the 7th in Baku.
      { kind: "photosPendingReview", count: 3, date: "2026-10-07" },
    ])
  })

  it("says whose rows they are and which alerts, as the lists themselves do", async () => {
    signIn(ADMIN)
    const items = Object.fromEntries((await attention()).data.items.map((item) => [item.kind, item]))
    expect(items.contactCreateRequests).toMatchObject({ people: ["Agent North", "Agent South"], peopleCount: 2 })
    expect(items.customerCreateRequests).toMatchObject({ people: ["Agent South"], peopleCount: 1 })
    // One by the northern agent, one by the office manager.
    expect(items.routeChangeRequests).toMatchObject({ people: ["Agent North", "Office Manager"], peopleCount: 2 })
    expect(items.routesAwaitingPublish).toMatchObject({ people: ["Agent North"], peopleCount: 1 })
    // The most frequent type first; a row never names more than three.
    expect(items.olderAlerts.types).toEqual([{ type: "OUT_OF_ZONE", count: 6 }, { type: "LONG_BREAK", count: 1 }])
    expect(items.olderAlerts.people).toEqual([])
    expect(items.photosPendingReview).toMatchObject({ people: [], peopleCount: 0, types: [] })

    // A manager is not told the name of an agent outside their scope.
    signIn(MANAGER_NORTH)
    const own = JSON.stringify((await attention()).data)
    expect(own).toContain("Agent North")
    expect(own).not.toContain("Agent South")
  })

  it("tells every reader whether the organization works today and on which days of the week", async () => {
    signIn(ADMIN)
    const sunday = (await attention()).data
    expect(sunday.todayIsWorkingDay).toBe(false)
    expect(sunday.week).toEqual([
      { date: "2026-10-05", isWorkingDay: true },
      { date: "2026-10-06", isWorkingDay: true },
      { date: "2026-10-07", isWorkingDay: true },
      { date: "2026-10-08", isWorkingDay: true },
      { date: "2026-10-09", isWorkingDay: true },
      { date: "2026-10-10", isWorkingDay: false },
      { date: "2026-10-11", isWorkingDay: false },
    ])

    // A Saturday the organization declared working, and a holiday on Wednesday.
    serve(prisma.mtmWorkCalendarDay, [
      { id: "w1", organizationId: ORG, deletedAt: null, date: day("2026-10-10"), kind: "EXCEPTION_WORKDAY", name: null, teamId: null, agentId: null, movedToDate: null, routePlanningAllowed: null },
      { id: "w2", organizationId: ORG, deletedAt: null, date: day("2026-10-07"), kind: "PUBLIC_HOLIDAY", name: null, teamId: null, agentId: null, movedToDate: null, routePlanningAllowed: null },
    ])
    const changed = (await attention()).data.week
    expect(changed.find((entry) => entry.date === "2026-10-10")?.isWorkingDay).toBe(true)
    expect(changed.find((entry) => entry.date === "2026-10-07")?.isWorkingDay).toBe(false)

    // The calendar is not a secret: an agent's own Panel knows the day off too.
    signIn(FIELD_AGENT)
    const agent = (await attention()).data
    expect(agent.todayIsWorkingDay).toBe(false)
    expect(agent.week).toHaveLength(7)
  })

  it("narrows every row to the reader's own agents", async () => {
    signIn(MANAGER_NORTH)
    const brief = async () => (await attention()).data.items.map(({ kind, count, date }) => ({ kind, count, date }))
    expect(await brief()).toEqual([
      { kind: "contactCreateRequests", count: 1, date: "2026-10-08" },
      { kind: "routeChangeRequests", count: 1, date: "2026-10-09" },
      { kind: "routesAwaitingPublish", count: 1, date: "2026-10-12" },
      { kind: "olderAlerts", count: 6, date: "2026-10-08" },
      { kind: "photosPendingReview", count: 2, date: "2026-10-07" },
    ])

    signIn(SUPERVISOR_SOUTH)
    expect(await brief()).toEqual([
      { kind: "contactCreateRequests", count: 1, date: "2026-10-09" },
      { kind: "customerCreateRequests", count: 1, date: "2026-10-06" },
      // Not theirs by author, theirs by the route it is about.
      { kind: "routeChangeRequests", count: 1, date: "2026-10-10" },
      { kind: "olderAlerts", count: 1, date: "2026-10-10" },
      // Not taken by their agent, taken on their agent's visit.
      { kind: "photosPendingReview", count: 1, date: "2026-10-09" },
    ])
  })

  it("follows the Panel's team and region filters", async () => {
    signIn(ADMIN)
    const south = (await attention("?teamId=t2")).data
    expect(south.items.map((item) => [item.kind, item.count])).toEqual([
      ["contactCreateRequests", 1],
      ["customerCreateRequests", 1],
      ["routeChangeRequests", 1],
      ["olderAlerts", 1],
      ["photosPendingReview", 1],
    ])
    expect(south.nextWorkday).toEqual({ date: "2026-10-12", agents: 1, withoutRoute: 0, agentId: null, people: [] })

    const north = (await attention("?regionId=r1")).data
    // The deactivated agent's team still counts for requests, never for «needs a route».
    expect(north.items.map((item) => [item.kind, item.count])).toEqual([
      ["contactCreateRequests", 1],
      ["routeChangeRequests", 1],
      ["routesAwaitingPublish", 1],
      ["olderAlerts", 6],
      ["photosPendingReview", 2],
    ])
    expect(north.nextWorkday).toEqual({ date: "2026-10-12", agents: 1, withoutRoute: 1, agentId: "a1", people: ["Agent North"] })
  })

  it("names Monday as the next working day and who has no published route for it", async () => {
    signIn(ADMIN)
    // Two active field agents; the office cards and the deactivated one are not expected to hold a route.
    // A draft is not a route anyone can work by: the northern agent still counts as without one.
    expect((await attention()).data.nextWorkday).toEqual({ date: "2026-10-12", agents: 2, withoutRoute: 1, agentId: "a1", people: ["Agent North"] })
  })

  it("moves past a holiday and leaves out an agent on a day off", async () => {
    signIn(ADMIN)
    serve(prisma.mtmWorkCalendarDay, [
      { id: "h1", organizationId: ORG, deletedAt: null, date: day("2026-10-12"), kind: "PUBLIC_HOLIDAY", name: null, teamId: null, agentId: null, movedToDate: null, routePlanningAllowed: null },
      { id: "h2", organizationId: ORG, deletedAt: null, date: day("2026-10-13"), kind: "MOVED_DAY_OFF", name: null, teamId: null, agentId: "a1", movedToDate: null, routePlanningAllowed: null },
    ])
    // Tuesday the 13th: the northern agent is off, the southern one has no route for that day.
    expect((await attention()).data.nextWorkday).toEqual({ date: "2026-10-13", agents: 1, withoutRoute: 1, agentId: "a2", people: ["Agent South"] })
  })

  describe("«Клиент здесь»: an agent's request to move a customer's pin", () => {
    beforeEach(() => {
      serve(prisma.mtmCustomerLocationRequest, LOCATION_REQUESTS)
    })

    it.each([
      ["an administrator", ADMIN, 2],
      ["a manager of the northern agents", MANAGER_NORTH, 1],
      ["a supervisor of the southern agent", SUPERVISOR_SOUTH, 1],
    ])("shows %s the number of requests the queue returns to them", async (_label, actor, expected) => {
      signIn(actor)
      const shown = (await attention()).data.items.find((item) => item.kind === "customerLocationRequests")
      const queued = await listLength(locationRequestQueue, "/api/v1/mtm/customer-location-requests", "requests")
      expect(queued).toBe(expected)
      expect(shown?.count ?? 0).toBe(queued)
    })

    it("stands first, before every other row: the agent may still be at the door", async () => {
      signIn(ADMIN)
      const { data } = await attention()
      expect(data.items[0]).toMatchObject({
        kind: "customerLocationRequests",
        count: 2,
        // The older of the two waits since the 10th…
        date: "2026-10-10",
        since: "2026-10-10T09:00:00.000Z",
        people: ["Agent North", "Agent South"],
        peopleCount: 2,
      })
      // …and nothing that was there before has moved or gone.
      expect(data.items.slice(1).map((item) => item.kind)).toEqual([
        "contactCreateRequests", "customerCreateRequests", "routeChangeRequests", "routesAwaitingPublish", "olderAlerts", "photosPendingReview",
      ])
    })

    it("names the hour of a request sent today, to the reader whose agent sent it", async () => {
      signIn(MANAGER_NORTH)
      const { data } = await attention()
      expect(data.items[0]).toMatchObject({
        kind: "customerLocationRequests",
        count: 1,
        date: "2026-10-11",
        since: "2026-10-11T14:40:00.000Z",
        people: ["Agent North"],
      })
      expect(JSON.stringify(data)).not.toContain("Agent South")
    })

    it("is not a row once every request is decided, and says nothing of where the customer is", async () => {
      signIn(ADMIN)
      serve(prisma.mtmCustomerLocationRequest, LOCATION_REQUESTS.filter((row) => row.status !== "SUBMITTED" || row.organizationId !== ORG))
      const { data } = await attention()
      expect(data.items.some((item) => item.kind === "customerLocationRequests")).toBe(false)

      serve(prisma.mtmCustomerLocationRequest, LOCATION_REQUESTS)
      const body = JSON.stringify((await attention()).data)
      for (const leak of ["Klinika", "40.41", "49.87", "proposedLatitude"]) expect(body).not.toContain(leak)
    })
  })

  it("gives a field agent an empty answer and reads no queue for them", async () => {
    signIn(FIELD_AGENT)
    const { status, data } = await attention()
    expect(status).toBe(200)
    expect(data.items).toEqual([])
    expect(data.nextWorkday).toBeNull()
    for (const model of [prisma.mtmCustomerLocationRequest, prisma.mtmContactCreateRequest, prisma.mtmCustomerCreateRequest, prisma.mtmRouteChangeRequest, prisma.mtmRoute, prisma.mtmAlert]) {
      expect(model.groupBy).not.toHaveBeenCalled()
    }
    expect(prisma.mtmPhoto.aggregate).not.toHaveBeenCalled()
    expect(prisma.mtmAgent.findMany).not.toHaveBeenCalled()
  })

  it("refuses a reader without an MTM card, a manager without a scope, and a burst of refreshes", async () => {
    signIn(ADMIN)
    vi.mocked(resolveMtmRouteActor).mockResolvedValue(null as never)
    expect((await attention()).status).toBe(403)

    signIn({ agentId: "m9", role: "MANAGER", scopedAgentIds: null })
    expect((await attention()).status).toBe(403)

    signIn(ADMIN)
    vi.mocked(checkRateLimit).mockReturnValue(false)
    const limited = await GET(new NextRequest("http://localhost:3000/api/v1/mtm/week/attention"))
    expect(limited.status).toBe(429)
    expect(limited.headers.get("Retry-After")).toBe("15")
  })

  it("sends counts, days and agents' names only: no customer names, no request text", async () => {
    signIn(ADMIN)
    const body = JSON.stringify((await attention()).data)
    for (const leak of ["Aptek", "Klinika", "latitude", "payload"]) expect(body).not.toContain(leak)
  })
})


describe("attendance Panel attention", () => {
  beforeEach(() => {
    signIn(ADMIN)
    vi.mocked(requireAuth).mockResolvedValue({ orgId: ORG, userId: "user-adm", role: "admin", principalType: "session", email: "fixture@example.test", name: "Fixture" } as never)
    // Nonempty JSON is enough here: the Panel deliberately never reads its contents.
    const make = (id: string, agentId: string, status = "PENDING", owner?: string): Row => ({
      id, organizationId: ORG, agentId, status, attendanceDetails: { fixture: true }, submittedAt: NOW,
      agent: { ...AGENTS.find(agent => agent.id === agentId), userId: owner ?? null },
    })
    serve(prisma.mtmHrmRequest, [make("r1", "a1"), make("r2", "a2"), make("r3", "a3"), make("r4", "a1", "APPROVED"), make("r5", "a1", "PENDING", "user-adm"), make("r6", "adm"), { ...make("r7", "x1"), organizationId: "org-other" }])
  })
  it("omits the new item and performs no request query while the feature is off", async () => {
    const { status, data } = await attention()
    expect(status).toBe(200)
    expect(data.items.some(item => item.kind === "attendanceRequests")).toBe(false)
    expect(prisma.mtmHrmRequest.groupBy).not.toHaveBeenCalled()
  })
  it("counts only active, other-employee pending requests and narrows by team", async () => {
    vi.mocked(prisma.mtmSetting.findMany).mockResolvedValue([{ key: "attendanceEnabled", value: true }] as never)
    expect((await attention()).data.items.find(item => item.kind === "attendanceRequests")).toMatchObject({ count: 2 })
    expect((await attention("?teamId=t1")).data.items.find(item => item.kind === "attendanceRequests")).toMatchObject({ count: 1 })
  })
})
