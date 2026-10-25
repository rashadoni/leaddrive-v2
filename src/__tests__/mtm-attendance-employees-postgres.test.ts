/** Upgrade manual enrollment to automatic participation on a disposable
 * database, retaining employment/workday facts and the restricted app role. */
import { randomUUID } from "node:crypto"
import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { NextRequest } from "next/server"
import type { Prisma, MtmAttendanceParticipationEvent } from "@prisma/client"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

const adminUrl = process.env.MTM_ATTENDANCE_TEST_DATABASE_URL
if (!adminUrl && process.env.MTM_ATTENDANCE_DB_GATE === "required") throw new Error("MTM_ATTENDANCE_TEST_DATABASE_URL is required")
const scratch = vi.hoisted(() => {
  const admin = process.env.MTM_ATTENDANCE_TEST_DATABASE_URL
  if (!admin) return null
  const name = `mtm_attendance_employees_${process.pid}_${Date.now()}`, role = `${name}_app`
  const db = new URL(admin); db.pathname = `/${name}`
  const app = new URL(db); app.username = role; app.password = "attendance-fixture-only"
  process.env.DATABASE_URL = app.toString()
  return { name, role, adminDb: db.toString() }
})
const identity = vi.hoisted(() => ({ orgId: "employee-pg-a", agentId: "", role: "EMPLOYEE" }))
// The plan's seat limit is billing, not under test here.
vi.mock("@/lib/plan-limits", () => ({ checkUserLimit: async () => ({ allowed: true }) }))
vi.mock("@/lib/mobile-auth", () => ({ resolveMobileAuth: async () => ({ ...identity, tenantCapabilities: { routeField: true, workforceHrm: false, personnel: true } }) }))
function sql(url: string, statement: string) {
  const cli = createRequire(import.meta.url).resolve("prisma/build/index.js")
  const result = spawnSync(process.execPath, [cli, "db", "execute", "--url", url, "--stdin"], { input: statement, encoding: "utf8", timeout: 180_000, maxBuffer: 1024 * 1024 })
  if (result.status !== 0) throw new Error(`Employee fixture SQL failed: ${String(result.stderr || result.stdout).replace(/postgres(?:ql)?:\/\/[^\s]+/g, "[test database]")}`)
}
const pgDescribe = adminUrl ? describe : describe.skip
pgDescribe("MTM office employees on real PostgreSQL", () => {
  let prisma: typeof import("@/lib/prisma").prisma
  let tenant: typeof import("@/lib/rls-context").runWithTenant
  let bypass: typeof import("@/lib/rls-context").runWithRlsBypass
  let store: typeof import("@/lib/mtm/attendance-employee-store")
  let self: typeof import("@/lib/mtm/attendance-self-access")
  let push: typeof import("@/app/api/v1/mtm/mobile/sync/push/route")
  let report: typeof import("@/lib/mtm/attendance-report-store")
  let createdRole = false, createdDb = false, schemaDir: string | undefined
  const organizationId = "employee-pg-a", userId = "employee-pg-admin"
  const admin = { organizationId, userId, principalType: "session" as const }
  const enrollment = { clientRequestId: randomUUID(), userId: "employee-pg-office-user", teamId: null, hireDate: "2026-09-07", reason: "Fictional office employee enrollment" }
  let agentId: string, hireId: string
  beforeAll(async () => {
    sql(adminUrl!, `CREATE ROLE "${scratch!.role}" LOGIN PASSWORD 'attendance-fixture-only' NOSUPERUSER NOBYPASSRLS`); createdRole = true
    sql(adminUrl!, `CREATE DATABASE "${scratch!.name}"`); createdDb = true
    schemaDir = mkdtempSync(join(tmpdir(), "attendance-employee-schema-"))
    const schemaFile = join(schemaDir, "schema.prisma")
    writeFileSync(schemaFile, readFileSync("prisma/schema.prisma", "utf8").split("\n").filter(line => !/Unsupported\("vector/.test(line)).join("\n"))
    const cli = createRequire(import.meta.url).resolve("prisma/build/index.js")
    const result = spawnSync(process.execPath, [cli, "db", "push", "--schema", schemaFile, "--skip-generate"], { env: { ...process.env, DATABASE_URL: scratch!.adminDb }, encoding: "utf8", timeout: 180_000, maxBuffer: 1024 * 1024 })
    if (result.status !== 0) throw new Error("Employee fixture schema push failed")
    sql(scratch!.adminDb, 'DROP TABLE workforce_employment_events; DROP TYPE "WorkforceEmploymentEventKind"; ALTER TABLE mtm_agents DROP COLUMN "attendanceParticipant"; ALTER TABLE workforce_time_corrections DROP COLUMN "requestHash";')
    for (const migration of ["20260830150000_workforce_employment_history", "20260806120000_mtm_rls_coverage_completion", "20260806160000_mtm_rls_bypass_clause_normalization", "20261013080000_mtm_attendance_office_employees"]) sql(scratch!.adminDb, readFileSync(`prisma/migrations/${migration}/migration.sql`, "utf8"))
    const foundation = readFileSync("prisma/migrations/20260828223000_workforce_h3_foundation/migration.sql", "utf8")
    sql(scratch!.adminDb, foundation.slice(foundation.indexOf("-- Tenant data ships fail-closed."), foundation.indexOf("-- A migration runner may own new tables")))
    for (const migration of ["20260828224500_workforce_h3_legacy_fact_guard", "20260828230000_workforce_direct_correction_contract"]) sql(scratch!.adminDb, readFileSync(`prisma/migrations/${migration}/migration.sql`, "utf8"))
    sql(scratch!.adminDb, readFileSync("scripts/rls/enable-batch-5.sql", "utf8"))
    // Departments (2026-10-22): the table's tenant policy, exactly as its migration writes it.
    const departments = readFileSync("prisma/migrations/20261029090000_mtm_departments/migration.sql", "utf8")
    sql(scratch!.adminDb, departments.slice(departments.indexOf('ALTER TABLE "mtm_departments" ENABLE'), departments.indexOf('ALTER TABLE "mtm_teams"')))
    sql(scratch!.adminDb, `GRANT USAGE ON SCHEMA public TO "${scratch!.role}"; GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "${scratch!.role}";`)
    prisma = (await import("@/lib/prisma")).prisma
    ;({ runWithTenant: tenant, runWithRlsBypass: bypass } = await import("@/lib/rls-context"))
    store = await import("@/lib/mtm/attendance-employee-store")
    self = await import("@/lib/mtm/attendance-self-access")
    push = await import("@/app/api/v1/mtm/mobile/sync/push/route")
    report = await import("@/lib/mtm/attendance-report-store")
    await bypass(async () => {
      for (const id of [organizationId, "employee-pg-b"]) {
        await prisma.organization.create({ data: { id, name: "Fictional attendance organization", slug: id, modules: { "route-field": true, personnel: true } } })
        await prisma.mtmSetting.create({ data: { organizationId: id, key: "attendanceEnabled", value: true } })
      }
      for (const id of [userId, enrollment.userId, "employee-pg-manager-user", "employee-pg-rejected-user"]) await prisma.user.create({ data: { id, organizationId, name: "Fictional employee", email: `${id}@example.invalid`, role: id === userId ? "admin" : "sales", passwordHash: "unusable-fixture-hash" } })
      await prisma.mtmTeam.create({ data: { id: "employee-pg-team", organizationId, name: "Fictional office team" } })
      await prisma.mtmAgent.create({ data: { id: "employee-pg-manager", organizationId, userId: "employee-pg-manager-user", name: "Fictional office manager", role: "MANAGER", teamId: "employee-pg-team" } })
    })
  }, 240_000)
  afterAll(async () => {
    await prisma?.$disconnect()
    if (createdDb) sql(adminUrl!, `DROP DATABASE "${scratch!.name}" WITH (FORCE)`)
    if (createdRole) sql(adminUrl!, `DROP ROLE "${scratch!.role}"`)
    if (schemaDir) rmSync(schemaDir, { recursive: true, force: true })
  })
  it("serializes a repeated enrollment into one existing-user card and one hire fact", async () => {
    const result = await Promise.all([0, 1].map(() => tenant(organizationId, () => store.enrollAttendanceEmployee(admin, enrollment))))
    expect(result[0].agentId).toBe(result[1].agentId)
    expect(result.map(row => row.idempotent).sort()).toEqual([false, true])
    agentId = result[0].agentId
    await tenant(organizationId, async () => {
      expect(await prisma.mtmAgent.count({ where: { userId: enrollment.userId } })).toBe(1)
      expect(await prisma.user.count()).toBe(4)
      expect(await prisma.mtmAgent.findUnique({ where: { id: agentId } })).toMatchObject({ userId: enrollment.userId, role: "EMPLOYEE", attendanceParticipant: true, passwordHash: null, canPlanOwnRoutes: false, canSelfPublishRoutes: false })
      const directory = await store.readAttendanceEmployees(admin)
      const employee = directory.employees.find(row => row.id === agentId)!
      expect(employee.history).toHaveLength(1); hireId = employee.history[0].id
      expect(employee.history[0]).toMatchObject({ kind: "HIRE", date: enrollment.hireDate })
      expect(JSON.stringify(directory)).not.toContain("unusable-fixture-hash")
      expect(JSON.stringify(directory)).not.toContain("@example.invalid")
    })
  })
  it("binds the UUID to the actor and body, and retains an enrolled manager's exact field identity", async () => {
    await expect(tenant(organizationId, () => store.enrollAttendanceEmployee(admin, { ...enrollment, hireDate: "2026-09-08" }))).rejects.toMatchObject({ code: "MTM_ATTENDANCE_EMPLOYEE_REPLAY_MISMATCH" })
    await tenant(organizationId, () => store.enrollAttendanceEmployee(admin, { ...enrollment, clientRequestId: randomUUID(), userId: "employee-pg-manager-user", teamId: "employee-pg-team" }))
    await tenant(organizationId, async () => {
      expect(await prisma.mtmAgent.findUnique({ where: { id: "employee-pg-manager" } })).toMatchObject({ role: "MANAGER", teamId: "employee-pg-team", attendanceParticipant: true })
      expect(await self.requireAttendanceSelf(prisma, { organizationId, agentId: "employee-pg-manager", role: "MANAGER" })).toBe("Asia/Baku")
    })
  })
  it("supports rehire on the next date without changing either explicit date or inserting an absence", async () => {
    const id = "employee-pg-manager"
    const original = await tenant(organizationId, () => store.readAttendanceEmployees(admin))
    const previousEventId = original.employees.find(row => row.id === id)!.history.at(-1)!.id
    const termination = await tenant(organizationId, () => store.recordAttendanceEmployment(admin, { clientRequestId: randomUUID(), agentId: id, kind: "TERMINATION", date: "2026-09-07", previousEventId, reason: "Fictional last working date" }))
    await tenant(organizationId, () => store.recordAttendanceEmployment(admin, { clientRequestId: randomUUID(), agentId: id, kind: "REHIRE", date: "2026-09-08", previousEventId: termination.eventId, reason: "Fictional contiguous rehire" }))
    await tenant(organizationId, async () => {
      const events = (await store.readAttendanceEmployees(admin)).employees.find(row => row.id === id)!.history
      expect(events.slice(-2).map(event => [event.kind, event.date])).toEqual([["TERMINATION", "2026-09-07"], ["REHIRE", "2026-09-08"]])
      expect(events.at(-1)!.at).toBe(events.at(-2)!.at)
      const { resolveWorkforceHistoricalEmployment } = await import("@/lib/workforce/employment-history")
      expect(await resolveWorkforceHistoricalEmployment(prisma, { organizationId, agentId: id, occurredAt: new Date(events.at(-1)!.at) })).toMatchObject({ state: "EMPLOYED", event: { kind: "REHIRE" } })
      const result = await report.readMtmAttendanceReport({ organizationId, actor: { role: "ADMIN", agentId: null, scopedAgentIds: null }, query: { from: "2026-09-08", to: "2026-09-08", employeeId: id, form: "ALL" } })
      expect(result.rows[0]).toMatchObject({ employmentState: "EMPLOYED" })
    })
  })
  it("refuses foreign identity, non-admin enrollment and a disabled feature before any write", async () => {
    const input = { ...enrollment, clientRequestId: randomUUID(), userId: "employee-pg-rejected-user" }
    await expect(tenant(organizationId, () => store.enrollAttendanceEmployee({ ...admin, userId: "employee-pg-manager-user" }, input))).rejects.toMatchObject({ status: 403 })
    await expect(tenant("employee-pg-b", () => store.enrollAttendanceEmployee(admin, input))).rejects.toThrow()
    await tenant(organizationId, () => prisma.mtmSetting.update({ where: { organizationId_key: { organizationId, key: "attendanceEnabled" } }, data: { value: false } }))
    try { await expect(tenant(organizationId, () => store.enrollAttendanceEmployee(admin, input))).rejects.toMatchObject({ code: "MTM_ATTENDANCE_DISABLED" }) }
    finally { await tenant(organizationId, () => prisma.mtmSetting.update({ where: { organizationId_key: { organizationId, key: "attendanceEnabled" } }, data: { value: true } })) }
    expect(await tenant(organizationId, () => prisma.mtmAgent.count({ where: { userId: input.userId } }))).toBe(0)
  })
  it("appends termination and rehire, preserves the last working date and rejects stale history", async () => {
    const termination = { clientRequestId: randomUUID(), agentId, kind: "TERMINATION", date: "2026-09-09", previousEventId: hireId, reason: "Fictional recorded termination" }
    const result = await tenant(organizationId, () => store.recordAttendanceEmployment(admin, termination))
    expect(await tenant(organizationId, () => store.recordAttendanceEmployment(admin, termination))).toMatchObject({ eventId: result.eventId, idempotent: true })
    await expect(tenant(organizationId, () => store.recordAttendanceEmployment(admin, { ...termination, clientRequestId: randomUUID() }))).rejects.toMatchObject({ code: "MTM_ATTENDANCE_EMPLOYEE_HISTORY_CHANGED" })
    await tenant(organizationId, () => store.recordAttendanceEmployment(admin, { ...termination, clientRequestId: randomUUID(), kind: "REHIRE", date: "2026-09-14", previousEventId: result.eventId }))
    await tenant(organizationId, async () => {
      const before = (await store.readAttendanceEmployees(admin)).employees.find(row => row.id === agentId)!.history
      expect(before.map(event => [event.kind, event.date])).toEqual([["HIRE", "2026-09-07"], ["TERMINATION", "2026-09-09"], ["REHIRE", "2026-09-14"]])
      await prisma.mtmSetting.create({ data: { organizationId, key: "timezone", value: "America/Los_Angeles" } })
      expect((await store.readAttendanceEmployees(admin)).employees.find(row => row.id === agentId)!.history).toEqual(before)
      await prisma.mtmSetting.delete({ where: { organizationId_key: { organizationId, key: "timezone" } } })
      expect(await prisma.mtmAgent.findUnique({ where: { id: agentId } })).toMatchObject({ status: "ACTIVE" })
      expect(await prisma.mtmAgentWorkday.count()).toBe(0)
    })
  })
  it("includes office employees in the real report while excluding the explicit employment gap", async () => {
    const result = await tenant(organizationId, () => report.readMtmAttendanceReport({ organizationId, actor: { role: "ADMIN", agentId: null, scopedAgentIds: null }, query: { from: "2026-09-07", to: "2026-09-14", employeeId: agentId, form: "ALL" } }))
    expect(result.rows).toHaveLength(8)
    expect(result.rows.filter(row => row.date >= "2026-09-10" && row.date <= "2026-09-13").every(row => row.kind === "NOT_EMPLOYED")).toBe(true)
    expect(result.rows.filter(row => row.kind === "ABSENT")).toHaveLength(4)
  })
  it("records START, PAUSE, RESUME and FINISH only for the authenticated office employee", async () => {
    identity.agentId = agentId
    const start = Date.now() - 240_000, workdayId = randomUUID()
    for (const [index, action] of ["START", "PAUSE", "RESUME", "FINISH"].entries()) {
      const operationId = randomUUID(), data = { action, ...(action === "START" ? { id: workdayId } : { workdayId }), occurredAt: new Date(start + index * 60_000).toISOString() }
      const request = () => new NextRequest("http://localhost/api/v1/mtm/mobile/sync/push", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ operations: [{ operationId, op: "create", entity: "workdays", data, clientTimestamp: Date.now() }] }) })
      const response = await push.POST(request())
      expect(response.status).toBe(200)
      expect((await response.json()).results).toMatchObject([{ status: "ok", serverId: workdayId }])
      expect((await (await push.POST(request())).json()).results).toMatchObject([{ status: "ok", serverId: workdayId }])
    }
    await tenant(organizationId, async () => {
      expect(await prisma.mtmAgentWorkday.findUnique({ where: { id: workdayId } })).toMatchObject({ agentId, status: "COMPLETED", totalPausedSeconds: 60 })
      expect(await prisma.mtmAgentWorkdayEvent.count({ where: { workdayId } })).toBe(4)
      expect(await prisma.mtmSyncOperation.count({ where: { agentId } })).toBe(4)
      expect(await prisma.mtmVisit.count()).toBe(0)
      await expect(prisma.mtmAgentWorkday.update({ where: { id: workdayId }, data: { completedAt: new Date() } })).rejects.toThrow()
    })
  })
  it("refuses a nonexistent local midnight without keeping a partially enrolled card", async () => {
    await tenant(organizationId, () => prisma.mtmSetting.create({ data: { organizationId, key: "timezone", value: "America/Sao_Paulo" } }))
    try {
      await expect(tenant(organizationId, () => store.enrollAttendanceEmployee(admin, { ...enrollment, clientRequestId: randomUUID(), userId: "employee-pg-rejected-user", hireDate: "2018-11-04" }))).rejects.toMatchObject({ code: "MTM_ATTENDANCE_EMPLOYEE_DATE_INVALID", status: 400 })
      expect(await tenant(organizationId, () => prisma.mtmAgent.count({ where: { userId: "employee-pg-rejected-user" } }))).toBe(0)
    } finally { await tenant(organizationId, () => prisma.mtmSetting.delete({ where: { organizationId_key: { organizationId, key: "timezone" } } })) }
  })
  it("rolls back the new card and hire fact if the enrollment audit cannot be saved", async () => {
    sql(scratch!.adminDb, `CREATE FUNCTION fixture_reject_office_enrollment() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'MTM_ATTENDANCE_EMPLOYEE_ENROLLED' THEN RAISE EXCEPTION 'fixture audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER fixture_office_enrollment_audit BEFORE INSERT ON mtm_audit_logs FOR EACH ROW EXECUTE FUNCTION fixture_reject_office_enrollment();`)
    try {
      await expect(tenant(organizationId, () => store.enrollAttendanceEmployee(admin, { ...enrollment, clientRequestId: randomUUID(), userId: "employee-pg-rejected-user" }))).rejects.toThrow()
      expect(await tenant(organizationId, () => prisma.mtmAgent.count({ where: { userId: "employee-pg-rejected-user" } }))).toBe(0)
      expect(await tenant(organizationId, () => prisma.$queryRaw`SELECT id FROM workforce_employment_events WHERE "agentId" NOT IN (SELECT id FROM mtm_agents)`)).toEqual([])
    } finally { sql(scratch!.adminDb, 'DROP TRIGGER fixture_office_enrollment_audit ON mtm_audit_logs; DROP FUNCTION fixture_reject_office_enrollment();') }
  })
  it("keeps history immutable under both RLS and database-owner writes", async () => {
    await tenant(organizationId, async () => {
      expect(await prisma.$executeRaw`UPDATE workforce_employment_events SET "effectiveAt" = NOW() WHERE id = ${hireId}`).toBe(0)
      expect(await prisma.$executeRaw`DELETE FROM workforce_employment_events WHERE id = ${hireId}`).toBe(0)
      expect((await store.readAttendanceEmployees(admin)).employees.find(row => row.id === agentId)!.history[0].date).toBe(enrollment.hireDate)
    })
    expect(() => sql(scratch!.adminDb, `UPDATE workforce_employment_events SET "effectiveAt" = NOW() WHERE id = '${hireId}'`)).toThrow()
    expect(await tenant("employee-pg-b", () => prisma.$queryRaw`SELECT id FROM workforce_employment_events`)).toEqual([])
  })

  const automaticOrg = "employee-pg-automatic", automaticAdminId = "automatic-user-000"
  const automaticAdmin = { organizationId: automaticOrg, userId: automaticAdminId, principalType: "session" as const }
  let automaticAgentId: string, excludedEventId: string
  const exclusionRequest = { clientRequestId: randomUUID(), included: false, previousEventId: null }
  it("upgrades 300 existing active users without hire facts and preserves existing identities", async () => {
    const beforeEmployment = await bypass(() => prisma.$queryRaw`SELECT id FROM workforce_employment_events ORDER BY id`)
    await bypass(async () => {
      await prisma.organization.create({ data: { id: automaticOrg, name: "Fictional automatic participation", slug: automaticOrg, modules: { "route-field": true, personnel: true } } })
      await prisma.mtmSetting.create({ data: { organizationId: automaticOrg, key: "attendanceEnabled", value: true } })
      await prisma.user.createMany({ data: Array.from({ length: 300 }, (_, index) => ({ id: `automatic-user-${String(index).padStart(3, "0")}`,
        organizationId: automaticOrg, name: `Fictional employee ${index}`, email: `automatic-${index}@example.invalid`,
        passwordHash: "automatic-fixture-only", role: index === 0 ? "admin" : "sales" })) })
      await prisma.user.createMany({ data: [
        { id: "automatic-inactive", organizationId: automaticOrg, name: "Inactive fixture", email: "inactive@example.invalid", passwordHash: "fixture", isActive: false },
        { id: "automatic-anonymized", organizationId: automaticOrg, name: "Anonymized fixture", email: "anonymized@example.invalid", passwordHash: "fixture", anonymizedAt: new Date() },
      ] })
      await prisma.mtmTeam.create({ data: { id: "automatic-team", organizationId: automaticOrg, name: "Fictional existing team" } })
      await prisma.mtmAgent.create({ data: { id: "automatic-field", organizationId: automaticOrg, userId: "automatic-user-001", name: "Existing field identity", email: "existing-field@example.invalid",
        role: "AGENT", teamId: "automatic-team", passwordHash: "retained-field-password", canPlanOwnRoutes: true, canSelfPublishRoutes: true } })
      await prisma.mtmAgent.create({ data: { id: "automatic-manual", organizationId: automaticOrg, userId: "automatic-user-002", name: "Existing manual employee",
        role: "EMPLOYEE", attendanceParticipant: true, canPlanOwnRoutes: false } })
      await prisma.mtmAgent.create({ data: { id: "automatic-manager", organizationId: automaticOrg, userId: "automatic-user-003", name: "Existing inactive manager",
        role: "MANAGER", status: "INACTIVE", teamId: "automatic-team", passwordHash: "retained-manager-password" } })
    })
    // db push supplies current columns; remove only this additive migration's
    // empty structures, then exercise the actual deployment SQL over old data.
    sql(scratch!.adminDb, 'DROP TABLE mtm_attendance_participation_events; ALTER TABLE mtm_agents DROP COLUMN "attendanceExcluded", DROP COLUMN "attendanceIncludedFrom"; DROP TABLE mtm_attendance_month_days; DROP TABLE mtm_attendance_month_members; DROP TABLE mtm_attendance_month_closes;')
    sql(scratch!.adminDb, readFileSync("prisma/migrations/20261013190000_mtm_attendance_month_close/migration.sql", "utf8"))
    sql(scratch!.adminDb, readFileSync("prisma/migrations/20261013220000_mtm_attendance_automatic_participation/migration.sql", "utf8"))
    sql(scratch!.adminDb, `GRANT SELECT, INSERT, UPDATE, DELETE ON mtm_attendance_participation_events, mtm_attendance_month_closes, mtm_attendance_month_members, mtm_attendance_month_days TO "${scratch!.role}";`)
    await tenant(automaticOrg, async () => {
      expect(await prisma.mtmAgent.count()).toBe(300)
      expect(await prisma.mtmAgent.count({ where: { userId: { in: ["automatic-inactive", "automatic-anonymized"] } } })).toBe(0)
      expect(await prisma.mtmAgent.findUnique({ where: { id: "automatic-field" } })).toMatchObject({ role: "AGENT", name: "Existing field identity", teamId: "automatic-team",
        passwordHash: "retained-field-password", canPlanOwnRoutes: true, canSelfPublishRoutes: true, attendanceIncludedFrom: null, attendanceExcluded: false })
      expect(await prisma.mtmAgent.findUnique({ where: { id: "automatic-manual" } })).toMatchObject({ attendanceIncludedFrom: null, role: "EMPLOYEE", attendanceParticipant: true })
      expect(await prisma.mtmAgent.findUnique({ where: { id: "automatic-manager" } })).toMatchObject({ status: "INACTIVE", role: "MANAGER", teamId: "automatic-team", passwordHash: "retained-manager-password", attendanceIncludedFrom: expect.any(Date) })
      const card = await prisma.mtmAgent.findFirstOrThrow({ where: { userId: "automatic-user-010" } })
      automaticAgentId = card.id
      expect(card).toMatchObject({ role: "EMPLOYEE", status: "ACTIVE", passwordHash: null, attendanceParticipant: true, attendanceExcluded: false,
        attendanceIncludedFrom: expect.any(Date), canPlanOwnRoutes: false, canSelfPublishRoutes: false })
      expect(await prisma.$queryRaw`SELECT id FROM workforce_employment_events`).toEqual([])
    })
    expect(await bypass(() => prisma.$queryRaw`SELECT id FROM workforce_employment_events ORDER BY id`)).toEqual(beforeEmployment)
    // The existing office hire remains an explicit historical fact and keeps
    // its old baseline; enabling automatic participation does not rewrite it.
    expect(await tenant(organizationId, () => prisma.mtmAgent.findUnique({ where: { id: agentId } }))).toMatchObject({ attendanceIncludedFrom: null })
  }, 180_000)

  it("keeps 300 CRM identities out of Personnel except explicitly enrolled staff, without rewriting facts", async () => {
    await tenant(automaticOrg, async () => {
      const before = [await prisma.mtmAgent.count(), await prisma.mtmAuditLog.count(), await prisma.mtmAttendanceParticipationEvent.count(), await prisma.user.count()]
      const directory = await store.readAttendanceEmployees(automaticAdmin)
      // The existing field agent keeps its card but is not HR attendance: its
      // day belongs to the field manager (owner, 2026-10-14).
      expect(directory.employees.map(employee => employee.id)).toEqual(["automatic-manual"])
      expect(directory.employees.some(employee => employee.id === "automatic-field")).toBe(false)
      expect(directory.users.every(user => !user.eligible)).toBe(true)
      expect(directory.employees.find(employee => employee.id === automaticAgentId)).toBeUndefined()
      expect(JSON.stringify(directory)).not.toMatch(/@example\.invalid|fixture-only|retained-.*-password/)
      expect([await prisma.mtmAgent.count(), await prisma.mtmAuditLog.count(), await prisma.mtmAttendanceParticipationEvent.count(), await prisma.user.count()]).toEqual(before)
      const projection = await report.readMtmAttendanceReport({ organizationId: automaticOrg, actor: { role: "ADMIN", agentId: null, scopedAgentIds: null }, query: { from: "2020-01-01", to: "2020-01-02", employeeId: automaticAgentId, form: "ALL" } })
      expect(projection.rows).toEqual([])
    })
  })

  it("automatically covers new users and reactivation, but does nothing while the module is off", async () => {
    await tenant(automaticOrg, async () => {
      await prisma.user.create({ data: { id: "automatic-new", organizationId: automaticOrg, name: "New fictional user", email: "new@example.invalid", passwordHash: "fixture" } })
      expect(await prisma.mtmAgent.count({ where: { userId: "automatic-new" } })).toBe(1)
      await prisma.user.update({ where: { id: "automatic-inactive" }, data: { isActive: true } })
      expect(await prisma.mtmAgent.count({ where: { userId: "automatic-inactive" } })).toBe(1)
      await prisma.mtmSetting.update({ where: { organizationId_key: { organizationId: automaticOrg, key: "attendanceEnabled" } }, data: { value: false } })
      await prisma.user.create({ data: { id: "automatic-created-off", organizationId: automaticOrg, name: "Created while off", email: "created-off@example.invalid", passwordHash: "fixture" } })
      expect(await prisma.mtmAgent.count({ where: { userId: "automatic-created-off" } })).toBe(0)
      await prisma.mtmSetting.update({ where: { organizationId_key: { organizationId: automaticOrg, key: "attendanceEnabled" } }, data: { value: true } })
      expect(await prisma.mtmAgent.count({ where: { userId: "automatic-created-off" } })).toBe(1)
      expect(await prisma.$queryRaw`SELECT id FROM workforce_employment_events`).toEqual([])
    })
  })

  it("serializes exact replay into one exclusion event and audit without changing account or field permissions", async () => {
    const input = { ...exclusionRequest, agentId: automaticAgentId }
    const result = await Promise.all([0, 1].map(() => tenant(automaticOrg, () => store.setAttendanceParticipation(automaticAdmin, input))))
    expect(result[0].eventId).toBe(result[1].eventId)
    expect(result.map(value => value.idempotent).sort()).toEqual([false, true])
    excludedEventId = result[0].eventId
    await tenant(automaticOrg, async () => {
      expect(await prisma.mtmAttendanceParticipationEvent.count({ where: { agentId: automaticAgentId } })).toBe(1)
      expect(await prisma.mtmAuditLog.count({ where: { action: "MTM_ATTENDANCE_PARTICIPATION_CHANGED" } })).toBe(1)
      expect(await prisma.mtmAgent.findUnique({ where: { id: automaticAgentId } })).toMatchObject({ role: "EMPLOYEE", status: "ACTIVE", attendanceParticipant: true, attendanceExcluded: true })
      expect(await prisma.user.findUnique({ where: { id: "automatic-user-010" } })).toMatchObject({ isActive: true, role: "sales", passwordHash: "automatic-fixture-only" })
      await expect(self.requireAttendanceSelf(prisma, { organizationId: automaticOrg, agentId: automaticAgentId, role: "EMPLOYEE" })).rejects.toMatchObject({ status: 403 })
      const directory = await store.readAttendanceEmployees(automaticAdmin)
      // Excluding a CRM-only identity does not turn it into an HR employee.
      expect(directory.employees.find(employee => employee.id === automaticAgentId)).toBeUndefined()
    })
    await expect(tenant(automaticOrg, () => store.setAttendanceParticipation(automaticAdmin, { ...input, included: true }))).rejects.toMatchObject({ code: "MTM_ATTENDANCE_PARTICIPATION_REPLAY_MISMATCH" })
    await expect(tenant(automaticOrg, () => store.setAttendanceParticipation(automaticAdmin, { ...input, clientRequestId: randomUUID(), included: true }))).rejects.toMatchObject({ code: "MTM_ATTENDANCE_PARTICIPATION_CHANGED" })
  })

  it("keeps exclusion through module toggles and reactivation, then appends re-inclusion with the expected version", async () => {
    await tenant(automaticOrg, async () => {
      await prisma.user.update({ where: { id: "automatic-user-010" }, data: { isActive: false } })
      await prisma.user.update({ where: { id: "automatic-user-010" }, data: { isActive: true } })
      await prisma.mtmSetting.update({ where: { organizationId_key: { organizationId: automaticOrg, key: "attendanceEnabled" } }, data: { value: false } })
      await expect(store.setAttendanceParticipation(automaticAdmin, { clientRequestId: randomUUID(), agentId: automaticAgentId, included: true, previousEventId: excludedEventId })).rejects.toMatchObject({ code: "MTM_ATTENDANCE_DISABLED" })
      await prisma.mtmSetting.update({ where: { organizationId_key: { organizationId: automaticOrg, key: "attendanceEnabled" } }, data: { value: true } })
      expect(await prisma.mtmAgent.findUnique({ where: { id: automaticAgentId } })).toMatchObject({ attendanceExcluded: true })
      const result = await store.setAttendanceParticipation(automaticAdmin, { clientRequestId: randomUUID(), agentId: automaticAgentId, included: true, previousEventId: excludedEventId })
      const events: MtmAttendanceParticipationEvent[] = await prisma.mtmAttendanceParticipationEvent.findMany({ where: { agentId: automaticAgentId }, orderBy: { effectiveAt: "asc" } })
      expect(events.map(event => event.included)).toEqual([false, true])
      expect(events[1].previousEventId).toBe(excludedEventId)
      expect(events[1].id).toBe(result.eventId)
      expect(events[1].effectiveAt.getTime()).toBeGreaterThan(events[0].effectiveAt.getTime())
      expect(await self.requireAttendanceSelf(prisma, { organizationId: automaticOrg, agentId: automaticAgentId, role: "EMPLOYEE" })).toBe("Asia/Baku")
    })
  })

  it("refuses non-admin/foreign changes, cross-tenant history reads and direct exclusion writes", async () => {
    const input = { clientRequestId: randomUUID(), agentId: automaticAgentId, included: false, previousEventId: null }
    await expect(tenant(automaticOrg, () => store.setAttendanceParticipation({ ...automaticAdmin, userId: "automatic-user-010" }, input))).rejects.toMatchObject({ status: 403 })
    await expect(tenant("employee-pg-b", () => store.setAttendanceParticipation(automaticAdmin, input))).rejects.toThrow()
    await tenant("employee-pg-b", async () => {
      expect(await prisma.mtmAttendanceParticipationEvent.findMany({ where: { organizationId: automaticOrg } })).toEqual([])
      await expect(prisma.mtmAttendanceParticipationEvent.create({ data: { id: randomUUID(), organizationId: automaticOrg, agentId: automaticAgentId,
        included: false, requestId: randomUUID(), requestHash: "0".repeat(64), createdBy: automaticAdminId } })).rejects.toThrow()
    })
    await expect(tenant(automaticOrg, () => prisma.mtmAgent.update({ where: { id: automaticAgentId }, data: { attendanceExcluded: true } }))).rejects.toThrow()
    await tenant(automaticOrg, async () => {
      expect(await prisma.$executeRaw`UPDATE mtm_attendance_participation_events SET included = true WHERE id = ${excludedEventId}`).toBe(0)
      expect(await prisma.$executeRaw`DELETE FROM mtm_attendance_participation_events WHERE id = ${excludedEventId}`).toBe(0)
      expect(await prisma.mtmAgent.findUnique({ where: { id: automaticAgentId } })).toMatchObject({ attendanceExcluded: false })
    })
    expect(() => sql(scratch!.adminDb, `UPDATE mtm_attendance_participation_events SET included = true WHERE id = '${excludedEventId}'`)).toThrow()
  })

  it("rolls back the event and exclusion mirror if its audit fails", async () => {
    const previous = await tenant(automaticOrg, () => prisma.mtmAttendanceParticipationEvent.findFirstOrThrow({ where: { agentId: automaticAgentId }, orderBy: { effectiveAt: "desc" } }))
    sql(scratch!.adminDb, `CREATE FUNCTION fixture_reject_participation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'MTM_ATTENDANCE_PARTICIPATION_CHANGED' THEN RAISE EXCEPTION 'fixture audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER fixture_participation_audit BEFORE INSERT ON mtm_audit_logs FOR EACH ROW EXECUTE FUNCTION fixture_reject_participation();`)
    try {
      await expect(tenant(automaticOrg, () => store.setAttendanceParticipation(automaticAdmin, { clientRequestId: randomUUID(), agentId: automaticAgentId, included: false, previousEventId: previous.id }))).rejects.toThrow()
      await tenant(automaticOrg, async () => {
        expect(await prisma.mtmAttendanceParticipationEvent.count({ where: { agentId: automaticAgentId } })).toBe(2)
        expect(await prisma.mtmAgent.findUnique({ where: { id: automaticAgentId } })).toMatchObject({ attendanceExcluded: false })
      })
    } finally { sql(scratch!.adminDb, 'DROP TRIGGER fixture_participation_audit ON mtm_audit_logs; DROP FUNCTION fixture_reject_participation();') }
  })

  it.each(["email", "duplicate"])("fails closed on an existing %s identity conflict and rolls back enabling", async conflict => {
    const org = `automatic-conflict-${conflict}`, uid = `${org}-user`
    await bypass(async () => {
      await prisma.organization.create({ data: { id: org, name: "Fictional identity collision", slug: org } })
      await prisma.mtmSetting.create({ data: { organizationId: org, key: "attendanceEnabled", value: false } })
      await prisma.user.create({ data: { id: uid, organizationId: org, name: "Fictional user", email: `${org}@example.invalid`, passwordHash: "fixture" } })
      await prisma.mtmAgent.create({ data: { id: `${org}-card`, organizationId: org, name: "Existing unrelated card",
        ...(conflict === "email" ? { email: `${org.toUpperCase()}@example.invalid` } : { userId: uid }) } })
      if (conflict === "duplicate") await prisma.mtmAgent.create({ data: { id: `${org}-second`, organizationId: org, name: "Duplicate legacy link", userId: uid } })
    })
    await tenant(org, async () => {
      await expect(prisma.mtmSetting.update({ where: { organizationId_key: { organizationId: org, key: "attendanceEnabled" } }, data: { value: true } })).rejects.toThrow(/MTM_ATTENDANCE_EMPLOYEE_IDENTITY_CONFLICT/)
      expect(await prisma.mtmSetting.findUnique({ where: { organizationId_key: { organizationId: org, key: "attendanceEnabled" } } })).toMatchObject({ value: false })
      expect(await prisma.mtmAgent.count()).toBe(conflict === "email" ? 1 : 2)
      expect(await prisma.mtmAgent.count({ where: { attendanceParticipant: true } })).toBe(0)
    })
  })

  it("refuses a second field card linked to an automatically represented user", async () => {
    await tenant(automaticOrg, async () => {
      await expect(prisma.mtmAgent.create({ data: { organizationId: automaticOrg, userId: "automatic-user-010", name: "Second field card", role: "AGENT" } })).rejects.toThrow(/MTM_ATTENDANCE_EMPLOYEE_IDENTITY_CONFLICT/)
      expect(await prisma.mtmAgent.count({ where: { userId: "automatic-user-010" } })).toBe(1)
    })
  })

  it("protects an active CRM user's link and card while leaving exclusion as a separate operation", async () => {
    await tenant(automaticOrg, async () => {
      const card = await prisma.mtmAgent.findFirstOrThrow({ where: { userId: "automatic-new" } })
      await expect(prisma.mtmAgent.update({ where: { id: card.id }, data: { userId: null } })).rejects.toThrow(/MTM_ATTENDANCE_EMPLOYEE_LINK_REQUIRED/)
      await expect(prisma.mtmAgent.delete({ where: { id: card.id } })).rejects.toThrow(/MTM_ATTENDANCE_EMPLOYEE_LINK_REQUIRED/)
      expect(await prisma.mtmAgent.findUnique({ where: { id: card.id } })).toMatchObject({ userId: "automatic-new", attendanceExcluded: false })
      await prisma.user.update({ where: { id: "automatic-new" }, data: { isActive: false } })
      await prisma.mtmAgent.delete({ where: { id: card.id } })
      expect(await prisma.mtmAgent.count({ where: { userId: "automatic-new" } })).toBe(0)
    })
  })

  it("preserves off-mode unlink and tenant deletion instead of enforcing attendance outside its scope", async () => {
    const org = "automatic-delete-fixture", uid = `${org}-user`
    await bypass(async () => {
      await prisma.organization.create({ data: { id: org, name: "Fictional deletion", slug: org } })
      await prisma.mtmSetting.create({ data: { organizationId: org, key: "attendanceEnabled", value: true } })
      await prisma.user.create({ data: { id: uid, organizationId: org, name: "Deletion fixture", email: `${uid}@example.invalid`, passwordHash: "fixture" } })
      const card = await prisma.mtmAgent.findFirstOrThrow({ where: { organizationId: org, userId: uid } })
      await prisma.mtmSetting.update({ where: { organizationId_key: { organizationId: org, key: "attendanceEnabled" } }, data: { value: false } })
      await prisma.mtmAgent.update({ where: { id: card.id }, data: { userId: null } })
      await prisma.mtmAgent.delete({ where: { id: card.id } })
      await prisma.mtmSetting.update({ where: { organizationId_key: { organizationId: org, key: "attendanceEnabled" } }, data: { value: true } })
      expect(await prisma.mtmAgent.count({ where: { organizationId: org, userId: uid } })).toBe(1)
      await prisma.organization.delete({ where: { id: org } })
      expect(await prisma.mtmAgent.count({ where: { organizationId: org } })).toBe(0)
    })
  })

  it.each(["user-first", "enable-first"])("serializes concurrent enable and user creation (%s) without missing a user", async order => {
    const org = `automatic-race-${order}`, uid = `${org}-user`
    await bypass(async () => {
      await prisma.organization.create({ data: { id: org, name: "Fictional concurrent lifecycle", slug: org } })
      await prisma.mtmSetting.create({ data: { organizationId: org, key: "attendanceEnabled", value: false } })
    })
    let release!: () => void, entered!: () => void
    const released = new Promise<void>(resolve => { release = resolve }), ready = new Promise<void>(resolve => { entered = resolve })
    const first = tenant(org, () => prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      if (order === "user-first") await tx.user.create({ data: { id: uid, organizationId: org, name: "Concurrent user", email: `${uid}@example.invalid`, passwordHash: "fixture" } })
      else await tx.mtmSetting.update({ where: { organizationId_key: { organizationId: org, key: "attendanceEnabled" } }, data: { value: true } })
      entered(); await released
    }, { timeout: 15_000 }))
    // Always release the held connection if the first transaction fails.
    void first.catch(() => { entered(); release() })
    await ready
    const second = tenant(org, async () => order === "user-first"
      ? await prisma.mtmSetting.update({ where: { organizationId_key: { organizationId: org, key: "attendanceEnabled" } }, data: { value: true } })
      : await prisma.user.create({ data: { id: uid, organizationId: org, name: "Concurrent user", email: `${uid}@example.invalid`, passwordHash: "fixture" } }))
    release()
    await Promise.all([first, second])
    expect(await tenant(org, () => prisma.mtmAgent.count({ where: { userId: uid, attendanceParticipant: true } }))).toBe(1)
  })

  it("lets a user provision finish while exclusion waits behind the real month-close canonical locks", async () => {
    const scope = { organizationId: automaticOrg, agentId: "automatic-manual" }
    const { lockMtmWorkdayTransitions } = await import("@/lib/mtm/workday")
    let allowFence!: () => void, entered!: () => void
    const released = new Promise<void>(resolve => { allowFence = resolve }), ready = new Promise<void>(resolve => { entered = resolve })
    // Exact close ordering without manufacturing a closed financial snapshot.
    const closer = tenant(automaticOrg, () => prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await lockMtmWorkdayTransitions(tx, scope)
      await self.lockAttendanceRequests(tx, scope)
      await store.requireAttendanceEmployeeAdmin(tx, automaticAdmin)
      entered(); await released
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`mtm-attendance-month-snapshot:${automaticOrg}`}, 0))`
    }, { timeout: 15_000 }))
    void closer.catch(() => { entered(); allowFence() })
    await ready
    const excluding = tenant(automaticOrg, () => store.setAttendanceParticipation(automaticAdmin, {
      clientRequestId: randomUUID(), agentId: scope.agentId, included: false, previousEventId: null,
    }))
    // Observe the real blocked advisory acquisition before adding the third
    // writer; no sleeps are used to guess which transaction acquired a lock.
    let waiting = false
    try {
      for (let attempt = 0; attempt < 30 && !waiting; attempt++) {
        const [row] = await bypass(() => prisma.$queryRaw<Array<{ waiting: boolean }>>`SELECT EXISTS (
          SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND wait_event = 'advisory' AND pid <> pg_backend_pid()
        ) AS waiting`)
        waiting = row.waiting
        if (!waiting) await new Promise(resolve => setTimeout(resolve, 10))
      }
      expect(waiting).toBe(true)
      await tenant(automaticOrg, () => prisma.user.create({ data: { id: "automatic-month-race-user", organizationId: automaticOrg,
        name: "Concurrent month fixture", email: "month-race@example.invalid", passwordHash: "fixture" } }))
    } finally { allowFence() }
    await Promise.all([closer, excluding])
    expect(await tenant(automaticOrg, () => prisma.mtmAgent.count({ where: { userId: "automatic-month-race-user" } }))).toBe(1)
    expect(await tenant(automaticOrg, () => prisma.mtmAgent.findUnique({ where: { id: scope.agentId } }))).toMatchObject({ role: "EMPLOYEE", attendanceParticipant: true,
      canPlanOwnRoutes: false, attendanceExcluded: true })
  })

  // Owner, 2026-10-15: HR adds office staff in Personnel → Employees, apart from
  // MTM agents; the person is a CRM user (counts against the plan) who sees no module.
  it("keeps an explicitly created employee with incomplete details even when excluded or granted a CRM admin role", async () => {
    const { createAttendanceEmployee } = await import("@/lib/mtm/attendance-employee-create")
    const created = await tenant(automaticOrg, () => createAttendanceEmployee(automaticAdmin, {
      name: "Fictional explicitly added employee", phone: "+994509991901",
    }))
    await tenant(automaticOrg, async () => {
      // A person's role is independent of their explicit personnel enrollment.
      await prisma.user.update({ where: { id: created.userId }, data: { role: "admin" } })
      const entry = (await store.readAttendanceEmployees(automaticAdmin)).employees.find(row => row.id === created.agentId)
      expect(entry).toMatchObject({ position: null, included: true, history: [], includedFrom: expect.any(String) })
      const exclusion = await store.setAttendanceParticipation(automaticAdmin, {
        clientRequestId: randomUUID(), agentId: created.agentId, included: false, previousEventId: null,
      })
      const before = [await prisma.mtmAgent.count(), await prisma.mtmAuditLog.count(), await prisma.mtmAttendanceParticipationEvent.count()]
      const directory = await store.readAttendanceEmployees(automaticAdmin)
      expect(directory.employees.find(row => row.id === created.agentId)).toMatchObject({ included: false, participationVersion: exclusion.eventId })
      const crmOnly = await prisma.mtmAgent.findFirstOrThrow({ where: { userId: automaticAdminId } })
      expect(directory.employees.some(row => row.id === crmOnly.id)).toBe(false)
      expect([await prisma.mtmAgent.count(), await prisma.mtmAuditLog.count(), await prisma.mtmAttendanceParticipationEvent.count()]).toEqual(before)
    })
  })

  it("adds an office employee from Personnel: one hidden-module CRM user and one EMPLOYEE card", async () => {
    const create = await import("@/lib/mtm/attendance-employee-create")
    const bcrypt = (await import("bcryptjs")).default
    const input = { name: "Fictional office hire", email: "Office.Hire@example.invalid", phone: "+994501234567", password: "Fixture-Pass-2026!" }
    const created = await tenant(automaticOrg, () => create.createAttendanceEmployee(automaticAdmin, input))
    await tenant(automaticOrg, async () => {
      const user = await prisma.user.findUniqueOrThrow({ where: { id: created.userId } })
      expect(user).toMatchObject({ email: "office.hire@example.invalid", role: "viewer", isActive: true, phone: "+994501234567" })
      expect(user.hiddenModules).toEqual(expect.arrayContaining(["crm", "sales", "finance", "mtm", "support"]))
      expect(await bcrypt.compare(input.password, user.passwordHash!)).toBe(true)
      // The database trigger made the card; the function did not add a second.
      const cards = await prisma.mtmAgent.findMany({ where: { userId: created.userId } })
      expect(cards).toHaveLength(1)
      expect(cards[0]).toMatchObject({ id: created.agentId, role: "EMPLOYEE", status: "ACTIVE", attendanceParticipant: true, passwordHash: null, canPlanOwnRoutes: false, phone: "+994501234567" })
      expect(await prisma.mtmAuditLog.count({ where: { action: "MTM_ATTENDANCE_EMPLOYEE_CREATED", agentId: created.agentId } })).toBe(1)
      expect((await store.readAttendanceEmployees(automaticAdmin)).employees.some(employee => employee.id === created.agentId)).toBe(true)
    })
    const users = await tenant(automaticOrg, () => prisma.user.count())
    for (const [actor, body, code] of [
      [automaticAdmin, input, "MTM_ATTENDANCE_EMPLOYEE_EMAIL_TAKEN"],
      [automaticAdmin, { ...input, email: "existing-field@example.invalid" }, "MTM_ATTENDANCE_EMPLOYEE_EMAIL_TAKEN"],
      [automaticAdmin, { ...input, email: "short@example.invalid", password: "short" }, "MTM_ATTENDANCE_EMPLOYEE_PASSWORD_WEAK"],
      [automaticAdmin, { ...input, email: "phone@example.invalid", phone: "0501234567" }, "MTM_ATTENDANCE_EMPLOYEE_PHONE_INVALID"],
      // The number signs the person in: a second active person with it would lock both out.
      [automaticAdmin, { ...input, email: "same-number@example.invalid", phone: "+994 50 123 45 67" }, "MTM_ATTENDANCE_EMPLOYEE_PHONE_TAKEN"],
    ] as const) await expect(tenant(automaticOrg, () => create.createAttendanceEmployee(actor, body))).rejects.toMatchObject({ code })
    // A non-administrator (here a sales user) is refused before any write.
    await expect(tenant(automaticOrg, () => create.createAttendanceEmployee({ ...automaticAdmin, userId: "automatic-user-001" }, { ...input, email: "by-sales@example.invalid" })))
      .rejects.toMatchObject({ status: 403 })
    expect(await tenant(automaticOrg, () => prisma.user.count())).toBe(users)
  })

  // Owner, 2026-10-15: «через WhatsApp приходил OTP-пароль, чтоб сами назначали,
  // а кадровик не занимался этой рутиной». HR gives a name and a number only.
  it("adds an employee with only a WhatsApp number, finds them by it, and lets one code through once", async () => {
    const create = await import("@/lib/mtm/attendance-employee-create")
    const phones = await import("@/lib/mtm/mobile-login-phone")
    const codes = await import("@/lib/mtm/mobile-login-code")
    const created = await tenant(automaticOrg, () => create.createAttendanceEmployee(automaticAdmin, { name: "Fictional number-only hire", phone: "+994 55 765 43 21" }))
    expect(created).toMatchObject({ email: null, phone: "+994557654321" })
    await tenant(automaticOrg, async () => {
      const user = await prisma.user.findUniqueOrThrow({ where: { id: created.userId } })
      // The schema wants an email and a password: neither can be used.
      expect(user.email).toMatch(/^staff-[0-9a-f-]{36}@invalid\.local$/)
      expect(create.hasRealEmail(user.email)).toBe(false)
      expect(user.passwordHash.startsWith("$2")).toBe(false)
      const card = await prisma.mtmAgent.findUniqueOrThrow({ where: { id: created.agentId } })
      expect(card).toMatchObject({ email: null, phone: "+994557654321", passwordHash: null, role: "EMPLOYEE", attendanceParticipant: true })
    })
    // Typed the way people type it: national, spaced, international.
    for (const typed of ["055 765 43 21", "+994557654321", "00994557654321"]) {
      expect(await bypass(() => phones.findPhoneOwner(prisma, automaticOrg, typed))).toEqual({ kind: "found", agentId: created.agentId, sendTo: "+994557654321" })
    }
    expect(await bypass(() => phones.findPhoneOwner(prisma, automaticOrg, "+994557654320"))).toEqual({ kind: "none" })

    const now = new Date("2026-10-15T09:00:00Z")
    const first = await bypass(() => codes.issueMobileLoginCode(automaticOrg, "+994557654321", now))
    expect(first.code).toMatch(/^\d{6}$/)
    expect(await bypass(() => codes.secondsUntilResend(automaticOrg, "+994557654321", new Date(now.getTime() + 15_000)))).toBeGreaterThan(40)
    // Only a hash is kept.
    const stored = await bypass(() => prisma.otpCode.findUniqueOrThrow({ where: { id: first.id } }))
    expect(stored).toMatchObject({ organizationId: automaticOrg, purpose: "mtm_app_login", attempts: 0, usedAt: null })
    expect(stored.codeHash).not.toContain(first.code)
    // Asking again retires the first code.
    const second = await bypass(() => codes.issueMobileLoginCode(automaticOrg, "+994557654321", now))
    const wrong = second.code === "000000" ? "111111" : "000000"
    expect(await bypass(() => codes.checkMobileLoginCode(automaticOrg, "+994557654321", wrong, now))).toEqual({ ok: false, reason: "invalid" })
    // Another company with the same number does not see this code.
    expect(await bypass(() => codes.checkMobileLoginCode("employee-pg-other-org", "+994557654321", second.code, now))).toEqual({ ok: false, reason: "expired" })
    if (first.code !== second.code) expect(await bypass(() => codes.checkMobileLoginCode(automaticOrg, "+994557654321", first.code, now))).toEqual({ ok: false, reason: "invalid" })
    expect(await bypass(() => codes.checkMobileLoginCode(automaticOrg, "+994557654321", second.code, now))).toEqual({ ok: true })
    expect(await bypass(() => codes.checkMobileLoginCode(automaticOrg, "+994557654321", second.code, now))).toEqual({ ok: false, reason: "expired" })

    // Five wrong tries retire a code even if the sixth is right.
    const third = await bypass(() => codes.issueMobileLoginCode(automaticOrg, "+994557654321", now))
    const miss = third.code === "000000" ? "111111" : "000000"
    const results = []
    for (let attempt = 0; attempt < 5; attempt++) results.push((await bypass(() => codes.checkMobileLoginCode(automaticOrg, "+994557654321", miss, now))).ok ? "ok" : "no")
    expect(results).toEqual(["no", "no", "no", "no", "no"])
    expect(await bypass(() => codes.checkMobileLoginCode(automaticOrg, "+994557654321", third.code, now))).toEqual({ ok: false, reason: "expired" })
    // Ten minutes later a fresh code has expired.
    const fourth = await bypass(() => codes.issueMobileLoginCode(automaticOrg, "+994557654321", now))
    expect(await bypass(() => codes.checkMobileLoginCode(automaticOrg, "+994557654321", fourth.code, new Date(now.getTime() + 10 * 60_000 + 1)))).toEqual({ ok: false, reason: "expired" })
  })

  // Owner, 2026-10-15: the employee card — position, department, manager and
  // hire date — and «Forma N-1t» reading the position from it.
  // Owner, 2026-10-16: employees are edited on their own page — person, sign-in and work in one save.
  it("edits an employee on their page: name, sign-in phone and email, work and the first hire date", async () => {
    const create = await import("@/lib/mtm/attendance-employee-create")
    const created = await tenant(automaticOrg, () => create.createAttendanceEmployee(automaticAdmin, { name: "Fictional page hire", phone: "+994550007788" }))
    const other = await tenant(automaticOrg, () => create.createAttendanceEmployee(automaticAdmin, { name: "Fictional other hire", phone: "+994550009900" }))
    const before = await tenant(automaticOrg, () => store.readAttendanceEmployee(automaticAdmin, created.agentId))
    expect(before.employee).toMatchObject({ name: "Fictional page hire", phone: "+994550007788", email: null, loginEditable: true, history: [] })
    expect(before.month).toMatchObject({ workedDays: 0, absentCount: expect.any(Number) })
    expect(before.preparation).toMatchObject({ login: "AVAILABLE", branch: null, installations: { required: false, approved: 0, pending: 0 } })
    expect(await tenant(automaticOrg, () => prisma.mtmAgentWorkday.count({ where: { organizationId: automaticOrg, agentId: created.agentId } }))).toBe(0)
    const teamId = before.teams[0]?.id ?? null
    const input = { name: "Fictional page renamed", phone: "+994 55 000 66 55", email: "Page.Renamed@example.invalid", position: "Fictional clerk", teamId, managerId: null, hireDate: "2026-09-01" }
    await tenant(automaticOrg, () => store.updateAttendanceEmployee(automaticAdmin, created.agentId, input))
    const after = await tenant(automaticOrg, async () => ({
      user: await prisma.user.findUniqueOrThrow({ where: { id: created.userId }, select: { name: true, phone: true, email: true } }),
      card: await prisma.mtmAgent.findUniqueOrThrow({ where: { id: created.agentId }, select: { name: true, phone: true, email: true, position: true, teamId: true } }),
      detail: await store.readAttendanceEmployee(automaticAdmin, created.agentId),
    }))
    expect(after.user).toEqual({ name: "Fictional page renamed", phone: "+994550006655", email: "page.renamed@example.invalid" })
    expect(after.card).toEqual({ name: "Fictional page renamed", phone: "+994550006655", email: "page.renamed@example.invalid", position: "Fictional clerk", teamId })
    expect(after.detail.employee.history).toMatchObject([{ kind: "HIRE", date: "2026-09-01" }])
    // A second save never adds another hire: the date then lives in the history.
    await tenant(automaticOrg, () => store.updateAttendanceEmployee(automaticAdmin, created.agentId, { ...input, hireDate: "2026-09-05" }))
    expect((await tenant(automaticOrg, () => store.readAttendanceEmployee(automaticAdmin, created.agentId))).employee.history).toHaveLength(1)
    expect(await tenant(automaticOrg, () => prisma.mtmAuditLog.count({ where: { action: "MTM_ATTENDANCE_EMPLOYEE_UPDATED", agentId: created.agentId } }))).toBe(2)

    const same = { ...input, hireDate: undefined }
    for (const [body, code] of [
      [{ ...same, phone: "+994550009900" }, "MTM_ATTENDANCE_EMPLOYEE_PHONE_TAKEN"],
      [{ ...same, email: "existing-field@example.invalid" }, "MTM_ATTENDANCE_EMPLOYEE_EMAIL_TAKEN"],
      [{ ...same, phone: "0550001122" }, "MTM_ATTENDANCE_EMPLOYEE_PHONE_INVALID"],
    ] as const) await expect(tenant(automaticOrg, () => store.updateAttendanceEmployee(automaticAdmin, created.agentId, body))).rejects.toMatchObject({ code })
    await expect(tenant(automaticOrg, () => store.updateAttendanceEmployee({ ...automaticAdmin, userId: "automatic-user-001" }, other.agentId, { ...same, phone: "+994550009900", email: null }))).rejects.toMatchObject({ status: 403 })
    // An administrator's sign-in is not changed from Personnel; their name is.
    const adminCard = await tenant(automaticOrg, () => prisma.mtmAgent.findFirstOrThrow({ where: { userId: automaticAdminId }, select: { id: true } }))
    const adminDetail = await tenant(automaticOrg, () => store.readAttendanceEmployee(automaticAdmin, adminCard.id))
    expect(adminDetail.employee.loginEditable).toBe(false)
    await expect(tenant(automaticOrg, () => store.updateAttendanceEmployee(automaticAdmin, adminCard.id, { name: adminDetail.employee.name, position: null, teamId: null, managerId: null, phone: "+994550004433" })))
      .rejects.toMatchObject({ code: "MTM_ATTENDANCE_EMPLOYEE_LOGIN_LOCKED" })
    await tenant(automaticOrg, () => store.updateAttendanceEmployee(automaticAdmin, adminCard.id, { name: "Fictional renamed admin", position: null, teamId: null, managerId: null }))
    expect(await tenant(automaticOrg, () => prisma.user.findUniqueOrThrow({ where: { id: automaticAdminId }, select: { name: true } }))).toEqual({ name: "Fictional renamed admin" })
    // Another tenant's administrator cannot reach the employee.
    await expect(tenant(organizationId, () => store.readAttendanceEmployee(admin, created.agentId))).rejects.toMatchObject({ code: "MTM_ATTENDANCE_EMPLOYEE_NOT_FOUND" })
  })

  it("serializes legacy profile phone and metadata saves, rolls both records back on audit failure and locks canonical login fields", async () => {
    const org = "identity-hr-profile-maintenance", oldPhone = "+994507772411", newPhone = "+994507772412", claimedPhone = "+994507772413"
    const fixture = await bypass(async () => {
      await prisma.organization.create({ data: { id: org, slug: org, name: "Fictional identity HR profile", modules: { personnel: true } } })
      await prisma.mtmSetting.create({ data: { organizationId: org, key: "attendanceEnabled", value: true } })
      const actor = await prisma.user.create({ data: { organizationId: org, name: "Fictional HR administrator", email: "admin@hr-identity.invalid", role: "admin", passwordHash: "!fixture" } })
      const target = await prisma.user.create({ data: { organizationId: org, name: "Fictional HR subject", email: "subject@hr-identity.invalid", role: "viewer", passwordHash: "!fixture", phone: oldPhone } })
      const owner = await prisma.user.create({ data: { organizationId: org, name: "Fictional canonical other person", email: "owner@hr-identity.invalid", role: "viewer", passwordHash: "!fixture" } })
      await prisma.identityAccount.create({ data: { organizationId: org, userId: owner.id, cutoverAt: new Date(), passwordHash: "!fixture-canonical" } })
      await prisma.identityPhoneClaim.create({ data: { organizationId: org, userId: owner.id, normalizedPhone: claimedPhone, verifiedAt: new Date(), accountVersion: 1 } })
      return { actorId: actor.id, userId: target.id, cardId: (await prisma.mtmAgent.findFirstOrThrow({ where: { organizationId: org, userId: target.id }, select: { id: true } })).id }
    })
    const reviewer = { organizationId: org, userId: fixture.actorId, principalType: "session" as const }
    const page = { name: "Renamed fictional HR subject", position: null, teamId: null, departmentId: null, managerId: null }
    const state = () => tenant(org, async () => ({
      user: await prisma.user.findUniqueOrThrow({ where: { id: fixture.userId }, select: { name: true, phone: true, isActive: true, role: true, updatedAt: true } }),
      card: await prisma.mtmAgent.findUniqueOrThrow({ where: { id: fixture.cardId }, select: { name: true, phone: true, status: true, userId: true, updatedAt: true } }),
      audit: await prisma.mtmAuditLog.count({ where: { organizationId: org, action: "MTM_ATTENDANCE_EMPLOYEE_UPDATED" } }),
    }))
    const before = await state()
    sql(scratch!.adminDb, `ALTER TABLE mtm_audit_logs ADD CONSTRAINT identity_hr_profile_audit_failure CHECK ("organizationId" <> 'identity-hr-profile-maintenance' OR action <> 'MTM_ATTENDANCE_EMPLOYEE_UPDATED') NOT VALID`)
    try {
      await expect(tenant(org, () => store.updateAttendanceEmployee(reviewer, fixture.cardId, { ...page, phone: newPhone }))).rejects.toBeDefined()
      expect(await state()).toEqual(before)
    } finally { sql(scratch!.adminDb, "ALTER TABLE mtm_audit_logs DROP CONSTRAINT identity_hr_profile_audit_failure") }
    await tenant(org, () => store.updateAttendanceEmployee(reviewer, fixture.cardId, { ...page, phone: newPhone }))
    const maintained = await state()
    expect(maintained.user).toMatchObject({ phone: newPhone, name: page.name, role: "viewer", isActive: true })
    expect(maintained.card).toMatchObject({ phone: newPhone, name: page.name, userId: fixture.userId, status: "ACTIVE" })
    expect(maintained.audit).toBe(1)
    await expect(tenant(org, () => store.updateAttendanceEmployee(reviewer, fixture.cardId, { ...page, phone: claimedPhone })))
      .rejects.toMatchObject({ code: "MTM_ATTENDANCE_EMPLOYEE_LOGIN_LOCKED", status: 409 })
    expect(await state()).toEqual(maintained)

    // A real credential writer holds User first. Metadata must wait on the
    // shared advisory lock before taking actor, rather than deadlocking it.
    let release!: () => void, ready!: () => void
    const held = new Promise<void>(resolve => { release = resolve })
    const started = new Promise<void>(resolve => { ready = resolve })
    let writerPid = 0
    const writer = tenant(org, () => prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'identity-registry:' + org}, 0))`
      writerPid = (await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`)[0].pid
      await tx.$queryRaw`SELECT id FROM users WHERE id=${fixture.userId} AND "organizationId"=${org} FOR UPDATE`
      ready()
      await held
      await tx.$queryRaw`SELECT id FROM mtm_agents WHERE id=${fixture.cardId} AND "organizationId"=${org} FOR UPDATE`
    }, { timeout: 15_000 }))
    await Promise.race([started, writer])
    const metadata = tenant(org, () => store.updateAttendanceEmployee(reviewer, fixture.cardId, { ...page, name: "Serialized metadata" }))
    try {
      let waiting = false
      const deadline = Date.now() + 1500
      while (!waiting && Date.now() < deadline) {
        waiting = await tenant(org, async () => ((await prisma.$queryRaw`
          SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE usename=current_user AND pid<>${writerPid}
            AND wait_event_type='Lock' AND wait_event='advisory') AS waiting`) as Array<{ waiting: boolean }>)[0].waiting)
        if (!waiting) await new Promise(resolve => setTimeout(resolve, 10))
      }
      expect(waiting).toBe(true)
    } finally { release(); await Promise.all([writer, metadata]) }
    expect((await state()).user).toMatchObject({ name: "Serialized metadata", phone: newPhone })
    await bypass(() => prisma.identityAccount.create({ data: { organizationId: org, userId: fixture.userId, cutoverAt: new Date(), passwordHash: "!fixture-authoritative" } }))
    const detail = await tenant(org, () => store.readAttendanceEmployee(reviewer, fixture.cardId))
    expect(detail.employee.loginEditable).toBe(false)
    expect(JSON.stringify(detail)).not.toContain("cutoverAt")
    const canonical = await state()
    for (const body of [{ ...page, phone: newPhone }, { ...page, email: "changed@hr-identity.invalid" }]) {
      await expect(tenant(org, () => store.updateAttendanceEmployee(reviewer, fixture.cardId, body)))
        .rejects.toMatchObject({ code: "MTM_ATTENDANCE_EMPLOYEE_LOGIN_LOCKED", status: 409 })
    }
    expect(await state()).toEqual(canonical)
    await tenant(org, () => store.updateAttendanceEmployee(reviewer, fixture.cardId, { ...page, name: "Canonical metadata" }))
    expect((await state()).user).toMatchObject({ name: "Canonical metadata", phone: newPhone })
  }, 20_000)

  // Owner, 2026-10-16: «где удаление сотрудников» — by his rule for agents: delete without history, dismiss with it.
  it("deletes an office employee added by mistake, dismisses one with history, and leaves CRM users to Settings", async () => {
    const create = await import("@/lib/mtm/attendance-employee-create")
    const mistake = await tenant(automaticOrg, () => create.createAttendanceEmployee(automaticAdmin, { name: "Fictional mistake", phone: "+994550003311" }))
    expect(await tenant(automaticOrg, () => store.removeAttendanceEmployee(automaticAdmin, mistake.agentId, { mode: "DELETE" }))).toMatchObject({ mode: "DELETE" })
    await tenant(automaticOrg, async () => {
      expect(await prisma.mtmAgent.findUnique({ where: { id: mistake.agentId } })).toBeNull()
      expect(await prisma.user.findUniqueOrThrow({ where: { id: mistake.userId }, select: { isActive: true } })).toEqual({ isActive: false })
      expect(await prisma.mtmAuditLog.count({ where: { action: "MTM_ATTENDANCE_EMPLOYEE_DELETED", entityId: mistake.agentId } })).toBe(1)
    })

    const hired = await tenant(automaticOrg, () => create.createAttendanceEmployee(automaticAdmin, { name: "Fictional leaver", phone: "+994550003322", hireDate: "2026-09-01" }))
    await expect(tenant(automaticOrg, () => store.removeAttendanceEmployee(automaticAdmin, hired.agentId, { mode: "DELETE" }))).rejects.toMatchObject({ code: "MTM_ATTENDANCE_EMPLOYEE_HAS_HISTORY" })
    const today = (await import("@/lib/mtm/mobile-week")).currentDateKey(new Date(), "Asia/Baku")
    await expect(tenant(automaticOrg, () => store.removeAttendanceEmployee(automaticAdmin, hired.agentId, { mode: "DISMISS", lastDay: "2099-01-01", reason: "Fictional leaving" })))
      .rejects.toMatchObject({ code: "MTM_ATTENDANCE_EMPLOYEE_DATE_INVALID" })
    await tenant(automaticOrg, () => store.removeAttendanceEmployee(automaticAdmin, hired.agentId, { mode: "DISMISS", lastDay: today, reason: "Fictional leaving" }))
    await tenant(automaticOrg, async () => {
      expect(await prisma.mtmAgent.findUniqueOrThrow({ where: { id: hired.agentId }, select: { status: true } })).toEqual({ status: "INACTIVE" })
      expect(await prisma.user.findUniqueOrThrow({ where: { id: hired.userId }, select: { isActive: true } })).toEqual({ isActive: false })
      expect((await store.readAttendanceEmployees(automaticAdmin)).employees.find(row => row.id === hired.agentId)!.history.map(event => event.kind)).toEqual(["HIRE", "TERMINATION"])
    })

    const unhired = await tenant(automaticOrg, () => create.createAttendanceEmployee(automaticAdmin, { name: "Fictional no hire", phone: "+994550003333" }))
    // A CRM user (here the tenant's sales user) is not removed from Personnel.
    await expect(tenant(automaticOrg, () => store.removeAttendanceEmployee(automaticAdmin, "automatic-manual", { mode: "DELETE" }))).rejects.toMatchObject({ code: "MTM_ATTENDANCE_EMPLOYEE_CRM_USER" })
    // Only an administrator removes.
    await expect(tenant(automaticOrg, () => store.removeAttendanceEmployee({ ...automaticAdmin, userId: "automatic-user-001" }, unhired.agentId, { mode: "DELETE" }))).rejects.toMatchObject({ status: 403 })
    expect(await tenant(automaticOrg, () => prisma.mtmAgent.count({ where: { id: unhired.agentId } }))).toBe(1)
  })

  it("keeps the employee card and shows its position in the report", async () => {
    const create = await import("@/lib/mtm/attendance-employee-create")
    const created = await tenant(automaticOrg, () => create.createAttendanceEmployee(automaticAdmin, { name: "Fictional card hire", email: "card.hire@example.invalid",
      phone: "+994550001122", password: "Fixture-Pass-2026!", position: " Fictional cashier ", newTeamName: "Fictional warehouse", hireDate: "2026-10-01" }))
    const managerId = randomUUID(), supervisorId = randomUUID()
    await bypass(async () => {
      await prisma.mtmAgent.create({ data: { id: managerId, organizationId: automaticOrg, name: "Fictional card manager", role: "MANAGER", position: "Fictional head" } })
      await prisma.mtmAgent.create({ data: { id: supervisorId, organizationId: automaticOrg, name: "Fictional card supervisor", role: "SUPERVISOR" } })
    })
    const card = () => tenant(automaticOrg, () => prisma.mtmAgent.findUniqueOrThrow({ where: { id: created.agentId }, select: { position: true, teamId: true, managerId: true, team: { select: { name: true } } } }))
    const first = await card()
    expect(first).toMatchObject({ position: "Fictional cashier", managerId: null, team: { name: "Fictional warehouse" } })
    const employee = async () => (await tenant(automaticOrg, () => store.readAttendanceEmployees(automaticAdmin))).employees.find(row => row.id === created.agentId)!
    expect((await employee()).history).toMatchObject([{ kind: "HIRE", date: "2026-10-01" }])

    // The same department typed again (any case) is reused, not duplicated.
    const teams = await tenant(automaticOrg, () => prisma.mtmTeam.count())
    const change = { agentId: created.agentId, position: "Fictional senior cashier", teamId: null, newTeamName: "fictional WAREHOUSE", managerId }
    expect(await tenant(automaticOrg, () => store.updateAttendanceEmployeeCard(automaticAdmin, change))).toMatchObject({ idempotent: false })
    expect(await card()).toMatchObject({ position: "Fictional senior cashier", teamId: first.teamId, managerId })
    expect(await tenant(automaticOrg, () => prisma.mtmTeam.count())).toBe(teams)
    const audits = () => tenant(automaticOrg, () => prisma.mtmAuditLog.count({ where: { action: "MTM_ATTENDANCE_EMPLOYEE_CARD_CHANGED", agentId: created.agentId } }))
    expect(await audits()).toBe(1)
    const same = { agentId: created.agentId, position: "Fictional senior cashier", teamId: first.teamId, managerId }
    expect(await tenant(automaticOrg, () => store.updateAttendanceEmployeeCard(automaticAdmin, same))).toMatchObject({ idempotent: true })
    expect(await audits()).toBe(1)

    const directory = await tenant(automaticOrg, () => store.readAttendanceEmployees(automaticAdmin))
    expect(directory.employees.find(row => row.id === created.agentId)).toMatchObject({ position: "Fictional senior cashier", teamId: first.teamId, managerId })
    // A supervisor is scoped by team, not by managerId: naming one would grant nothing.
    expect(directory.managers.map(manager => manager.id)).toContain(managerId)
    expect(directory.managers.map(manager => manager.id)).not.toContain(supervisorId)

    for (const [actor, body, code] of [
      [automaticAdmin, { ...same, managerId: supervisorId }, "MTM_ATTENDANCE_EMPLOYEE_MANAGER_INVALID"],
      [automaticAdmin, { ...same, managerId: created.agentId }, "MTM_ATTENDANCE_EMPLOYEE_MANAGER_INVALID"],
      [automaticAdmin, { ...same, teamId: "missing-team" }, "MTM_ATTENDANCE_EMPLOYEE_TEAM_CHANGED"],
      [automaticAdmin, { ...same, agentId: managerId }, "MTM_ATTENDANCE_EMPLOYEE_NOT_FOUND"],
      [automaticAdmin, { ...same, position: "x".repeat(121) }, "MTM_ATTENDANCE_EMPLOYEE_INVALID"],
    ] as const) await expect(tenant(automaticOrg, () => store.updateAttendanceEmployeeCard(actor, body))).rejects.toMatchObject({ code })
    await expect(tenant(automaticOrg, () => store.updateAttendanceEmployeeCard({ ...automaticAdmin, userId: "automatic-user-001" }, { ...same, position: null }))).rejects.toMatchObject({ status: 403 })
    // Another tenant's administrator cannot reach the card at all.
    await expect(tenant(organizationId, () => store.updateAttendanceEmployeeCard(admin, { ...same, position: null }))).rejects.toMatchObject({ code: "MTM_ATTENDANCE_EMPLOYEE_NOT_FOUND" })
    expect(await card()).toMatchObject({ position: "Fictional senior cashier", managerId })

    // Today: the card was included in attendance just now, so earlier days have no rows.
    const today = (await import("@/lib/mtm/mobile-week")).currentDateKey(new Date(), "Asia/Baku")
    const result = await tenant(automaticOrg, () => report.readMtmAttendanceReport({ organizationId: automaticOrg, actor: { role: "ADMIN", agentId: null, scopedAgentIds: null },
      query: { from: today, to: today, employeeId: created.agentId, form: "ALL" } }))
    expect(result.rows.map(row => row.employeePosition)).toEqual(["Fictional senior cashier"])
  })

  // Owner, 2026-10-22: «тут есть отдел, но нет департамента». A department sits
  // above a section; its head belongs to it without a section.
  it("keeps a department above the section, reused by name and closed to other tenants", async () => {
    const create = await import("@/lib/mtm/attendance-employee-create")
    const head = await tenant(automaticOrg, () => create.createAttendanceEmployee(automaticAdmin, { name: "Fictional IT head", phone: "+994550007701", newDepartmentName: "Fictional IT department" }))
    const unit = (agentId: string) => tenant(automaticOrg, () => prisma.mtmAgent.findUniqueOrThrow({ where: { id: agentId }, select: { departmentId: true, teamId: true, department: { select: { name: true } } } }))
    const headUnit = await unit(head.agentId)
    expect(headUnit).toMatchObject({ teamId: null, department: { name: "Fictional IT department" } })

    // Typed again in another case it is the same department; a new section is created inside it.
    const support = await tenant(automaticOrg, () => create.createAttendanceEmployee(automaticAdmin, { name: "Fictional support clerk", phone: "+994550007702",
      newDepartmentName: "fictional it DEPARTMENT", newTeamName: "Fictional helpdesk" }))
    const supportUnit = await unit(support.agentId)
    expect(supportUnit.departmentId).toBe(headUnit.departmentId)
    expect(await tenant(automaticOrg, () => prisma.mtmDepartment.count())).toBe(1)
    expect(await tenant(automaticOrg, () => prisma.mtmTeam.findUniqueOrThrow({ where: { id: supportUnit.teamId! }, select: { name: true, departmentId: true } })))
      .toEqual({ name: "Fictional helpdesk", departmentId: headUnit.departmentId })

    // A section outside any department joins the one it is picked under.
    const loose = await bypass(() => prisma.mtmTeam.create({ data: { organizationId: automaticOrg, name: "Fictional loose section" }, select: { id: true } }))
    const page = { name: "Fictional IT head", position: null, managerId: null }
    await tenant(automaticOrg, () => store.updateAttendanceEmployee(automaticAdmin, head.agentId, { ...page, departmentId: headUnit.departmentId, teamId: loose.id }))
    expect(await unit(head.agentId)).toMatchObject({ departmentId: headUnit.departmentId, teamId: loose.id })
    expect(await tenant(automaticOrg, () => prisma.mtmTeam.findUniqueOrThrow({ where: { id: loose.id }, select: { departmentId: true } }))).toEqual({ departmentId: headUnit.departmentId })
    // A tab opened before departments sends none: the card keeps its department.
    await tenant(automaticOrg, () => store.updateAttendanceEmployee(automaticAdmin, head.agentId, { ...page, teamId: null }))
    expect(await unit(head.agentId)).toMatchObject({ departmentId: headUnit.departmentId, teamId: null })

    // A section of one department is refused under another, and nothing changes.
    const other = await bypass(() => prisma.mtmDepartment.create({ data: { organizationId: automaticOrg, name: "Fictional finance department" }, select: { id: true } }))
    await expect(tenant(automaticOrg, () => store.updateAttendanceEmployee(automaticAdmin, support.agentId, { ...page, name: "Fictional support clerk", departmentId: other.id, teamId: supportUnit.teamId })))
      .rejects.toMatchObject({ code: "MTM_ATTENDANCE_EMPLOYEE_SECTION_ELSEWHERE" })
    expect(await unit(support.agentId)).toMatchObject({ departmentId: headUnit.departmentId, teamId: supportUnit.teamId })
    // Someone else's department id is not found from this tenant.
    const foreign = await bypass(() => prisma.mtmDepartment.create({ data: { organizationId, name: "Fictional foreign department" }, select: { id: true } }))
    await expect(tenant(automaticOrg, () => store.updateAttendanceEmployee(automaticAdmin, head.agentId, { ...page, departmentId: foreign.id, teamId: null })))
      .rejects.toMatchObject({ code: "MTM_ATTENDANCE_EMPLOYEE_TEAM_CHANGED" })

    const directory = await tenant(automaticOrg, () => store.readAttendanceEmployees(automaticAdmin))
    expect(directory.departments.map(department => department.name).sort()).toEqual(["Fictional IT department", "Fictional finance department"])
    expect(directory.employees.find(row => row.id === support.agentId)).toMatchObject({ departmentName: "Fictional IT department", teamName: "Fictional helpdesk" })
    expect((await tenant(automaticOrg, () => store.readAttendanceEmployee(automaticAdmin, head.agentId))).employee).toMatchObject({ departmentId: headUnit.departmentId, departmentName: "Fictional IT department" })
    // Row-level security: each tenant sees only its own departments.
    expect(await tenant(organizationId, () => prisma.mtmDepartment.findMany({ select: { name: true } }))).toEqual([{ name: "Fictional foreign department" }])
  })

  // Owner, 2026-10-15: Today shows an administrator what is left to set up; each
  // step is read from its own data, never from a stored "done" flag.
  it("reads the setup checklist from the real tables, step by step", async () => {
    const setup = await import("@/lib/mtm/attendance-setup")
    const org = "employee-pg-setup", now = new Date("2026-10-15T08:00:00Z")
    await bypass(async () => {
      await prisma.organization.create({ data: { id: org, name: "Fictional setup organization", slug: org, modules: { "route-field": true, personnel: true } } })
      await prisma.mtmSetting.create({ data: { organizationId: org, key: "attendanceEnabled", value: true } })
    })
    const read = () => tenant(org, () => setup.readAttendanceSetup(org, "Asia/Baku", now))
    const done = async () => Object.fromEntries((await read()).map(step => [step.key, step.done]))
    expect(await done()).toEqual({ hours: false, holidays: false, branches: false, leave: false, employees: false, app: false })
    await bypass(async () => {
      await prisma.user.create({ data: { id: "setup-admin", organizationId: org, name: "Fictional setup admin", email: "setup-admin@example.invalid", passwordHash: "fixture", role: "admin" } })
      // With the provisioning trigger installed the new user already has a card.
      if (!await prisma.mtmAgent.findFirst({ where: { organizationId: org, userId: "setup-admin" } })) {
        await prisma.mtmAgent.create({ data: { id: randomUUID(), organizationId: org, userId: "setup-admin", name: "Fictional setup admin", role: "EMPLOYEE", attendanceParticipant: true } })
      }
      const card = (await prisma.mtmAgent.findFirstOrThrow({ where: { organizationId: org, userId: "setup-admin" } })).id
      await prisma.mtmWorkCalendarDay.create({ data: { organizationId: org, date: new Date("2026-11-08T00:00:00Z"), kind: "PUBLIC_HOLIDAY", name: "Fictional holiday" } })
      await prisma.$executeRaw`INSERT INTO mtm_attendance_rules ("id","organizationId","effectiveFrom","timezone","startTime","endTime","lunchMinutes","lateGraceMinutes","weekendDays","createdBy")
        VALUES ('setup-rule', ${org}, '2026-10-01', 'Asia/Baku', '09:00', '18:00', 60, 10, ARRAY[0,6]::int[], 'setup-admin')`
      await prisma.mtmAttendanceBranch.create({ data: { id: "setup-branch", organizationId: org } })
      await prisma.mtmAttendanceBranchRevision.create({ data: { organizationId: org, branchId: "setup-branch", version: 1, requestId: randomUUID(), requestHash: "a".repeat(64),
        name: "Fictional branch", address: "Fictional address", latitude: 40.4, longitude: 49.8, radiusMeters: 150, active: true, createdBy: "setup-admin" } })
      await prisma.mtmAgentWorkday.create({ data: { organizationId: org, agentId: card, workDate: new Date("2026-10-14T00:00:00Z"), status: "COMPLETED", startedAt: new Date("2026-10-14T05:00:00Z") } })
    })
    const steps = await read()
    expect(Object.fromEntries(steps.map(step => [step.key, step.done]))).toEqual({ hours: true, holidays: true, branches: true, leave: false, employees: true, app: true })
    expect(steps.find(step => step.key === "app")).toMatchObject({ count: 1, total: 1 })
    // An archived branch (its latest revision inactive) no longer counts.
    await bypass(() => prisma.mtmAttendanceBranchRevision.create({ data: { organizationId: org, branchId: "setup-branch", version: 2, requestId: randomUUID(), requestHash: "b".repeat(64),
      name: "Fictional branch", address: "Fictional address", latitude: 40.4, longitude: 49.8, radiusMeters: 150, active: false, createdBy: "setup-admin" } }))
    expect((await done()).branches).toBe(false)
  })
})
