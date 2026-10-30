/**
 * GET /api/v1/public/location-share/[token] — «Ссылка на местоположение», the
 * half that somebody with no account reaches.
 *
 * Whoever holds a link is told where one named person is right now. So what
 * is pinned here is everything that decides whether he is told, and how
 * much: that a link which does not work says nothing about why; that the
 * answer holds a point only while the employee is on shift and his phone has
 * just reported; that the answer is exactly the fields it was designed to
 * be; and that one organization's link can read nothing of another's.
 *
 * The real route, the real settings reader, the real entitlement rule, the
 * real limiter and the real RLS context module. The database is stood in for
 * by small tables that answer the route's own statements: the filters are
 * applied to the rows, not merely looked at — a statement that forgot the
 * organization, the employee, «since the shift began» or «exact enough»
 * finds the rows it must not. Every statement the route runs is recorded
 * together with the RLS context it ran in, at the moment it ran; one this
 * file does not know is refused, so a new read cannot slip in unseen.
 *
 * What this cannot show is Postgres itself — that the policy really lets the
 * bypass find a link and holds everything else to its organization. That is
 * asked of a real database in mtm-contact-categories-postgres.test.ts
 * («links to an employee's position»).
 */
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/prisma", async () => {
  const { makeMtmPrismaMock } = await import("./mocks/mtm-prisma")
  return { prisma: makeMtmPrismaMock() }
})

// The real limiter, watched: which key it was asked about is part of what is pinned.
vi.mock("@/lib/rate-limit", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/rate-limit")>()
  return { ...real, checkRateLimit: vi.fn(real.checkRateLimit) }
})

import * as route from "@/app/api/v1/public/location-share/[token]/route"
import { prisma } from "@/lib/prisma"
import { checkRateLimit, resetRateLimit } from "@/lib/rate-limit"
import { getRlsContext, type RlsContext } from "@/lib/rls-context"

const { GET } = route

const ORG = "org-1"
const OTHER_ORG = "org-2"
const AGENT = "agent-1"
// Noon in Baku, the organization's zone as it ships: its midnight is 20:00Z.
const NOW = new Date("2026-10-10T08:00:00.000Z")
const TODAY = new Date("2026-10-10T00:00:00.000Z")
const YESTERDAY = new Date("2026-10-09T00:00:00.000Z")
const MIDNIGHT = new Date("2026-10-10T20:00:00.000Z")
const SECOND = 1000
const MINUTE = 60 * SECOND
const before = (ms: number) => new Date(NOW.getTime() - ms)
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex")

const TOKEN = "a".repeat(64)
const THEIR_TOKEN = "b".repeat(64)
const IP = "203.0.113.7"

// ─── The tables ─────────────────────────────────────────────────────────────

interface LinkRow {
  id: string
  organizationId: string
  agentId: string
  tokenHash: string
  createdBy: string | null
  createdAt: Date
  expiresAt: Date
  revokedAt: Date | null
  revokedBy: string | null
  viewCount: number
  lastViewedAt: Date | null
}
interface OrganizationRow {
  id: string
  name: string
  isActive: boolean
  plan: string
  addons: string[]
  features: unknown
  modules: unknown
  settings: unknown
}
interface AgentRow {
  fieldDeletedAt?: Date | null
  id: string
  organizationId: string
  name: string
  status: string
  phone: string
  email: string
  mapColor: string
  tags: string[]
}
interface WorkdayRow {
  id: string
  organizationId: string
  agentId: string
  workDate: Date
  status: string
  startedAt: Date
  pausedAt: Date | null
  completedAt: Date | null
}
/** A row of the shift's journal: when he paused, resumed, finished. */
interface ShiftEventRow {
  organizationId: string
  agentId: string
  workdayId: string
  type: string
  occurredAt: Date
  appliedAt: Date | null
}
interface PointRow {
  id: string
  organizationId: string
  agentId: string
  latitude: number
  longitude: number
  accuracy: number | null
  speed: number
  heading: number
  battery: number
  isMoving: boolean
  recordedAt: Date
}
type Select = Record<string, unknown>
type Range = { gte?: number | Date; lte?: number | Date; gt?: number | Date }

let links: LinkRow[]
let organizations: OrganizationRow[]
let agents: AgentRow[]
let workdays: WorkdayRow[]
let shiftEvents: ShiftEventRow[]
let points: PointRow[]
let settings: Record<string, Record<string, unknown>>

/** A filter a table does not understand must not pass for «everything». */
function knownOnly(where: Record<string, unknown>, known: string[], table: string) {
  for (const key of Object.keys(where)) if (!known.includes(key)) throw new Error(`${table} was asked by an unknown filter: ${key}`)
}
const ms = (value: number | Date) => (value instanceof Date ? value.getTime() : value)
function within(value: number | Date | null, range: Range | undefined): boolean {
  if (range === undefined) return true
  if (value === null) return false
  knownOnly(range as Record<string, unknown>, ["gte", "lte", "gt"], "a range")
  if (range.gte !== undefined && !(ms(value) >= ms(range.gte))) return false
  if (range.lte !== undefined && !(ms(value) <= ms(range.lte))) return false
  if (range.gt !== undefined && !(ms(value) > ms(range.gt))) return false
  return true
}
const picked = (row: object, select: Select) =>
  Object.fromEntries(Object.keys(select).map((key) => [key, (row as Record<string, unknown>)[key]]))

/** Every statement the route ran, with the RLS context it ran in — taken as it ran — and what it was handed back. */
const seen: Array<{ call: string; ctx: RlsContext | undefined; handed?: unknown }> = []
const calls = () => seen.map((entry) => entry.call)
const contextsOf = (call: string) => seen.filter((entry) => entry.call === call).map((entry) => entry.ctx)
const handedBy = (call: string) => seen.filter((entry) => entry.call === call).map((entry) => entry.handed)

type Statement = (args: never) => unknown
let answers: Record<string, Statement>

const LOOKUP = "mtmLocationShareLink.findUnique"
const STAMP = "mtmLocationShareLink.updateMany"
const SETTINGS = "mtmSetting.findMany"
const EMPLOYEE = "mtmAgent.findFirst"
const SHIFT = "mtmAgentWorkday.findMany"
const BREAKS = "mtmAgentWorkdayEvent.findMany"
const POSITION = "mtmAgentLocation.findFirst"

