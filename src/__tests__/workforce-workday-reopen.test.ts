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
import { calculateWorkforceTimesheetDay } from "@/lib/workforce/timesheet-calculation"
import { workforceWorkdayCorrectionFacts } from "@/lib/workforce/workday-correction-facts"
import {
  replayWorkforceWorkdayFacts,
  workforceReplayMatchesWorkdayCorrectionFacts,
} from "@/lib/workforce/workday-facts-replay"
import {
  reopenWorkforceWorkday,
  WorkforceWorkdayReopenSchema,
  type WorkforceWorkdayReopenInput,
} from "@/lib/workforce/workday-reopen"
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
// Asia/Baku is UTC+4: 14:30Z is 18:30 on the same local day as the workday.
const NOW = new Date("2026-09-15T14:30:00.000Z")
const FINISHED_AT = new Date("2026-09-15T14:00:00.000Z")
const UPDATED_AT = new Date("2026-09-15T14:00:01.000Z")

const beforeFacts = {
  id: WORKDAY_ID,
  workDate: "2026-09-15",
  status: "COMPLETED",
  startedAt: "2026-09-15T05:00:00.000Z",
  pausedAt: null,
  completedAt: "2026-09-15T14:00:00.000Z",
  totalPausedSeconds: 30 * 60,
}
const afterFacts = {
  ...beforeFacts,
  status: "PAUSED",
  pausedAt: "2026-09-15T14:00:00.000Z",
  completedAt: null,
}

function completedWorkday(overrides: Record<string, unknown> = {}) {
  return {
    id: WORKDAY_ID,
    organizationId: ORGANIZATION_ID,
    agentId: AGENT_ID,
    workDate: new Date("2026-09-15T00:00:00.000Z"),
    status: "COMPLETED",
    startedAt: new Date("2026-09-15T05:00:00.000Z"),
    pausedAt: null,
    completedAt: FINISHED_AT,
    totalPausedSeconds: 30 * 60,
    updatedAt: UPDATED_AT,
    agent: { userId: AGENT_USER_ID },
    ...overrides,
  }
}

const journal = [
  { id: "event-1", type: "START", occurredAt: new Date("2026-09-15T05:00:00.000Z") },
  { id: "event-2", type: "PAUSE", occurredAt: new Date("2026-09-15T09:00:00.000Z") },
  { id: "event-3", type: "RESUME", occurredAt: new Date("2026-09-15T09:30:00.000Z") },
  { id: "event-4", type: "FINISH", occurredAt: FINISHED_AT },
]

const input: WorkforceWorkdayReopenInput = {
  operationId: "reopen-operation-1",
  expectedUpdatedAt: UPDATED_AT.toISOString(),
  reason: "Finished by mistake, still with the client",
}

function mockWorkdayLookups(workday: Record<string, unknown> | null = completedWorkday()) {
  vi.mocked(prisma.mtmAgentWorkday.findFirst)
    .mockReset()
    .mockResolvedValueOnce({ id: WORKDAY_ID, agentId: AGENT_ID, agent: { userId: AGENT_USER_ID } } as never)
    .mockResolvedValueOnce(workday as never)
}

function reopen(overrides: Partial<Parameters<typeof reopenWorkforceWorkday>[0]> = {}) {
  return reopenWorkforceWorkday({
    organizationId: ORGANIZATION_ID,
    userId: MANAGER_USER_ID,
    actor: MANAGER,
    workdayId: WORKDAY_ID,
    input,
    now: NOW,
    ...overrides,
  })
}

function timeApproverGrant(principalUserId = MANAGER_USER_ID) {
  return [{
    id: "grant-time-approver-1",
    organizationId: ORGANIZATION_ID,
    principalUserId,
    role: "TIME_APPROVER",
    scopeKind: "AGENT",
    scopeTeamId: null,
    scopeSiteId: null,
    scopeAgentId: AGENT_ID,
    effectiveFrom: new Date("2026-08-01T00:00:00.000Z"),
    effectiveUntil: null,
    revocation: null,
  }]
}

function expectNothingWritten() {
  expect(prisma.mtmAgentWorkdayEvent.create).not.toHaveBeenCalled()
  expect(prisma.workforceWorkdayReopen.create).not.toHaveBeenCalled()
  expect(prisma.mtmAgentWorkday.update).not.toHaveBeenCalled()
  expect(prisma.mtmAuditLog.create).not.toHaveBeenCalled()
}

