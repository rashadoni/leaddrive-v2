import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/prisma", async () => {
  const { makeMtmPrismaMock } = await import("./mocks/mtm-prisma")
  return { prisma: makeMtmPrismaMock() }
})

import { prisma } from "@/lib/prisma"
import { decideWorkforceRequest } from "@/lib/workforce/request-decision"

const PENDING_CORRECTION = {
  id: "request-1",
  agentId: "agent-1",
  type: "TIME_CORRECTION",
  status: "PENDING",
  startDate: new Date("2026-08-28T00:00:00.000Z"),
  endDate: new Date("2026-08-28T00:00:00.000Z"),
  correctionWorkdayId: "workday-1",
  exceptionCaseId: null,
  requestedStartAt: null,
  requestedEndAt: new Date("2026-08-28T07:30:00.000Z"),
  reason: "Fix finish time",
  decisionNote: null,
  submittedAt: new Date("2026-08-28T08:30:00.000Z"),
  decidedAt: null,
  updatedAt: new Date("2026-08-28T09:00:00.000Z"),
  correctionWorkday: null,
}

const PENDING_LEAVE = {
  ...PENDING_CORRECTION,
  id: "leave-request-1",
  agentId: "agent-2",
  type: "LEAVE",
  correctionWorkdayId: null,
  requestedStartAt: null,
  requestedEndAt: null,
}

const GRANULAR_TEAM_MANAGER_GRANT = {
  id: "grant-team-manager",
  organizationId: "org-workforce",
  principalUserId: "manager-1",
  role: "TEAM_MANAGER",
  scopeKind: "TEAM",
  scopeTeamId: "team-1",
  scopeSiteId: null,
  scopeAgentId: null,
  effectiveFrom: new Date("2026-08-01T00:00:00.000Z"),
  effectiveUntil: null,
  revocation: null,
}

function enableGranularRequestDecisions(times = 1) {
  for (let index = 0; index < times; index += 1) {
    vi.mocked(prisma.organization.findUnique).mockResolvedValueOnce({
      features: ["workforce-granular-access-v1"],
    } as never)
  }
}

function historicalTeam(times = 1) {
  for (let index = 0; index < times; index += 1) {
    vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([{
      id: "membership-1",
      teamId: "team-1",
      effectiveAt: new Date("2026-08-01T00:00:00.000Z"),
    }] as never)
  }
}

function startedJournal(startedAt = "2026-08-28T07:00:00.000Z") {
  return [{ id: "event-start", type: "START", occurredAt: new Date(startedAt) }]
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.mtmHrmRequest.updateMany).mockResolvedValue({ count: 1 } as never)
  vi.mocked(prisma.mtmAgentWorkdayEvent.findMany).mockResolvedValue(startedJournal() as never)
  vi.mocked(prisma.workforceTimeCorrection.findMany).mockResolvedValue([] as never)
  vi.mocked(prisma.workforceExceptionDecision.findMany).mockResolvedValue([] as never)
})

