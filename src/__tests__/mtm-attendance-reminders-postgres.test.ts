/** Shipping worker/ledger/inbox with real tenant RLS; no email or push sends. */
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
  const name = `mtm_reminder_${process.pid}_${Date.now()}`, role = `${name}_app`
  const url = new URL(admin); url.pathname = `/${name}`
  const app = new URL(url); app.username = role; app.password = "reminder-fixture-only"
  process.env.DATABASE_URL = app.toString()
  return { name, role, adminDb: url.toString() }
})
const mobileIdentity = vi.hoisted(() => ({ orgId: "reminder-fixture-a", agentId: "", role: "EMPLOYEE" }))
vi.mock("@/lib/mobile-auth", () => ({ resolveMobileAuth: async () => ({ ...mobileIdentity, tenantCapabilities: { routeField: true, workforceHrm: false } }) }))
const providers = vi.hoisted(() => ({ email: vi.fn(), push: vi.fn() }))
vi.mock("@/lib/email", () => ({ sendEmail: providers.email }))
vi.mock("@/lib/push-send", () => ({ sendPushToUser: providers.push }))
const cli = createRequire(import.meta.url).resolve("prisma/build/index.js")
function sql(url: string, statement: string) {
  const result = spawnSync(process.execPath, [cli, "db", "execute", "--url", url, "--stdin"], { input: statement, encoding: "utf8", timeout: 180000, maxBuffer: 1024 * 1024 })
  if (result.status !== 0) throw new Error(`Reminder fixture failed: ${String(result.stderr || result.stdout).replace(/postgres(?:ql)?:\/\/[^\s]+/g, "[test database]")}`)
}
const ORG = "reminder-fixture-a", OTHER = "reminder-fixture-b", ADMIN = "reminder-admin"
const now = new Date("2026-10-12T06:00:00Z"), date = "2026-10-12"
;(adminUrl ? describe : describe.skip)("attendance reminder transaction on restricted PostgreSQL", () => {
  let prisma: typeof import("@/lib/prisma").prisma, tenant: typeof import("@/lib/rls-context").runWithTenant, bypass: typeof import("@/lib/rls-context").runWithRlsBypass
  let store: typeof import("@/lib/mtm/attendance-reminder-store"), visibility: typeof import("@/lib/mtm/attendance-reminder-notification"), policy: typeof import("@/lib/mtm/attendance-reminder-policy")
  let createdDb = false, createdRole = false, directory: string | undefined
  async function employee(org = ORG) {
    const id = randomUUID()
    await bypass(() => prisma.mtmAgent.create({ data: { id, organizationId: org, name: "Fictional employee", role: "EMPLOYEE", attendanceParticipant: true } }))
    return id
  }
  const setting = (key: string, value: boolean) => tenant(ORG, () => prisma.mtmSetting.upsert({ where: { organizationId_key: { organizationId: ORG, key } }, create: { organizationId: ORG, key, value }, update: { value } }))
  const count = (agentId: string) => tenant(ORG, () => prisma.$queryRaw<{ count: number }[]>`SELECT count(*)::int AS count FROM mtm_attendance_reminder_notices WHERE "agentId"=${agentId}`).then(rows => rows[0].count)
  beforeAll(async () => {
    sql(adminUrl!, `CREATE ROLE "${scratch!.role}" LOGIN PASSWORD 'reminder-fixture-only' NOSUPERUSER NOBYPASSRLS`); createdRole = true
    sql(adminUrl!, `CREATE DATABASE "${scratch!.name}"`); createdDb = true
    directory = mkdtempSync(join(tmpdir(), "mtm-reminder-schema-"))
    const schema = join(directory, "schema.prisma")
    writeFileSync(schema, readFileSync("prisma/schema.prisma", "utf8").split("\n").filter(line => !/Unsupported\("vector/.test(line)).join("\n"))
    const pushed = spawnSync(process.execPath, [cli, "db", "push", "--schema", schema, "--skip-generate"], { env: { ...process.env, DATABASE_URL: scratch!.adminDb }, encoding: "utf8", timeout: 180000, maxBuffer: 1024 * 1024 })
    if (pushed.status !== 0) throw new Error("Reminder fixture schema push failed")
    sql(scratch!.adminDb, "DROP TABLE mtm_attendance_reminder_notices")
    for (const migration of ["20260806120000_mtm_rls_coverage_completion", "20260806160000_mtm_rls_bypass_clause_normalization", "20261013170000_mtm_attendance_reminders"]) sql(scratch!.adminDb, readFileSync(`prisma/migrations/${migration}/migration.sql`, "utf8"))
    sql(scratch!.adminDb, readFileSync("scripts/rls/enable-batch-5.sql", "utf8"))
    sql(scratch!.adminDb, `GRANT USAGE ON SCHEMA public TO "${scratch!.role}"; GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO "${scratch!.role}"`)
    prisma = (await import("@/lib/prisma")).prisma
    ;({ runWithTenant: tenant, runWithRlsBypass: bypass } = await import("@/lib/rls-context"))
    store = await import("@/lib/mtm/attendance-reminder-store"); visibility = await import("@/lib/mtm/attendance-reminder-notification"); policy = await import("@/lib/mtm/attendance-reminder-policy")
    await bypass(async () => {
      for (const id of [ORG, OTHER]) {
        await prisma.organization.create({ data: { id, slug: id, name: "Fictional reminders", plan: "enterprise", modules: { mtm: true, "route-field": true }, features: ["mtm"] } })
        for (const key of ["attendanceEnabled", "attendanceEmployeeRemindersEnabled", "attendanceManagerAlertsEnabled"]) await prisma.mtmSetting.create({ data: { organizationId: id, key, value: true } })
      }
      await prisma.user.create({ data: { id: ADMIN, organizationId: ORG, name: "Fictional admin", email: "admin@example.invalid", role: "admin", passwordHash: "unusable" } })
    })
  }, 240000)
  afterAll(async () => {
    await prisma?.$disconnect()
    if (createdDb) sql(adminUrl!, `DROP DATABASE "${scratch!.name}" WITH (FORCE)`)
    if (createdRole) sql(adminUrl!, `DROP ROLE "${scratch!.role}"`)
    if (directory) rmSync(directory, { recursive: true, force: true })
  })
  it("deduplicates parallel ticks and atomically creates safe employee/manager inbox entries", async () => {
    const id = await employee()
    const results = await Promise.all([0, 1].map(() => tenant(ORG, () => store.createAttendanceReminders(ORG, id, now))))
    expect(results.sort()).toEqual([0, 2]); expect(await count(id)).toBe(2)
    const own = await tenant(ORG, () => prisma.mtmNotification.findMany({ where: { agentId: id } }))
    expect(own).toHaveLength(1)
    expect(JSON.stringify(own)).not.toMatch(/latitude|longitude|Fictional employee|SICK|email/)
    const where = await tenant(ORG, () => visibility.attendanceReminderWebFilter(ORG, ADMIN))
    expect(await tenant(ORG, () => prisma.notification.count({ where: { organizationId: ORG, userId: ADMIN, AND: [where] } }))).toBe(1)
    expect(providers.email).not.toHaveBeenCalled(); expect(providers.push).not.toHaveBeenCalled()
  })
  it("rolls back a receipt if the employee inbox write fails, then retries once", async () => {
    const id = await employee()
    sql(scratch!.adminDb, `CREATE FUNCTION reminder_fixture_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."agentId"='${id}' THEN RAISE EXCEPTION 'fixture inbox unavailable'; END IF; RETURN NEW; END $$; CREATE TRIGGER reminder_fixture_fail BEFORE INSERT ON mtm_notifications FOR EACH ROW EXECUTE FUNCTION reminder_fixture_fail()`)
    await expect(tenant(ORG, () => store.createAttendanceReminders(ORG, id, now))).rejects.toThrow()
    expect(await count(id)).toBe(0)
    sql(scratch!.adminDb, "DROP TRIGGER reminder_fixture_fail ON mtm_notifications; DROP FUNCTION reminder_fixture_fail()")
    expect(await tenant(ORG, () => store.createAttendanceReminders(ORG, id, now))).toBe(2)
  })
  it("hides reminders on OFF, skips inactive/nonparticipants and does not catch up yesterday", async () => {
    const id = await employee()
    await setting("attendanceEnabled", false)
    expect(await tenant(ORG, () => store.createAttendanceReminders(ORG, id, now))).toBe(0)
    const gate = await tenant(ORG, () => visibility.attendanceReminderWebFilter(ORG, ADMIN))
    expect(await tenant(ORG, () => prisma.notification.count({ where: { entityType: "mtm_attendance_reminder", AND: [gate] } }))).toBe(0)
    await setting("attendanceEnabled", true)
    await tenant(ORG, () => prisma.mtmAgent.update({ where: { id }, data: { attendanceParticipant: false } }))
    expect(await tenant(ORG, () => store.createAttendanceReminders(ORG, id, now))).toBe(0)
    await tenant(ORG, () => prisma.mtmAgent.update({ where: { id }, data: { attendanceParticipant: true, status: "INACTIVE" } }))
    expect(await tenant(ORG, () => store.createAttendanceReminders(ORG, id, now))).toBe(0)
  })
  it("enforces tenant RLS, immutability and recipient shape at the database boundary", async () => {
    const id = await employee(); await tenant(ORG, () => store.createAttendanceReminders(ORG, id, now))
    expect(await tenant(OTHER, () => prisma.$queryRaw`SELECT id FROM mtm_attendance_reminder_notices WHERE "agentId"=${id}`)).toEqual([])
    expect(await tenant(ORG, () => prisma.$executeRaw`UPDATE mtm_attendance_reminder_notices SET kind='MANAGER_LATE' WHERE "agentId"=${id}`)).toBe(0)
    expect(() => sql(scratch!.adminDb, `UPDATE mtm_attendance_reminder_notices SET kind='MANAGER_LATE' WHERE "agentId"='${id}'`)).toThrow()
    await expect(tenant(ORG, () => prisma.$executeRaw`INSERT INTO mtm_attendance_reminder_notices (id,"organizationId","agentId","workDate",kind,"observedAt","ruleId") VALUES (${randomUUID()},${ORG},${id},${new Date(date)}::date,'EMPLOYEE_START',${now},'fixture')`)).rejects.toThrow()
    const other = await employee(OTHER)
    await expect(tenant(ORG, () => prisma.$executeRaw`INSERT INTO mtm_attendance_reminder_notices (id,"organizationId","agentId","workDate",kind,"recipientAgentId","observedAt","ruleId") VALUES (${randomUUID()},${ORG},${other},${new Date(date)}::date,'EMPLOYEE_START',${other},${now},'fixture')`)).rejects.toThrow()
  })
  it("rechecks manager scope and account activity for old previews", async () => {
    const manager = randomUUID(), id = await employee()
    await bypass(async () => {
      await prisma.user.create({ data: { id: manager, organizationId: ORG, name: "Fictional manager", email: `${manager}@example.invalid`, role: "manager", passwordHash: "unusable" } })
      await prisma.mtmAgent.create({ data: { id: manager, userId: manager, organizationId: ORG, role: "MANAGER", name: "Fictional manager" } })
      await prisma.mtmAgent.update({ where: { id }, data: { managerId: manager } })
    })
    expect(await tenant(ORG, () => store.createAttendanceReminders(ORG, id, now))).toBe(3)
    const visible = () => tenant(ORG, async () => prisma.notification.count({ where: { organizationId: ORG, userId: manager, entityType: "mtm_attendance_reminder", AND: [await visibility.attendanceReminderWebFilter(ORG, manager)] } }))
    expect(await visible()).toBe(1)
    await tenant(ORG, () => prisma.mtmAgent.update({ where: { id }, data: { managerId: null } }))
    expect(await visible()).toBe(0)
    await tenant(ORG, () => prisma.user.update({ where: { id: manager }, data: { isActive: false } }))
    expect(await visible()).toBe(0)
  })
  it("applies the current employee switch to real inbox rows, unread count and mark-read", async () => {
    const id = await employee(); mobileIdentity.agentId = id
    await tenant(ORG, () => store.createAttendanceReminders(ORG, id, now))
    const api = await import("@/app/api/v1/mtm/mobile/notifications/route")
    const get = () => api.GET(new NextRequest("http://localhost/api/v1/mtm/mobile/notifications"))
    const patch = () => api.PATCH(new NextRequest("http://localhost/api/v1/mtm/mobile/notifications", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ all: true, isRead: true }) }))
    expect((await (await get()).json()).data).toMatchObject({ unread: 1, items: [expect.objectContaining({ isRead: false })] })
    await setting("attendanceEmployeeRemindersEnabled", false)
    expect((await (await get()).json()).data).toEqual({ unread: 0, items: [] })
    expect((await (await patch()).json()).data.updated).toBe(0)
    await setting("attendanceEmployeeRemindersEnabled", true)
    expect((await (await patch()).json()).data.updated).toBe(1)
    expect((await (await get()).json()).data.unread).toBe(0)
  })
  it("rolls back a setting change if its mandatory audit fails", async () => {
    sql(scratch!.adminDb, `CREATE FUNCTION reminder_audit_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='MTM_ATTENDANCE_REMINDER_POLICY_CHANGED' THEN RAISE EXCEPTION 'fixture audit unavailable'; END IF; RETURN NEW; END $$; CREATE TRIGGER reminder_audit_fail BEFORE INSERT ON mtm_audit_logs FOR EACH ROW EXECUTE FUNCTION reminder_audit_fail()`)
    await expect(tenant(ORG, () => policy.saveAttendanceReminderPolicy({ organizationId: ORG, userId: ADMIN, principalType: "session" }, { attendanceEmployeeRemindersEnabled: false }))).rejects.toThrow()
    expect(await tenant(ORG, () => policy.readAttendanceReminderPolicy(prisma, ORG))).toMatchObject({ employee: true })
    sql(scratch!.adminDb, "DROP TRIGGER reminder_audit_fail ON mtm_audit_logs; DROP FUNCTION reminder_audit_fail()")
  })
})
