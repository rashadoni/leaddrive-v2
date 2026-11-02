/** Owner, 2026-10-16: HR asks the late and the absent for an explanation; the employee answers from the app. */
import { randomUUID } from "node:crypto"
import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

const adminUrl = process.env.MTM_ATTENDANCE_TEST_DATABASE_URL
if (!adminUrl && process.env.MTM_ATTENDANCE_DB_GATE === "required") throw new Error("MTM_ATTENDANCE_TEST_DATABASE_URL is required")
const scratch = vi.hoisted(() => {
  const admin = process.env.MTM_ATTENDANCE_TEST_DATABASE_URL
  if (!admin) return null
  const name = `mtm_attendance_explanations_${process.pid}_${Date.now()}`
  const role = `${name}_app`
  const db = new URL(admin); db.pathname = `/${name}`
  const app = new URL(db); app.username = role; app.password = "attendance-fixture-only"
  process.env.DATABASE_URL = app.toString()
  return { name, role, adminDb: db.toString() }
})
function sql(url: string, statement: string) {
  const file = createRequire(import.meta.url).resolve("prisma/build/index.js")
  const result = spawnSync(process.execPath, [file, "db", "execute", "--url", url, "--stdin"], { input: statement, encoding: "utf8", timeout: 180_000, maxBuffer: 1024 * 1024 })
  if (result.status !== 0) throw new Error(`Explanation fixture SQL failed: ${String(result.stderr || result.stdout).replace(/postgres(?:ql)?:\/\/[^\s]+/g, "[test database]")}`)
}
const ORG = "explain-pg-a", OTHER = "explain-pg-b", ADMIN = "explain-pg-admin"
const TODAY = "2026-10-16", YESTERDAY = "2026-10-15"
const now = new Date(`${TODAY}T12:00:00Z`) // 16:00 in Baku
const at = (date: string, clock: string) => new Date(`${date}T${clock}:00+04:00`)
const self = (agentId: string) => ({ organizationId: ORG, agentId, role: "EMPLOYEE" })
const reviewer = { organizationId: ORG, userId: ADMIN, principalType: "session" as const }

