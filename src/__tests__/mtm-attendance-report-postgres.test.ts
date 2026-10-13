/** Real schema, retained RLS migrations, production report store and API.
 * Only authentication and the subscription decision are fixtures; Prisma,
 * employee scope, settings, calendar and journal reads are real PostgreSQL.
 */
import { randomUUID } from "node:crypto"
import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import ExcelJS from "exceljs"
import { attendancePdfText } from "./helpers/attendance-pdf"
import { NextRequest } from "next/server"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { addDateKeyDays, currentDateKey } from "@/lib/mtm/mobile-week"
import type { AttendanceViewConfig } from "@/lib/mtm/attendance-view-contract"
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
const mail = vi.hoisted(() => ({ send: vi.fn(), capability: true, capabilityHook: undefined as (() => Promise<void>) | undefined }))
vi.mock("@/lib/email", () => ({ sendEmail: mail.send }))
const caller = vi.hoisted(() => ({ orgId: "attendance-report-a", userId: "fixture-admin", role: "admin" }))
vi.mock("@/lib/api-auth", () => ({
  getOrgId: vi.fn(), getSession: vi.fn(), requireSessionAuth: vi.fn(),
  requireAuth: async () => ({ ...caller, email: "admin@example.test", name: "Fixture administrator", principalType: "session" }),
  isAuthError: (value: unknown) => value instanceof Response,
}))
vi.mock("@/lib/tenant-capability-access", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/tenant-capability-access")>(),
  requireTenantCapabilityAccessResponse: async () => null,
  getTenantCapabilityAccess: async () => { await mail.capabilityHook?.(); return { allowed: mail.capability } },
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
  let calendar: typeof import("@/lib/mtm/attendance-calendar")
  let postCalendar: typeof import("@/app/api/v1/mtm/attendance/calendar/route").POST
  let views: typeof import("@/lib/mtm/attendance-view-store")
  let postView: typeof import("@/app/api/v1/mtm/attendance/views/route").POST
  let patchView: typeof import("@/app/api/v1/mtm/attendance/views/[id]/route").PATCH
  let genericPatchView: typeof import("@/app/api/v1/saved-views/[id]/route").PATCH
  let genericDeleteView: typeof import("@/app/api/v1/saved-views/[id]/route").DELETE
  let exportReport: typeof import("@/app/api/v1/mtm/attendance/export/route").POST
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
    sql(scratch!.adminDb, 'DROP TABLE mtm_attendance_deliveries; DROP TABLE mtm_attendance_schedules; DROP TABLE mtm_attendance_rules; DROP TABLE mtm_work_calendar_days; DROP TYPE "MtmWorkCalendarDayKind";')
    for (const migration of [
      "20260715160000_mtm_work_calendar",
      "20260806120000_mtm_rls_coverage_completion",
      "20260806160000_mtm_rls_bypass_clause_normalization",
      "20261013010000_mtm_attendance_rules",
      "20261013020000_mtm_attendance_deliveries",
    ]) sql(scratch!.adminDb, readFileSync(`prisma/migrations/${migration}/migration.sql`, "utf8"))
    sql(scratch!.adminDb, `GRANT USAGE ON SCHEMA public TO "${scratch!.role}"; GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "${scratch!.role}";`)
    prisma = (await import("@/lib/prisma")).prisma
    ;({ runWithTenant: tenant, runWithRlsBypass: bypass } = await import("@/lib/rls-context"))
    ;({ readMtmAttendanceReport: readReport } = await import("@/lib/mtm/attendance-report-store"))
    ;({ createAttendanceRule: createRule } = await import("@/lib/mtm/attendance-rule-store"))
    getReport = (await import("@/app/api/v1/mtm/attendance/report/route")).GET
    calendar = await import("@/lib/mtm/attendance-calendar")
    postCalendar = (await import("@/app/api/v1/mtm/attendance/calendar/route")).POST
    exportReport = (await import("@/app/api/v1/mtm/attendance/export/route")).POST
    views = await import("@/lib/mtm/attendance-view-store")
    postView = (await import("@/app/api/v1/mtm/attendance/views/route")).POST
    patchView = (await import("@/app/api/v1/mtm/attendance/views/[id]/route")).PATCH
    ;({ PATCH: genericPatchView, DELETE: genericDeleteView } = await import("@/app/api/v1/saved-views/[id]/route"))
    monday = addDateKeyDays(currentDateKey(new Date(), "Asia/Baku"), 8)
    while (new Date(`${monday}T00:00:00Z`).getUTCDay() !== 1) monday = addDateKeyDays(monday, 1)
    friday = addDateKeyDays(monday, 4)
    now = at(friday, "19:00")
    await bypass(async () => {
      for (const id of [ORG, OTHER]) await prisma.organization.create({ data: { id, name: `Fixture ${id}`, slug: id } })
      await prisma.user.create({ data: { id: "fixture-admin", organizationId: ORG, email: "admin@example.test", name: "Fixture administrator", role: "admin", passwordHash: "fixture-unusable-hash" } })
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

  it("edits future holidays with retained previous rows and atomic audit, then removes the override", async () => {
    const date = addDateKeyDays(monday, 14)
    const save = (value: unknown, remove = false) => tenant(ORG, () => calendar.saveAttendanceCalendar({
      organizationId: ORG, userId: "fixture-admin", timezone: "Asia/Baku", value, remove,
    }))
    const first = await save({ date, kind: "COMPANY_HOLIDAY", name: "Fixture company day off" })
    const holiday = await tenant(ORG, () => readReport({ organizationId: ORG, actor: adminActor, query: { from: date, to: date, form: "ALL" }, now: at(date, "19:00") }))
    expect(holiday.rows.every((row) => row.kind === "HOLIDAY" && row.expectedWorkSeconds === 0)).toBe(true)
    const second = await save({ date, kind: "EXCEPTION_WORKDAY", name: "Fixture working exception", id: first!.id, version: first!.updatedAt })
    expect(second!.id).not.toBe(first!.id)
    const old = await tenant(ORG, () => prisma.mtmWorkCalendarDay.findUniqueOrThrow({ where: { id: first!.id } }))
    expect(old.deletedAt).not.toBeNull()
    expect(old.kind).toBe("COMPANY_HOLIDAY")
    await expect(save({ date, kind: "PUBLIC_HOLIDAY", name: "Stale edit", id: first!.id, version: first!.updatedAt }))
      .rejects.toMatchObject({ code: "MTM_ATTENDANCE_CALENDAR_CHANGED" })
    expect(await tenant(ORG, () => calendar.readAttendanceCalendar(ORG, date, date))).toEqual([second])
    await save({ id: second!.id, version: second!.updatedAt }, true)
    expect(await tenant(ORG, () => calendar.readAttendanceCalendar(ORG, date, date))).toEqual([])
    const audit = await tenant(ORG, () => prisma.mtmAuditLog.findMany({ where: { organizationId: ORG, metadataKind: "mtm_attendance_calendar" }, orderBy: { createdAt: "asc" } }))
    expect(audit.map((entry) => entry.action)).toEqual(["MTM_ATTENDANCE_CALENDAR_ADDED", "MTM_ATTENDANCE_CALENDAR_CHANGED", "MTM_ATTENDANCE_CALENDAR_REMOVED"])
    expect(audit.every((entry) => entry.actorUserId === "fixture-admin")).toBe(true)
  })

  it("serializes calendar editors and refuses past changes without altering saved rows", async () => {
    const date = addDateKeyDays(monday, 15)
    const results = await Promise.allSettled(["One", "Two"].map((name) => tenant(ORG, () => calendar.saveAttendanceCalendar({
      organizationId: ORG, userId: "fixture-admin", timezone: "Asia/Baku", value: { date, kind: "COMPANY_HOLIDAY", name },
    }))))
    expect(results.filter((entry) => entry.status === "fulfilled")).toHaveLength(1)
    expect(results.filter((entry) => entry.status === "rejected")).toHaveLength(1)
    const before = await tenant(ORG, () => prisma.mtmWorkCalendarDay.count({ where: { organizationId: ORG } }))
    await expect(tenant(ORG, () => calendar.saveAttendanceCalendar({ organizationId: ORG, userId: "fixture-admin", timezone: "Asia/Baku",
      value: { date: "2000-01-01", kind: "PUBLIC_HOLIDAY", name: "Backdated" },
    }))).rejects.toMatchObject({ code: "MTM_ATTENDANCE_CALENDAR_PAST" })
    expect(await tenant(ORG, () => prisma.mtmWorkCalendarDay.count({ where: { organizationId: ORG } }))).toBe(before)
  })

  it("denies calendar writes by a supervisor or a disabled organization without creating data", async () => {
    const url = "http://localhost/api/v1/mtm/attendance/calendar"
    const value = { date: addDateKeyDays(monday, 16), kind: "COMPANY_HOLIDAY", name: "Forbidden fixture change" }
    const request = () => new NextRequest(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) })
    const before = await tenant(ORG, () => prisma.mtmWorkCalendarDay.count({ where: { organizationId: ORG } }))
    Object.assign(caller, { orgId: ORG, userId: "fixture-supervisor-user", role: "manager" })
    expect((await postCalendar(request())).status).toBe(403)
    expect(await tenant(ORG, () => prisma.mtmWorkCalendarDay.count({ where: { organizationId: ORG } }))).toBe(before)
    Object.assign(caller, { orgId: OTHER, userId: "fixture-admin", role: "admin" })
    expect((await postCalendar(request())).status).toBe(404)
    expect(await tenant(OTHER, () => prisma.mtmWorkCalendarDay.count({ where: { organizationId: OTHER } }))).toBe(0)
  })

  const viewConfig = (): AttendanceViewConfig => ({ version: 1, mode: "DAY", columns: ["employee", "worked", "late"], showTotals: false,
    filters: { from: monday, to: friday, teamId: "team-a", form: "LATE_EARLY" } })

  it("reopens an identical personal form with ordered columns, filters and totals, and deduplicates retries", async () => {
    const value = { name: "Fixture personal report", config: viewConfig(), requestId: randomUUID() }
    const [first, retry] = await Promise.all([1, 2].map(() => tenant(ORG, () => views.saveAttendanceView({ organizationId: ORG, userId: "fixture-admin", value }))))
    expect(retry).toEqual(first)
    expect(first!.config).toEqual(value.config)
    const reopened = await tenant(ORG, () => views.readAttendanceViews(ORG, "fixture-admin"))
    expect(reopened).toEqual([first])
    expect(await tenant(ORG, () => views.readAttendanceViews(ORG, "fixture-supervisor-user"))).toEqual([])
    expect(await tenant(OTHER, () => views.readAttendanceViews(OTHER, "fixture-admin"))).toEqual([])
    const before = await tenant(ORG, () => readReport({ organizationId: ORG, actor: adminActor, query: value.config.filters, now }))
    const after = await tenant(ORG, () => readReport({ organizationId: ORG, actor: adminActor, query: reopened[0].config.filters, now }))
    expect(after).toEqual(before)
    const updated = await tenant(ORG, () => views.saveAttendanceView({ organizationId: ORG, userId: "fixture-admin", id: first!.id,
      value: { name: "Renamed fixture", config: { ...viewConfig(), columns: ["late", "employee"] }, version: first!.version } }))
    expect(updated!.config.columns).toEqual(["late", "employee"])
    await expect(tenant(ORG, () => views.saveAttendanceView({ organizationId: ORG, userId: "fixture-admin", id: first!.id, remove: true, value: { version: first!.version } })))
      .rejects.toMatchObject({ code: "MTM_ATTENDANCE_VIEW_CHANGED" })
    await tenant(ORG, () => views.saveAttendanceView({ organizationId: ORG, userId: "fixture-admin", id: first!.id, remove: true, value: { version: updated!.version } }))
    expect(await tenant(ORG, () => views.readAttendanceViews(ORG, "fixture-admin"))).toEqual([])
  })

  it("does not permit foreign personal form edits, generic share bypass, or writes with the feature disabled", async () => {
    const value = { name: "Fixture scope report", config: viewConfig(), requestId: randomUUID() }
    Object.assign(caller, { orgId: ORG, userId: "fixture-admin", role: "admin" })
    const request = (url: string, method: string, body: unknown) => new NextRequest(`http://localhost${url}`, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
    const createdResponse = await postView(request("/api/v1/mtm/attendance/views", "POST", value))
    expect(createdResponse.status).toBe(200)
    const created = (await createdResponse.json()).data
    Object.assign(caller, { userId: "fixture-supervisor-user", role: "manager" })
    expect((await patchView(request(`/api/v1/mtm/attendance/views/${created.id}`, "PATCH", { name: value.name, config: value.config, version: created.version }), { params: Promise.resolve({ id: created.id }) })).status).toBe(404)
    Object.assign(caller, { userId: "fixture-admin", role: "admin" })
    expect((await genericPatchView(request(`/api/v1/saved-views/${created.id}`, "PATCH", { isShared: true }), { params: Promise.resolve({ id: created.id }) })).status).toBe(404)
    expect((await genericDeleteView(request(`/api/v1/saved-views/${created.id}`, "DELETE", {}), { params: Promise.resolve({ id: created.id }) })).status).toBe(404)
    await tenant(ORG, () => prisma.mtmSetting.updateMany({ where: { organizationId: ORG, key: "attendanceEnabled" }, data: { value: false } }))
    expect((await postView(request("/api/v1/mtm/attendance/views", "POST", { ...value, requestId: randomUUID() }))).status).toBe(404)
    expect(await tenant(ORG, () => views.readAttendanceViews(ORG, "fixture-admin"))).toEqual([created])
    await tenant(ORG, () => prisma.mtmSetting.updateMany({ where: { organizationId: ORG, key: "attendanceEnabled" }, data: { value: true } }))
  })

  it("exports the actual authorized snapshot with safe cells and refuses changed data or disabled access", async () => {
    Object.assign(caller, { orgId: ORG, userId: "fixture-admin", role: "admin" })
    const source = await getReport(new NextRequest(`http://localhost/api/v1/mtm/attendance/report?from=${monday}&to=${friday}`))
    expect(source.status).toBe(200)
    const reportData = (await source.json()).data
    const config = { ...viewConfig(), columns: ["employee", "worked", "paused"], filters: { from: monday, to: friday, employeeId: "employee-a", form: "ALL" } }
    const value = { config, locale: "az", snapshot: reportData.snapshot }
    const request = (format: "xlsx" | "pdf", snapshot = value.snapshot) => new NextRequest("http://localhost/api/v1/mtm/attendance/export", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...value, snapshot, format }),
    })
    const excel = await exportReport(request("xlsx"))
    expect(excel.status).toBe(200)
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(await excel.arrayBuffer())
    expect(workbook.worksheets[0].rowCount).toBe(6)
    const cells = JSON.stringify(workbook.worksheets.map((sheet) => sheet.getSheetValues()))
    expect(cells).toContain("Fixture employee A")
    expect(cells).not.toMatch(/Fixture employee B|PRIVATE_BREAK_MARKER|12\.34567|45\.67891|latitude|longitude/)
    const pdf = await exportReport(request("pdf"))
    expect(pdf.status).toBe(200)
    const text = attendancePdfText(Buffer.from(await pdf.arrayBuffer()))
    expect(text).toContain("Fixture employee A")
    expect(text).not.toMatch(/Fixture employee B|PRIVATE_BREAK_MARKER|12\.34567|45\.67891|latitude|longitude/)
    expect((await exportReport(request("xlsx", { ...value.snapshot, id: "0".repeat(64) }))).status).toBe(409)
    await tenant(ORG, () => prisma.mtmTeam.update({ where: { id: "team-a" }, data: { name: "Updated fixture team" } }))
    expect((await exportReport(request("xlsx"))).status).toBe(409)
    await tenant(ORG, () => prisma.mtmSetting.updateMany({ where: { organizationId: ORG, key: "attendanceEnabled" }, data: { value: false } }))
    expect((await exportReport(request("pdf"))).status).toBe(404)
    await tenant(ORG, () => prisma.mtmSetting.updateMany({ where: { organizationId: ORG, key: "attendanceEnabled" }, data: { value: true } }))
  })

  const scheduleDraft = () => ({ name: "Fixture attendance delivery", config: viewConfig(), frequency: "DAILY" as const, format: "xlsx" as const, locale: "az" as const, recipients: ["fictional@example.test"], enabled: true })
  async function createSchedule(userId = "fixture-admin", draft = scheduleDraft()) {
    const { saveAttendanceDelivery } = await import("@/lib/mtm/attendance-delivery-store")
    const schedule = await tenant(ORG, () => saveAttendanceDelivery({ organizationId: ORG, userId, timezone: "Asia/Baku", value: { requestId: randomUUID(), input: draft } }))
    expect(schedule).not.toBeNull()
    return schedule!
  }
  async function queueSchedule(id: string) {
    const { enqueueAttendanceDelivery, readAttendanceDeliveries } = await import("@/lib/mtm/attendance-delivery-store")
    await tenant(ORG, () => prisma.$executeRaw`UPDATE "mtm_attendance_schedules" SET "nextRunAt" = ${new Date(Date.now() - 1000)} WHERE "organizationId" = ${ORG} AND "id" = ${id}`)
    await Promise.all([tenant(ORG, () => enqueueAttendanceDelivery(ORG, id, new Date())), tenant(ORG, () => enqueueAttendanceDelivery(ORG, id, new Date()))])
    const rows = await tenant(ORG, () => readAttendanceDeliveries(ORG, "fixture-admin"))
    const supervisor = await tenant(ORG, () => readAttendanceDeliveries(ORG, "fixture-supervisor-user"))
    return [...rows.receipts, ...supervisor.receipts].filter((item) => item.scheduleId === id)
  }

  it("keeps schedules personal with real API idempotency, version conflicts, archival, off gate and forced RLS", async () => {
    const api = await import("@/app/api/v1/mtm/attendance/deliveries/route")
    const itemApi = await import("@/app/api/v1/mtm/attendance/deliveries/[id]/route")
    Object.assign(caller, { orgId: ORG, userId: "fixture-admin", role: "admin" })
    const body = { requestId: randomUUID(), input: scheduleDraft() }
    const req = (value: unknown, method = "POST") => new NextRequest("http://localhost/api/v1/mtm/attendance/deliveries", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) })
    const created = await api.POST(req(body))
    expect(created.status).toBe(200)
    const saved = (await created.json()).data
    expect((await (await api.POST(req(body))).json()).data).toEqual(saved)
    expect((await api.POST(req({ ...body, input: { ...body.input, name: "Changed retry" } }))).status).toBe(409)
    const ctx = { params: Promise.resolve({ id: saved.id }) }
    Object.assign(caller, { userId: "fixture-supervisor-user", role: "manager" })
    expect((await itemApi.PATCH(req({ version: saved.version, input: body.input }, "PATCH"), ctx)).status).toBe(404)
    expect((await (await api.GET(new NextRequest("http://localhost/api/v1/mtm/attendance/deliveries"))).json()).data.schedules).toEqual([])
    expect(await tenant(OTHER, () => prisma.$queryRaw`SELECT "id" FROM "mtm_attendance_schedules" WHERE "id" = ${saved.id}`)).toEqual([])
    await expect(tenant(OTHER, () => prisma.$executeRaw`INSERT INTO "mtm_attendance_deliveries" ("id", "organizationId", "scheduleId", "scheduleVersion", "recipient", "from", "to") VALUES ('foreign-receipt', ${OTHER}, ${saved.id}, ${new Date()}, 'fixture@example.test', CURRENT_DATE, CURRENT_DATE)`)).rejects.toThrow()
    Object.assign(caller, { userId: "fixture-admin", role: "admin" })
    const updated = await itemApi.PATCH(req({ version: saved.version, input: { ...body.input, enabled: false } }, "PATCH"), ctx)
    expect(updated.status).toBe(200)
    const changed = (await updated.json()).data
    expect((await itemApi.DELETE(req({ version: saved.version }, "DELETE"), ctx)).status).toBe(409)
    expect((await itemApi.DELETE(req({ version: changed.version }, "DELETE"), ctx)).status).toBe(200)
    expect((await (await api.GET(new NextRequest("http://localhost/api/v1/mtm/attendance/deliveries"))).json()).data.schedules).toEqual([])
    await tenant(ORG, () => prisma.mtmSetting.updateMany({ where: { organizationId: ORG, key: "attendanceEnabled" }, data: { value: false } }))
    expect((await api.POST(req({ ...body, requestId: randomUUID() }))).status).toBe(404)
    expect((await api.GET(new NextRequest("http://localhost/api/v1/mtm/attendance/deliveries"))).status).toBe(404)
    await tenant(ORG, () => prisma.mtmSetting.updateMany({ where: { organizationId: ORG, key: "attendanceEnabled" }, data: { value: true } }))
  })

  it("hands off one private, real file per recipient despite concurrent queue and worker retries", async () => {
    const { deliverAttendanceReceipt } = await import("@/lib/cron/mtm-attendance-delivery-job")
    const draft = { ...scheduleDraft(), recipients: ["one@example.test", "two@example.test"] }
    const schedule = await createSchedule("fixture-supervisor-user", draft)
    const receipts = await queueSchedule(schedule.id)
    expect(receipts).toHaveLength(2)
    const attachments: string[] = []
    mail.send.mockReset().mockImplementation(async (args) => {
      expect(args).toMatchObject({ transactional: true, allowProviderFallback: false, organizationId: ORG, sentBy: "fixture-supervisor-user" })
      expect(args.to).toMatch(/^(one|two)@example.test$/)
      const path = args.attachments[0].path
      attachments.push(path)
      const book = new ExcelJS.Workbook()
      await book.xlsx.load(Uint8Array.from(readFileSync(path)).buffer)
      const text = JSON.stringify(book.worksheets.map((sheet) => sheet.getSheetValues()))
      expect(text).toContain("Fixture employee A")
      expect(text).not.toMatch(/Fixture employee B|Other tenant|PRIVATE_BREAK_MARKER|12\.34567|45\.67891|latitude|longitude/)
      return { success: true, messageId: `fixture-${args.to}` }
    })
    await Promise.all([tenant(ORG, () => deliverAttendanceReceipt(ORG, receipts[0].id)), tenant(ORG, () => deliverAttendanceReceipt(ORG, receipts[0].id))])
    await tenant(ORG, () => deliverAttendanceReceipt(ORG, receipts[1].id))
    expect(mail.send).toHaveBeenCalledTimes(2)
    for (const path of attachments) expect(existsSync(path)).toBe(false)
    const { readAttendanceDeliveries } = await import("@/lib/mtm/attendance-delivery-store")
    const saved = await tenant(ORG, () => readAttendanceDeliveries(ORG, "fixture-supervisor-user"))
    expect(saved.receipts.filter((row) => row.scheduleId === schedule.id).map((row) => row.status)).toEqual(["SENT", "SENT"])
    expect(await tenant(ORG, () => deliverAttendanceReceipt(ORG, receipts[0].id))).toBe("SKIPPED")
    expect(mail.send).toHaveBeenCalledTimes(2)
  })

  it("cancels pending sends after feature, capability, account, visibility or employee access is revoked", async () => {
    const { deliverAttendanceReceipt } = await import("@/lib/cron/mtm-attendance-delivery-job")
    const { saveAttendanceDelivery } = await import("@/lib/mtm/attendance-delivery-store")
    const settings = (enabled: boolean) => tenant(ORG, () => prisma.mtmSetting.updateMany({ where: { organizationId: ORG, key: "attendanceEnabled" }, data: { value: enabled } }))
    const user = (data: { isActive?: boolean; hiddenModules?: string[] }) => tenant(ORG, () => prisma.user.update({ where: { id: "fixture-supervisor-user" }, data }))
    const cases = [
      { revoke: () => settings(false), restore: () => settings(true) },
      { revoke: async () => { mail.capability = false }, restore: async () => { mail.capability = true } },
      { revoke: () => user({ isActive: false }), restore: () => user({ isActive: true }) },
      { revoke: () => user({ hiddenModules: ["mtm"] }), restore: () => user({ hiddenModules: [] }) },
    ]
    for (const item of cases) {
      const schedule = await createSchedule("fixture-supervisor-user")
      const [receipt] = await queueSchedule(schedule.id)
      mail.send.mockClear()
      await item.revoke()
      try { expect(await tenant(ORG, () => deliverAttendanceReceipt(ORG, receipt.id))).toBe("CANCELLED"); expect(mail.send).not.toHaveBeenCalled() }
      finally { await item.restore() }
      await tenant(ORG, () => saveAttendanceDelivery({ organizationId: ORG, userId: "fixture-supervisor-user", timezone: "Asia/Baku", id: schedule.id, remove: true, value: { version: schedule.version } }))
    }
    // A saved explicit employee must never become a report for all employees.
    const outside = await createSchedule("fixture-supervisor-user", { ...scheduleDraft(), config: { ...viewConfig(), filters: { ...viewConfig().filters, employeeId: "employee-b" } } })
    const [receipt] = await queueSchedule(outside.id)
    mail.send.mockClear()
    expect(await tenant(ORG, () => deliverAttendanceReceipt(ORG, receipt.id))).toBe("FAILED")
    expect(mail.send).not.toHaveBeenCalled()
  })

  it("rechecks a revoked opt-in after the file was built and cancels stale or changed schedules", async () => {
    const { deliverAttendanceReceipt } = await import("@/lib/cron/mtm-attendance-delivery-job")
    const { saveAttendanceDelivery, readAttendanceDeliveries } = await import("@/lib/mtm/attendance-delivery-store")
    const schedule = await createSchedule()
    const [receipt] = await queueSchedule(schedule.id)
    let reads = 0
    mail.send.mockClear()
    mail.capabilityHook = async () => {
      if (++reads === 2) await prisma.mtmSetting.updateMany({ where: { organizationId: ORG, key: "attendanceEnabled" }, data: { value: false } })
    }
    try {
      expect(await tenant(ORG, () => deliverAttendanceReceipt(ORG, receipt.id))).toBe("CANCELLED")
      expect(reads).toBe(2)
      expect(mail.send).not.toHaveBeenCalled()
    } finally {
      mail.capabilityHook = undefined
      await tenant(ORG, () => prisma.mtmSetting.updateMany({ where: { organizationId: ORG, key: "attendanceEnabled" }, data: { value: true } }))
    }
    const changed = await createSchedule()
    const [old] = await queueSchedule(changed.id)
    await tenant(ORG, () => saveAttendanceDelivery({ organizationId: ORG, userId: "fixture-admin", timezone: "Asia/Baku", id: changed.id, value: { version: changed.version, input: { ...scheduleDraft(), recipients: ["replacement@example.test"] } } }))
    expect(await tenant(ORG, () => deliverAttendanceReceipt(ORG, old.id))).toBe("SKIPPED")
    const history = await tenant(ORG, () => readAttendanceDeliveries(ORG, "fixture-admin"))
    expect(history.receipts.find((item) => item.id === old.id)).toMatchObject({ status: "CANCELLED", errorCode: "SCHEDULE_CHANGED" })
    const stale = await createSchedule()
    const [older] = await queueSchedule(stale.id)
    await tenant(ORG, () => prisma.$executeRaw`UPDATE "mtm_attendance_deliveries" SET "from" = "from" - 1, "to" = "to" - 1 WHERE "organizationId" = ${ORG} AND "id" = ${older.id}`)
    expect(await tenant(ORG, () => deliverAttendanceReceipt(ORG, older.id))).toBe("CANCELLED")
    expect(mail.send).not.toHaveBeenCalled()
  })

  it("records ambiguous handoffs and abandoned claims as UNKNOWN and never retries them", async () => {
    const { deliverAttendanceReceipt, executeMtmAttendanceDeliveryJob } = await import("@/lib/cron/mtm-attendance-delivery-job")
    const { readAttendanceDeliveries } = await import("@/lib/mtm/attendance-delivery-store")
    const schedule = await createSchedule()
    const [receipt] = await queueSchedule(schedule.id)
    mail.send.mockReset().mockRejectedValue(new Error("simulated response lost after provider acceptance"))
    expect(await tenant(ORG, () => deliverAttendanceReceipt(ORG, receipt.id))).toBe("UNKNOWN")
    expect(await tenant(ORG, () => deliverAttendanceReceipt(ORG, receipt.id))).toBe("SKIPPED")
    expect(mail.send).toHaveBeenCalledTimes(1)
    const abandoned = await createSchedule()
    const [crash] = await queueSchedule(abandoned.id)
    await tenant(ORG, () => prisma.$executeRaw`UPDATE "mtm_attendance_deliveries" SET "status" = 'SENDING', "claimedAt" = ${new Date(Date.now() - 7_200_000)} WHERE "organizationId" = ${ORG} AND "id" = ${crash.id}`)
    await bypass(() => executeMtmAttendanceDeliveryJob())
    const history = await tenant(ORG, () => readAttendanceDeliveries(ORG, "fixture-admin"))
    expect(history.receipts.find((item) => item.id === crash.id)).toMatchObject({ status: "UNKNOWN", errorCode: "WORKER_INTERRUPTED" })
    expect(await tenant(ORG, () => deliverAttendanceReceipt(ORG, crash.id))).toBe("SKIPPED")
    expect(mail.send).toHaveBeenCalledTimes(1)
  })

})