function executeRawCallIndex(fragment: string): number {
  return vi.mocked(prisma.$executeRaw).mock.calls.findIndex((call) => (
    Array.from(call[0] as unknown as ArrayLike<string>).join("?").includes(fragment)
  ))
}

function firstCallData(method: unknown): Record<string, unknown> {
  const calls = (method as { mock: { calls: unknown[][] } }).mock.calls
  const query = calls[0]?.[0] as { data?: Record<string, unknown> } | undefined
  return query?.data ?? {}
}

describe("manager reopen of today's finished Workforce workday", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWorkdayLookups()
    vi.mocked(getMtmSettings).mockResolvedValue({ timezone: "Asia/Baku" } as never)
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({ features: [] } as never)
    vi.mocked(prisma.workforceAccessGrant.findMany).mockResolvedValue([] as never)
    vi.mocked(prisma.mtmAgentWorkdayEvent.findMany).mockReset().mockResolvedValue(journal as never)
    vi.mocked(prisma.mtmAgentWorkdayEvent.findFirst).mockReset().mockResolvedValue(null as never)
    vi.mocked(prisma.mtmAgentWorkdayEvent.create).mockReset().mockResolvedValue({ id: "event-reopen" } as never)
    vi.mocked(prisma.workforceWorkdayReopen.findFirst).mockReset().mockResolvedValue(null as never)
    vi.mocked(prisma.workforceWorkdayReopen.create).mockReset().mockResolvedValue({ id: "reopen-1" } as never)
    vi.mocked(prisma.mtmAgentWorkday.update).mockReset()
    vi.mocked(prisma.workforceTimeCorrection.findMany).mockReset().mockResolvedValue([] as never)
    vi.mocked(prisma.workforceTimesheetApproval.findFirst).mockReset().mockResolvedValue(null as never)
    vi.mocked(prisma.mtmHrmRequest.findFirst).mockReset().mockResolvedValue(null as never)
  })

  it("pauses the day at its finish and writes the event, ledger, projection and audit in one transaction", async () => {
    const result = await reopen({ audit: { ipAddress: "203.0.113.7", userAgent: "Vitest" } })

    expect(result).toEqual({
      kind: "success",
      idempotent: false,
      data: { reopenId: "reopen-1", eventId: "event-reopen", workday: afterFacts },
    })
    expect(prisma.$transaction).toHaveBeenCalledTimes(1)
    // The journal event sits at the instant the pause starts (the finish);
    // the moment the manager acted is its server receipt/application time.
    expect(prisma.mtmAgentWorkdayEvent.create).toHaveBeenCalledWith({
      select: { id: true },
      data: expect.objectContaining({
        organizationId: ORGANIZATION_ID,
        agentId: AGENT_ID,
        workdayId: WORKDAY_ID,
        clientEventId: "reopen:reopen-operation-1",
        type: "REOPEN",
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
    const eventData = firstCallData(prisma.mtmAgentWorkdayEvent.create)
    expect(prisma.workforceWorkdayReopen.create).toHaveBeenCalledWith({
      select: { id: true },
      data: {
        organizationId: ORGANIZATION_ID,
        agentId: AGENT_ID,
        workdayId: WORKDAY_ID,
        eventId: "event-reopen",
        operationId: input.operationId,
        requestHash: eventData.requestHash,
        actorUserId: MANAGER_USER_ID,
        reason: input.reason,
        beforeFacts,
        afterFacts,
        occurredAt: NOW,
      },
    })
    // The closed-pause total is untouched: RESUME later banks the whole gap
    // from pausedAt, exactly as for an ordinary break.
    expect(prisma.mtmAgentWorkday.update).toHaveBeenCalledWith({
      where: { id: WORKDAY_ID },
      data: { status: "PAUSED", pausedAt: FINISHED_AT, completedAt: null },
    })
    expect(prisma.mtmAuditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: ORGANIZATION_ID,
        agentId: AGENT_ID,
        action: "WORKDAY_REOPEN",
        entity: "workday",
        entityId: WORKDAY_ID,
        metadataKind: "workforce_workday_reopen",
        oldData: { workday: beforeFacts },
        newData: {
          workday: afterFacts,
          reopenId: "reopen-1",
          eventId: "event-reopen",
          actorUserId: MANAGER_USER_ID,
          operationId: input.operationId,
          reason: input.reason,
          authorizationSource: "MANAGER",
        },
        ipAddress: "203.0.113.7",
        userAgent: "Vitest",
      }),
    })

    const reopenContext = executeRawCallIndex("app.workforce_reopen_id")
    expect(reopenContext).toBeGreaterThanOrEqual(0)
    expect(vi.mocked(prisma.$executeRaw).mock.calls[reopenContext]).toContain("reopen-1")
    const order = {
      event: vi.mocked(prisma.mtmAgentWorkdayEvent.create).mock.invocationCallOrder[0]!,
      ledger: vi.mocked(prisma.workforceWorkdayReopen.create).mock.invocationCallOrder[0]!,
      context: vi.mocked(prisma.$executeRaw).mock.invocationCallOrder[reopenContext]!,
      projection: vi.mocked(prisma.mtmAgentWorkday.update).mock.invocationCallOrder[0]!,
      audit: vi.mocked(prisma.mtmAuditLog.create).mock.invocationCallOrder[0]!,
    }
    expect(order.event).toBeLessThan(order.ledger)
    expect(order.ledger).toBeLessThan(order.context)
    expect(order.context).toBeLessThan(order.projection)
    expect(order.projection).toBeLessThan(order.audit)
    expect(executeRawCallIndex("app.workforce_correction_id")).toBe(-1)
  })

  it("reopens within minutes of a finish the phone stamped ahead of the server", async () => {
    // Agent taps "finish" by mistake with a clock three minutes fast, calls the
    // manager, who reopens one minute later by the server's clock.
    const phoneFinish = new Date("2026-09-15T14:33:00.000Z")
    mockWorkdayLookups(completedWorkday({ completedAt: phoneFinish }))
    vi.mocked(prisma.mtmAgentWorkdayEvent.findMany).mockResolvedValue([
      ...journal.slice(0, 3),
      { id: "event-4", type: "FINISH", occurredAt: phoneFinish },
    ] as never)

    await expect(reopen({ now: new Date("2026-09-15T14:31:00.000Z") })).resolves.toMatchObject({
      kind: "success",
      data: { workday: { status: "PAUSED", pausedAt: phoneFinish.toISOString(), completedAt: null } },
    })
    expect(firstCallData(prisma.mtmAgentWorkdayEvent.create)).toMatchObject({
      occurredAt: phoneFinish,
      serverReceivedAt: new Date("2026-09-15T14:31:00.000Z"),
    })
    expect(prisma.mtmAgentWorkday.update).toHaveBeenCalledWith({
      where: { id: WORKDAY_ID },
      data: { status: "PAUSED", pausedAt: phoneFinish, completedAt: null },
    })
  })

  it("serializes with every workday writer and fences the operation key", async () => {
    await reopen()

    expect(executeRawCallIndex("set_config('TimeZone', 'UTC', true)")).toBeGreaterThanOrEqual(0)
    const operationLock = executeRawCallIndex("pg_advisory_xact_lock")
    expect(vi.mocked(prisma.$executeRaw).mock.calls[operationLock]).toContain(
      `workforce-workday-reopen:${ORGANIZATION_ID}:${input.operationId}`,
    )
    expect(vi.mocked(prisma.$executeRaw).mock.calls.some((call) => (
      call.includes(`mtm-workday:${ORGANIZATION_ID}:${AGENT_ID}`)
    ))).toBe(true)
  })

  it("reads the journal in server application order and asks only about this employee's day", async () => {
    await reopen()

    expect(prisma.mtmAgentWorkdayEvent.findMany).toHaveBeenCalledWith({
      where: { organizationId: ORGANIZATION_ID, agentId: AGENT_ID, workdayId: WORKDAY_ID },
      orderBy: [{ occurredAt: "asc" }, { appliedAt: { sort: "asc", nulls: "first" } }, { id: "asc" }],
      select: { id: true, type: true, occurredAt: true, appliedAt: true, clientEventId: true },
    })
    expect(prisma.mtmAgentWorkday.findFirst).toHaveBeenNthCalledWith(3, {
      where: {
        organizationId: ORGANIZATION_ID,
        agentId: AGENT_ID,
        status: { in: ["STARTED", "PAUSED"] },
        id: { not: WORKDAY_ID },
      },
      select: { id: true },
    })
    expect(prisma.workforceTimesheetApproval.findFirst).toHaveBeenCalledWith({
      where: {
        organizationId: ORGANIZATION_ID,
        agentId: AGENT_ID,
        periodStart: { lte: new Date("2026-09-15T00:00:00.000Z") },
        periodEnd: { gte: new Date("2026-09-15T00:00:00.000Z") },
      },
      select: { id: true },
    })
    expect(prisma.mtmHrmRequest.findFirst).toHaveBeenCalledWith({
      where: {
        organizationId: ORGANIZATION_ID,
        agentId: AGENT_ID,
        type: "TIME_CORRECTION",
        status: "PENDING",
        correctionWorkdayId: WORKDAY_ID,
      },
      select: { id: true },
    })
  })

  it("returns 404 semantics for an unknown workday before any transaction", async () => {
    vi.mocked(prisma.mtmAgentWorkday.findFirst).mockReset().mockResolvedValueOnce(null as never)

    await expect(reopen()).resolves.toEqual({ kind: "not_found" })
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it("does not let an employee reopen their own day", async () => {
    await expect(reopen({
      userId: AGENT_USER_ID,
      actor: { agentId: AGENT_ID, role: "MANAGER", scopedAgentIds: [AGENT_ID] },
    })).resolves.toEqual({ kind: "forbidden" })
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it("does not let a web admin reopen the day of the employee linked to the same user", async () => {
    await expect(reopen({
      userId: AGENT_USER_ID,
      actor: { agentId: null, role: "ADMIN", scopedAgentIds: null },
    })).resolves.toEqual({ kind: "forbidden" })
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it.each([
    ["an agent", { agentId: "agent-2", role: "AGENT" as const, scopedAgentIds: [AGENT_ID] }],
    ["a manager of another team", { agentId: "manager-agent-2", role: "MANAGER" as const, scopedAgentIds: ["agent-9"] }],
    ["a principal without a Workforce actor", null],
  ])("refuses %s before granular cutover", async (_label, actor) => {
    await expect(reopen({ actor })).resolves.toEqual({ kind: "forbidden" })
    expect(prisma.workforceWorkdayReopen.findFirst).not.toHaveBeenCalled()
    expectNothingWritten()
  })

  it("requires a TIME_CORRECT grant after granular cutover, even for a legacy manager", async () => {
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({ features: [WORKFORCE_GRANULAR_ACCESS_FLAG] } as never)

    await expect(reopen()).resolves.toEqual({ kind: "forbidden" })
    expectNothingWritten()
  })

  it("lets a grant-only time approver reopen another employee's day", async () => {
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({ features: [WORKFORCE_GRANULAR_ACCESS_FLAG] } as never)
    vi.mocked(prisma.workforceAccessGrant.findMany).mockResolvedValue(timeApproverGrant() as never)

    await expect(reopen({ actor: null })).resolves.toMatchObject({ kind: "success", idempotent: false })
    expect(prisma.mtmAuditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        newData: expect.objectContaining({ authorizationSource: "WORKFORCE_GRANT" }),
      }),
    })
  })

  it.each([
    [
      "WORKFORCE_WORKDAY_REOPEN_NOT_COMPLETED",
      "a day that is still running",
      () => mockWorkdayLookups(completedWorkday({ status: "STARTED", completedAt: null })),
    ],
    [
      "WORKFORCE_WORKDAY_REOPEN_NOT_TODAY",
      "yesterday's finished day",
      () => mockWorkdayLookups(completedWorkday({
        workDate: new Date("2026-09-14T00:00:00.000Z"),
        startedAt: new Date("2026-09-14T05:00:00.000Z"),
        completedAt: new Date("2026-09-14T14:00:00.000Z"),
      })),
    ],
    [
      "WORKFORCE_WORKDAY_REOPEN_VERSION_CONFLICT",
      "a day changed since the manager opened it",
      () => mockWorkdayLookups(completedWorkday({ updatedAt: new Date("2026-09-15T14:05:00.000Z") })),
    ],
    [
      "WORKFORCE_WORKDAY_REOPEN_OPEN_SHIFT_EXISTS",
      "an employee with another open shift",
      () => vi.mocked(prisma.mtmAgentWorkday.findFirst).mockResolvedValueOnce({ id: "workday-open" } as never),
    ],
    [
      "WORKFORCE_WORKDAY_REOPEN_TIMESHEET_APPROVED",
      "a day inside an approved timesheet",
      () => vi.mocked(prisma.workforceTimesheetApproval.findFirst).mockResolvedValue({ id: "approval-1" } as never),
    ],
    [
      "WORKFORCE_WORKDAY_REOPEN_CORRECTION_PENDING",
      "a day with a pending time-correction request",
      () => vi.mocked(prisma.mtmHrmRequest.findFirst).mockResolvedValue({ id: "request-1" } as never),
    ],
    [
      "WORKFORCE_WORKDAY_REOPEN_CORRECTED",
      "a day that already has a correction",
      () => vi.mocked(prisma.workforceTimeCorrection.findMany).mockResolvedValue([{ id: "correction-1" }] as never),
    ],
    [
      "WORKFORCE_WORKDAY_REOPEN_HISTORY_INVALID",
      "a day whose journal no longer reproduces the row",
      () => vi.mocked(prisma.mtmAgentWorkdayEvent.findMany).mockResolvedValue(
        journal.filter((event) => event.type !== "RESUME") as never,
      ),
    ],
  ])("answers %s for %s without writing anything", async (code, _label, arrange) => {
    arrange()

    const result = await reopen()

    expect(result).toMatchObject({ kind: "conflict", code, currentWorkday: { id: WORKDAY_ID } })
    expectNothingWritten()
  })

  it("decides today in the tenant timezone, not in UTC", async () => {
    // 20:30Z on the 15th is already 00:30 on the 16th in Baku.
    await expect(reopen({ now: new Date("2026-09-15T20:30:00.000Z") })).resolves.toMatchObject({
      kind: "conflict",
      code: "WORKFORCE_WORKDAY_REOPEN_NOT_TODAY",
    })
    expect(getMtmSettings).toHaveBeenCalledWith(ORGANIZATION_ID)

    mockWorkdayLookups()
    vi.mocked(getMtmSettings).mockResolvedValue({ timezone: "UTC" } as never)
    await expect(reopen({ now: new Date("2026-09-15T20:30:00.000Z") })).resolves.toMatchObject({ kind: "success" })
  })

  it("acknowledges a retried operation once more without applying it twice", async () => {
    await reopen()
    const requestHash = firstCallData(prisma.workforceWorkdayReopen.create).requestHash
    vi.clearAllMocks()
    vi.mocked(prisma.mtmAgentWorkdayEvent.create).mockReset()
    vi.mocked(prisma.workforceWorkdayReopen.create).mockReset()
    vi.mocked(prisma.mtmAgentWorkday.update).mockReset()
    vi.mocked(prisma.workforceWorkdayReopen.findFirst).mockResolvedValue({
      id: "reopen-1",
      workdayId: WORKDAY_ID,
      agentId: AGENT_ID,
      eventId: "event-reopen",
      actorUserId: MANAGER_USER_ID,
      requestHash,
    } as never)
    // The employee already resumed after the first, successful response.
    mockWorkdayLookups(completedWorkday({
      status: "STARTED",
      pausedAt: null,
      completedAt: null,
      totalPausedSeconds: 30 * 60 + 20 * 60,
    }))

    const retried = await reopen()

    expect(retried).toEqual({
      kind: "success",
      idempotent: true,
      data: {
        reopenId: "reopen-1",
        eventId: "event-reopen",
        workday: { ...beforeFacts, status: "STARTED", completedAt: null, totalPausedSeconds: 50 * 60 },
      },
    })
    expectNothingWritten()
  })

  it.each([
    ["a different reason", { input: { ...input, reason: "Another explanation" } }],
    ["a different expected version", { input: { ...input, expectedUpdatedAt: "2026-09-15T14:00:02.000Z" } }],
    ["a different manager", { userId: "manager-user-2" }],
  ])("refuses to reuse an operation id with %s", async (_label, overrides) => {
    await reopen()
    const requestHash = firstCallData(prisma.workforceWorkdayReopen.create).requestHash
    vi.clearAllMocks()
    vi.mocked(prisma.mtmAgentWorkdayEvent.create).mockReset()
    vi.mocked(prisma.workforceWorkdayReopen.create).mockReset()
    vi.mocked(prisma.mtmAgentWorkday.update).mockReset()
    mockWorkdayLookups()
    vi.mocked(prisma.workforceWorkdayReopen.findFirst).mockResolvedValue({
      id: "reopen-1",
      workdayId: WORKDAY_ID,
      agentId: AGENT_ID,
      eventId: "event-reopen",
      actorUserId: MANAGER_USER_ID,
      requestHash,
    } as never)

    await expect(reopen(overrides)).resolves.toMatchObject({
      kind: "conflict",
      code: "WORKFORCE_WORKDAY_REOPEN_IDEMPOTENCY_MISMATCH",
    })
    expectNothingWritten()
  })

  it("refuses an operation id whose journal key already belongs to another event", async () => {
    vi.mocked(prisma.mtmAgentWorkdayEvent.findFirst).mockResolvedValue({ id: "event-foreign" } as never)

    await expect(reopen()).resolves.toMatchObject({
      kind: "conflict",
      code: "WORKFORCE_WORKDAY_REOPEN_IDEMPOTENCY_MISMATCH",
    })
    expect(prisma.mtmAgentWorkdayEvent.findFirst).toHaveBeenCalledWith({
      where: { organizationId: ORGANIZATION_ID, agentId: AGENT_ID, clientEventId: "reopen:reopen-operation-1" },
      select: { id: true },
    })
    expectNothingWritten()
  })

  describe("request body", () => {
    it("requires a real reason and refuses any time or unknown field", () => {
      expect(WorkforceWorkdayReopenSchema.safeParse(input).success).toBe(true)
      expect(WorkforceWorkdayReopenSchema.parse({ ...input, reason: "   Forgot the last visit  " }).reason)
        .toBe("Forgot the last visit")
      expect(WorkforceWorkdayReopenSchema.safeParse({ ...input, reason: "  ok  " }).success).toBe(false)
      expect(WorkforceWorkdayReopenSchema.safeParse({ ...input, reason: "x".repeat(1001) }).success).toBe(false)
      expect(WorkforceWorkdayReopenSchema.safeParse({ operationId: input.operationId, expectedUpdatedAt: input.expectedUpdatedAt }).success)
        .toBe(false)
      expect(WorkforceWorkdayReopenSchema.safeParse({ ...input, operationId: "short" }).success).toBe(false)
      expect(WorkforceWorkdayReopenSchema.safeParse({ ...input, expectedUpdatedAt: "yesterday" }).success).toBe(false)
      expect(WorkforceWorkdayReopenSchema.safeParse({ ...input, pausedAt: "2026-09-15T14:00:00.000Z" }).success).toBe(false)
    })
  })
})

/**
 * The same flow through the real state machine and the real reopen service
 * over an in-memory journal: what the workday row banks must be exactly what
 * the immutable journal replays, and the gap must never become worked time.
 */
describe("reopened workday through the canonical state machine", () => {
  const SCOPE = { organizationId: ORGANIZATION_ID, agentId: AGENT_ID }
  let memory: InMemoryWorkdayJournal

  /** Moves the one server clock every writer reads (`new Date()` included). */
  function serverClockAt(at: string): Date {
    const now = new Date(at)
    vi.setSystemTime(now)
    memory.setClock(now)
    return now
  }

  /** An employee action stamped by the phone at `phoneAt`, received at `serverAt`. */
  async function act(action: "START" | "PAUSE" | "RESUME" | "FINISH", phoneAt: string, serverAt: string = phoneAt) {
    const received = serverClockAt(serverAt)
    const parsed = parseMtmWorkdayEvent(
      action === "START"
        ? { action, id: WORKDAY_ID, occurredAt: phoneAt }
        : { action, workdayId: WORKDAY_ID, occurredAt: phoneAt },
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

  function managerReopensAt(serverAt: string) {
    const now = serverClockAt(serverAt)
    return reopenWorkforceWorkday({
      organizationId: ORGANIZATION_ID,
      userId: MANAGER_USER_ID,
      actor: MANAGER,
      workdayId: WORKDAY_ID,
      input: {
        operationId: `reopen-${serverAt}`,
        expectedUpdatedAt: (row().updatedAt as Date).toISOString(),
        reason: "Finished by mistake",
      },
      now,
    })
  }

  beforeEach(() => {
    vi.clearAllMocks()
    // Only Date is faked: the state machine stamps appliedAt with new Date(),
    // and the journal orders a REOPEN after its FINISH by that server time.
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.mocked(getMtmSettings).mockResolvedValue({ timezone: "Asia/Baku" } as never)
    vi.mocked(prisma.organization.findUnique).mockReset().mockResolvedValue({ features: [] } as never)
    vi.mocked(prisma.workforceTimeCorrection.findMany).mockReset().mockResolvedValue([] as never)
    vi.mocked(prisma.workforceTimesheetApproval.findFirst).mockReset().mockResolvedValue(null as never)
    vi.mocked(prisma.mtmHrmRequest.findFirst).mockReset().mockResolvedValue(null as never)
    memory = installInMemoryWorkdayJournal(prisma as unknown as MtmPrismaMock, { agentUserId: AGENT_USER_ID })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("banks the gap from the first finish to RESUME as pause and replays the row exactly", async () => {
    await act("START", "2026-09-15T05:00:00.000Z")
    await act("FINISH", "2026-09-15T13:00:00.000Z")

    await expect(managerReopensAt("2026-09-15T13:20:00.000Z")).resolves.toMatchObject({ kind: "success" })
    expect(row()).toMatchObject({
      status: "PAUSED",
      pausedAt: new Date("2026-09-15T13:00:00.000Z"),
      completedAt: null,
      totalPausedSeconds: 0,
    })
    expect(memory.journal(WORKDAY_ID).at(-1)).toMatchObject({
      type: "REOPEN",
      occurredAt: new Date("2026-09-15T13:00:00.000Z"),
      appliedAt: new Date("2026-09-15T13:20:00.000Z"),
    })
    expect(memory.reopens[0]).toMatchObject({ occurredAt: new Date("2026-09-15T13:20:00.000Z") })
    replayMatchesRow()

    await expect(act("RESUME", "2026-09-15T13:50:00.000Z")).resolves.toMatchObject({ status: "ok" })
    await expect(act("FINISH", "2026-09-15T15:00:00.000Z")).resolves.toMatchObject({ status: "ok" })

    expect(row()).toMatchObject({
      status: "COMPLETED",
      completedAt: new Date("2026-09-15T15:00:00.000Z"),
      totalPausedSeconds: 50 * 60,
    })
    const facts = replayMatchesRow()
    expect(memory.journal(WORKDAY_ID).map((event) => event.type)).toEqual(["START", "FINISH", "REOPEN", "RESUME", "FINISH"])
    expect(calculateWorkforceTimesheetDay({
      asOf: "2026-09-15T15:00:00.000Z",
      schedule: {
        shiftSnapshotId: "shift-snapshot-v1",
        workDate: "2026-09-15",
        timezone: "Asia/Baku",
        plannedStartAt: "2026-09-15T05:00:00.000Z",
        plannedEndAt: "2026-09-15T14:00:00.000Z",
      },
      policySnapshot: {
        snapshotId: "policy-snapshot-v1",
        expectedWorkSeconds: 8 * 60 * 60,
        lateGraceSeconds: 5 * 60,
        undertimeToleranceSeconds: 5 * 60,
        overtimeThresholdSeconds: 15 * 60,
        longPauseThresholdSeconds: null,
      },
      facts,
    }).fact).toMatchObject({ workedSeconds: 10 * 60 * 60 - 50 * 60, pausedSeconds: 50 * 60 })
  })

  it("reopens one minute after a finish the phone stamped three minutes ahead", async () => {
    await act("START", "2026-09-15T05:00:00.000Z")
    await expect(act("FINISH", "2026-09-15T13:03:00.000Z", "2026-09-15T13:00:00.000Z"))
      .resolves.toMatchObject({ status: "ok" })

    await expect(managerReopensAt("2026-09-15T13:01:00.000Z")).resolves.toMatchObject({
      kind: "success",
      data: { workday: { status: "PAUSED", pausedAt: "2026-09-15T13:03:00.000Z" } },
    })
    replayMatchesRow()

    await expect(act("RESUME", "2026-09-15T13:06:00.000Z", "2026-09-15T13:05:00.000Z"))
      .resolves.toMatchObject({ status: "ok" })
    await expect(act("FINISH", "2026-09-15T15:00:00.000Z")).resolves.toMatchObject({ status: "ok" })
    expect(row()).toMatchObject({ status: "COMPLETED", totalPausedSeconds: 3 * 60 })
    replayMatchesRow()
  })

  it("refuses a RESUME that claims the closed time before the reopen as work", async () => {
    await act("START", "2026-09-15T05:00:00.000Z")
    await act("FINISH", "2026-09-15T13:00:00.000Z")
    await expect(managerReopensAt("2026-09-15T13:20:00.000Z")).resolves.toMatchObject({ kind: "success" })

    // Arrives a minute after the reopen but claims 13:06, while the day was
    // still closed: 13:06-13:20 would otherwise count as work.
    await expect(act("RESUME", "2026-09-15T13:06:00.000Z", "2026-09-15T13:21:00.000Z")).resolves.toMatchObject({
      status: "conflict",
      code: "MTM_WORKDAY_EVENT_OUT_OF_ORDER",
      riskCodes: ["CLAIM_BEFORE_REOPEN"],
    })
    expect(row()).toMatchObject({ status: "PAUSED", pausedAt: new Date("2026-09-15T13:00:00.000Z"), totalPausedSeconds: 0 })
    expect(memory.journal(WORKDAY_ID).map((event) => event.type)).toEqual(["START", "FINISH", "REOPEN"])
    replayMatchesRow()

    // A journal carrying such a RESUME anyway does not replay either.
    expect(() => replayWorkforceWorkdayFacts({
      workdayId: WORKDAY_ID,
      events: [...memory.journalFacts(WORKDAY_ID), {
        id: "forged-resume",
        type: "RESUME",
        occurredAt: "2026-09-15T13:06:00.000Z",
        appliedAt: "2026-09-15T13:21:00.000Z",
        clientEventId: "resume-forged",
      }],
    })).toThrow("workday event after a reopen cannot claim time before the reopen")
  })

  it("refuses a FINISH that claims the closed time before the reopen", async () => {
    await act("START", "2026-09-15T05:00:00.000Z")
    await act("FINISH", "2026-09-15T13:00:00.000Z")
    await managerReopensAt("2026-09-15T13:20:00.000Z")

    await expect(act("FINISH", "2026-09-15T13:10:00.000Z", "2026-09-15T13:22:00.000Z")).resolves.toMatchObject({
      status: "conflict",
      code: "MTM_WORKDAY_EVENT_OUT_OF_ORDER",
      riskCodes: ["CLAIM_BEFORE_REOPEN"],
    })
    expect(row()).toMatchObject({ status: "PAUSED", completedAt: null })
    replayMatchesRow()
  })

  it("accepts a RESUME within the phone clock allowance and banks the pause up to its claim", async () => {
    await act("START", "2026-09-15T05:00:00.000Z")
    await act("FINISH", "2026-09-15T13:00:00.000Z")
    await expect(managerReopensAt("2026-09-15T13:20:00.000Z")).resolves.toMatchObject({ kind: "success" })

    // 13:17 is within five minutes of the 13:20 reopen: a phone running behind.
    await expect(act("RESUME", "2026-09-15T13:17:00.000Z", "2026-09-15T13:21:00.000Z"))
      .resolves.toMatchObject({ status: "ok" })

    expect(row()).toMatchObject({ status: "STARTED", pausedAt: null, totalPausedSeconds: 17 * 60 })
    const facts = replayMatchesRow()
    expect(facts.pauseIntervals).toEqual([{ startedAt: "2026-09-15T13:00:00.000Z", endedAt: "2026-09-15T13:17:00.000Z" }])
  })

  it("still refuses a RESUME claimed before the finish it would continue", async () => {
    await act("START", "2026-09-15T05:00:00.000Z")
    await act("FINISH", "2026-09-15T13:00:00.000Z")
    await managerReopensAt("2026-09-15T13:20:00.000Z")

    await expect(act("RESUME", "2026-09-15T12:59:00.000Z", "2026-09-15T13:21:00.000Z")).resolves.toMatchObject({
      status: "conflict",
      code: "MTM_WORKDAY_EVENT_OUT_OF_ORDER",
    })
    replayMatchesRow()
  })

  it("banks the whole reopened pause when the employee finishes again without resuming", async () => {
    await act("START", "2026-09-15T05:00:00.000Z")
    await act("FINISH", "2026-09-15T13:00:00.000Z")
    await expect(managerReopensAt("2026-09-15T13:20:00.000Z")).resolves.toMatchObject({ kind: "success" })
    await act("FINISH", "2026-09-15T14:00:00.000Z")

    expect(row()).toMatchObject({ status: "COMPLETED", totalPausedSeconds: 60 * 60 })
    replayMatchesRow()
  })

  it("lets a day finished again be reopened again and still replays", async () => {
    await act("START", "2026-09-15T05:00:00.000Z")
    await act("FINISH", "2026-09-15T12:00:00.000Z")
    await expect(managerReopensAt("2026-09-15T12:10:00.000Z")).resolves.toMatchObject({ kind: "success" })
    await act("RESUME", "2026-09-15T12:30:00.000Z")
    await act("FINISH", "2026-09-15T15:00:00.000Z")
    await expect(managerReopensAt("2026-09-15T15:05:00.000Z")).resolves.toMatchObject({ kind: "success" })
    await act("RESUME", "2026-09-15T15:15:00.000Z")
    await act("FINISH", "2026-09-15T17:00:00.000Z")

    expect(row()).toMatchObject({ status: "COMPLETED", totalPausedSeconds: 45 * 60 })
    expect(memory.reopens).toHaveLength(2)
    replayMatchesRow()
  })

  it("refuses a reopen of a running day and never journals a REOPEN for it", async () => {
    await act("START", "2026-09-15T05:00:00.000Z")

    await expect(managerReopensAt("2026-09-15T06:00:00.000Z")).resolves.toMatchObject({
      kind: "conflict",
      code: "WORKFORCE_WORKDAY_REOPEN_NOT_COMPLETED",
    })
    expect(memory.events.map((event) => event.type)).toEqual(["START"])
    expect(memory.reopens).toHaveLength(0)
  })
})
