import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/prisma", async () => {
  const { makeMtmPrismaMock } = await import("./mocks/mtm-prisma")
  return { prisma: makeMtmPrismaMock() }
})

import { prisma } from "@/lib/prisma"
import { isMtmWorkdayManagerFinishEventKey, parseMtmWorkdayEvent } from "@/lib/mtm/workday"
import {
  closeLeftOpenWorkforceWorkday,
  workforceWorkdayCloseFinishInRange,
  workforceWorkdayCloseSuggestedFinish,
  WorkforceWorkdayCloseSchema,
  type WorkforceWorkdayCloseInput,
} from "@/lib/workforce/workday-close-left-open"
import { workforceEmployeeTodayServerOutcome } from "@/lib/workforce/employee-today"
import {
  replayWorkforceWorkdayFacts,
  workforceReplayMatchesWorkdayCorrectionFacts,
} from "@/lib/workforce/workday-facts-replay"

/**
 * Audit 2026-09-21: on prod four shifts were open for 1 to 64 days, and a
 * manager had no way to end them. These pin the close: a manager's explicit
 * finish with a reason, journalled as a FINISH the employee did not make.
 */
const ORGANIZATION_ID = "org-workforce"
const WORKDAY_ID = "workday-left-open"
const AGENT_ID = "agent-1"
const AGENT_USER_ID = "agent-user-1"
const MANAGER_USER_ID = "manager-user-1"
const MANAGER = { agentId: "manager-agent-1", role: "MANAGER" as const, scopedAgentIds: [AGENT_ID] }
const STARTED_AT = new Date("2026-09-01T21:22:12.960Z")
const SAVED_AT = new Date("2026-09-01T21:22:13.371Z")
const NOW = new Date("2026-09-21T10:00:00.000Z")
const FINISH = new Date("2026-09-02T06:00:00.000Z")

function openWorkday(overrides: Record<string, unknown> = {}) {
  return {
    id: WORKDAY_ID,
    organizationId: ORGANIZATION_ID,
    agentId: AGENT_ID,
    workDate: new Date("2026-09-02T00:00:00.000Z"),
    status: "STARTED",
    startedAt: STARTED_AT,
    pausedAt: null,
    completedAt: null,
    totalPausedSeconds: 0,
    updatedAt: SAVED_AT,
    agent: { userId: AGENT_USER_ID },
    ...overrides,
  }
}

function journalEvent(id: string, type: string, occurredAt: Date) {
  return { id, type, occurredAt, appliedAt: occurredAt, clientEventId: `mtm-${id}` }
}

const startedJournal = [journalEvent("event-1", "START", STARTED_AT)]

const input: WorkforceWorkdayCloseInput = {
  operationId: "close-operation-1",
  expectedUpdatedAt: SAVED_AT.toISOString(),
  finishedAt: FINISH.toISOString(),
  reason: "Agent forgot to close the shift",
}

function mockWorkdayLookups(workday: Record<string, unknown> | null = openWorkday()) {
  vi.mocked(prisma.mtmAgentWorkday.findFirst)
    .mockReset()
    .mockResolvedValueOnce({ id: WORKDAY_ID, agentId: AGENT_ID, agent: { userId: AGENT_USER_ID } } as never)
    .mockResolvedValueOnce(workday as never)
    .mockResolvedValue(null as never)
}

function close(overrides: Partial<Parameters<typeof closeLeftOpenWorkforceWorkday>[0]> = {}) {
  return closeLeftOpenWorkforceWorkday({
    organizationId: ORGANIZATION_ID,
    userId: MANAGER_USER_ID,
    actor: MANAGER,
    workdayId: WORKDAY_ID,
    input,
    now: NOW,
    ...overrides,
  })
}

function firstCallData(method: unknown): Record<string, unknown> {
  const calls = (method as { mock: { calls: unknown[][] } }).mock.calls
  const query = calls[0]?.[0] as { data?: Record<string, unknown> } | undefined
  return query?.data ?? {}
}

function expectNothingWritten() {
  expect(prisma.mtmAgentWorkdayEvent.create).not.toHaveBeenCalled()
  expect(prisma.mtmAgentWorkday.update).not.toHaveBeenCalled()
  expect(prisma.mtmAgent.updateMany).not.toHaveBeenCalled()
  expect(prisma.mtmAuditLog.create).not.toHaveBeenCalled()
}

