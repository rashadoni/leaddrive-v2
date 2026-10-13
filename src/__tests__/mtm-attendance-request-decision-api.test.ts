import { GET as attachmentGet } from "@/app/api/v1/mtm/attendance/attachments/[id]/route"
import { readAttendanceDocument } from "@/lib/mtm/attendance-attachment"
import { GET as reviewGet } from "@/app/api/v1/mtm/attendance/requests/route"
import { randomUUID } from "node:crypto"
import { NextRequest, NextResponse } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/mtm/attendance-attachment", () => ({ readAttendanceDocument: vi.fn() }))
vi.mock("@/lib/prisma", async () => ({ prisma: (await import("./mocks/mtm-prisma")).makeMtmPrismaMock() }))
vi.mock("@/lib/api-auth", () => ({ requireAuth: vi.fn(), getOrgId: vi.fn(), getSession: vi.fn().mockResolvedValue(null), isAuthError: (value: unknown) => value instanceof Response }))
vi.mock("@/lib/mobile-auth", async () => (await import("./mocks/mobile-auth")).makeMobileAuthMock())
vi.mock("@/lib/mtm/route-permissions", async (original) => ({ ...await original<typeof import("@/lib/mtm/route-permissions")>(), resolveMtmRouteActor: vi.fn() }))
vi.mock("@/lib/tenant-capability-access", async (original) => ({ ...await original<typeof import("@/lib/tenant-capability-access")>(), requireTenantCapabilityAccessResponse: vi.fn().mockResolvedValue(null) }))
import { prisma } from "@/lib/prisma"
import { requireAuth, type AuthResult } from "@/lib/api-auth"
import { resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import { requireTenantCapabilityAccessResponse } from "@/lib/tenant-capability-access"
import { AttendanceDecisionInputSchema, decideAttendanceRequestInTransaction } from "@/lib/mtm/attendance-request-decision"
import { defaultAttendanceDayKinds } from "@/lib/mtm/attendance-day-kinds"
import { workforceWorkdayCorrectionFacts } from "@/lib/workforce/workday-correction-facts"
import { getRlsContext } from "@/lib/rls-context"
import { POST } from "@/app/api/v1/mtm/attendance/requests/[id]/decision/route"
import ru from "../../messages/ru.json"

const organizationId = "decision-fixture-org"
const userId = "decision-fixture-reviewer"
const requestId = randomUUID()
const agentId = "decision-fixture-employee"
const at = (clock: string) => new Date(`2026-10-12T${clock}:00.000Z`)
const version = at("14:30").toISOString()
function initialWorkday() { return { id: "decision-fixture-workday", workDate: at("00:00"), status: "STARTED", startedAt: at("05:00"), pausedAt: null as Date | null, completedAt: null as Date | null, totalPausedSeconds: 0 } }
function initialRequest() { return { id: requestId, clientRequestId: randomUUID(), organizationId, agentId, type: "TIME_CORRECTION", status: "PENDING", updatedAt: at("14:30"), startDate: at("00:00"), endDate: at("00:00"),
  correctionWorkdayId: initialWorkday().id, requestedStartAt: at("05:00"), requestedEndAt: at("14:00"), reason: "PRIVATE_EMPLOYEE_REASON",
  attendanceDetails: { version: 1, kind: "TIME_CORRECTION", unit: "HOURS", startTime: "09:00", endTime: "18:00", timezone: "Asia/Baku", attachmentIds: [], submissionHash: "a".repeat(64),
    dayKind: defaultAttendanceDayKinds(() => ({ az: "Fixture", ru: "Fixture", en: "Fixture" }))[0], correctionBasis: { kind: "WORKDAY", facts: workforceWorkdayCorrectionFacts(initialWorkday()) } },
  submittedAt: at("14:30"), decidedByUserId: null as string | null, decisionNote: null as string | null, decidedAt: null as Date | null, cancelledAt: null, agent: { userId: "decision-fixture-owner-user" } } }
let stored: ReturnType<typeof initialRequest> | null
let workday: ReturnType<typeof initialWorkday>
let correction: unknown
let currentUser: { role: string; hiddenModules: string[]; mtmAttendanceAll?: boolean } | null
function identity(change: Partial<AuthResult> = {}) {
  vi.mocked(requireAuth).mockResolvedValue({ orgId: organizationId, userId, role: "admin", email: "fixture@example.test", name: "Fixture reviewer", principalType: "session", ...change } as AuthResult)
}
function req(body: unknown = { decision: "APPROVED", version }, headers?: Record<string, string>) { return new NextRequest(`http://localhost/api/v1/mtm/attendance/requests/${requestId}/decision`, {
  method: "POST", headers: { "content-type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body),
}) }
const post = (body?: unknown, headers?: Record<string, string>) => POST(req(body, headers), { params: Promise.resolve({ id: requestId }) })
function noWrites() {
  expect(prisma.mtmHrmRequest.updateMany).not.toHaveBeenCalled()
  expect(prisma.workforceTimeCorrection.create).not.toHaveBeenCalled()
  expect(prisma.mtmAgentWorkday.update).not.toHaveBeenCalled()
  expect(prisma.mtmAuditLog.create).not.toHaveBeenCalled()
  expect(prisma.mtmNotification.create).not.toHaveBeenCalled()
}
beforeEach(() => {
  vi.resetAllMocks()
  stored = initialRequest(); workday = initialWorkday(); correction = null; currentUser = { role: "admin", hiddenModules: [] }
  identity()
  vi.mocked(requireTenantCapabilityAccessResponse).mockResolvedValue(null)
  vi.mocked(resolveMtmRouteActor).mockResolvedValue({ agentId: null, role: "ADMIN", scopedAgentIds: null })
  vi.mocked(prisma.$transaction).mockImplementation((async (callback: (tx: typeof prisma) => unknown) => callback(prisma)) as never)
  vi.mocked(prisma.$queryRaw).mockImplementation((async (query: TemplateStringsArray) => query.join(" ").includes('FROM "users"') ? currentUser ? [currentUser] : [] : []) as never)
  vi.mocked(prisma.organization.findUnique).mockResolvedValue({ plan: "enterprise", addons: [], features: ["mtm"], modules: { mtm: true }, settings: {} } as never)
  vi.mocked(prisma.mtmSetting.findMany).mockResolvedValue([{ key: "attendanceEnabled", value: true }] as never)
  vi.mocked(prisma.mtmSetting.findUnique).mockResolvedValue({ value: true } as never)
  vi.mocked(prisma.mtmAgent.findFirst).mockImplementation((async () => stored ? { userId: stored.agent.userId, user: { preferredLanguage: "ru" } } : null) as never)
  vi.mocked(prisma.mtmHrmRequest.findFirst).mockImplementation((async () => stored) as never)
  vi.mocked(prisma.mtmHrmRequest.updateMany).mockImplementation((async ({ data }: { data: Record<string, unknown> }) => { Object.assign(stored!, data, { updatedAt: new Date() }); return { count: 1 } }) as never)
  vi.mocked(prisma.mtmAgentWorkday.findFirst).mockImplementation((async () => workday) as never)
  vi.mocked(prisma.mtmAgentWorkday.update).mockImplementation((async ({ data }: { data: Record<string, unknown> }) => Object.assign(workday, data)) as never)
  vi.mocked(prisma.mtmAgentWorkdayEvent.findMany).mockResolvedValue([{ id: "decision-fixture-start", type: "START", occurredAt: at("05:00"), appliedAt: at("05:00"), clientEventId: null }] as never)
  vi.mocked(prisma.workforceTimeCorrection.findMany).mockResolvedValue([])
  vi.mocked(prisma.workforceTimeCorrection.findFirst).mockImplementation((async () => correction) as never)
  vi.mocked(prisma.workforceTimeCorrection.create).mockImplementation((async ({ data }: { data: Record<string, unknown> }) => { correction = data; return { id: data.id } }) as never)
})

describe("attendance decision endpoint with the real authorization wrapper, decision service and correction engine", () => {
  it("approves as a current session reviewer under tenant RLS and retries without duplicate ledger/audit/notification", async () => {
    vi.mocked(prisma.mtmNotification.create).mockImplementation((async () => {
      expect(getRlsContext()).toMatchObject({ orgId: organizationId }); expect(getRlsContext()?.bypass).not.toBe(true)
      return {}
    }) as never)
    const first = await post()
    expect(first.status).toBe(200)
    expect(await first.json()).toMatchObject({ success: true, data: { idempotent: false, request: { status: "APPROVED" } } })
    const second = await post()
    expect(second.status).toBe(200)
    expect(await second.json()).toMatchObject({ data: { idempotent: true, request: { status: "APPROVED" } } })
    expect(prisma.workforceTimeCorrection.create).toHaveBeenCalledTimes(1)
    expect(prisma.mtmHrmRequest.updateMany).toHaveBeenCalledTimes(1)
    expect(prisma.mtmNotification.create).toHaveBeenCalledTimes(1)
    expect(prisma.mtmAuditLog.create).toHaveBeenCalledTimes(2) // One correction + one decision.
    expect(prisma.mtmNotification.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ title: ru.mtmAttendance.decisionApproved, agentId, organizationId }) }))
    expect(JSON.stringify(vi.mocked(prisma.mtmNotification.create).mock.calls)).not.toContain("PRIVATE_EMPLOYEE_REASON")
    expect(first.headers.get("cache-control")).toBe("private, no-store")
    expect(first.headers.get("x-content-type-options")).toBe("nosniff")
  })
  it.each(["ANNUAL_LEAVE", "SICK_LEAVE", "TIME_OFF", "HOURLY_ABSENCE", "BUSINESS_TRIP", "REMOTE_WORK", "OVERTIME"])("decides %s once without changing phone facts", async (kind) => {
    const { correctionBasis: _basis, ...details } = stored!.attendanceDetails
    void _basis
    Object.assign(stored!, { type: kind === "ANNUAL_LEAVE" ? "LEAVE" : "ABSENCE", attendanceDetails: { ...details, kind }, correctionWorkdayId: null })
    const body = { decision: "APPROVED", version, note: "Fictional checked request" }
    expect((await post(body)).status).toBe(200)
    expect((await post(body)).status).toBe(200)
    expect(stored?.status).toBe("APPROVED")
    expect(prisma.mtmHrmRequest.updateMany).toHaveBeenCalledTimes(1)
    expect(prisma.mtmAuditLog.create).toHaveBeenCalledTimes(1)
    expect(prisma.mtmNotification.create).toHaveBeenCalledTimes(1)
    expect(prisma.mtmAgentWorkday.update).not.toHaveBeenCalled()
    expect(prisma.workforceTimeCorrection.create).not.toHaveBeenCalled()
    expect((await post({ ...body, decision: "REJECTED" })).status).toBe(409)
  })
  it("requires a rejection reason, preserves it only in the request and retries the same decision", async () => {
    expect(AttendanceDecisionInputSchema.safeParse({ decision: "REJECTED", version }).success).toBe(false)
    expect((await post({ decision: "REJECTED", version, note: "  " })).status).toBe(400)
    noWrites()
    const note = "PRIVATE_REJECTION_NOTE"
    expect((await post({ decision: "REJECTED", version, note })).status).toBe(200)
    expect((await post({ decision: "REJECTED", version, note })).status).toBe(200)
    expect(stored?.decisionNote).toBe(note)
    expect(prisma.mtmAuditLog.create).toHaveBeenCalledTimes(1)
    expect(prisma.mtmNotification.create).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(vi.mocked(prisma.mtmAuditLog.create).mock.calls)).not.toContain(note)
    expect(JSON.stringify(vi.mocked(prisma.mtmNotification.create).mock.calls)).not.toMatch(/PRIVATE_REJECTION_NOTE|PRIVATE_EMPLOYEE_REASON/)
    expect(prisma.workforceTimeCorrection.create).not.toHaveBeenCalled()
    expect((await post({ decision: "REJECTED", version, note: "A different note" })).status).toBe(409)
    expect((await post({ decision: "APPROVED", version })).status).toBe(409)
  })
  it.each(["api-key", "own-linked-user", "revoked-scope", "revoked-write", "inactive-user", "hidden-module", "feature-revoked", "capability-revoked", "read-all-viewer"])("rejects %s using current authority before writes", async (kind) => {
    if (kind === "api-key") identity({ principalType: "api_key" })
    if (kind === "own-linked-user") stored!.agent.userId = userId // The ADMIN actor deliberately has agentId:null.
    if (kind === "revoked-scope") vi.mocked(resolveMtmRouteActor).mockResolvedValueOnce({ agentId: null, role: "ADMIN", scopedAgentIds: null }).mockResolvedValue({ agentId: "manager", role: "MANAGER", scopedAgentIds: [] })
    if (kind === "revoked-write") currentUser!.role = "viewer"
    if (kind === "inactive-user") currentUser = null
    if (kind === "hidden-module") { currentUser!.role = "manager"; currentUser!.hiddenModules = ["mtm"] }
    if (kind === "feature-revoked") vi.mocked(prisma.mtmSetting.findUnique).mockResolvedValue({ value: false } as never)
    if (kind === "capability-revoked") vi.mocked(prisma.organization.findUnique).mockResolvedValue(null)
    if (kind === "read-all-viewer") { identity({ role: "viewer" }); currentUser = { role: "viewer", hiddenModules: [], mtmAttendanceAll: true } }
    const response = await post()
    expect([403, 404]).toContain(response.status)
    expect(await response.json()).toHaveProperty("code")
    noWrites()
  })
  it("denies an API-key caller in the service too, before even reading a private request", async () => {
    await expect(decideAttendanceRequestInTransaction(prisma, { organizationId, userId, principalType: "api_key" }, requestId, { decision: "APPROVED", version })).rejects.toMatchObject({ status: 403 })
    expect(prisma.mtmHrmRequest.findFirst).not.toHaveBeenCalled(); noWrites()
  })
  it.each(["APPROVED", "REJECTED"])("refuses a stale %s version without notifications", async (decision) => {
    const response = await post({ decision, version: at("14:29").toISOString(), note: "Fixture decision" })
    expect(response.status).toBe(409)
    expect(await response.json()).toHaveProperty("code", "MTM_ATTENDANCE_REQUEST_CHANGED")
    noWrites()
  })
  it("refuses a foreign/missing request and an upstream tenant denial", async () => {
    stored = null
    expect((await post()).status).toBe(404)
    expect(prisma.mtmHrmRequest.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: requestId, organizationId }) }))
    vi.mocked(prisma.mtmHrmRequest.findFirst).mockClear()
    vi.mocked(requireTenantCapabilityAccessResponse).mockResolvedValue(NextResponse.json({ error: "Forbidden" }, { status: 403 }))
    expect((await post()).status).toBe(403)
    expect(prisma.mtmHrmRequest.findFirst).not.toHaveBeenCalled(); noWrites()
  })
  it.each(["declared-large", "stream-large", "multibyte-large", "invalid-json", "invalid-length", "invalid-version", "foreign-field"])("bounds %s before the request service", async (kind) => {
    let body: unknown = { decision: "APPROVED", version }
    let headers: Record<string, string> | undefined
    let expected = 400
    if (kind === "declared-large") { headers = { "content-length": "4097" }; expected = 413 }
    if (kind === "stream-large") { body = JSON.stringify(body) + " ".repeat(4096); headers = { "content-length": "1" }; expected = 413 }
    if (kind === "multibyte-large") { body = { decision: "APPROVED", version, note: "界".repeat(1400) }; expected = 413 }
    if (kind === "invalid-json") body = "{"
    if (kind === "invalid-length") headers = { "content-length": "-1" }
    if (kind === "invalid-version") body = { decision: "APPROVED", version: "yesterday" }
    if (kind === "foreign-field") body = { decision: "APPROVED", version, agentId: "other" }
    const result = await post(body, headers)
    expect(result.status).toBe(expected)
    expect(prisma.mtmHrmRequest.findFirst).not.toHaveBeenCalled(); noWrites()
  })
  it("redacts unexpected failures without exposing request text or database details", async () => {
    vi.mocked(prisma.mtmHrmRequest.findFirst).mockRejectedValue(new Error("PRIVATE_MEDICAL_REASON SQL secret constraint"))
    const result = await post()
    expect(result.status).toBe(500)
    expect(await result.json()).toEqual({ error: "MTM_ATTENDANCE_REQUEST_FAILED", code: "MTM_ATTENDANCE_REQUEST_FAILED" })
    noWrites()
  })
})


