/**
 * Where an employee spent a break is not stored — read off the table, after
 * the real ingestion handlers have run over a real Postgres.
 *
 * A break is the employee's own time (owner's rule). The single-point route,
 * POST /api/v1/mtm/mobile/location, has refused a point recorded inside one
 * since A7. The batch route, POST /api/v2/mtm/mobile/location/batch, checked
 * only the workday window until 2026-10-11: a device in the batch pilot could
 * record where the break was spent, and the live-map marker followed it there.
 * The entry a web session or an integration's key writes through for an
 * employee, POST /api/v1/mtm/locations, looked at no workday at all until
 * 2026-10-12.
 *
 * What is asked here is what the table holds afterwards, not what the handler
 * was seen to call: a mocked Prisma answers any query, including the journal
 * read this rule depends on. The three handlers run with their real wrappers,
 * the real RLS scope and the real Prisma client over a scratch database built
 * from schema.prisma. The stand-ins: who is calling (the mobile token, the
 * web session), the tenant's plan, and the batch rate limiter, which is not
 * the subject and would stop the seventh batch of a device within a minute.
 *
 * Every instant is taken relative to now — the handlers refuse the future and
 * anything older than a week — so nothing here depends on the date.
 *
 * The same two mobile handlers decide which point is «moving» — the phone
 * sends only its speed — and that flag is what History shows and what ends a
 * stop on the live map. Since 2026-10-15 the line is 3 km/h as a screen shows
 * it (src/lib/mtm/gps-speed.ts); the last block reads it back off the table.
 *
 * Set MTM_LOCATION_BREAK_TEST_DATABASE_URL to an admin connection, e.g.
 *   docker run --rm -e POSTGRES_PASSWORD=postgres -p 127.0.0.1:55499:5432 postgres:16
 *   MTM_LOCATION_BREAK_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55499/postgres
 * Without it the suite is skipped. CI runs it in `static-checks` and again in
 * the deploy («MTM break coordinates database gate»), where
 * `MTM_LOCATION_BREAK_DB_GATE=required` turns a missing URL into a failure so
 * the gate cannot go quietly green.
 */
import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { NextRequest } from "next/server"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

const adminUrl = process.env.MTM_LOCATION_BREAK_TEST_DATABASE_URL
if (!adminUrl && process.env.MTM_LOCATION_BREAK_DB_GATE === "required") {
  throw new Error("MTM_LOCATION_BREAK_TEST_DATABASE_URL is required by the MTM break coordinates database gate")
}

const scratch = vi.hoisted(() => {
  const admin = process.env.MTM_LOCATION_BREAK_TEST_DATABASE_URL
  if (!admin) return null
  const name = `mtm_location_break_${process.pid}`
  const url = new URL(admin)
  url.pathname = `/${name}`
  // `@/lib/prisma` builds its client from DATABASE_URL on first import, which
  // happens after the scratch database exists (dynamic imports below).
  process.env.DATABASE_URL = url.toString()
  return { name, url: url.toString() }
})

/** Whose phone is calling. */
const caller = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }))

vi.mock("@/lib/mobile-auth", async () => {
  const { makeMobileAuthMock } = await import("./mocks/mobile-auth")
  const mock = makeMobileAuthMock()
  mock.resolveMobileAuth.mockImplementation(async () => caller.current)
  return mock
})
vi.mock("@/lib/api-auth", () => ({
  getOrgId: vi.fn(),
  getSession: vi.fn().mockResolvedValue(null),
  // The organization's administrator at a browser; an integration's key comes
  // through the same wrapper with the same role.
  requireAuth: vi.fn(async () => ({
    orgId: "org-break",
    userId: "admin-user",
    role: "admin",
    email: "admin@example.test",
    name: "Admin",
    principalType: "session",
  })),
  isAuthError: (value: unknown) => value instanceof Response,
}))
// The tenant's plan is not what is under test.
vi.mock("@/lib/tenant-capability-access", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/tenant-capability-access")>(),
  requireTenantCapabilityAccessResponse: async () => null,
}))
vi.mock("@/lib/public-abuse-guard", async () => {
  const actual = await vi.importActual<typeof import("@/lib/public-abuse-guard")>("@/lib/public-abuse-guard")
  return {
    ...actual,
    consumePublicRateLimit: vi.fn(async () => ({ allowed: true, retryAfterSeconds: 0, unavailable: false })),
  }
})

