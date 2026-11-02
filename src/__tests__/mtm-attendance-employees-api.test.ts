import { NextRequest, NextResponse } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"
vi.mock("@/lib/prisma", async () => ({ prisma: (await import("./mocks/mtm-prisma")).makeMtmPrismaMock() }))
vi.mock("@/lib/api-auth", () => ({ requireAuth: vi.fn(), getOrgId: vi.fn(), getSession: vi.fn().mockResolvedValue(null), isAuthError: (value: unknown) => value instanceof Response }))
vi.mock("@/lib/mtm/route-permissions", async original => ({ ...await original<typeof import("@/lib/mtm/route-permissions")>(), resolveMtmRouteActor: vi.fn() }))
vi.mock("@/lib/tenant-capability-access", async original => ({ ...await original<typeof import("@/lib/tenant-capability-access")>(), requireTenantCapabilityAccessResponse: vi.fn().mockResolvedValue(null) }))
vi.mock("@/lib/mtm/attendance-employee-store", () => ({ readAttendanceEmployees: vi.fn(), enrollAttendanceEmployee: vi.fn(), recordAttendanceEmployment: vi.fn(), setAttendanceParticipation: vi.fn() }))
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/lib/api-auth"
import { resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import { requireTenantCapabilityAccessResponse } from "@/lib/tenant-capability-access"
import * as store from "@/lib/mtm/attendance-employee-store"
import { GET, POST } from "@/app/api/v1/mtm/attendance/employees/route"
import { POST as history } from "@/app/api/v1/mtm/attendance/employees/history/route"
import { POST as participation } from "@/app/api/v1/mtm/attendance/employees/participation/route"
import { AttendanceRequestError } from "@/lib/mtm/attendance-request-contract"
import { AttendanceEmployeeEnrollmentSchema, AttendanceEmploymentInputSchema, AttendanceParticipationInputSchema, mayUseAttendanceSelf } from "@/lib/mtm/attendance-employee-contract"
const request = (method = "GET", body?: string) => new NextRequest("http://localhost/api/v1/mtm/attendance/employees", { method, ...(body === undefined ? {} : { body, headers: { "content-type": "application/json" } }) })
const input = { clientRequestId: "e0000000-0000-4000-8000-000000000001", userId: "fictional-user", teamId: null, hireDate: "2026-10-01", reason: "Fictional employment" }
beforeEach(() => {
  vi.clearAllMocks(); vi.mocked(requireAuth).mockResolvedValue({ orgId: "employee-fixture", userId: "admin-fixture", role: "admin", principalType: "session" } as never)
  vi.mocked(resolveMtmRouteActor).mockResolvedValue({ role: "ADMIN", agentId: null, scopedAgentIds: null })
  vi.mocked(requireTenantCapabilityAccessResponse).mockResolvedValue(null)
  vi.mocked(prisma.mtmSetting.findMany).mockResolvedValue([{ key: "attendanceEnabled", value: true }] as never)
  vi.mocked(store.readAttendanceEmployees).mockResolvedValue({ users: [], teams: [], departments: [], managers: [], employees: [], timezone: "Asia/Baku" })
  vi.mocked(store.enrollAttendanceEmployee).mockResolvedValue({ agentId: "employee-id", idempotent: false })
  vi.mocked(store.recordAttendanceEmployment).mockResolvedValue({ eventId: "event-id", idempotent: false })
  vi.mocked(store.setAttendanceParticipation).mockResolvedValue({ eventId: "participation-id", idempotent: false })
})
describe("employee enrollment HTTP authorization and payload boundaries", () => {
  it.each([GET, POST, history, participation])("requires the attendance module before reaching the service", async route => {
    vi.mocked(prisma.mtmSetting.findMany).mockResolvedValue([])
    expect((await route(request(route === GET ? "GET" : "POST", route === GET ? undefined : JSON.stringify(input)), undefined)).status).toBe(404)
    expect(store.readAttendanceEmployees).not.toHaveBeenCalled(); expect(store.enrollAttendanceEmployee).not.toHaveBeenCalled(); expect(store.recordAttendanceEmployment).not.toHaveBeenCalled()
    expect(store.setAttendanceParticipation).not.toHaveBeenCalled()
  })
  it.each(["api_key", undefined])("rejects %s principals before private reads and mutations", async principalType => {
    vi.mocked(requireAuth).mockResolvedValue({ orgId: "employee-fixture", userId: "admin-fixture", role: "admin", principalType } as never)
    for (const route of [GET, POST, history, participation]) expect((await route(request(route === GET ? "GET" : "POST", route === GET ? undefined : JSON.stringify(input)), undefined)).status).toBe(403)
    expect(store.readAttendanceEmployees).not.toHaveBeenCalled(); expect(store.enrollAttendanceEmployee).not.toHaveBeenCalled(); expect(store.recordAttendanceEmployment).not.toHaveBeenCalled()
    expect(store.setAttendanceParticipation).not.toHaveBeenCalled()
  })
  it("preserves tenant capability and unauthenticated refusal", async () => {
    vi.mocked(requireTenantCapabilityAccessResponse).mockResolvedValue(NextResponse.json({ code: "TENANT_CAPABILITY_DISABLED" }, { status: 403 }))
    expect((await GET(request(), undefined)).status).toBe(403); expect(store.readAttendanceEmployees).not.toHaveBeenCalled()
    vi.mocked(requireAuth).mockResolvedValue(NextResponse.json({ error: "Unauthorized" }, { status: 401 }) as never)
    expect((await GET(request(), undefined)).status).toBe(401)
  })
  it("passes only the authenticated caller context and retains private no-store headers", async () => {
    const read = await GET(request(), undefined); expect(read.status).toBe(200); expect(read.headers.get("cache-control")).toBe("private, no-store")
    const saved = await POST(request("POST", JSON.stringify(input)), undefined); expect(saved.status).toBe(200)
    expect(store.enrollAttendanceEmployee).toHaveBeenCalledWith({ organizationId: "employee-fixture", userId: "admin-fixture", principalType: "session" }, input)
    const event = { clientRequestId: input.clientRequestId, agentId: "employee-id", kind: "TERMINATION", date: "2026-10-31", previousEventId: "hire-id", reason: input.reason }
    await history(request("POST", JSON.stringify(event)), undefined)
    expect(store.recordAttendanceEmployment).toHaveBeenCalledWith({ organizationId: "employee-fixture", userId: "admin-fixture", principalType: "session" }, event)
  })
  it.each([POST, history, participation])("rejects over-limit and malformed JSON before a write service", async route => {
    expect((await route(request("POST", JSON.stringify({ reason: "x".repeat(5000) })), undefined)).status).toBe(413)
    expect((await route(request("POST", "{"), undefined)).status).toBe(400)
    expect(store.enrollAttendanceEmployee).not.toHaveBeenCalled(); expect(store.recordAttendanceEmployment).not.toHaveBeenCalled()
    expect(store.setAttendanceParticipation).not.toHaveBeenCalled()
  })
  it("forwards current-admin refusal and stale-history conflict without internal data", async () => {
    vi.mocked(store.readAttendanceEmployees).mockRejectedValue(new AttendanceRequestError("MTM_ATTENDANCE_EMPLOYEE_ADMIN_REQUIRED", 403))
    expect((await GET(request(), undefined)).status).toBe(403)
    vi.mocked(store.recordAttendanceEmployment).mockRejectedValue(new AttendanceRequestError("MTM_ATTENDANCE_EMPLOYEE_HISTORY_CHANGED", 409))
    const stale = await history(request("POST", "{}"), undefined); expect(stale.status).toBe(409); expect(await stale.json()).toMatchObject({ code: "MTM_ATTENDANCE_EMPLOYEE_HISTORY_CHANGED" })
    vi.mocked(store.enrollAttendanceEmployee).mockRejectedValue(new Error("PRIVATE_REASON_DATABASE_PASSWORD"))
    const failed = await POST(request("POST", "{}"), undefined); expect(failed.status).toBe(500); expect(await failed.text()).not.toMatch(/PRIVATE|PASSWORD/)
  })
  it.each([{ hireDate: "" }, { hireDate: "2026-02-30" }, { reason: "ab" }, { userId: "" }, { organizationId: "foreign" }, { role: "ADMIN" }])("refuses invalid or authority-bearing enrollment input %j", change => {
    expect(AttendanceEmployeeEnrollmentSchema.safeParse({ ...input, ...change }).success).toBe(false)
  })
  it("accepts explicit first-hire and rehire snapshots without a manufactured day gap", () => {
    const event = { clientRequestId: input.clientRequestId, agentId: "employee-id", kind: "HIRE", date: "2026-10-01", previousEventId: null, reason: input.reason }
    expect(AttendanceEmploymentInputSchema.safeParse(event).success).toBe(true)
    expect(AttendanceEmploymentInputSchema.safeParse({ ...event, kind: "REHIRE", date: "2026-11-01", previousEventId: "term-id" }).success).toBe(true)
    expect(AttendanceEmploymentInputSchema.safeParse({ ...event, expectedVersion: 1 }).success).toBe(false)
  })
  it("accepts a reason-free participation toggle and binds its actor to the authenticated session", async () => {
    const change = { clientRequestId: input.clientRequestId, agentId: "employee-id", included: false, previousEventId: null }
    expect(AttendanceParticipationInputSchema.parse(change)).toEqual(change)
    const response = await participation(request("POST", JSON.stringify(change)), undefined)
    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    expect(await response.json()).toEqual({ success: true, data: { eventId: "participation-id", idempotent: false } })
    expect(store.setAttendanceParticipation).toHaveBeenCalledWith({ organizationId: "employee-fixture", userId: "admin-fixture", principalType: "session" }, change)
    for (const extra of [{ organizationId: "foreign" }, { role: "ADMIN" }, { included: "false" }, { clientRequestId: "invalid" }, { previousEventId: "" }]) {
      expect(AttendanceParticipationInputSchema.safeParse({ ...change, ...extra }).success).toBe(false)
    }
  })
  it("returns a reviewable stale toggle conflict and hides unexpected database payloads", async () => {
    vi.mocked(store.setAttendanceParticipation).mockRejectedValueOnce(new AttendanceRequestError("MTM_ATTENDANCE_PARTICIPATION_CHANGED"))
    const stale = await participation(request("POST", "{}"), undefined)
    expect(stale.status).toBe(409)
    expect(await stale.json()).toMatchObject({ code: "MTM_ATTENDANCE_PARTICIPATION_CHANGED" })
    vi.mocked(store.setAttendanceParticipation).mockRejectedValueOnce(new Error("PRIVATE_EMPLOYEE_DATABASE_PAYLOAD"))
    const failed = await participation(request("POST", "{}"), undefined)
    expect(failed.status).toBe(500)
    expect(await failed.text()).not.toMatch(/PRIVATE|PAYLOAD/)
  })
  it.each(["EMPLOYEE", "ADMIN", "MANAGER", "SUPERVISOR"])("excludes %s from new self attendance without changing its role", role => {
    expect(mayUseAttendanceSelf(role, true, true)).toBe(true)
    expect(mayUseAttendanceSelf(role, true, true, true)).toBe(false)
    expect(mayUseAttendanceSelf(role, false, true)).toBe(false)
    expect(mayUseAttendanceSelf(role, true, false)).toBe(false)
  })
  // Owner, 2026-10-20: «у полевого агента всё кадровое убрать совсем» — not
  // even leave or a time correction, enrolled or not.
  it("gives a field agent no self attendance at all", () => {
    expect(mayUseAttendanceSelf("AGENT", true, true)).toBe(false)
    expect(mayUseAttendanceSelf("AGENT", true, false)).toBe(false)
  })
})
