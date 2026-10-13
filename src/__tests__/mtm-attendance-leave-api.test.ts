import { NextRequest, NextResponse } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"
vi.mock("@/lib/prisma", async () => ({ prisma: (await import("./mocks/mtm-prisma")).makeMtmPrismaMock() }))
vi.mock("@/lib/api-auth", () => ({ requireAuth: vi.fn(), getOrgId: vi.fn(), getSession: vi.fn().mockResolvedValue(null), isAuthError: (value: unknown) => value instanceof Response }))
vi.mock("@/lib/mtm/route-permissions", async original => ({ ...await original<typeof import("@/lib/mtm/route-permissions")>(), resolveMtmRouteActor: vi.fn() }))
vi.mock("@/lib/tenant-capability-access", async original => ({ ...await original<typeof import("@/lib/tenant-capability-access")>(), requireTenantCapabilityAccessResponse: vi.fn().mockResolvedValue(null) }))
vi.mock("@/lib/mtm/attendance-leave-store", () => ({ readAttendanceLeaveBalances: vi.fn(), saveAttendanceLeavePolicy: vi.fn(), saveAttendanceLeaveProfile: vi.fn() }))
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/lib/api-auth"
import { resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import { AttendanceRequestError } from "@/lib/mtm/attendance-request-contract"
import * as store from "@/lib/mtm/attendance-leave-store"
import { GET } from "@/app/api/v1/mtm/attendance/leave-balances/route"
import { POST } from "@/app/api/v1/mtm/attendance/leave-balances/policy/route"
import { POST as PROFILE } from "@/app/api/v1/mtm/attendance/leave-balances/profiles/route"
const request = (body?: string) => new NextRequest("http://localhost/api/v1/mtm/attendance/leave-balances?year=2026", body === undefined ? {} : { method: "POST", body, headers: { "content-type": "application/json" } })
beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireAuth).mockResolvedValue({ orgId: "leave-fixture", userId: "leave-admin", role: "admin", principalType: "session" } as never)
  vi.mocked(resolveMtmRouteActor).mockResolvedValue({ role: "ADMIN", agentId: null, scopedAgentIds: null })
  vi.mocked(prisma.mtmSetting.findMany).mockResolvedValue([{ key: "attendanceEnabled", value: true }] as never)
  vi.mocked(store.readAttendanceLeaveBalances).mockResolvedValue({} as never)
  vi.mocked(store.saveAttendanceLeavePolicy).mockResolvedValue({} as never)
})
describe("Leave balance HTTP boundaries", () => {
  it("does not read or publish when attendance is off", async () => {
    vi.mocked(prisma.mtmSetting.findMany).mockResolvedValue([])
    expect((await GET(request(), undefined)).status).toBe(404)
    expect((await POST(request("{}"), undefined)).status).toBe(404)
    expect(store.readAttendanceLeaveBalances).not.toHaveBeenCalled(); expect(store.saveAttendanceLeavePolicy).not.toHaveBeenCalled()
  })
  it.each(["api_key", undefined])("denies %s principals before publishing", async principalType => {
    vi.mocked(requireAuth).mockResolvedValue({ orgId: "leave-fixture", userId: "leave-admin", role: "admin", principalType } as never)
    expect((await GET(request(), undefined)).status).toBe(403)
    expect((await POST(request("{}"), undefined)).status).toBe(403)
    expect(store.saveAttendanceLeavePolicy).not.toHaveBeenCalled()
  })
  it("refuses read-only HR regardless of the all-employee report grant", async () => {
    // requireAuth is the mocked RBAC boundary; the real service's fresh HR
    // denial is additionally exercised by the PostgreSQL gate.
    vi.mocked(requireAuth).mockResolvedValue(new NextResponse(null, { status: 403 }))
    expect((await POST(request("{}"), undefined)).status).toBe(403)
    expect(requireAuth).toHaveBeenCalledWith(expect.any(NextRequest), "mtm", "write", { deferLegacyModuleGate: "mtm" })
    expect(store.saveAttendanceLeavePolicy).not.toHaveBeenCalled()
  })
  it.each([["{", 400], [JSON.stringify({ padding: "x".repeat(65537) }), 413]] as const)("bounds invalid bodies", async (body, status) => {
    expect((await POST(request(body), undefined)).status).toBe(status)
    expect(store.saveAttendanceLeavePolicy).not.toHaveBeenCalled()
  })
  it("marks even directory responses private and passes only the authenticated reviewer", async () => {
    const response = await GET(request(), undefined)
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("private, no-store")
    expect(store.readAttendanceLeaveBalances).toHaveBeenCalledWith({ organizationId: "leave-fixture", userId: "leave-admin", principalType: "session" }, { year: "2026" })
  })
  it("returns fresh access refusal without exposing private error details", async () => {
    vi.mocked(store.saveAttendanceLeavePolicy).mockRejectedValueOnce(new AttendanceRequestError("MTM_ATTENDANCE_LEAVE_EMPLOYEE_UNAVAILABLE", 404))
    expect((await POST(request("{}"), undefined)).status).toBe(404)
    vi.mocked(store.saveAttendanceLeavePolicy).mockRejectedValueOnce(new Error("private DB payload"))
    const response = await POST(request("{}"), undefined)
    expect(response.status).toBe(500); expect(await response.text()).not.toContain("private DB payload")
  })
  it("bounds employee input bodies before any write", async () => {
    expect((await PROFILE(request(JSON.stringify({ padding: "x".repeat(8193) })), undefined)).status).toBe(413)
    expect(store.saveAttendanceLeaveProfile).not.toHaveBeenCalled()
  })

  it("accepts bounded Unicode inputs rather than rejecting schema-valid text by byte length", async () => {
    const profile = { year: 2026, requestId: "10000000-0000-4000-8000-000000000001", expectedRevisionId: null,
      reason: "Ю".repeat(1000), agentId: "employee", profile: { category: "Ж".repeat(80), serviceStart: "2020-01-01", openingDays: 0 } }
    expect((await PROFILE(request(JSON.stringify(profile)), undefined)).status).toBe(200)
    expect(store.saveAttendanceLeaveProfile).toHaveBeenCalledWith(expect.objectContaining({ organizationId: "leave-fixture" }), profile)
    const policy = { year: profile.year, requestId: profile.requestId, expectedRevisionId: null, reason: profile.reason, policy: { reviewed: true, basisDate: "2026-01-01", counting: "WORKING_DAYS", minutesPerDay: null,
      tiers: Array.from({ length: 100 }, (_, i) => ({ category: "界".repeat(76) + String(i), minimumYears: 0, days: 1 })) } }
    expect((await POST(request(JSON.stringify(policy)), undefined)).status).toBe(200)
  })

})
