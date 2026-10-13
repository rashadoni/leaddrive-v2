import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

/**
 * POST …/route-field/workday-return — who may ask, what is asked of the body,
 * and how each answer of the service reaches the phone. What returning a day
 * does to the database is proved on a real Postgres
 * (mtm-workday-return-postgres.test.ts); here the service is replaced.
 */

vi.mock("@/lib/prisma", async () => {
  const { makeMtmPrismaMock } = await import("./mocks/mtm-prisma")
  return { prisma: makeMtmPrismaMock() }
})
vi.mock("@/lib/mobile-auth", async () => {
  const { makeMobileAuthMock } = await import("./mocks/mobile-auth")
  return makeMobileAuthMock()
})
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: vi.fn() }))
vi.mock("@/lib/mtm-audit", () => ({ writeMtmAudit: vi.fn(async () => undefined) }))
vi.mock("@/lib/mtm/workday-return", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/mtm/workday-return")>(),
  returnOwnMtmWorkday: vi.fn(),
}))

import { POST } from "@/app/api/v2/mtm/mobile/route-field/workday-return/route"
import { resolveMobileAuth } from "@/lib/mobile-auth"
import { checkRateLimit } from "@/lib/rate-limit"
import { writeMtmAudit } from "@/lib/mtm-audit"
import { returnOwnMtmWorkday } from "@/lib/mtm/workday-return"
import { isMtmApiPath } from "@/lib/mtm/mobile-api-path"
import { prisma } from "@/lib/prisma"
import { officeAttendanceMobilePath } from "@/lib/mtm/attendance-employee-contract"
import { AttendanceRequestError } from "@/lib/mtm/attendance-request-contract"

const ORG = "org-1"
const AGENT = "agent-1"
const WORKDAY = { id: "wd-1", workDate: "2026-10-13", status: "STARTED", startedAt: "2026-10-13T06:21:58.000Z", pausedAt: null, completedAt: null, totalPausedSeconds: 3836 }
const BODY = { operationId: "tap-00000001", workdayId: "wd-1" }

function signIn(overrides: Record<string, unknown> = {}) {
  vi.mocked(resolveMobileAuth).mockResolvedValue({
    orgId: ORG, agentId: AGENT, userId: "", email: "agent@example.test", name: "Agent", role: "AGENT",
    tenantCapabilities: { routeField: true, workforceHrm: false },
    ...overrides,
  } as never)
}

