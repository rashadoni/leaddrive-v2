import { randomUUID } from "node:crypto"
import { NextRequest } from "next/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/prisma", async () => ({ prisma: (await import("./mocks/mtm-prisma")).makeMtmPrismaMock() }))
vi.mock("@/lib/mobile-auth", async () => (await import("./mocks/mobile-auth")).makeMobileAuthMock())
import { prisma } from "@/lib/prisma"
import { resolveMobileAuth } from "@/lib/mobile-auth"
import { AttendanceRequestInputSchema, AttendanceRequestDetailsSchema } from "@/lib/mtm/attendance-request-contract"
import { submitAttendanceRequest } from "@/lib/mtm/attendance-request-store"
import { workforceWorkdayCorrectionFacts } from "@/lib/workforce/workday-correction-facts"
import { POST } from "@/app/api/v2/mtm/mobile/route-field/attendance/requests/route"
import { getRlsContext } from "@/lib/rls-context"

const self = { organizationId: "correction-submit-fixture-org", agentId: "correction-submit-fixture-agent", role: "AGENT" }
const at = (clock: string) => new Date(`2026-10-12T${clock}:00.000Z`)
function input() { return { clientRequestId: randomUUID(), kind: "TIME_CORRECTION", unit: "HOURS", startDate: "2026-10-12", endDate: "2026-10-12", startTime: "09:00", endTime: "18:00", reason: "Fixture employee forgot the finish" } }
const request = (body: unknown) => new NextRequest("http://localhost/api/v2/mtm/mobile/route-field/attendance/requests", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
const post = (body: unknown = input()) => POST(request(body))
function workday() { return { id: "source-workday", workDate: at("00:00"), status: "PAUSED", startedAt: at("05:21"), pausedAt: at("12:00"), completedAt: null as Date | null, totalPausedSeconds: 1800 } }
const saved = () => vi.mocked(prisma.mtmHrmRequest.create).mock.calls.at(-1)![0].data
beforeEach(() => {
  vi.resetAllMocks(); vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-10-13T15:00:00Z"))
  vi.mocked(resolveMobileAuth).mockResolvedValue({ orgId: self.organizationId, agentId: self.agentId, role: "AGENT", tenantCapabilities: { routeField: true, workforceHrm: false, personnel: true } } as never)
  vi.mocked(prisma.$transaction).mockImplementation((async (callback: (tx: typeof prisma) => unknown) => callback(prisma)) as never)
  vi.mocked(prisma.$queryRaw).mockResolvedValue([])
  vi.mocked(prisma.mtmSetting.findMany).mockResolvedValue([{ key: "attendanceEnabled", value: true }, { key: "timezone", value: "Asia/Baku" }] as never)
  vi.mocked(prisma.mtmSetting.findUnique).mockResolvedValue(null)
  vi.mocked(prisma.mtmAgent.findMany).mockResolvedValue([])
  vi.mocked(prisma.user.findMany).mockResolvedValue([])
  vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ id: self.agentId } as never)
  vi.mocked(prisma.mtmAgentWorkday.findFirst).mockResolvedValue(null)
  vi.mocked(prisma.mtmHrmRequest.findFirst).mockResolvedValue(null)
  vi.mocked(prisma.mtmHrmRequest.findMany).mockResolvedValue([])
  vi.mocked(prisma.mtmHrmRequest.create).mockImplementation((async ({ data }: { data: Record<string, unknown> }) => ({ ...data, status: "PENDING", updatedAt: new Date(), decisionNote: null, decidedAt: null, cancelledAt: null })) as never)
})
afterEach(() => vi.useRealTimers())

