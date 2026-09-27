import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/prisma", async () => {
  const { makeMtmPrismaMock } = await import("./mocks/mtm-prisma")
  return { prisma: makeMtmPrismaMock() }
})
vi.mock("@/lib/mtm-settings", () => ({
  getMtmSettings: vi.fn(async () => ({ timezone: "Asia/Baku" })),
}))

import { prisma } from "@/lib/prisma"
import { getMtmSettings } from "@/lib/mtm-settings"
import {
  applyMtmWorkdayEvent,
  parseMtmWorkdayEvent,
  WORKFORCE_WORKDAY_CURRENT_SCHEMA_VERSION,
} from "@/lib/mtm/workday"
import { WORKFORCE_GRANULAR_ACCESS_FLAG } from "@/lib/workforce/granular-access-rollout"
import { workforceWorkdayCorrectionFacts } from "@/lib/workforce/workday-correction-facts"
import {
  replayWorkforceWorkdayFacts,
  workforceReplayMatchesWorkdayCorrectionFacts,
} from "@/lib/workforce/workday-facts-replay"
import { reopenWorkforceWorkday, type WorkforceWorkdayReopenInput } from "@/lib/workforce/workday-reopen"
import { undoWorkforceWorkdayReopen, WorkforceWorkdayReopenUndoSchema } from "@/lib/workforce/workday-reopen-undo"
import type { MtmPrismaMock } from "./mocks/mtm-prisma"
import {
  installInMemoryWorkdayJournal,
  type InMemoryWorkdayJournal,
  type MemoryRow,
} from "./mocks/workday-journal-memory"

const ORGANIZATION_ID = "org-workforce"
const WORKDAY_ID = "workday-1"
const AGENT_ID = "agent-1"
const AGENT_USER_ID = "agent-user-1"
const MANAGER_USER_ID = "manager-user-1"
const MANAGER = { agentId: "manager-agent-1", role: "MANAGER" as const, scopedAgentIds: [AGENT_ID] }
// Asia/Baku is UTC+4, so all of these are 15 September locally.
const FINISHED_AT = new Date("2026-09-15T14:00:00.000Z")
const REOPENED_AT = new Date("2026-09-15T14:30:00.000Z")
const NOW = new Date("2026-09-15T14:35:00.000Z")

const reopenedFacts = {
  id: WORKDAY_ID,
  workDate: "2026-09-15",
  status: "PAUSED",
  startedAt: "2026-09-15T05:00:00.000Z",
  pausedAt: "2026-09-15T14:00:00.000Z",
  completedAt: null,
  totalPausedSeconds: 30 * 60,
}
const restoredFacts = {
  ...reopenedFacts,
  status: "COMPLETED",
  pausedAt: null,
  completedAt: "2026-09-15T14:00:00.000Z",
}

function reopenedWorkday(overrides: Record<string, unknown> = {}) {
  return {
    id: WORKDAY_ID,
    organizationId: ORGANIZATION_ID,
    agentId: AGENT_ID,
    workDate: new Date("2026-09-15T00:00:00.000Z"),
    status: "PAUSED",
    startedAt: new Date("2026-09-15T05:00:00.000Z"),
    pausedAt: FINISHED_AT,
    completedAt: null,
    totalPausedSeconds: 30 * 60,
    updatedAt: REOPENED_AT,
    agent: { userId: AGENT_USER_ID },
    ...overrides,
  }
}

function journalEvent(id: string, type: string, occurredAt: Date, appliedAt: Date = occurredAt, clientEventId = `${type.toLowerCase()}-${id}`) {
  return { id, type, occurredAt, appliedAt, clientEventId }
}

const reopenedJournal = [
  journalEvent("event-1", "START", new Date("2026-09-15T05:00:00.000Z")),
  journalEvent("event-2", "PAUSE", new Date("2026-09-15T09:00:00.000Z")),
  journalEvent("event-3", "RESUME", new Date("2026-09-15T09:30:00.000Z")),
  journalEvent("event-4", "FINISH", FINISHED_AT),
  journalEvent("event-5", "REOPEN", FINISHED_AT, REOPENED_AT, "reopen:reopen-operation-1"),
]

