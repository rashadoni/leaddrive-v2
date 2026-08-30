import {
  buildWorkforceTimesheetApproval,
  WorkforceTimesheetApprovalError,
  type WorkforceTimesheetApprovalRow,
} from "@/lib/workforce/timesheet-approval"

export type WorkforceStoredTimesheetApprovalForReport = {
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

type ReportCandidate = {
  row: WorkforceTimesheetApprovalRow
  source: Pick<WorkforceStoredTimesheetApprovalForReport,
    "id" | "agentId" | "periodStart" | "periodEnd" | "recordKind" | "revision" | "approvedAt">
}

export type WorkforceApprovedTimesheetReport = {
  source: "HASH_VERIFIED_IMMUTABLE_APPROVALS"
  start: string
  end: string
  summary: {
    employees: number
    workdays: number
    expectedWorkSeconds: number
    workedSeconds: number
    pausedSeconds: number
    lateStartSeconds: number
    undertimeSeconds: number
    overtimeSeconds: number
    longPauseSeconds: number
    approvalsExamined: number
    overlappingRowsSuppressed: number
  }
  byEmployee: Array<{
    agentId: string
    workdays: number
    expectedWorkSeconds: number
    workedSeconds: number
    pausedSeconds: number
    lateStartSeconds: number
    undertimeSeconds: number
    overtimeSeconds: number
    longPauseSeconds: number
  }>
  unavailable: {
    noShow: "UNAVAILABLE_UNTIL_SCHEDULED_EXCEPTION_LIFECYCLE"
    siteTransitions: "EXCLUDED_FROM_APPROVED_TIMESHEET_FACTS"
    freeTextAppeals: "EXCLUDED_FROM_APPROVED_TIMESHEET_FACTS"
  }
}

function dateKey(value: Date, name: string): string {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new WorkforceTimesheetApprovalError(`${name} is invalid`)
  }
  return value.toISOString().slice(0, 10)
}

function storedRows(source: WorkforceStoredTimesheetApprovalForReport): WorkforceTimesheetApprovalRow[] {
  if (!Array.isArray(source.rows)) {
    throw new WorkforceTimesheetApprovalError("stored approval rows are invalid")
  }
  const payload = buildWorkforceTimesheetApproval({
    periodStart: dateKey(source.periodStart, "periodStart"),
    periodEnd: dateKey(source.periodEnd, "periodEnd"),
    agentId: source.agentId,
    rows: source.rows as WorkforceTimesheetApprovalRow[],
  })
  if (
    payload.calculationVersion !== source.calculationVersion
    || payload.rowsHash !== source.rowsHash
    || payload.factsHash !== source.factsHash
  ) {
    throw new WorkforceTimesheetApprovalError("stored approval hashes do not match its immutable rows")
  }
  return payload.rows
}

function candidateWins(next: ReportCandidate, previous: ReportCandidate): boolean {
  const approvedAtDelta = next.source.approvedAt.getTime() - previous.source.approvedAt.getTime()
  if (approvedAtDelta !== 0) return approvedAtDelta > 0
  if (next.source.revision !== previous.source.revision) return next.source.revision > previous.source.revision
  if (next.source.recordKind !== previous.source.recordKind) return next.source.recordKind === "CORRECTION"
  return next.source.id > previous.source.id
}

function emptySummary() {
  return {
    workdays: 0,
    expectedWorkSeconds: 0,
    workedSeconds: 0,
    pausedSeconds: 0,
    lateStartSeconds: 0,
    undertimeSeconds: 0,
    overtimeSeconds: 0,
    longPauseSeconds: 0,
  }
}

function appendSummary(summary: ReturnType<typeof emptySummary>, row: WorkforceTimesheetApprovalRow) {
  summary.workdays += 1
  summary.expectedWorkSeconds += row.calculation.plan.expectedWorkSeconds
  summary.workedSeconds += row.calculation.fact.workedSeconds
  summary.pausedSeconds += row.calculation.fact.pausedSeconds
  summary.lateStartSeconds += row.calculation.deviations.lateStartSeconds
  summary.undertimeSeconds += row.calculation.deviations.undertimeSeconds
  summary.overtimeSeconds += row.calculation.deviations.overtimeSeconds
  summary.longPauseSeconds += row.calculation.deviations.longPauseSeconds
}

/**
 * Aggregates only hash-verified, immutable approved-timesheet rows. It is
 * intentionally not a shortcut to live workdays, raw evidence, locations,
 * QR/device proofs or request text. Overlapping approval views are deduped by
 * workday using the newest immutable correction/approval record.
 */
export function buildWorkforceApprovedTimesheetReport(input: {
  start: string
  end: string
  approvals: readonly WorkforceStoredTimesheetApprovalForReport[]
}): WorkforceApprovedTimesheetReport {
  const chosenByWorkday = new Map<string, ReportCandidate>()
  let overlappingRowsSuppressed = 0

  for (const approval of input.approvals) {
    for (const row of storedRows(approval)) {
      if (row.workDate < input.start || row.workDate > input.end) continue
      const candidate: ReportCandidate = {
        row,
        source: {
          id: approval.id,
          agentId: approval.agentId,
          periodStart: approval.periodStart,
          periodEnd: approval.periodEnd,
          recordKind: approval.recordKind,
          revision: approval.revision,
          approvedAt: approval.approvedAt,
        },
      }
      const previous = chosenByWorkday.get(row.workdayId)
      if (!previous) {
        chosenByWorkday.set(row.workdayId, candidate)
        continue
      }
      overlappingRowsSuppressed += 1
      if (candidateWins(candidate, previous)) chosenByWorkday.set(row.workdayId, candidate)
    }
  }

  const total = emptySummary()
  const byEmployee = new Map<string, ReturnType<typeof emptySummary>>()
  for (const candidate of [...chosenByWorkday.values()].sort((left, right) => (
    left.row.agentId.localeCompare(right.row.agentId)
      || left.row.workDate.localeCompare(right.row.workDate)
      || left.row.workdayId.localeCompare(right.row.workdayId)
  ))) {
    appendSummary(total, candidate.row)
    const employee = byEmployee.get(candidate.row.agentId) ?? emptySummary()
    appendSummary(employee, candidate.row)
    byEmployee.set(candidate.row.agentId, employee)
  }

  return {
    source: "HASH_VERIFIED_IMMUTABLE_APPROVALS",
    start: input.start,
    end: input.end,
    summary: {
      employees: byEmployee.size,
      ...total,
      approvalsExamined: input.approvals.length,
      overlappingRowsSuppressed,
    },
    byEmployee: [...byEmployee.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([agentId, summary]) => ({ agentId, ...summary })),
    unavailable: {
      noShow: "UNAVAILABLE_UNTIL_SCHEDULED_EXCEPTION_LIFECYCLE",
      siteTransitions: "EXCLUDED_FROM_APPROVED_TIMESHEET_FACTS",
      freeTextAppeals: "EXCLUDED_FROM_APPROVED_TIMESHEET_FACTS",
    },
  }
}
