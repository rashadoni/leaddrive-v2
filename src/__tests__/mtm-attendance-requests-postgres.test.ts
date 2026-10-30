/** Real schema, forced tenant RLS, immutable submissions and actual private image bytes. */
import { randomUUID } from "node:crypto"
import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { homedir, tmpdir } from "node:os"
import sharp from "sharp"
import { NextRequest } from "next/server"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

const adminUrl = process.env.MTM_ATTENDANCE_TEST_DATABASE_URL
if (!adminUrl && process.env.MTM_ATTENDANCE_DB_GATE === "required") throw new Error("MTM_ATTENDANCE_TEST_DATABASE_URL is required")
const scratch = vi.hoisted(() => {
  const admin = process.env.MTM_ATTENDANCE_TEST_DATABASE_URL
  if (!admin) return null
  const name = `mtm_attendance_requests_${process.pid}_${Date.now()}`
  const role = `${name}_app`
  const db = new URL(admin); db.pathname = `/${name}`
  const app = new URL(db); app.username = role; app.password = "attendance-fixture-only"
  process.env.DATABASE_URL = app.toString()
  return { name, role, adminDb: db.toString() }
})
const identity = vi.hoisted(() => ({ orgId: "request-pg-a", agentId: "request-pg-owner", role: "EMPLOYEE", personnel: true }))
vi.mock("@/lib/mobile-auth", () => ({ resolveMobileAuth: async () => ({ ...identity, tenantCapabilities: { routeField: true, workforceHrm: false, personnel: identity.personnel } }) }))
function sql(url: string, statement: string) {
  const file = createRequire(import.meta.url).resolve("prisma/build/index.js")
  const result = spawnSync(process.execPath, [file, "db", "execute", "--url", url, "--stdin"], { input: statement, encoding: "utf8", timeout: 180_000, maxBuffer: 1024 * 1024 })
  if (result.status !== 0) throw new Error(`Request fixture SQL failed: ${String(result.stderr || result.stdout).replace(/postgres(?:ql)?:\/\/[^\s]+/g, "[test database]")}`)
}
const pgDescribe = adminUrl ? describe : describe.skip
pgDescribe("MTM requests on real PostgreSQL", () => {
  let prisma: typeof import("@/lib/prisma").prisma
  let tenant: typeof import("@/lib/rls-context").runWithTenant
  let bypass: typeof import("@/lib/rls-context").runWithRlsBypass
  let store: typeof import("@/lib/mtm/attendance-request-store")
  let revocation: typeof import("@/lib/mtm/attendance-request-revocation")
  let recording: typeof import("@/lib/mtm/attendance-hr-recording")
  let review: typeof import("@/lib/mtm/attendance-request-review")
  let decision: typeof import("@/lib/mtm/attendance-request-decision")
  let report: typeof import("@/lib/mtm/attendance-report-store")
  let journal: typeof import("@/lib/mtm/attendance-decision-journal-store")
  let photos: typeof import("@/lib/mtm/attendance-attachment")
  let limits: typeof import("@/lib/mtm/attendance-request-limit-store")
  let quotaApi: typeof import("@/app/api/v2/mtm/mobile/route-field/attendance/request-limits/route")
  let api: typeof import("@/app/api/v2/mtm/mobile/route-field/attendance/requests/route")
  let createdRole = false, createdDb = false
  let documentRuntime: string | undefined
  let documentLogRuntime: string | undefined
  const originalRuntime = process.env.LEADDRIVE_RUNTIME_DIR
  const originalLogs = process.env.LEADDRIVE_LOG_DIR
  const self = { organizationId: "request-pg-a", agentId: "request-pg-owner", role: "EMPLOYEE" }
  const input = (date: string) => ({ clientRequestId: randomUUID(), kind: "HOURLY_ABSENCE", unit: "HOURS", startDate: date, endDate: date, startTime: "09:00", endTime: "10:00", reason: "Fictional request" })
  const submit = (body: unknown) => api.POST(new NextRequest("http://localhost/api/v2/mtm/mobile/route-field/attendance/requests", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }))
  beforeAll(async () => {
    sql(adminUrl!, `CREATE ROLE "${scratch!.role}" LOGIN PASSWORD 'attendance-fixture-only' NOSUPERUSER NOBYPASSRLS`); createdRole = true
    sql(adminUrl!, `CREATE DATABASE "${scratch!.name}"`); createdDb = true
    const schemaFile = join(mkdtempSync(join(tmpdir(), "attendance-request-schema-")), "schema.prisma")
    writeFileSync(schemaFile, readFileSync("prisma/schema.prisma", "utf8").split("\n").filter((line) => !/Unsupported\("vector/.test(line)).join("\n"))
    const cli = createRequire(import.meta.url).resolve("prisma/build/index.js")
    const result = spawnSync(process.execPath, [cli, "db", "push", "--schema", schemaFile, "--skip-generate"], { env: { ...process.env, DATABASE_URL: scratch!.adminDb }, encoding: "utf8", timeout: 180_000, maxBuffer: 1024 * 1024 })
    if (result.status !== 0) throw new Error("Request fixture schema push failed")
    sql(scratch!.adminDb, 'DROP TABLE workforce_employment_events; DROP TYPE "WorkforceEmploymentEventKind"; DROP TABLE mtm_attendance_attachments; ALTER TABLE mtm_hrm_requests DROP COLUMN "attendanceDetails";')
    for (const migration of ["20260830150000_workforce_employment_history", "20260806120000_mtm_rls_coverage_completion", "20260806160000_mtm_rls_bypass_clause_normalization", "20261013040000_mtm_attendance_requests", "20261013060000_mtm_attendance_hr_recording"]) sql(scratch!.adminDb, readFileSync(`prisma/migrations/${migration}/migration.sql`, "utf8"))
    sql(scratch!.adminDb, readFileSync("scripts/rls/enable-batch-5.sql", "utf8"))
    sql(scratch!.adminDb, `GRANT USAGE ON SCHEMA public TO "${scratch!.role}"; GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "${scratch!.role}";`)
    // Exercise the real external-runtime guard, which correctly rejects /tmp.
    documentRuntime = mkdtempSync(join(homedir(), ".attendance-private-documents-test-"))
    process.env.LEADDRIVE_RUNTIME_DIR = documentRuntime
    documentLogRuntime = mkdtempSync(join(homedir(), ".attendance-private-logs-test-"))
    process.env.LEADDRIVE_LOG_DIR = documentLogRuntime
    prisma = (await import("@/lib/prisma")).prisma
    ;({ runWithTenant: tenant, runWithRlsBypass: bypass } = await import("@/lib/rls-context"))
    store = await import("@/lib/mtm/attendance-request-store")
    revocation = await import("@/lib/mtm/attendance-request-revocation")
    recording = await import("@/lib/mtm/attendance-hr-recording")
    review = await import("@/lib/mtm/attendance-request-review")
    decision = await import("@/lib/mtm/attendance-request-decision")
    report = await import("@/lib/mtm/attendance-report-store")
    journal = await import("@/lib/mtm/attendance-decision-journal-store")
    photos = await import("@/lib/mtm/attendance-attachment")
    limits = await import("@/lib/mtm/attendance-request-limit-store")
    quotaApi = await import("@/app/api/v2/mtm/mobile/route-field/attendance/request-limits/route")
    api = await import("@/app/api/v2/mtm/mobile/route-field/attendance/requests/route")
    await bypass(async () => {
      for (const org of ["request-pg-a", "request-pg-b"]) {
        await prisma.organization.create({ data: { id: org, name: "Fictional request organization", slug: org, modules: { "route-field": true, personnel: true } } })
        await prisma.mtmSetting.create({ data: { organizationId: org, key: "attendanceEnabled", value: true } })
      }
      await prisma.user.create({ data: { id: "request-pg-admin", organizationId: self.organizationId, name: "Fictional limits administrator", email: "limits-admin@example.invalid", role: "admin", passwordHash: "unusable-fixture-hash" } })
      for (const [id, org] of [["request-pg-owner", "request-pg-a"], ["request-pg-colleague", "request-pg-a"], ["request-pg-foreign", "request-pg-b"]]) await prisma.mtmAgent.create({ data: { id, organizationId: org, name: "Fictional employee", role: "EMPLOYEE", attendanceParticipant: true, status: "ACTIVE" } })
    })
  }, 240_000)
  afterAll(async () => {
    await prisma?.$disconnect()
    if (createdDb) sql(adminUrl!, `DROP DATABASE "${scratch!.name}" WITH (FORCE)`)
    if (createdRole) sql(adminUrl!, `DROP ROLE "${scratch!.role}"`)
    if (documentRuntime) rmSync(documentRuntime, { recursive: true, force: true })
    if (documentLogRuntime) rmSync(documentLogRuntime, { recursive: true, force: true })
    if (originalRuntime === undefined) delete process.env.LEADDRIVE_RUNTIME_DIR; else process.env.LEADDRIVE_RUNTIME_DIR = originalRuntime
    if (originalLogs === undefined) delete process.env.LEADDRIVE_LOG_DIR; else process.env.LEADDRIVE_LOG_DIR = originalLogs
  })
  it("commits one UUID exactly once under a race, binds the body and keeps workday facts untouched", async () => {
    const body = input("2026-11-02")
    const responses = await Promise.all([submit(body), submit(body)])
    expect(responses.map((response) => response.status).sort()).toEqual([200, 201])
    const payloads = await Promise.all(responses.map((response) => response.json()))
    expect(payloads[0].data.request.id).toBe(payloads[1].data.request.id)
    expect((await submit({ ...body, endTime: "11:00" })).status).toBe(409)
    await tenant(self.organizationId, async () => {
      expect(await prisma.mtmHrmRequest.count({ where: { clientRequestId: body.clientRequestId } })).toBe(1)
      expect(await prisma.mtmAuditLog.count({ where: { entityId: payloads[0].data.request.id, action: "MTM_ATTENDANCE_REQUEST_SUBMITTED" } })).toBe(1)
      expect(await prisma.mtmAgentWorkday.count()).toBe(0)
      await expect(prisma.mtmHrmRequest.update({ where: { id: payloads[0].data.request.id }, data: { reason: "Changed after submission" } })).rejects.toThrow()
      await expect(prisma.mtmHrmRequest.delete({ where: { id: payloads[0].data.request.id } })).rejects.toThrow()
    })
  })
  it("serializes different overlapping UUIDs, allows adjacent hours, and audits pending cancellation", async () => {
    const body = input("2026-12-03")
    const responses = await Promise.all([submit(body), submit({ ...body, clientRequestId: randomUUID() })])
    expect(responses.map((response) => response.status).sort()).toEqual([201, 409])
    expect((await submit({ ...body, clientRequestId: randomUUID(), startTime: "10:00", endTime: "11:00" })).status).toBe(201)
    const winner = await responses.find((response) => response.status === 201)!.json()
    await tenant(self.organizationId, async () => {
      expect(await store.cancelOwnAttendanceRequest(self, winner.data.request.id)).toMatchObject({ idempotent: false, request: { status: "CANCELLED" } })
      expect(await store.cancelOwnAttendanceRequest(self, winner.data.request.id)).toMatchObject({ idempotent: true })
      expect(await prisma.mtmAuditLog.count({ where: { entityId: winner.data.request.id, action: "MTM_ATTENDANCE_REQUEST_CANCELLED" } })).toBe(1)
    })
    expect((await submit({ ...body, clientRequestId: randomUUID() })).status).toBe(201)
  })
  it("binds real re-encoded photo bytes to the owner and request, rejects foreign documents and reviewer drafts", async () => {
    const body = input("2027-01-04")
    const bytes = await sharp({ create: { width: 16, height: 16, channels: 3, background: "white" } }).png().withExif({ IFD0: { ImageDescription: "PRIVATE_COORDINATE_MARKER" } }).toBuffer()
    const upload = { clientRequestId: body.clientRequestId, clientAttachmentId: randomUUID() }
    const photo = await tenant(self.organizationId, () => photos.uploadAttendanceDocument(self, upload, bytes))
    expect(await tenant(self.organizationId, () => photos.uploadAttendanceDocument(self, upload, bytes))).toMatchObject({ id: photo.id, idempotent: true })
    const reader = { organizationId: self.organizationId, actor: { role: "MANAGER" as const, agentId: null, scopedAgentIds: [self.agentId] } }
    await expect(tenant(self.organizationId, () => photos.readAttendanceDocument(reader, photo.id))).rejects.toMatchObject({ status: 404 })
    expect((await submit({ ...body, clientRequestId: randomUUID(), attachmentIds: [photo.id] })).status).toBe(400)
    expect((await submit({ ...body, attachmentIds: [photo.id] })).status).toBe(201)
    const fetched = await tenant(self.organizationId, () => photos.readAttendanceDocument(reader, photo.id))
    expect((await sharp(fetched.bytes).metadata()).exif).toBeUndefined()
    expect(fetched.bytes.includes(Buffer.from("PRIVATE_COORDINATE_MARKER"))).toBe(false)
    await expect(tenant(self.organizationId, () => photos.readAttendanceDocument({ organizationId: self.organizationId, self: { ...self, agentId: "request-pg-colleague" } }, photo.id))).rejects.toMatchObject({ status: 404 })
    await expect(tenant(self.organizationId, () => photos.readAttendanceDocument({ ...reader, actor: { ...reader.actor, scopedAgentIds: ["request-pg-colleague"] } }, photo.id))).rejects.toMatchObject({ status: 404 })
    await tenant("request-pg-b", async () => {
      expect(await prisma.mtmAttendanceAttachment.count({ where: { id: photo.id } })).toBe(0)
      expect(await prisma.mtmHrmRequest.count({ where: { clientRequestId: body.clientRequestId } })).toBe(0)
    })
    await expect(tenant(self.organizationId, () => photos.uploadAttendanceDocument(self, { ...upload, clientAttachmentId: randomUUID() }, bytes))).rejects.toMatchObject({ code: "MTM_ATTENDANCE_DOCUMENT_REQUEST_SUBMITTED" })
  })
  it("has no writes for a disabled feature, denied capability or another owner, and never leaks draft storage keys", async () => {
    const before = await tenant(self.organizationId, () => prisma.mtmHrmRequest.count())
    // Requests are the Personnel module (2026-10-14), not routes.
    identity.personnel = false
    expect((await submit(input("2027-02-05"))).status).toBe(403)
    identity.personnel = true
    expect((await submit({ ...input("2027-02-05"), agentId: "request-pg-colleague" })).status).toBe(400)
    await tenant(self.organizationId, () => prisma.mtmSetting.update({ where: { organizationId_key: { organizationId: self.organizationId, key: "attendanceEnabled" } }, data: { value: false } }))
    expect((await submit(input("2027-02-05"))).status).toBe(404)
    expect(await tenant(self.organizationId, () => prisma.mtmHrmRequest.count())).toBe(before)
    await tenant(self.organizationId, () => prisma.mtmSetting.update({ where: { organizationId_key: { organizationId: self.organizationId, key: "attendanceEnabled" } }, data: { value: true } }))
    const listing = await tenant(self.organizationId, () => store.listOwnAttendanceRequests(self))
    const json = JSON.stringify(listing)
    expect(json).not.toMatch(/storageKey|sourceSha256|submissionHash/)
    expect(listing.items.every((item) => item.agentId === self.agentId)).toBe(true)
  })
  it("reserves the default three monthly requests atomically across non-overlapping dates and excludes the following month", async () => {
    for (const date of ["2027-03-01", "2027-03-02"]) expect((await submit(input(date))).status).toBe(201)
    const responses = await Promise.all([submit(input("2027-03-03")), submit(input("2027-03-04"))])
    expect(responses.map((response) => response.status).sort()).toEqual([201, 409])
    expect(await responses.find((response) => response.status === 409)!.json()).toMatchObject({ code: "MTM_ATTENDANCE_REQUEST_COUNT_LIMIT" })
    const own = await quotaApi.GET(new NextRequest("http://localhost/api/v2/mtm/mobile/route-field/attendance/request-limits?month=2027-03&agentId=request-pg-colleague"))
    expect(await own.json()).toMatchObject({ data: { month: "2027-03", usedMinutes: 180, usedRequests: 3, remainingRequests: 0, remainingMinutes: 300 } })
    expect((await submit(input("2027-04-01"))).status).toBe(201)
  })
  it("permits exactly eight hours, counts hourly TIME_OFF too and returns the reservation after own cancellation", async () => {
    const body = { ...input("2027-05-01"), endTime: "16:30" }
    const first = await submit(body)
    expect(first.status).toBe(201)
    const original = await first.json()
    expect((await submit({ ...input("2027-05-02"), kind: "TIME_OFF", endTime: "09:30" })).status).toBe(201)
    const over = await submit({ ...input("2027-05-03"), endTime: "09:01" })
    expect(over.status).toBe(409)
    expect(await over.json()).toMatchObject({ code: "MTM_ATTENDANCE_REQUEST_MINUTES_LIMIT" })
    // Retrying the first UUID at exhausted quota still returns its existing request.
    expect((await submit(body)).status).toBe(200)
    await tenant(self.organizationId, () => store.cancelOwnAttendanceRequest(self, original.data.request.id))
    expect((await submit(input("2027-05-03"))).status).toBe(201)
    const usage = await tenant(self.organizationId, () => store.readOwnAttendanceRequestQuota(self, "2027-05"))
    expect(usage).toMatchObject({ usedRequests: 2, usedMinutes: 90, remainingMinutes: 390 })
  })
  it("changes company limits with a version and audit, preserves old requests, and zero stops only new hourly absence submissions", async () => {
    const body = input("2027-06-01")
    const original = await submit(body)
    expect(original.status).toBe(201)
    const before = await original.json()
    const changed = await tenant(self.organizationId, () => limits.saveAttendanceRequestLimits(self.organizationId, "request-pg-admin", { monthlyMinutes: 0, monthlyRequests: 0, version: null }))
    expect(changed).toMatchObject({ monthlyMinutes: 0, monthlyRequests: 0 })
    expect((await submit(body)).status).toBe(200)
    expect((await submit(input("2027-06-02"))).status).toBe(409)
    expect((await submit({ clientRequestId: randomUUID(), kind: "SICK_LEAVE", unit: "DAYS", startDate: "2027-06-03", endDate: "2027-06-03", reason: "Fictional document" })).status).toBe(201)
    await tenant(self.organizationId, async () => {
      expect(await prisma.mtmHrmRequest.findUnique({ where: { id: before.data.request.id } })).toMatchObject({ status: "PENDING" })
      expect(await prisma.mtmAuditLog.count({ where: { metadataKind: "mtm_attendance_request_limits" } })).toBe(1)
      await expect(limits.saveAttendanceRequestLimits(self.organizationId, "request-pg-admin", { monthlyMinutes: 480, monthlyRequests: 3, version: null })).rejects.toMatchObject({ status: 409 })
      await limits.saveAttendanceRequestLimits(self.organizationId, "request-pg-admin", { monthlyMinutes: 480, monthlyRequests: 3, version: changed.version })
    })
  })

  it("commits a reviewer bell with submission, decides leave once, and projects its kind without overwriting a holiday", async () => {
    const reviewer = { organizationId: self.organizationId, userId: "request-pg-admin", principalType: "session" as const }
    const body = { clientRequestId: randomUUID(), kind: "ANNUAL_LEAVE", unit: "DAYS", startDate: "2026-08-10", endDate: "2026-08-12", reason: "PRIVATE_LEAVE_REASON" }
    const response = await submit(body)
    expect(response.status).toBe(201)
    const row = (await response.json()).data.request
    expect((await submit(body)).status).toBe(200)
    await tenant(self.organizationId, async () => {
      const bells = await prisma.notification.findMany({ where: { entityType: "mtm_attendance_request", entityId: row.id } })
      expect(bells).toHaveLength(1)
      expect(bells[0].userId).toBe(reviewer.userId)
      expect(JSON.stringify(bells)).not.toMatch(/PRIVATE_LEAVE_REASON|ANNUAL_LEAVE|SICK_LEAVE/)
      expect((await review.listAttendanceRequestsForReview(reviewer, {})).items.some(item => item.id === row.id)).toBe(true)
      await prisma.mtmWorkCalendarDay.create({ data: { organizationId: self.organizationId, date: new Date("2026-08-11"), kind: "PUBLIC_HOLIDAY", name: "Fictional calendar holiday" } })
    })
    const raw = { decision: "APPROVED", version: row.version, note: "Fictional reviewed leave" }
    const answers = await Promise.all([1, 2].map(() => tenant(self.organizationId, () => decision.decideAttendanceRequest(reviewer, row.id, raw))))
    expect(answers.map(item => item.idempotent).sort()).toEqual([false, true])
    await tenant(self.organizationId, async () => {
      expect(await prisma.mtmAuditLog.count({ where: { entityId: row.id, action: "MTM_ATTENDANCE_REQUEST_DECIDED" } })).toBe(1)
      expect(await prisma.mtmNotification.count({ where: { metadata: { path: ["attendanceRequestId"], equals: row.id } } })).toBe(1)
      expect(await prisma.mtmAgentWorkday.count()).toBe(0)
      const result = await report.readMtmAttendanceReport({ organizationId: self.organizationId, actor: { role: "ADMIN", agentId: null, scopedAgentIds: null }, query: { from: body.startDate, to: body.endDate, form: "ALL", employeeId: self.agentId } })
      expect(result.rows.map(item => item.kind)).toEqual(["APPROVED_REQUEST", "HOLIDAY", "APPROVED_REQUEST"])
      expect(result.totals.absentCount).toBe(0)
      expect(JSON.stringify(result)).not.toMatch(/PRIVATE_LEAVE_REASON|Fictional reviewed leave|attachmentIds|submissionHash/)
      await expect(decision.decideAttendanceRequest(reviewer, row.id, { ...raw, decision: "REJECTED" })).rejects.toMatchObject({ status: 409 })
    })
  })
  it("rejection releases a reserved monthly slot and the employee reads the same answer", async () => {
    const requests = []
    for (const date of ["2027-07-01", "2027-07-02", "2027-07-03"]) {
      const response = await submit(input(date)); expect(response.status).toBe(201)
      requests.push((await response.json()).data.request)
    }
    expect((await submit(input("2027-07-04"))).status).toBe(409)
    await tenant(self.organizationId, async () => {
      const target = requests[0]
      await decision.decideAttendanceRequest({ organizationId: self.organizationId, userId: "request-pg-admin", principalType: "session" }, target.id, { decision: "REJECTED", version: target.version, note: "Fictional rejection explanation" })
      const own = await store.listOwnAttendanceRequests(self)
      expect(own.items.find(item => item.id === target.id)).toMatchObject({ status: "REJECTED", decisionNote: "Fictional rejection explanation" })
      expect((await store.readOwnAttendanceRequestQuota(self, "2027-07")).usedRequests).toBe(2)
    })
    expect((await submit(input("2027-07-04"))).status).toBe(201)
  })
  it("rolls submission and audit back if its durable reviewer notification cannot commit", async () => {
    const body = { clientRequestId: randomUUID(), kind: "SICK_LEAVE", unit: "DAYS", startDate: "2026-08-20", endDate: "2026-08-20", reason: "Private fictional reason" }
    sql(scratch!.adminDb, `CREATE FUNCTION fixture_reject_attendance_bell() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."entityType" = 'mtm_attendance_request' THEN RAISE EXCEPTION 'fixture bell unavailable'; END IF; RETURN NEW; END $$; CREATE TRIGGER fixture_attendance_bell BEFORE INSERT ON notifications FOR EACH ROW EXECUTE FUNCTION fixture_reject_attendance_bell();`)
    try { expect((await submit(body)).status).toBe(500) }
    finally { sql(scratch!.adminDb, 'DROP TRIGGER fixture_attendance_bell ON notifications; DROP FUNCTION fixture_reject_attendance_bell();') }
    await tenant(self.organizationId, async () => {
      expect(await prisma.mtmHrmRequest.count({ where: { clientRequestId: body.clientRequestId } })).toBe(0)
    })
  })

  it("records an explicit HR batch exactly once, retains author/reason and projects the catalogue snapshot", async () => {
    const reviewer = { organizationId: self.organizationId, userId: "request-pg-admin", principalType: "session" as const }
    const body = { clientRequestId: randomUUID(), agentIds: [self.agentId, "request-pg-colleague"], dayKindKey: "STUDY_LEAVE", catalogueVersion: null,
      unit: "DAYS", startDate: "2027-08-10", endDate: "2027-08-11", reason: "PRIVATE_HR_BATCH_REASON" }
    const results = await Promise.all([1, 2].map(() => tenant(self.organizationId, () => recording.recordAttendanceDays(reviewer, body))))
    expect(results.map(result => result.idempotent).sort()).toEqual([false, true])
    expect(results[0].items).toHaveLength(2)
    await tenant(self.organizationId, async () => {
      const ids = results[0].items.map(item => item.id)
      expect(await prisma.mtmHrmRequest.count({ where: { clientRequestId: body.clientRequestId } })).toBe(2)
      expect(await prisma.mtmAuditLog.count({ where: { entityId: { in: ids }, action: "MTM_ATTENDANCE_HR_RECORDED" } })).toBe(2)
      expect(await prisma.mtmNotification.count({ where: { OR: ids.map(id => ({ metadata: { path: ["attendanceRequestId"], equals: id } })) } })).toBe(2)
      const own = await store.listOwnAttendanceRequests(self)
      expect(own.items.find(item => ids.includes(item.id))).toMatchObject({ status: "APPROVED", details: { kind: "HR_RECORD", dayKind: { key: "STUDY_LEAVE" } } })
      expect(JSON.stringify(own)).not.toMatch(/submissionHash|recording|operationId/)
      const snapshot = await report.readMtmAttendanceReport({ organizationId: self.organizationId, actor: { role: "ADMIN", agentId: null, scopedAgentIds: null }, query: { from: body.startDate, to: body.endDate, form: "ALL", employeeId: self.agentId } })
      expect(snapshot.rows.every(row => row.dayKind?.key === "STUDY_LEAVE" && row.workedSeconds === 0)).toBe(true)
      expect(JSON.stringify(snapshot)).not.toContain(body.reason)
      expect(await prisma.mtmAgentWorkday.count()).toBe(0)
      await expect(prisma.mtmHrmRequest.update({ where: { id: ids[0] }, data: { reason: "tampered" } })).rejects.toThrow()
      await expect(recording.recordAttendanceDays(reviewer, { ...body, reason: "changed" })).rejects.toMatchObject({ code: "MTM_ATTENDANCE_REQUEST_IDEMPOTENCY_MISMATCH" })
      // A conflict affecting only one target refuses the entire new batch.
      await expect(recording.recordAttendanceDays(reviewer, { ...body, clientRequestId: randomUUID(), agentIds: [self.agentId], startDate: "2027-08-11", endDate: "2027-08-12" })).rejects.toMatchObject({ code: "MTM_ATTENDANCE_REQUEST_OVERLAP" })
      await expect(recording.recordAttendanceDays(reviewer, { ...body, clientRequestId: randomUUID(), agentIds: [self.agentId, "request-pg-foreign"] })).rejects.toMatchObject({ status: 403 })
    })
  })
  // Owner, 2026-10-14: Personnel lists people in attendance; MTM field agents stay in MTM.
  it("leaves MTM field agents out of the HR recording list and refuses recording for them", async () => {
    const reviewer = { organizationId: self.organizationId, userId: "request-pg-admin", principalType: "session" as const }
    await bypass(() => prisma.mtmAgent.create({ data: { id: "request-pg-field-agent", organizationId: self.organizationId, name: "Fictional field agent", role: "AGENT", status: "ACTIVE" } }))
    const directory = await tenant(self.organizationId, () => recording.readAttendanceHrDirectory(reviewer))
    expect(directory.employees.map(employee => employee.id)).toEqual(expect.arrayContaining([self.agentId, "request-pg-colleague"]))
    expect(directory.employees.map(employee => employee.id)).not.toContain("request-pg-field-agent")
    await expect(tenant(self.organizationId, () => recording.recordAttendanceDays(reviewer, { clientRequestId: randomUUID(), agentIds: ["request-pg-field-agent"], dayKindKey: "STUDY_LEAVE",
      catalogueVersion: null, unit: "DAYS", startDate: "2027-09-01", endDate: "2027-09-01", reason: "Fictional agent record" }))).rejects.toMatchObject({ status: 403 })
    expect(await tenant(self.organizationId, () => prisma.mtmHrmRequest.count({ where: { agentId: "request-pg-field-agent" } }))).toBe(0)
  })
  // Owner, 2026-10-20: «у полевого агента всё кадровое убрать совсем» — no
  // leave, absence or time correction for a field agent, whatever the
  // Attendance switch says (it is on here). A card that filed a request as
  // office staff keeps it for HR; as an agent it can neither see, cancel nor
  // add to it, and no door writes a row.
  it("refuses a field agent every own-request door with the switch on, writes nothing, and keeps its earlier request", async () => {
    const moved = "request-pg-moved-to-field"
    await bypass(() => prisma.mtmAgent.create({ data: { id: moved, organizationId: self.organizationId, name: "Fictional employee moved to the field", role: "EMPLOYEE", attendanceParticipant: true, status: "ACTIVE" } }))
    const cancelApi = await import("@/app/api/v2/mtm/mobile/route-field/attendance/requests/[id]/route")
    const uploadApi = await import("@/app/api/v2/mtm/mobile/route-field/attendance/attachments/route")
    const explanationsApi = await import("@/app/api/v2/mtm/mobile/route-field/attendance/explanations/route")
    const url = (path: string) => `http://localhost/api/v2/mtm/mobile/route-field/attendance/${path}`
    const refusal = async (response: Response) => ({ status: response.status, code: (await response.json()).code })
    const refused = { status: 403, code: "MTM_ATTENDANCE_SELF_REQUIRED" }
    const rows = () => tenant(self.organizationId, async () => ({
      requests: await prisma.mtmHrmRequest.findMany({ where: { agentId: moved }, select: { id: true, status: true } }),
      attachments: await prisma.mtmAttendanceAttachment.count({ where: { agentId: moved } }),
      audit: await prisma.mtmAuditLog.count({ where: { agentId: moved } }),
    }))
    Object.assign(identity, { agentId: moved, role: "EMPLOYEE" })
    try {
      const filed = await submit(input("2028-01-10"))
      expect(filed.status).toBe(201)
      const requestId = (await filed.json()).data.request.id as string
      await bypass(() => prisma.mtmAgent.update({ where: { id: moved }, data: { role: "AGENT" } }))
      identity.role = "AGENT"
      const before = await rows()
      expect(before.requests).toEqual([{ id: requestId, status: "PENDING" }])

      const leave = { ...input("2028-01-12"), kind: "ANNUAL_LEAVE", unit: "DAYS", startTime: undefined, endTime: undefined }
      const correction = { ...input("2028-01-10"), kind: "TIME_CORRECTION", startTime: "09:00", endTime: "18:00" }
      for (const body of [input("2028-01-11"), leave, correction]) expect(await refusal(await submit(body))).toEqual(refused)
      expect(await refusal(await api.GET(new NextRequest(url("requests"))))).toEqual(refused)
      expect(await refusal(await cancelApi.DELETE(new NextRequest(url(`requests/${requestId}`), { method: "DELETE" }), { params: Promise.resolve({ id: requestId }) }))).toEqual(refused)
      expect(await refusal(await quotaApi.GET(new NextRequest(url("request-limits?month=2028-01"))))).toEqual(refused)
      expect(await refusal(await uploadApi.POST(new NextRequest(url("attachments"), { method: "POST" })))).toEqual(refused)
      expect(await refusal(await explanationsApi.GET(new NextRequest(url("explanations"))))).toEqual(refused)
      const agent = { organizationId: self.organizationId, agentId: moved, role: "AGENT" }
      const bytes = await sharp({ create: { width: 16, height: 16, channels: 3, background: "white" } }).png().toBuffer()
      await expect(tenant(self.organizationId, () => photos.uploadAttendanceDocument(agent, { clientRequestId: randomUUID(), clientAttachmentId: randomUUID() }, bytes))).rejects.toMatchObject(refused)
      await expect(tenant(self.organizationId, () => store.submitAttendanceRequest(agent, input("2028-01-13")))).rejects.toMatchObject(refused)

      // Nothing written, nothing taken away: the earlier request still waits for HR.
      expect(await rows()).toEqual(before)
    } finally {
      Object.assign(identity, { agentId: "request-pg-owner", role: "EMPLOYEE" })
    }
    // An employee HR keeps still files, the same moment.
    expect((await submit(input("2028-02-14"))).status).toBe(201)
  })
  it("rolls back every HR row and audit when an employee inbox insert fails", async () => {
    const body = { clientRequestId: randomUUID(), agentIds: [self.agentId, "request-pg-colleague"], dayKindKey: "STUDY_LEAVE", catalogueVersion: null,
      unit: "DAYS", startDate: "2027-08-15", endDate: "2027-08-16", reason: "PRIVATE_ATOMIC_HR_REASON" }
    sql(scratch!.adminDb, `CREATE FUNCTION fixture_reject_hr_inbox() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture inbox unavailable'; END $$; CREATE TRIGGER fixture_hr_inbox BEFORE INSERT ON mtm_notifications FOR EACH ROW EXECUTE FUNCTION fixture_reject_hr_inbox();`)
    try {
      await expect(tenant(self.organizationId, () => recording.recordAttendanceDays({ organizationId: self.organizationId, userId: "request-pg-admin", principalType: "session" }, body))).rejects.toThrow()
    } finally { sql(scratch!.adminDb, 'DROP TRIGGER fixture_hr_inbox ON mtm_notifications; DROP FUNCTION fixture_reject_hr_inbox();') }
    await tenant(self.organizationId, async () => {
      expect(await prisma.mtmHrmRequest.count({ where: { clientRequestId: body.clientRequestId } })).toBe(0)
      expect(await prisma.mtmAuditLog.count({ where: { newData: { path: ["operationId"], equals: body.clientRequestId } } })).toBe(0)
    })
  })

  it("projects only approved hour windows into violations and leaves phone events unchanged", async () => {
    const date = "2026-09-14"
    const reviewer = { organizationId: self.organizationId, userId: "request-pg-admin", principalType: "session" as const }
    const firstResponse = await submit(input(date))
    expect(firstResponse.status).toBe(201)
    const first = (await firstResponse.json()).data.request
    const secondResponse = await submit({ ...input(date), startTime: "17:00", endTime: "18:00" })
    expect(secondResponse.status).toBe(201)
    const second = (await secondResponse.json()).data.request
    await tenant(self.organizationId, async () => {
      const startedAt = new Date(`${date}T06:00:00Z`), completedAt = new Date(`${date}T13:00:00Z`)
      const day = await prisma.mtmAgentWorkday.create({ data: { organizationId: self.organizationId, agentId: self.agentId,
        workDate: new Date(date), status: "COMPLETED", startedAt, completedAt, totalPausedSeconds: 0 } })
      await prisma.mtmAgentWorkdayEvent.createMany({ data: [
        { organizationId: self.organizationId, agentId: self.agentId, workdayId: day.id, type: "START", occurredAt: startedAt, clientEventId: randomUUID() },
        { organizationId: self.organizationId, agentId: self.agentId, workdayId: day.id, type: "FINISH", occurredAt: completedAt, clientEventId: randomUUID() },
      ] })
      const read = (form: "ALL" | "LATE_EARLY" = "ALL") => report.readMtmAttendanceReport({ organizationId: self.organizationId,
        actor: { role: "ADMIN", agentId: null, scopedAgentIds: null }, query: { from: date, to: date, form, employeeId: self.agentId } })
      expect((await read()).rows[0]).toMatchObject({ lateSeconds: 3600, earlyLeaveSeconds: 3600 })
      await decision.decideAttendanceRequest(reviewer, first.id, { decision: "APPROVED", version: first.version, note: "Fictional approved start" })
      await decision.decideAttendanceRequest(reviewer, second.id, { decision: "REJECTED", version: second.version, note: "Fictional rejected end" })
      expect((await read()).rows[0]).toMatchObject({ lateSeconds: 0, earlyLeaveSeconds: 3600 })
      expect((await read("LATE_EARLY")).rows).toHaveLength(1)
      await recording.recordAttendanceDays(reviewer, { clientRequestId: randomUUID(), agentIds: [self.agentId], dayKindKey: "HOURLY_ABSENCE", catalogueVersion: null,
        unit: "HOURS", startDate: date, endDate: date, startTime: "17:00", endTime: "18:00", reason: "Fictional HR approved end" })
      const result = await read()
      // Owner, 2026-10-16: «вычитать обед самому» — the 13:00–14:00 lunch comes off worked time.
      expect(result.rows[0]).toMatchObject({ lateSeconds: 0, earlyLeaveSeconds: 0, workedSeconds: 21600, lunchAutoSeconds: 3600, pausedSeconds: 0, flags: [] })
      expect(result.totals).toMatchObject({ lateCount: 0, earlyLeaveCount: 0 })
      expect((await read("LATE_EARLY")).rows).toHaveLength(0)
      expect(await prisma.mtmAgentWorkday.findUnique({ where: { id: day.id } })).toMatchObject({ startedAt, completedAt, totalPausedSeconds: 0 })
      expect(await prisma.mtmAgentWorkdayEvent.count({ where: { workdayId: day.id } })).toBe(2)
    })
  })

  it("counts a holiday within leave separately, retains work-on-leave, and atomically returns days on retroactive cancellation", async () => {
    const reviewer = { organizationId: self.organizationId, userId: "request-pg-admin", principalType: "session" as const }
    const body = { clientRequestId: randomUUID(), kind: "ANNUAL_LEAVE", unit: "DAYS", startDate: "2026-09-07", endDate: "2026-09-09", reason: "PRIVATE_RETRO_LEAVE" }
    const response = await submit(body); expect(response.status).toBe(201)
    const request = (await response.json()).data.request
    const approved = await tenant(self.organizationId, () => decision.decideAttendanceRequest(reviewer, request.id, { decision: "APPROVED", version: request.version, note: "Original fictional approval" }))
    const cancellation = { version: approved.request.version, reason: "PRIVATE_REVOCATION_CAUSE" }
    const read = () => report.readMtmAttendanceReport({ organizationId: self.organizationId, actor: { role: "ADMIN", agentId: null, scopedAgentIds: null }, query: { from: body.startDate, to: body.endDate, form: "ALL", employeeId: self.agentId } })
    await tenant(self.organizationId, async () => {
      await prisma.mtmWorkCalendarDay.create({ data: { organizationId: self.organizationId, date: new Date("2026-09-08"), kind: "PUBLIC_HOLIDAY", name: "Fictional holiday" } })
      const startedAt = new Date("2026-09-07T05:00:00Z"), completedAt = new Date("2026-09-07T14:00:00Z")
      const day = await prisma.mtmAgentWorkday.create({ data: { organizationId: self.organizationId, agentId: self.agentId, workDate: new Date(body.startDate), status: "COMPLETED", startedAt, completedAt } })
      await prisma.mtmAgentWorkdayEvent.createMany({ data: [
        { organizationId: self.organizationId, agentId: self.agentId, workdayId: day.id, type: "START", occurredAt: startedAt },
        { organizationId: self.organizationId, agentId: self.agentId, workdayId: day.id, type: "FINISH", occurredAt: completedAt },
      ] })
      const result = await read()
      expect(result.totals.annualLeaveDays).toBe(2)
      // Owner, 2026-10-16: «вычитать обед самому» — the 13:00–14:00 lunch comes off worked time.
      expect(result.rows[0]).toMatchObject({ kind: "WORKED", workedSeconds: 28800, lunchAutoSeconds: 3600, flags: ["WORKED_ON_APPROVED_ABSENCE"], annualLeaveDays: 1 })
      expect(result.rows[1]).toMatchObject({ kind: "HOLIDAY", annualLeaveDays: 0 })
      // The employee can withdraw a pending request, never an approved leave.
      await expect(store.cancelOwnAttendanceRequest(self, request.id)).rejects.toMatchObject({ status: 409 })
    })
    sql(scratch!.adminDb, `CREATE FUNCTION fixture_reject_revocation_inbox() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.metadata->>'status' = 'CANCELLED' THEN RAISE EXCEPTION 'fixture inbox unavailable'; END IF; RETURN NEW; END $$; CREATE TRIGGER fixture_revocation_inbox BEFORE INSERT ON mtm_notifications FOR EACH ROW EXECUTE FUNCTION fixture_reject_revocation_inbox();`)
    try { await expect(tenant(self.organizationId, () => revocation.revokeAttendanceLeave(reviewer, request.id, cancellation))).rejects.toThrow() }
    finally { sql(scratch!.adminDb, 'DROP TRIGGER fixture_revocation_inbox ON mtm_notifications; DROP FUNCTION fixture_reject_revocation_inbox();') }
    await tenant(self.organizationId, async () => {
      expect((await read()).totals.annualLeaveDays).toBe(2)
      expect(await prisma.mtmAuditLog.count({ where: { entityId: request.id, action: revocation.ATTENDANCE_REVOCATION_ACTION } })).toBe(0)
      // Historical approvals remain reachable after the employee leaves.
      await prisma.mtmAgent.update({ where: { id: self.agentId }, data: { status: "INACTIVE" } })
    })
    try {
      const answers = await Promise.all([1, 2].map(() => tenant(self.organizationId, () => revocation.revokeAttendanceLeave(reviewer, request.id, cancellation))))
      expect(answers.map(answer => answer.idempotent).sort()).toEqual([false, true])
      await tenant(self.organizationId, async () => {
        const history = (await review.listAttendanceRequestsForReview(reviewer, { status: "CANCELLED" })).items.find(row => row.id === request.id)
        expect(history).toMatchObject({ decidedAt: approved.request.decidedAt, decisionNote: "Original fictional approval", cancellation: { reason: cancellation.reason } })
        expect(await prisma.mtmAuditLog.count({ where: { entityId: request.id, action: revocation.ATTENDANCE_REVOCATION_ACTION } })).toBe(1)
        expect(await prisma.mtmNotification.count({ where: { AND: [{ metadata: { path: ["attendanceRequestId"], equals: request.id } }, { metadata: { path: ["status"], equals: "CANCELLED" } }] } })).toBe(1)
        const result = await read()
        expect(result.totals.annualLeaveDays).toBe(0)
        expect(result.rows[0]).toMatchObject({ kind: "WORKED", workedSeconds: 28800, lunchAutoSeconds: 3600, flags: [] })
        expect(result.rows[2].kind).toBe("ABSENT")
        expect(JSON.stringify(result)).not.toMatch(/PRIVATE_RETRO_LEAVE|PRIVATE_REVOCATION_CAUSE/)
        await expect(revocation.revokeAttendanceLeave(reviewer, request.id, { ...cancellation, reason: "Changed cause" })).rejects.toMatchObject({ status: 409 })
      })
    } finally { await tenant(self.organizationId, () => prisma.mtmAgent.update({ where: { id: self.agentId }, data: { status: "ACTIVE" } })) }
  })
  it("uses explicit immutable employment history instead of directory status and scopes it to the tenant", async () => {
    await tenant(self.organizationId, async () => {
      for (const [kind, at] of [["HIRE", "2026-09-21T05:00:00Z"], ["TERMINATION", "2026-09-22T20:00:00Z"], ["REHIRE", "2026-09-25T05:00:00Z"]]) {
        await prisma.$executeRaw`INSERT INTO workforce_employment_events (id, "organizationId", "agentId", kind, "effectiveAt", source, "recordedByUserId") VALUES
          (${randomUUID()}, ${self.organizationId}, ${self.agentId}, ${kind}::"WorkforceEmploymentEventKind", ${new Date(at)}, 'MTM_TEST_FIXTURE', 'request-pg-admin')`
      }
      const result = await report.readMtmAttendanceReport({ organizationId: self.organizationId, actor: { role: "ADMIN", agentId: null, scopedAgentIds: null }, query: { from: "2026-09-18", to: "2026-09-25", form: "ALL", employeeId: self.agentId } })
      expect(result.rows.filter(row => row.kind === "ABSENT").map(row => row.date)).toEqual(["2026-09-21", "2026-09-22", "2026-09-25"])
      expect(result.rows.filter(row => row.kind === "NOT_EMPLOYED")).toHaveLength(5)
      // The production policy permits SELECT/INSERT only: UPDATE cannot see rows.
      expect(await prisma.$executeRaw`UPDATE workforce_employment_events SET source = 'TAMPER' WHERE "agentId" = ${self.agentId}`).toBe(0)
      const retained = await prisma.$queryRaw<{ source: string }[]>`SELECT source FROM workforce_employment_events WHERE "agentId" = ${self.agentId}`
      expect(retained).toHaveLength(3)
      expect(retained.every(event => event.source === "MTM_TEST_FIXTURE")).toBe(true)
    })
    // Separately prove the immutable trigger even for the disposable DB owner.
    // This uses only this test's throwaway database; production RLS is unchanged.
    expect(() => sql(scratch!.adminDb, `UPDATE workforce_employment_events SET source = 'TAMPER' WHERE "organizationId" = 'request-pg-a' AND "agentId" = 'request-pg-owner'`)).toThrow(/employment history is immutable/i)
    await tenant("request-pg-b", async () => {
      const rows = await prisma.$queryRaw<unknown[]>`SELECT id FROM workforce_employment_events WHERE "agentId" = ${self.agentId}`
      expect(rows).toHaveLength(0)
    })
  })

  it("keeps the exported decision history scoped and private while preserving original approval and cancellation", async () => {
    const query = { from: "2026-09-07", to: "2026-09-09", status: "ALL" }
    const actor = { role: "MANAGER" as const, agentId: null, scopedAgentIds: [self.agentId] }
    const now = new Date("2026-10-13T10:00:00Z")
    await tenant(self.organizationId, async () => {
      const read = () => journal.readAttendanceDecisionJournal({ organizationId: self.organizationId, actor, query, now })
      const history = await read()
      expect(history.items).toHaveLength(1)
      expect(history.items[0]).toMatchObject({ employeeId: self.agentId, status: "CANCELLED", source: "EMPLOYEE",
        requestKind: "ANNUAL_LEAVE", decision: { byName: "Fictional limits administrator" },
        cancellation: { byName: "Fictional limits administrator" } })
      expect(history.items[0].decision!.at).not.toBeNull()
      expect(history.items[0].cancellation!.at).not.toBeNull()
      expect(JSON.stringify(history)).not.toMatch(/PRIVATE_|Original fictional approval|attachmentIds|submissionHash|decisionNote|reason/)
      expect((await read()).snapshot).toEqual(history.snapshot)
      expect((await journal.readAttendanceDecisionJournal({ organizationId: self.organizationId, actor: { ...actor, scopedAgentIds: ["request-pg-colleague"] }, query })).items).toHaveLength(0)
      const hr = await journal.readAttendanceDecisionJournal({ organizationId: self.organizationId,
        actor: { ...actor, scopedAgentIds: null }, allEmployeesGrant: true, query: { from: "2027-08-10", to: "2027-08-11" } })
      expect(hr.items).toHaveLength(2)
      expect(hr.items.every(item => item.source === "HR" && item.submittedByName === "Fictional limits administrator" && item.decision?.byName === item.submittedByName)).toBe(true)
      expect(JSON.stringify(hr)).not.toContain("PRIVATE_HR_BATCH_REASON")
    })
    await tenant("request-pg-b", async () => {
      // Even a accidentally mismatched organization argument cannot cross RLS.
      const foreign = await journal.readAttendanceDecisionJournal({ organizationId: self.organizationId, actor, query })
      expect(foreign.items).toHaveLength(0)
    })
  })
  it("changes the decision snapshot after an actual decision and preserves both filtered histories", async () => {
    const body = { clientRequestId: randomUUID(), kind: "SICK_LEAVE", unit: "DAYS", startDate: "2027-11-03", endDate: "2027-11-03", reason: "PRIVATE_JOURNAL_REASON" }
    const response = await submit(body); expect(response.status).toBe(201)
    const request = (await response.json()).data.request
    await tenant(self.organizationId, async () => {
      const actor = { role: "ADMIN" as const, agentId: null, scopedAgentIds: null }
      const read = (status = "ALL") => journal.readAttendanceDecisionJournal({ organizationId: self.organizationId, actor, query: { from: body.startDate, to: body.endDate, status } })
      const before = await read()
      expect(before.items[0]).toMatchObject({ status: "PENDING", decision: null })
      await decision.decideAttendanceRequest({ organizationId: self.organizationId, userId: "request-pg-admin", principalType: "session" }, request.id,
        { version: request.version, decision: "REJECTED", note: "PRIVATE_JOURNAL_NOTE" })
      const after = await read()
      expect(after.snapshot.id).not.toBe(before.snapshot.id)
      expect(after.items[0]).toMatchObject({ id: request.id, status: "REJECTED", decision: { byName: "Fictional limits administrator" } })
      expect((await read("PENDING")).items).toHaveLength(0)
      expect((await read("REJECTED")).items).toHaveLength(1)
      expect(JSON.stringify(after)).not.toMatch(/PRIVATE_JOURNAL_REASON|PRIVATE_JOURNAL_NOTE/)
    })
  })


  // Owner, 2026-10-21 (after the HRSS clip, «əvvəl rəhbər, sonra HR təsdiqləyir»):
  // with the setting on, a manager's approval passes the request to HR and only
  // an administrator's decision counts. Off, the manager decides once, as before.
  it("two-step approval: the manager passes a request to HR, only HR's decision counts; off, the manager decides alone", async () => {
    const employee = { organizationId: self.organizationId, agentId: "request-pg-two-step", role: "EMPLOYEE" }
    const admin = { organizationId: self.organizationId, userId: "request-pg-admin", principalType: "session" as const }
    const manager = { organizationId: self.organizationId, userId: "request-pg-manager", principalType: "session" as const }
    const upper = { organizationId: self.organizationId, userId: "request-pg-upper", principalType: "session" as const }
    await bypass(async () => {
      for (const [id, name] of [["request-pg-manager", "Fictional line manager"], ["request-pg-upper", "Fictional upper manager"]]) {
        await prisma.user.create({ data: { id, organizationId: self.organizationId, name, email: `${id}@example.invalid`, role: "manager", passwordHash: "unusable-fixture-hash" } })
      }
      await prisma.mtmAgent.create({ data: { id: "request-pg-upper-card", organizationId: self.organizationId, name: "Fictional upper manager", role: "MANAGER", userId: "request-pg-upper", status: "ACTIVE" } })
      await prisma.mtmAgent.create({ data: { id: "request-pg-manager-card", organizationId: self.organizationId, name: "Fictional line manager", role: "MANAGER", userId: "request-pg-manager", managerId: "request-pg-upper-card", status: "ACTIVE" } })
      await prisma.mtmAgent.create({ data: { id: employee.agentId, organizationId: self.organizationId, name: "Fictional two-step employee", role: "EMPLOYEE", attendanceParticipant: true, managerId: "request-pg-manager-card", status: "ACTIVE" } })
      await prisma.mtmSetting.create({ data: { organizationId: self.organizationId, key: "attendanceTwoStepApproval", value: true } })
    })
    const leave = (startDate: string) => ({ clientRequestId: randomUUID(), kind: "ANNUAL_LEAVE", unit: "DAYS", startDate, endDate: startDate, reason: "Fictional two-step leave" })
    const decide = (who: typeof admin, id: string, version: string, value: "APPROVED" | "REJECTED", note: string | null = null) =>
      tenant(self.organizationId, () => decision.decideAttendanceRequest(who, id, { decision: value, version, note }))
    const kindOn = (date: string) => tenant(self.organizationId, async () => (await report.readMtmAttendanceReport({ organizationId: self.organizationId,
      actor: { role: "ADMIN", agentId: null, scopedAgentIds: null }, query: { from: date, to: date, form: "ALL", employeeId: employee.agentId } })).rows[0]?.kind)
    const bellsFor = (requestId: string) => tenant(self.organizationId, async () => (await prisma.notification.findMany({ where: { entityType: "mtm_attendance_request", entityId: requestId }, select: { userId: true } })).map((row: { userId: string }) => row.userId).sort())

    const first = (await tenant(self.organizationId, () => store.submitAttendanceRequest(employee, leave("2027-03-01")))).request
    // The managers hear first; HR is not rung for a request no manager has seen.
    expect(await bellsFor(first.id)).toEqual(["request-pg-manager", "request-pg-upper"])

    const passed = await decide(manager, first.id, first.version, "APPROVED", "Fine by me")
    expect(passed).toMatchObject({ passedToHr: true, idempotent: false, request: { status: "PENDING", decidedAt: null } })
    expect(await decide(manager, first.id, first.version, "APPROVED", "Fine by me")).toMatchObject({ passedToHr: true, idempotent: true })
    await tenant(self.organizationId, async () => {
      expect(await prisma.mtmHrmRequest.findUnique({ where: { id: first.id }, select: { status: true, managerApprovedByUserId: true, managerApprovalNote: true, decidedByUserId: true } }))
        .toEqual({ status: "PENDING", managerApprovedByUserId: "request-pg-manager", managerApprovalNote: "Fine by me", decidedByUserId: null })
      expect(await prisma.mtmAuditLog.count({ where: { entityId: first.id, action: "MTM_ATTENDANCE_REQUEST_MANAGER_APPROVED" } })).toBe(1)
      expect(await prisma.mtmAuditLog.count({ where: { entityId: first.id, action: "MTM_ATTENDANCE_REQUEST_DECIDED" } })).toBe(0)
      // The employee is told nothing yet: the request is not decided.
      expect(await prisma.mtmNotification.count({ where: { metadata: { path: ["attendanceRequestId"], equals: first.id } } })).toBe(0)
    })
    expect(await kindOn("2027-03-01")).not.toBe("APPROVED_REQUEST")
    // Now HR is rung, once.
    expect(await bellsFor(first.id)).toEqual(["request-pg-admin", "request-pg-manager", "request-pg-upper"])

    // Another manager can neither approve nor reject what is HR's now, and sees no button.
    const current = (await tenant(self.organizationId, () => review.listAttendanceRequestsForReview(upper, { requestId: first.id }))).items[0]
    expect(current).toMatchObject({ canDecide: false, approval: { twoStep: true, awaiting: "HR", passesToHr: false, manager: { name: "Fictional line manager", note: "Fine by me" } } })
    await expect(decide(upper, first.id, current.version, "REJECTED", "Too late for that")).rejects.toMatchObject({ code: "MTM_ATTENDANCE_REQUEST_AWAITING_HR", status: 409 })
    await expect(decide(manager, first.id, current.version, "APPROVED", "Changed my note")).rejects.toMatchObject({ code: "MTM_ATTENDANCE_REQUEST_AWAITING_HR" })
    // HR sees who approved and decides; that is the decision the employee hears.
    const forHr = (await tenant(self.organizationId, () => review.listAttendanceRequestsForReview(admin, { requestId: first.id }))).items[0]
    expect(forHr).toMatchObject({ canDecide: true, approval: { awaiting: "HR", passesToHr: false } })
    await expect(decide(admin, first.id, first.version, "APPROVED")).rejects.toMatchObject({ code: "MTM_ATTENDANCE_REQUEST_CHANGED" })
    expect(await decide(admin, first.id, forHr.version, "APPROVED")).toMatchObject({ passedToHr: false, request: { status: "APPROVED" } })
    expect(await kindOn("2027-03-01")).toBe("APPROVED_REQUEST")
    await tenant(self.organizationId, async () => {
      expect(await prisma.mtmNotification.count({ where: { metadata: { path: ["attendanceRequestId"], equals: first.id } } })).toBe(1)
      expect(await prisma.mtmHrmRequest.findUnique({ where: { id: first.id }, select: { decidedByUserId: true, managerApprovedByUserId: true } }))
        .toEqual({ decidedByUserId: "request-pg-admin", managerApprovedByUserId: "request-pg-manager" })
    })

    // A manager's rejection is final; HR may also decide before any manager did.
    const second = (await tenant(self.organizationId, () => store.submitAttendanceRequest(employee, leave("2027-03-08")))).request
    const shown = (await tenant(self.organizationId, () => review.listAttendanceRequestsForReview(manager, { requestId: second.id }))).items[0]
    expect(shown).toMatchObject({ canDecide: true, approval: { awaiting: "MANAGER", passesToHr: true, manager: null } })
    expect(await decide(manager, second.id, second.version, "REJECTED", "Busy week")).toMatchObject({ passedToHr: false, request: { status: "REJECTED" } })
    const third = (await tenant(self.organizationId, () => store.submitAttendanceRequest(employee, leave("2027-03-15")))).request
    expect(await decide(admin, third.id, third.version, "APPROVED")).toMatchObject({ passedToHr: false, request: { status: "APPROVED" } })

    // Off (the default): the manager's approval is the decision, as before.
    await bypass(() => prisma.mtmSetting.update({ where: { organizationId_key: { organizationId: self.organizationId, key: "attendanceTwoStepApproval" } }, data: { value: false } }))
    const fourth = (await tenant(self.organizationId, () => store.submitAttendanceRequest(employee, leave("2027-03-22")))).request
    expect(await bellsFor(fourth.id)).toEqual(["request-pg-admin", "request-pg-manager", "request-pg-upper"])
    expect(await decide(manager, fourth.id, fourth.version, "APPROVED")).toMatchObject({ passedToHr: false, request: { status: "APPROVED" } })
    await tenant(self.organizationId, async () => {
      expect(await prisma.mtmHrmRequest.findUnique({ where: { id: fourth.id }, select: { decidedByUserId: true, managerApprovedAt: true } }))
        .toEqual({ decidedByUserId: "request-pg-manager", managerApprovedAt: null })
    })
    await bypass(() => prisma.mtmSetting.delete({ where: { organizationId_key: { organizationId: self.organizationId, key: "attendanceTwoStepApproval" } } }))
  })
})
