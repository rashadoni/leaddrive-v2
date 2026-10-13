import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Prisma } from "@prisma/client"
import { applyAttendanceTimeCorrectionInTransaction } from "@/lib/mtm/attendance-time-correction"
import { defaultAttendanceDayKinds } from "@/lib/mtm/attendance-day-kinds"
import { workforceWorkdayCorrectionFacts } from "@/lib/workforce/workday-correction-facts"

const at = (clock: string) => new Date(`2026-10-12T${clock}:00.000Z`)
const now = new Date("2026-10-13T12:00:00Z")
const input = { organizationId: "fixture-org", userId: "fixture-reviewer", requestId: "fixture-request", expectedVersion: at("14:30").toISOString(), decisionNote: null as string | null, now }
const workday = () => ({ id: "fixture-workday", workDate: at("00:00"), status: "STARTED", startedAt: at("05:00"), pausedAt: null as Date | null, completedAt: null as Date | null, totalPausedSeconds: 0 })
const request = () => ({ id: input.requestId, agentId: "fixture-agent", type: "TIME_CORRECTION", status: "PENDING", updatedAt: at("14:30"),
  startDate: at("00:00"), endDate: at("00:00"), correctionWorkdayId: workday().id as string | null,
  requestedStartAt: at("05:00") as Date | null, requestedEndAt: at("14:00") as Date | null,
  attendanceDetails: { version: 1, kind: "TIME_CORRECTION", unit: "HOURS", startTime: "09:00", endTime: "18:00", timezone: "Asia/Baku",
    dayKind: defaultAttendanceDayKinds(() => ({ az: "Fixture", ru: "Fixture", en: "Fixture" }))[0], attachmentIds: [], submissionHash: "a".repeat(64),
    correctionBasis: { kind: "WORKDAY", facts: workforceWorkdayCorrectionFacts(workday()) } as unknown },
  reason: "Employee proposal", decisionNote: null as string | null, decidedByUserId: null as string | null, decidedAt: null as Date | null, agent: { userId: "fixture-employee-user" } })
