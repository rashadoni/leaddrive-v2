/**
 * A forgotten field workday closes itself at the company's hour — read off the
 * tables, after the real job, the real workday state machine, the real GPS
 * route and the real settings route ran over a real Postgres.
 *
 * Why it exists (client via the owner, 2026-11-21): 9 of one agent's 11 days
 * stayed open past their date and 19 433 of his 24 400 GPS points were taken
 * after 20:00. What must hold is what the tables say afterwards: when the day
 * ended, that nobody it does not apply to was closed, and that the phone's next
 * point is refused. A mocked Prisma would agree with any of it.
 *
 * Every instant is on yesterday's date in Baku: the GPS route refuses the
 * future, and the job takes its clock as an argument.
 *
 * Set MTM_LOCATION_BREAK_TEST_DATABASE_URL to an admin connection, e.g.
 *   docker run --rm -e POSTGRES_PASSWORD=postgres -p 127.0.0.1:55499:5432 postgres:16
 * Without it the suite is skipped; CI runs it in the same step as the break
 * coordinates gate, whose `MTM_LOCATION_BREAK_DB_GATE=required` makes a missing
 * URL a failure.
 */
import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { NextRequest } from "next/server"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

const adminUrl = process.env.MTM_LOCATION_BREAK_TEST_DATABASE_URL
if (!adminUrl && process.env.MTM_LOCATION_BREAK_DB_GATE === "required") {
  throw new Error("MTM_LOCATION_BREAK_TEST_DATABASE_URL is required by the MTM break coordinates database gate")
}

const scratch = vi.hoisted(() => {
  const admin = process.env.MTM_LOCATION_BREAK_TEST_DATABASE_URL
  if (!admin) return null
  const name = `mtm_workday_auto_close_${process.pid}`
  const url = new URL(admin)
  url.pathname = `/${name}`
  process.env.DATABASE_URL = url.toString()
  return { name, url: url.toString() }
})

const caller = vi.hoisted(() => ({ current: null as Record<string, unknown> | null, webRole: "admin" }))

vi.mock("@/lib/mobile-auth", async () => {
  const { makeMobileAuthMock } = await import("./mocks/mobile-auth")
  const mock = makeMobileAuthMock()
  mock.resolveMobileAuth.mockImplementation(async () => caller.current)
  return mock
})
vi.mock("@/lib/api-auth", () => ({
  getOrgId: vi.fn(),
  getSession: vi.fn().mockResolvedValue(null),
  requireAuth: vi.fn(async () => ({
    orgId: "org-auto-close",
    userId: "admin-user",
    role: caller.webRole,
    email: "admin@example.test",
    name: "Admin",
    principalType: "session",
  })),
  isAuthError: (value: unknown) => value instanceof Response,
}))
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
const ORG = "org-auto-close"
const OTHER_ORG = "org-switch-off"

function prismaCli(args: string[], env: NodeJS.ProcessEnv, input?: string) {
  const result = spawnSync(process.execPath, [PRISMA_CLI, ...args], { input, encoding: "utf8", env })
  if (result.status !== 0) {
    throw new Error(`prisma ${args.join(" ")} failed\n${result.error ?? ""}\n${result.stdout}\n${result.stderr}`)
  }
}

