import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"
const fixture = vi.hoisted(() => ({ auth: { orgId: "phone-org", userId: "admin", principalType: "session" as string | undefined } }))
vi.mock("@/lib/mtm/with-attendance-auth", () => ({ withMtmAttendanceAuth: (_action: string, handler: (req: Request, auth: typeof fixture.auth) => Promise<Response>) => (req: Request) => handler(req, fixture.auth) }))
vi.mock("@/lib/prisma", async () => ({ prisma: (await import("./mocks/mtm-prisma")).makeMtmPrismaMock() }))
vi.mock("@/lib/mtm/attendance-employee-store", () => ({ requireAttendanceEmployeeAdmin: vi.fn() }))
vi.mock("@/lib/mtm/mobile-login-phone", () => ({ findPhoneOwner: vi.fn() }))
import { prisma } from "@/lib/prisma"
import { requireAttendanceEmployeeAdmin } from "@/lib/mtm/attendance-employee-store"
import { findPhoneOwner } from "@/lib/mtm/mobile-login-phone"
import { AttendanceRequestError } from "@/lib/mtm/attendance-request-contract"
import { POST } from "@/app/api/v1/mtm/attendance/employees/phone-match/route"
const phone = "+994550009901"
const post = (body = JSON.stringify({ phone })) => POST(new NextRequest("http://localhost/api/v1/mtm/attendance/employees/phone-match", { method: "POST", body }), {})
beforeEach(() => {
  vi.resetAllMocks(); fixture.auth.principalType = "session"
  vi.mocked(prisma.$transaction).mockImplementation((async (callback: (tx: typeof prisma) => unknown) => callback(prisma)) as never)
  vi.mocked(requireAttendanceEmployeeAdmin).mockResolvedValue("Asia/Baku")
  vi.mocked(findPhoneOwner).mockResolvedValue({ kind: "found", agentId: "existing-card", sendTo: phone })
  vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ id: "existing-card", name: "Fictional person", role: "EMPLOYEE", attendanceParticipant: true, attendanceIncludedFrom: new Date(), auditLogs: [], passwordHash: "must-not-escape", phone } as never)
})
describe("administrator phone conflict explanation", () => {
  it("returns only the existing card projection with private no-store headers", async () => {
    const response = await post()
    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    expect(await response.json()).toEqual({ success: true, data: { kind: "attendance", agentId: "existing-card", name: "Fictional person", enrolled: false } })
    expect(requireAttendanceEmployeeAdmin).toHaveBeenCalledWith(prisma, { organizationId: "phone-org", userId: "admin", principalType: "session" })
    expect(findPhoneOwner).toHaveBeenCalledWith(prisma, "phone-org", phone)
    expect(prisma.mtmAgent.create).not.toHaveBeenCalled(); expect(prisma.mtmAgent.update).not.toHaveBeenCalled()
    expect(prisma.user.update).not.toHaveBeenCalled()
  })
  it.each(["api_key", undefined])("refuses non-session principal %s before looking up a phone", async principal => {
    fixture.auth.principalType = principal
    expect((await post()).status).toBe(403)
    expect(findPhoneOwner).not.toHaveBeenCalled()
  })
  it("refuses revoked administrator access before looking up a phone", async () => {
    vi.mocked(requireAttendanceEmployeeAdmin).mockRejectedValue(new AttendanceRequestError("MTM_ATTENDANCE_EMPLOYEE_ADMIN_REQUIRED", 403))
    expect((await post()).status).toBe(403)
    expect(findPhoneOwner).not.toHaveBeenCalled()
  })
  it.each([["{", 400], [JSON.stringify({ phone, organizationId: "foreign" }), 400], [JSON.stringify({ phone: "123" }), 400], [JSON.stringify({ phone: "1".repeat(1025) }), 413]])("refuses malformed or oversized input", async (body, status) => {
    expect((await post(body as string)).status).toBe(status)
    expect(findPhoneOwner).not.toHaveBeenCalled()
  })
  it("does not expose candidate IDs for an ambiguous match", async () => {
    vi.mocked(findPhoneOwner).mockResolvedValue({ kind: "ambiguous", agentIds: ["private-a", "private-b"] })
    expect(await (await post()).json()).toEqual({ success: true, data: { kind: "ambiguous" } })
    expect(prisma.mtmAgent.findFirst).not.toHaveBeenCalled()
  })
  it("does not expose internal errors or the requested phone", async () => {
    vi.mocked(findPhoneOwner).mockRejectedValue(new Error(`Private database failure ${phone}`))
    const response = await post()
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: "MTM_ATTENDANCE_REQUEST_FAILED", code: "MTM_ATTENDANCE_REQUEST_FAILED" })
  })
})