function theTables(): Record<string, Statement> {
  return {
    [LOOKUP]: ((args: { where: Record<string, unknown>; select: Select }) => {
      knownOnly(args.where, ["tokenHash"], "the link lookup")
      const row = links.find((kept) => kept.tokenHash === args.where.tokenHash)
      return row ? picked(row, args.select) : null
    }) as Statement,

    [STAMP]: ((args: { where: Record<string, unknown>; data: { viewCount?: { increment: number }; lastViewedAt?: Date } }) => {
      const { where } = args
      knownOnly(where, ["id", "organizationId", "revokedAt", "expiresAt", "OR"], "the view stamp")
      const either = where.OR as Array<{ lastViewedAt: null | Range }> | undefined
      const rows = links.filter((kept) =>
        (where.id === undefined || kept.id === where.id)
        && (where.organizationId === undefined || kept.organizationId === where.organizationId)
        && (where.revokedAt !== null || kept.revokedAt === null)
        && within(kept.expiresAt, where.expiresAt as Range | undefined)
        && (either === undefined || either.some((one) =>
          one.lastViewedAt === null ? kept.lastViewedAt === null : within(kept.lastViewedAt, one.lastViewedAt))))
      for (const row of rows) {
        row.viewCount += args.data.viewCount?.increment ?? 0
        if (args.data.lastViewedAt) row.lastViewedAt = args.data.lastViewedAt
      }
      return { count: rows.length }
    }) as Statement,

    [SETTINGS]: ((args: { where: { organizationId: string } }) =>
      Object.entries(settings[args.where.organizationId] ?? {}).map(([key, value]) => ({ key, value }))) as Statement,

    [EMPLOYEE]: ((args: { where: Record<string, unknown>; select: Select }) => {
      knownOnly(args.where, ["id", "organizationId", "status", "fieldDeletedAt"], "the employee read")
      const row = agents.find((agent) =>
        agent.id === args.where.id && agent.organizationId === args.where.organizationId
        && (args.where.status === undefined || agent.status === args.where.status)
        && (args.where.fieldDeletedAt !== null || !agent.fieldDeletedAt))
      if (!row) return null
      const { organization: wanted, ...own } = args.select as { organization?: { select: Select } }
      const organization = organizations.find((one) => one.id === row.organizationId)
      return { ...picked(row, own), ...(wanted && organization ? { organization: picked(organization, wanted.select) } : {}) }
    }) as Statement,

    [SHIFT]: ((args: { where: Record<string, unknown>; take?: number; orderBy?: unknown; select: Select }) => {
      const { where } = args
      knownOnly(where, ["organizationId", "agentId", "OR"], "the workday read")
      const either = where.OR as Array<{ status?: { in: string[] }; workDate?: Date }> | undefined
      // The roster's order: the latest start first.
      expect(args.orderBy).toEqual([{ startedAt: "desc" }, { workDate: "desc" }])
      return workdays
        .filter((day) =>
          (where.organizationId === undefined || day.organizationId === where.organizationId)
          && (where.agentId === undefined || day.agentId === where.agentId)
          && (either === undefined || either.some((one) =>
            (one.status !== undefined && one.status.in.includes(day.status))
            || (one.workDate !== undefined && day.workDate.getTime() === one.workDate.getTime()))))
        .sort((left, right) => right.startedAt.getTime() - left.startedAt.getTime() || right.workDate.getTime() - left.workDate.getTime())
        .slice(0, args.take ?? workdays.length)
        .map((day) => picked(day, args.select))
    }) as Statement,

    [BREAKS]: ((args: { where: Record<string, unknown>; orderBy?: unknown; select: Select }) => {
      const { where } = args
      knownOnly(where, ["organizationId", "agentId", "workdayId", "type"], "the read of the shift's breaks")
      const types = (where.type as { in: string[] } | undefined)?.in
      return shiftEvents
        .filter((event) =>
          (where.organizationId === undefined || event.organizationId === where.organizationId)
          && (where.agentId === undefined || event.agentId === where.agentId)
          && (where.workdayId === undefined || event.workdayId === where.workdayId)
          && (types === undefined || types.includes(event.type)))
        .map((event) => picked(event, args.select))
    }) as Statement,

    [POSITION]: ((args: { where: Record<string, unknown>; orderBy?: unknown; select: Select }) => {
      const { where } = args
      knownOnly(where, ["organizationId", "agentId", "recordedAt", "latitude", "longitude", "OR"], "the position read")
      const either = where.OR as Array<{ accuracy: null | Range }> | undefined
      expect(args.orderBy).toEqual({ recordedAt: "desc" })
      const row = points
        .filter((kept) =>
          (where.organizationId === undefined || kept.organizationId === where.organizationId)
          && (where.agentId === undefined || kept.agentId === where.agentId)
          && within(kept.recordedAt, where.recordedAt as Range | undefined)
          && within(kept.latitude, where.latitude as Range | undefined)
          && within(kept.longitude, where.longitude as Range | undefined)
          && (either === undefined || either.some((one) =>
            one.accuracy === null ? kept.accuracy === null : within(kept.accuracy, one.accuracy))))
        .sort((left, right) => right.recordedAt.getTime() - left.recordedAt.getTime())[0]
      return row ? picked(row, args.select) : null
    }) as Statement,
  }
}

/** Puts a recorder in front of everything the database client offers. */
function watchEveryStatement() {
  for (const [model, methods] of Object.entries(prisma as unknown as Record<string, unknown>)) {
    const named: Array<[string, unknown]> = vi.isMockFunction(methods)
      ? [[model, methods]]
      : Object.entries((methods ?? {}) as Record<string, unknown>).map(([method, fn]): [string, unknown] => [`${model}.${method}`, fn])
    for (const [call, fn] of named) {
      if (!vi.isMockFunction(fn)) continue
      fn.mockImplementation(async (args: unknown) => {
        const entry: (typeof seen)[number] = { call, ctx: getRlsContext() }
        seen.push(entry)
        const answer = answers[call]
        if (!answer) throw new Error(`a statement this answer has no business running: ${call}`)
        entry.handed = answer(args as never)
        return entry.handed
      })
    }
  }
}

// ─── The fixtures ───────────────────────────────────────────────────────────

const entitled = { plan: "pro", addons: [], features: ["mtm"], modules: { mtm: true }, settings: {} }

