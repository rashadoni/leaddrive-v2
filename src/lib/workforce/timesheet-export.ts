import type { WorkforceTimesheetApprovalPayload } from "@/lib/workforce/timesheet-approval"

export type WorkforceApprovedTimesheetExportRow = {
  workdayId: string
  agentId: string
  workDate: string
  status: "COMPLETED"
  workedSeconds: number
  pausedSeconds: number
  lateStartSeconds: number
  undertimeSeconds: number
  overtimeSeconds: number
  longPauseSeconds: number
}

/**
 * Produces a payroll-free, deterministic export from an immutable approval.
 * The approval hashes remain part of the envelope so downstream storage can
 * verify that a file was not edited after approval.
 */
export function exportApprovedWorkforceTimesheet(input: WorkforceTimesheetApprovalPayload): {
  format: "workforce-approved-timesheet-v1"
  periodStart: string
  periodEnd: string
  agentId: string
  approvalRowsHash: string
  approvalFactsHash: string
  rows: WorkforceApprovedTimesheetExportRow[]
} {
  return {
    format: "workforce-approved-timesheet-v1",
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    agentId: input.agentId,
    approvalRowsHash: input.rowsHash,
    approvalFactsHash: input.factsHash,
    rows: input.rows.map((row) => ({
      workdayId: row.workdayId,
      agentId: row.agentId,
      workDate: row.workDate,
      status: "COMPLETED",
      workedSeconds: row.calculation.fact.workedSeconds,
      pausedSeconds: row.calculation.fact.pausedSeconds,
      lateStartSeconds: row.calculation.deviations.lateStartSeconds,
      undertimeSeconds: row.calculation.deviations.undertimeSeconds,
      overtimeSeconds: row.calculation.deviations.overtimeSeconds,
      longPauseSeconds: row.calculation.deviations.longPauseSeconds,
    })),
  }
}
