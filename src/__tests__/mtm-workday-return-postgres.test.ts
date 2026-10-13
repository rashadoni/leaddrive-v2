/**
 * An employee returns to the workday they closed earlier today — on a real
 * PostgreSQL, under the production triggers and row-level security.
 *
 * Owner, 2026-10-13, having closed a day at 10:56 and found no way back:
 * «думаю, ограничение не имеет смысла, это ничего не предотвращает»; and of the
 * one condition proposed: «рекомендацию по ограничению в тот же календарный
 * день принимаю». What decides whether that works is in the database — a
 * completed workday leaves COMPLETED only against a ledger row whose own
 * trigger used to refuse the employee as its author — so nothing here is mocked.
 */
import { randomUUID } from "node:crypto"
import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

const adminUrl = process.env.MTM_WORKDAY_RETURN_TEST_DATABASE_URL
if (!adminUrl && process.env.MTM_WORKDAY_RETURN_DB_GATE === "required") {
  throw new Error("MTM_WORKDAY_RETURN_TEST_DATABASE_URL is required by the workday return database gate")
}

const scratch = vi.hoisted(() => {
  const admin = process.env.MTM_WORKDAY_RETURN_TEST_DATABASE_URL
  if (!admin) return null
  const name = `mtm_workday_return_${process.pid}_${Date.now()}`
  const role = `${name}_app`
  const db = new URL(admin)
  db.pathname = `/${name}`
  const app = new URL(db)
  app.username = role
  app.password = "workday-return-fixture-only"
  // `@/lib/prisma` builds its client from DATABASE_URL on first import: as the
  // application's own role, which no row-level security rule lets through.
  process.env.DATABASE_URL = app.toString()
  return { name, role, adminDb: db.toString() }
})

const PRISMA_CLI = createRequire(import.meta.url).resolve("prisma/build/index.js")

function sql(url: string, statement: string) {
  const result = spawnSync(process.execPath, [PRISMA_CLI, "db", "execute", "--url", url, "--stdin"], {
    input: statement, encoding: "utf8", timeout: 180_000, maxBuffer: 1024 * 1024,
  })
  if (result.status !== 0) {
    throw new Error(`workday return fixture SQL failed: ${String(result.stderr || result.stdout).replace(/postgres(?:ql)?:\/\/[^\s]+/g, "[test database]")}`)
  }
}
const migration = (name: string) => readFileSync(`prisma/migrations/${name}/migration.sql`, "utf8")

const pgDescribe = adminUrl ? describe : describe.skip