describe("a manager closing a shift the agent left open", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWorkdayLookups()
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({ features: [] } as never)
    vi.mocked(prisma.workforceAccessGrant.findMany).mockResolvedValue([] as never)
    vi.mocked(prisma.mtmAgentWorkdayEvent.findMany).mockReset().mockResolvedValue(startedJournal as never)
    vi.mocked(prisma.mtmAgentWorkdayEvent.findFirst).mockReset().mockResolvedValue(null as never)
    vi.mocked(prisma.mtmAgentWorkdayEvent.create).mockReset().mockResolvedValue({ id: "event-close" } as never)
    vi.mocked(prisma.mtmAgentWorkday.update).mockReset()
    vi.mocked(prisma.mtmAgent.updateMany).mockReset()
    vi.mocked(prisma.workforceTimeCorrection.findMany).mockReset().mockResolvedValue([] as never)
    vi.mocked(prisma.workforceTimesheetApproval.findFirst).mockReset().mockResolvedValue(null as never)
    vi.mocked(prisma.mtmHrmRequest.findFirst).mockReset().mockResolvedValue(null as never)
    vi.mocked(prisma.mtmAgentLocation.findFirst).mockReset().mockResolvedValue({ recordedAt: new Date("2026-09-01T21:22:20.000Z") } as never)
    vi.mocked(prisma.mtmVisit.findFirst).mockReset().mockResolvedValue(null as never)
  })

  it("finishes the shift at the manager's time, as a FINISH the employee did not make, and audits it", async () => {
    const result = await close({ audit: { ipAddress: "203.0.113.9", userAgent: "Vitest" } })

    const after = {
      id: WORKDAY_ID,
      workDate: "2026-09-02",
      status: "COMPLETED",
      startedAt: STARTED_AT.toISOString(),
      pausedAt: null,
      completedAt: FINISH.toISOString(),
      totalPausedSeconds: 0,
    }
    expect(result).toEqual({ kind: "success", data: { eventId: "event-close", workday: after }, idempotent: false })

    const event = firstCallData(prisma.mtmAgentWorkdayEvent.create)
    expect(event).toMatchObject({
      type: "FINISH",
      clientEventId: "close-left-open:close-operation-1",
      occurredAt: FINISH,
      claimedAt: FINISH,
      serverReceivedAt: NOW,
      appliedAt: NOW,
      queuedAt: null,
      attendanceReviewState: "NOT_REQUIRED",
      note: "Agent forgot to close the shift",
      latitude: null,
    })
    expect(isMtmWorkdayManagerFinishEventKey(String(event.clientEventId))).toBe(true)
    expect(prisma.mtmAgentWorkday.update).toHaveBeenCalledWith({
      where: { id: WORKDAY_ID },
      data: { status: "COMPLETED", pausedAt: null, completedAt: FINISH, totalPausedSeconds: 0 },
    })
    expect(prisma.mtmAgent.updateMany).toHaveBeenCalledWith({
      where: { id: AGENT_ID, organizationId: ORGANIZATION_ID },
      data: { isOnline: false },
    })

    const audit = firstCallData(prisma.mtmAuditLog.create)
    expect(audit).toMatchObject({
      action: "WORKDAY_CLOSE_LEFT_OPEN",
      metadataKind: "workforce_workday_close_left_open",
      entityId: WORKDAY_ID,
      ipAddress: "203.0.113.9",
    })
    expect(audit.newData).toMatchObject({
      actorUserId: MANAGER_USER_ID,
      reason: "Agent forgot to close the shift",
      eventId: "event-close",
      // The form started from the last GPS point (21:22:20), rounded up.
      suggestedFinishAt: "2026-09-01T21:23:00.000Z",
      workday: after,
    })

    // The extended journal reproduces exactly the row that was written.
    const replayed = replayWorkforceWorkdayFacts({
      workdayId: WORKDAY_ID,
      events: [
        { id: "event-1", type: "START", occurredAt: STARTED_AT.toISOString(), appliedAt: STARTED_AT.toISOString(), clientEventId: "mtm-event-1" },
        { id: "event-close", type: "FINISH", occurredAt: FINISH.toISOString(), appliedAt: NOW.toISOString(), clientEventId: String(event.clientEventId) },
      ],
    })
    expect(workforceReplayMatchesWorkdayCorrectionFacts(replayed, after as never)).toBe(true)
  })

  it("banks the open pause of a paused shift up to the finish, as the ordinary FINISH would", async () => {
    const pausedAt = new Date("2026-09-17T08:12:42.413Z")
    const startedAt = new Date("2026-09-17T08:09:14.118Z")
    const finish = new Date("2026-09-17T08:13:00.000Z")
    mockWorkdayLookups(openWorkday({ status: "PAUSED", startedAt, pausedAt, workDate: new Date("2026-09-17T00:00:00.000Z") }))
    vi.mocked(prisma.mtmAgentWorkdayEvent.findMany).mockResolvedValue([
      journalEvent("event-1", "START", startedAt),
      journalEvent("event-2", "PAUSE", pausedAt),
    ] as never)

    const result = await close({ input: { ...input, finishedAt: finish.toISOString() } })

    expect(result.kind).toBe("success")
    expect(prisma.mtmAgentWorkday.update).toHaveBeenCalledWith({
      where: { id: WORKDAY_ID },
      data: { status: "COMPLETED", pausedAt: null, completedAt: finish, totalPausedSeconds: 17 },
    })
  })

  it("refuses a shift that is still an ordinary working day", async () => {
    const startedAt = new Date("2026-09-21T05:00:00.000Z")
    mockWorkdayLookups(openWorkday({ startedAt }))

    const result = await close()

    expect(result).toMatchObject({ kind: "conflict", code: "WORKFORCE_WORKDAY_CLOSE_NOT_LEFT_OPEN" })
    expectNothingWritten()
  })

  it.each([
    ["before the shift's last event", "2026-09-01T21:00:00.000Z"],
    ["at the shift's last event", STARTED_AT.toISOString()],
    ["in the future", "2026-09-21T10:00:01.000Z"],
  ])("refuses a finish %s", async (_label, finishedAt) => {
    const result = await close({ input: { ...input, finishedAt } })

    expect(result).toMatchObject({ kind: "conflict", code: "WORKFORCE_WORKDAY_CLOSE_FINISH_OUT_OF_RANGE" })
    expectNothingWritten()
  })

  it("refuses when the shift changed since the manager opened the form", async () => {
    mockWorkdayLookups(openWorkday({ updatedAt: new Date("2026-09-21T09:59:00.000Z") }))

    expect(await close()).toMatchObject({ kind: "conflict", code: "WORKFORCE_WORKDAY_CLOSE_VERSION_CONFLICT" })
    expectNothingWritten()
  })

  it("refuses a day an approved timesheet covers or a pending correction request is about", async () => {
    vi.mocked(prisma.workforceTimesheetApproval.findFirst).mockResolvedValue({ id: "approval-1" } as never)
    expect(await close()).toMatchObject({ kind: "conflict", code: "WORKFORCE_WORKDAY_CLOSE_TIMESHEET_APPROVED" })

    vi.mocked(prisma.workforceTimesheetApproval.findFirst).mockResolvedValue(null as never)
    vi.mocked(prisma.mtmHrmRequest.findFirst).mockResolvedValue({ id: "request-1" } as never)
    mockWorkdayLookups()
    expect(await close()).toMatchObject({ kind: "conflict", code: "WORKFORCE_WORKDAY_CLOSE_CORRECTION_PENDING" })
    expectNothingWritten()
  })

  it("refuses a journal that no longer reproduces the row", async () => {
    vi.mocked(prisma.mtmAgentWorkdayEvent.findMany).mockResolvedValue([
      journalEvent("event-1", "START", new Date("2026-09-01T20:00:00.000Z")),
    ] as never)

    expect(await close()).toMatchObject({ kind: "conflict", code: "WORKFORCE_WORKDAY_CLOSE_HISTORY_INVALID" })
    expectNothingWritten()
  })

  it("never lets the employee close their own shift, nor an agent anyone's", async () => {
    expect(await close({ userId: AGENT_USER_ID })).toEqual({ kind: "forbidden" })
    mockWorkdayLookups()
    expect(await close({ actor: { agentId: "agent-2", role: "AGENT" as const, scopedAgentIds: [] } as never })).toEqual({ kind: "forbidden" })
    expectNothingWritten()
  })

  it("acknowledges a repeated operation once more without writing again, and refuses a changed one", async () => {
    const { workforceWorkdayCloseRequestHash } = await import("@/lib/workforce/workday-close-left-open")
    const requestHash = workforceWorkdayCloseRequestHash({ workdayId: WORKDAY_ID, actorUserId: MANAGER_USER_ID, input })
    vi.mocked(prisma.mtmAgentWorkdayEvent.findFirst).mockResolvedValue({ id: "event-close", type: "FINISH", workdayId: WORKDAY_ID, requestHash } as never)

    expect(await close()).toMatchObject({ kind: "success", idempotent: true, data: { eventId: "event-close" } })
    expectNothingWritten()

    mockWorkdayLookups()
    expect(await close({ input: { ...input, reason: "Different reason" } })).toMatchObject({
      kind: "conflict",
      code: "WORKFORCE_WORKDAY_CLOSE_IDEMPOTENCY_MISMATCH",
    })
  })

  it("accepts only an explicit finish and a reason in the request body", () => {
    expect(WorkforceWorkdayCloseSchema.safeParse(input).success).toBe(true)
    expect(WorkforceWorkdayCloseSchema.safeParse({ ...input, finishedAt: undefined }).success).toBe(false)
    expect(WorkforceWorkdayCloseSchema.safeParse({ ...input, reason: "  " }).success).toBe(false)
    expect(WorkforceWorkdayCloseSchema.safeParse({ ...input, agentId: AGENT_ID }).success).toBe(false)
  })

  it("keeps the close key away from employees and out of their own receipts", () => {
    const parsed = parseMtmWorkdayEvent({ action: "FINISH", workdayId: WORKDAY_ID, occurredAt: FINISH.toISOString() }, "close-left-open:forged-by-phone", "Asia/Baku", NOW)
    expect(parsed).toMatchObject({ input: null, error: "clientEventId uses a prefix reserved for manager workday actions" })
    expect(workforceEmployeeTodayServerOutcome({
      type: "FINISH",
      attendanceReviewState: "NOT_REQUIRED",
      serverReceivedAt: NOW,
      appliedAt: NOW,
      clientEventId: "close-left-open:close-operation-1",
    })).toBeNull()
  })
})

