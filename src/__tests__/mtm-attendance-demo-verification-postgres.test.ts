/** CI-only: the exact operator fixture against the real schema, retained RLS
 * policies and immutable journal triggers. No production URL is accepted. */
import { createRequire } from "node:module"
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { PrismaClient, type Prisma } from "@prisma/client"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { buildMtmAttendanceReport } from "@/lib/mtm/attendance-report"
import { DEMO, DEMO_AGENTS, prepareDemo, readOnlyDemo, verifyParity } from "../../scripts/mtm-attendance-demo-verification"

import { prepareRequestDemo, readRequestDemo, readSurfaceDemo, REQUEST_DEMO } from "../../scripts/mtm-attendance-request-demo-verification"
import { PHONE, PHONE_USERS, preparePhone, readPhone } from "../../scripts/mtm-attendance-phone-fixture"

const adminUrl = process.env.MTM_DEMO_TEST_DATABASE_URL
if (!adminUrl && process.env.MTM_DEMO_DB_GATE === "required") throw new Error("MTM_DEMO_TEST_DATABASE_URL is required")
if (adminUrl && (!process.env.CI || !["localhost", "127.0.0.1"].includes(new URL(adminUrl).hostname))) {
  throw new Error("Demo PostgreSQL tests require a disposable loopback database in CI")
}
const suite = adminUrl ? describe : describe.skip
const name = `mtm_demo_${process.pid}_${Date.now()}`
const role = `${name}_app`
const database = adminUrl ? new URL(adminUrl) : null
if (database) database.pathname = `/${name}`
const appUrl = database ? new URL(database) : null
if (appUrl) { appUrl.username = role; appUrl.password = "demo-fixture-only"; appUrl.searchParams.set("connection_limit", "1") }

function cli(args: string[], input?: string) {
  const result = spawnSync(process.execPath, [createRequire(import.meta.url).resolve("prisma/build/index.js"), ...args], {
    input, encoding: "utf8", timeout: 180_000, maxBuffer: 1024 * 1024,
  })
  // The database URL and Prisma diagnostics are never interpolated into errors.
  if (result.status !== 0) throw new Error("Disposable demo database setup failed")
}
const sql = (url: string, input: string) => cli(["db", "execute", "--url", url, "--stdin"], input)
const migration = (name: string) => readFileSync(`prisma/migrations/${name}/migration.sql`, "utf8")
function retainedFunction(source: string, name: string) {
  const match = source.match(new RegExp(`CREATE OR REPLACE FUNCTION ${name}\\([^]*?\\$\\$;`))
  if (!match) throw new Error("Required retained production function missing")
  return match[0]
}

