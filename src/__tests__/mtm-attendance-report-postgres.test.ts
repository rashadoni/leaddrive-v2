/** Real schema, retained RLS migrations, production report store and API.
 * Only authentication and the subscription decision are fixtures; Prisma,
 * employee scope, settings, calendar and journal reads are real PostgreSQL.
 */
import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { NextRequest } from "next/server"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { addDateKeyDays, currentDateKey } from "@/lib/mtm/mobile-week"
import type { MtmRouteActor } from "@/lib/mtm/route-permissions"

const adminUrl = process.env.MTM_ATTENDANCE_TEST_DATABASE_URL
if (!adminUrl && process.env.MTM_ATTENDANCE_DB_GATE === "required") throw new Error("MTM_ATTENDANCE_TEST_DATABASE_URL is required")
const scratch = vi.hoisted(() => {
  const admin = process.env.MTM_ATTENDANCE_TEST_DATABASE_URL
  if (!admin) return null
  const name = `mtm_attendance_report_${process.pid}_${Date.now()}`
  const role = `${name}_app`
  const adminDb = new URL(admin)
  adminDb.pathname = `/${name}`
  const app = new URL(adminDb)
  app.username = role
  app.password = "attendance-fixture-only"
  process.env.DATABASE_URL = app.toString()
  return { name, role, adminDb: adminDb.toString() }
})
const caller = vi.hoisted(() => ({ orgId: "attendance-report-a", userId: "fixture-admin", role: "admin" }))
vi.mock("@/lib/api-auth", () => ({
  getOrgId: vi.fn(), getSession: vi.fn(), requireSessionAuth: vi.fn(),
  requireAuth: async () => ({ ...caller, email: "admin@example.test", name: "Fixture administrator", principalType: "session" }),
  isAuthError: (value: unknown) => value instanceof Response,
}))
vi.mock("@/lib/tenant-capability-access", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/tenant-capability-access")>(),
  requireTenantCapabilityAccessResponse: async () => null,
}))

function cli(args: string[], statement?: string) {
  const file = createRequire(import.meta.url).resolve("prisma/build/index.js")
  const result = spawnSync(process.execPath, [file, ...args], {
    input: statement, encoding: "utf8", timeout: 180_000, maxBuffer: 1024 * 1024,
  })
  if (result.status !== 0) throw new Error(`Attendance report fixture failed: ${String(result.stderr || result.stdout || result.error).replace(/postgres(?:ql)?:\/\/[^\s]+/g, "[test database]")}`)
}
const sql = (url: string, statement: string) => cli(["db", "execute", "--url", url, "--stdin"], statement)
const pgDescribe = adminUrl ? describe : describe.skip
const ORG = "attendance-report-a"
const OTHER = "attendance-report-b"
const adminActor: MtmRouteActor = { role: "ADMIN", agentId: null, scopedAgentIds: null }