describe("where the manager's finish starts and what it may be", () => {
  const lastEventAt = new Date("2026-09-01T21:22:12.960Z")

  it("starts at the latest trace, rounded up to the minute the form edits", () => {
    expect(workforceWorkdayCloseSuggestedFinish({
      lastEventAt,
      traces: [new Date("2026-09-01T21:22:20.000Z"), new Date("2026-09-02T05:40:10.000Z")],
      now: NOW,
    }).toISOString()).toBe("2026-09-02T05:41:00.000Z")
  })

  it("starts strictly after the last event when there is no trace, and ignores traces in the future", () => {
    expect(workforceWorkdayCloseSuggestedFinish({ lastEventAt, traces: [], now: NOW }).toISOString()).toBe("2026-09-01T21:23:00.000Z")
    const onTheMinute = new Date("2026-09-01T21:22:00.000Z")
    expect(workforceWorkdayCloseSuggestedFinish({ lastEventAt: onTheMinute, traces: [null], now: NOW }).toISOString()).toBe("2026-09-01T21:23:00.000Z")
    expect(workforceWorkdayCloseSuggestedFinish({ lastEventAt, traces: [new Date("2026-09-22T00:00:00.000Z")], now: NOW }).toISOString()).toBe("2026-09-01T21:23:00.000Z")
  })

  it("accepts a finish after the last event and no later than now", () => {
    expect(workforceWorkdayCloseFinishInRange({ finishedAt: new Date("2026-09-01T21:23:00.000Z"), lastEventAt, now: NOW })).toBe(true)
    expect(workforceWorkdayCloseFinishInRange({ finishedAt: NOW, lastEventAt, now: NOW })).toBe(true)
    expect(workforceWorkdayCloseFinishInRange({ finishedAt: lastEventAt, lastEventAt, now: NOW })).toBe(false)
    expect(workforceWorkdayCloseFinishInRange({ finishedAt: new Date(Number.NaN), lastEventAt, now: NOW })).toBe(false)
  })
})
