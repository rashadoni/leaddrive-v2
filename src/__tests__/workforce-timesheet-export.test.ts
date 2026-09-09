import { describe, expect, it } from "vitest"
import { exportApprovedWorkforceTimesheet } from "@/lib/workforce/timesheet-export"

describe("exportApprovedWorkforceTimesheet", () => {
  it("exports only approved fact/deviation fields and carries approval hashes", () => {
    const result = exportApprovedWorkforceTimesheet({
      periodStart: "2026-08-28", periodEnd: "2026-08-28", agentId: "agent-1",
      rowsHash: "rows-hash", factsHash: "facts-hash", calculationVersion: 1,
      rows: [{
        workdayId: "day-1", agentId: "agent-1", workDate: "2026-08-28", calculationVersion: 1,
        calculation: {
          calculationVersion: 1, policySnapshotId: "policy", shiftSnapshotId: "shift", status: "COMPLETED", isFinal: true,
          plan: { plannedStartAt: "2026-08-28T09:00:00.000Z", plannedEndAt: "2026-08-28T18:00:00.000Z", expectedWorkSeconds: 28800, workDate: "2026-08-28", timezone: "UTC" },
          fact: { workdayId: "day-1", startedAt: "2026-08-28T09:00:00.000Z", completedAt: "2026-08-28T18:00:00.000Z", workedSeconds: 28800, pausedSeconds: 600, longestPauseSeconds: 600 },
          deviations: { lateStartSeconds: 0, undertimeSeconds: 0, overtimeSeconds: 0, longPauseSeconds: 0 }, exceptions: [],
        },
      }],
    })
    expect(result).toMatchObject({ format: "workforce-approved-timesheet-v1", approvalRowsHash: "rows-hash", approvalFactsHash: "facts-hash" })
    expect(result.rows[0]).toEqual({ workdayId: "day-1", agentId: "agent-1", workDate: "2026-08-28", status: "COMPLETED", workedSeconds: 28800, pausedSeconds: 600, lateStartSeconds: 0, undertimeSeconds: 0, overtimeSeconds: 0, longPauseSeconds: 0 })
    expect(JSON.stringify(result)).not.toContain("policySnapshotId")
  })
})
