/** Real PostgreSQL: approved proposals, immutable raw journal, ledger and atomic projection. */
import type { Prisma } from "@prisma/client"
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
  const name = `mtm_attendance_corrections_${process.pid}_${Date.now()}`
  const role = `${name}_app`
  const db = new URL(admin); db.pathname = `/${name}`
  const app = new URL(db); app.username = role; app.password = "attendance-fixture-only"
  process.env.DATABASE_URL = app.toString()
  return { name, role, adminDb: db.toString() }
})
function sql(url: string, statement: string) {
  const file = createRequire(import.meta.url).resolve("prisma/build/index.js")
  const result = spawnSync(process.execPath, [file, "db", "execute", "--url", url, "--stdin"], { input: statement, encoding: "utf8", timeout: 180_000, maxBuffer: 1024 * 1024 })
  if (result.status !== 0) throw new Error(`Request fixture SQL failed: ${String(result.stderr || result.stdout).replace(/postgres(?:ql)?:\/\/[^\s]+/g, "[test database]")}`)
}
const pgDescribe = adminUrl ? describe : describe.skip
pgDescribe("MTM corrections on real PostgreSQL", () => {
  let prisma: typeof import("@/lib/prisma").prisma
  let tenant: typeof import("@/lib/rls-context").runWithTenant
  let bypass: typeof import("@/lib/rls-context").runWithRlsBypass
  let store: typeof import("@/lib/mtm/attendance-request-store")
  let decision: typeof import("@/lib/mtm/attendance-request-decision")
  let report: typeof import("@/lib/mtm/attendance-report-store")
  let createdRole = false, createdDb = false
  const ORG = "correction-pg-a", OTHER = "correction-pg-b", AGENT = "correction-pg-employee", ADMIN = "correction-pg-admin"
  const self = { organizationId: ORG, agentId: AGENT, role: "AGENT" }
  const reviewer = { organizationId: ORG, userId: ADMIN, principalType: "session" as const }
  const at = (date: string, time: string) => new Date(`${date}T${time}:00+04:00`)
  const input = (date: string, startTime = "09:00", endTime = "18:00") => ({ clientRequestId: randomUUID(), kind: "TIME_CORRECTION", unit: "HOURS", startDate: date, endDate: date, startTime, endTime, reason: "Fictional forgotten mark" })
  const submit = (body: unknown) => tenant(ORG, () => store.submitAttendanceRequest(self, body))
  const approve = (request: { id: string; version: string }) => tenant(ORG, () => decision.decideAttendanceRequest(reviewer, request.id, { decision: "APPROVED", version: request.version, note: "Verified fixture" }))
  const seedDay = async (date: string, status: "COMPLETED" | "PAUSED" | "STARTED" = "COMPLETED") => tenant(ORG, async () => {
    const day = await prisma.mtmAgentWorkday.create({ data: { organizationId: ORG, agentId: AGENT, workDate: new Date(`${date}T00:00:00Z`), status,
      startedAt: at(date, "09:30"), completedAt: status === "COMPLETED" ? at(date, "17:00") : null,
      pausedAt: status === "PAUSED" ? at(date, "12:00") : null, totalPausedSeconds: status === "COMPLETED" ? 1800 : 0 } })
    const events: Array<["START" | "PAUSE" | "RESUME" | "FINISH", string]> = [["START", "09:30"]]
    if (status !== "STARTED") events.push(["PAUSE", "12:00"])
    if (status === "COMPLETED") events.push(["RESUME", "12:30"], ["FINISH", "17:00"])
    await prisma.mtmAgentWorkdayEvent.createMany({ data: events.map(([type, time]) => ({ organizationId: ORG, agentId: AGENT, workdayId: day.id,
      clientEventId: randomUUID(), type, occurredAt: at(date, time), appliedAt: at(date, time), claimedAt: at(date, time), serverReceivedAt: at(date, time),
      latitude: 12.34567, longitude: 45.67891, note: "PRIVATE_BREAK_MARKER" })) })
    return day
  })
  beforeAll(async () => {
    sql(adminUrl!, `CREATE ROLE "${scratch!.role}" LOGIN PASSWORD 'attendance-fixture-only' NOSUPERUSER NOBYPASSRLS`); createdRole = true
    sql(adminUrl!, `CREATE DATABASE "${scratch!.name}"`); createdDb = true
    const schemaFile = join(mkdtempSync(join(tmpdir(), "attendance-correction-schema-")), "schema.prisma")
    writeFileSync(schemaFile, readFileSync("prisma/schema.prisma", "utf8").split("\n").filter((line) => !/Unsupported\("vector/.test(line)).join("\n"))
    const cli = createRequire(import.meta.url).resolve("prisma/build/index.js")
    const result = spawnSync(process.execPath, [cli, "db", "push", "--schema", schemaFile, "--skip-generate"], { env: { ...process.env, DATABASE_URL: scratch!.adminDb }, encoding: "utf8", timeout: 180_000, maxBuffer: 1024 * 1024 })
    if (result.status !== 0) throw new Error("Correction fixture schema push failed")
    sql(scratch!.adminDb, 'DROP TABLE mtm_attendance_attachments; ALTER TABLE mtm_hrm_requests DROP COLUMN "attendanceDetails"; ALTER TABLE workforce_time_corrections DROP COLUMN "requestHash";')
    for (const name of ["20260806120000_mtm_rls_coverage_completion", "20260806160000_mtm_rls_bypass_clause_normalization", "20261013040000_mtm_attendance_requests"]) sql(scratch!.adminDb, readFileSync(`prisma/migrations/${name}/migration.sql`, "utf8"))
    // Use the retained production SQL verbatim, not substitute trigger mocks.
    const foundation = readFileSync("prisma/migrations/20260828223000_workforce_h3_foundation/migration.sql", "utf8")
    sql(scratch!.adminDb, foundation.slice(foundation.indexOf("-- Tenant data ships fail-closed."), foundation.indexOf("-- A migration runner may own new tables")))
    for (const name of ["20260828224500_workforce_h3_legacy_fact_guard", "20260828230000_workforce_direct_correction_contract", "20261013050000_mtm_attendance_corrections", "20261013210000_mtm_attendance_overnight_corrections"]) sql(scratch!.adminDb, readFileSync(`prisma/migrations/${name}/migration.sql`, "utf8"))
    const reopen = readFileSync("prisma/migrations/20260915210100_workforce_workday_reopen_ledger/migration.sql", "utf8")
    sql(scratch!.adminDb, reopen.slice(reopen.indexOf("CREATE OR REPLACE FUNCTION workforce_guard_completed_workday()"), reopen.indexOf("-- A migration runner can own the new table")))
    sql(scratch!.adminDb, readFileSync("scripts/rls/enable-batch-5.sql", "utf8"))
    sql(scratch!.adminDb, `GRANT USAGE ON SCHEMA public TO "${scratch!.role}"; GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "${scratch!.role}";`)
    prisma = (await import("@/lib/prisma")).prisma
    ;({ runWithTenant: tenant, runWithRlsBypass: bypass } = await import("@/lib/rls-context"))
    store = await import("@/lib/mtm/attendance-request-store")
    decision = await import("@/lib/mtm/attendance-request-decision")
    report = await import("@/lib/mtm/attendance-report-store")
    await bypass(async () => {
      for (const id of [ORG, OTHER]) {
        await prisma.organization.create({ data: { id, name: "Fictional correction company", slug: id, modules: { "route-field": true } } })
        await prisma.mtmSetting.create({ data: { organizationId: id, key: "attendanceEnabled", value: true } })
      }
      for (const [id, role] of [[ADMIN, "admin"], ["correction-pg-owner", "admin"], ["correction-pg-hr", "manager"], ["correction-pg-supervisor", "manager"]]) {
        await prisma.user.create({ data: { id, organizationId: ORG, name: "Fictional reviewer", email: `${id}@example.invalid`, role, passwordHash: "unusable-fixture-hash", mtmAttendanceAll: id === "correction-pg-hr" } })
      }
      for (const id of ["correction-team-a", "correction-team-b"]) await prisma.mtmTeam.create({ data: { id, organizationId: ORG, name: id } })
      await prisma.mtmAgent.create({ data: { id: AGENT, organizationId: ORG, name: "Fictional employee", role: "AGENT", userId: "correction-pg-owner", teamId: "correction-team-a" } })
      await prisma.mtmAgent.create({ data: { id: "correction-supervisor-card", organizationId: ORG, name: "Other team supervisor", role: "SUPERVISOR", userId: "correction-pg-supervisor", teamId: "correction-team-b" } })
    })
  }, 240_000)
  afterAll(async () => {
    await prisma?.$disconnect()
    if (createdDb) sql(adminUrl!, `DROP DATABASE "${scratch!.name}" WITH (FORCE)`)
    if (createdRole) sql(adminUrl!, `DROP ROLE "${scratch!.role}"`)
  })
  it("creates a missing day only with its approved genesis, without fabricating events, and replays a lost response once", async () => {
    const body = input("2026-09-01")
    const { request } = await submit(body)
    expect(request.details.correctionBasis).toEqual({ kind: "MISSING", workDate: body.startDate })
    const results = await Promise.all([approve(request), approve(request)])
    expect(results.map((result) => result.idempotent).sort()).toEqual([false, true])
    await tenant(ORG, async () => {
      const day = await prisma.mtmAgentWorkday.findFirstOrThrow({ where: { agentId: AGENT, workDate: new Date("2026-09-01") } })
      expect(day).toMatchObject({ status: "COMPLETED", startedAt: at(body.startDate, "09:00"), completedAt: at(body.startDate, "18:00") })
      expect(await prisma.mtmAgentWorkdayEvent.count({ where: { workdayId: day.id } })).toBe(0)
      expect(await prisma.workforceTimeCorrection.count({ where: { requestId: request.id } })).toBe(1)
      expect(await prisma.mtmNotification.count({ where: { metadata: { path: ["attendanceRequestId"], equals: request.id } } })).toBe(1)
      expect(await prisma.mtmAuditLog.count({ where: { entityId: request.id, action: "MTM_ATTENDANCE_REQUEST_DECIDED" } })).toBe(1)
      await expect(prisma.mtmAgentWorkday.update({ where: { id: day.id }, data: { completedAt: at(body.startDate, "19:00") } })).rejects.toThrow()
      const correction = await prisma.workforceTimeCorrection.findFirstOrThrow({ where: { requestId: request.id } })
      await expect(prisma.workforceTimeCorrection.update({ where: { id: correction.id }, data: { reason: "Erase history" } })).rejects.toThrow()
    })
  })
  it.each(["missing", "started"])("corrects an overnight %s day through the immutable ledger and retains its source date", async (kind) => {
    const date = kind === "missing" ? "2026-08-30" : "2026-08-31"
    const endDate = kind === "missing" ? "2026-08-31" : "2026-09-01"
    const source = kind === "started" ? await seedDay(date, "STARTED") : null
    const before = source ? await tenant(ORG, () => prisma.mtmAgentWorkdayEvent.findMany({ where: { workdayId: source.id } })) : []
    const { request } = await submit({ ...input(date, "22:00", "06:00"), endDate })
    await approve(request)
    expect(await approve(request)).toMatchObject({ idempotent: true })
    await tenant(ORG, async () => {
      const day = await prisma.mtmAgentWorkday.findFirstOrThrow({ where: { agentId: AGENT, workDate: new Date(date) } })
      expect(day).toMatchObject({ startedAt: at(date, "22:00"), completedAt: at(endDate, "06:00"), status: "COMPLETED" })
      expect(await prisma.mtmAgentWorkdayEvent.findMany({ where: { workdayId: day.id } })).toEqual(before)
      expect(await prisma.workforceTimeCorrection.count({ where: { requestId: request.id } })).toBe(1)
      await expect(prisma.mtmAgentWorkday.update({ where: { id: day.id }, data: { completedAt: at(endDate, "07:00") } })).rejects.toThrow()
      const snapshot = await report.readMtmAttendanceReport({ organizationId: ORG, actor: { role: "ADMIN", agentId: null, scopedAgentIds: null }, query: { form: "ALL", from: date, to: date } })
      expect(snapshot.rows[0]).toMatchObject({ date, factsState: "VALID", workedSeconds: 8 * 3600 })
    })
  })
  it("amends a completed day through the ledger; raw phone times and private pause facts never leak to reports", async () => {
    const day = await seedDay("2026-09-02")
    const before = await tenant(ORG, () => prisma.mtmAgentWorkdayEvent.findMany({ where: { workdayId: day.id }, orderBy: { occurredAt: "asc" } }))
    const { request } = await submit(input("2026-09-02"))
    await approve(request)
    await tenant(ORG, async () => {
      expect(await prisma.mtmAgentWorkdayEvent.findMany({ where: { workdayId: day.id }, orderBy: { occurredAt: "asc" } })).toEqual(before)
      const result = await report.readMtmAttendanceReport({ organizationId: ORG, actor: { role: "ADMIN", agentId: null, scopedAgentIds: null }, query: { form: "ALL", from: "2026-09-02", to: "2026-09-02" } })
      expect(result.rows[0]).toMatchObject({ factsState: "VALID", workedSeconds: 30600, pausedSeconds: 1800, lateSeconds: 0, earlyLeaveSeconds: 0 })
      expect(result.rows[0].corrections).toHaveLength(1)
      expect(result.rows[0].corrections![0]).toMatchObject({ reviewer: { id: ADMIN }, before: { kind: "WORKDAY", facts: { startedAt: at("2026-09-02", "09:30").toISOString() } }, after: { startedAt: at("2026-09-02", "09:00").toISOString() } })
      expect(JSON.stringify(result)).not.toMatch(/latitude|longitude|12\.34567|45\.67891|PRIVATE_BREAK_MARKER|Fictional forgotten mark/)
    })
    // A subsequent proposal uses the corrected basis, not the original phone time.
    const second = await submit(input("2026-09-02", "09:00", "18:30"))
    await approve(second.request)
    expect((await approve(request)).idempotent).toBe(true)
  })
  it("closes an employee-proposed missing finish and preserves a real open pause", async () => {
    const day = await seedDay("2026-09-03", "PAUSED")
    const { request } = await submit(input("2026-09-03", "09:30", "13:00"))
    await approve(request)
    await tenant(ORG, async () => {
      expect(await prisma.mtmAgentWorkday.findUnique({ where: { id: day.id } })).toMatchObject({ status: "COMPLETED", pausedAt: null, totalPausedSeconds: 3600 })
      const result = await report.readMtmAttendanceReport({ organizationId: ORG, actor: { role: "ADMIN", agentId: null, scopedAgentIds: null }, query: { form: "ALL", from: "2026-09-03", to: "2026-09-03" } })
      expect(result.rows[0]).toMatchObject({ factsState: "VALID", workedSeconds: 9000, pausedSeconds: 3600 })
    })
  })
  it("rejects a stale basis when a genuine phone mark arrives after submission", async () => {
    const { request } = await submit(input("2026-09-04"))
    await seedDay("2026-09-04", "STARTED")
    await expect(approve(request)).rejects.toMatchObject({ code: "MTM_ATTENDANCE_CORRECTION_CHANGED" })
    await tenant(ORG, async () => {
      expect(await prisma.mtmHrmRequest.findUnique({ where: { id: request.id } })).toMatchObject({ status: "PENDING" })
      expect(await prisma.workforceTimeCorrection.count({ where: { requestId: request.id } })).toBe(0)
    })
  })
  it("denies own approval, other teams, read-only HR grant, API keys, foreign tenant and current revocation", async () => {
    const { request } = await submit(input("2026-09-07"))
    const raw = { decision: "APPROVED", version: request.version }
    for (const userId of ["correction-pg-owner", "correction-pg-supervisor", "correction-pg-hr"]) {
      await expect(tenant(ORG, () => decision.decideAttendanceRequest({ ...reviewer, userId }, request.id, raw))).rejects.toMatchObject({ status: 403 })
    }
    await expect(tenant(ORG, () => decision.decideAttendanceRequest({ ...reviewer, principalType: "api_key" }, request.id, raw))).rejects.toMatchObject({ status: 403 })
    await expect(tenant(OTHER, () => decision.decideAttendanceRequest({ ...reviewer, organizationId: OTHER }, request.id, raw))).rejects.toMatchObject({ status: 404 })
    await tenant(ORG, () => prisma.user.update({ where: { id: ADMIN }, data: { role: "manager", hiddenModules: ["mtm"] } }))
    await expect(approve(request)).rejects.toMatchObject({ status: 403 })
    await tenant(ORG, () => prisma.user.update({ where: { id: ADMIN }, data: { role: "admin", hiddenModules: [] } }))
    await tenant(ORG, () => prisma.mtmSetting.update({ where: { organizationId_key: { organizationId: ORG, key: "attendanceEnabled" } }, data: { value: false } }))
    await expect(approve(request)).rejects.toMatchObject({ status: 404 })
    await tenant(ORG, () => prisma.mtmSetting.update({ where: { organizationId_key: { organizationId: ORG, key: "attendanceEnabled" } }, data: { value: true } }))
  })
  it("the deferred database guard rejects approval and a fabricated day without the ledger, rolling both back", async () => {
    const { request } = await submit(input("2026-09-08"))
    await expect(tenant(ORG, () => prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const day = await tx.mtmAgentWorkday.create({ data: { organizationId: ORG, agentId: AGENT, workDate: new Date("2026-09-08"), status: "COMPLETED", startedAt: at("2026-09-08", "09:00"), completedAt: at("2026-09-08", "18:00") } })
      await tx.mtmHrmRequest.update({ where: { id: request.id }, data: { status: "APPROVED", correctionWorkdayId: day.id, decidedAt: new Date(), decidedByUserId: ADMIN } })
    }))).rejects.toThrow()
    await tenant(ORG, async () => {
      expect(await prisma.mtmAgentWorkday.count({ where: { workDate: new Date("2026-09-08") } })).toBe(0)
      expect(await prisma.mtmHrmRequest.findUnique({ where: { id: request.id } })).toMatchObject({ status: "PENDING", correctionWorkdayId: null })
    })
  })
  it("rolls back request, genesis, ledger and notification together when the decision audit fails", async () => {
    const { request } = await submit(input("2026-09-09"))
    sql(scratch!.adminDb, `CREATE FUNCTION fixture_reject_attendance_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'MTM_ATTENDANCE_REQUEST_DECIDED' THEN RAISE EXCEPTION 'fixture audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER fixture_attendance_audit BEFORE INSERT ON mtm_audit_logs FOR EACH ROW EXECUTE FUNCTION fixture_reject_attendance_audit();`)
    try { await expect(approve(request)).rejects.toThrow() }
    finally { sql(scratch!.adminDb, 'DROP TRIGGER fixture_attendance_audit ON mtm_audit_logs; DROP FUNCTION fixture_reject_attendance_audit();') }
    await tenant(ORG, async () => {
      expect(await prisma.mtmHrmRequest.findUnique({ where: { id: request.id } })).toMatchObject({ status: "PENDING" })
      expect(await prisma.mtmAgentWorkday.count({ where: { workDate: new Date("2026-09-09") } })).toBe(0)
      expect(await prisma.workforceTimeCorrection.count({ where: { requestId: request.id } })).toBe(0)
      expect(await prisma.mtmNotification.count({ where: { metadata: { path: ["attendanceRequestId"], equals: request.id } } })).toBe(0)
    })
    await approve(request)
  })
})