pgDescribe("MTM report reads the real saved workday and journal", () => {
  let prisma: typeof import("@/lib/prisma").prisma
  let tenant: typeof import("@/lib/rls-context").runWithTenant
  let bypass: typeof import("@/lib/rls-context").runWithRlsBypass
  let readReport: typeof import("@/lib/mtm/attendance-report-store").readMtmAttendanceReport
  let getReport: typeof import("@/app/api/v1/mtm/attendance/report/route").GET
  let createRule: typeof import("@/lib/mtm/attendance-rule-store").createAttendanceRule
  let createdRole = false
  let createdDb = false
  let monday: string
  let friday: string
  let now: Date
  const at = (date: string, time: string) => new Date(`${date}T${time}:00.000+04:00`)

  beforeAll(async () => {
    sql(adminUrl!, `CREATE ROLE "${scratch!.role}" LOGIN PASSWORD 'attendance-fixture-only' NOSUPERUSER NOBYPASSRLS`)
    createdRole = true
    sql(adminUrl!, `CREATE DATABASE "${scratch!.name}"`)
    createdDb = true
    const schemaFile = join(mkdtempSync(join(tmpdir(), "mtm-attendance-report-schema-")), "schema.prisma")
    // Only unrelated vector columns require an extension absent from plain PG.
    writeFileSync(schemaFile, readFileSync("prisma/schema.prisma", "utf8").split("\n").filter((line) => !/Unsupported\("vector/.test(line)).join("\n"))
    const appUrl = process.env.DATABASE_URL!
    try {
      process.env.DATABASE_URL = scratch!.adminDb
      cli(["db", "push", "--schema", schemaFile, "--skip-generate"])
    } finally { process.env.DATABASE_URL = appUrl }
    sql(scratch!.adminDb, 'DROP TABLE mtm_attendance_rules; DROP TABLE mtm_work_calendar_days; DROP TYPE "MtmWorkCalendarDayKind";')
    for (const migration of [
      "20260715160000_mtm_work_calendar",
      "20260806120000_mtm_rls_coverage_completion",
      "20260806160000_mtm_rls_bypass_clause_normalization",
      "20261013010000_mtm_attendance_rules",
    ]) sql(scratch!.adminDb, readFileSync(`prisma/migrations/${migration}/migration.sql`, "utf8"))
    sql(scratch!.adminDb, `GRANT USAGE ON SCHEMA public TO "${scratch!.role}"; GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "${scratch!.role}";`)
    prisma = (await import("@/lib/prisma")).prisma
    ;({ runWithTenant: tenant, runWithRlsBypass: bypass } = await import("@/lib/rls-context"))
    ;({ readMtmAttendanceReport: readReport } = await import("@/lib/mtm/attendance-report-store"))
    ;({ createAttendanceRule: createRule } = await import("@/lib/mtm/attendance-rule-store"))
    getReport = (await import("@/app/api/v1/mtm/attendance/report/route")).GET
    monday = addDateKeyDays(currentDateKey(new Date(), "Asia/Baku"), 8)
    while (new Date(`${monday}T00:00:00Z`).getUTCDay() !== 1) monday = addDateKeyDays(monday, 1)
    friday = addDateKeyDays(monday, 4)
    now = at(friday, "19:00")
    await bypass(async () => {
      for (const id of [ORG, OTHER]) await prisma.organization.create({ data: { id, name: `Fixture ${id}`, slug: id } })
      await prisma.user.create({ data: { id: "fixture-supervisor-user", organizationId: ORG, email: "supervisor@example.test", name: "Fixture supervisor", role: "manager", passwordHash: "fixture-unusable-hash" } })
      for (const id of ["team-a", "team-b"]) await prisma.mtmTeam.create({ data: { id, organizationId: ORG, name: id } })
      await prisma.mtmAgent.createMany({ data: [
        { id: "employee-a", organizationId: ORG, teamId: "team-a", name: "Fixture employee A", role: "AGENT" },
        { id: "employee-b", organizationId: ORG, teamId: "team-b", name: "Fixture employee B", role: "AGENT" },
        { id: "supervisor-a", organizationId: ORG, teamId: "team-a", userId: "fixture-supervisor-user", name: "Fixture supervisor", role: "SUPERVISOR" },
        { id: "other-employee", organizationId: OTHER, name: "Other tenant fixture", role: "AGENT" },
      ] })
      await prisma.mtmWorkCalendarDay.create({ data: { organizationId: ORG, date: new Date(`${addDateKeyDays(monday, 2)}T00:00:00Z`), kind: "COMPANY_HOLIDAY", name: "Fixture holiday" } })
      await prisma.mtmAgentWorkday.create({ data: {
        id: "fixture-finished", organizationId: ORG, agentId: "employee-a", workDate: new Date(`${monday}T00:00:00Z`), status: "COMPLETED",
        startedAt: at(monday, "09:21"), completedAt: at(monday, "17:30"), totalPausedSeconds: 1800,
        startLatitude: 12.34567, startLongitude: 45.67891,
      } })
      await prisma.mtmAgentWorkdayEvent.createMany({ data: ([
        ["START", "09:21"], ["PAUSE", "12:00"], ["RESUME", "12:30"], ["FINISH", "17:30"],
      ] as const).map(([type, time]) => ({
        organizationId: ORG, agentId: "employee-a", workdayId: "fixture-finished", type,
        occurredAt: at(monday, time), claimedAt: at(monday, time), appliedAt: at(monday, time), serverReceivedAt: new Date(at(monday, time).getTime() + 1000),
        latitude: 12.34567, longitude: 45.67891, note: "PRIVATE_BREAK_MARKER",
      })) })
      const thursday = addDateKeyDays(monday, 3)
      await prisma.mtmAgentWorkday.create({ data: { id: "fixture-open", organizationId: ORG, agentId: "employee-a", workDate: new Date(`${thursday}T00:00:00Z`), status: "STARTED", startedAt: at(thursday, "09:00") } })
      await prisma.mtmAgentWorkdayEvent.create({ data: { organizationId: ORG, agentId: "employee-a", workdayId: "fixture-open", type: "START", occurredAt: at(thursday, "09:00") } })
    })
  }, 300_000)

  afterAll(async () => {
    await prisma?.$disconnect()
    if (createdDb) sql(adminUrl!, `DROP DATABASE "${scratch!.name}" WITH (FORCE)`)
    if (createdRole) sql(adminUrl!, `DROP ROLE "${scratch!.role}"`)
  }, 120_000)

  const report = (form: "ALL" | "LATE_EARLY" | "ABSENCES" | "JOURNAL" = "ALL") => tenant(ORG, () => readReport({
    organizationId: ORG, actor: adminActor, query: { from: monday, to: addDateKeyDays(monday, 6), form }, now,
  }))

  it("includes every date for every employee and computes recorded breaks, lateness and early departure", async () => {
    const result = await report()
    expect(result.rows).toHaveLength(14)
    const day = result.rows.find((row) => row.employeeId === "employee-a" && row.date === monday)!
    expect(day).toMatchObject({ workedSeconds: 27_540, pausedSeconds: 1800, lateSeconds: 1260, earlyLeaveSeconds: 1800, expectedWorkSeconds: 28_800, kind: "WORKED" })
    expect(result.rows.find((row) => row.employeeId === "employee-a" && row.date === addDateKeyDays(monday, 1))?.kind).toBe("ABSENT")
    expect(result.rows.find((row) => row.employeeId === "employee-a" && row.date === addDateKeyDays(monday, 2))?.kind).toBe("HOLIDAY")
    expect(result.rows.find((row) => row.employeeId === "employee-a" && row.date === addDateKeyDays(monday, 3))).toMatchObject({ kind: "MISSING_FINISH", workedSeconds: null })
    expect(result.rows.find((row) => row.employeeId === "employee-a" && row.date === addDateKeyDays(monday, 5))?.kind).toBe("WEEKEND")
    const text = JSON.stringify(result)
    expect(text).not.toMatch(/PRIVATE_BREAK_MARKER|12\.34567|45\.67891|latitude|longitude|accuracy|other-employee/)
    expect(day.events[1].serverReceivedAt).toBe(new Date(at(monday, "12:00").getTime() + 1000).toISOString())
  })

  it("uses filtered rows for totals and never treats unfinished time as a confirmed zero", async () => {
    const all = await report()
    const late = await report("LATE_EARLY")
    expect(late.rows).toHaveLength(1)
    expect(late.totals.workedSeconds).toBe(27_540)
    expect(all.totals.unknownWorkedCount).toBe(1)
    expect(all.totals.isComplete).toBe(false)
  })

  it("publishing a later rule leaves an already calculated date identical", async () => {
    const before = await report()
    await tenant(ORG, () => createRule(ORG, "fixture-admin", "Asia/Baku", {
      effectiveFrom: addDateKeyDays(monday, 7), startTime: "08:00", endTime: "17:00", lunchMinutes: 45, lateGraceMinutes: 5, weekendDays: [0],
    }))
    expect(await report()).toEqual(before)
  })

  it("keeps the actual API closed when disabled and scopes an enabled supervisor to their team", async () => {
    const url = `http://localhost/api/v1/mtm/attendance/report?from=${monday}&to=${friday}`
    expect((await getReport(new NextRequest(url))).status).toBe(404)
    await tenant(ORG, () => prisma.mtmSetting.create({ data: { organizationId: ORG, key: "attendanceEnabled", value: true } }))
    caller.userId = "fixture-supervisor-user"
    caller.role = "manager"
    const response = await getReport(new NextRequest(url))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.data.rows).toHaveLength(5)
    expect(body.data.rows.every((row: { employeeId: string }) => row.employeeId === "employee-a")).toBe(true)
    expect((await getReport(new NextRequest(`${url}&employeeId=employee-b`))).status).toBe(403)
    caller.orgId = OTHER
    caller.userId = "fixture-admin"
    caller.role = "admin"
    expect((await getReport(new NextRequest(url))).status).toBe(404)
  })

  it("RLS denies a filterless cross-tenant workday read and a cross-tenant report stays empty", async () => {
    expect(await tenant(OTHER, () => prisma.$queryRaw`SELECT id FROM mtm_agent_workdays`)).toEqual([])
    const result = await tenant(OTHER, () => readReport({ organizationId: ORG, actor: adminActor, query: { from: monday, to: friday, form: "ALL" }, now }))
    expect(result.rows).toEqual([])
  })
})
