/** Real persistence and RLS, with the shipping migration and application store.
 * The private scratch database/role are created only from the explicit test URL.
 * CI must set the required flag: a missing database is never a green gate.
 */
import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import { readFileSync } from "node:fs"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { attendanceRuleForDate, attendanceRuleMinimumDate, MTM_ATTENDANCE_BASELINE_RULE } from "@/lib/mtm/attendance-rules"
import { addDateKeyDays, currentDateKey } from "@/lib/mtm/mobile-week"

const adminUrl = process.env.MTM_ATTENDANCE_TEST_DATABASE_URL
if (!adminUrl && process.env.MTM_ATTENDANCE_DB_GATE === "required") throw new Error("MTM_ATTENDANCE_TEST_DATABASE_URL is required")
const scratch = vi.hoisted(() => {
  const admin = process.env.MTM_ATTENDANCE_TEST_DATABASE_URL
  if (!admin) return null
  const name = `mtm_attendance_${process.pid}_${Date.now()}`
  const role = `${name}_app`
  const adminDb = new URL(admin)
  adminDb.pathname = `/${name}`
  const app = new URL(adminDb)
  app.username = role
  app.password = "attendance-fixture-only"
  process.env.DATABASE_URL = app.toString()
  return { name, role, adminDb: adminDb.toString(), app: app.toString() }
})

function sql(url: string, statement: string) {
  const cli = createRequire(import.meta.url).resolve("prisma/build/index.js")
  const result = spawnSync(process.execPath, [cli, "db", "execute", "--url", url, "--stdin"], {
    input: statement, encoding: "utf8", timeout: 45_000, maxBuffer: 512 * 1024,
  })
  if (result.status !== 0) {
    // Never include credentials from CLI diagnostics in the test report.
    const message = `${result.stderr || result.stdout || result.error}`.replace(/postgres(?:ql)?:\/\/[^\s]+/g, "[test database]")
    throw new Error(`Attendance fixture SQL failed: ${message}`)
  }
}

