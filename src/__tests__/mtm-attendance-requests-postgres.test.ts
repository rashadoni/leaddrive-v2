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
const identity = vi.hoisted(() => ({ orgId: "request-pg-a", agentId: "request-pg-owner", role: "AGENT", routeField: true }))
vi.mock("@/lib/mobile-auth", () => ({ resolveMobileAuth: async () => ({ ...identity, tenantCapabilities: { routeField: identity.routeField, workforceHrm: false } }) }))
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
  let photos: typeof import("@/lib/mtm/attendance-attachment")
  let limits: typeof import("@/lib/mtm/attendance-request-limit-store")
  let quotaApi: typeof import("@/app/api/v1/mtm/mobile/attendance/request-limits/route")
  let api: typeof import("@/app/api/v1/mtm/mobile/attendance/requests/route")
  let createdRole = false, createdDb = false
  let documentRuntime: string | undefined
  let documentLogRuntime: string | undefined
  const originalRuntime = process.env.LEADDRIVE_RUNTIME_DIR
  const originalLogs = process.env.LEADDRIVE_LOG_DIR
  const self = { organizationId: "request-pg-a", agentId: "request-pg-owner", role: "AGENT" }
  const input = (date: string) => ({ clientRequestId: randomUUID(), kind: "HOURLY_ABSENCE", unit: "HOURS", startDate: date, endDate: date, startTime: "09:00", endTime: "10:00", reason: "Fictional request" })
  const submit = (body: unknown) => api.POST(new NextRequest("http://localhost/api/v1/mtm/mobile/attendance/requests", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }))
  beforeAll(async () => {
    sql(adminUrl!, `CREATE ROLE "${scratch!.role}" LOGIN PASSWORD 'attendance-fixture-only' NOSUPERUSER NOBYPASSRLS`); createdRole = true
    sql(adminUrl!, `CREATE DATABASE "${scratch!.name}"`); createdDb = true
    const schemaFile = join(mkdtempSync(join(tmpdir(), "attendance-request-schema-")), "schema.prisma")
    writeFileSync(schemaFile, readFileSync("prisma/schema.prisma", "utf8").split("\n").filter((line) => !/Unsupported\("vector/.test(line)).join("\n"))
    const cli = createRequire(import.meta.url).resolve("prisma/build/index.js")
    const result = spawnSync(process.execPath, [cli, "db", "push", "--schema", schemaFile, "--skip-generate"], { env: { ...process.env, DATABASE_URL: scratch!.adminDb }, encoding: "utf8", timeout: 180_000, maxBuffer: 1024 * 1024 })
    if (result.status !== 0) throw new Error("Request fixture schema push failed")
    sql(scratch!.adminDb, 'DROP TABLE mtm_attendance_attachments; ALTER TABLE mtm_hrm_requests DROP COLUMN "attendanceDetails";')
    for (const migration of ["20260806120000_mtm_rls_coverage_completion", "20260806160000_mtm_rls_bypass_clause_normalization", "20261013040000_mtm_attendance_requests"]) sql(scratch!.adminDb, readFileSync(`prisma/migrations/${migration}/migration.sql`, "utf8"))
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
    photos = await import("@/lib/mtm/attendance-attachment")
    limits = await import("@/lib/mtm/attendance-request-limit-store")
    quotaApi = await import("@/app/api/v1/mtm/mobile/attendance/request-limits/route")
    api = await import("@/app/api/v1/mtm/mobile/attendance/requests/route")
    await bypass(async () => {
      for (const org of ["request-pg-a", "request-pg-b"]) {
        await prisma.organization.create({ data: { id: org, name: "Fictional request organization", slug: org, modules: ["route-field"] } })
        await prisma.mtmSetting.create({ data: { organizationId: org, key: "attendanceEnabled", value: true } })
      }
      await prisma.user.create({ data: { id: "request-pg-admin", organizationId: self.organizationId, name: "Fictional limits administrator", email: "limits-admin@example.invalid", role: "admin", passwordHash: "unusable-fixture-hash" } })
      for (const [id, org] of [["request-pg-owner", "request-pg-a"], ["request-pg-colleague", "request-pg-a"], ["request-pg-foreign", "request-pg-b"]]) await prisma.mtmAgent.create({ data: { id, organizationId: org, name: "Fictional employee", role: "AGENT", status: "ACTIVE" } })
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
    identity.routeField = false
    expect((await submit(input("2027-02-05"))).status).toBe(403)
    identity.routeField = true
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
    const own = await quotaApi.GET(new NextRequest("http://localhost/api/v1/mtm/mobile/attendance/request-limits?month=2027-03&agentId=request-pg-colleague"))
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

})
