import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"
vi.mock("@/lib/prisma", async () => ({ prisma: (await import("./mocks/mtm-prisma")).makeMtmPrismaMock() }))
vi.mock("@/lib/api-auth", () => ({ requireAuth: vi.fn(), getOrgId: vi.fn(), getSession: vi.fn().mockResolvedValue(null), isAuthError: (value: unknown) => value instanceof Response }))
vi.mock("@/lib/mobile-auth", async () => (await import("./mocks/mobile-auth")).makeMobileAuthMock())
vi.mock("@/lib/mtm/route-permissions", async (original) => ({ ...await original<typeof import("@/lib/mtm/route-permissions")>(), resolveMtmRouteActor: vi.fn() }))
vi.mock("@/lib/tenant-capability-access", async (original) => ({ ...await original<typeof import("@/lib/tenant-capability-access")>(), requireTenantCapabilityAccessResponse: vi.fn().mockResolvedValue(null) }))
import { prisma } from "@/lib/prisma"
import { requireAuth, type AuthResult } from "@/lib/api-auth"
import { resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import { requireTenantCapabilityAccessResponse } from "@/lib/tenant-capability-access"
import { AttendanceRequestLimitsSchema, DEFAULT_ATTENDANCE_REQUEST_LIMITS, attendanceLateLeaveNotice, attendanceRequestLimitDecision, isAttendanceRequestLimited } from "@/lib/mtm/attendance-request-limits"
import { lockAttendanceRequestLimits, readAttendanceRequestLimits, saveAttendanceRequestLimits } from "@/lib/mtm/attendance-request-limit-store"
import { AttendanceRequestError } from "@/lib/mtm/attendance-request-contract"
import { GET, PUT } from "@/app/api/v1/mtm/attendance/request-limits/route"
import { getRlsContext } from "@/lib/rls-context"

const org = "limits-fixture-org", user = "limits-fixture-admin"
let currentUser: { role: string; hiddenModules: string[] } | null
let setting: { value: unknown; updatedAt: Date } | null
let enabled: boolean
function identity(change: Partial<AuthResult> = {}) { vi.mocked(requireAuth).mockResolvedValue({ orgId: org, userId: user, role: "admin", principalType: "session", name: "Fixture", email: "fixture@example.test", ...change } as AuthResult) }
const request = (body?: unknown, headers?: Record<string, string>) => new NextRequest("http://localhost/api/v1/mtm/attendance/request-limits", { method: body ? "PUT" : "GET", headers: { "content-type": "application/json", ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) })
beforeEach(() => {
  vi.resetAllMocks(); currentUser = { role: "admin", hiddenModules: [] }; setting = null; enabled = true; identity()
  vi.mocked(requireTenantCapabilityAccessResponse).mockResolvedValue(null)
  vi.mocked(resolveMtmRouteActor).mockResolvedValue({ agentId: null, role: "ADMIN", scopedAgentIds: null })
  vi.mocked(prisma.$transaction).mockImplementation((async (callback: (tx: typeof prisma) => unknown) => callback(prisma)) as never)
  vi.mocked(prisma.$queryRaw).mockImplementation((async (query: TemplateStringsArray) => query.join(" ").includes('FROM "users"') ? currentUser ? [currentUser] : [] : []) as never)
  vi.mocked(prisma.organization.findUnique).mockResolvedValue({ plan: "enterprise", addons: [], features: ["mtm"], modules: { mtm: true }, settings: {} } as never)
  vi.mocked(prisma.mtmSetting.findMany).mockResolvedValue([{ key: "attendanceEnabled", value: true }] as never)
  vi.mocked(prisma.mtmSetting.findUnique).mockImplementation((async ({ where }: { where: { organizationId_key: { key: string } } }) => where.organizationId_key.key === "attendanceEnabled" ? { value: enabled } : setting) as never)
  vi.mocked(prisma.mtmSetting.upsert).mockImplementation((async ({ create }: { create: { value: unknown; updatedAt: Date } }) => { setting = create; return create }) as never)
})
describe("hourly request limits contract", () => {
  it("defaults to a shared 8 hours and 3 requests only for hourly time off/absence", () => {
    expect(DEFAULT_ATTENDANCE_REQUEST_LIMITS).toEqual({ monthlyMinutes: 480, monthlyRequests: 3, leaveNoticeDays: 0 })
    for (const kind of ["TIME_OFF", "HOURLY_ABSENCE"]) expect(isAttendanceRequestLimited({ kind, unit: "HOURS" })).toBe(true)
    for (const kind of ["TIME_CORRECTION", "SICK_LEAVE", "ANNUAL_LEAVE", "OVERTIME", "REMOTE_WORK", "BUSINESS_TRIP"]) expect(isAttendanceRequestLimited({ kind, unit: "HOURS" })).toBe(false)
    expect(isAttendanceRequestLimited({ kind: "TIME_OFF", unit: "DAYS" })).toBe(false)
  })
  it("marks an annual leave asked for later than the notice, and nothing else", () => {
    const leave = (startDate: string, submittedDate = "2026-11-01") => ({ kind: "ANNUAL_LEAVE", startDate, submittedDate })
    expect(attendanceLateLeaveNotice(leave("2026-11-03"), 5)).toEqual({ days: 2, required: 5 })
    expect(attendanceLateLeaveNotice(leave("2026-11-01"), 5)).toEqual({ days: 0, required: 5 })
    expect(attendanceLateLeaveNotice(leave("2026-11-06"), 5)).toBeNull()
    expect(attendanceLateLeaveNotice(leave("2026-11-03"), 0)).toBeNull()
    expect(attendanceLateLeaveNotice({ ...leave("2026-11-02"), kind: "SICK_LEAVE" }, 5)).toBeNull()
    // Across a month and a leap day: calendar days, not 30-day months.
    expect(attendanceLateLeaveNotice(leave("2028-03-01", "2028-02-27"), 5)).toEqual({ days: 3, required: 5 })
  })
  it("accepts the exact remaining minute/count and refuses either exhaustion, including zero", () => {
    const limits = { ...DEFAULT_ATTENDANCE_REQUEST_LIMITS, version: null }
    expect(attendanceRequestLimitDecision(limits, { usedMinutes: 450, usedRequests: 2 }, 30)).toBeNull()
    expect(attendanceRequestLimitDecision(limits, { usedMinutes: 450, usedRequests: 2 }, 31)).toBe("MTM_ATTENDANCE_REQUEST_MINUTES_LIMIT")
    expect(attendanceRequestLimitDecision(limits, { usedMinutes: 0, usedRequests: 3 }, 1)).toBe("MTM_ATTENDANCE_REQUEST_COUNT_LIMIT")
    expect(attendanceRequestLimitDecision({ monthlyMinutes: 0, monthlyRequests: 3 }, { usedMinutes: 0, usedRequests: 0 }, 1)).toBe("MTM_ATTENDANCE_REQUEST_MINUTES_LIMIT")
    expect(attendanceRequestLimitDecision({ monthlyMinutes: 480, monthlyRequests: 0 }, { usedMinutes: 0, usedRequests: 0 }, 1)).toBe("MTM_ATTENDANCE_REQUEST_COUNT_LIMIT")
    expect(attendanceRequestLimitDecision({ monthlyMinutes: 120, monthlyRequests: 10 }, { usedMinutes: 180, usedRequests: 1 }, 1)).toBe("MTM_ATTENDANCE_REQUEST_MINUTES_LIMIT")
  })
  it.each([{ monthlyMinutes: -30 }, { monthlyMinutes: 1 }, { monthlyMinutes: 60.5 }, { monthlyMinutes: 44_670 }, { monthlyRequests: 101 }, { monthlyRequests: 1.5 }, { monthlyRequests: -1 }])("refuses invalid configuration %j", (change) => {
    expect(AttendanceRequestLimitsSchema.safeParse({ ...DEFAULT_ATTENDANCE_REQUEST_LIMITS, ...change }).success).toBe(false)
  })
  it("fails closed on corrupt usage instead of granting a negative or unlimited allowance", () => {
    for (const usage of [{ usedMinutes: -1, usedRequests: 0 }, { usedMinutes: 0, usedRequests: NaN }, { usedMinutes: 1.2, usedRequests: 1 }]) {
      expect(() => attendanceRequestLimitDecision(DEFAULT_ATTENDANCE_REQUEST_LIMITS, usage, 60)).toThrow()
    }
    expect(() => attendanceRequestLimitDecision(DEFAULT_ATTENDANCE_REQUEST_LIMITS, { usedMinutes: 0, usedRequests: 0 }, 0)).toThrow()
  })
})
describe("versioned org settings and authenticated API", () => {
  it("reads default settings without writing a setting row", async () => {
    expect(await readAttendanceRequestLimits(org)).toEqual({ ...DEFAULT_ATTENDANCE_REQUEST_LIMITS, version: null })
    const result = await GET(request())
    expect(await result.json()).toEqual({ success: true, data: { ...DEFAULT_ATTENDANCE_REQUEST_LIMITS, version: null, canManage: true } })
    expect(prisma.mtmSetting.upsert).not.toHaveBeenCalled()
    expect(result.headers.get("cache-control")).toContain("no-store")
  })
  it("saves one version and audit atomically, preserves no-op, and refuses a stale editor", async () => {
    vi.mocked(prisma.mtmAuditLog.create).mockImplementation((async () => { expect(getRlsContext()).toMatchObject({ orgId: org }); return {} }) as never)
    const result = await PUT(request({ version: null, monthlyMinutes: 510, monthlyRequests: 4 }))
    expect(result.status).toBe(200)
    const data = (await result.json()).data
    expect(data).toMatchObject({ monthlyMinutes: 510, monthlyRequests: 4, version: expect.any(String) })
    expect(setting?.value).toEqual({ schemaVersion: 1, monthlyMinutes: 510, monthlyRequests: 4, leaveNoticeDays: 0 })
    expect((await PUT(request(data))).status).toBe(200)
    expect((await PUT(request({ version: null, monthlyMinutes: 600, monthlyRequests: 5 }))).status).toBe(409)
    expect(prisma.mtmSetting.upsert).toHaveBeenCalledTimes(1); expect(prisma.mtmAuditLog.create).toHaveBeenCalledTimes(1)
    expect(prisma.mtmAuditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ oldData: { ...DEFAULT_ATTENDANCE_REQUEST_LIMITS, version: null }, newData: data }) }))
    expect(prisma.mtmHrmRequest.updateMany).not.toHaveBeenCalled()
  })
  // Owner, 2026-11-01 (HRSS clip): the leave notice lives with the request rules.
  it("saves the leave notice, and a tab opened before it existed keeps it instead of clearing it", async () => {
    const saved = (await (await PUT(request({ version: null, monthlyMinutes: 480, monthlyRequests: 3, leaveNoticeDays: 5 }))).json()).data
    expect(saved).toMatchObject({ leaveNoticeDays: 5 })
    expect(setting?.value).toEqual({ schemaVersion: 1, monthlyMinutes: 480, monthlyRequests: 3, leaveNoticeDays: 5 })
    const old = (await (await PUT(request({ version: saved.version, monthlyMinutes: 540, monthlyRequests: 3 }))).json()).data
    expect(old).toMatchObject({ monthlyMinutes: 540, leaveNoticeDays: 5 })
    expect(setting?.value).toEqual({ schemaVersion: 1, monthlyMinutes: 540, monthlyRequests: 3, leaveNoticeDays: 5 })
    expect((await PUT(request({ version: old.version, monthlyMinutes: 540, monthlyRequests: 3, leaveNoticeDays: 91 }))).status).toBe(400)
  })
  it("reads a rule stored before the notice existed as no notice", async () => {
    setting = { value: { schemaVersion: 1, monthlyMinutes: 480, monthlyRequests: 3 }, updatedAt: new Date("2026-10-13T12:00:00Z") }
    expect(await readAttendanceRequestLimits(org)).toMatchObject({ leaveNoticeDays: 0 })
  })
  it("advances an existing version even when the host clock is behind it", async () => {
    const future = new Date("2099-01-01T00:00:00Z")
    setting = { value: { schemaVersion: 1, ...DEFAULT_ATTENDANCE_REQUEST_LIMITS }, updatedAt: future }
    expect((await saveAttendanceRequestLimits(org, user, { version: future.toISOString(), monthlyMinutes: 540, monthlyRequests: 3 })).version).toBe(new Date(future.getTime() + 1).toISOString())
  })
  it.each(["api-key", "manager", "revoked-role", "inactive", "feature-off", "capability-off"])("blocks %s before writing settings or audit", async (kind) => {
    if (kind === "api-key") identity({ principalType: "api_key" })
    if (kind === "manager") identity({ role: "manager" })
    if (kind === "revoked-role") currentUser!.role = "manager"
    if (kind === "inactive") currentUser = null
    if (kind === "feature-off") enabled = false
    if (kind === "capability-off") vi.mocked(prisma.organization.findUnique).mockResolvedValue(null)
    expect([403, 404]).toContain((await PUT(request({ version: null, monthlyMinutes: 60, monthlyRequests: 1 }))).status)
    expect(prisma.mtmSetting.upsert).not.toHaveBeenCalled(); expect(prisma.mtmAuditLog.create).not.toHaveBeenCalled()
  })
  it.each([{}, { schemaVersion: 2, ...DEFAULT_ATTENDANCE_REQUEST_LIMITS }, { schemaVersion: 1, monthlyMinutes: -1, monthlyRequests: 3 }])("refuses malformed stored settings %j instead of resetting limits", async (value) => {
    setting = { value, updatedAt: new Date() }
    await expect(readAttendanceRequestLimits(org)).rejects.toBeInstanceOf(AttendanceRequestError)
    const result = await GET(request())
    expect(result.status).toBe(409)
    expect(await result.json()).toHaveProperty("code", "MTM_ATTENDANCE_REQUEST_LIMITS_INVALID_STORED")
    expect(prisma.mtmSetting.upsert).not.toHaveBeenCalled()
  })
  it("uses shared and exclusive locks on one setting key even before the first setting exists", async () => {
    await lockAttendanceRequestLimits(prisma, org, "read")
    await lockAttendanceRequestLimits(prisma, org, "write")
    const sql = vi.mocked(prisma.$executeRaw).mock.calls.map(call => call.flat().join(" "))
    expect(sql.some(line => line.includes("pg_advisory_xact_lock_shared") && line.includes(`mtm-attendance-request-limits:${org}`))).toBe(true)
    expect(sql.some(line => line.includes("pg_advisory_xact_lock(") && line.includes(`mtm-attendance-request-limits:${org}`))).toBe(true)
  })
  it("rejects overlarge and invalid bodies before entering the save transaction", async () => {
    expect((await PUT(request({ version: null, monthlyMinutes: 480, monthlyRequests: 3 }, { "content-length": "2049" }))).status).toBe(413)
    expect((await PUT(request({ version: null, monthlyMinutes: 481, monthlyRequests: 3 }))).status).toBe(400)
    expect(prisma.$transaction).not.toHaveBeenCalled(); expect(prisma.mtmSetting.upsert).not.toHaveBeenCalled()
  })
})