const input: WorkforceWorkdayReopenInput = {
  operationId: "undo-operation-1",
  expectedUpdatedAt: REOPENED_AT.toISOString(),
  reason: "Reopened the wrong employee's day",
}

function mockWorkdayLookups(workday: Record<string, unknown> | null = reopenedWorkday()) {
  vi.mocked(prisma.mtmAgentWorkday.findFirst)
    .mockReset()
    .mockResolvedValueOnce({ id: WORKDAY_ID, agentId: AGENT_ID, agent: { userId: AGENT_USER_ID } } as never)
    .mockResolvedValueOnce(workday as never)
}

function undo(overrides: Partial<Parameters<typeof undoWorkforceWorkdayReopen>[0]> = {}) {
  return undoWorkforceWorkdayReopen({
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

describe("undoing a manager's reopen of today's workday", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWorkdayLookups()
    vi.mocked(getMtmSettings).mockResolvedValue({ timezone: "Asia/Baku" } as never)
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({ features: [] } as never)
    vi.mocked(prisma.workforceAccessGrant.findMany).mockResolvedValue([] as never)
    vi.mocked(prisma.mtmAgentWorkdayEvent.findMany).mockReset().mockResolvedValue(reopenedJournal as never)
    vi.mocked(prisma.mtmAgentWorkdayEvent.findFirst).mockReset().mockResolvedValue(null as never)
    vi.mocked(prisma.mtmAgentWorkdayEvent.create).mockReset().mockResolvedValue({ id: "event-undo" } as never)
    vi.mocked(prisma.workforceWorkdayReopen.findFirst).mockReset().mockResolvedValue({ id: "reopen-1" } as never)
    vi.mocked(prisma.mtmAgentWorkday.update).mockReset()
    vi.mocked(prisma.mtmAgent.updateMany).mockReset()
    vi.mocked(prisma.workforceTimeCorrection.findMany).mockReset().mockResolvedValue([] as never)
  })

  it("finishes the day again at the reopened instant and audits the manager with before/after facts", async () => {
    const result = await undo({ audit: { ipAddress: "203.0.113.9", userAgent: "Vitest" } })

    expect(result).toEqual({
      kind: "success",
      idempotent: false,
      data: { eventId: "event-undo", workday: restoredFacts },
    })
    expect(prisma.mtmAgentWorkdayEvent.create).toHaveBeenCalledWith({
      select: { id: true },
      data: expect.objectContaining({
        organizationId: ORGANIZATION_ID,
        agentId: AGENT_ID,
        workdayId: WORKDAY_ID,
        clientEventId: "reopen-undo:undo-operation-1",
        type: "FINISH",
        occurredAt: FINISHED_AT,
        claimedAt: FINISHED_AT,
        capturedAt: FINISHED_AT,
        queuedAt: null,
        serverReceivedAt: NOW,
        appliedAt: NOW,
        schemaVersion: WORKFORCE_WORKDAY_CURRENT_SCHEMA_VERSION,
        requestHash: expect.stringMatching(/^[0-9a-f]{64}$/),
        attendanceReviewState: "NOT_REQUIRED",
        attendanceReviewReasonCode: null,
        latitude: null,
        longitude: null,
        accuracy: null,
        note: input.reason,
      }),
    })
    // No pause time is added, completedAt is the original finish, and the
    // original end coordinates are not touched.
    expect(prisma.mtmAgentWorkday.update).toHaveBeenCalledWith({
      where: { id: WORKDAY_ID },
      data: { status: "COMPLETED", pausedAt: null, completedAt: FINISHED_AT },
    })
    expect(prisma.mtmAgent.updateMany).toHaveBeenCalledWith({
      where: { id: AGENT_ID, organizationId: ORGANIZATION_ID },
      data: { isOnline: false },
    })
    expect(prisma.mtmAuditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: ORGANIZATION_ID,
        agentId: AGENT_ID,
        action: "WORKDAY_REOPEN_UNDO",
        entity: "workday",
        entityId: WORKDAY_ID,
        metadataKind: "workforce_workday_reopen_undo",
        oldData: { workday: reopenedFacts },
        newData: {
          workday: restoredFacts,
          reopenId: "reopen-1",
          reopenEventId: "event-5",
          eventId: "event-undo",
          actorUserId: MANAGER_USER_ID,
          operationId: input.operationId,
          reason: input.reason,
          authorizationSource: "MANAGER",
        },
        ipAddress: "203.0.113.9",
        userAgent: "Vitest",
      }),
    })
    expect(prisma.workforceWorkdayReopen.findFirst).toHaveBeenCalledWith({
      where: { organizationId: ORGANIZATION_ID, agentId: AGENT_ID, workdayId: WORKDAY_ID, eventId: "event-5" },
      select: { id: true },
    })
    expect(prisma.mtmAgentWorkdayEvent.findMany).toHaveBeenCalledWith({
      where: { organizationId: ORGANIZATION_ID, agentId: AGENT_ID, workdayId: WORKDAY_ID },
      orderBy: [{ occurredAt: "asc" }, { appliedAt: { sort: "asc", nulls: "first" } }, { id: "asc" }],
      select: { id: true, type: true, occurredAt: true, appliedAt: true, clientEventId: true },
    })
    // No ledger fact or reopen context: this is an ordinary PAUSED -> COMPLETED finish.
    expect(prisma.workforceWorkdayReopen.create).not.toHaveBeenCalled()
    expect(vi.mocked(prisma.$executeRaw).mock.calls.some((call) => (
      Array.from(call[0] as unknown as ArrayLike<string>).join("?").includes("app.workforce_")
    ))).toBe(false)
    const eventOrder = vi.mocked(prisma.mtmAgentWorkdayEvent.create).mock.invocationCallOrder[0]!
    const projectionOrder = vi.mocked(prisma.mtmAgentWorkday.update).mock.invocationCallOrder[0]!
    const auditOrder = vi.mocked(prisma.mtmAuditLog.create).mock.invocationCallOrder[0]!
    expect(eventOrder).toBeLessThan(projectionOrder)
    expect(projectionOrder).toBeLessThan(auditOrder)
  })

  it("serializes with every workday writer and fences the operation key", async () => {
    await undo()

    const calls = vi.mocked(prisma.$executeRaw).mock.calls
    expect(calls.some((call) => call.includes(`workforce-workday-reopen-undo:${ORGANIZATION_ID}:${input.operationId}`))).toBe(true)
    expect(calls.some((call) => call.includes(`mtm-workday:${ORGANIZATION_ID}:${AGENT_ID}`))).toBe(true)
  })

  it.each([
    [
      "WORKFORCE_WORKDAY_REOPEN_UNDO_NOT_REOPENED",
      "a day the employee already resumed",
      () => mockWorkdayLookups(reopenedWorkday({ status: "STARTED", pausedAt: null, totalPausedSeconds: 40 * 60 })),
    ],
    [
      "WORKFORCE_WORKDAY_REOPEN_UNDO_NOT_REOPENED",
      "a day that is finished again",
      () => mockWorkdayLookups(reopenedWorkday({ status: "COMPLETED", pausedAt: null, completedAt: FINISHED_AT })),
    ],
    [
      "WORKFORCE_WORKDAY_REOPEN_UNDO_NOT_REOPENED",
      "a day the employee resumed and paused again",
      () => {
        mockWorkdayLookups(reopenedWorkday({ pausedAt: new Date("2026-09-15T15:00:00.000Z"), totalPausedSeconds: 40 * 60 }))
        vi.mocked(prisma.mtmAgentWorkdayEvent.findMany).mockResolvedValue([
          ...reopenedJournal,
          journalEvent("event-6", "RESUME", new Date("2026-09-15T14:31:00.000Z")),
          journalEvent("event-7", "PAUSE", new Date("2026-09-15T15:00:00.000Z")),
        ] as never)
      },
    ],
    [
      "WORKFORCE_WORKDAY_REOPEN_UNDO_NOT_REOPENED",
      "a paused day whose pause is an ordinary break",
      () => {
        mockWorkdayLookups(reopenedWorkday({ pausedAt: new Date("2026-09-15T13:00:00.000Z"), totalPausedSeconds: 0 }))
        vi.mocked(prisma.mtmAgentWorkdayEvent.findMany).mockResolvedValue([
          journalEvent("event-1", "START", new Date("2026-09-15T05:00:00.000Z")),
          journalEvent("event-2", "PAUSE", new Date("2026-09-15T13:00:00.000Z")),
        ] as never)
      },
    ],
    [
      "WORKFORCE_WORKDAY_REOPEN_UNDO_NOT_REOPENED",
      "a REOPEN event without its reopen fact",
      () => vi.mocked(prisma.workforceWorkdayReopen.findFirst).mockResolvedValue(null as never),
    ],
    [
      "WORKFORCE_WORKDAY_REOPEN_UNDO_NOT_TODAY",
      "yesterday's reopened day",
      () => mockWorkdayLookups(reopenedWorkday({ workDate: new Date("2026-09-14T00:00:00.000Z") })),
    ],
    [
      "WORKFORCE_WORKDAY_REOPEN_UNDO_VERSION_CONFLICT",
      "a day changed since the manager looked at it",
      () => mockWorkdayLookups(reopenedWorkday({ updatedAt: new Date("2026-09-15T14:31:00.000Z") })),
    ],
    [
      "WORKFORCE_WORKDAY_REOPEN_UNDO_HISTORY_INVALID",
      "a day corrected after the reopen",
      () => {
        // An approved request moved the start while the day was reopened; a
        // FINISH now would split the correction chain.
        mockWorkdayLookups(reopenedWorkday({ startedAt: new Date("2026-09-15T04:50:00.000Z") }))
        vi.mocked(prisma.workforceTimeCorrection.findMany).mockResolvedValue([{
          id: "correction-1",
          beforeFacts: reopenedFacts,
          afterFacts: { ...reopenedFacts, startedAt: "2026-09-15T04:50:00.000Z" },
        }] as never)
      },
    ],
  ])("answers %s for %s without writing anything", async (code, _label, arrange) => {
    arrange()

    await expect(undo()).resolves.toMatchObject({ kind: "conflict", code, currentWorkday: { id: WORKDAY_ID } })
    expectNothingWritten()
  })

  it("acknowledges a retried undo once more without writing again", async () => {
    await undo()
    const requestHash = firstCallData(prisma.mtmAgentWorkdayEvent.create).requestHash
    vi.clearAllMocks()
    vi.mocked(prisma.mtmAgentWorkdayEvent.create).mockReset()
    vi.mocked(prisma.mtmAgentWorkday.update).mockReset()
    vi.mocked(prisma.mtmAgent.updateMany).mockReset()
    mockWorkdayLookups(reopenedWorkday({ status: "COMPLETED", pausedAt: null, completedAt: FINISHED_AT }))
    vi.mocked(prisma.mtmAgentWorkdayEvent.findFirst).mockResolvedValue({
      id: "event-undo",
      type: "FINISH",
      workdayId: WORKDAY_ID,
      requestHash,
    } as never)

    await expect(undo()).resolves.toEqual({
      kind: "success",
      idempotent: true,
      data: { eventId: "event-undo", workday: restoredFacts },
    })
    expect(prisma.mtmAgentWorkdayEvent.findFirst).toHaveBeenCalledWith({
      where: { organizationId: ORGANIZATION_ID, agentId: AGENT_ID, clientEventId: "reopen-undo:undo-operation-1" },
      select: { id: true, type: true, workdayId: true, requestHash: true },
    })
    expectNothingWritten()
  })

  it.each([
    ["a different reason", { input: { ...input, reason: "Another explanation" } }, "FINISH", WORKDAY_ID],
    ["a different expected version", { input: { ...input, expectedUpdatedAt: "2026-09-15T14:30:00.005Z" } }, "FINISH", WORKDAY_ID],
    ["a different manager", { userId: "manager-user-2" }, "FINISH", WORKDAY_ID],
    ["a key that belongs to another kind of event", {}, "PAUSE", WORKDAY_ID],
    ["a key that belongs to another workday", {}, "FINISH", "workday-other"],
  ])("refuses to reuse an operation id with %s", async (_label, overrides, existingType, existingWorkdayId) => {
    await undo()
    const requestHash = firstCallData(prisma.mtmAgentWorkdayEvent.create).requestHash
    vi.clearAllMocks()
    vi.mocked(prisma.mtmAgentWorkdayEvent.create).mockReset()
    vi.mocked(prisma.mtmAgentWorkday.update).mockReset()
    vi.mocked(prisma.mtmAgent.updateMany).mockReset()
    mockWorkdayLookups()
    vi.mocked(prisma.mtmAgentWorkdayEvent.findFirst).mockResolvedValue({
      id: "event-undo",
      type: existingType,
      workdayId: existingWorkdayId,
      requestHash,
    } as never)

    await expect(undo(overrides)).resolves.toMatchObject({
      kind: "conflict",
      code: "WORKFORCE_WORKDAY_REOPEN_UNDO_IDEMPOTENCY_MISMATCH",
    })
    expectNothingWritten()
  })

  it("returns 404 semantics for an unknown workday before any transaction", async () => {
    vi.mocked(prisma.mtmAgentWorkday.findFirst).mockReset().mockResolvedValueOnce(null as never)

    await expect(undo()).resolves.toEqual({ kind: "not_found" })
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it.each([
    ["the employee", AGENT_USER_ID, { agentId: AGENT_ID, role: "MANAGER" as const, scopedAgentIds: [AGENT_ID] }],
    ["a web admin linked to the employee", AGENT_USER_ID, { agentId: null, role: "ADMIN" as const, scopedAgentIds: null }],
  ])("does not let %s undo a reopen of their own day", async (_label, userId, actor) => {
    await expect(undo({ userId, actor })).resolves.toEqual({ kind: "forbidden" })
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it.each([
    ["an agent", { agentId: "agent-2", role: "AGENT" as const, scopedAgentIds: [AGENT_ID] }],
    ["a manager of another team", { agentId: "manager-agent-2", role: "MANAGER" as const, scopedAgentIds: ["agent-9"] }],
    ["a principal without a Workforce actor", null],
  ])("refuses %s before granular cutover", async (_label, actor) => {
    await expect(undo({ actor })).resolves.toEqual({ kind: "forbidden" })
    expect(prisma.mtmAgentWorkdayEvent.findFirst).not.toHaveBeenCalled()
    expectNothingWritten()
  })

  it("follows the TIME_CORRECT grant after granular cutover", async () => {
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({ features: [WORKFORCE_GRANULAR_ACCESS_FLAG] } as never)

    await expect(undo()).resolves.toEqual({ kind: "forbidden" })
    expectNothingWritten()

    mockWorkdayLookups()
    vi.mocked(prisma.workforceAccessGrant.findMany).mockResolvedValue([{
      id: "grant-time-approver-1",
      organizationId: ORGANIZATION_ID,
      principalUserId: MANAGER_USER_ID,
      role: "TIME_APPROVER",
      scopeKind: "AGENT",
      scopeTeamId: null,
      scopeSiteId: null,
      scopeAgentId: AGENT_ID,
      effectiveFrom: new Date("2026-08-01T00:00:00.000Z"),
      effectiveUntil: null,
      revocation: null,
    }] as never)
    await expect(undo({ actor: null })).resolves.toMatchObject({ kind: "success" })
    expect(prisma.mtmAuditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        newData: expect.objectContaining({ authorizationSource: "WORKFORCE_GRANT" }),
      }),
    })
  })

  it("takes the same strict body as the reopen", () => {
    expect(WorkforceWorkdayReopenUndoSchema.safeParse(input).success).toBe(true)
    expect(WorkforceWorkdayReopenUndoSchema.safeParse({ ...input, reason: "no" }).success).toBe(false)
    expect(WorkforceWorkdayReopenUndoSchema.safeParse({ ...input, completedAt: FINISHED_AT.toISOString() }).success).toBe(false)
  })
})