function link(over: Partial<LinkRow> = {}): LinkRow {
  const row: LinkRow = {
    id: "link-1", organizationId: ORG, agentId: AGENT, tokenHash: sha256(TOKEN), createdBy: "user-manager",
    createdAt: before(30 * MINUTE), expiresAt: MIDNIGHT, revokedAt: null, revokedBy: null, viewCount: 0, lastViewedAt: null, ...over,
  }
  links.push(row)
  return row
}
function point(over: Partial<PointRow> = {}): PointRow {
  const row: PointRow = {
    id: `point-${points.length + 1}`, organizationId: ORG, agentId: AGENT, latitude: 40.4093, longitude: 49.8671, accuracy: 12,
    speed: 14, heading: 270, battery: 41, isMoving: true, recordedAt: before(3 * MINUTE), ...over,
  }
  points.push(row)
  return row
}
function workday(over: Partial<WorkdayRow> = {}): WorkdayRow {
  const row: WorkdayRow = {
    id: `workday-${workdays.length + 1}`, organizationId: ORG, agentId: AGENT, workDate: TODAY, status: "STARTED",
    startedAt: new Date("2026-10-10T05:00:00.000Z"), pausedAt: null, completedAt: null, ...over,
  }
  workdays.push(row)
  return row
}
/** An entry of a shift's journal — of the employee's own shift unless a case names another. */
function shiftEvent(type: string, occurredAt: Date, of: WorkdayRow = workdays[0]): ShiftEventRow {
  const row: ShiftEventRow = { organizationId: of.organizationId, agentId: of.agentId, workdayId: of.id, type, occurredAt, appliedAt: occurredAt }
  shiftEvents.push(row)
  return row
}
const theEmployee = () => agents.find((agent) => agent.id === AGENT)!
const theOrganization = () => organizations.find((one) => one.id === ORG)!
const theLink = () => links.find((one) => one.id === "link-1")!

// ─── The requests ───────────────────────────────────────────────────────────

const address = (token: string) => `http://localhost:3000/api/v1/public/location-share/${token}`
const open = (token = TOKEN, headers: Record<string, string> = { "x-real-ip": IP }) =>
  GET(new NextRequest(address(token), { headers }), { params: Promise.resolve({ token }) })

/** An answer as its recipient gets it: the status, the bytes, the headers. */
async function received(response: Response) {
  return {
    status: response.status,
    body: await response.text(),
    headers: Object.fromEntries([...response.headers.entries()].sort(([left], [right]) => left.localeCompare(right))),
  }
}
const GONE_BODY = '{"success":false,"state":"GONE"}'
const AVAILABLE_KEYS = ["expiresAt", "generatedAt", "latitude", "longitude", "name", "organizationName", "recordedAt", "timezone"]
const UNAVAILABLE_KEYS = ["expiresAt", "generatedAt", "name", "organizationName", "timezone"]
const WHOLE_VIEW = [LOOKUP, SETTINGS, EMPLOYEE, SHIFT, BREAKS, POSITION, STAMP]

let failureLog: ReturnType<typeof vi.spyOn>
let warningLog: ReturnType<typeof vi.spyOn>
let failureExpected: boolean

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(NOW)
  seen.length = 0
  failureExpected = false
  failureLog = vi.spyOn(console, "error").mockImplementation(() => undefined)
  warningLog = vi.spyOn(console, "warn").mockImplementation(() => undefined)

  links = []
  workdays = []
  shiftEvents = []
  points = []
  organizations = [
    { id: ORG, name: "Delivery Example LLC", isActive: true, ...entitled },
    { id: OTHER_ORG, name: "Other Example LLC", isActive: true, ...entitled },
  ]
  agents = [
    { id: AGENT, organizationId: ORG, name: "Samir Courier", status: "ACTIVE", phone: "+994500000001", email: "samir@example.com", mapColor: "violet", tags: ["night shift"] },
    { id: "agent-colleague", organizationId: ORG, name: "Colleague Nearby", status: "ACTIVE", phone: "+994500000002", email: "colleague@example.com", mapColor: "teal", tags: [] },
    { id: "agent-theirs", organizationId: OTHER_ORG, name: "Somebody Elsewhere", status: "ACTIVE", phone: "+994500000003", email: "elsewhere@example.com", mapColor: "amber", tags: [] },
  ]
  // Both organizations have the links switched on; a test that needs them off says so.
  settings = { [ORG]: { locationShareLinksEnabled: true }, [OTHER_ORG]: { locationShareLinksEnabled: true, timezone: "Europe/Berlin" } }

  // The employee is on shift since nine in the morning and his phone reported three minutes ago.
  link()
  workday()
  point()
  // A colleague of the same organization, on shift, with a newer point somewhere else…
  workday({ agentId: "agent-colleague" })
  point({ agentId: "agent-colleague", latitude: 40.5, longitude: 49.9, recordedAt: before(1 * MINUTE) })
  // …and another organization altogether, with its own link, employee, shift and point.
  link({ id: "link-theirs", organizationId: OTHER_ORG, agentId: "agent-theirs", tokenHash: sha256(THEIR_TOKEN) })
  workday({ organizationId: OTHER_ORG, agentId: "agent-theirs" })
  point({ organizationId: OTHER_ORG, agentId: "agent-theirs", latitude: 52.52, longitude: 13.405, recordedAt: before(2 * MINUTE) })

  answers = theTables()
  watchEveryStatement()
})

