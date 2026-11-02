import { randomUUID } from "node:crypto"
import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/prisma", async () => ({ prisma: (await import("./mocks/mtm-prisma")).makeMtmPrismaMock() }))
vi.mock("@/lib/mobile-auth", async () => (await import("./mocks/mobile-auth")).makeMobileAuthMock())
import { prisma } from "@/lib/prisma"
import { resolveMobileAuth } from "@/lib/mobile-auth"
import { GET, POST } from "@/app/api/v2/mtm/mobile/route-field/attendance/requests/route"
import { DELETE } from "@/app/api/v2/mtm/mobile/route-field/attendance/requests/[id]/route"
import { GET as documentGet } from "@/app/api/v2/mtm/mobile/route-field/attendance/attachments/[id]/route"
import { submitAttendanceRequest } from "@/lib/mtm/attendance-request-store"
import { getRlsContext } from "@/lib/rls-context"

// The owner is an office employee HR keeps; a field agent has no own requests (owner, 2026-10-20).
const self = { organizationId: "request-fixture-org", agentId: "request-fixture-agent", role: "EMPLOYEE" }
const input = () => ({ clientRequestId: randomUUID(), kind: "HOURLY_ABSENCE", unit: "HOURS", startDate: "2026-11-02", endDate: "2026-11-02", startTime: "09:00", endTime: "11:00", reason: "Fixture request" })
const req = (body: unknown) => new NextRequest("http://localhost/api/v2/mtm/mobile/route-field/attendance/requests", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
function authenticate(role = "EMPLOYEE", allowed = true) {
  vi.mocked(resolveMobileAuth).mockResolvedValue({ orgId: self.organizationId, agentId: self.agentId, role, tenantCapabilities: { routeField: allowed, workforceHrm: false, personnel: allowed } } as never)
}
beforeEach(() => {
  vi.resetAllMocks()
  authenticate()
  vi.mocked(prisma.$transaction).mockImplementation((async (callback: (tx: typeof prisma) => unknown) => callback(prisma)) as never)
  vi.mocked(prisma.mtmSetting.findMany).mockResolvedValue([{ key: "attendanceEnabled", value: true }, { key: "timezone", value: "Asia/Baku" }] as never)
  vi.mocked(prisma.mtmSetting.findUnique).mockResolvedValue(null)
  vi.mocked(prisma.mtmAgent.findMany).mockResolvedValue([])
  vi.mocked(prisma.user.findMany).mockResolvedValue([])
  vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ id: self.agentId, role: "EMPLOYEE", attendanceParticipant: true, attendanceExcluded: false } as never)
  vi.mocked(prisma.mtmHrmRequest.findFirst).mockResolvedValue(null)
  vi.mocked(prisma.mtmHrmRequest.findMany).mockResolvedValue([])
  vi.mocked(prisma.mtmAttendanceAttachment.count).mockResolvedValue(0)
  vi.mocked(prisma.mtmHrmRequest.create).mockImplementation((async ({ data }: { data: Record<string, unknown> }) => ({ ...data, status: "PENDING", updatedAt: new Date(), decisionNote: null, decidedAt: null, cancelledAt: null })) as never)
})
describe("new MTM attendance own-request API", () => {
  it("creates only the authenticated owner's pending request under their RLS context, never a workday", async () => {
    vi.mocked(prisma.mtmHrmRequest.create).mockImplementation((async ({ data }: { data: Record<string, unknown> }) => {
      expect(getRlsContext()).toMatchObject({ orgId: self.organizationId })
      expect(data).toMatchObject({ organizationId: self.organizationId, agentId: self.agentId })
      return { ...data, status: "PENDING", updatedAt: new Date(), decisionNote: null, decidedAt: null, cancelledAt: null }
    }) as never)
    const response = await POST(req(input()))
    expect(response.status).toBe(201)
    const body = await response.json()
    expect(body.data.request.details).toMatchObject({ kind: "HOURLY_ABSENCE", startTime: "09:00", endTime: "11:00" })
    expect(body.data.request.details).not.toHaveProperty("submissionHash")
    expect(response.headers.get("cache-control")).toContain("no-store")
    expect(prisma.mtmAgentWorkday.update).not.toHaveBeenCalled()
    expect(prisma.mtmAuditLog.create).toHaveBeenCalledTimes(1)
  })
  it.each(["off", "capability", "manager", "field-agent", "inactive", "foreign-input"])("refuses %s before any request or attachment is written", async (kind) => {
    if (kind === "off") vi.mocked(prisma.mtmSetting.findMany).mockResolvedValue([])
    if (kind === "capability") authenticate("EMPLOYEE", false)
    // A manager HR has not enrolled.
    if (kind === "manager") { authenticate("MANAGER"); vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ id: self.agentId, role: "MANAGER", attendanceParticipant: false, attendanceExcluded: false } as never) }
    if (kind === "field-agent") authenticate("AGENT")
    if (kind === "inactive") vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue(null)
    const response = await POST(req({ ...input(), ...(kind === "foreign-input" ? { agentId: "someone-else" } : {}) }))
    expect([400, 403, 404]).toContain(response.status)
    expect(prisma.mtmHrmRequest.create).not.toHaveBeenCalled()
    expect(prisma.mtmAttendanceAttachment.create).not.toHaveBeenCalled()
    expect(prisma.mtmAuditLog.create).not.toHaveBeenCalled()
  })
  it("replays the same UUID and rejects different details without a second audit", async () => {
    const value = input()
    await submitAttendanceRequest(self, value)
    const data = vi.mocked(prisma.mtmHrmRequest.create).mock.calls[0][0].data
    vi.mocked(prisma.mtmHrmRequest.findFirst).mockResolvedValue({ ...data, status: "PENDING", updatedAt: new Date(), submittedAt: data.submittedAt, decidedAt: null, cancelledAt: null, decisionNote: null } as never)
    expect(await submitAttendanceRequest(self, value)).toMatchObject({ idempotent: true })
    await expect(submitAttendanceRequest(self, { ...value, endTime: "12:00" })).rejects.toMatchObject({ code: "MTM_ATTENDANCE_REQUEST_IDEMPOTENCY_MISMATCH" })
    expect(prisma.mtmHrmRequest.create).toHaveBeenCalledTimes(1)
    expect(prisma.mtmAuditLog.create).toHaveBeenCalledTimes(1)
  })
  it("refuses an overlap with a retained whole-day request and a foreign/unbound photo", async () => {
    vi.mocked(prisma.mtmHrmRequest.findMany).mockResolvedValue([{ startDate: new Date("2026-11-02T00:00:00Z"), endDate: new Date("2026-11-02T00:00:00Z"), attendanceDetails: null }] as never)
    expect((await POST(req(input()))).status).toBe(409)
    expect((await POST(req({ ...input(), attachmentIds: [randomUUID()] }))).status).toBe(400)
    expect(prisma.mtmHrmRequest.create).not.toHaveBeenCalled()
  })
  it("lists only this owner's MTM requests and refuses another owner's cursor", async () => {
    expect((await GET(req(undefined))).status).toBe(200)
    expect(prisma.mtmHrmRequest.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ organizationId: self.organizationId, agentId: self.agentId, attendanceDetails: expect.any(Object) }) }))
    const response = await GET(new NextRequest(`http://localhost/api/v2/mtm/mobile/route-field/attendance/requests?cursor=${randomUUID()}`))
    expect(response.status).toBe(400)
  })
  it("does not cancel a foreign or already approved request", async () => {
    const id = randomUUID()
    expect((await DELETE(req(undefined), { params: Promise.resolve({ id }) })).status).toBe(404)
    vi.mocked(prisma.mtmHrmRequest.findFirst).mockResolvedValue({ status: "APPROVED" } as never)
    expect((await DELETE(req(undefined), { params: Promise.resolve({ id }) })).status).toBe(409)
    expect(prisma.mtmHrmRequest.updateMany).not.toHaveBeenCalled()
  })
  it("never looks up or reads a private photo while attendance is off", async () => {
    vi.mocked(prisma.mtmSetting.findMany).mockResolvedValue([])
    expect((await documentGet(req(undefined), { params: Promise.resolve({ id: randomUUID() }) })).status).toBe(404)
    expect(prisma.mtmAttendanceAttachment.findFirst).not.toHaveBeenCalled()
  })
})