describe("employee TIME_CORRECTION submission uses a complete proposed interval and server-owned source snapshot", () => {
  it("stores an explicit missing-day basis and both UTC clocks without creating workday/events", async () => {
    const result = await post()
    expect(result.status).toBe(201)
    const body = await result.json()
    expect(body.data.request.details).toMatchObject({ kind: "TIME_CORRECTION", correctionBasis: { kind: "MISSING", workDate: "2026-10-12" }, dayKind: { key: "WORKED" } })
    expect(body.data.request.details).not.toHaveProperty("submissionHash")
    expect(saved()).toMatchObject({ organizationId: self.organizationId, agentId: self.agentId, type: "TIME_CORRECTION", correctionWorkdayId: null,
      requestedStartAt: at("05:00"), requestedEndAt: at("14:00") })
    expect(prisma.mtmAgentWorkday.create).not.toHaveBeenCalled(); expect(prisma.mtmAgentWorkday.update).not.toHaveBeenCalled()
    expect(prisma.mtmAgentWorkdayEvent.create).not.toHaveBeenCalled(); expect(prisma.workforceTimeCorrection.create).not.toHaveBeenCalled()
    expect(prisma.mtmHrmRequest.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ organizationId: self.organizationId, agentId: self.agentId, status: "PENDING", type: "TIME_CORRECTION" }) }))
    expect(result.headers.get("cache-control")).toContain("no-store")
  })
  it("accepts an explicit next-date night interval while preserving the source workDate", async () => {
    const body = { ...input(), endDate: "2026-10-13", startTime: "22:00", endTime: "06:00" }
    expect((await post(body)).status).toBe(201)
    expect(saved()).toMatchObject({ startDate: at("00:00"), endDate: new Date("2026-10-13T00:00:00Z"),
      requestedStartAt: at("18:00"), requestedEndAt: new Date("2026-10-13T02:00:00Z"),
      attendanceDetails: { correctionBasis: { kind: "MISSING", workDate: "2026-10-12" } } })
    expect(prisma.mtmAgentWorkday.create).not.toHaveBeenCalled()
  })
  it("refuses an overnight proposal longer than 24 elapsed hours at the autumn clock change", async () => {
    vi.mocked(prisma.mtmSetting.findMany).mockResolvedValue([{ key: "attendanceEnabled", value: true }, { key: "timezone", value: "Europe/Berlin" }] as never)
    const body = { ...input(), startDate: "2025-10-25", endDate: "2025-10-26", startTime: "22:00", endTime: "22:00" }
    expect((await post(body)).status).toBe(400)
    expect(prisma.mtmHrmRequest.create).not.toHaveBeenCalled()
  })
  it("freezes the real source day facts and binds only the authenticated employee under RLS", async () => {
    const source = workday()
    vi.mocked(prisma.mtmAgentWorkday.findFirst).mockImplementation((async (query: unknown) => {
      expect(getRlsContext()).toMatchObject({ orgId: self.organizationId })
      expect(query).toMatchObject({ where: { organizationId: self.organizationId, agentId: self.agentId, workDate: at("00:00") } })
      return source
    }) as never)
    expect((await post()).status).toBe(201)
    const details = AttendanceRequestDetailsSchema.parse(saved().attendanceDetails)
    expect(details.correctionBasis).toEqual({ kind: "WORKDAY", facts: workforceWorkdayCorrectionFacts(source) })
    expect(saved().correctionWorkdayId).toBe(source.id)
    expect(details.dayKind.key).toBe("WORKED")
    source.startedAt = at("06:00")
    expect(details.correctionBasis).toMatchObject({ facts: { startedAt: at("05:21").toISOString(), totalPausedSeconds: 1800 } })
    const locks = vi.mocked(prisma.$executeRaw).mock.calls.map((call: unknown[]) => call.flat().join(" "))
    const workdayLock = locks.findIndex((sql: string) => sql.includes("mtm-workday:"))
    const requestLock = locks.findIndex((sql: string) => sql.includes("mtm-attendance-requests:"))
    expect(workdayLock).toBeGreaterThanOrEqual(0); expect(requestLock).toBeGreaterThan(workdayLock)
  })
  it.each([
    { startTime: undefined }, { endTime: undefined }, { startTime: "18:00", endTime: "09:00" }, { endTime: "09:00" },
    { endDate: "2026-10-13" }, { unit: "DAYS", startTime: undefined, endTime: undefined },
    { correctionWorkdayId: "another-day" }, { correctionBasis: { kind: "MISSING", workDate: "2026-10-12" } },
    { agentId: "another-agent" }, { requestedStartAt: "2026-10-12T00:00:00Z" },
  ])("rejects incomplete/injected proposal %j before finding a source day", async (change) => {
    const value = { ...input(), ...change }
    expect(AttendanceRequestInputSchema.safeParse(value).success).toBe(false)
    expect((await post(value)).status).toBe(400)
    expect(prisma.mtmAgentWorkday.findFirst).not.toHaveBeenCalled(); expect(prisma.mtmHrmRequest.create).not.toHaveBeenCalled()
  })
  it.each(["future", "unchanged", "pending-overlap", "DST-gap", "DST-fold"])("refuses %s proposals without a request or correction", async (kind) => {
    const value = input()
    if (kind === "future") { value.startDate = "2026-10-14"; value.endDate = value.startDate }
    if (kind === "unchanged") vi.mocked(prisma.mtmAgentWorkday.findFirst).mockResolvedValue({ ...workday(), status: "COMPLETED", startedAt: at("05:00"), completedAt: at("14:00"), pausedAt: null } as never)
    if (kind === "pending-overlap") vi.mocked(prisma.mtmHrmRequest.findFirst).mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "pending-correction" } as never)
    if (kind.startsWith("DST")) {
      vi.mocked(prisma.mtmSetting.findMany).mockResolvedValue([{ key: "attendanceEnabled", value: true }, { key: "timezone", value: "Europe/Berlin" }] as never)
      value.startDate = kind === "DST-gap" ? "2026-03-29" : "2025-10-26"; value.endDate = value.startDate; value.startTime = "02:30"; value.endTime = "04:00"
    }
    const result = await post(value)
    expect([400, 409]).toContain(result.status)
    expect(prisma.mtmHrmRequest.create).not.toHaveBeenCalled(); expect(prisma.workforceTimeCorrection.create).not.toHaveBeenCalled()
  })
  it("retries the original proposal and frozen basis after the live workday changes, but refuses changed payload", async () => {
    const value = input()
    vi.mocked(prisma.mtmAgentWorkday.findFirst).mockResolvedValue(workday() as never)
    const first = await submitAttendanceRequest(self, value)
    const data = saved()
    vi.mocked(prisma.mtmHrmRequest.findFirst).mockResolvedValue({ ...data, status: "PENDING", updatedAt: new Date(), decidedAt: null, cancelledAt: null, decisionNote: null } as never)
    vi.mocked(prisma.mtmAgentWorkday.findFirst).mockClear().mockResolvedValue({ ...workday(), startedAt: at("06:00") } as never)
    const repeated = await submitAttendanceRequest(self, value)
    expect(repeated).toMatchObject({ idempotent: true })
    expect(repeated.request.details.correctionBasis).toEqual(first.request.details.correctionBasis)
    expect(prisma.mtmAgentWorkday.findFirst).not.toHaveBeenCalled()
    await expect(submitAttendanceRequest(self, { ...value, startTime: "09:10" })).rejects.toHaveProperty("code", "MTM_ATTENDANCE_REQUEST_IDEMPOTENCY_MISMATCH")
    expect(prisma.mtmHrmRequest.create).toHaveBeenCalledTimes(1); expect(prisma.mtmAuditLog.create).toHaveBeenCalledTimes(1)
  })
  it("allows a later distinct correction revision without treating an approved correction as pending overlap", async () => {
    vi.mocked(prisma.mtmAgentWorkday.findFirst).mockResolvedValue({ ...workday(), status: "COMPLETED", pausedAt: null, completedAt: at("13:30") } as never)
    vi.mocked(prisma.mtmHrmRequest.findFirst).mockImplementation((async ({ where }: { where: Record<string, unknown> }) => {
      if (where.status) expect(where.status).toBe("PENDING")
      return null
    }) as never)
    expect((await post()).status).toBe(201)
    expect(prisma.mtmHrmRequest.findMany).not.toHaveBeenCalled() // Correction revisions do not overlap absence/leave windows.
    expect(saved()).toHaveProperty("requestedEndAt", at("14:00"))
  })
})
