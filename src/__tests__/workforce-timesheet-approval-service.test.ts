import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/prisma", async () => {
  const { makeMtmPrismaMock } = await import("./mocks/mtm-prisma")
  return { prisma: makeMtmPrismaMock() }
})

import { prisma } from "@/lib/prisma"
import {
  approveWorkforceTimesheet,
  WorkforceTimesheetApprovalRequestSchema,
} from "@/lib/workforce/timesheet-approval-service"

const context = {
  organizationId: "org-1",
  userId: "manager-user",
  actor: { agentId: "manager-agent", role: "MANAGER" as const, scopedAgentIds: ["employee-1"] },
  input: { agentId: "employee-1", periodStart: "2026-08-28", periodEnd: "2026-08-28" },
  audit: { ipAddress: "203.0.113.10", userAgent: "vitest" },
}

function completeWorkday(overrides: Record<string, unknown> = {}) {
  return {
    id: "workday-1",
    agentId: "employee-1",
    workDate: new Date("2026-08-28T00:00:00.000Z"),
    status: "COMPLETED",
    startedAt: new Date("2026-08-28T09:00:00.000Z"),
    pausedAt: null,
    completedAt: new Date("2026-08-28T18:00:00.000Z"),
    totalPausedSeconds: 0,
    ...overrides,
  }
}

function policySnapshot() {
  return {
    id: "policy-snapshot-1",
    workdayId: "workday-1",
    agentId: "employee-1",
    workDate: new Date("2026-08-28T00:00:00.000Z"),
    expectedWorkSeconds: 8 * 60 * 60,
    lateGraceSeconds: 5 * 60,
    undertimeToleranceSeconds: 5 * 60,
    overtimeThresholdSeconds: 15 * 60,
    longPauseThresholdSeconds: null,
  }
}

function shiftSnapshot() {
  return {
    id: "shift-snapshot-1",
    workdayId: "workday-1",
    agentId: "employee-1",
    workDate: new Date("2026-08-28T00:00:00.000Z"),
    timezone: "Asia/Baku",
    plannedStartAt: new Date("2026-08-28T09:00:00.000Z"),
    plannedEndAt: new Date("2026-08-28T18:00:00.000Z"),
  }
}

function finalEvents() {
  return [
    { id: "start-1", workdayId: "workday-1", type: "START", occurredAt: new Date("2026-08-28T09:00:00.000Z") },
    { id: "finish-1", workdayId: "workday-1", type: "FINISH", occurredAt: new Date("2026-08-28T18:00:00.000Z") },
  ]
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ id: "employee-1", userId: "employee-user" } as never)
  vi.mocked(prisma.mtmAgentWorkday.findMany).mockResolvedValue([completeWorkday()] as never)
  vi.mocked(prisma.workforcePolicySnapshot.findMany).mockResolvedValue([policySnapshot()] as never)
  vi.mocked(prisma.workforceShiftSnapshot.findMany).mockResolvedValue([shiftSnapshot()] as never)
  vi.mocked(prisma.mtmAgentWorkdayEvent.findMany).mockResolvedValue(finalEvents() as never)
  vi.mocked(prisma.workforceTimeCorrection.findMany).mockResolvedValue([])
  vi.mocked(prisma.workforceTimesheetApproval.findFirst).mockResolvedValue(null as never)
  vi.mocked(prisma.workforceTimesheetApproval.create).mockResolvedValue({ id: "approval-1", revision: 1 } as never)
})