describe("attendance review list has its own current write scope", () => {
  it("returns the permitted request, author and reviewer without an internal hash", async () => {
    vi.mocked(prisma.mtmHrmRequest.findMany).mockResolvedValue([{ ...stored, agent: { name: "Fictional employee", team: { name: "Fictional team" } } }] as never)
    const response = await reviewGet(new NextRequest("http://localhost/api/v1/mtm/attendance/requests?status=PENDING"))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.data.items[0]).toMatchObject({ id: requestId, employeeName: "Fictional employee", teamName: "Fictional team" })
    expect(JSON.stringify(body)).not.toContain("submissionHash")
    expect(prisma.mtmHrmRequest.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ organizationId, status: "PENDING", agent: { is: { organizationId, status: "ACTIVE", OR: [{ userId: null }, { userId: { not: userId } }] } } }) }))
  })
  it.each(["api-key", "inactive-user", "read-only-hr", "hidden", "feature-off", "unbounded-manager"])("denies %s before reading any request detail", async (kind) => {
    if (kind === "api-key") identity({ principalType: "api_key" })
    if (kind === "inactive-user") currentUser = null
    if (kind === "read-only-hr") { currentUser = { role: "viewer", hiddenModules: [], mtmAttendanceAll: true }; identity({ role: "viewer" }) }
    if (kind === "hidden") currentUser = { role: "manager", hiddenModules: ["mtm"] }
    if (kind === "feature-off") vi.mocked(prisma.mtmSetting.findUnique).mockResolvedValue({ value: false } as never)
    if (kind === "unbounded-manager") vi.mocked(resolveMtmRouteActor).mockResolvedValue({ role: "MANAGER", agentId: null, scopedAgentIds: null })
    expect([403, 404]).toContain((await reviewGet(new NextRequest("http://localhost/api/v1/mtm/attendance/requests"))).status)
    expect(prisma.mtmHrmRequest.findMany).not.toHaveBeenCalled()
  })
  it("applies the supervisor's exact scope and rejects a cursor outside it", async () => {
    vi.mocked(resolveMtmRouteActor).mockResolvedValue({ role: "SUPERVISOR", agentId: "supervisor", scopedAgentIds: [agentId] })
    vi.mocked(prisma.mtmHrmRequest.findMany).mockResolvedValue([])
    expect((await reviewGet(new NextRequest("http://localhost/api/v1/mtm/attendance/requests"))).status).toBe(200)
    expect(prisma.mtmHrmRequest.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ AND: [{ agentId: { in: [agentId] } }, { agentId: { not: "supervisor" } }] }) }))
    vi.mocked(prisma.mtmHrmRequest.findFirst).mockResolvedValue(null)
    expect((await reviewGet(new NextRequest(`http://localhost/api/v1/mtm/attendance/requests?cursor=${randomUUID()}`))).status).toBe(409)
  })
})


