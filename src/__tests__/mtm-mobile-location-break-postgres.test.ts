/**
 * Where an employee spent a break is not stored — read off the table, after
 * the real ingestion handlers have run over a real Postgres.
 *
 * A break is the employee's own time (owner's rule). The single-point route,
 * POST /api/v1/mtm/mobile/location, has refused a point recorded inside one
 * since A7. The batch route, POST /api/v2/mtm/mobile/location/batch, checked
 * only the workday window until 2026-10-11: a device in the batch pilot could
 * record where the break was spent, and the live-map marker followed it there.
 *
 * What is asked here is what the table holds afterwards, not what the handler
 * was seen to call: a mocked Prisma answers any query, including the journal
 * read this rule depends on. Both handlers run with the real mobile wrapper,
 * the real RLS scope and the real Prisma client over a scratch database built
 * from schema.prisma. Two things are stand-ins: who is calling (the mobile
 * token) and the batch rate limiter, which is not the subject and would stop
 * the seventh batch of a device within a minute.
 *
 * Every instant is taken relative to now — the handlers refuse the future and
 * anything older than a week — so nothing here depends on the date.
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
})