describe("Workforce server-side timesheet approval", () => {
  it("rebuilds immutable rows under the workday fence and audits a first approval", async () => {
    await expect(approveWorkforceTimesheet(context)).resolves.toMatchObject({
      kind: "success",
      idempotent: false,
      data: {
        id: "approval-1",
        recordKind: "APPROVAL",
        agentId: "employee-1",
        periodStart: "2026-08-28",
        rowsHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        factsHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
    })

    expect(prisma.$executeRaw).toHaveBeenCalled()
    expect(prisma.mtmAgentWorkday.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        organizationId: "org-1",
        agentId: "employee-1",
        workDate: {
          gte: new Date("2026-08-28T00:00:00.000Z"),
          lt: new Date("2026-08-29T00:00:00.000Z"),
        },
      }),
    }))
    expect(prisma.workforceTimesheetApproval.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        organizationId: "org-1",
        agentId: "employee-1",
        approvedByUserId: "manager-user",
        recordKind: "APPROVAL",
      }),
    }))
    expect(prisma.mtmAuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        action: "WORKFORCE_TIMESHEET_APPROVED",
        entity: "timesheet_approval",
        entityId: "approval-1",
        ipAddress: "203.0.113.10",
        newData: expect.objectContaining({ recordKind: "APPROVAL", approvedByUserId: "manager-user" }),
      }),
    }))
  })

  it("is idempotent when the persisted immutable hashes already match", async () => {
    let knownRowsHash = ""
    let knownFactsHash = ""
    vi.mocked(prisma.workforceTimesheetApproval.findFirst).mockImplementation(async () => (
      knownRowsHash
        ? { id: "approval-1", revision: 1, rowsHash: knownRowsHash, factsHash: knownFactsHash }
        : null
    ) as never)
    vi.mocked(prisma.workforceTimesheetApproval.create).mockImplementation(async (...args: unknown[]) => {
      const input = args[0] as { data: { rowsHash: string; factsHash: string } }
      knownRowsHash = input.data.rowsHash
      knownFactsHash = input.data.factsHash
      return { id: "approval-1", revision: 1 } as never
    })

    // Establish the deterministic hashes exactly as persistence would on the
    // first request, then replay the same immutable period.
    await approveWorkforceTimesheet(context)
    const second = await approveWorkforceTimesheet(context)

    expect(second).toMatchObject({ kind: "success", idempotent: true, data: { id: "approval-1", revision: 1 } })
    expect(prisma.workforceTimesheetApproval.create).toHaveBeenCalledTimes(1)
    expect(prisma.mtmAuditLog.create).toHaveBeenCalledTimes(1)
  })

  it("enforces separation of duties before reading a target workday", async () => {
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ id: "employee-1", userId: "manager-user" } as never)

    await expect(approveWorkforceTimesheet(context)).resolves.toEqual({ kind: "forbidden" })
    expect(prisma.mtmAgentWorkday.findMany).not.toHaveBeenCalled()
    expect(prisma.workforceTimesheetApproval.create).not.toHaveBeenCalled()
  })

  it("fails closed if any recorded workday is still open", async () => {
    vi.mocked(prisma.mtmAgentWorkday.findMany).mockResolvedValue([
      completeWorkday({ status: "PAUSED", completedAt: null }),
    ] as never)

    await expect(approveWorkforceTimesheet(context)).resolves.toEqual({
      kind: "conflict",
      code: "WORKFORCE_TIMESHEET_APPROVAL_WORKDAY_NOT_FINAL",
      message: "Every recorded workday in the requested period must be completed before approval",
    })
    expect(prisma.workforceTimesheetApproval.create).not.toHaveBeenCalled()
  })

  it("fails closed when a completed workday has no immutable snapshots", async () => {
    vi.mocked(prisma.workforceShiftSnapshot.findMany).mockResolvedValue([])

    await expect(approveWorkforceTimesheet(context)).resolves.toMatchObject({
      kind: "conflict",
      code: "WORKFORCE_TIMESHEET_APPROVAL_SNAPSHOT_MISSING",
    })
    expect(prisma.workforceTimesheetApproval.create).not.toHaveBeenCalled()
  })

  it("rejects a completed projection that cannot be replayed from immutable facts", async () => {
    vi.mocked(prisma.mtmAgentWorkdayEvent.findMany).mockResolvedValue(finalEvents().slice(0, 1) as never)

    await expect(approveWorkforceTimesheet(context)).resolves.toMatchObject({
      kind: "conflict",
      code: "WORKFORCE_TIMESHEET_APPROVAL_HISTORY_INVALID",
    })
    expect(prisma.workforceTimesheetApproval.create).not.toHaveBeenCalled()
  })
})

describe("WorkforceTimesheetApprovalRequestSchema", () => {
  it("rejects an oversized or inverted date window", () => {
    expect(WorkforceTimesheetApprovalRequestSchema.safeParse({
      agentId: "employee-1", periodStart: "2026-08-28", periodEnd: "2026-08-27",
    }).success).toBe(false)
    expect(WorkforceTimesheetApprovalRequestSchema.safeParse({
      agentId: "employee-1", periodStart: "2026-08-01", periodEnd: "2026-11-02",
    }).success).toBe(false)
  })
})