pgDescribe("returning to a workday closed earlier today, on a real PostgreSQL", () => {
  let prisma: typeof import("@/lib/prisma").prisma
  let tenant: typeof import("@/lib/rls-context").runWithTenant
  let bypass: typeof import("@/lib/rls-context").runWithRlsBypass
  let returning: typeof import("@/lib/mtm/workday-return")
  let workdays: typeof import("@/lib/mtm/workday")
  let pauses: typeof import("@/lib/mtm/workday-pauses")
  let createdRole = false
  let createdDb = false

  const ORG = "return-pg-org"
  /** A field agent as most of them are: an app login and no CRM user. */
  const FIELD = "return-pg-field-agent"
  /** An agent whose card is linked to a CRM user. */
  const LINKED = "return-pg-linked-agent"
  const LINKED_USER = "return-pg-linked-user"
  const MANAGER_USER = "return-pg-manager-user"
  /** Each scenario has its own employee: a day one test leaves open must not be what refuses another. */
  let people = 0
  async function employee(linked = false): Promise<{ agentId: string; userId: string | null }> {
    people += 1
    const agentId = `return-pg-agent-${people}`
    const userId = linked ? `return-pg-user-${people}` : null
    await bypass(async () => {
      if (userId) await prisma.user.create({ data: { id: userId, organizationId: ORG, name: "Fictional person", email: `${userId}@example.invalid`, role: "member", passwordHash: "unusable-fixture-hash" } })
      await prisma.mtmAgent.create({ data: { id: agentId, organizationId: ORG, name: "Fictional employee", role: "AGENT", userId } })
    })
    return { agentId, userId }
  }

  // The organization keeps Baku time (the MTM default): 13 October there.
  const TODAY = "2026-10-13"
  const at = (date: string, time: string) => new Date(`${date}T${time}+04:00`)
  /** 12:00 in Baku, an hour and four minutes after the day was closed at 10:56. */
  const NOON = at(TODAY, "12:00:00")

  type DayStatus = "COMPLETED" | "STARTED"
  async function seedDay(agentId: string, date: string, status: DayStatus = "COMPLETED") {
    return tenant(ORG, async () => {
      const day = await prisma.mtmAgentWorkday.create({
        data: {
          id: `wd-${randomUUID()}`, organizationId: ORG, agentId, workDate: new Date(`${date}T00:00:00.000Z`), status,
          startedAt: at(date, "10:21:58"), completedAt: status === "COMPLETED" ? at(date, "10:56:04") : null,
        },
      })
      const events: Array<["START" | "FINISH", string]> = [["START", "10:21:58"]]
      if (status === "COMPLETED") events.push(["FINISH", "10:56:04"])
      for (const [type, time] of events) {
        await prisma.mtmAgentWorkdayEvent.create({
          data: {
            organizationId: ORG, agentId, workdayId: day.id, clientEventId: randomUUID(), type,
            occurredAt: at(date, time), claimedAt: at(date, time), capturedAt: at(date, time),
            serverReceivedAt: new Date(at(date, time).getTime() + 1000), appliedAt: new Date(at(date, time).getTime() + 1000),
          },
        })
      }
      return day
    })
  }
  const back = (agentId: string, workdayId: string, operationId: string = randomUUID(), now: Date = NOON) =>
    tenant(ORG, () => returning.returnOwnMtmWorkday({ organizationId: ORG, agentId, workdayId, operationId, now }))
  const dayOf = (id: string) => tenant(ORG, () => prisma.mtmAgentWorkday.findUniqueOrThrow({ where: { id } }))
  const journalOf = (workdayId: string) => tenant(ORG, () => prisma.mtmAgentWorkdayEvent.findMany({
    where: { workdayId }, orderBy: [{ occurredAt: "asc" }, { appliedAt: "asc" }],
    select: { type: true, occurredAt: true, appliedAt: true, clientEventId: true },
  }))
  const ledgerOf = (workdayId: string) => tenant(ORG, () => prisma.workforceWorkdayReopen.findMany({ where: { workdayId }, orderBy: { occurredAt: "asc" } }))
  /** The ordinary finish, as the app sends it through sync. */
  const finish = async (agentId: string, workdayId: string, when: Date) => {
    // The canonical writer stamps appliedAt from the server clock. Advance
    // that clock with the fictional finish, not the CI runner's wall clock.
    vi.useFakeTimers({toFake:["Date"]})
    vi.setSystemTime(when)
    try { return await tenant(ORG, () => prisma.$transaction((tx) => workdays.applyMtmWorkdayEvent(tx, { organizationId: ORG, agentId }, {
    action: "FINISH", workdayId, clientEventId: randomUUID(), occurredAt: when, claimedAt: when, capturedAt: when, queuedAt: null,
    serverReceivedAt: when, schemaVersion: 1, workDateKey: TODAY, latitude: null, longitude: null, accuracy: null, note: null,
    attendanceReview: { state: "NOT_REQUIRED", reasonCode: null, policyVersion: workdays.WORKFORCE_ATTENDANCE_REVIEW_POLICY_VERSION, claimAgeSeconds: 0 },
  }))) } finally {vi.useRealTimers()}
  }

  beforeAll(async () => {
    sql(adminUrl!, `CREATE ROLE "${scratch!.role}" LOGIN PASSWORD 'workday-return-fixture-only' NOSUPERUSER NOBYPASSRLS`)
    createdRole = true
    sql(adminUrl!, `CREATE DATABASE "${scratch!.name}"`)
    createdDb = true
    // The schema as `db push` builds it on any Postgres: the two pgvector
    // columns are left out, nothing here reads them.
    const schemaFile = join(mkdtempSync(join(tmpdir(), "workday-return-schema-")), "schema.prisma")
    writeFileSync(schemaFile, readFileSync("prisma/schema.prisma", "utf8").split("\n").filter((line) => !/Unsupported\("vector/.test(line)).join("\n"))
    const pushed = spawnSync(process.execPath, [PRISMA_CLI, "db", "push", "--schema", schemaFile, "--skip-generate"], {
      env: { ...process.env, DATABASE_URL: scratch!.adminDb }, encoding: "utf8", timeout: 180_000, maxBuffer: 1024 * 1024,
    })
    if (pushed.status !== 0) throw new Error("workday return fixture schema push failed")

    // `db push` knows no trigger, function, policy or check. What decides this
    // feature is exactly those, so production's own SQL is applied verbatim, in
    // production's order: tenant isolation of the MTM tables, the guard of
    // workday facts, the reopen ledger as it shipped in September — and then
    // the migration under test on top of it.
    for (const name of ["20260806120000_mtm_rls_coverage_completion", "20260806160000_mtm_rls_bypass_clause_normalization"]) sql(scratch!.adminDb, migration(name))
    // One of those migrations adds a column `db push` has already drawn.
    sql(scratch!.adminDb, 'ALTER TABLE "workforce_time_corrections" DROP COLUMN "requestHash";')
    const foundation = migration("20260828223000_workforce_h3_foundation")
    sql(scratch!.adminDb, foundation.slice(foundation.indexOf("-- Tenant data ships fail-closed."), foundation.indexOf("-- A migration runner may own new tables")))
    for (const name of ["20260828224500_workforce_h3_legacy_fact_guard", "20260828230000_workforce_direct_correction_contract"]) sql(scratch!.adminDb, migration(name))
    // The ledger table as `db push` drew it already has this migration's
    // column; production gets there from September's table.
    sql(scratch!.adminDb, 'DROP TABLE "workforce_workday_reopens" CASCADE;')
    const ledger = migration("20260915210100_workforce_workday_reopen_ledger")
    sql(scratch!.adminDb, ledger.slice(0, ledger.indexOf("-- A migration runner can own the new table")))
    sql(scratch!.adminDb, migration("20261013120000_mtm_workday_employee_return"))
    sql(scratch!.adminDb, readFileSync("scripts/rls/enable-batch-5.sql", "utf8"))
    sql(scratch!.adminDb, `GRANT USAGE ON SCHEMA public TO "${scratch!.role}"; GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "${scratch!.role}";`)

    prisma = (await import("@/lib/prisma")).prisma
    ;({ runWithTenant: tenant, runWithRlsBypass: bypass } = await import("@/lib/rls-context"))
    returning = await import("@/lib/mtm/workday-return")
    workdays = await import("@/lib/mtm/workday")
    pauses = await import("@/lib/mtm/workday-pauses")

    await bypass(async () => {
      await prisma.organization.create({ data: { id: ORG, name: "Fictional company", slug: ORG, modules: { "route-field": true } } })
      for (const [id, role] of [[LINKED_USER, "member"], [MANAGER_USER, "admin"]] as const) {
        await prisma.user.create({ data: { id, organizationId: ORG, name: "Fictional person", email: `${id}@example.invalid`, role, passwordHash: "unusable-fixture-hash" } })
      }
      await prisma.mtmAgent.createMany({
        data: [
          { id: FIELD, organizationId: ORG, name: "Fictional field agent", role: "AGENT" },
          { id: LINKED, organizationId: ORG, name: "Fictional linked agent", role: "AGENT", userId: LINKED_USER },
        ],
      })
    })
  }, 300_000)

  afterAll(async () => {
    await prisma?.$disconnect()
    if (createdDb) sql(adminUrl!, `DROP DATABASE "${scratch!.name}" WITH (FORCE)`)
    if (createdRole) sql(adminUrl!, `DROP ROLE "${scratch!.role}"`)
  })

  it("is the database the rule lives in: without the ledger a completed day stays completed", async () => {
    const { agentId } = await employee()
    const day = await seedDay(agentId, TODAY)
    await expect(tenant(ORG, () => prisma.mtmAgentWorkday.update({
      where: { id: day.id }, data: { status: "PAUSED", pausedAt: day.completedAt, completedAt: null },
    }))).rejects.toThrow()
    expect(await dayOf(day.id)).toMatchObject({ status: "COMPLETED" })
  })

  it("returns the employee to the same day: one row for the date, the closure and the return both in the journal, the gap not worked", async () => {
    const day = await seedDay(FIELD, TODAY)
    const result = await back(FIELD, day.id)
    expect(result).toMatchObject({ kind: "success", idempotent: false, workday: { id: day.id, status: "STARTED", pausedAt: null, completedAt: null } })

    // 10:56:04 → 12:00:00 is 1 h 3 min 56 s nobody worked.
    const row = await dayOf(day.id)
    expect(row).toMatchObject({ status: "STARTED", pausedAt: null, completedAt: null, totalPausedSeconds: 3836 })
    expect(row.startedAt).toEqual(at(TODAY, "10:21:58"))
    expect(await tenant(ORG, () => prisma.mtmAgentWorkday.count({ where: { agentId: FIELD, workDate: new Date(`${TODAY}T00:00:00.000Z`) } }))).toBe(1)

    const journal = await journalOf(day.id)
    expect(journal.map((event) => event.type)).toEqual(["START", "FINISH", "REOPEN", "RESUME"])
    // The reopen stands at the finish it reopens; when the person really came
    // back is the server's time on it — and the resume.
    expect(journal[2].occurredAt).toEqual(at(TODAY, "10:56:04"))
    expect(journal[2].appliedAt).toEqual(NOON)
    expect(journal[3].occurredAt).toEqual(NOON)

    // A field agent has no CRM user: the ledger names nobody and says who it was by kind.
    const ledger = await ledgerOf(day.id)
    expect(ledger).toHaveLength(1)
    expect(ledger[0]).toMatchObject({ source: "EMPLOYEE", actorUserId: null, agentId: FIELD, reason: returning.MTM_WORKDAY_RETURN_REASON })

    // The one reader of breaks sees the closed time as time off: a point
    // captured in it is refused by every location writer.
    const gaps = pauses.mtmWorkdayPauses(await tenant(ORG, () => prisma.mtmAgentWorkdayEvent.findMany({
      where: { workdayId: day.id }, orderBy: [{ occurredAt: "asc" }, { appliedAt: "asc" }], select: { type: true, occurredAt: true },
    })))
    expect(pauses.isDuringMtmWorkdayPause(at(TODAY, "11:30:00"), gaps)).toBe(true)
    expect(pauses.isDuringMtmWorkdayPause(at(TODAY, "10:40:00"), gaps)).toBe(false)
    expect(pauses.isDuringMtmWorkdayPause(at(TODAY, "12:30:00"), gaps)).toBe(false)
  })

  it("lets the returned day be finished as any other, and returned to once more", async () => {
    const day = await tenant(ORG, () => prisma.mtmAgentWorkday.findFirstOrThrow({ where: { agentId: FIELD, workDate: new Date(`${TODAY}T00:00:00.000Z`) } }))
    const finished = await finish(FIELD, day.id, at(TODAY, "13:00:00"))
    expect(finished).toMatchObject({ status: "ok" })
    expect(await dayOf(day.id)).toMatchObject({ status: "COMPLETED", totalPausedSeconds: 3836 })
    expect((await dayOf(day.id)).completedAt).toEqual(at(TODAY, "13:00:00"))

    const again = await back(FIELD, day.id, randomUUID(), at(TODAY, "13:10:00"))
    expect(again).toMatchObject({ kind: "success", idempotent: false })
    expect(await dayOf(day.id)).toMatchObject({ status: "STARTED", totalPausedSeconds: 3836 + 600 })
    expect((await journalOf(day.id)).map((event) => event.type)).toEqual(["START", "FINISH", "REOPEN", "RESUME", "FINISH", "REOPEN", "RESUME"])
    expect(await ledgerOf(day.id)).toHaveLength(2)
  })

  it("names the employee's own CRM user as the author when the card has one", async () => {
    const day = await seedDay(LINKED, TODAY)
    expect(await back(LINKED, day.id)).toMatchObject({ kind: "success" })
    expect((await ledgerOf(day.id))[0]).toMatchObject({ source: "EMPLOYEE", actorUserId: LINKED_USER })
  })

  it("answers a repeated sending with the same return: nothing is written twice", async () => {
    const { agentId } = await employee()
    const day = await seedDay(agentId, TODAY)
    const operationId = randomUUID()
    const [first, second] = await Promise.all([back(agentId, day.id, operationId), back(agentId, day.id, operationId)])
    expect([first.kind, second.kind]).toEqual(["success", "success"])
    expect([first, second].map((result) => result.kind === "success" && result.idempotent).sort()).toEqual([false, true])
    expect((await journalOf(day.id)).map((event) => event.type)).toEqual(["START", "FINISH", "REOPEN", "RESUME"])
    expect(await ledgerOf(day.id)).toHaveLength(1)
    // A third sending, long after: still the same return.
    expect(await back(agentId, day.id, operationId, at(TODAY, "15:00:00"))).toMatchObject({ kind: "success", idempotent: true })
    expect(await ledgerOf(day.id)).toHaveLength(1)

    // The same id for another person's day is not the same return.
    const other = await employee()
    const theirs = await seedDay(other.agentId, TODAY)
    expect(await back(other.agentId, theirs.id, operationId)).toMatchObject({ kind: "conflict", code: "MTM_WORKDAY_RETURN_IDEMPOTENCY_MISMATCH" })
    expect(await dayOf(theirs.id)).toMatchObject({ status: "COMPLETED" })
  })

  it("does not return to yesterday: after midnight the day changes only through a correction", async () => {
    const { agentId } = await employee()
    const day = await seedDay(agentId, "2026-10-12")
    expect(await back(agentId, day.id)).toMatchObject({ kind: "conflict", code: "MTM_WORKDAY_RETURN_NOT_TODAY" })
    expect(await dayOf(day.id)).toMatchObject({ status: "COMPLETED" })
    expect((await journalOf(day.id)).map((event) => event.type)).toEqual(["START", "FINISH"])
    expect(await ledgerOf(day.id)).toEqual([])

    // Closed at 10:56 on the 13th; half past midnight in Baku is already the 14th.
    const night = await employee()
    const late = await seedDay(night.agentId, TODAY)
    expect(await back(night.agentId, late.id, randomUUID(), at("2026-10-14", "00:30:00"))).toMatchObject({ kind: "conflict", code: "MTM_WORKDAY_RETURN_NOT_TODAY" })
    // …while 23:59 the same evening is still the day it was closed.
    expect(await back(night.agentId, late.id, randomUUID(), at(TODAY, "23:59:00"))).toMatchObject({ kind: "success" })
  })

  it("has nothing to return to in a day that is not closed, and never touches someone else's day", async () => {
    const { agentId } = await employee()
    const open = await seedDay(agentId, TODAY, "STARTED")
    expect(await back(agentId, open.id)).toMatchObject({ kind: "conflict", code: "MTM_WORKDAY_RETURN_NOT_COMPLETED" })
    expect((await journalOf(open.id)).map((event) => event.type)).toEqual(["START"])

    const other = await employee()
    const theirs = await seedDay(other.agentId, TODAY)
    expect(await back(agentId, theirs.id)).toEqual({ kind: "not_found" })
    expect(await dayOf(theirs.id)).toMatchObject({ status: "COMPLETED" })
    expect(await ledgerOf(theirs.id)).toEqual([])
  })

  it("keeps a day closed while its times are being corrected", async () => {
    const { agentId } = await employee()
    const day = await seedDay(agentId, TODAY)
    await tenant(ORG, () => prisma.mtmHrmRequest.create({
      data: {
        organizationId: ORG, agentId, clientRequestId: randomUUID(), type: "TIME_CORRECTION", status: "PENDING",
        startDate: new Date(`${TODAY}T00:00:00.000Z`), endDate: new Date(`${TODAY}T00:00:00.000Z`),
        correctionWorkdayId: day.id, requestedEndAt: at(TODAY, "11:30:00"), reason: "Fictional correction", submittedAt: NOON,
      },
    }))
    expect(await back(agentId, day.id)).toMatchObject({ kind: "conflict", code: "MTM_WORKDAY_RETURN_LOCKED" })
    expect(await dayOf(day.id)).toMatchObject({ status: "COMPLETED" })
    expect(await ledgerOf(day.id)).toEqual([])
  })

  it("lets the ledger be written by the employee or by a supervisor, never by one posing as the other", async () => {
    const { agentId: SUBJECT, userId } = await employee(true)
    const SUBJECT_USER = userId!
    const day = await seedDay(SUBJECT, "2026-10-09")
    const facts = {
      id: day.id, workDate: "2026-10-09", status: "COMPLETED", startedAt: day.startedAt.toISOString(),
      pausedAt: null, completedAt: day.completedAt!.toISOString(), totalPausedSeconds: 0,
    }
    const attempt = (source: string, actorUserId: string | null) => tenant(ORG, () => prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('TimeZone', 'UTC', true)`
      const event = await tx.mtmAgentWorkdayEvent.create({
        data: {
          organizationId: ORG, agentId: SUBJECT, workdayId: day.id, clientEventId: `reopen:${randomUUID()}`, type: "REOPEN",
          occurredAt: day.completedAt!, claimedAt: day.completedAt!, capturedAt: day.completedAt!, serverReceivedAt: NOON, appliedAt: NOON,
        },
      })
      return tx.workforceWorkdayReopen.create({
        data: {
          organizationId: ORG, agentId: SUBJECT, workdayId: day.id, eventId: event.id, operationId: randomUUID(),
          requestHash: "a".repeat(64), source, actorUserId, reason: "Fictional reason",
          beforeFacts: facts, afterFacts: { ...facts, status: "PAUSED", pausedAt: facts.completedAt, completedAt: null }, occurredAt: NOON,
        },
      })
    }))
    // «The employee returned» with a supervisor's — or nobody's — name on it.
    await expect(attempt("EMPLOYEE", MANAGER_USER)).rejects.toThrow(/actor must be the employee/)
    await expect(attempt("EMPLOYEE", null)).rejects.toThrow(/actor must be the employee/)
    // «A supervisor reopened» signed by the employee, or by nobody.
    await expect(attempt("MANAGER", SUBJECT_USER)).rejects.toThrow(/actor cannot be the employee/)
    await expect(attempt("MANAGER", null)).rejects.toThrow()
    await expect(attempt("SOMEONE", MANAGER_USER)).rejects.toThrow()
    // Each refusal rolled back its REOPEN event with it.
    expect((await journalOf(day.id)).map((event) => event.type)).toEqual(["START", "FINISH"])
    // The September path still works: a supervisor on someone else's day.
    await expect(attempt("MANAGER", MANAGER_USER)).resolves.toMatchObject({ source: "MANAGER", actorUserId: MANAGER_USER })
  })

  it("keeps every return in a ledger nobody can rewrite", async () => {
    const [row] = await tenant(ORG, () => prisma.workforceWorkdayReopen.findMany({ where: { agentId: FIELD }, take: 1 }))
    await expect(tenant(ORG, () => prisma.workforceWorkdayReopen.update({ where: { id: row.id }, data: { reason: "Erase history" } }))).rejects.toThrow()
    await expect(tenant(ORG, () => prisma.workforceWorkdayReopen.delete({ where: { id: row.id } }))).rejects.toThrow()
  })
  it("returns an enrolled office day and rejects a subsequently revoked participant before another event or receipt", async()=>{
    const {agentId}=await employee()
    await tenant(ORG,async()=>{
      await prisma.mtmAgent.update({where:{id:agentId},data:{role:"EMPLOYEE",attendanceParticipant:true}})
      await prisma.mtmSetting.upsert({where:{organizationId_key:{organizationId:ORG,key:"attendanceEnabled"}},create:{organizationId:ORG,key:"attendanceEnabled",value:true},update:{value:true}})
    })
    const day=await seedDay(agentId,TODAY),operationId=randomUUID()
    const ask=()=>tenant(ORG,()=>returning.returnOwnMtmWorkday({organizationId:ORG,agentId,workdayId:day.id,operationId,now:NOON,attendanceRole:"EMPLOYEE"}))
    expect(await ask()).toMatchObject({kind:"success",idempotent:false})
    expect(await ledgerOf(day.id)).toHaveLength(1)
    await tenant(ORG,()=>prisma.mtmAgent.update({where:{id:agentId},data:{attendanceParticipant:false}}))
    await expect(ask()).rejects.toMatchObject({code:"MTM_ATTENDANCE_SELF_REQUIRED"})
    expect(await ledgerOf(day.id)).toHaveLength(1)
    expect((await journalOf(day.id)).map(e=>e.type)).toEqual(["START","FINISH","REOPEN","RESUME"])
  })

})