const pgDescribe = adminUrl ? describe : describe.skip
pgDescribe("Explanations on real PostgreSQL", () => {
  let prisma: typeof import("@/lib/prisma").prisma
  let tenant: typeof import("@/lib/rls-context").runWithTenant
  let bypass: typeof import("@/lib/rls-context").runWithRlsBypass
  let store: typeof import("@/lib/mtm/attendance-explanation-store")
  let report: typeof import("@/lib/mtm/attendance-report-store")
  let createdRole = false, createdDb = false
  beforeAll(async () => {
    sql(adminUrl!, `CREATE ROLE "${scratch!.role}" LOGIN PASSWORD 'attendance-fixture-only' NOSUPERUSER NOBYPASSRLS`); createdRole = true
    sql(adminUrl!, `CREATE DATABASE "${scratch!.name}"`); createdDb = true
    const schemaFile = join(mkdtempSync(join(tmpdir(), "attendance-explanation-schema-")), "schema.prisma")
    writeFileSync(schemaFile, readFileSync("prisma/schema.prisma", "utf8").split("\n").filter((line) => !/Unsupported\("vector/.test(line)).join("\n"))
    const cli = createRequire(import.meta.url).resolve("prisma/build/index.js")
    const result = spawnSync(process.execPath, [cli, "db", "push", "--schema", schemaFile, "--skip-generate"], { env: { ...process.env, DATABASE_URL: scratch!.adminDb }, encoding: "utf8", timeout: 180_000, maxBuffer: 1024 * 1024 })
    if (result.status !== 0) throw new Error("Explanation fixture schema push failed")
    sql(scratch!.adminDb, 'DROP TABLE workforce_employment_events; DROP TYPE "WorkforceEmploymentEventKind"; DROP TABLE mtm_attendance_attachments; ALTER TABLE mtm_hrm_requests DROP COLUMN "attendanceDetails"; DROP TABLE mtm_attendance_explanations;')
    for (const migration of ["20260830150000_workforce_employment_history", "20260806120000_mtm_rls_coverage_completion", "20260806160000_mtm_rls_bypass_clause_normalization",
      "20261013040000_mtm_attendance_requests", "20261013060000_mtm_attendance_hr_recording", "20261016210000_mtm_attendance_explanations"]) sql(scratch!.adminDb, readFileSync(`prisma/migrations/${migration}/migration.sql`, "utf8"))
    sql(scratch!.adminDb, readFileSync("scripts/rls/enable-batch-5.sql", "utf8"))
    sql(scratch!.adminDb, `GRANT USAGE ON SCHEMA public TO "${scratch!.role}"; GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "${scratch!.role}";`)
    prisma = (await import("@/lib/prisma")).prisma
    ;({ runWithTenant: tenant, runWithRlsBypass: bypass } = await import("@/lib/rls-context"))
    store = await import("@/lib/mtm/attendance-explanation-store")
    report = await import("@/lib/mtm/attendance-report-store")
    await bypass(async () => {
      for (const org of [ORG, OTHER]) {
        await prisma.organization.create({ data: { id: org, name: "Fictional explanation organization", slug: org, modules: { "route-field": true, personnel: true } } })
        await prisma.mtmSetting.create({ data: { organizationId: org, key: "attendanceEnabled", value: true } })
      }
      await prisma.user.create({ data: { id: ADMIN, organizationId: ORG, name: "Fictional HR", email: "explain-hr@example.invalid", role: "admin", passwordHash: "unusable-fixture-hash", preferredLanguage: "ru" } })
      for (const [id, org] of [["late", ORG], ["absent", ORG], ["sick", ORG], ["ontime", ORG], ["foreign", OTHER]]) {
        // In attendance from yesterday: earlier days are not theirs to explain.
        await prisma.mtmAgent.create({ data: { id, organizationId: org, name: `Fictional ${id}`, role: "EMPLOYEE", attendanceParticipant: true, status: "ACTIVE", attendanceIncludedFrom: new Date(`${YESTERDAY}T00:00:00Z`) } })
      }
      const day = async (agentId: string, date: string, start: string, finish: string | null) => {
        const created = await prisma.mtmAgentWorkday.create({ data: { organizationId: ORG, agentId, workDate: new Date(`${date}T00:00:00Z`), status: finish ? "COMPLETED" : "STARTED", startedAt: at(date, start), completedAt: finish ? at(date, finish) : null } })
        await prisma.mtmAgentWorkdayEvent.createMany({ data: [{ organizationId: ORG, agentId, workdayId: created.id, type: "START", occurredAt: at(date, start) },
          ...(finish ? [{ organizationId: ORG, agentId, workdayId: created.id, type: "FINISH" as const, occurredAt: at(date, finish) }] : [])] })
      }
      await day("late", TODAY, "09:30", null)
      await day("late", YESTERDAY, "09:45", "18:00")
      await day("ontime", TODAY, "08:55", null)
      for (const agentId of ["absent", "sick", "ontime"]) await day(agentId, YESTERDAY, "09:00", "18:00")
      await day("absent", "2026-10-14", "09:00", "18:00")
    })
    // Sick leave recorded by HR: the day is explained and needs nothing more.
    const recording = await import("@/lib/mtm/attendance-hr-recording")
    const kinds = await import("@/lib/mtm/attendance-day-kind-store")
    await tenant(ORG, async () => {
      const catalogue = await kinds.readAttendanceDayKinds(ORG)
      await recording.recordAttendanceDays(reviewer, { clientRequestId: randomUUID(), agentIds: ["sick"], dayKindKey: "SICK_LEAVE", catalogueVersion: catalogue.version,
        unit: "DAYS", startDate: TODAY, endDate: TODAY, reason: "Fictional sick leave" })
    })
  }, 240_000)
  afterAll(async () => {
    await prisma?.$disconnect()
    if (createdDb) sql(adminUrl!, `DROP DATABASE "${scratch!.name}" WITH (FORCE)`)
    if (createdRole) sql(adminUrl!, `DROP ROLE "${scratch!.role}"`)
  })

  it("asks only the late and the unexplained absent, once, and puts the request in their inbox", async () => {
    const items = [{ agentId: "late", date: TODAY, kind: "LATE" }, { agentId: "absent", date: TODAY, kind: "ABSENT" },
      { agentId: "sick", date: TODAY, kind: "ABSENT" }, { agentId: "ontime", date: TODAY, kind: "LATE" }, { agentId: "late", date: TODAY, kind: "ABSENT" }]
    await tenant(ORG, async () => {
      expect(await store.requestAttendanceExplanations(reviewer, { items }, now)).toEqual({ created: 2, already: 0, notNeeded: 3 })
      expect(await store.requestAttendanceExplanations(reviewer, { items }, now)).toEqual({ created: 0, already: 2, notNeeded: 3 })
      const rows = await prisma.mtmAttendanceExplanation.findMany({ orderBy: { agentId: "asc" } })
      expect(rows.map(row => [row.agentId, row.kind, row.status, row.lateMinutes])).toEqual([["absent", "ABSENT", "REQUESTED", null], ["late", "LATE", "REQUESTED", 30]])
      const inbox = await prisma.mtmNotification.findMany({ where: { agentId: { in: ["late", "absent"] } }, orderBy: { agentId: "asc" } })
      expect(inbox).toHaveLength(2)
      expect(inbox[1].title).toContain("30")
      expect(inbox.map(item => (item.metadata as Record<string, string>).attendanceExplanationId).sort()).toEqual(rows.map(row => row.id).sort())
      expect(await prisma.mtmAuditLog.count({ where: { action: "MTM_ATTENDANCE_EXPLANATION_REQUESTED" } })).toBe(2)
    })
    // Another tenant sees nothing (forced RLS).
    await tenant(OTHER, async () => { expect(await prisma.mtmAttendanceExplanation.count()).toBe(0) })
  })

  it("lets the employee answer HR, or explain an earlier late day on their own, and tells the one who asked", async () => {
    await tenant(ORG, async () => {
      const own = await store.listOwnAttendanceExplanations(self("late"), now)
      expect(own.items.map(item => [item.date, item.kind, item.status])).toEqual([[TODAY, "LATE", "REQUESTED"]])
      expect(own.candidates).toEqual([{ date: YESTERDAY, kind: "LATE", lateMinutes: 45 }])
      const answered = await store.answerOwnAttendanceExplanation(self("absent"), { date: TODAY, kind: "ABSENT", text: "Утром затопило квартиру, ждала мастера" }, now)
      expect(answered.item).toMatchObject({ status: "ANSWERED", answer: "Утром затопило квартиру, ждала мастера", requestedByName: "Fictional HR" })
      expect(await prisma.notification.count({ where: { userId: ADMIN, entityId: answered.item.id } })).toBe(1)
      // Corrected before HR decides; the same text again changes nothing.
      expect((await store.answerOwnAttendanceExplanation(self("absent"), { date: TODAY, kind: "ABSENT", text: "Затопило квартиру, ждала мастера до 12:00" }, now)).idempotent).toBe(false)
      expect((await store.answerOwnAttendanceExplanation(self("absent"), { date: TODAY, kind: "ABSENT", text: "Затопило квартиру, ждала мастера до 12:00" }, now)).idempotent).toBe(true)
      const voluntary = await store.answerOwnAttendanceExplanation(self("late"), { date: YESTERDAY, kind: "LATE", text: "Пробка на мосту" }, now)
      expect(voluntary.item).toMatchObject({ status: "ANSWERED", requestedAt: null, lateMinutes: 45 })
      expect((await store.listOwnAttendanceExplanations(self("late"), now)).candidates).toEqual([])
      // Nothing to explain: on time, on sick leave, or outside the last month.
      for (const [agentId, date, kind] of [["ontime", TODAY, "LATE"], ["sick", TODAY, "ABSENT"], ["absent", "2026-10-14", "ABSENT"]] as const) {
        await expect(store.answerOwnAttendanceExplanation(self(agentId), { date, kind, text: "Fictional" }, now)).rejects.toMatchObject({ code: "MTM_ATTENDANCE_EXPLANATION_NOT_NEEDED" })
      }
      await expect(store.answerOwnAttendanceExplanation(self("late"), { date: "2026-09-01", kind: "LATE", text: "Fictional" }, now)).rejects.toMatchObject({ code: "MTM_ATTENDANCE_EXPLANATION_DATE_INVALID" })
    })
  })

  it("HR accepts an answer once, the employee is told, the timesheet shows it, and nothing can be undone", async () => {
    await tenant(ORG, async () => {
      const listed = await store.listAttendanceExplanations(reviewer, { from: YESTERDAY, to: TODAY })
      const absent = listed.items.find(item => item.employeeId === "absent")!, late = listed.items.find(item => item.employeeId === "late" && item.date === TODAY)!
      await expect(store.decideAttendanceExplanation(reviewer, late.id, { decision: "ACCEPTED" }, now)).rejects.toMatchObject({ code: "MTM_ATTENDANCE_EXPLANATION_NOT_ANSWERED" })
      expect((await store.decideAttendanceExplanation(reviewer, absent.id, { decision: "ACCEPTED" }, now)).item).toMatchObject({ status: "ACCEPTED", decidedByName: "Fictional HR" })
      expect((await store.decideAttendanceExplanation(reviewer, absent.id, { decision: "ACCEPTED" }, now)).idempotent).toBe(true)
      await expect(store.decideAttendanceExplanation(reviewer, absent.id, { decision: "REJECTED" }, now)).rejects.toMatchObject({ code: "MTM_ATTENDANCE_EXPLANATION_DECIDED" })
      await expect(store.answerOwnAttendanceExplanation(self("absent"), { date: TODAY, kind: "ABSENT", text: "Changed after the decision" }, now)).rejects.toMatchObject({ code: "MTM_ATTENDANCE_EXPLANATION_DECIDED" })
      expect(await prisma.mtmNotification.count({ where: { agentId: "absent", metadata: { path: ["status"], equals: "ACCEPTED" } } })).toBe(1)
      const day = await report.readMtmAttendanceReport({ organizationId: ORG, actor: { role: "ADMIN", agentId: null, scopedAgentIds: null }, query: { from: TODAY, to: TODAY, form: "ALL", employeeId: "absent" }, now })
      expect(day.rows[0]).toMatchObject({ kind: "ABSENT", workedSeconds: 0, explanations: [{ kind: "ABSENT", status: "ACCEPTED", answer: "Затопило квартиру, ждала мастера до 12:00" }] })
      await expect(prisma.mtmAttendanceExplanation.delete({ where: { id: absent.id } })).rejects.toThrow()
      await expect(prisma.mtmAttendanceExplanation.update({ where: { id: absent.id }, data: { status: "ANSWERED", decidedAt: null, decidedByUserId: null } })).rejects.toThrow()
    })
  })
})