const pgDescribe = adminUrl ? describe : describe.skip
pgDescribe("MTM attendance on PostgreSQL", () => {
  let prisma: typeof import("@/lib/prisma").prisma
  let tenant: typeof import("@/lib/rls-context").runWithTenant
  let store: typeof import("@/lib/mtm/attendance-rule-store")
  let createdRole = false
  let createdDb = false
  const org = "attendance-fixture-a"
  const otherOrg = "attendance-fixture-b"
  const input = { startTime: "09:00", endTime: "18:00", lunchMinutes: 60, lateGraceMinutes: 10, weekendDays: [0, 6] }
  let firstDate: string

  beforeAll(async () => {
    sql(adminUrl!, `CREATE ROLE "${scratch!.role}" LOGIN PASSWORD 'attendance-fixture-only' NOSUPERUSER NOBYPASSRLS`)
    createdRole = true
    sql(adminUrl!, `CREATE DATABASE "${scratch!.name}"`)
    createdDb = true
    sql(scratch!.adminDb, 'CREATE TABLE organizations (id TEXT PRIMARY KEY);')
    sql(scratch!.adminDb, readFileSync("prisma/migrations/20261013010000_mtm_attendance_rules/migration.sql", "utf8"))
    sql(scratch!.adminDb, readFileSync("prisma/migrations/20261016180000_personnel_lunch_start/migration.sql", "utf8"))
    sql(scratch!.adminDb, `
      INSERT INTO organizations(id) VALUES ('${org}'), ('${otherOrg}');
      GRANT USAGE ON SCHEMA public TO "${scratch!.role}";
      GRANT SELECT ON organizations TO "${scratch!.role}";
      GRANT SELECT, INSERT, UPDATE, DELETE ON mtm_attendance_rules TO "${scratch!.role}";
    `)
    prisma = (await import("@/lib/prisma")).prisma
    tenant = (await import("@/lib/rls-context")).runWithTenant
    store = await import("@/lib/mtm/attendance-rule-store")
    firstDate = attendanceRuleMinimumDate([], "Asia/Baku")
  }, 120_000)

  afterAll(async () => {
    await prisma?.$disconnect()
    if (createdDb) sql(adminUrl!, `DROP DATABASE "${scratch!.name}" WITH (FORCE)`)
    if (createdRole) sql(adminUrl!, `DROP ROLE "${scratch!.role}"`)
  }, 120_000)

  it("publishes future versions without changing the same historical report rule", async () => {
    const today = currentDateKey(new Date(), "Asia/Baku")
    const before = attendanceRuleForDate(await tenant(org, () => store.readAttendanceRules(org)), today)
    const first = await tenant(org, () => store.createAttendanceRule(org, "fixture-admin", "Asia/Baku", { ...input, effectiveFrom: firstDate }))
    const second = await tenant(org, () => store.createAttendanceRule(org, "fixture-admin", "Asia/Baku", {
      ...input, effectiveFrom: addDateKeyDays(firstDate, 1), startTime: "08:00", weekendDays: [0],
    }))
    const versions = await tenant(org, () => store.readAttendanceRules(org))
    expect(before).toEqual(MTM_ATTENDANCE_BASELINE_RULE)
    expect(attendanceRuleForDate(versions, today)).toEqual(before)
    expect(attendanceRuleForDate(versions, firstDate)).toEqual(first)
    expect(attendanceRuleForDate(versions, addDateKeyDays(firstDate, 1))).toEqual(second)
    expect(first.createdBy).toBe("fixture-admin")
    expect(first.createdAt).not.toBeNull()
  })

  it("refuses a past date without writing a row", async () => {
    const before = await tenant(org, () => store.readAttendanceRules(org))
    await expect(tenant(org, () => store.createAttendanceRule(org, "fixture-admin", "Asia/Baku", {
      ...input, effectiveFrom: "2000-01-01",
    }))).rejects.toMatchObject({ code: "MTM_ATTENDANCE_RULE_FUTURE_REQUIRED" })
    expect(await tenant(org, () => store.readAttendanceRules(org))).toEqual(before)
  })

  it("serializes two editors publishing the same date", async () => {
    const effectiveFrom = addDateKeyDays(firstDate, 2)
    const results = await Promise.allSettled(["08:00", "09:30"].map((startTime) => tenant(org, () =>
      store.createAttendanceRule(org, "fixture-admin", "Asia/Baku", { ...input, effectiveFrom, startTime }))))
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1)
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1)
    expect((await tenant(org, () => store.readAttendanceRules(org))).filter((rule) => rule.effectiveFrom === effectiveFrom)).toHaveLength(1)
  })

  it("protects immutable versions and future-only inserts in the actual database", async () => {
    const versions = await tenant(org, () => store.readAttendanceRules(org))
    const id = versions[0].id
    await expect(tenant(org, () => prisma.$executeRaw`UPDATE mtm_attendance_rules SET "lunchMinutes" = 0 WHERE id = ${id}`)).rejects.toThrow()
    await expect(tenant(org, () => prisma.$executeRaw`DELETE FROM mtm_attendance_rules WHERE id = ${id}`)).rejects.toThrow()
    await expect(tenant(org, () => prisma.$executeRaw`
      INSERT INTO mtm_attendance_rules (id, "organizationId", "effectiveFrom", timezone, "startTime", "endTime", "lunchMinutes", "lateGraceMinutes", "weekendDays", "createdBy")
      VALUES ('backdated-rule', ${org}, '2000-01-01', 'Asia/Baku', '09:00', '18:00', 60, 10, ARRAY[0,6], 'fixture-admin')`)).rejects.toThrow()
    expect(await tenant(org, () => store.readAttendanceRules(org))).toEqual(versions)
  })

  it("enforces tenant isolation even when a query omits the organization filter", async () => {
    expect(await tenant(otherOrg, () => prisma.$queryRaw`SELECT id FROM mtm_attendance_rules`)).toEqual([])
    await expect(tenant(otherOrg, () => store.createAttendanceRule(org, "fixture-admin", "Asia/Baku", {
      ...input, effectiveFrom: addDateKeyDays(firstDate, 3),
    }))).rejects.toThrow()
    expect(await tenant(otherOrg, () => store.readAttendanceRules(otherOrg))).toEqual([])
    expect(await prisma.$queryRaw`SELECT id FROM mtm_attendance_rules`).toEqual([])
  })
  // Owner, 2026-10-16: «тут не указано время обеденного перерыва».
  it("keeps the lunch's start time, refuses a lunch outside the day, and reads old rules as time unknown", async () => {
    const date = addDateKeyDays(firstDate, 10)
    const saved = await tenant(org, () => store.createAttendanceRule(org, "fixture-admin", "Asia/Baku", { ...input, effectiveFrom: date, lunchStart: "13:00" }))
    expect(saved.lunchStart).toBe("13:00")
    expect((await tenant(org, () => store.readAttendanceRules(org))).find(rule => rule.effectiveFrom === date)?.lunchStart).toBe("13:00")
    await expect(tenant(org, () => store.createAttendanceRule(org, "fixture-admin", "Asia/Baku", { ...input, effectiveFrom: addDateKeyDays(date, 1), lunchStart: "17:30" })))
      .rejects.toMatchObject({ code: "MTM_ATTENDANCE_RULE_INVALID" })
    expect((await tenant(org, () => store.readAttendanceRules(org))).find(rule => rule.effectiveFrom === firstDate)?.lunchStart).toBeNull()
  })
})