afterEach(() => {
  // Each key the limiter was asked about gets its allowance back.
  for (const [key] of vi.mocked(checkRateLimit).mock.calls) resetRateLimit(key)
  // Nothing fails quietly: a test that expects a failure in the log says so.
  if (!failureExpected) expect(failureLog).not.toHaveBeenCalled()
  // The route leaves no RLS context behind for whatever runs next.
  expect(getRlsContext()).toBeUndefined()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe("GET /api/v1/public/location-share/[token]", () => {
  /** The answer of a link that works and has nothing to show — exactly that, and no word about why. */
  async function nothingToShow(why: string) {
    const answer = await received(await open())
    expect(answer.status, why).toBe(200)
    const body = JSON.parse(answer.body)
    expect(body, why).toEqual({
      success: true,
      state: "UNAVAILABLE",
      data: {
        name: "Samir Courier", organizationName: "Delivery Example LLC",
        expiresAt: MIDNIGHT.toISOString(), generatedAt: NOW.toISOString(), timezone: "Asia/Baku",
      },
    })
    // No coordinate key at all — not null, not zero — and no word about why.
    expect(Object.keys(body.data).sort(), why).toEqual(UNAVAILABLE_KEYS)
    for (const never of ["latitude", "longitude", "recordedAt", "40.4", "49.8", "reason", "PAUSED", "STARTED", "COMPLETED", "workday"]) {
      expect(answer.body, `${why}: ${never}`).not.toContain(never)
    }
    return answer
  }

  describe("a working link, the employee on shift, a fresh point", () => {
    it("answers with the point — and with exactly the fields the page shows, written out one by one", async () => {
      const response = await open()
      const answer = await received(response)
      expect(answer.status).toBe(200)
      const body = JSON.parse(answer.body)
      expect(body).toEqual({
        success: true,
        state: "AVAILABLE",
        data: {
          name: "Samir Courier",
          organizationName: "Delivery Example LLC",
          latitude: 40.4093,
          longitude: 49.8671,
          recordedAt: before(3 * MINUTE).toISOString(),
          expiresAt: MIDNIGHT.toISOString(),
          generatedAt: NOW.toISOString(),
          timezone: "Asia/Baku",
        },
      })
      // The whole list. A phone number, a track or a client added later turns this red.
      expect(Object.keys(body).sort()).toEqual(["data", "state", "success"])
      expect(Object.keys(body.data).sort()).toEqual(AVAILABLE_KEYS)
    })

    it("says nothing else that the rows hold: no accuracy, speed, heading or battery, no phone or e-mail, no id, nothing of the link", async () => {
      const text = (await received(await open())).body
      for (const never of [
        "accuracy", "speed", "heading", "battery", "isMoving", "mapColor", "tags", "phone", "email",
        "+994500000001", "samir@example.com", "violet", "night shift",
        AGENT, ORG, "link-1", "point-1", "user-manager", TOKEN, sha256(TOKEN), "tokenHash", "viewCount",
      ]) {
        expect(text, never).not.toContain(never)
      }
    })

    it("shows HIS point: not a colleague's newer one, and nothing of another organization", async () => {
      const body = await (await open()).json()
      expect([body.data.latitude, body.data.longitude]).toEqual([40.4093, 49.8671])
      // The other organization's link opens the other organization's employee — in its own zone.
      const theirs = await (await open(THEIR_TOKEN)).json()
      expect(theirs).toMatchObject({
        state: "AVAILABLE",
        data: { name: "Somebody Elsewhere", organizationName: "Other Example LLC", latitude: 52.52, longitude: 13.405, timezone: "Europe/Berlin" },
      })
    })

    it("finds the link outside any organization, once, and runs everything else inside the organization the link belongs to", async () => {
      await open()
      expect(calls()).toEqual(WHOLE_VIEW)
      expect(contextsOf(LOOKUP)).toEqual([{ bypass: true }])
      for (const entry of seen.filter((one) => one.call !== LOOKUP)) expect(entry.ctx, entry.call).toEqual({ orgId: ORG })

      seen.length = 0
      await open(THEIR_TOKEN)
      expect(contextsOf(LOOKUP)).toEqual([{ bypass: true }])
      for (const entry of seen.filter((one) => one.call !== LOOKUP)) expect(entry.ctx, entry.call).toEqual({ orgId: OTHER_ORG })
    })

    it("reads the raw points and never the latest-position row — a vague point advances that one", async () => {
      await open()
      expect(calls().filter((call) => call.startsWith("mtmAgentLatestLocation"))).toEqual([])
      expect(calls()).toContain(POSITION)
    })

    it("names the time zone the page prints its times in — UTC when the organization's cannot be read", async () => {
      settings[ORG].timezone = "Mars/Olympus"
      expect((await (await open()).json()).data.timezone).toBe("UTC")
    })
  })

  describe("a working link with nothing to show", () => {
    it("on a break: nothing is shown, and where he is is not even read", async () => {
      workdays[0].status = "PAUSED"
      workdays[0].pausedAt = before(5 * MINUTE)
      shiftEvent("PAUSE", before(5 * MINUTE))
      // His phone goes on reporting through a door that does not refuse a break's points.
      point({ latitude: 40.2, longitude: 49.6, recordedAt: before(1 * MINUTE) })
      await nothingToShow("a break")
      expect(calls()).toEqual([LOOKUP, SETTINGS, EMPLOYEE, SHIFT, STAMP])
    })

    it("before the shift is started, and after it is closed", async () => {
      workdays.splice(0, 1)
      await nothingToShow("no shift today")
      expect(calls()).not.toContain(POSITION)

      workday({ status: "COMPLETED", completedAt: before(10 * MINUTE) })
      await nothingToShow("the shift is closed")
      expect(calls()).not.toContain(POSITION)
    })

    it("on a shift left open since an earlier day, though his phone is still reporting", async () => {
      workdays[0].workDate = YESTERDAY
      workdays[0].startedAt = new Date("2026-10-09T05:00:00.000Z")
      await nothingToShow("yesterday's open shift")
      expect(calls()).not.toContain(POSITION)
      // Also when today's own day is already closed: the managers' map reads the open one, and so does this.
      workday({ status: "COMPLETED", startedAt: new Date("2026-10-10T04:00:00.000Z"), completedAt: before(60 * MINUTE) })
      await nothingToShow("yesterday's open shift beside today's closed one")
    })

    it("after the organization's midnight a shift of «yesterday» shows nothing, and the night shift of the new day does", async () => {
      // One o'clock at night in Baku on the 11th; in UTC it is still the 10th.
      vi.setSystemTime(new Date("2026-10-10T21:00:00.000Z"))
      theLink().createdAt = new Date("2026-10-10T20:10:00.000Z")
      theLink().expiresAt = new Date("2026-10-11T20:00:00.000Z")
      points[0].recordedAt = new Date("2026-10-10T20:59:00.000Z")
      const forgotten = await (await open()).json()
      expect(forgotten.state).toBe("UNAVAILABLE")
      expect(Object.keys(forgotten.data).sort()).toEqual(UNAVAILABLE_KEYS)
      expect(calls()).not.toContain(POSITION)

      workdays[0].status = "COMPLETED"
      workday({ workDate: new Date("2026-10-11T00:00:00.000Z"), startedAt: new Date("2026-10-10T20:30:00.000Z") })
      expect(await (await open()).json()).toMatchObject({ state: "AVAILABLE", data: { recordedAt: "2026-10-10T20:59:00.000Z" } })
    })

    it("when the shift is a colleague's and not his", async () => {
      workdays.splice(0, 1)
      await nothingToShow("only the colleague is on shift")
    })

    it("when his phone has reported nothing during this shift", async () => {
      points.splice(0, 1)
      await nothingToShow("no point")
      // A point from before he started is yesterday's whereabouts — and is
      // not so much as read: the statement asks for this shift's points only.
      workdays[0].startedAt = before(2 * MINUTE)
      point({ recordedAt: before(2 * MINUTE + 1) })
      await nothingToShow("a point from before the shift")
      expect(handedBy(POSITION).at(-1)).toBeNull()
    })

    it("when the last point is too old to call «сейчас»: ten minutes as shipped, fifteen whatever the organization set", async () => {
      points[0].recordedAt = before(10 * MINUTE + 1)
      await nothingToShow("older than the organization's own ten minutes")
      // An organization that stretched «свежая» to a whole day does not stretch this.
      Object.assign(settings[ORG], { offlineThresholdSeconds: 86_400, locationWindowMinutes: 1_440 })
      points[0].recordedAt = before(15 * MINUTE + 1)
      await nothingToShow("older than fifteen minutes")
      points[0].recordedAt = before(15 * MINUTE)
      expect((await (await open()).json()).state).toBe("AVAILABLE")
    })

    it("when the only point is too vague to be a position", async () => {
      points[0].accuracy = 150
      await nothingToShow("150 m against the organization's 100")
      // The organization's bound is held to a kilometre, as on the managers' map.
      settings[ORG].historyMaxAccuracyMeters = 5_000
      points[0].accuracy = 1_001
      await nothingToShow("a kilometre and a metre")
      points[0].accuracy = 1_000
      expect((await (await open()).json()).state).toBe("AVAILABLE")
    })

    it("when the only point is not on the globe", async () => {
      points[0].latitude = 90.01
      await nothingToShow("a latitude off the globe")
    })

    it("counts as an opening all the same: the link was opened, whatever it had to show", async () => {
      workdays[0].status = "PAUSED"
      await open()
      expect(theLink()).toMatchObject({ viewCount: 1, lastViewedAt: NOW })
    })
  })

  // Where a person spends his break is his own. During the break nothing is
  // shown (above); these are about the minutes AFTER it. A point recorded
  // during the break can be in the table — the batch ingestion and «поделиться
  // своим местоположением» do not refuse one — and once he presses
  // «продолжить» it is the newest row of a running shift.
  describe("after a break", () => {
    // A break of five minutes that ended four minutes ago: every point here
    // is fresh enough to be shown, so what hides one is the break alone.
    const backFromBreak = () => {
      shiftEvent("PAUSE", before(9 * MINUTE))
      shiftEvent("RESUME", before(4 * MINUTE))
    }

    it("never shows a point recorded during the break: nothing until the phone reports again, and then the new point", async () => {
      points[0].recordedAt = before(6 * MINUTE)
      // The premise: with no break in the shift's journal this very point is what a stranger is shown.
      expect(await (await open()).json()).toMatchObject({ state: "AVAILABLE", data: { recordedAt: before(6 * MINUTE).toISOString() } })

      backFromBreak()
      await nothingToShow("the only point is from the break")
      // Not so much as read: the statement asks for the points since he resumed.
      expect(calls().slice(-3)).toEqual([SHIFT, BREAKS, POSITION])
      expect(handedBy(POSITION).at(-1)).toBeNull()

      point({ latitude: 40.39, longitude: 49.84, recordedAt: before(2 * MINUTE) })
      expect(await (await open()).json()).toMatchObject({
        state: "AVAILABLE", data: { latitude: 40.39, longitude: 49.84, recordedAt: before(2 * MINUTE).toISOString() },
      })
    })

    it("does not fall back to the last point from before the break either", async () => {
      points[0].recordedAt = before(9 * MINUTE + 30 * SECOND)
      expect((await (await open()).json()).state).toBe("AVAILABLE")
      backFromBreak()
      await nothingToShow("the only point is from before the break")
    })

    it("shows a point recorded after he resumed — the one taken at that very second included", async () => {
      backFromBreak()
      // The fixture's own point is three minutes old: a minute after he resumed.
      expect(await (await open()).json()).toMatchObject({ state: "AVAILABLE", data: { recordedAt: before(3 * MINUTE).toISOString() } })
      points[0].recordedAt = before(4 * MINUTE)
      expect(await (await open()).json()).toMatchObject({ state: "AVAILABLE", data: { recordedAt: before(4 * MINUTE).toISOString() } })
      points[0].recordedAt = before(4 * MINUTE + 1)
      expect((await (await open()).json()).state).toBe("UNAVAILABLE")
    })

    it("goes by HIS breaks in THIS shift: a colleague's lunch, another organization's, and his own of an earlier day hide nothing", async () => {
      const colleague = workdays.find((day) => day.agentId === "agent-colleague")!
      const theirs = workdays.find((day) => day.organizationId === OTHER_ORG)!
      // Each of these, were it read as his, would put the bound after his point of three minutes ago.
      shiftEvent("PAUSE", before(8 * MINUTE), colleague)
      shiftEvent("RESUME", before(1 * MINUTE), colleague)
      shiftEvent("PAUSE", before(8 * MINUTE), theirs)
      shiftEvent("RESUME", before(1 * MINUTE), theirs)
      const yesterday = workday({ workDate: YESTERDAY, status: "COMPLETED", startedAt: new Date("2026-10-09T05:00:00.000Z"), completedAt: new Date("2026-10-09T14:00:00.000Z") })
      shiftEvent("PAUSE", before(8 * MINUTE), yesterday)
      expect(await (await open()).json()).toMatchObject({ state: "AVAILABLE", data: { latitude: 40.4093, recordedAt: before(3 * MINUTE).toISOString() } })
      // …and his own does: the same entries on his shift.
      shiftEvent("PAUSE", before(8 * MINUTE))
      shiftEvent("RESUME", before(1 * MINUTE))
      expect((await (await open()).json()).state).toBe("UNAVAILABLE")
    })

    it("shows nothing while the shift's journal says a break is still running, though the workday row says he is working — and reads no point", async () => {
      shiftEvent("PAUSE", before(5 * MINUTE))
      point({ recordedAt: before(1 * MINUTE) })
      await nothingToShow("the journal says «перерыв»")
      expect(calls()).toEqual([LOOKUP, SETTINGS, EMPLOYEE, SHIFT, BREAKS, STAMP])
    })

    it("reads a manager's reopening as the break it was: closed, reopened, resumed two minutes ago", async () => {
      shiftEvent("FINISH", before(30 * MINUTE))
      shiftEvents.push({ ...shiftEvents.at(-1)!, type: "REOPEN", appliedAt: before(5 * MINUTE) })
      shiftEvent("RESUME", before(2 * MINUTE))
      // Three minutes ago he had not resumed yet.
      await nothingToShow("a point from before he resumed")
      point({ latitude: 40.5, longitude: 49.9, recordedAt: before(1 * MINUTE) })
      expect(await (await open()).json()).toMatchObject({ state: "AVAILABLE", data: { latitude: 40.5, longitude: 49.9 } })
    })

    it("asks for the journal only of a shift that is running: off shift it is one read fewer, not one more", async () => {
      workdays[0].status = "COMPLETED"
      await open()
      expect(calls()).toEqual([LOOKUP, SETTINGS, EMPLOYEE, SHIFT, STAMP])
    })
  })

  describe("which point is «the» point", () => {
    it("is the newest one the managers' map would draw: a vaguer point after it does not hide it, and is not shown instead", async () => {
      point({ latitude: 40.7, longitude: 49.1, accuracy: 400, recordedAt: before(1 * MINUTE) })
      const body = await (await open()).json()
      expect(body).toMatchObject({ state: "AVAILABLE", data: { latitude: 40.4093, longitude: 49.8671, recordedAt: before(3 * MINUTE).toISOString() } })
    })

    it("is never an older, prettier one: the newest exact-enough point wins over a more exact earlier one", async () => {
      point({ latitude: 40.41, longitude: 49.87, accuracy: 95, recordedAt: before(1 * MINUTE) })
      point({ latitude: 40.3, longitude: 49.7, accuracy: 3, recordedAt: before(2 * MINUTE) })
      expect((await (await open()).json()).data).toMatchObject({ latitude: 40.41, longitude: 49.87 })
    })

    it("is a point with no accuracy reported at all, as on the managers' map", async () => {
      point({ latitude: 40.42, longitude: 49.88, accuracy: null, recordedAt: before(1 * MINUTE) })
      expect((await (await open()).json()).data).toMatchObject({ latitude: 40.42, longitude: 49.88 })
    })

    it("is not one dated ahead of this moment — a phone whose clock runs ahead does not get to say «сейчас»", async () => {
      point({ latitude: 41, longitude: 50, recordedAt: new Date(NOW.getTime() + 2 * MINUTE) })
      // What he reported up to now is still shown.
      expect((await (await open()).json()).data).toMatchObject({ latitude: 40.4093, recordedAt: before(3 * MINUTE).toISOString() })
      points.splice(0, 1)
      expect((await (await open()).json()).state).toBe("UNAVAILABLE")
    })

    it("is one of THIS shift: the first point after he started, not a fresher-looking one from before", async () => {
      workdays[0].startedAt = before(2 * MINUTE)
      point({ latitude: 40.45, longitude: 49.85, recordedAt: before(2 * MINUTE) })
      expect((await (await open()).json()).data).toMatchObject({ latitude: 40.45, recordedAt: before(2 * MINUTE).toISOString() })
    })
  })

  describe("a link that does not work", () => {
    const causes: Array<[string, () => void, string]> = [
      ["was never made", () => { links.splice(0, 1) }, TOKEN],
      ["was revoked", () => { Object.assign(theLink(), { revokedAt: before(1 * MINUTE), revokedBy: "user-manager" }) }, TOKEN],
      ["ran out of time a moment ago", () => { theLink().expiresAt = before(1) }, TOKEN],
      ["runs out at this very instant", () => { theLink().expiresAt = new Date(NOW) }, TOKEN],
      ["belongs to an organization that switched the links off", () => { settings[ORG].locationShareLinksEnabled = false }, TOKEN],
      ["belongs to an organization that never switched them on", () => { delete settings[ORG].locationShareLinksEnabled }, TOKEN],
      ["belongs to an organization that is no longer active", () => { theOrganization().isActive = false }, TOKEN],
      ["belongs to an organization that lost the field product", () => { Object.assign(theOrganization(), { features: [], modules: {} }) }, TOKEN],
      ["belongs to an organization whose field product was switched off", () => { theOrganization().modules = { mtm: true, "route-field": false } }, TOKEN],
      ["shows an employee removed from Field", () => { theEmployee().fieldDeletedAt = new Date() }, TOKEN],
      ["shows an employee who was deactivated", () => { theEmployee().status = "INACTIVE" }, TOKEN],
      ["shows an employee who was suspended", () => { theEmployee().status = "SUSPENDED" }, TOKEN],
      ["is not a link at all", () => undefined, "not-a-token"],
    ]

    it("gives every one of these the same answer, byte for byte — a stranger learns nothing from which", async () => {
      const collected: Array<[string, Awaited<ReturnType<typeof received>>]> = []
      for (const [what, arrange, token] of causes) {
        // Each cause against the same working link, on its own.
        links = []; workdays = []; shiftEvents = []; points = []
        organizations = organizations.map((one) => ({ ...one, isActive: true, ...entitled }))
        agents = agents.map((agent) => ({ ...agent, status: "ACTIVE" }))
        settings[ORG] = { locationShareLinksEnabled: true }
        link(); workday(); point()
        arrange()
        collected.push([what, await received(await open(token))])
      }
      const [, first] = collected[0]
      expect(first.status).toBe(404)
      expect(first.body).toBe(GONE_BODY)
      for (const [what, answer] of collected) expect(answer, what).toEqual(first)
    })

    it.each(causes.filter(([, , token]) => token === TOKEN))(
      "a link that %s: no shift, no position and no view count is touched",
      async (_what, arrange) => {
        arrange()
        const untouched = JSON.stringify(links.map((one) => [one.id, one.viewCount, one.lastViewedAt]))
        const response = await open()
        expect(response.status).toBe(404)
        expect(calls()).not.toContain(SHIFT)
        expect(calls()).not.toContain(POSITION)
        expect(calls()).not.toContain(STAMP)
        expect(JSON.stringify(links.map((one) => [one.id, one.viewCount, one.lastViewedAt]))).toBe(untouched)
      },
    )

    it("asks nothing further once the link itself is found dead: an unknown, revoked or expired link costs one lookup", async () => {
      for (const arrange of [() => { links.splice(0, 1) }, () => { theLink().revokedAt = before(1) }, () => { theLink().expiresAt = before(1) }]) {
        links = []; link(); seen.length = 0
        arrange()
        await open()
        expect(calls()).toEqual([LOOKUP])
      }
    })

    it.each([
      ["nothing", ""],
      ["a word", "location"],
      ["a token one character short", "a".repeat(63)],
      ["a token one character long", "a".repeat(65)],
      ["a token in capitals", "A".repeat(64)],
      ["64 characters that are not hex", "g".repeat(64)],
      ["a token with something after it", `${"a".repeat(64)}\n`],
      ["a token with a path after it", `${"a".repeat(64)}/../x`],
      ["a statement in a token's clothes", `${"a".repeat(40)}' OR '1'='1' --${"a".repeat(9)}`],
    ])("answers %s without asking the database or the limiter anything", async (_what, token) => {
      const answer = await received(await open(token))
      expect(answer.status).toBe(404)
      expect(answer.body).toBe(GONE_BODY)
      expect(seen).toEqual([])
      expect(checkRateLimit).not.toHaveBeenCalled()
    })

    // Switching the links off also revokes every working link, in the same
    // save (mtm-settings-safe-save.test.ts; on a real database in
    // mtm-contact-categories-postgres.test.ts), so switching back on revives
    // none. This is the other half: the answer asks the switch itself on
    // every view, and does not lean on those rows having been written.
    it("asks the switch itself on every view: off, a link the table still holds as working opens nothing", async () => {
      expect(theLink()).toMatchObject({ revokedAt: null, expiresAt: MIDNIGHT })
      settings[ORG].locationShareLinksEnabled = false
      const first = await received(await open())
      vi.setSystemTime(new Date(NOW.getTime() + 2 * MINUTE))
      const second = await received(await open())
      expect([first.status, first.body, second.status, second.body]).toEqual([404, GONE_BODY, 404, GONE_BODY])
      // Asked both times, and nothing of the employee was read either time.
      expect(calls()).toEqual([LOOKUP, SETTINGS, LOOKUP, SETTINGS])
    })

    it("a link that was revoked stays dead whatever the switch says afterwards", async () => {
      // What the save that switches the links off leaves behind.
      Object.assign(theLink(), { revokedAt: before(1 * MINUTE), revokedBy: "user-admin" })
      settings[ORG].locationShareLinksEnabled = true
      expect(await received(await open())).toMatchObject({ status: 404, body: GONE_BODY })
      expect(calls()).toEqual([LOOKUP])
    })

    it("still works a millisecond before its time is up", async () => {
      theLink().expiresAt = new Date(NOW.getTime() + 1)
      expect((await open()).status).toBe(200)
    })

    it("another organization switching its links off does not touch this one's", async () => {
      settings[OTHER_ORG].locationShareLinksEnabled = false
      expect((await open()).status).toBe(200)
      expect((await open(THEIR_TOKEN)).status).toBe(404)
    })
  })

  describe("when something of ours fails", () => {
    const failing = (call: string, message: string) => {
      answers[call] = (() => { throw new Error(message) }) as Statement
    }

    it.each([
      ["the lookup", LOOKUP],
      ["the settings", SETTINGS],
      ["the employee", EMPLOYEE],
      ["the shift", SHIFT],
      ["the shift's breaks", BREAKS],
      ["the position", POSITION],
    ])("answers GONE when %s cannot be read — never a 500, and never a guess", async (_what, call) => {
      failureExpected = true
      const unknown = await received(await open("c".repeat(64)))
      failing(call, "connection refused")
      const answer = await received(await open())
      // The very bytes an unknown link gets.
      expect(answer).toEqual(unknown)
      expect(answer.body).toBe(GONE_BODY)
      expect(failureLog).toHaveBeenCalledTimes(1)
    })

    it("answers GONE when the address itself cannot be read", async () => {
      failureExpected = true
      const response = await GET(new NextRequest(address(TOKEN)), { params: Promise.reject(new Error("no params")) })
      expect(await received(response)).toMatchObject({ status: 404, body: GONE_BODY })
    })

    it("logs what kind of failure it was and nothing of the link: not the token, not its hash, not the message that quotes them", async () => {
      failureExpected = true
      class PrismaClientValidationError extends Error {
        name = "PrismaClientValidationError"
        code = "P2010"
      }
      answers[LOOKUP] = (() => {
        throw new PrismaClientValidationError(`Invalid prisma.mtmLocationShareLink.findUnique() invocation: { where: { tokenHash: "${sha256(TOKEN)}" } } for ${TOKEN}`)
      }) as Statement
      expect((await open()).status).toBe(404)
      const logged = JSON.stringify(failureLog.mock.calls)
      expect(logged).toContain("PrismaClientValidationError P2010")
      for (const never of [TOKEN, sha256(TOKEN), sha256(TOKEN).slice(0, 16), "invocation"]) expect(logged).not.toContain(never)
    })
  })

  describe("counting the openings", () => {
    // «Открыта N раз» is how the manager learns whether a link went further
    // than the person he sent it to. The page asks every thirty seconds while
    // it is open, so counting «once a minute» counted the minutes somebody
    // watched: one client waiting an hour for a courier read «Открыта 61 раз».
    it("a page left open for an hour is ONE opening, and «последний раз» keeps moving once a minute", async () => {
      await open()
      expect(theLink()).toMatchObject({ viewCount: 1, lastViewedAt: NOW })

      // Its own refreshes within the minute write nothing at all.
      vi.setSystemTime(new Date(NOW.getTime() + 30 * SECOND))
      await open()
      vi.setSystemTime(new Date(NOW.getTime() + 59 * SECOND + 999))
      await open()
      expect(theLink()).toMatchObject({ viewCount: 1, lastViewedAt: NOW })
      expect(calls().filter((call) => call === STAMP)).toHaveLength(1)

      // A minute on: the same visitor still. The moment moves, the count does not.
      const aMinuteOn = new Date(NOW.getTime() + 60 * SECOND)
      vi.setSystemTime(aMinuteOn)
      await open()
      expect(theLink()).toMatchObject({ viewCount: 1, lastViewedAt: aMinuteOn })

      // The rest of the hour, every thirty seconds. (The link's own allowance is per minute: 2 of 30.)
      let last = aMinuteOn
      for (let seconds = 90; seconds <= 60 * 60; seconds += 30) {
        last = new Date(NOW.getTime() + seconds * SECOND)
        vi.setSystemTime(last)
        expect((await open()).status, `${seconds} s`).toBe(200)
      }
      expect(theLink()).toMatchObject({ viewCount: 1, lastViewedAt: last })
      // One statement a minute at most: 61 of the 121 requests wrote.
      expect(calls().filter((call) => call === STAMP)).toHaveLength(61)
      // Nobody else's link moved.
      expect(links.find((one) => one.id === "link-theirs")).toMatchObject({ viewCount: 0, lastViewedAt: null })
    })

    it("opened again after five minutes of silence is a second opening — to the millisecond", async () => {
      await open()
      // The page was closed. Four minutes fifty-nine later somebody looks: still the same sitting.
      const justUnder = new Date(NOW.getTime() + 5 * MINUTE - 1)
      vi.setSystemTime(justUnder)
      await open()
      expect(theLink()).toMatchObject({ viewCount: 1, lastViewedAt: justUnder })
      // Five whole minutes after THAT look: a new opening.
      const fiveOn = new Date(justUnder.getTime() + 5 * MINUTE)
      vi.setSystemTime(fiveOn)
      await open()
      expect(theLink()).toMatchObject({ viewCount: 2, lastViewedAt: fiveOn })
      // And the next morning's is the third, however long the night was.
      theLink().expiresAt = new Date(NOW.getTime() + 48 * 60 * MINUTE)
      const later = new Date(fiveOn.getTime() + 20 * 60 * MINUTE)
      vi.setSystemTime(later)
      await open()
      expect(theLink()).toMatchObject({ viewCount: 3, lastViewedAt: later })
    })

    it("is the server's to decide: nothing a request says keeps it from being counted, or counts it twice", async () => {
      const asked = (query: string, headers: Record<string, string> = {}) =>
        GET(new NextRequest(`${address(TOKEN)}${query}`, { headers: { "x-real-ip": IP, ...headers } }), { params: Promise.resolve({ token: TOKEN }) })
      // A visitor who says «это обновление, не считайте» from his very first request is an opening all the same.
      expect((await asked("?poll=1&first=0&count=0", { "x-poll": "1", "x-requested-with": "refresh", purpose: "prefetch" })).status).toBe(200)
      expect(theLink().viewCount).toBe(1)
      // And one who says «считайте» on every refresh is still one.
      vi.setSystemTime(new Date(NOW.getTime() + 61 * SECOND))
      expect((await asked("?first=1&count=1", { "x-first": "1" })).status).toBe(200)
      expect(theLink().viewCount).toBe(1)
    })

    it("two people opening it at the same instant are one opening: the table decides, not what each of them read", async () => {
      const [first, second] = await Promise.all([open(), open(TOKEN, { "x-real-ip": "203.0.113.8" })])
      expect([first.status, second.status]).toEqual([200, 200])
      // Both read the row before either wrote to it…
      expect(calls().filter((call) => call === STAMP)).toHaveLength(2)
      // …and one of them counted.
      expect(theLink().viewCount).toBe(1)

      // The same after a silence: both read «last looked at six minutes ago», one of them opens the new sitting.
      vi.setSystemTime(new Date(NOW.getTime() + 6 * MINUTE))
      await Promise.all([open(), open(TOKEN, { "x-real-ip": "203.0.113.8" })])
      expect(calls().filter((call) => call === STAMP)).toHaveLength(4)
      expect(theLink().viewCount).toBe(2)
    })

    it("somebody who read the row before a colleague's look does not open a sitting the colleague already opened", async () => {
      theLink().lastViewedAt = before(6 * MINUTE)
      theLink().viewCount = 1
      const shift = answers[SHIFT]
      answers[SHIFT] = ((args: never) => {
        // Between this request's read of the link and its stamp, somebody else's request counted.
        Object.assign(theLink(), { viewCount: 2, lastViewedAt: before(1 * SECOND) })
        return shift(args)
      }) as Statement
      await open()
      expect(theLink()).toMatchObject({ viewCount: 2, lastViewedAt: before(1 * SECOND) })
    })

    it("a link revoked while the answer was being put together is not counted as opened", async () => {
      const shift = answers[SHIFT]
      answers[SHIFT] = ((args: never) => {
        theLink().revokedAt = new Date(NOW)
        return shift(args)
      }) as Statement
      await open()
      expect(theLink()).toMatchObject({ viewCount: 0, lastViewedAt: null })
    })

    it("a counter that cannot be written does not cost the visitor his answer", async () => {
      const counted = await received(await open(THEIR_TOKEN))
      links.find((one) => one.id === "link-theirs")!.lastViewedAt = null
      answers[STAMP] = (() => { throw new Error(`deadlock detected on ${sha256(THEIR_TOKEN)}`) }) as Statement
      const uncounted = await received(await open(THEIR_TOKEN))
      expect(uncounted).toEqual(counted)
      expect(uncounted.status).toBe(200)
      expect(JSON.parse(uncounted.body).state).toBe("AVAILABLE")
      // Said in the log, by kind only.
      expect(warningLog).toHaveBeenCalledTimes(1)
      expect(JSON.stringify(warningLog.mock.calls)).not.toContain(sha256(THEIR_TOKEN))
      expect(JSON.stringify(warningLog.mock.calls)).not.toContain("deadlock")
    })
  })

  describe("the headers", () => {
    const expected = {
      "cache-control": "no-store, no-cache, must-revalidate, private",
      pragma: "no-cache",
      "x-robots-tag": "noindex, nofollow",
    }

    it("tells every browser, proxy and search engine to keep nothing — on each of the answers", async () => {
      const available = await received(await open())
      workdays[0].status = "PAUSED"
      const unavailable = await received(await open())
      theLink().revokedAt = before(1)
      const gone = await received(await open())
      const malformed = await received(await open("nope"))
      expect([available.status, unavailable.status, gone.status, malformed.status]).toEqual([200, 200, 404, 404])
      for (const answer of [available, unavailable, gone, malformed]) {
        expect(answer.headers).toMatchObject(expected)
        expect(answer.headers["content-type"]).toContain("application/json")
      }
    })
  })

  describe("how often it may be asked", () => {
    const limited = { success: false, state: "RATE_LIMITED", retryAfterSeconds: 60 }

    it("answers thirty times a minute to one address about one link, then asks to wait — without touching the database", async () => {
      for (let asked = 1; asked <= 30; asked += 1) expect((await open()).status, `request ${asked}`).toBe(200)
      const statements = seen.length
      const refused = await received(await open())
      expect(refused.status).toBe(429)
      expect(JSON.parse(refused.body)).toEqual(limited)
      expect(refused.headers).toMatchObject({
        "retry-after": "60", "cache-control": "no-store, no-cache, must-revalidate, private", pragma: "no-cache", "x-robots-tag": "noindex, nofollow",
      })
      expect(seen).toHaveLength(statements)

      // A minute later the same address is answered again.
      vi.setSystemTime(new Date(NOW.getTime() + 60 * SECOND + 1))
      expect((await open()).status).toBe(200)
    })

    it("keeps one allowance per address and per link: a colleague elsewhere, and another link from here, are not held up", async () => {
      for (let asked = 1; asked <= 30; asked += 1) await open()
      expect((await open()).status).toBe(429)
      expect((await open(TOKEN, { "x-real-ip": "203.0.113.99" })).status).toBe(200)
      expect((await open(THEIR_TOKEN)).status).toBe(200)
      // An unknown link has an allowance of its own too: guessing costs the guesser, not the visitors of a real one.
      expect((await open("d".repeat(64))).status).toBe(404)
    })

    it("counts by the address nginx saw — a header the caller writes himself buys no new allowance", async () => {
      for (let asked = 1; asked <= 30; asked += 1) {
        await open(TOKEN, { "x-real-ip": IP, "x-forwarded-for": `198.51.100.${asked}`, "cf-connecting-ip": `198.51.100.${asked}` })
      }
      const refused = await open(TOKEN, { "x-real-ip": IP, "x-forwarded-for": "198.51.100.250", "cf-connecting-ip": "198.51.100.250" })
      expect(refused.status).toBe(429)
    })

    it("keys the allowance on a piece of the link's hash, so the link itself is in no key and no log", async () => {
      await open()
      const keys = vi.mocked(checkRateLimit).mock.calls.map(([key]) => key)
      expect(keys).toEqual([`mtm-location-share-link-view:${IP}:${sha256(TOKEN).slice(0, 16)}`])
      expect(keys.join()).not.toContain(TOKEN)
      // A piece, not the whole: the key alone does not find the row.
      expect(keys.join()).not.toContain(sha256(TOKEN))
    })
  })

  describe("what the route is", () => {
    it("answers GET and nothing else", () => {
      expect(Object.keys(route).sort()).toEqual(["GET", "dynamic"])
      expect(route.dynamic).toBe("force-dynamic")
    })

    it("asks nobody who the visitor is: the same answer with or without a session of any organization", () => {
      // The proxy lets the path through for everybody (lib-middleware.test.ts); the handler must not look either.
      const source = readFileSync("src/app/api/v1/public/location-share/[token]/route.ts", "utf8")
      for (const never of ["@/lib/api-auth", "@/lib/auth", "next-auth", "@/lib/with-rls", "@/lib/with-mtm-rls-auth", "cookies"]) {
        expect(source, never).not.toContain(never)
      }
    })
  })
})