function schemaWithoutEmbeddings(): string {
  const schema = readFileSync(path.join(ROOT, "prisma/schema.prisma"), "utf8")
  const stripped = schema.split("\n").filter((line) => !/Unsupported\("vector/.test(line)).join("\n")
  if (stripped === schema) throw new Error("no pgvector column found — this workaround can be deleted")
  const directory = mkdtempSync(path.join(tmpdir(), "mtm-workday-auto-close-schema-"))
  const file = path.join(directory, "schema.prisma")
  writeFileSync(file, stripped)
  return file
}

const bakuKey = (value: Date) => new Date(value.getTime() + 4 * 3_600_000).toISOString().slice(0, 10)
const YESTERDAY = bakuKey(new Date(Date.now() - 86_400_000))
const BEFORE_YESTERDAY = bakuKey(new Date(Date.now() - 2 * 86_400_000))
const on = (key: string, clock: string) => new Date(`${key}T${clock}:00.000+04:00`)
const at = (clock: string) => on(YESTERDAY, clock)

const pgDescribe = scratch ? describe : describe.skip

pgDescribe("a forgotten workday closes at the company's hour, on a real Postgres", () => {
  type Prisma = typeof import("@/lib/prisma").prisma
  let prisma!: Prisma
  let bypass!: typeof import("@/lib/rls-context").runWithRlsBypass
  let job!: typeof import("@/lib/cron/mtm-workday-auto-close-job").executeMtmWorkdayAutoCloseJob
  let postPoint!: typeof import("@/app/api/v1/mtm/mobile/location/route").POST
  let putSettings!: typeof import("@/app/api/v1/mtm/settings/route").PUT
  let workdayLib!: typeof import("@/lib/mtm/workday")
  let returnDay!: typeof import("@/lib/mtm/workday-return").returnOwnMtmWorkday
  let sequence = 0
  const delivered: Array<{ organizationId: string; agentId: string; workdayId: string; title: string; body: string }> = []

  const run = (now: Date) => bypass(() => job(now, async (organizationId, notice) => { delivered.push({ organizationId, ...notice }) }))

  beforeAll(async () => {
    prismaCli(["db", "execute", "--url", adminUrl!, "--stdin"], process.env, `DROP DATABASE IF EXISTS "${scratch!.name}" WITH (FORCE)`)
    prismaCli(["db", "execute", "--url", adminUrl!, "--stdin"], process.env, `CREATE DATABASE "${scratch!.name}"`)
    prismaCli(
      ["db", "push", "--schema", schemaWithoutEmbeddings(), "--skip-generate", "--accept-data-loss"],
      { ...process.env, DATABASE_URL: scratch!.url },
    )
    prisma = (await import("@/lib/prisma")).prisma
    bypass = (await import("@/lib/rls-context")).runWithRlsBypass
    job = (await import("@/lib/cron/mtm-workday-auto-close-job")).executeMtmWorkdayAutoCloseJob
    postPoint = (await import("@/app/api/v1/mtm/mobile/location/route")).POST
    putSettings = (await import("@/app/api/v1/mtm/settings/route")).PUT
    workdayLib = await import("@/lib/mtm/workday")
    returnDay = (await import("@/lib/mtm/workday-return")).returnOwnMtmWorkday
    await bypass(async () => {
      for (const id of [ORG, OTHER_ORG]) {
        await prisma.organization.create({ data: { id, name: id, slug: id, modules: { mtm: true, "route-field": true } } })
      }
      await prisma.mtmCustomer.create({ data: { id: "customer-1", organizationId: ORG, name: "Clinic" } })
      await prisma.mtmSetting.createMany({
        data: [
          { organizationId: ORG, key: "timezone", value: "Asia/Baku" },
          { organizationId: ORG, key: "workdayAutoCloseEnabled", value: true },
          { organizationId: ORG, key: "workdayAutoCloseHour", value: 20 },
          { organizationId: ORG, key: "workdayAutoCloseSince", value: at("00:01").toISOString() },
          { organizationId: OTHER_ORG, key: "workdayAutoCloseEnabled", value: false },
          { organizationId: OTHER_ORG, key: "workdayAutoCloseSince", value: at("00:01").toISOString() },
        ],
      })
    })
  }, 300_000)

  afterAll(async () => {
    await prisma?.$disconnect()
    if (scratch) prismaCli(["db", "execute", "--url", adminUrl!, "--stdin"], process.env, `DROP DATABASE IF EXISTS "${scratch.name}" WITH (FORCE);`)
  }, 60_000)

  beforeEach(() => { delivered.length = 0 })

  async function openDay(options: {
    organizationId?: string
    date?: string
    startedAt?: Date
    role?: "AGENT" | "EMPLOYEE" | "MANAGER"
    attendanceParticipant?: boolean
    pausedAt?: Date
  } = {}) {
    const organizationId = options.organizationId ?? ORG
    const agentId = `agent-${++sequence}`
    const workdayId = `workday-${sequence}`
    const date = options.date ?? YESTERDAY
    const startedAt = options.startedAt ?? on(date, "10:00")
    await bypass(async () => {
      await prisma.mtmAgent.create({
        data: { id: agentId, organizationId, name: `Person ${sequence}`, role: options.role ?? "AGENT", attendanceParticipant: options.attendanceParticipant ?? false, isOnline: true },
      })
      await prisma.mtmAgentWorkday.create({
        data: {
          id: workdayId, organizationId, agentId, workDate: new Date(`${date}T00:00:00.000Z`),
          status: options.pausedAt ? "PAUSED" : "STARTED", startedAt, pausedAt: options.pausedAt ?? null,
        },
      })
      await prisma.mtmAgentWorkdayEvent.create({
        data: { organizationId, agentId, workdayId, clientEventId: `start-${workdayId}`, type: "START", occurredAt: startedAt, appliedAt: startedAt },
      })
      if (options.pausedAt) {
        await prisma.mtmAgentWorkdayEvent.create({
          data: { organizationId, agentId, workdayId, clientEventId: `pause-${workdayId}`, type: "PAUSE", occurredAt: options.pausedAt, appliedAt: options.pausedAt },
        })
      }
    })
    return { agentId, workdayId }
  }

  const day = (workdayId: string) => bypass(() => prisma.mtmAgentWorkday.findUniqueOrThrow({
    where: { id: workdayId },
    select: { status: true, completedAt: true, totalPausedSeconds: true, pausedAt: true },
  }))
  const finishes = (workdayId: string): Promise<Array<{ clientEventId: string | null; occurredAt: Date }>> => bypass(() => prisma.mtmAgentWorkdayEvent.findMany({
    where: { workdayId, type: "FINISH" },
    orderBy: { occurredAt: "asc" },
    select: { clientEventId: true, occurredAt: true },
  }))
  const visit = (agentId: string, checkInAt: Date, checkOutAt: Date | null) => bypass(() => prisma.mtmVisit.create({
    data: { organizationId: ORG, agentId, customerId: "customer-1", status: checkOutAt ? "CHECKED_OUT" : "CHECKED_IN", checkInAt, checkOutAt },
  }))

  async function sendPoint(agentId: string, workdayId: string, recordedAt: Date) {
    caller.current = {
      orgId: ORG, agentId, userId: `user-of-${agentId}`, role: "AGENT",
      email: `${agentId}@example.test`, name: "Field agent",
      tenantCapabilities: { routeField: true, workforceHrm: true },
    }
    const response = await postPoint(new NextRequest("http://localhost:3000/api/v1/mtm/mobile/location", {
      method: "POST",
      headers: { Authorization: "Bearer mobile", "content-type": "application/json" },
      body: JSON.stringify({
        clientLocationId: `point-${agentId}-${recordedAt.getTime()}`, workdayId, latitude: 40.4, longitude: 49.8, accuracy: 8, speed: 2,
        recordedAt: recordedAt.toISOString(),
      }),
    }))
    return { status: response.status, body: await response.json() as { code?: string } }
  }

  it("leaves the day alone before the hour, closes it at the hour, once, and tells the agent", async () => {
    const { agentId, workdayId } = await openDay()

    await run(at("19:58"))
    expect((await day(workdayId)).status).toBe("STARTED")

    // The job comes by a couple of minutes late; the day still ended at 20:00.
    const summary = await run(at("20:02"))
    expect(summary.failed).toBe(0)
    const closed = await day(workdayId)
    expect(closed.status).toBe("COMPLETED")
    expect(closed.completedAt?.toISOString()).toBe(at("20:00").toISOString())
    const journal = await finishes(workdayId)
    expect(journal).toHaveLength(1)
    expect(workdayLib.isMtmWorkdayAutoCloseEventKey(journal[0].clientEventId)).toBe(true)
    const agent = await bypass(() => prisma.mtmAgent.findUniqueOrThrow({ where: { id: agentId }, select: { isOnline: true } }))
    expect(agent.isOnline).toBe(false)

    expect(delivered.filter((entry) => entry.agentId === agentId)).toHaveLength(1)
    const bell = await bypass(() => prisma.mtmNotification.findMany({ where: { agentId }, select: { title: true, body: true } }))
    expect(bell).toHaveLength(1)
    expect(bell[0].title).toBe("İş günü avtomatik bağlandı")
    expect(bell[0].body).toContain("20:00")

    await run(at("20:07"))
    expect(await finishes(workdayId)).toHaveLength(1)
    expect(delivered.filter((entry) => entry.agentId === agentId)).toHaveLength(1)
  })

  it("refuses the phone's GPS point taken after the close and keeps the one before it", async () => {
    const { agentId, workdayId } = await openDay()
    await run(at("20:02"))

    expect((await sendPoint(agentId, workdayId, at("19:55"))).status).toBeLessThan(300)
    const after = await sendPoint(agentId, workdayId, at("20:10"))
    expect(after.status).toBe(409)
    expect(after.body.code).toBe("MTM_LOCATION_OUTSIDE_WORKDAY")
    const stored = await bypass(() => prisma.mtmAgentLocation.findMany({ where: { agentId }, select: { recordedAt: true } }))
    expect(stored.map((row: { recordedAt: Date }) => row.recordedAt.toISOString())).toEqual([at("19:55").toISOString()])
  })

  it("counts a break running at the hour as a break, up to the close", async () => {
    const { workdayId } = await openDay({ pausedAt: at("19:30") })
    await run(at("20:02"))
    const closed = await day(workdayId)
    expect(closed.status).toBe("COMPLETED")
    expect(closed.pausedAt).toBeNull()
    expect(closed.totalPausedSeconds).toBe(30 * 60)
  })

  it("waits for a visit in progress and ends the day when the visit ended", async () => {
    const { agentId, workdayId } = await openDay()
    const running = await visit(agentId, at("19:40"), null)

    await run(at("20:02"))
    expect((await day(workdayId)).status).toBe("STARTED")

    await bypass(() => prisma.mtmVisit.update({ where: { id: running.id }, data: { status: "CHECKED_OUT", checkOutAt: at("20:35") } }))
    await run(at("20:37"))
    const closed = await day(workdayId)
    expect(closed.status).toBe("COMPLETED")
    expect(closed.completedAt?.toISOString()).toBe(at("20:35").toISOString())
  })

  it("does not let a visit forgotten open keep the day open until morning", async () => {
    const { agentId, workdayId } = await openDay()
    await visit(agentId, at("19:40"), null)

    await run(at("23:50"))
    expect((await day(workdayId)).status).toBe("STARTED")
    await run(new Date(at("23:59").getTime() + 2 * 60_000))
    const closed = await day(workdayId)
    expect(closed.status).toBe("COMPLETED")
    expect(closed.completedAt?.toISOString()).toBe(at("23:59").toISOString())
  })

  it("a day begun after the hour closes at the end of its date", async () => {
    const { workdayId } = await openDay({ startedAt: at("20:30") })
    await run(at("20:32"))
    expect((await day(workdayId)).status).toBe("STARTED")
    await run(new Date(at("23:59").getTime() + 60_000))
    expect((await day(workdayId)).completedAt?.toISOString()).toBe(at("23:59").toISOString())
  })

  it("after «İşə qayıt» the hour does not close it again; the end of the date does", async () => {
    const { agentId, workdayId } = await openDay()
    await run(at("20:02"))
    expect((await day(workdayId)).status).toBe("COMPLETED")

    const back = await bypass(() => returnDay({ organizationId: ORG, agentId, workdayId, operationId: `back-${workdayId}`, now: at("20:10") }))
    expect(back.kind).toBe("success")
    expect((await day(workdayId)).status).toBe("STARTED")

    await run(at("20:17"))
    expect((await day(workdayId)).status).toBe("STARTED")

    await run(new Date(at("23:59").getTime() + 60_000))
    const closed = await day(workdayId)
    expect(closed.status).toBe("COMPLETED")
    expect(closed.completedAt?.toISOString()).toBe(at("23:59").toISOString())
    const journal = await finishes(workdayId)
    expect(journal).toHaveLength(2)
    expect(new Set(journal.map((event) => event.clientEventId)).size).toBe(2)
  })

  it("answers an «End day» sent by a phone that did not know yet with the closed day, not an error", async () => {
    const { agentId, workdayId } = await openDay()
    await run(at("20:02"))

    const late = at("20:05")
    const result = await bypass(() => prisma.$transaction((tx: Parameters<typeof workdayLib.applyMtmWorkdayEvent>[0] & object) => workdayLib.applyMtmWorkdayEvent(tx as never, { organizationId: ORG, agentId }, {
      action: "FINISH", workdayId, clientEventId: `phone-finish-${workdayId}`, occurredAt: late, claimedAt: late, capturedAt: late, queuedAt: late,
      serverReceivedAt: late, schemaVersion: 2, workDateKey: YESTERDAY, latitude: null, longitude: null, accuracy: null, note: null,
      attendanceReview: { state: "NOT_REQUIRED", reasonCode: null, policyVersion: workdayLib.WORKFORCE_ATTENDANCE_REVIEW_POLICY_VERSION, claimAgeSeconds: 0 },
    })))
    expect(result.status).toBe("ok")
    expect(await finishes(workdayId)).toHaveLength(1)
    expect((await day(workdayId)).completedAt?.toISOString()).toBe(at("20:00").toISOString())
  })

  it("touches no one it does not apply to", async () => {
    const office = await openDay({ role: "EMPLOYEE", attendanceParticipant: true })
    const onTimesheet = await openDay({ role: "MANAGER", attendanceParticipant: true })
    const beforeSwitch = await openDay({ date: BEFORE_YESTERDAY })
    const switchedOff = await openDay({ organizationId: OTHER_ORG })

    await run(new Date(at("23:59").getTime() + 60_000))

    for (const { workdayId } of [office, onTimesheet, beforeSwitch, switchedOff]) {
      expect((await day(workdayId)).status).toBe("STARTED")
      expect(await finishes(workdayId)).toHaveLength(0)
    }
  })

  it("a client cannot write the server's key", () => {
    const parsed = workdayLib.parseMtmWorkdayEvent(
      { action: "FINISH", workdayId: "workday-x", occurredAt: at("20:00").toISOString() },
      "auto-close:workday-x:0",
      "Asia/Baku",
      at("20:01"),
    )
    expect(parsed.input).toBeNull()
  })

  it("the settings route records the moment it was switched on, and only for an administrator", async () => {
    const put = (body: Record<string, unknown>) => putSettings(new NextRequest("http://localhost:3000/api/v1/mtm/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }), { params: Promise.resolve({}) } as never)
    const stored = async (key: string) => (await bypass(() => prisma.mtmSetting.findUnique({
      where: { organizationId_key: { organizationId: ORG, key } },
      select: { value: true },
    })))?.value

    caller.webRole = "manager"
    await put({ workdayAutoCloseHour: 21 })
    expect(await stored("workdayAutoCloseHour")).toBe(20)

    caller.webRole = "admin"
    expect((await put({ workdayAutoCloseHour: 9 })).status).toBe(400)
    expect(await stored("workdayAutoCloseHour")).toBe(20)

    const before = await stored("workdayAutoCloseSince")
    await put({ workdayAutoCloseEnabled: true })
    expect(await stored("workdayAutoCloseSince")).toBe(before)

    await put({ workdayAutoCloseEnabled: false })
    await put({ workdayAutoCloseEnabled: true })
    const since = await stored("workdayAutoCloseSince")
    expect(since).not.toBe(before)
    expect(Date.now() - Date.parse(String(since))).toBeLessThan(60_000)
  })
})
