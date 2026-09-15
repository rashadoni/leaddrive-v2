import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/prisma", async () => {
  const { makeMtmPrismaMock } = await import("./mocks/mtm-prisma")
  return { prisma: makeMtmPrismaMock() }
})
vi.mock("@/lib/mtm-settings", () => ({
  getMtmSettings: vi.fn(async () => ({ timezone: "Asia/Baku" })),
}))

import { prisma } from "@/lib/prisma"
import { getMtmSettings } from "@/lib/mtm-settings"
import { applyMtmWorkdayEvent, parseMtmWorkdayEvent } from "@/lib/mtm/workday"
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

const ORGANIZATION_ID = "org-workforce"
const WORKDAY_ID = "workday-1"
const AGENT_ID = "agent-1"
const AGENT_USER_ID = "agent-user-1"
const MANAGER_USER_ID = "manager-user-1"
const MANAGER = { agentId: "manager-agent-1", role: "MANAGER" as const, scopedAgentIds: [AGENT_ID] }
// Asia/Baku is UTC+4: 14:30Z is 18:30 on the same local day as the workday.
const NOW = new Date("2026-09-15T14:30:00.000Z")
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
    completedAt: new Date("2026-09-15T14:00:00.000Z"),
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
  { id: "event-4", type: "FINISH", occurredAt: new Date("2026-09-15T14:00:00.000Z") },
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

