import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"
vi.mock("@/lib/prisma", async () => ({ prisma: (await import("./mocks/mtm-prisma")).makeMtmPrismaMock() }))
vi.mock("@/lib/api-auth", () => ({ requireAuth: vi.fn(), getOrgId: vi.fn(), getSession: vi.fn().mockResolvedValue(null), isAuthError: (value: unknown) => value instanceof Response }))
vi.mock("@/lib/mtm/route-permissions", async original => ({ ...await original<typeof import("@/lib/mtm/route-permissions")>(), resolveMtmRouteActor: vi.fn() }))
vi.mock("@/lib/tenant-capability-access", async original => ({ ...await original<typeof import("@/lib/tenant-capability-access")>(), requireTenantCapabilityAccessResponse: vi.fn().mockResolvedValue(null) }))
vi.mock("@/lib/mtm/attendance-qr-store", () => ({ readAttendanceQrDirectory: vi.fn(), issueAttendanceBranchQr: vi.fn() }))
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/lib/api-auth"
import { resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import { AttendanceRequestError } from "@/lib/mtm/attendance-request-contract"
import * as store from "@/lib/mtm/attendance-qr-store"
import { GET, POST } from "@/app/api/v1/mtm/attendance/branch-qr/route"
const request = (body?: string) => new NextRequest("http://localhost/api/v1/mtm/attendance/branch-qr", body === undefined ? {} : { method: "POST", body, headers: { "content-type": "application/json" } })
beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireAuth).mockResolvedValue({ orgId: "qr-fixture", userId: "qr-admin", role: "admin", principalType: "session" } as never)
  vi.mocked(resolveMtmRouteActor).mockResolvedValue({ role: "ADMIN", agentId: null, scopedAgentIds: null })
  vi.mocked(prisma.mtmSetting.findMany).mockResolvedValue([{ key: "attendanceEnabled", value: true }] as never)
  vi.mocked(store.readAttendanceQrDirectory).mockResolvedValue({ enabled: false, canConfigure: true, branches: [] })
  vi.mocked(store.issueAttendanceBranchQr).mockResolvedValue({} as never)
})
describe("QR display HTTP boundaries", () => {
  it("does not read or mint when attendance is off", async () => {
    vi.mocked(prisma.mtmSetting.findMany).mockResolvedValue([])
    expect((await GET(request(), undefined)).status).toBe(404)
    expect((await POST(request("{}"), undefined)).status).toBe(404)
    expect(store.readAttendanceQrDirectory).not.toHaveBeenCalled(); expect(store.issueAttendanceBranchQr).not.toHaveBeenCalled()
  })
  it.each(["api_key", undefined])("denies %s principals before minting", async principalType => {
    vi.mocked(requireAuth).mockResolvedValue({ orgId: "qr-fixture", userId: "qr-admin", role: "admin", principalType } as never)
    expect((await GET(request(), undefined)).status).toBe(403)
    expect((await POST(request("{}"), undefined)).status).toBe(403)
    expect(store.issueAttendanceBranchQr).not.toHaveBeenCalled()
  })
  it("refuses read-only HR regardless of the all-employee report grant", async () => {
    // requireAuth is the mocked RBAC boundary; the real service's fresh HR
    // denial is additionally exercised by the PostgreSQL gate.
    vi.mocked(requireAuth).mockResolvedValue(new Response(null, { status: 403 }))
    expect((await POST(request("{}"), undefined)).status).toBe(403)
    expect(requireAuth).toHaveBeenCalledWith(expect.any(NextRequest), "mtm", "write", { deferLegacyModuleGate: "mtm" })
    expect(store.issueAttendanceBranchQr).not.toHaveBeenCalled()
  })
  it.each([["{", 400], [JSON.stringify({ padding: "x".repeat(513) }), 413]] as const)("bounds invalid bodies", async (body, status) => {
    expect((await POST(request(body), undefined)).status).toBe(status)
    expect(store.issueAttendanceBranchQr).not.toHaveBeenCalled()
  })
  it("marks even directory responses private and passes only the authenticated reviewer", async () => {
    const response = await GET(request(), undefined)
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("private, no-store")
    expect(store.readAttendanceQrDirectory).toHaveBeenCalledWith({ organizationId: "qr-fixture", userId: "qr-admin", principalType: "session" })
  })
  it("returns fresh access refusal without exposing private error details", async () => {
    vi.mocked(store.issueAttendanceBranchQr).mockRejectedValueOnce(new AttendanceRequestError("MTM_ATTENDANCE_QR_BRANCH_UNAVAILABLE", 404))
    expect((await POST(request("{}"), undefined)).status).toBe(404)
    vi.mocked(store.issueAttendanceBranchQr).mockRejectedValueOnce(new Error("private DB payload"))
    const response = await POST(request("{}"), undefined)
    expect(response.status).toBe(500); expect(await response.text()).not.toContain("private DB payload")
  })
})
