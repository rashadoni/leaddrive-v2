import { describe, expect, it } from "vitest"
import { buildWorkforceTimesheetApproval } from "@/lib/workforce/timesheet-approval"
import { buildWorkforceApprovedTimesheetReport } from "@/lib/workforce/approved-timesheet-report"

function storedApproval(input: {
  id: string
  revision: number
  approvedAt: string
  rows: Array<{ workdayId: string; workDate: string; agentId?: string; workedSeconds?: number; overtimeSeconds?: number }>
}) {
  const rows = input.rows.map((row) => ({
    workdayId: row.workdayId,
    agentId: row.agentId ?? "agent-1",
    workDate: row.workDate,
    calculationVersion: 1,
    calculation: {
      calculationVersion: 1,
      policySnapshotId: "policy-" + row.workdayId,
      shiftSnapshotId: "shift-" + row.workdayId,
      status: "COMPLETED" as const,
      isFinal: true,
      plan: {
        plannedStartAt: row.workDate + "T05:00:00.000Z",
        plannedEndAt: row.workDate + "T14:00:00.000Z",
        expectedWorkSeconds: 28_800,
        workDate: row.workDate,
        timezone: "Asia/Baku",
      },
      fact: {
        workdayId: row.workdayId,
        startedAt: row.workDate + "T05:00:00.000Z",
        completedAt: row.workDate + "T14:00:00.000Z",
        workedSeconds: row.workedSeconds ?? 28_800,
        pausedSeconds: 3_600,
        longestPauseSeconds: 3_600,
      },
      deviations: {
        lateStartSeconds: 0,
        undertimeSeconds: 0,
        overtimeSeconds: row.overtimeSeconds ?? 0,
        longPauseSeconds: 0,
      },
      exceptions: [],
    },
  }))
  const payload = buildWorkforceTimesheetApproval({
    periodStart: "2026-08-01",
    periodEnd: "2026-08-31",
    agentId: "agent-1",
    rows,
  })
  return {
    id: input.id,
    agentId: "agent-1",
    periodStart: new Date("2026-08-01T00:00:00.000Z"),
    periodEnd: new Date("2026-08-31T00:00:00.000Z"),
    recordKind: input.revision === 1 ? "APPROVAL" as const : "CORRECTION" as const,
    revision: input.revision,
    calculationVersion: payload.calculationVersion,
    rowsHash: payload.rowsHash,
    factsHash: payload.factsHash,
    rows,
    approvedAt: new Date(input.approvedAt),
  }
}

describe("buildWorkforceApprovedTimesheetReport", () => {
  it("uses only hash-verified immutable approval rows and deduplicates later corrections", () => {
    const report = buildWorkforceApprovedTimesheetReport({
      start: "2026-08-01",
      end: "2026-08-31",
      approvals: [
        storedApproval({
          id: "approval-1",
          revision: 1,
          approvedAt: "2026-09-01T09:00:00.000Z",
          rows: [{ workdayId: "day-1", workDate: "2026-08-20", workedSeconds: 28_800 }],
        }),
        storedApproval({
          id: "correction-2",
          revision: 2,
          approvedAt: "2026-09-02T09:00:00.000Z",
          rows: [{ workdayId: "day-1", workDate: "2026-08-20", workedSeconds: 30_600, overtimeSeconds: 1_800 }],
        }),
      ],
    })

    expect(report.source).toBe("HASH_VERIFIED_IMMUTABLE_APPROVALS")
    expect(report.summary).toMatchObject({
      employees: 1,
      workdays: 1,
      workedSeconds: 30_600,
      overtimeSeconds: 1_800,
      approvalsExamined: 2,
      overlappingRowsSuppressed: 1,
    })
    expect(report.unavailable).toEqual({
      noShow: "UNAVAILABLE_UNTIL_SCHEDULED_EXCEPTION_LIFECYCLE",
      siteTransitions: "EXCLUDED_FROM_APPROVED_TIMESHEET_FACTS",
      freeTextAppeals: "EXCLUDED_FROM_APPROVED_TIMESHEET_FACTS",
    })
  })

  it("fails closed instead of aggregating a tampered approval", () => {
    const approval = storedApproval({
      id: "approval-1",
      revision: 1,
      approvedAt: "2026-09-01T09:00:00.000Z",
      rows: [{ workdayId: "day-1", workDate: "2026-08-20" }],
    })
    approval.rowsHash = "a".repeat(64)

    expect(() => buildWorkforceApprovedTimesheetReport({
      start: "2026-08-01",
      end: "2026-08-31",
      approvals: [approval],
    })).toThrow(/hashes/i)
  })

  it("fails closed on hash-valid negative or overflowing stored metrics", () => {
    const negative = storedApproval({
      id: "approval-negative",
      revision: 1,
      approvedAt: "2026-09-01T09:00:00.000Z",
      rows: [{ workdayId: "day-negative", workDate: "2026-08-20", workedSeconds: -1 }],
    })
    expect(() => buildWorkforceApprovedTimesheetReport({
      start: "2026-08-01",
      end: "2026-08-31",
      approvals: [negative],
    })).toThrow(/workedSeconds is invalid/)

    const overflowing = storedApproval({
      id: "approval-overflow",
      revision: 1,
      approvedAt: "2026-09-01T09:00:00.000Z",
      rows: [
        { workdayId: "day-overflow-1", workDate: "2026-08-20", workedSeconds: Number.MAX_SAFE_INTEGER },
        { workdayId: "day-overflow-2", workDate: "2026-08-21", workedSeconds: Number.MAX_SAFE_INTEGER },
      ],
    })
    expect(() => buildWorkforceApprovedTimesheetReport({
      start: "2026-08-01",
      end: "2026-08-31",
      approvals: [overflowing],
    })).toThrow(/workedSeconds aggregate is unsafe/)
  })
})
