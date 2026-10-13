/** Upgrade manual enrollment to automatic participation on a disposable
 * database, retaining employment/workday facts and the restricted app role. */
import { randomUUID } from "node:crypto"
import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { NextRequest } from "next/server"
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
vi.mock("@/lib/mobile-auth", () => ({ resolveMobileAuth: async () => ({ ...identity, tenantCapabilities: { routeField: true, workforceHrm: false } }) }))
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
    sql(scratch!.adminDb, `GRANT USAGE ON SCHEMA public TO "${scratch!.role}"; GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "${scratch!.role}";`)
    prisma = (await import("@/lib/prisma")).prisma
    ;({ runWithTenant: tenant, runWithRlsBypass: bypass } = await import("@/lib/rls-context"))
    store = await import("@/lib/mtm/attendance-employee-store")
    self = await import("@/lib/mtm/attendance-self-access")
    push = await import("@/app/api/v1/mtm/mobile/sync/push/route")
    report = await import("@/lib/mtm/attendance-report-store")
    await bypass(async () => {
      for (const id of [organizationId, "employee-pg-b"]) {
        await prisma.organization.create({ data: { id, name: "Fictional attendance organization", slug: id, modules: { "route-field": true } } })
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
      await prisma.organization.create({ data: { id: automaticOrg, name: "Fictional automatic participation", slug: automaticOrg, modules: { "route-field": true } } })
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

  it("reads all 300 employees without provisioning writes or credential disclosure, and has no invented past absences", async () => {
    await tenant(automaticOrg, async () => {
      const before = [await prisma.mtmAgent.count(), await prisma.mtmAuditLog.count(), await prisma.mtmAttendanceParticipationEvent.count(), await prisma.user.count()]
      const directory = await store.readAttendanceEmployees(automaticAdmin)
      expect(directory.employees).toHaveLength(300)
      expect(directory.users.every(user => !user.eligible)).toBe(true)
      expect(directory.employees.find(employee => employee.id === automaticAgentId)).toMatchObject({ included: true, participationVersion: null, includedFrom: expect.any(String), history: [] })
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
      expect(directory.employees.find(employee => employee.id === automaticAgentId)).toMatchObject({ included: false, participationVersion: excludedEventId })
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
      const events = await prisma.mtmAttendanceParticipationEvent.findMany({ where: { agentId: automaticAgentId }, orderBy: { effectiveAt: "asc" } })
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

  it.each(["user-first", "enable-first"])("serializes concurrent enable and user creation (%s) without missing a user", async order => {
    const org = `automatic-race-${order}`, uid = `${org}-user`
    await bypass(async () => {
      await prisma.organization.create({ data: { id: org, name: "Fictional concurrent lifecycle", slug: org } })
      await prisma.mtmSetting.create({ data: { organizationId: org, key: "attendanceEnabled", value: false } })
    })
    let release!: () => void, entered!: () => void
    const released = new Promise<void>(resolve => { release = resolve }), ready = new Promise<void>(resolve => { entered = resolve })
    const first = tenant(org, () => prisma.$transaction(async tx => {
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
})