describe("private document access uses review authority, not a report-wide grant", () => {
  const id = randomUUID()
  const get = () => attachmentGet(new NextRequest(`http://localhost/api/v1/mtm/attendance/attachments/${id}`), { params: Promise.resolve({ id }) })
  beforeEach(() => {
    vi.mocked(prisma.mtmAttendanceAttachment.findFirst).mockResolvedValue({ agentId } as never)
    vi.mocked(readAttendanceDocument).mockResolvedValue({ bytes: Buffer.from("fixture"), mimeType: "image/jpeg" })
  })
  it("passes the current real reviewer scope to the private reader", async () => {
    const res = await get()
    expect(res.status).toBe(200)
    expect(readAttendanceDocument).toHaveBeenCalledWith({ organizationId, actor: { agentId: null, role: "ADMIN", scopedAgentIds: null } }, id)
    expect(res.headers.get("cache-control")).toBe("private, no-store")
  })
  it.each(["read-only", "other-team", "self", "api-key", "missing"])("does not read bytes for %s", async (reason) => {
    if (reason === "read-only") currentUser = { role: "viewer", hiddenModules: [], mtmAttendanceAll: true }
    if (reason === "other-team") vi.mocked(resolveMtmRouteActor).mockResolvedValueOnce({ agentId: null, role: "ADMIN", scopedAgentIds: null }).mockResolvedValue({ agentId: "manager", role: "MANAGER", scopedAgentIds: [] })
    if (reason === "self") stored!.agent.userId = userId
    if (reason === "api-key") identity({ principalType: "api_key" })
    if (reason === "missing") vi.mocked(prisma.mtmAttendanceAttachment.findFirst).mockResolvedValue(null)
    const res = await get()
    expect([403, 404]).toContain(res.status)
    expect(readAttendanceDocument).not.toHaveBeenCalled()
  })
})