const ROOT = process.cwd()
const PRISMA_CLI = createRequire(import.meta.url).resolve("prisma/build/index.js")
const ORG = "org-break"
const DEVICE = "device-break-1"
const BATCH_URL = "http://localhost:3000/api/v2/mtm/mobile/location/batch"
const POINT_URL = "http://localhost:3000/api/v1/mtm/mobile/location"
const WEB_URL = "http://localhost:3000/api/v1/mtm/locations"
const NOTIFICATIONS_URL = "http://localhost:3000/api/v1/mtm/mobile/notifications"

function prismaCli(args: string[], env: NodeJS.ProcessEnv, input?: string) {
  const result = spawnSync(process.execPath, [PRISMA_CLI, ...args], { input, encoding: "utf8", env })
  if (result.status !== 0) {
    throw new Error(`prisma ${args.join(" ")} failed\n${result.error ?? ""}\n${result.stdout}\n${result.stderr}`)
  }
}

/**
 * The schema as `db push` can build it on any Postgres. Two knowledge-base
 * tables carry a pgvector column; the pull-request database has that extension
 * and a plain `postgres:16` does not. Nothing here reads those columns.
 */
function schemaWithoutEmbeddings(): string {
  const schema = readFileSync(path.join(ROOT, "prisma/schema.prisma"), "utf8")
  const stripped = schema.split("\n").filter((line) => !/Unsupported\("vector/.test(line)).join("\n")
  if (stripped === schema) throw new Error("no pgvector column found — this workaround can be deleted")
  const directory = mkdtempSync(path.join(tmpdir(), "mtm-location-break-schema-"))
  const file = path.join(directory, "schema.prisma")
  writeFileSync(file, stripped)
  return file
}

/** The day starts three hours ago; every instant is minutes into it, on a whole second. */
const DAY_STARTED_AT = new Date(Math.floor(Date.now() / 1000) * 1000 - 3 * 60 * 60_000)
const at = (minutes: number) => new Date(DAY_STARTED_AT.getTime() + minutes * 60_000)

/** `appliedMinute` is when the server applied it, where that differs from when it happened. */
type JournalEvent = { type: "START" | "PAUSE" | "RESUME" | "FINISH" | "REOPEN"; minute: number; appliedMinute?: number }
type SentPoint = { clientLocationId: string; minute: number }
type BatchAnswer = {
  data?: { appliedClientLocationIds: string[]; replayedClientLocationIds: string[]; pausedClientLocationIds?: string[] }
  error?: string
  code?: string
  clientLocationId?: string
}

const pgDescribe = scratch ? describe : describe.skip

pgDescribe("GPS recorded during a break on a real Postgres", () => {
  type Prisma = typeof import("@/lib/prisma").prisma
  let prisma!: Prisma
  let bypass!: typeof import("@/lib/rls-context").runWithRlsBypass
  let postBatch!: typeof import("@/app/api/v2/mtm/mobile/location/batch/route").POST
  let postPoint!: typeof import("@/app/api/v1/mtm/mobile/location/route").POST
  let postWeb!: typeof import("@/app/api/v1/mtm/locations/route").POST
  let getNotifications!: typeof import("@/app/api/v1/mtm/mobile/notifications/route").GET
  let sequence = 0

  beforeAll(async () => {
    prismaCli(["db", "execute", "--url", adminUrl!, "--stdin"], process.env, `DROP DATABASE IF EXISTS "${scratch!.name}" WITH (FORCE)`)
    prismaCli(["db", "execute", "--url", adminUrl!, "--stdin"], process.env, `CREATE DATABASE "${scratch!.name}"`)
    prismaCli(
      ["db", "push", "--schema", schemaWithoutEmbeddings(), "--skip-generate", "--accept-data-loss"],
      { ...process.env, DATABASE_URL: scratch!.url },
    )
    prisma = (await import("@/lib/prisma")).prisma
    bypass = (await import("@/lib/rls-context")).runWithRlsBypass
    postBatch = (await import("@/app/api/v2/mtm/mobile/location/batch/route")).POST
    postPoint = (await import("@/app/api/v1/mtm/mobile/location/route")).POST
    postWeb = (await import("@/app/api/v1/mtm/locations/route")).POST
    getNotifications = (await import("@/app/api/v1/mtm/mobile/notifications/route")).GET
    await bypass(() => prisma.organization.create({
      data: { id: ORG, name: "Tenant with field agents", slug: ORG, modules: { mtm: true, "route-field": true } },
    }))
  }, 300_000)

  afterAll(async () => {
    await prisma?.$disconnect()
    if (scratch) prismaCli(["db", "execute", "--url", adminUrl!, "--stdin"], process.env, `DROP DATABASE IF EXISTS "${scratch.name}" WITH (FORCE);`)
  }, 60_000)

  /**
   * A field agent on a phone enrolled in the batch pilot, with today's shift
   * and its journal as the workday routes leave them. `shift: null` is an
   * agent who has not started a day at all.
   */
  async function agentWithDay(shift: { status: "STARTED" | "PAUSED" | "COMPLETED"; journal: JournalEvent[] } | null) {
    const agentId = `agent-${++sequence}`
    const workdayId = `workday-${sequence}`
    await bypass(() => prisma.mtmAgent.create({ data: { id: agentId, organizationId: ORG, name: `Field agent ${sequence}` } }))
    await bypass(() => prisma.mtmMobileSyncCohort.create({
      data: { organizationId: ORG, stream: "gps", agentId, deviceId: DEVICE, enabled: true },
    }))
    if (shift) {
      const lastOf = (type: JournalEvent["type"]) => shift.journal.filter((event) => event.type === type).at(-1)
      await bypass(() => prisma.mtmAgentWorkday.create({
        data: {
          id: workdayId,
          organizationId: ORG,
          agentId,
          workDate: new Date(`${DAY_STARTED_AT.toISOString().slice(0, 10)}T00:00:00.000Z`),
          status: shift.status,
          startedAt: DAY_STARTED_AT,
          pausedAt: shift.status === "PAUSED" ? at((lastOf("PAUSE") ?? lastOf("REOPEN"))!.minute) : null,
          completedAt: shift.status === "COMPLETED" ? at(lastOf("FINISH")!.minute) : null,
        },
      }))
      const journal: JournalEvent[] = [{ type: "START", minute: 0 }, ...shift.journal]
      await bypass(() => prisma.mtmAgentWorkdayEvent.createMany({
        data: journal.map((event) => ({
          organizationId: ORG,
          agentId,
          workdayId,
          type: event.type,
          occurredAt: at(event.minute),
          appliedAt: at(event.appliedMinute ?? event.minute),
        })),
      }))
    }
    return { agentId, workdayId }
  }

  function callAs(agentId: string) {
    caller.current = {
      orgId: ORG,
      agentId,
      userId: `user-of-${agentId}`,
      role: "AGENT",
      email: `${agentId}@example.test`,
      name: "Field agent",
      tenantCapabilities: { routeField: true, workforceHrm: true },
    }
  }

  const payload = (point: SentPoint) => ({
    clientLocationId: point.clientLocationId,
    // The coordinate says which point it is, so a stored row can be told apart.
    latitude: 40 + point.minute / 10_000,
    longitude: 49.8,
    accuracy: 8,
    speed: 2,
    recordedAt: at(point.minute).toISOString(),
  })

  async function sendBatch(agentId: string, points: SentPoint[]) {
    callAs(agentId)
    const response = await postBatch(new NextRequest(BATCH_URL, {
      method: "POST",
      headers: { Authorization: "Bearer mobile", "content-type": "application/json", "x-field-device-id": DEVICE },
      body: JSON.stringify({ points: points.map(payload) }),
    }))
    return { status: response.status, body: await response.json() as BatchAnswer }
  }

  async function sendPoint(agentId: string, point: SentPoint) {
    callAs(agentId)
    const response = await postPoint(new NextRequest(POINT_URL, {
      method: "POST",
      headers: { Authorization: "Bearer mobile", "content-type": "application/json" },
      body: JSON.stringify(payload(point)),
    }))
    return response.status
  }

  /** A point written for that employee by the organization's administrator, or by an integration's key. */
  async function sendForEmployee(agentId: string, minute: number) {
    const { latitude, longitude, accuracy, speed, recordedAt } = payload({ clientLocationId: "", minute })
    const response = await postWeb(new NextRequest(WEB_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agentId, latitude, longitude, accuracy, speed, recordedAt }),
    }))
    return { status: response.status, body: await response.json() as { code?: string } }
  }

  /** What the table holds for that agent: the minute of the day each stored point was taken at. */
  async function storedMinutes(agentId: string): Promise<number[]> {
    const rows: Array<{ recordedAt: Date }> = await bypass(() => prisma.mtmAgentLocation.findMany({
      where: { organizationId: ORG, agentId },
      orderBy: { recordedAt: "asc" },
      select: { recordedAt: true },
    }))
    return rows.map((row) => (row.recordedAt.getTime() - DAY_STARTED_AT.getTime()) / 60_000)
  }

  /** Where the live map draws the agent: the minute of the point its marker stands on. */
  async function markerMinute(agentId: string): Promise<number | null> {
    const row: { recordedAt: Date } | null = await bypass(() => prisma.mtmAgentLatestLocation.findUnique({
      where: { organizationId_agentId: { organizationId: ORG, agentId } },
      select: { recordedAt: true },
    }))
    return row ? (row.recordedAt.getTime() - DAY_STARTED_AT.getTime()) / 60_000 : null
  }

  /** What the agent's row says of his app: when it was last heard from, and whether GPS made him «online». */
  async function presence(agentId: string): Promise<{ lastSeenAt: Date | null; isOnline: boolean }> {
    return bypass(() => prisma.mtmAgent.findUniqueOrThrow({ where: { id: agentId }, select: { lastSeenAt: true, isOnline: true } }))
  }

  /** The bell on the phone asking for its notifications, as it does every two minutes while the app is open. */
  async function pollBell(agentId: string) {
    callAs(agentId)
    const response = await getNotifications(new NextRequest(NOTIFICATIONS_URL, { headers: { Authorization: "Bearer mobile" } }))
    return response.status
  }

  // The demo clip «Marşrut & Sahə» (owner, 2026-10-20: production as in the
  // clip): on a break the agent's app still reads «Şəbəkədədir». No point is
  // accepted during a break, so the bell's poll is what keeps the app
  // present then — and it writes nothing about where he is.
  it("keeps the app present on a break from the bell's poll, and stores no place for it", async () => {
    const { agentId } = await agentWithDay({ status: "PAUSED", journal: [{ type: "PAUSE", minute: 120 }] })
    expect((await sendBatch(agentId, [{ clientLocationId: "before", minute: 110 }])).status).toBe(201)
    // Ten minutes later the map would already call his app gone.
    const tenMinutesAgo = new Date(Date.now() - 10 * 60_000)
    await bypass(() => prisma.mtmAgent.update({ where: { id: agentId }, data: { lastSeenAt: tenMinutesAgo } }))

    const asked = Date.now()
    expect(await pollBell(agentId)).toBe(200)

    const row = await presence(agentId)
    expect(row.lastSeenAt?.getTime()).toBeGreaterThanOrEqual(asked - 1_000)
    expect(row.isOnline).toBe(true)
    expect(await storedMinutes(agentId)).toEqual([110])
    expect(await markerMinute(agentId)).toBe(110)
  })

  it("makes nobody present who is at work, has finished or has not started: that stays a GPS fact", async () => {
    const tenMinutesAgo = new Date(Date.now() - 10 * 60_000)
    const people = [
      await agentWithDay({ status: "STARTED", journal: [] }),
      await agentWithDay({ status: "COMPLETED", journal: [{ type: "PAUSE", minute: 100 }, { type: "FINISH", minute: 120 }] }),
      await agentWithDay(null),
    ]
    for (const { agentId } of people) {
      await bypass(() => prisma.mtmAgent.update({ where: { id: agentId }, data: { lastSeenAt: tenMinutesAgo, isOnline: true } }))
      expect(await pollBell(agentId)).toBe(200)
      expect((await presence(agentId)).lastSeenAt?.getTime()).toBe(tenMinutesAgo.getTime())
      expect(await storedMinutes(agentId)).toEqual([])
    }
  })

  it("stores the work on both sides of a break and nothing taken inside it", async () => {
    const { agentId, workdayId } = await agentWithDay({
      status: "STARTED",
      journal: [{ type: "PAUSE", minute: 60 }, { type: "RESUME", minute: 90 }],
    })

    // As a device sends them after lunch: out of order, the break in the middle.
    const sent = await sendBatch(agentId, [
      { clientLocationId: "after", minute: 100 },
      { clientLocationId: "lunch-1", minute: 65 },
      { clientLocationId: "before", minute: 50 },
      { clientLocationId: "lunch-2", minute: 85 },
    ])

    expect(await storedMinutes(agentId)).toEqual([50, 100])
    expect(await markerMinute(agentId)).toBe(100)
    expect(sent.status).toBe(201)
    expect(sent.body.data).toEqual({
      appliedClientLocationIds: ["before", "after"],
      replayedClientLocationIds: [],
      pausedClientLocationIds: ["lunch-1", "lunch-2"],
    })
    const rows: Array<{ workdayId: string | null }> = await bypass(() => prisma.mtmAgentLocation.findMany({
      where: { organizationId: ORG, agentId },
      select: { workdayId: true },
    }))
    expect(rows.map((row) => row.workdayId)).toEqual([workdayId, workdayId])
  })

  it("records nothing taken inside a break that is still running", async () => {
    const { agentId } = await agentWithDay({ status: "PAUSED", journal: [{ type: "PAUSE", minute: 120 }] })

    const sent = await sendBatch(agentId, [
      { clientLocationId: "before", minute: 110 },
      { clientLocationId: "lunch-1", minute: 130 },
      { clientLocationId: "lunch-2", minute: 175 },
    ])

    expect(await storedMinutes(agentId)).toEqual([110])
    // The marker stays where the work stopped, not where lunch is.
    expect(await markerMinute(agentId)).toBe(110)
    expect(sent.status).toBe(201)
    expect(sent.body.data).toEqual({
      appliedClientLocationIds: ["before"],
      replayedClientLocationIds: [],
      pausedClientLocationIds: ["lunch-1", "lunch-2"],
    })

    // A batch of nothing but the break: accepted, so the device stops holding
    // those coordinates, and not a row more.
    const onlyLunch = await sendBatch(agentId, [
      { clientLocationId: "lunch-3", minute: 140 },
      { clientLocationId: "lunch-4", minute: 178 },
    ])
    expect(await storedMinutes(agentId)).toEqual([110])
    expect(await markerMinute(agentId)).toBe(110)
    expect(onlyLunch.status).toBe(200)
    expect(onlyLunch.body.data).toEqual({
      appliedClientLocationIds: [],
      replayedClientLocationIds: [],
      pausedClientLocationIds: ["lunch-3", "lunch-4"],
    })
  })

  it("gives a retried batch the same answer and the table the same rows", async () => {
    const { agentId } = await agentWithDay({
      status: "STARTED",
      journal: [{ type: "PAUSE", minute: 60 }, { type: "RESUME", minute: 90 }],
    })
    const batch = [
      { clientLocationId: "before", minute: 50 },
      { clientLocationId: "lunch", minute: 75 },
      { clientLocationId: "after", minute: 100 },
    ]
    expect((await sendBatch(agentId, batch)).status).toBe(201)

    const retried = await sendBatch(agentId, batch)

    expect(await storedMinutes(agentId)).toEqual([50, 100])
    expect(retried.status).toBe(200)
    expect(retried.body.data).toEqual({
      appliedClientLocationIds: [],
      replayedClientLocationIds: ["before", "after"],
      pausedClientLocationIds: ["lunch"],
    })
  })

  it("treats the gap a manager's reopen leaves after the finish as a break", async () => {
    // Finished at 60, reopened by the manager at 100 — the REOPEN is recorded
    // at the instant of the finish it reopens — and resumed at 120. Without the
    // REOPEN row the stretch from 60 to 120 would read as work.
    const { agentId } = await agentWithDay({
      status: "STARTED",
      journal: [
        { type: "FINISH", minute: 60 },
        { type: "REOPEN", minute: 60, appliedMinute: 100 },
        { type: "RESUME", minute: 120 },
      ],
    })

    const sent = await sendBatch(agentId, [
      { clientLocationId: "before-finish", minute: 50 },
      { clientLocationId: "after-finish", minute: 90 },
      { clientLocationId: "after-resume", minute: 130 },
    ])

    expect(await storedMinutes(agentId)).toEqual([50, 130])
    expect(sent.status).toBe(201)
    expect(sent.body.data?.pausedClientLocationIds).toEqual(["after-finish"])
  })

  it("keeps the same points of the same day as the single-point route", async () => {
    const journal: JournalEvent[] = [{ type: "PAUSE", minute: 60 }, { type: "RESUME", minute: 90 }]
    // Before, at the second the break began, inside it, at the second it ended, after.
    const minutes = [50, 60, 75, 90, 100]
    const one = await agentWithDay({ status: "STARTED", journal })
    const many = await agentWithDay({ status: "STARTED", journal })

    const answers: number[] = []
    for (const minute of minutes) {
      answers.push(await sendPoint(one.agentId, { clientLocationId: `single-${minute}`, minute }))
    }
    const batch = await sendBatch(many.agentId, minutes.map((minute) => ({ clientLocationId: `batch-${minute}`, minute })))

    // The boundary belongs to work on both ends; only the point inside is refused.
    expect(answers).toEqual([200, 200, 409, 200, 200])
    expect(await storedMinutes(one.agentId)).toEqual([50, 60, 90, 100])
    expect(await storedMinutes(many.agentId)).toEqual(await storedMinutes(one.agentId))
    expect(batch.body.data?.pausedClientLocationIds).toEqual(["batch-75"])
  })

  it("stores every point of a day without breaks, as before", async () => {
    const { agentId } = await agentWithDay({ status: "STARTED", journal: [] })

    const sent = await sendBatch(agentId, [
      { clientLocationId: "morning", minute: 10 },
      { clientLocationId: "noon", minute: 90 },
      { clientLocationId: "now", minute: 179 },
    ])

    expect(sent.status).toBe(201)
    expect(sent.body.data).toMatchObject({
      appliedClientLocationIds: ["morning", "noon", "now"],
      replayedClientLocationIds: [],
    })
    expect(await storedMinutes(agentId)).toEqual([10, 90, 179])
  })

  it("still refuses a batch from an agent who has not started a day", async () => {
    const { agentId } = await agentWithDay(null)

    const sent = await sendBatch(agentId, [{ clientLocationId: "no-day", minute: 30 }])

    expect(sent.status).toBe(409)
    expect(sent.body).toEqual({
      error: "an active or explicitly supplied workday is required",
      code: "MTM_LOCATION_WORKDAY_REQUIRED",
    })
    expect(await storedMinutes(agentId)).toEqual([])
  })

  // The web entry takes nothing older than five minutes, so these days are
  // laid out around «a minute or two ago» (the day began three hours ago).
  describe("written for an employee from the web or by an integration's key", () => {
    it("is refused while the break runs, and the marker stays where the work stopped", async () => {
      const { agentId } = await agentWithDay({ status: "PAUSED", journal: [{ type: "PAUSE", minute: 120 }] })
      expect((await sendBatch(agentId, [{ clientLocationId: "before", minute: 110 }])).status).toBe(201)

      const sent = await sendForEmployee(agentId, 179)

      expect(await storedMinutes(agentId)).toEqual([110])
      expect(await markerMinute(agentId)).toBe(110)
      expect(sent.status).toBe(409)
      expect(sent.body.code).toBe("MTM_LOCATION_WORKDAY_PAUSED")
    })

    it("is refused for a moment inside a break that has just ended, and written for one after it", async () => {
      const { agentId } = await agentWithDay({
        status: "STARTED",
        journal: [{ type: "PAUSE", minute: 177 }, { type: "RESUME", minute: 178.5 }],
      })

      const inside = await sendForEmployee(agentId, 178)
      const after = await sendForEmployee(agentId, 179)

      expect(await storedMinutes(agentId)).toEqual([179])
      expect(inside.status).toBe(409)
      expect(after.status).toBe(201)
    })

    it("is refused in the gap a manager's reopen leaves after the finish", async () => {
      // Finished at 100, reopened at 170 and not resumed yet: the row reads
      // PAUSED, and the break in the journal is the REOPEN, not a PAUSE.
      const { agentId } = await agentWithDay({
        status: "PAUSED",
        journal: [{ type: "FINISH", minute: 100 }, { type: "REOPEN", minute: 100, appliedMinute: 170 }],
      })

      const sent = await sendForEmployee(agentId, 179)

      expect(await storedMinutes(agentId)).toEqual([])
      expect(sent.status).toBe(409)
    })

    it("is written for somebody who is working, and for somebody with no shift at all, as before", async () => {
      const working = await agentWithDay({
        status: "STARTED",
        journal: [{ type: "PAUSE", minute: 60 }, { type: "RESUME", minute: 90 }],
      })
      const finished = await agentWithDay({ status: "COMPLETED", journal: [{ type: "FINISH", minute: 150 }] })
      const noShift = await agentWithDay(null)

      for (const { agentId } of [working, finished, noShift]) {
        expect((await sendForEmployee(agentId, 179)).status).toBe(201)
        expect(await storedMinutes(agentId)).toEqual([179])
      }
    })
  })

  it("still refuses the whole batch for a point outside the workday", async () => {
    const { agentId } = await agentWithDay({
      status: "STARTED",
      journal: [{ type: "PAUSE", minute: 60 }, { type: "RESUME", minute: 90 }],
    })

    const sent = await sendBatch(agentId, [
      { clientLocationId: "work", minute: 50 },
      { clientLocationId: "before-the-day", minute: -5 },
    ])

    expect(sent.status).toBe(409)
    expect(sent.body).toEqual({
      error: "a point is outside the supplied workday",
      code: "MTM_LOCATION_OUTSIDE_WORKDAY",
      clientLocationId: "before-the-day",
    })
    expect(await storedMinutes(agentId)).toEqual([])
  })

  /**
   * The owner's line of 2026-10-15: from 3 km/h as a screen shows it. The
   * speeds are production's: a standing phone's GPS jitter is stored at
   * 1–2.4 km/h, a walk at 3–4, a drive at tens; the app sends no speed at all
   * for Android's 0. Until that day both routes stored everything above
   * 1 km/h as moving, and a phone lying on a counter ended its own stop some
   * fifty times a day.
   */
  describe("which points are stored as moving", () => {
    type Fix = { clientLocationId: string; minute: number; speed: number | null; north?: number }
    const fixPayload = (fix: Fix) => ({
      clientLocationId: fix.clientLocationId,
      latitude: 40.4 + (fix.north ?? 0) / 111_195,
      longitude: 49.8,
      accuracy: 8,
      ...(fix.speed == null ? {} : { speed: fix.speed }),
      recordedAt: at(fix.minute).toISOString(),
    })
    const SPEEDS = [null, 1.4, 2.4, 2.5, 3.4, 52.2]
    /** «2 km/h» on a screen stands; «3 km/h» moves. */
    const MOVING = [false, false, false, true, true, true]
    const fixes = (prefix: string, firstMinute: number): Fix[] =>
      SPEEDS.map((speed, index) => ({ clientLocationId: `${prefix}-${index}`, minute: firstMinute + index, speed }))

    async function sendFixesInBatch(agentId: string, sent: Fix[]) {
      callAs(agentId)
      const response = await postBatch(new NextRequest(BATCH_URL, {
        method: "POST",
        headers: { Authorization: "Bearer mobile", "content-type": "application/json", "x-field-device-id": DEVICE },
        body: JSON.stringify({ points: sent.map(fixPayload) }),
      }))
      return response.status
    }

    async function sendFix(agentId: string, fix: Fix) {
      callAs(agentId)
      const response = await postPoint(new NextRequest(POINT_URL, {
        method: "POST",
        headers: { Authorization: "Bearer mobile", "content-type": "application/json" },
        body: JSON.stringify(fixPayload(fix)),
      }))
      return response.status
    }

    async function stored(agentId: string) {
      const rows: Array<{ speed: number | null; isMoving: boolean }> = await bypass(() => prisma.mtmAgentLocation.findMany({
        where: { organizationId: ORG, agentId },
        orderBy: { recordedAt: "asc" },
        select: { speed: true, isMoving: true },
      }))
      return rows
    }

    async function stop(agentId: string) {
      return bypass(() => prisma.mtmAgentLatestLocation.findUniqueOrThrow({
        where: { organizationId_agentId: { organizationId: ORG, agentId } },
        select: { stationarySince: true, stationaryConfirmedAt: true },
      }))
    }

    it("the batch route stores a point as moving from what a screen shows as 3 km/h", async () => {
      const { agentId } = await agentWithDay({ status: "STARTED", journal: [] })

      expect(await sendFixesInBatch(agentId, fixes("batch", 20))).toBe(201)

      expect(await stored(agentId)).toEqual(SPEEDS.map((speed, index) => ({ speed, isMoving: MOVING[index] })))
    })

    it("the single-point route stores the same flags for the same speeds", async () => {
      const { agentId } = await agentWithDay({ status: "STARTED", journal: [] })

      for (const fix of fixes("single", 20)) expect(await sendFix(agentId, fix)).toBe(200)

      expect(await stored(agentId)).toEqual(SPEEDS.map((speed, index) => ({ speed, isMoving: MOVING[index] })))
    })

    it("a standing phone's jitter keeps the stop the live map counts; a walk ends it", async () => {
      const { agentId } = await agentWithDay({ status: "STARTED", journal: [] })
      const standing: Fix[] = [
        { clientLocationId: "lay-down", minute: 40, speed: null },
        { clientLocationId: "jitter-1", minute: 41, speed: 1.4, north: 6 },
        { clientLocationId: "jitter-2", minute: 42, speed: 2.4, north: -7 },
        { clientLocationId: "jitter-3", minute: 43, speed: 1.9, north: 4 },
      ]

      expect(await sendFixesInBatch(agentId, standing)).toBe(201)
      expect(await stop(agentId)).toEqual({ stationarySince: at(40), stationaryConfirmedAt: at(43) })

      // The single-point route keeps it too.
      expect(await sendFix(agentId, { clientLocationId: "jitter-4", minute: 44, speed: 2.2, north: -5 })).toBe(200)
      expect(await stop(agentId)).toEqual({ stationarySince: at(40), stationaryConfirmedAt: at(44) })

      // He picks the phone up and walks out at 3.4 km/h.
      expect(await sendFixesInBatch(agentId, [{ clientLocationId: "walk", minute: 45, speed: 3.4, north: 25 }])).toBe(201)
      expect(await stop(agentId)).toEqual({ stationarySince: null, stationaryConfirmedAt: null })
    })
  })
})
