import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/prisma", async () => {
  const { makeMtmPrismaMock } = await import("./mocks/mtm-prisma")
  return { prisma: makeMtmPrismaMock() }
})

import {
  buildWorkforceTimesheetApproval,
  persistWorkforceTimesheetApproval,
  WorkforceTimesheetApprovalError,
} from "@/lib/workforce/timesheet-approval"
import type { WorkforceTimesheetCalculation } from "@/lib/workforce/timesheet-calculation"
import { prisma } from "@/lib/prisma"

const calculation: WorkforceTimesheetCalculation = {
  calculationVersion: 1, policySnapshotId: "p", shiftSnapshotId: "s", status: "COMPLETED", isFinal: true,
  plan: { plannedStartAt: "2026-08-28T09:00:00.000Z", plannedEndAt: "2026-08-28T18:00:00.000Z", expectedWorkSeconds: 28800, workDate: "2026-08-28", timezone: "UTC" },
  fact: { workdayId: "w", startedAt: "2026-08-28T09:00:00.000Z", completedAt: "2026-08-28T18:00:00.000Z", workedSeconds: 28800, pausedSeconds: 0, longestPauseSeconds: 0 },
  deviations: { lateStartSeconds: 0, undertimeSeconds: 0, overtimeSeconds: 0, longPauseSeconds: 0 }, exceptions: [],
}

describe("buildWorkforceTimesheetApproval", () => {
  it("sorts rows and produces stable hashes", () => {
    const row = (workdayId: string, workDate: string) => ({ workdayId, agentId: "a", workDate, calculationVersion: 1, calculation: { ...calculation, plan: { ...calculation.plan, workDate }, fact: { ...calculation.fact, workdayId } } })
    const result = buildWorkforceTimesheetApproval({ periodStart: "2026-08-28", periodEnd: "2026-08-29", agentId: "a", rows: [row("w2", "2026-08-29"), row("w1", "2026-08-28")] })
    expect(result.rows.map((item) => item.workdayId)).toEqual(["w1", "w2"])
    expect(result.rowsHash).toMatch(/^[a-f0-9]{64}$/)
    expect(result.factsHash).toMatch(/^[a-f0-9]{64}$/)
  })

  it("rejects provisional calculations and duplicate workdays", () => {
    const row = { workdayId: "w", agentId: "a", workDate: "2026-08-28", calculationVersion: 1, calculation }
    expect(() => buildWorkforceTimesheetApproval({ periodStart: "2026-08-28", periodEnd: "2026-08-28", agentId: "a", rows: [row, row] })).toThrow()
    expect(() => buildWorkforceTimesheetApproval({ periodStart: "2026-08-28", periodEnd: "2026-08-28", agentId: "a", rows: [{ ...row, calculation: { ...calculation, isFinal: false } }] })).toThrow()
  })

  it("rejects calculations whose immutable facts belong to another workday", () => {
    expect(() => buildWorkforceTimesheetApproval({
      periodStart: "2026-08-28",
      periodEnd: "2026-08-28",
      agentId: "a",
      rows: [{
        workdayId: "w-expected",
        agentId: "a",
        workDate: "2026-08-28",
        calculationVersion: 1,
        calculation,
      }],
    })).toThrow("approval calculation facts must belong to the row workday")
  })

  it("rejects calculations whose immutable plan date differs from the row", () => {
    expect(() => buildWorkforceTimesheetApproval({
      periodStart: "2026-08-28",
      periodEnd: "2026-08-28",
      agentId: "a",
      rows: [{
        workdayId: "w",
        agentId: "a",
        workDate: "2026-08-28",
        calculationVersion: 1,
        calculation: {
          ...calculation,
          plan: { ...calculation.plan, workDate: "2026-08-29" },
        },
      }],
    })).toThrow("approval calculation plan date must match the row work date")
  })
})

describe("persistWorkforceTimesheetApproval", () => {
  const payload = buildWorkforceTimesheetApproval({
    periodStart: "2026-08-28",
    periodEnd: "2026-08-28",
    agentId: "agent-1",
    rows: [{
      workdayId: "workday-1",
      agentId: "agent-1",
      workDate: "2026-08-28",
      calculationVersion: 1,
      calculation: { ...calculation, fact: { ...calculation.fact, workdayId: "workday-1" } },
    }],
  })

  beforeEach(() => vi.clearAllMocks())

  it("writes the first approval as an immutable approval record", async () => {
    vi.mocked(prisma.workforceTimesheetApproval.findFirst).mockResolvedValue(null as never)
    vi.mocked(prisma.workforceTimesheetApproval.create).mockResolvedValue({ id: "approval-1", revision: 1 } as never)

    await expect(persistWorkforceTimesheetApproval({
      organizationId: "org-1",
      approvedByUserId: "manager-1",
      payload,
    })).resolves.toEqual({ id: "approval-1", revision: 1, idempotent: false })

    expect(prisma.workforceTimesheetApproval.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        recordKind: "APPROVAL",
        supersedesId: null,
        correctionReason: null,
        correctionActorUserId: null,
      }),
    }))
  })

  it("returns an exact retry without creating a spurious correction", async () => {
    vi.mocked(prisma.workforceTimesheetApproval.findFirst).mockResolvedValue({
      id: "approval-1",
      revision: 1,
      rowsHash: payload.rowsHash,
      factsHash: payload.factsHash,
    } as never)

    await expect(persistWorkforceTimesheetApproval({
      organizationId: "org-1",
      approvedByUserId: "manager-1",
      payload,
    })).resolves.toEqual({ id: "approval-1", revision: 1, idempotent: true })
    expect(prisma.workforceTimesheetApproval.create).not.toHaveBeenCalled()
  })

  it("requires a reason and writes compliant correction metadata for changed facts", async () => {
    vi.mocked(prisma.workforceTimesheetApproval.findFirst).mockResolvedValue({
      id: "approval-1",
      revision: 1,
      rowsHash: "a".repeat(64),
      factsHash: "b".repeat(64),
    } as never)
    vi.mocked(prisma.workforceTimesheetApproval.create).mockResolvedValue({ id: "approval-2", revision: 2 } as never)

    await expect(persistWorkforceTimesheetApproval({
      organizationId: "org-1",
      approvedByUserId: "manager-1",
      payload,
    })).rejects.toBeInstanceOf(WorkforceTimesheetApprovalError)

    await expect(persistWorkforceTimesheetApproval({
      organizationId: "org-1",
      approvedByUserId: "manager-1",
      payload,
      correctionReason: "Approved correction after audited time change",
    })).resolves.toEqual({ id: "approval-2", revision: 2, idempotent: false })
    expect(prisma.workforceTimesheetApproval.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        recordKind: "CORRECTION",
        supersedesId: "approval-1",
        correctionReason: "Approved correction after audited time change",
        correctionActorUserId: "manager-1",
      }),
    }))
  })
})
