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
import { GET as alertList } from "@/app/api/v1/mtm/alerts/route"
import { requireAuth } from "@/lib/api-auth"
import { getMobileAuth, resolveMobileAuth } from "@/lib/mobile-auth"
import { resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import { resetMtmFieldScopeMemo } from "@/lib/mtm/field-access"
import { checkRateLimit } from "@/lib/rate-limit"
import { prisma } from "@/lib/prisma"

const ORG = "org-zeytun"
const NOW = new Date("2026-10-11T14:54:00.000Z") // 18:54 in Baku, a Sunday
const TODAY_START = new Date("2026-10-10T20:00:00.000Z") // midnight in Baku

type Row = Record<string, unknown>

/** The subset of Prisma's `where` these handlers use, evaluated over plain rows. */
function holds(value: unknown, condition: unknown): boolean {
  if (condition === null) return value === null || value === undefined
  if (condition instanceof Date) return value instanceof Date && value.getTime() === condition.getTime()
  if (typeof condition !== "object") return value === condition
  const rule = condition as Record<string, unknown>
  if ("in" in rule) return (rule.in as unknown[]).includes(value)
  if ("not" in rule) return !holds(value, rule.not)
  if ("some" in rule) return Array.isArray(value) && value.some((entry) => matches(entry as Row, rule.some as Row))
  if ("is" in rule) return value !== null && value !== undefined && matches(value as Row, rule.is as Row)
  const comparisons = ["gte", "gt", "lte", "lt"].filter((key) => key in rule)
  if (comparisons.length > 0) {
    if (!(value instanceof Date) && typeof value !== "number") return false
    const left = Number(value)
    return comparisons.every((key) => {
      const right = Number(rule[key])
      return key === "gte" ? left >= right : key === "gt" ? left > right : key === "lte" ? left <= right : left < right
    })
  }
  return value !== null && value !== undefined && matches(value as Row, rule)
}

function matches(row: Row, where: Row | undefined): boolean {
  if (!where) return true
  return Object.entries(where).every(([key, condition]) => {
    if (condition === undefined) return true
    if (key === "OR") return (condition as Row[]).some((branch) => matches(row, branch))
    if (key === "AND") return (condition as Row[]).every((branch) => matches(row, branch))
    return holds(row[key], condition)
  })
}

type Query = { where?: Row; distinct?: string[]; take?: number; _min?: Record<string, boolean>; _max?: Record<string, boolean> }

function extreme(rows: Row[], fields: Record<string, boolean> | undefined, pick: (left: number, right: number) => boolean) {
  return Object.fromEntries(Object.keys(fields ?? {}).map((field) => {
    const values = rows.map((row) => row[field]).filter((value): value is Date => value instanceof Date)
    return [field, values.reduce<Date | null>((best, value) => (!best || pick(value.getTime(), best.getTime()) ? value : best), null)]
  }))
}

function serve(model: { findMany: unknown; aggregate: unknown; count: unknown }, rows: Row[]) {
  vi.mocked(model.findMany as (query: Query) => Promise<unknown>).mockImplementation(async (query: Query = {}) => {
    let found = rows.filter((row) => matches(row, query.where))
    if (query.distinct) {
      const seen = new Set<string>()
      found = found.filter((row) => {
        const key = query.distinct!.map((field) => String(row[field])).join("|")
        return seen.has(key) ? false : (seen.add(key), true)
      })
    }
    return query.take ? found.slice(0, query.take) : found
  })
  vi.mocked(model.aggregate as (query: Query) => Promise<unknown>).mockImplementation(async (query: Query = {}) => {
    const found = rows.filter((row) => matches(row, query.where))
    return {
      _count: { _all: found.length },
      _min: extreme(found, query._min, (left, right) => left < right),
      _max: extreme(found, query._max, (left, right) => left > right),
    }
  })
  vi.mocked(model.count as (query: Query) => Promise<unknown>).mockImplementation(async (query: Query = {}) => rows.filter((row) => matches(row, query.where)).length)
}

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
  return { status: response.status, data: json.data as { today: string; timezone: string; items: Array<{ kind: string; count: number; date: string | null }>; nextWorkday: { date: string; agents: number; withoutRoute: number; agentId: string | null } | null } }
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
  serve(prisma.mtmRoute, ROUTES)
  serve(prisma.mtmAlert, ALERTS)
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
    expect(data.items).toEqual([
      // Sent at 02:01 on the 8th in Baku — the 7th in UTC.
      { kind: "contactCreateRequests", count: 2, date: "2026-10-08" },
      // Never submitted: it has waited since it was written.
      { kind: "customerCreateRequests", count: 1, date: "2026-10-06" },
      { kind: "routeChangeRequests", count: 2, date: "2026-10-09" },
      { kind: "routesAwaitingPublish", count: 1, date: "2026-10-12" },
      // Six of the 8th and one of 23:30 on the 10th; the one of 00:30 today is not «earlier».
      { kind: "olderAlerts", count: 7, date: "2026-10-10" },
    ])
  })

  it("narrows every row to the reader's own agents", async () => {
    signIn(MANAGER_NORTH)
    expect((await attention()).data.items).toEqual([
      { kind: "contactCreateRequests", count: 1, date: "2026-10-08" },
      { kind: "routeChangeRequests", count: 1, date: "2026-10-09" },
      { kind: "routesAwaitingPublish", count: 1, date: "2026-10-12" },
      { kind: "olderAlerts", count: 6, date: "2026-10-08" },
    ])

    signIn(SUPERVISOR_SOUTH)
    expect((await attention()).data.items).toEqual([
      { kind: "contactCreateRequests", count: 1, date: "2026-10-09" },
      { kind: "customerCreateRequests", count: 1, date: "2026-10-06" },
      // Not theirs by author, theirs by the route it is about.
      { kind: "routeChangeRequests", count: 1, date: "2026-10-10" },
      { kind: "olderAlerts", count: 1, date: "2026-10-10" },
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
    ])
    expect(south.nextWorkday).toEqual({ date: "2026-10-12", agents: 1, withoutRoute: 0, agentId: null })

    const north = (await attention("?regionId=r1")).data
    // The deactivated agent's team still counts for requests, never for «needs a route».
    expect(north.items.map((item) => [item.kind, item.count])).toEqual([
      ["contactCreateRequests", 1],
      ["routeChangeRequests", 1],
      ["routesAwaitingPublish", 1],
      ["olderAlerts", 6],
    ])
    expect(north.nextWorkday).toEqual({ date: "2026-10-12", agents: 1, withoutRoute: 1, agentId: "a1" })
  })

  it("names Monday as the next working day and who has no published route for it", async () => {
    signIn(ADMIN)
    // Two active field agents; the office cards and the deactivated one are not expected to hold a route.
    // A draft is not a route anyone can work by: the northern agent still counts as without one.
    expect((await attention()).data.nextWorkday).toEqual({ date: "2026-10-12", agents: 2, withoutRoute: 1, agentId: "a1" })
  })

  it("moves past a holiday and leaves out an agent on a day off", async () => {
    signIn(ADMIN)
    serve(prisma.mtmWorkCalendarDay, [
      { id: "h1", organizationId: ORG, deletedAt: null, date: day("2026-10-12"), kind: "PUBLIC_HOLIDAY", name: null, teamId: null, agentId: null, movedToDate: null, routePlanningAllowed: null },
      { id: "h2", organizationId: ORG, deletedAt: null, date: day("2026-10-13"), kind: "MOVED_DAY_OFF", name: null, teamId: null, agentId: "a1", movedToDate: null, routePlanningAllowed: null },
    ])
    // Tuesday the 13th: the northern agent is off, the southern one has no route for that day.
    expect((await attention()).data.nextWorkday).toEqual({ date: "2026-10-13", agents: 1, withoutRoute: 1, agentId: "a2" })
  })

  it("gives a field agent an empty answer and reads no queue for them", async () => {
    signIn(FIELD_AGENT)
    const { status, data } = await attention()
    expect(status).toBe(200)
    expect(data.items).toEqual([])
    expect(data.nextWorkday).toBeNull()
    for (const model of [prisma.mtmContactCreateRequest, prisma.mtmCustomerCreateRequest, prisma.mtmRouteChangeRequest, prisma.mtmRoute, prisma.mtmAlert]) {
      expect(model.aggregate).not.toHaveBeenCalled()
    }
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

  it("sends counts and days only: no names, no request text", async () => {
    signIn(ADMIN)
    const body = JSON.stringify((await attention()).data)
    for (const leak of ["Agent North", "Agent South", "Aptek", "Klinika", "latitude"]) expect(body).not.toContain(leak)
  })
})