describe("manager reopen of today's finished Workforce workday", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWorkdayLookups()
    vi.mocked(getMtmSettings).mockResolvedValue({ timezone: "Asia/Baku" } as never)
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({ features: [] } as never)
    vi.mocked(prisma.workforceAccessGrant.findMany).mockResolvedValue([] as never)
    vi.mocked(prisma.mtmAgentWorkdayEvent.findMany).mockResolvedValue(journal as never)
    vi.mocked(prisma.mtmAgentWorkdayEvent.findFirst).mockResolvedValue(null as never)
    vi.mocked(prisma.mtmAgentWorkdayEvent.create).mockResolvedValue({ id: "event-reopen" } as never)
    vi.mocked(prisma.workforceWorkdayReopen.findFirst).mockResolvedValue(null as never)
    vi.mocked(prisma.workforceWorkdayReopen.create).mockResolvedValue({ id: "reopen-1" } as never)
    vi.mocked(prisma.workforceTimeCorrection.findMany).mockResolvedValue([] as never)
    vi.mocked(prisma.workforceTimesheetApproval.findFirst).mockResolvedValue(null as never)
    vi.mocked(prisma.mtmHrmRequest.findFirst).mockResolvedValue(null as never)
  })

  it("pauses the day at its finish and writes the event, ledger, projection and audit in one transaction", async () => {
    const result = await reopen({ audit: { ipAddress: "203.0.113.7", userAgent: "Vitest" } })

    expect(result).toEqual({
      kind: "success",
      idempotent: false,
      data: { reopenId: "reopen-1", eventId: "event-reopen", workday: afterFacts },
    })
    expect(prisma.$transaction).toHaveBeenCalledTimes(1)
    expect(prisma.mtmAgentWorkdayEvent.create).toHaveBeenCalledWith({
      select: { id: true },
      data: expect.objectContaining({
        organizationId: ORGANIZATION_ID,
        agentId: AGENT_ID,
        workdayId: WORKDAY_ID,
        clientEventId: "reopen:reopen-operation-1",
        type: "REOPEN",
        occurredAt: NOW,
        claimedAt: NOW,
        serverReceivedAt: NOW,
        appliedAt: NOW,
        schemaVersion: 4,
        requestHash: expect.stringMatching(/^[0-9a-f]{64}$/),
        attendanceReviewState: "NOT_REQUIRED",
        attendanceReviewReasonCode: null,
        note: input.reason,
      }),
    })
    const eventData = vi.mocked(prisma.mtmAgentWorkdayEvent.create).mock.calls[0]![0] as unknown as { data: { requestHash: string } }
    expect(prisma.workforceWorkdayReopen.create).toHaveBeenCalledWith({
      select: { id: true },
      data: {
        organizationId: ORGANIZATION_ID,
        agentId: AGENT_ID,
        workdayId: WORKDAY_ID,
        eventId: "event-reopen",
        operationId: input.operationId,
        requestHash: eventData.data.requestHash,
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
      data: { status: "PAUSED", pausedAt: new Date("2026-09-15T14:00:00.000Z"), completedAt: null },
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

  it("asks only about this employee's other open shift, approvals covering the date, and pending corrections of this day", async () => {
    await reopen()

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
    mockWorkdayLookups(null)
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
    [
      "WORKFORCE_WORKDAY_REOPEN_HISTORY_INVALID",
      "a finish claimed later than the server clock",
      () => {
        mockWorkdayLookups(completedWorkday({ completedAt: new Date("2026-09-15T14:33:00.000Z") }))
        vi.mocked(prisma.mtmAgentWorkdayEvent.findMany).mockResolvedValue([
          ...journal.slice(0, 3),
          { id: "event-4", type: "FINISH", occurredAt: new Date("2026-09-15T14:33:00.000Z") },
        ] as never)
      },
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
    const ledger = vi.mocked(prisma.workforceWorkdayReopen.create).mock.calls[0]![0] as unknown as {
      data: { requestHash: string }
    }
    vi.clearAllMocks()
    vi.mocked(prisma.workforceWorkdayReopen.findFirst).mockResolvedValue({
      id: "reopen-1",
      workdayId: WORKDAY_ID,
      agentId: AGENT_ID,
      eventId: "event-reopen",
      actorUserId: MANAGER_USER_ID,
      requestHash: ledger.data.requestHash,
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
    const ledger = vi.mocked(prisma.workforceWorkdayReopen.create).mock.calls[0]![0] as unknown as {
      data: { requestHash: string }
    }
    vi.clearAllMocks()
    mockWorkdayLookups()
    vi.mocked(prisma.workforceWorkdayReopen.findFirst).mockResolvedValue({
      id: "reopen-1",
      workdayId: WORKDAY_ID,
      agentId: AGENT_ID,
      eventId: "event-reopen",
      actorUserId: MANAGER_USER_ID,
      requestHash: ledger.data.requestHash,
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
  type Row = Record<string, unknown>
  const SCOPE = { organizationId: ORGANIZATION_ID, agentId: AGENT_ID }
  let clock = new Date("2026-09-15T00:00:00.000Z")
  let workdays: Map<string, Row>
  let events: Row[]
  let reopens: Row[]

  function matches(row: Row, where: Record<string, unknown> = {}): boolean {
    return Object.entries(where).every(([key, condition]) => {
      const value = row[key]
      if (condition instanceof Date) return value instanceof Date && value.getTime() === condition.getTime()
      if (condition && typeof condition === "object") {
        const filter = condition as { in?: unknown[]; not?: unknown }
        if (filter.in) return filter.in.includes(value)
        if ("not" in filter) return value !== filter.not
        throw new Error(`unsupported filter on ${key}`)
      }
      return value === condition
    })
  }

  function byOccurredAt(direction: "asc" | "desc") {
    return (left: Row, right: Row) => {
      const delta = (left.occurredAt as Date).getTime() - (right.occurredAt as Date).getTime()
      return direction === "asc" ? delta || String(left.id).localeCompare(String(right.id)) : -delta
    }
  }

  function workdayRow(id = WORKDAY_ID): Row {
    const row = workdays.get(id)
    if (!row) throw new Error("workday missing")
    return row
  }

  async function act(action: "START" | "PAUSE" | "RESUME" | "FINISH", occurredAt: string) {
    clock = new Date(occurredAt)
    const parsed = parseMtmWorkdayEvent(
      action === "START"
        ? { action, id: WORKDAY_ID, occurredAt }
        : { action, workdayId: WORKDAY_ID, occurredAt },
      `${action.toLowerCase()}-${occurredAt}`,
      "Asia/Baku",
      clock,
    )
    expect(parsed.error).toBeNull()
    const result = await applyMtmWorkdayEvent(prisma as never, SCOPE, parsed.input!)
    expect(result.status).toBe("ok")
  }

  function replayMatchesRow() {
    const facts = replayWorkforceWorkdayFacts({
      workdayId: WORKDAY_ID,
      events: [...events].sort(byOccurredAt("asc")).map((event) => ({
        id: String(event.id),
        type: event.type as "START",
        occurredAt: (event.occurredAt as Date).toISOString(),
      })),
    })
    const row = workdayRow()
    expect(workforceReplayMatchesWorkdayCorrectionFacts(facts, workforceWorkdayCorrectionFacts(row as never))).toBe(true)
    return facts
  }

  async function managerReopensAt(at: string) {
    clock = new Date(at)
    return reopenWorkforceWorkday({
      organizationId: ORGANIZATION_ID,
      userId: MANAGER_USER_ID,
      actor: MANAGER,
      workdayId: WORKDAY_ID,
      input: {
        operationId: `reopen-${at}`,
        expectedUpdatedAt: (workdayRow().updatedAt as Date).toISOString(),
        reason: "Finished by mistake",
      },
      now: clock,
    })
  }

  beforeEach(() => {
    vi.clearAllMocks()
    workdays = new Map()
    events = []
    reopens = []
    vi.mocked(getMtmSettings).mockResolvedValue({ timezone: "Asia/Baku" } as never)
    vi.mocked(prisma.organization.findUnique).mockReset().mockResolvedValue({ features: [] } as never)
    vi.mocked(prisma.workforceTimeCorrection.findMany).mockReset().mockResolvedValue([] as never)
    vi.mocked(prisma.workforceTimesheetApproval.findFirst).mockReset().mockResolvedValue(null as never)
    vi.mocked(prisma.mtmHrmRequest.findFirst).mockReset().mockResolvedValue(null as never)
    vi.mocked(prisma.mtmAgentWorkday.findFirst).mockReset().mockImplementation((async (args: { where?: Row }) => {
      const row = [...workdays.values()].find((candidate) => matches(candidate, args.where))
      return row ? { ...row, agent: { userId: AGENT_USER_ID } } : null
    }) as never)
    vi.mocked(prisma.mtmAgentWorkday.create).mockReset().mockImplementation((async (args: { data: Row }) => {
      const row = { totalPausedSeconds: 0, pausedAt: null, completedAt: null, ...args.data, createdAt: clock, updatedAt: clock }
      workdays.set(String(row.id), row)
      return { ...row }
    }) as never)
    vi.mocked(prisma.mtmAgentWorkday.update).mockReset().mockImplementation((async (args: { where: { id: string }; data: Row }) => {
      const row = { ...workdayRow(args.where.id), ...args.data, updatedAt: clock }
      workdays.set(args.where.id, row)
      return { ...row }
    }) as never)
    vi.mocked(prisma.mtmAgentWorkdayEvent.findFirst).mockReset().mockImplementation((async (args: {
      where?: Row
      orderBy?: { occurredAt?: "asc" | "desc" }
    }) => {
      const found = events.filter((event) => matches(event, args.where)).sort(byOccurredAt(args.orderBy?.occurredAt ?? "asc"))
      return found[0] ?? null
    }) as never)
    vi.mocked(prisma.mtmAgentWorkdayEvent.findMany).mockReset().mockImplementation((async (args: { where?: Row }) => (
      events.filter((event) => matches(event, args.where)).sort(byOccurredAt("asc"))
    )) as never)
    vi.mocked(prisma.mtmAgentWorkdayEvent.create).mockReset().mockImplementation((async (args: { data: Row }) => {
      const event = { id: `event-${events.length + 1}`, ...args.data }
      events.push(event)
      return { ...event }
    }) as never)
    vi.mocked(prisma.workforceWorkdayReopen.findFirst).mockReset().mockImplementation((async (args: { where?: Row }) => (
      reopens.find((reopenRow) => matches(reopenRow, args.where)) ?? null
    )) as never)
    vi.mocked(prisma.workforceWorkdayReopen.create).mockReset().mockImplementation((async (args: { data: Row }) => {
      const reopenRow = { id: `reopen-${reopens.length + 1}`, ...args.data }
      reopens.push(reopenRow)
      return { id: reopenRow.id }
    }) as never)
  })

  it("banks the gap from the first finish to RESUME as pause and replays the row exactly", async () => {
    await act("START", "2026-09-15T05:00:00.000Z")
    await act("FINISH", "2026-09-15T13:00:00.000Z")

    await expect(managerReopensAt("2026-09-15T13:20:00.000Z")).resolves.toMatchObject({ kind: "success" })
    expect(workdayRow()).toMatchObject({
      status: "PAUSED",
      pausedAt: new Date("2026-09-15T13:00:00.000Z"),
      completedAt: null,
      totalPausedSeconds: 0,
    })
    replayMatchesRow()

    await act("RESUME", "2026-09-15T13:50:00.000Z")
    await act("FINISH", "2026-09-15T15:00:00.000Z")

    expect(workdayRow()).toMatchObject({
      status: "COMPLETED",
      completedAt: new Date("2026-09-15T15:00:00.000Z"),
      totalPausedSeconds: 50 * 60,
    })
    const facts = replayMatchesRow()
    expect(events.map((event) => event.type)).toEqual(["START", "FINISH", "REOPEN", "RESUME", "FINISH"])
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

  it("banks the whole reopened pause when the employee finishes again without resuming", async () => {
    await act("START", "2026-09-15T05:00:00.000Z")
    await act("FINISH", "2026-09-15T13:00:00.000Z")
    await expect(managerReopensAt("2026-09-15T13:20:00.000Z")).resolves.toMatchObject({ kind: "success" })
    await act("FINISH", "2026-09-15T14:00:00.000Z")

    expect(workdayRow()).toMatchObject({ status: "COMPLETED", totalPausedSeconds: 60 * 60 })
    replayMatchesRow()
  })

  it("keeps the employee from resuming before the moment of the reopen", async () => {
    await act("START", "2026-09-15T05:00:00.000Z")
    await act("FINISH", "2026-09-15T13:00:00.000Z")
    await managerReopensAt("2026-09-15T13:20:00.000Z")

    clock = new Date("2026-09-15T13:21:00.000Z")
    const parsed = parseMtmWorkdayEvent(
      { action: "RESUME", workdayId: WORKDAY_ID, occurredAt: "2026-09-15T13:10:00.000Z" },
      "resume-before-reopen",
      "Asia/Baku",
      clock,
    )
    await expect(applyMtmWorkdayEvent(prisma as never, SCOPE, parsed.input!)).resolves.toMatchObject({
      status: "conflict",
      code: "MTM_WORKDAY_EVENT_OUT_OF_ORDER",
    })
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

    expect(workdayRow()).toMatchObject({ status: "COMPLETED", totalPausedSeconds: 45 * 60 })
    expect(reopens).toHaveLength(2)
    replayMatchesRow()
  })

  it("refuses a reopen of a running day and never journals a REOPEN for it", async () => {
    await act("START", "2026-09-15T05:00:00.000Z")

    await expect(managerReopensAt("2026-09-15T06:00:00.000Z")).resolves.toMatchObject({
      kind: "conflict",
      code: "WORKFORCE_WORKDAY_REOPEN_NOT_COMPLETED",
    })
    expect(events.map((event) => event.type)).toEqual(["START"])
    expect(reopens).toHaveLength(0)
  })
})
