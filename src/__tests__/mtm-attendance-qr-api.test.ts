import { NextRequest, NextResponse } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"
vi.mock("@/lib/prisma", async () => ({ prisma: (await import("./mocks/mtm-prisma")).makeMtmPrismaMock() }))
vi.mock("@/lib/api-auth", () => ({ requireAuth: vi.fn(), getOrgId: vi.fn(), getSession: vi.fn().mockResolvedValue(null), isAuthError: (value: unknown) => value instanceof Response }))
vi.mock("@/lib/mtm/route-permissions", async original => ({ ...await original<typeof import("@/lib/mtm/route-permissions")>(), resolveMtmRouteActor: vi.fn() }))
vi.mock("@/lib/tenant-capability-access", async original => ({ ...await original<typeof import("@/lib/tenant-capability-access")>(), requireTenantCapabilityAccessResponse: vi.fn().mockResolvedValue(null) }))
vi.mock("@/lib/mtm/attendance-qr-store", () => ({ readAttendanceQrDirectory: vi.fn() }))
vi.mock("@/lib/mtm/attendance-branch-screen-store", () => ({ readAttendanceBranchScreens: vi.fn(), startAttendanceBranchScreenPairing: vi.fn(), revokeAttendanceBranchScreen: vi.fn() }))
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/lib/api-auth"
import { resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import { AttendanceRequestError } from "@/lib/mtm/attendance-request-contract"
import * as store from "@/lib/mtm/attendance-qr-store"
import * as screens from "@/lib/mtm/attendance-branch-screen-store"
import { GET, POST } from "@/app/api/v1/mtm/attendance/branch-qr/route"
import { GET as LIST, POST as PAIR } from "@/app/api/v1/mtm/attendance/branch-screens/route"
import { POST as REVOKE } from "@/app/api/v1/mtm/attendance/branch-screens/[id]/revoke/route"
const request = (body?: string, path = "branch-qr") => new NextRequest(`http://localhost/api/v1/mtm/attendance/${path}`, body === undefined ? {} : { method: "POST", body, headers: { "content-type": "application/json" } })
const reviewer = { organizationId: "qr-fixture", userId: "qr-admin", principalType: "session" }
beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireAuth).mockResolvedValue({ orgId: "qr-fixture", userId: "qr-admin", role: "admin", principalType: "session" } as never)
  vi.mocked(resolveMtmRouteActor).mockResolvedValue({ role: "ADMIN", agentId: null, scopedAgentIds: null })
  vi.mocked(prisma.mtmSetting.findMany).mockResolvedValue([{ key: "attendanceEnabled", value: true }] as never)
  vi.mocked(store.readAttendanceQrDirectory).mockResolvedValue({ enabled: false, canConfigure: true, branches: [] })
  vi.mocked(screens.readAttendanceBranchScreens).mockResolvedValue({ enabled: true, canConfigure: true, branches: [] })
  vi.mocked(screens.startAttendanceBranchScreenPairing).mockResolvedValue({ branch: { id: "b", name: "B" }, code: "ABCD-EFGH", expiresAt: "2026-10-29T10:10:00Z" })
  vi.mocked(screens.revokeAttendanceBranchScreen).mockResolvedValue({ revoked: true })
})
describe("branch QR HTTP boundaries", () => {
  it("never gives a signed-in browser a code, not even an administrator's (owner, 2026-10-29)", async () => {
    const response = await POST(request(JSON.stringify({ branchId: "10000000-0000-4000-8000-000000000001" })), undefined)
    expect(response.status).toBe(410)
    expect(await response.json()).toMatchObject({ code: "MTM_ATTENDANCE_QR_SCREEN_ONLY" })
    expect(JSON.stringify(await (await POST(request("{}"), undefined)).json())).not.toMatch(/dataUrl|mtmq1/)
  })
  it("does not read anything when attendance is off", async () => {
    vi.mocked(prisma.mtmSetting.findMany).mockResolvedValue([])
    expect((await GET(request(), undefined)).status).toBe(404)
    expect((await LIST(request(undefined, "branch-screens"), undefined)).status).toBe(404)
    expect((await PAIR(request("{}", "branch-screens"), undefined)).status).toBe(404)
    expect(store.readAttendanceQrDirectory).not.toHaveBeenCalled(); expect(screens.startAttendanceBranchScreenPairing).not.toHaveBeenCalled()
  })
  it.each(["api_key", undefined])("denies %s principals before pairing or revoking", async principalType => {
    vi.mocked(requireAuth).mockResolvedValue({ orgId: "qr-fixture", userId: "qr-admin", role: "admin", principalType } as never)
    expect((await GET(request(), undefined)).status).toBe(403)
    expect((await LIST(request(undefined, "branch-screens"), undefined)).status).toBe(403)
    expect((await PAIR(request("{}", "branch-screens"), undefined)).status).toBe(403)
    expect((await REVOKE(request("", "branch-screens/x/revoke"), { params: Promise.resolve({ id: "x" }) })).status).toBe(403)
    expect(screens.startAttendanceBranchScreenPairing).not.toHaveBeenCalled(); expect(screens.revokeAttendanceBranchScreen).not.toHaveBeenCalled()
  })
  it("refuses read-only HR at the RBAC boundary", async () => {
    // requireAuth is the mocked RBAC boundary; the store's administrator check
    // is exercised by the PostgreSQL gate.
    vi.mocked(requireAuth).mockResolvedValue(new NextResponse(null, { status: 403 }))
    expect((await PAIR(request("{}", "branch-screens"), undefined)).status).toBe(403)
    expect(requireAuth).toHaveBeenCalledWith(expect.any(NextRequest), "mtm", "write", { deferLegacyModuleGate: "mtm" })
    expect(screens.startAttendanceBranchScreenPairing).not.toHaveBeenCalled()
  })
  it.each([["{", 400], [JSON.stringify({ padding: "x".repeat(513) }), 413]] as const)("bounds invalid pairing bodies", async (body, status) => {
    expect((await PAIR(request(body, "branch-screens"), undefined)).status).toBe(status)
    expect(screens.startAttendanceBranchScreenPairing).not.toHaveBeenCalled()
  })
  it("answers privately and passes only the authenticated reviewer", async () => {
    const listed = await LIST(request(undefined, "branch-screens"), undefined)
    expect(listed.status).toBe(200); expect(listed.headers.get("cache-control")).toBe("private, no-store")
    expect(screens.readAttendanceBranchScreens).toHaveBeenCalledWith(reviewer)
    const paired = await PAIR(request(JSON.stringify({ branchId: "b" }), "branch-screens"), undefined)
    expect(paired.headers.get("cache-control")).toBe("private, no-store")
    expect(screens.startAttendanceBranchScreenPairing).toHaveBeenCalledWith(reviewer, { branchId: "b" })
    expect((await REVOKE(request("", "branch-screens/s/revoke"), { params: Promise.resolve({ id: "s" }) })).status).toBe(200)
    expect(screens.revokeAttendanceBranchScreen).toHaveBeenCalledWith(reviewer, "s")
  })
  it("returns refusals without private error details", async () => {
    vi.mocked(screens.startAttendanceBranchScreenPairing).mockRejectedValueOnce(new AttendanceRequestError("MTM_ATTENDANCE_SCREEN_BRANCH_UNAVAILABLE", 404))
    expect((await PAIR(request("{}", "branch-screens"), undefined)).status).toBe(404)
    vi.mocked(screens.startAttendanceBranchScreenPairing).mockRejectedValueOnce(new Error("private DB payload"))
    const response = await PAIR(request("{}", "branch-screens"), undefined)
    expect(response.status).toBe(500); expect(await response.text()).not.toContain("private DB payload")
  })
})