const event = (type: string, clock: string) => ({ id: `${type}-${clock}`, type, occurredAt: at(clock), appliedAt: at(clock), clientEventId: null })
const tx = {
  $executeRaw: vi.fn(), mtmHrmRequest: { findFirst: vi.fn(), updateMany: vi.fn() },
  mtmAgentWorkday: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() }, mtmAgentWorkdayEvent: { findMany: vi.fn(), create: vi.fn() },
  workforceTimeCorrection: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn() }, mtmAuditLog: { create: vi.fn() },
}
const run = (change: Partial<typeof input> = {}) => applyAttendanceTimeCorrectionInTransaction(tx as unknown as Prisma.TransactionClient, { ...input, ...change })
beforeEach(() => {
  vi.resetAllMocks()
  tx.mtmHrmRequest.findFirst.mockResolvedValue(request())
  tx.mtmHrmRequest.updateMany.mockResolvedValue({ count: 1 })
  tx.mtmAgentWorkday.findFirst.mockResolvedValue(workday())
  tx.mtmAgentWorkdayEvent.findMany.mockResolvedValue([event("START", "05:00")])
  tx.workforceTimeCorrection.findFirst.mockResolvedValue(null)
  tx.workforceTimeCorrection.findMany.mockResolvedValue([])
})
describe("MTM correction engine inside the caller's authorized transaction", () => {
  it("approves forgotten finish through a ledger before updating the original day, without a phone event", async () => {
    const result = await run()
    expect(result).toMatchObject({ requestId: input.requestId, workdayId: workday().id, idempotent: false,
      workday: { status: "COMPLETED", startedAt: at("05:00").toISOString(), completedAt: at("14:00").toISOString(), totalPausedSeconds: 0 } })
    expect(tx.mtmHrmRequest.updateMany.mock.invocationCallOrder[0]).toBeLessThan(tx.workforceTimeCorrection.create.mock.invocationCallOrder[0])
    expect(tx.workforceTimeCorrection.create.mock.invocationCallOrder[0]).toBeLessThan(tx.mtmAgentWorkday.update.mock.invocationCallOrder[0])
    expect(tx.mtmAgentWorkdayEvent.create).not.toHaveBeenCalled()
    expect(tx.workforceTimeCorrection.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ source: "REQUEST_APPROVAL", operationId: `request-approval:${input.requestId}`, beforeFacts: workforceWorkdayCorrectionFacts(workday()) }) }))
  })
  it.each(["WORKDAY", "MISSING"])("approves a %s overnight proposal on its original workDate and replays once", async (kind) => {
    const source = { ...workday(), startedAt: at("18:00") }
    const pending = request()
    pending.endDate = new Date("2026-10-13T00:00:00Z")
    pending.requestedStartAt = source.startedAt
    pending.requestedEndAt = new Date("2026-10-13T02:00:00Z")
    pending.attendanceDetails.startTime = "22:00"; pending.attendanceDetails.endTime = "06:00"
    pending.attendanceDetails.correctionBasis = kind === "MISSING" ? { kind, workDate: "2026-10-12" } : { kind, facts: workforceWorkdayCorrectionFacts(source) }
    pending.correctionWorkdayId = kind === "MISSING" ? null : source.id
    tx.mtmHrmRequest.findFirst.mockResolvedValue(pending)
    tx.mtmAgentWorkday.findFirst.mockResolvedValue(kind === "MISSING" ? null : source)
    tx.mtmAgentWorkdayEvent.findMany.mockResolvedValue([event("START", "18:00")])
    const result = await run()
    expect(result.workday).toMatchObject({ workDate: "2026-10-12", startedAt: at("18:00").toISOString(), completedAt: "2026-10-13T02:00:00.000Z" })
    const ledger = tx.workforceTimeCorrection.create.mock.calls[0][0].data
    tx.workforceTimeCorrection.findFirst.mockResolvedValue(ledger)
    tx.mtmHrmRequest.findFirst.mockResolvedValue({ ...pending, status: "APPROVED", correctionWorkdayId: result.workdayId, decidedByUserId: input.userId, decidedAt: now })
    expect(await run()).toEqual({ ...result, idempotent: true })
    expect(tx.workforceTimeCorrection.create).toHaveBeenCalledTimes(1)
    expect(tx.mtmAgentWorkdayEvent.create).not.toHaveBeenCalled()
  })
  it.each(["two-dates-later", "mismatched-end-clock", "ambiguous-end"])("refuses invalid overnight %s before writes", async (kind) => {
    const pending = request()
    pending.endDate = new Date(kind === "two-dates-later" ? "2026-10-14T00:00:00Z" : "2026-10-13T00:00:00Z")
    pending.requestedStartAt = at("18:00"); pending.requestedEndAt = new Date("2026-10-13T02:00:00Z")
    pending.attendanceDetails.startTime = "22:00"; pending.attendanceDetails.endTime = "07:00"
    if (kind === "ambiguous-end") {
      pending.startDate = new Date("2025-10-25T00:00:00Z"); pending.endDate = new Date("2025-10-26T00:00:00Z")
      pending.requestedStartAt = new Date("2025-10-25T20:00:00Z"); pending.requestedEndAt = new Date("2025-10-26T01:30:00Z")
      pending.attendanceDetails.timezone = "Europe/Berlin"; pending.attendanceDetails.endTime = "02:30"
      pending.attendanceDetails.correctionBasis = { kind: "MISSING", workDate: "2025-10-25" }
    }
    tx.mtmHrmRequest.findFirst.mockResolvedValue(pending)
    await expect(run()).rejects.toHaveProperty("code", "MTM_ATTENDANCE_CORRECTION_INVALID")
    expect(tx.workforceTimeCorrection.create).not.toHaveBeenCalled()
    expect(tx.mtmHrmRequest.updateMany).not.toHaveBeenCalled()
  })
  it("creates an audited missing day, then binds approval and genesis in the same transaction", async () => {
    const missing = request(); missing.correctionWorkdayId = null; missing.attendanceDetails.correctionBasis = { kind: "MISSING", workDate: "2026-10-12" }
    tx.mtmHrmRequest.findFirst.mockResolvedValue(missing); tx.mtmAgentWorkday.findFirst.mockResolvedValue(null)
    const result = await run()
    expect(tx.mtmAgentWorkday.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ id: result.workdayId, organizationId: input.organizationId, status: "COMPLETED", totalPausedSeconds: 0 }) }))
    expect(tx.mtmAgentWorkday.create.mock.invocationCallOrder[0]).toBeLessThan(tx.mtmHrmRequest.updateMany.mock.invocationCallOrder[0])
    expect(tx.workforceTimeCorrection.create.mock.calls[0][0].data.beforeFacts).toEqual({ kind: "MISSING", workDate: "2026-10-12" })
    expect(tx.mtmAgentWorkday.update).not.toHaveBeenCalled(); expect(tx.mtmAgentWorkdayEvent.create).not.toHaveBeenCalled()
  })
  it("closes a real open break at the approved finish", async () => {
    const paused = { ...workday(), status: "PAUSED", pausedAt: at("13:00") }
    const pending = request(); pending.attendanceDetails.correctionBasis = { kind: "WORKDAY", facts: workforceWorkdayCorrectionFacts(paused) }
    tx.mtmHrmRequest.findFirst.mockResolvedValue(pending); tx.mtmAgentWorkday.findFirst.mockResolvedValue(paused)
    tx.mtmAgentWorkdayEvent.findMany.mockResolvedValue([event("START", "05:00"), event("PAUSE", "13:00")])
    expect((await run()).workday).toMatchObject({ totalPausedSeconds: 3600, pausedAt: null, status: "COMPLETED" })
  })
  it("refuses an invalid frozen timezone even when the UTC fallback would match", async () => {
    const pending = request()
    pending.attendanceDetails.timezone = "invalid-zone"
    pending.attendanceDetails.startTime = "05:00"; pending.attendanceDetails.endTime = "14:00"
    tx.mtmHrmRequest.findFirst.mockResolvedValue(pending)
    await expect(run()).rejects.toHaveProperty("code", "MTM_ATTENDANCE_CORRECTION_INVALID")
    expect(tx.workforceTimeCorrection.create).not.toHaveBeenCalled()
  })
  it.each(["self-user", "stale-version", "basis-drift", "missing-now-exists", "missing-finish-proposal", "future-finish", "invalid-journal", "pause-crossing"])("refuses %s before approval or ledger/projection writes", async (kind) => {
    const pending = request()
    if (kind === "self-user") pending.agent.userId = input.userId
    if (kind === "stale-version") pending.updatedAt = at("14:31")
    if (kind === "basis-drift") tx.mtmAgentWorkday.findFirst.mockResolvedValue({ ...workday(), startedAt: at("06:00") })
    if (kind === "missing-now-exists") { pending.correctionWorkdayId = null; pending.attendanceDetails.correctionBasis = { kind: "MISSING", workDate: "2026-10-12" } }
    if (kind === "missing-finish-proposal") pending.requestedEndAt = null
    if (kind === "future-finish") pending.requestedEndAt = new Date("2026-10-14T12:00:00Z")
    if (kind === "invalid-journal") tx.mtmAgentWorkdayEvent.findMany.mockResolvedValue([])
    if (kind === "pause-crossing") {
      const completed = { ...workday(), status: "COMPLETED", completedAt: at("14:00"), totalPausedSeconds: 3600 }
      pending.attendanceDetails.correctionBasis = { kind: "WORKDAY", facts: workforceWorkdayCorrectionFacts(completed) }; pending.requestedStartAt = at("10:00")
      tx.mtmAgentWorkday.findFirst.mockResolvedValue(completed)
      tx.mtmAgentWorkdayEvent.findMany.mockResolvedValue([event("START", "05:00"), event("PAUSE", "08:00"), event("RESUME", "09:00"), event("FINISH", "14:00")])
    }
    tx.mtmHrmRequest.findFirst.mockResolvedValue(pending)
    await expect(run()).rejects.toHaveProperty("code")
    expect(tx.mtmHrmRequest.updateMany).not.toHaveBeenCalled(); expect(tx.workforceTimeCorrection.create).not.toHaveBeenCalled()
    expect(tx.mtmAgentWorkday.update).not.toHaveBeenCalled(); expect(tx.mtmAgentWorkday.create).not.toHaveBeenCalled()
  })
  it("replies idempotently to the same approved operation but refuses a new actor/note", async () => {
    const result = await run()
    const record = tx.workforceTimeCorrection.create.mock.calls[0][0].data
    const approved = { ...request(), status: "APPROVED", decidedByUserId: input.userId, decidedAt: now, updatedAt: now }
    tx.mtmHrmRequest.findFirst.mockResolvedValue(approved); tx.workforceTimeCorrection.findFirst.mockResolvedValue(record)
    expect(await run()).toEqual({ ...result, idempotent: true })
    await expect(run({ userId: "another-reviewer" })).rejects.toHaveProperty("code", "MTM_ATTENDANCE_REQUEST_ALREADY_DECIDED")
    await expect(run({ decisionNote: "different decision" })).rejects.toHaveProperty("code", "MTM_ATTENDANCE_REQUEST_ALREADY_DECIDED")
    expect(tx.workforceTimeCorrection.create).toHaveBeenCalledTimes(1); expect(tx.mtmAuditLog.create).toHaveBeenCalledTimes(1)
  })
})
