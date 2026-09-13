import {
  buildWorkforceTimesheetApproval,
  WorkforceTimesheetApprovalError,
  type WorkforceTimesheetApprovalPayload,
  type WorkforceTimesheetApprovalRow,
} from "@/lib/workforce/timesheet-approval"
import { assertWorkforceOrdinaryTimesheetExportClasses } from "@/lib/workforce/data-classification"

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
  /** Operational attendance variance only; never a wage/payroll instruction. */
  overtimeClassification: "OPERATIONAL_DEVIATION_NOT_PAYABLE"
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
  assertWorkforceOrdinaryTimesheetExportClasses(["TIME_FACT"])
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
      overtimeClassification: "OPERATIONAL_DEVIATION_NOT_PAYABLE",
      longPauseSeconds: row.calculation.deviations.longPauseSeconds,
    })),
  }
}

type WorkforceStoredTimesheetApproval = {
  id: string
  agentId: string
  periodStart: Date
  periodEnd: Date
  recordKind: "APPROVAL" | "CORRECTION"
  revision: number
  calculationVersion: number
  rowsHash: string
  factsHash: string
  rows: unknown
  approvedAt: Date
}

/**
 * Rebuild an export only from an immutable approval and verify the persisted
 * hashes before projecting its payroll-free time facts. Mutable workdays,
 * live policies and raw attendance proof are deliberately outside this API.
 */
export function exportStoredWorkforceTimesheetApproval(input: WorkforceStoredTimesheetApproval) {
  try {
    if (!Array.isArray(input.rows)) {
      throw new WorkforceTimesheetApprovalError("stored approval rows are invalid")
    }
    const approval = buildWorkforceTimesheetApproval({
      periodStart: input.periodStart.toISOString().slice(0, 10),
      periodEnd: input.periodEnd.toISOString().slice(0, 10),
      agentId: input.agentId,
      rows: input.rows as WorkforceTimesheetApprovalRow[],
    })
    if (
      approval.calculationVersion !== input.calculationVersion
      || approval.rowsHash !== input.rowsHash
      || approval.factsHash !== input.factsHash
    ) {
      throw new WorkforceTimesheetApprovalError("stored approval hashes do not match its immutable rows")
    }
    return {
      approvalId: input.id,
      recordKind: input.recordKind,
      revision: input.revision,
      approvedAt: input.approvedAt.toISOString(),
      export: exportApprovedWorkforceTimesheet(approval),
    }
  } catch (error) {
    if (error instanceof WorkforceTimesheetApprovalError) throw error
    throw new WorkforceTimesheetApprovalError("stored approval rows cannot be verified")
  }
}