suite("attendance demo fixture with real PostgreSQL guards", () => {
  let db: PrismaClient
  let admin: PrismaClient
  let createdDb = false
  let createdRole = false
  beforeAll(async () => {
    sql(adminUrl!, `CREATE ROLE "${role}" LOGIN PASSWORD 'demo-fixture-only' NOSUPERUSER NOBYPASSRLS`)
    createdRole = true
    sql(adminUrl!, `CREATE DATABASE "${name}"`)
    createdDb = true
    const file = join(mkdtempSync(join(tmpdir(), "mtm-demo-schema-")), "schema.prisma")
    // Same application schema, omitting only unrelated vector extension columns.
    writeFileSync(file, readFileSync("prisma/schema.prisma", "utf8").split("\n").filter((line) => !/Unsupported\("vector/.test(line)).join("\n"))
    const previous = process.env.DATABASE_URL
    try { process.env.DATABASE_URL = database!.toString(); cli(["db", "push", "--schema", file, "--skip-generate"]) }
    finally { process.env.DATABASE_URL = previous }
    for (const name of ["20260806120000_mtm_rls_coverage_completion", "20260806160000_mtm_rls_bypass_clause_normalization"]) {
      sql(database!.toString(), migration(name))
    }
    sql(database!.toString(), readFileSync("scripts/rls/enable-batch-5.sql", "utf8"))
    sql(database!.toString(), retainedFunction(migration("20260828223000_workforce_h3_foundation"), "workforce_reject_immutable_mutation"))
    sql(database!.toString(), migration("20260828224500_workforce_h3_legacy_fact_guard"))
    // db push already created the additive columns/tables. Apply the exact
    // subsequent production function replacements, not a test imitation.
    for (const name of ["20260828230000_workforce_direct_correction_contract", "20260915210100_workforce_workday_reopen_ledger"]) {
      sql(database!.toString(), retainedFunction(migration(name), "workforce_guard_completed_workday"))
    }
    sql(database!.toString(), 'DROP TABLE mtm_attendance_participation_events; ALTER TABLE mtm_agents DROP COLUMN "attendanceExcluded", DROP COLUMN "attendanceIncludedFrom"; DROP TABLE mtm_attendance_month_days; DROP TABLE mtm_attendance_month_members; DROP TABLE mtm_attendance_month_closes;')
    sql(database!.toString(), migration("20261013190000_mtm_attendance_month_close"))
    sql(database!.toString(), migration("20261013220000_mtm_attendance_automatic_participation"))
    sql(database!.toString(), `GRANT USAGE ON SCHEMA public TO "${role}"; GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "${role}";`)
    process.env.DATABASE_URL = appUrl!.toString()
    db = new PrismaClient()
    admin = new PrismaClient<Prisma.PrismaClientOptions>({ datasourceUrl: database!.toString() })
    await db.$executeRaw`SELECT set_config('app.org_id', ${DEMO.id}, false)`
    await db.organization.create({ data: { id: "untouched-customer-fixture", slug: "untouched-customer-fixture", name: "Untouched fixture", settings: { retained: true } } })
  }, 300_000)

  afterAll(async () => {
    await db?.$disconnect()
    await admin?.$disconnect()
    if (createdDb) sql(adminUrl!, `DROP DATABASE "${name}" WITH (FORCE)`)
    if (createdRole) sql(adminUrl!, `DROP ROLE "${role}"`)
  }, 120_000)

  it("refuses a pre-existing unowned slug without creating users or attendance records", async () => {
    await db.organization.create({ data: { id: "unowned-slug-fixture", slug: DEMO.slug, name: "Unowned fixture" } })
    await expect(prepareDemo(db, "unusable-test-hash")).rejects.toThrow("TENANT_NOT_OWNED")
    expect(await db.user.count({ where: { organizationId: DEMO.id } })).toBe(0)
    expect(await db.mtmAgentWorkday.count({ where: { organizationId: DEMO.id } })).toBe(0)
    // Cleanup only the disposable CI collision, never a production function.
    await db.organization.delete({ where: { id: "unowned-slug-fixture" } })
  })

  it("inserts the exact fixture once with triggers enabled and matches actual report arithmetic", async () => {
    const customer = await db.organization.findUnique({ where: { id: "untouched-customer-fixture" } })
    expect(await prepareDemo(db, "unusable-test-hash")).toBe(true)
    const snapshot = await readOnlyDemo(db)
    expect(snapshot.agents).toHaveLength(3)
    expect(snapshot.agents.filter(agent => agent.userId === DEMO.userId)).toMatchObject([{ role: "EMPLOYEE", attendanceParticipant: true,
      attendanceExcluded: false, attendanceIncludedFrom: expect.any(Date), canPlanOwnRoutes: false, canSelfPublishRoutes: false }])
    expect(snapshot.workdays).toHaveLength(3)
    expect(snapshot.workdays.flatMap((day) => day.events)).toHaveLength(12)
    const report = buildMtmAttendanceReport({ employees: snapshot.agents.map(agent => ({ id: agent.id, name: "Demo", teamId: null, teamName: null,
      attendanceIncludedFrom: agent.attendanceIncludedFrom?.toISOString() ?? null })),
      workdays: snapshot.workdays, calendar: [], rules: [], from: DEMO.from, to: DEMO.to, now: new Date("2026-10-13T10:00:00Z") })
    expect(verifyParity(snapshot, report).totals.workedSeconds).toBe(90540)
    expect(await prepareDemo(db, "replacement-must-not-be-used")).toBe(false)
    expect(await readOnlyDemo(db)).toEqual(snapshot)
    expect(await db.organization.findUnique({ where: { id: "untouched-customer-fixture" } })).toEqual(customer)
  })

  it("the actual database refuses ledger rewrites, completed-day changes and writes in read-only comparisons", async () => {
    const snapshot = await readOnlyDemo(db)
    // Superuser in the disposable database bypasses RLS: these failures must
    // come from the retained triggers themselves, not a missing UPDATE policy.
    await expect(admin.mtmAgentWorkdayEvent.update({ where: { id: snapshot.workdays[0].events[0].id }, data: { note: "rewrite" } })).rejects.toThrow(/Workforce immutable records cannot be UPDATE/)
    await expect(admin.mtmAgentWorkday.update({ where: { id: snapshot.workdays[0].id }, data: { totalPausedSeconds: 1 } })).rejects.toThrow(/requires its current transaction correction ledger fact/)
    await expect(db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY")
      await tx.$executeRaw`SELECT set_config('app.org_id', ${DEMO.id}, true)`
      await tx.user.update({ where: { id: DEMO.userId }, data: { name: "should fail" } })
    })).rejects.toThrow()
    expect(await readOnlyDemo(db)).toEqual(snapshot)
  })

  it("RLS hides even the demo fixture when another tenant is selected", async () => {
    await db.$executeRaw`SELECT set_config('app.org_id', 'untouched-customer-fixture', false)`
    try { expect(await db.mtmAgentWorkday.findMany()).toEqual([]); expect(await db.mtmAgentWorkdayEvent.findMany()).toEqual([]) }
    finally { await db.$executeRaw`SELECT set_config('app.org_id', ${DEMO.id}, false)` }
  })
  it("reads all new surface tables only in the fixed tenant and refuses unexpected configuration without repair", async () => {
    const before = await readSurfaceDemo(db)
    expect(before.agents.filter(agent => agent.role === "AGENT").map(agent => agent.id)).toEqual([...DEMO_AGENTS])
    expect(before.agents.filter(agent => agent.userId === DEMO.userId)).toHaveLength(1)
    expect(before.agents).toHaveLength(3)
    expect(Object.values(before.counts)).toEqual(Array(26).fill(0))
    const foreign = await admin.mtmAttendanceBranch.create({ data: { organizationId: "untouched-customer-fixture" } })
    let ownId: string | null = null
    try {
      expect(await readSurfaceDemo(db)).toEqual(before)
      const own = await admin.mtmAttendanceBranch.create({ data: { organizationId: DEMO.id } }); ownId = own.id
      await expect(readSurfaceDemo(db)).rejects.toThrow("VERIFICATION_FAILED")
      expect(await admin.mtmAttendanceBranch.findUnique({ where: { id: own.id } })).not.toBeNull()
      expect(await admin.mtmAttendanceBranch.findUnique({ where: { id: foreign.id } })).not.toBeNull()
    } finally {
      // These two rows exist only in this disposable CI database.
      if (ownId) await admin.mtmAttendanceBranch.delete({ where: { id: ownId } })
      await admin.mtmAttendanceBranch.delete({ where: { id: foreign.id } })
    }
    expect(await readSurfaceDemo(db)).toEqual(before)
  })
  it("the new surface reader leaves its actual PostgreSQL transaction unable to write", async () => {
    const probe = { $transaction: (fn: (tx: Prisma.TransactionClient) => Promise<unknown>) => db.$transaction(async tx => {
      const value = await fn(tx)
      await tx.mtmSetting.create({ data: { organizationId: DEMO.id, key: "must-not-be-written", value: true } })
      return value
    }, { isolationLevel: "RepeatableRead", timeout: 15_000 }) } as unknown as Pick<PrismaClient, "$transaction">
    await expect(readSurfaceDemo(probe)).rejects.toThrow(/read-only transaction/)
    expect(await admin.mtmSetting.count({ where: { organizationId: DEMO.id, key: "must-not-be-written" } })).toBe(0)
  })
  it("provisions only an unused fixture mobile credential once without changing phone facts or another tenant", async () => {
    const before = await readOnlyDemo(db)
    const other = await db.organization.findUnique({ where: { id: "untouched-customer-fixture" } })
    expect(await prepareRequestDemo(db, "fixture-mobile-hash")).toBe(true)
    expect(await prepareRequestDemo(db, "must-never-replace")).toBe(false)
    const agent = await db.mtmAgent.findUnique({ where: { id: DEMO_AGENTS[0] } })
    expect(agent).toMatchObject({ email: REQUEST_DEMO.email, passwordHash: "fixture-mobile-hash", userId: null })
    expect(await readOnlyDemo(db)).toEqual(before)
    expect(await readRequestDemo(db)).toMatchObject({ status: "NONE", requestId: null, submittedAudits: 0, reviewerBells: 0 })
    expect(await db.organization.findUnique({ where: { id: "untouched-customer-fixture" } })).toEqual(other)
    // Disposable CI-only collision. The production controller cannot repair it.
    await db.mtmAgent.update({ where: { id: DEMO_AGENTS[0] }, data: { email: "changed@example.invalid" } })
    await expect(prepareRequestDemo(db, "must-not-overwrite")).rejects.toThrow("VERIFICATION_FAILED")
    expect((await db.mtmAgent.findUnique({ where: { id: DEMO_AGENTS[0] } }))?.passwordHash).toBe("fixture-mobile-hash")
  })

  it("creates a separately owned physical-phone tenant once, preserving the original demo and real triggers", async () => {
    const before = await readOnlyDemo(db)
    await admin.organization.create({ data: { id: "phone-fixture-slug-collision", slug: PHONE.slug, name: "Unowned CI collision" } })
    await expect(preparePhone(db, "unusable-phone-test-hash")).rejects.toThrow("PHONE_NOT_OWNED")
    expect(await admin.user.count({ where: { organizationId: PHONE.id } })).toBe(0)
    await admin.organization.delete({ where: { id: "phone-fixture-slug-collision" } })
    expect(await preparePhone(db, "unusable-phone-test-hash")).toBe(true)
    const snapshot = await readPhone(db)
    expect(snapshot.users.map(user => user.id).sort()).toEqual(PHONE_USERS.map(user => user.id).sort())
    expect(snapshot.agents).toBe(3)
    expect(await preparePhone(db, "must-never-replace")).toBe(false)
    expect(await readPhone(db)).toEqual(snapshot)
    expect(await readOnlyDemo(db)).toEqual(before)
    expect(await admin.mtmAgentWorkday.count({ where: { organizationId: PHONE.id } })).toBe(0)
    expect(await admin.mtmAttendanceLocationPolicy.count({ where: { organizationId: PHONE.id } })).toBe(0)
    expect(await admin.mtmAttendanceSchedule.count({ where: { organizationId: PHONE.id } })).toBe(0)
    const probe = { $transaction: (fn: (tx: Prisma.TransactionClient) => Promise<unknown>) => db.$transaction(async tx => {
      const result = await fn(tx)
      await tx.user.update({ where: { id: PHONE_USERS[1].id }, data: { name: "must-not-change" } })
      return result
    }) } as unknown as Pick<PrismaClient, "$transaction">
    await expect(readPhone(probe)).rejects.toThrow(/read-only transaction/)
    expect(await readPhone(db)).toEqual(snapshot)
    await admin.organization.update({ where: { id: PHONE.id }, data: { isActive: false } })
    await expect(readPhone(db)).rejects.toThrow("PHONE_FIXTURE_CHANGED")
    await admin.organization.update({ where: { id: PHONE.id }, data: { isActive: true } })
    expect(await readPhone(db)).toEqual(snapshot)
    await admin.mtmAgent.updateMany({ where: { organizationId: PHONE.id, userId: PHONE_USERS[1].id }, data: { attendanceParticipant: false } })
    await expect(readPhone(db)).rejects.toThrow("PHONE_FIXTURE_CHANGED")
    await admin.mtmAgent.updateMany({ where: { organizationId: PHONE.id, userId: PHONE_USERS[1].id }, data: { attendanceParticipant: true } })
    expect(await readPhone(db)).toEqual(snapshot)
  })

})