/**
 * Reopen and undo through the real state machine over one in-memory journal:
 * the undone day must be the finished day it was, to the millisecond, while
 * the FINISH, the REOPEN and the undo all remain in its history.
 */
describe("undone reopen through the canonical state machine", () => {
  const SCOPE = { organizationId: ORGANIZATION_ID, agentId: AGENT_ID }
  let memory: InMemoryWorkdayJournal

  function serverClockAt(at: string): Date {
    const now = new Date(at)
    vi.setSystemTime(now)
    memory.setClock(now)
    return now
  }

  async function act(action: "START" | "PAUSE" | "RESUME" | "FINISH", phoneAt: string, serverAt: string = phoneAt) {
    const received = serverClockAt(serverAt)
    const parsed = parseMtmWorkdayEvent(
      action === "START"
        ? { action, id: WORKDAY_ID, occurredAt: phoneAt, latitude: 40.4, longitude: 49.8 }
        : { action, workdayId: WORKDAY_ID, occurredAt: phoneAt, latitude: 40.41, longitude: 49.81 },
      `${action.toLowerCase()}-${phoneAt}`,
      "Asia/Baku",
      received,
    )
    expect(parsed.error).toBeNull()
    return applyMtmWorkdayEvent(prisma as never, SCOPE, parsed.input!)
  }

  function row(): MemoryRow {
    return memory.workday(WORKDAY_ID)
  }

  function replayMatchesRow() {
    const facts = replayWorkforceWorkdayFacts({ workdayId: WORKDAY_ID, events: memory.journalFacts(WORKDAY_ID) })
    expect(workforceReplayMatchesWorkdayCorrectionFacts(facts, workforceWorkdayCorrectionFacts(row() as never))).toBe(true)
    return facts
  }

  function managerAt(serverAt: string, operationId: string, action: "reopen" | "undo") {
    const now = serverClockAt(serverAt)
    const context = {
      organizationId: ORGANIZATION_ID,
      userId: MANAGER_USER_ID,
      actor: MANAGER,
      workdayId: WORKDAY_ID,
      input: {
        operationId,
        expectedUpdatedAt: (row().updatedAt as Date).toISOString(),
        reason: action === "reopen" ? "Finished by mistake" : "Reopened by mistake",
      },
      now,
    }
    return action === "reopen" ? reopenWorkforceWorkday(context) : undoWorkforceWorkdayReopen(context)
  }

  /** The workday row without its update stamp. */
  function finishedDay(value: MemoryRow): MemoryRow {
    const rest: MemoryRow = { ...value }
    delete rest.updatedAt
    return rest
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.mocked(getMtmSettings).mockResolvedValue({ timezone: "Asia/Baku" } as never)
    vi.mocked(prisma.organization.findUnique).mockReset().mockResolvedValue({ features: [] } as never)
    vi.mocked(prisma.workforceTimeCorrection.findMany).mockReset().mockResolvedValue([] as never)
    vi.mocked(prisma.workforceTimesheetApproval.findFirst).mockReset().mockResolvedValue(null as never)
    vi.mocked(prisma.mtmHrmRequest.findFirst).mockReset().mockResolvedValue(null as never)
    vi.mocked(prisma.mtmAgent.updateMany).mockReset()
    memory = installInMemoryWorkdayJournal(prisma as unknown as MtmPrismaMock, { agentUserId: AGENT_USER_ID })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("restores the finished day to the millisecond and keeps the whole history", async () => {
    await act("START", "2026-09-15T05:00:00.000Z")
    await act("PAUSE", "2026-09-15T12:00:00.000Z")
    await act("FINISH", "2026-09-15T13:00:00.000Z")
    const finished = finishedDay(row())
    const finishedFacts = replayMatchesRow()

    await expect(managerAt("2026-09-15T13:20:00.000Z", "reopen-op-1", "reopen")).resolves.toMatchObject({ kind: "success" })
    await expect(managerAt("2026-09-15T13:25:00.000Z", "undo-op-1", "undo")).resolves.toMatchObject({
      kind: "success",
      idempotent: false,
    })

    expect(finishedDay(row())).toEqual(finished)
    expect(row()).toMatchObject({ endLatitude: 40.41, endLongitude: 49.81, totalPausedSeconds: 60 * 60 })
    const undoneFacts = replayMatchesRow()
    expect({ ...undoneFacts, eventIds: [] }).toEqual({ ...finishedFacts, eventIds: [] })
    expect(memory.journal(WORKDAY_ID).map((event) => event.type)).toEqual(["START", "PAUSE", "FINISH", "REOPEN", "FINISH"])
    // The restoring FINISH sits at the reopened instant although the manager
    // acted five minutes after the reopen: only the undo key is exempt.
    expect(memory.journal(WORKDAY_ID).at(-1)).toMatchObject({
      clientEventId: "reopen-undo:undo-op-1",
      occurredAt: new Date("2026-09-15T13:00:00.000Z"),
      appliedAt: new Date("2026-09-15T13:25:00.000Z"),
    })

    // A retry of the same undo is acknowledged, not applied again.
    serverClockAt("2026-09-15T13:26:00.000Z")
    await expect(undoWorkforceWorkdayReopen({
      organizationId: ORGANIZATION_ID,
      userId: MANAGER_USER_ID,
      actor: MANAGER,
      workdayId: WORKDAY_ID,
      input: { operationId: "undo-op-1", expectedUpdatedAt: "2026-09-15T13:20:00.000Z", reason: "Reopened by mistake" },
      now: new Date("2026-09-15T13:26:00.000Z"),
    })).resolves.toMatchObject({ kind: "success", idempotent: true })
    expect(memory.events).toHaveLength(5)
  })

  it("undoes a reopen of a finish the phone stamped ahead of the server", async () => {
    await act("START", "2026-09-15T05:00:00.000Z")
    await act("FINISH", "2026-09-15T13:03:00.000Z", "2026-09-15T13:00:00.000Z")
    await expect(managerAt("2026-09-15T13:01:00.000Z", "reopen-op-1", "reopen")).resolves.toMatchObject({ kind: "success" })

    await expect(managerAt("2026-09-15T13:02:00.000Z", "undo-op-1", "undo")).resolves.toMatchObject({
      kind: "success",
      data: { workday: { status: "COMPLETED", completedAt: "2026-09-15T13:03:00.000Z", totalPausedSeconds: 0 } },
    })
    replayMatchesRow()
  })

  it("lets the manager reopen the day again after an undo", async () => {
    await act("START", "2026-09-15T05:00:00.000Z")
    await act("FINISH", "2026-09-15T13:00:00.000Z")
    await managerAt("2026-09-15T13:20:00.000Z", "reopen-op-1", "reopen")
    await managerAt("2026-09-15T13:25:00.000Z", "undo-op-1", "undo")

    await expect(managerAt("2026-09-15T13:40:00.000Z", "reopen-op-2", "reopen")).resolves.toMatchObject({ kind: "success" })
    await expect(act("RESUME", "2026-09-15T13:45:00.000Z")).resolves.toMatchObject({ status: "ok" })

    expect(row()).toMatchObject({ status: "STARTED", totalPausedSeconds: 45 * 60 })
    expect(memory.reopens).toHaveLength(2)
    replayMatchesRow()
  })

  it("leaves the day to the employee once they resumed, even if they paused again", async () => {
    await act("START", "2026-09-15T05:00:00.000Z")
    await act("FINISH", "2026-09-15T13:00:00.000Z")
    await managerAt("2026-09-15T13:20:00.000Z", "reopen-op-1", "reopen")
    await act("RESUME", "2026-09-15T13:30:00.000Z")

    await expect(managerAt("2026-09-15T13:35:00.000Z", "undo-op-1", "undo")).resolves.toMatchObject({
      kind: "conflict",
      code: "WORKFORCE_WORKDAY_REOPEN_UNDO_NOT_REOPENED",
    })

    await act("PAUSE", "2026-09-15T13:40:00.000Z")
    await expect(managerAt("2026-09-15T13:45:00.000Z", "undo-op-2", "undo")).resolves.toMatchObject({
      kind: "conflict",
      code: "WORKFORCE_WORKDAY_REOPEN_UNDO_NOT_REOPENED",
    })
    expect(memory.journal(WORKDAY_ID).map((event) => event.type)).toEqual(["START", "FINISH", "REOPEN", "RESUME", "PAUSE"])
    replayMatchesRow()
  })
})