async function ask(body: unknown = BODY) {
  const response = await POST(new NextRequest("http://localhost:3000/api/v2/mtm/mobile/route-field/workday-return", {
    method: "POST",
    headers: { Authorization: "Bearer valid-token", "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  }), { params: Promise.resolve({}) } as never)
  return { status: response.status, body: await response.json(), cache: response.headers.get("Cache-Control"), retryAfter: response.headers.get("Retry-After") }
}

beforeEach(() => {
  vi.clearAllMocks()
  signIn()
  vi.mocked(checkRateLimit).mockReturnValue(true)
  vi.mocked(returnOwnMtmWorkday).mockResolvedValue({ kind: "success", workday: WORKDAY as never, idempotent: false })
})

describe("POST /api/v2/mtm/mobile/route-field/workday-return", () => {
  it("allows only the exact office return route and rechecks enrollment for that own action", async () => {
    const path="/api/v2/mtm/mobile/route-field/workday-return"
    expect(officeAttendanceMobilePath("POST",path)).toBe(true)
    expect(officeAttendanceMobilePath("GET",path)).toBe(false)
    expect(officeAttendanceMobilePath("POST",`${path}/other`)).toBe(false)
    signIn({role:"EMPLOYEE"})
    vi.mocked(prisma.mtmSetting.findMany).mockResolvedValue([{key:"attendanceEnabled",value:true}] as never)
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({id:AGENT,role:"EMPLOYEE",attendanceParticipant:true} as never)
    expect(await ask()).toMatchObject({status:200})
    expect(returnOwnMtmWorkday).toHaveBeenCalledWith(expect.objectContaining({agentId:AGENT,attendanceRole:"EMPLOYEE"}))
  })

  it.each(["feature","enrollment","capability"])("does not return an office day after %s is withdrawn", async reason=>{
    signIn({role:"EMPLOYEE",...(reason==="capability"?{tenantCapabilities:{routeField:false}}:{})})
    vi.mocked(prisma.mtmSetting.findMany).mockResolvedValue([{key:"attendanceEnabled",value:reason!=="feature"}] as never)
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({id:AGENT,role:"EMPLOYEE",attendanceParticipant:reason!=="enrollment"} as never)
    expect(await ask()).toMatchObject({status:403})
    expect(returnOwnMtmWorkday).not.toHaveBeenCalled()
  })

  it("returns a fresh transaction refusal without recording a successful return audit",async()=>{
    signIn({role:"EMPLOYEE"})
    vi.mocked(prisma.mtmSetting.findMany).mockResolvedValue([{key:"attendanceEnabled",value:true}] as never)
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({id:AGENT,role:"EMPLOYEE",attendanceParticipant:true} as never)
    vi.mocked(returnOwnMtmWorkday).mockRejectedValue(new AttendanceRequestError("MTM_ATTENDANCE_SELF_REQUIRED",403))
    expect(await ask()).toMatchObject({status:403})
    expect(writeMtmAudit).not.toHaveBeenCalled()
  })
  it("is a path the edge lets the app reach — and not under the prefix of the withdrawn HRM", () => {
    expect(isMtmApiPath("/api/v2/mtm/mobile/route-field/workday-return")).toBe(true)
    expect(isMtmApiPath("/api/v2/mtm/mobile/route-field/workday-returns")).toBe(false)
    expect(isMtmApiPath("/api/v2/mtm/mobile/route-field/workday-return/other")).toBe(false)
  })

  it("returns the caller to their own day and says what the day is now", async () => {
    const answer = await ask()
    expect(answer).toMatchObject({ status: 200, cache: "no-store", body: { success: true, idempotent: false, data: { workday: WORKDAY } } })
    // The employee is the authenticated one; the body cannot name another.
    expect(returnOwnMtmWorkday).toHaveBeenCalledWith({ organizationId: ORG, agentId: AGENT, workdayId: "wd-1", operationId: "tap-00000001", installationId: null })
    expect(writeMtmAudit).toHaveBeenCalledWith(expect.objectContaining({ organizationId: ORG, agentId: AGENT, action: "WORKDAY_RETURN", entity: "workday", entityId: "wd-1" }))
  })

  it.each(["MTM_ATTENDANCE_INSTALLATION_APP_REQUIRED", "MTM_ATTENDANCE_INSTALLATION_APPROVAL_REQUIRED"])("returns an uncommitted installation refusal: %s", async code => {
    vi.mocked(returnOwnMtmWorkday).mockRejectedValue(new AttendanceRequestError(code, 422))
    expect(await ask()).toMatchObject({ status: 409, body: { code, data: { committed: false } } })
    expect(writeMtmAudit).not.toHaveBeenCalled()
  })

  it("acknowledges a repeated sending without a second line in the audit journal", async () => {
    vi.mocked(returnOwnMtmWorkday).mockResolvedValue({ kind: "success", workday: WORKDAY as never, idempotent: true })
    expect(await ask()).toMatchObject({ status: 200, body: { success: true, idempotent: true } })
    expect(writeMtmAudit).not.toHaveBeenCalled()
  })

  it("answers wherever the app may start and finish a day, whatever modules the tenant holds", async () => {
    // START and FINISH travel through sync/push, which asks for no module; a
    // v2 handler that declares nothing is refused by the wrapper for everyone.
    signIn({ tenantCapabilities: { routeField: false, workforceHrm: false } })
    expect(await ask()).toMatchObject({ status: 200, body: { success: true } })
  })

  it.each([
    ["a principal with no employee card", { agentId: null }],
    ["a role that does not move a workday in the app", { role: "VIEWER" }],
  ])("refuses %s before anything is read", async (_label, overrides) => {
    signIn(overrides)
    expect(await ask()).toMatchObject({ status: 403, body: { code: "MTM_WORKDAY_RETURN_FORBIDDEN" } })
    expect(returnOwnMtmWorkday).not.toHaveBeenCalled()
  })

  it.each([
    ["no body", "not json"],
    ["no operation id", { workdayId: "wd-1" }],
    ["an operation id too short to be one", { operationId: "tap", workdayId: "wd-1" }],
    ["no workday", { operationId: "tap-00000001" }],
    ["somebody else named in the body", { ...BODY, agentId: "agent-2" }],
    ["a time of its own", { ...BODY, occurredAt: "2026-10-13T05:00:00.000Z" }],
  ])("refuses a request with %s", async (_label, body) => {
    expect(await ask(body)).toMatchObject({ status: 400, body: { code: "MTM_WORKDAY_RETURN_INVALID" } })
    expect(returnOwnMtmWorkday).not.toHaveBeenCalled()
  })

  it("tells the phone why a day cannot be returned to, with the day as it stands", async () => {
    const closed = { ...WORKDAY, status: "COMPLETED", completedAt: "2026-10-12T06:56:04.000Z", workDate: "2026-10-12" }
    vi.mocked(returnOwnMtmWorkday).mockResolvedValue({ kind: "conflict", code: "MTM_WORKDAY_RETURN_NOT_TODAY", workday: closed as never })
    expect(await ask()).toMatchObject({ status: 409, cache: "no-store", body: { code: "MTM_WORKDAY_RETURN_NOT_TODAY", data: { workday: closed } } })
    expect(writeMtmAudit).not.toHaveBeenCalled()

    vi.mocked(returnOwnMtmWorkday).mockResolvedValue({ kind: "not_found" })
    expect(await ask()).toMatchObject({ status: 404, body: { code: "MTM_WORKDAY_NOT_FOUND" } })
  })

  it("stops a loop of taps", async () => {
    vi.mocked(checkRateLimit).mockReturnValue(false)
    expect(await ask()).toMatchObject({ status: 429, retryAfter: "600", body: { code: "MTM_WORKDAY_RETURN_RATE_LIMITED" } })
    expect(returnOwnMtmWorkday).not.toHaveBeenCalled()
  })
})