describe("decideWorkforceRequest time corrections", () => {
  it("never lets an employee decide their own request", async () => {
    vi.mocked(prisma.mtmHrmRequest.findFirst).mockResolvedValue(PENDING_LEAVE as never)

    await expect(decideWorkforceRequest({
      organizationId: "org-workforce",
      userId: "employee-user",
      actor: { agentId: "agent-2", role: "MANAGER", scopedAgentIds: null },
      requestId: "leave-request-1",
      input: { decision: "APPROVED" },
      includeRouteConflicts: false,
    })).resolves.toEqual({ kind: "forbidden" })

    expect(prisma.organization.findUnique).not.toHaveBeenCalled()
    expect(prisma.mtmHrmRequest.updateMany).not.toHaveBeenCalled()
  })

  it("requires an explicit team-request grant after granular cutover", async () => {
    vi.mocked(prisma.mtmHrmRequest.findFirst).mockResolvedValue(PENDING_LEAVE as never)
    enableGranularRequestDecisions()
    historicalTeam()
    vi.mocked(prisma.workforceAccessGrant.findMany).mockResolvedValue([] as never)

    await expect(decideWorkforceRequest({
      organizationId: "org-workforce",
      userId: "manager-1",
      actor: { agentId: null, role: "MANAGER", scopedAgentIds: [] },
      requestId: "leave-request-1",
      input: { decision: "APPROVED" },
      includeRouteConflicts: true,
    })).resolves.toEqual({ kind: "forbidden" })

    expect(prisma.mtmRoute.findMany).not.toHaveBeenCalled()
    expect(prisma.mtmHrmRequest.updateMany).not.toHaveBeenCalled()
  })

  it("uses a historical TEAM_MANAGER grant and rechecks it in the write transaction", async () => {
    vi.mocked(prisma.mtmHrmRequest.findFirst).mockResolvedValue(PENDING_LEAVE as never)
    vi.mocked(prisma.mtmHrmRequest.findUnique).mockResolvedValue({
      id: "leave-request-1",
      status: "REJECTED",
      decisionNote: "Insufficient coverage",
      decidedAt: new Date("2026-08-28T09:05:00.000Z"),
      updatedAt: new Date("2026-08-28T09:05:00.000Z"),
    } as never)
    enableGranularRequestDecisions(2)
    historicalTeam(2)
    vi.mocked(prisma.workforceAccessGrant.findMany)
      .mockResolvedValueOnce([GRANULAR_TEAM_MANAGER_GRANT] as never)
      .mockResolvedValueOnce([GRANULAR_TEAM_MANAGER_GRANT] as never)

    await expect(decideWorkforceRequest({
      organizationId: "org-workforce",
      userId: "manager-1",
      actor: { agentId: null, role: "MANAGER", scopedAgentIds: [] },
      requestId: "leave-request-1",
      input: { decision: "REJECTED", note: "Insufficient coverage" },
      includeRouteConflicts: false,
    })).resolves.toMatchObject({ kind: "success", data: { status: "REJECTED" } })

    expect(prisma.workforceAccessGrant.findMany).toHaveBeenCalledTimes(2)
    expect(prisma.mtmHrmRequest.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "leave-request-1", organizationId: "org-workforce", status: "PENDING" },
    }))
  })

  it("fails closed when the effective request grant disappears before the status write", async () => {
    vi.mocked(prisma.mtmHrmRequest.findFirst).mockResolvedValue(PENDING_LEAVE as never)
    enableGranularRequestDecisions(2)
    historicalTeam(2)
    vi.mocked(prisma.workforceAccessGrant.findMany)
      .mockResolvedValueOnce([GRANULAR_TEAM_MANAGER_GRANT] as never)
      .mockResolvedValueOnce([] as never)

    await expect(decideWorkforceRequest({
      organizationId: "org-workforce",
      userId: "manager-1",
      actor: { agentId: null, role: "MANAGER", scopedAgentIds: [] },
      requestId: "leave-request-1",
      input: { decision: "REJECTED", note: "Insufficient coverage" },
      includeRouteConflicts: false,
    })).resolves.toEqual({ kind: "forbidden" })

    expect(prisma.mtmHrmRequest.updateMany).not.toHaveBeenCalled()
    expect(prisma.mtmNotification.create).not.toHaveBeenCalled()
  })

  it("does not let a team-request grant approve an immutable time correction", async () => {
    vi.mocked(prisma.mtmHrmRequest.findFirst).mockResolvedValue(PENDING_CORRECTION as never)
    enableGranularRequestDecisions()
    historicalTeam()
    vi.mocked(prisma.workforceAccessGrant.findMany).mockResolvedValue([
      GRANULAR_TEAM_MANAGER_GRANT,
    ] as never)

    await expect(decideWorkforceRequest({
      organizationId: "org-workforce",
      userId: "manager-1",
      actor: { agentId: null, role: "MANAGER", scopedAgentIds: null },
      requestId: "request-1",
      input: { decision: "APPROVED" },
      includeRouteConflicts: false,
    })).resolves.toEqual({ kind: "forbidden" })

    expect(prisma.mtmHrmRequest.updateMany).not.toHaveBeenCalled()
    expect(prisma.workforceTimeCorrection.create).not.toHaveBeenCalled()
  })

  it("locks a linked case before deciding its request and rejects a resolved lifecycle", async () => {
    const linkedRequest = { ...PENDING_CORRECTION, exceptionCaseId: "case-1" }
    vi.mocked(prisma.mtmHrmRequest.findFirst).mockResolvedValue(linkedRequest as never)
    vi.mocked(prisma.workforceExceptionDecision.findMany).mockResolvedValue([
      { decisionCode: "ACKNOWLEDGE" },
      { decisionCode: "RESOLVE_NO_CHANGE" },
    ] as never)

    await expect(decideWorkforceRequest({
      organizationId: "org-workforce",
      userId: "manager-1",
      actor: { agentId: null, role: "MANAGER", scopedAgentIds: null },
      requestId: "request-1",
      input: { decision: "REJECTED", note: "No correction required" },
      includeRouteConflicts: false,
    })).resolves.toMatchObject({
      kind: "conflict",
      code: "WORKFORCE_EXCEPTION_LINKED_MUTATION_RESOLVED",
    })

    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1)
    expect(prisma.mtmHrmRequest.updateMany).not.toHaveBeenCalled()
    expect(prisma.mtmNotification.create).not.toHaveBeenCalled()
  })

  it("locks workday before linked case and rejects a finish preceding the stored start", async () => {
    const linkedRequest = { ...PENDING_CORRECTION, exceptionCaseId: "case-1" }
    vi.mocked(prisma.mtmHrmRequest.findFirst)
      .mockResolvedValueOnce(linkedRequest as never)
      .mockResolvedValueOnce(linkedRequest as never)
    vi.mocked(prisma.mtmAgentWorkday.findFirst).mockResolvedValue({
      id: "workday-1",
      startedAt: new Date("2026-08-28T08:00:00.000Z"),
      completedAt: null,
    } as never)

    const result = await decideWorkforceRequest({
      organizationId: "org-workforce",
      userId: "admin-1",
      actor: { agentId: null, role: "ADMIN", scopedAgentIds: null },
      requestId: "request-1",
      input: { decision: "APPROVED" },
      includeRouteConflicts: false,
    })

    expect(result).toMatchObject({
      kind: "conflict",
      code: "WORKFORCE_TIME_RANGE_INVALID",
    })
    expect(prisma.mtmAgentWorkday.update).not.toHaveBeenCalled()
    expect(prisma.mtmAgentWorkdayEvent.create).not.toHaveBeenCalled()
    expect(prisma.mtmNotification.create).not.toHaveBeenCalled()
    const lockKeys = vi.mocked(prisma.$executeRaw).mock.calls.map((call: unknown[]) => call[1])
    expect(lockKeys.indexOf("mtm-workday:org-workforce:agent-1")).toBeGreaterThanOrEqual(0)
    expect(lockKeys.indexOf("workforce-exception-decision:org-workforce:case-1"))
      .toBeGreaterThan(lockKeys.indexOf("mtm-workday:org-workforce:agent-1"))
  })

  it("commits a complete correction audit record with the workday update", async () => {
    vi.mocked(prisma.mtmHrmRequest.findFirst).mockResolvedValue(PENDING_CORRECTION as never)
    vi.mocked(prisma.mtmAgentWorkday.findFirst).mockResolvedValue({
      id: "workday-1",
      workDate: new Date("2026-08-28T00:00:00.000Z"),
      status: "STARTED",
      startedAt: new Date("2026-08-28T07:00:00.000Z"),
      pausedAt: null,
      completedAt: null,
      totalPausedSeconds: 600,
    } as never)
    vi.mocked(prisma.mtmHrmRequest.findUnique).mockResolvedValue({
      id: "request-1",
      status: "APPROVED",
      decisionNote: null,
      decidedAt: new Date("2026-08-28T09:05:00.000Z"),
      updatedAt: new Date("2026-08-28T09:05:00.000Z"),
    } as never)
    vi.mocked(prisma.mtmAgentWorkdayEvent.findMany).mockResolvedValue([
      { id: "event-start", type: "START", occurredAt: new Date("2026-08-28T07:00:00.000Z") },
      { id: "event-pause", type: "PAUSE", occurredAt: new Date("2026-08-28T07:05:00.000Z") },
      { id: "event-resume", type: "RESUME", occurredAt: new Date("2026-08-28T07:15:00.000Z") },
    ] as never)

    const result = await decideWorkforceRequest({
      organizationId: "org-workforce",
      userId: "manager-1",
      actor: { agentId: null, role: "MANAGER", scopedAgentIds: null },
      requestId: "request-1",
      input: { decision: "APPROVED", note: "Verified with the employee" },
      includeRouteConflicts: false,
    })

    expect(result).toMatchObject({ kind: "success", idempotent: false })
    expect(prisma.mtmAgentWorkday.update).toHaveBeenCalledWith({
      where: { id: "workday-1" },
      data: { completedAt: new Date("2026-08-28T07:30:00.000Z"), status: "COMPLETED", pausedAt: null },
    })
    expect(prisma.mtmAgentWorkdayEvent.create).not.toHaveBeenCalled()
    expect(prisma.workforceTimeCorrection.create).toHaveBeenCalledWith({
      select: { id: true },
      data: {
        organizationId: "org-workforce",
        workdayId: "workday-1",
        agentId: "agent-1",
        requestId: "request-1",
        source: "REQUEST_APPROVAL",
        operationId: "request-approval:request-1",
        actorUserId: "manager-1",
        reason: "Verified with the employee",
        beforeFacts: {
          id: "workday-1",
          workDate: "2026-08-28",
          status: "STARTED",
          startedAt: "2026-08-28T07:00:00.000Z",
          pausedAt: null,
          completedAt: null,
          totalPausedSeconds: 600,
        },
        afterFacts: {
          id: "workday-1",
          workDate: "2026-08-28",
          status: "COMPLETED",
          startedAt: "2026-08-28T07:00:00.000Z",
          pausedAt: null,
          completedAt: "2026-08-28T07:30:00.000Z",
          totalPausedSeconds: 600,
        },
        occurredAt: expect.any(Date),
      },
    })
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(3)
    expect(prisma.mtmAuditLog.create).toHaveBeenCalledWith({
      data: {
        organizationId: "org-workforce",
        agentId: "agent-1",
        action: "WORKFORCE_TIME_CORRECTION_APPLIED",
        entity: "workday",
        entityId: "workday-1",
        metadataKind: "workforce_time_correction",
        oldData: {
          workday: {
            id: "workday-1",
            workDate: "2026-08-28",
            status: "STARTED",
            startedAt: "2026-08-28T07:00:00.000Z",
            pausedAt: null,
            completedAt: null,
            totalPausedSeconds: 600,
          },
        },
        newData: {
          workday: {
            id: "workday-1",
            workDate: "2026-08-28",
            status: "COMPLETED",
            startedAt: "2026-08-28T07:00:00.000Z",
            pausedAt: null,
            completedAt: "2026-08-28T07:30:00.000Z",
            totalPausedSeconds: 600,
          },
          actorUserId: "manager-1",
          requestId: "request-1",
          reason: "Verified with the employee",
          source: "REQUEST_APPROVAL",
        },
      },
    })
    expect(prisma.mtmAuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        action: "HRM_REQUEST_DECISION",
        entity: "hrm_request",
        entityId: "request-1",
        metadataKind: "hrm_request_decision",
      }),
    }))
  })

  it("rejects an approval that would put an immutable pause outside corrected boundaries", async () => {
    const request = {
      ...PENDING_CORRECTION,
      requestedEndAt: new Date("2026-08-28T12:30:00.000Z"),
    }
    vi.mocked(prisma.mtmHrmRequest.findFirst).mockResolvedValue(request as never)
    vi.mocked(prisma.mtmAgentWorkday.findFirst).mockResolvedValue({
      id: "workday-1",
      workDate: new Date("2026-08-28T00:00:00.000Z"),
      status: "COMPLETED",
      startedAt: new Date("2026-08-28T09:00:00.000Z"),
      pausedAt: null,
      completedAt: new Date("2026-08-28T18:00:00.000Z"),
      totalPausedSeconds: 60 * 60,
    } as never)
    vi.mocked(prisma.mtmAgentWorkdayEvent.findMany).mockResolvedValue([
      { id: "event-start", type: "START", occurredAt: new Date("2026-08-28T09:00:00.000Z") },
      { id: "event-pause", type: "PAUSE", occurredAt: new Date("2026-08-28T12:00:00.000Z") },
      { id: "event-resume", type: "RESUME", occurredAt: new Date("2026-08-28T13:00:00.000Z") },
      { id: "event-finish", type: "FINISH", occurredAt: new Date("2026-08-28T18:00:00.000Z") },
    ] as never)

    const result = await decideWorkforceRequest({
      organizationId: "org-workforce",
      userId: "manager-1",
      actor: { agentId: null, role: "MANAGER", scopedAgentIds: null },
      requestId: "request-1",
      input: { decision: "APPROVED" },
      includeRouteConflicts: false,
    })

    expect(result).toMatchObject({
      kind: "conflict",
      code: "WORKFORCE_TIME_CORRECTION_HISTORY_INVALID",
    })
    expect(prisma.workforceTimeCorrection.create).not.toHaveBeenCalled()
    expect(prisma.mtmAgentWorkday.update).not.toHaveBeenCalled()
    expect(prisma.mtmNotification.create).not.toHaveBeenCalled()
  })

  it("does not accept a correction when its transactional audit write fails", async () => {
    vi.mocked(prisma.mtmHrmRequest.findFirst).mockResolvedValue(PENDING_CORRECTION as never)
    vi.mocked(prisma.mtmAgentWorkday.findFirst).mockResolvedValue({
      id: "workday-1",
      workDate: new Date("2026-08-28T00:00:00.000Z"),
      status: "STARTED",
      startedAt: new Date("2026-08-28T07:00:00.000Z"),
      pausedAt: null,
      completedAt: null,
      totalPausedSeconds: 0,
    } as never)
    vi.mocked(prisma.mtmAuditLog.create).mockRejectedValue(new Error("audit unavailable"))

    await expect(decideWorkforceRequest({
      organizationId: "org-workforce",
      userId: "manager-1",
      actor: { agentId: null, role: "MANAGER", scopedAgentIds: null },
      requestId: "request-1",
      input: { decision: "APPROVED" },
      includeRouteConflicts: false,
    })).rejects.toThrow("audit unavailable")

    expect(prisma.mtmHrmRequest.findUnique).not.toHaveBeenCalled()
  })

  it("does not accept a correction when its immutable ledger write fails", async () => {
    vi.mocked(prisma.mtmHrmRequest.findFirst).mockResolvedValue(PENDING_CORRECTION as never)
    vi.mocked(prisma.mtmAgentWorkday.findFirst).mockResolvedValue({
      id: "workday-1",
      workDate: new Date("2026-08-28T00:00:00.000Z"),
      status: "STARTED",
      startedAt: new Date("2026-08-28T07:00:00.000Z"),
      pausedAt: null,
      completedAt: null,
      totalPausedSeconds: 0,
    } as never)
    vi.mocked(prisma.workforceTimeCorrection.create).mockRejectedValue(new Error("ledger unavailable"))

    await expect(decideWorkforceRequest({
      organizationId: "org-workforce",
      userId: "manager-1",
      actor: { agentId: null, role: "MANAGER", scopedAgentIds: null },
      requestId: "request-1",
      input: { decision: "APPROVED" },
      includeRouteConflicts: false,
    })).rejects.toThrow("ledger unavailable")

    expect(prisma.mtmAgentWorkday.update).not.toHaveBeenCalled()
    expect(prisma.mtmAuditLog.create).not.toHaveBeenCalled()
  })

  it("does not accept a request decision when its standard audit projection fails", async () => {
    const leaveRequest = {
      ...PENDING_CORRECTION,
      type: "LEAVE",
      correctionWorkdayId: null,
      requestedStartAt: null,
      requestedEndAt: null,
    }
    vi.mocked(prisma.mtmHrmRequest.findFirst).mockResolvedValue(leaveRequest as never)
    vi.mocked(prisma.mtmAuditLog.create).mockRejectedValue(new Error("request audit unavailable"))

    await expect(decideWorkforceRequest({
      organizationId: "org-workforce",
      userId: "manager-1",
      actor: { agentId: null, role: "MANAGER", scopedAgentIds: null },
      requestId: "request-1",
      input: { decision: "REJECTED", note: "Insufficient evidence" },
      includeRouteConflicts: false,
    })).rejects.toThrow("request audit unavailable")

    expect(prisma.mtmHrmRequest.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "request-1", organizationId: "org-workforce", status: "PENDING" },
    }))
    expect(prisma.mtmHrmRequest.findUnique).not.toHaveBeenCalled()
  })
})
