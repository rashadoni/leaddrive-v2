/** Shipping enrollment, immutable employment dates and live workday writes on
 * a disposable database with the real restricted application role. */
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
    sql(scratch!.adminDb, 'DROP TABLE workforce_employment_events; DROP TYPE "WorkforceEmploymentEventKind"; ALTER TABLE mtm_agents DROP COLUMN "attendanceParticipant";')
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
})
