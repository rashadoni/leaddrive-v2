/**
 * This module plans only the recorded one-year time/decision lifecycle. It has
 * no delete operation: immutable Workforce tables require a separately
 * authorized executor with backup, audit, role and legal-review gates.
 */
export const WORKFORCE_TIME_DECISION_RETENTION_YEARS = 1

export const WORKFORCE_TIME_DECISION_RETENTION_CLASSES = [
  "TIME_FACT",
  "DERIVED_VERDICT",
  "REQUEST_REASON",
  "AUDIT_RECORD",
] as const

export type WorkforceTimeDecisionRetentionClass = typeof WORKFORCE_TIME_DECISION_RETENTION_CLASSES[number]

type CountModel = {
  count: (args: Record<string, unknown>) => Promise<number>
}

export type WorkforceTimeDecisionRetentionDb = {
  workforceLegalHold: CountModel
  mtmAgentWorkday: CountModel
  mtmAgentWorkdayEvent: CountModel
  mtmHrmRequest: CountModel
  workforceAttendanceException: CountModel
  workforceTimeCorrection: CountModel
  workforceTimesheetApproval: CountModel
  workforceEvidenceAssessment: CountModel
  mtmAuditLog: CountModel
}

export type WorkforceTimeDecisionRetentionCandidates = {
  workdays: number
  workdayEvents: number
  decidedRequests: number
  resolvedExceptions: number
  corrections: number
  approvals: number
  derivedAssessments: number
  workforceAudits: number
}

export type WorkforceTimeDecisionRetentionPlan = {
  retentionCutoff: string
  eligibleClasses: readonly WorkforceTimeDecisionRetentionClass[]
  activeLegalHoldCount: number
  blockedByLegalHold: boolean
  candidates: WorkforceTimeDecisionRetentionCandidates
  execution: "NOT_AVAILABLE"
}

function validDate(value: Date, name: string): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) throw new RangeError(`${name} must be a valid timestamp`)
  return value
}

function validOrganizationId(value: string): string {
  const normalized = value.trim()
  if (!normalized || normalized.length > 191) throw new RangeError("organizationId is invalid")
  return normalized
}

/** Calendar-year retention prevents a leap-day 365-day shortcut from purging early. */
export function workforceTimeDecisionRetentionCutoff(now: Date): Date {
  const value = validDate(now, "now")
  return new Date(Date.UTC(
    value.getUTCFullYear() - WORKFORCE_TIME_DECISION_RETENTION_YEARS,
    value.getUTCMonth(),
    value.getUTCDate(),
    value.getUTCHours(),
    value.getUTCMinutes(),
    value.getUTCSeconds(),
    value.getUTCMilliseconds(),
  ))
}

function zeroCandidates(): WorkforceTimeDecisionRetentionCandidates {
  return {
    workdays: 0,
    workdayEvents: 0,
    decidedRequests: 0,
    resolvedExceptions: 0,
    corrections: 0,
    approvals: 0,
    derivedAssessments: 0,
    workforceAudits: 0,
  }
}

/**
 * Performs a read-only candidate inventory after a fail-closed legal-hold
 * query. An active tenant-wide TIME_DECISION hold suppresses all subsequent
 * candidate reads. A query error propagates, so an unavailable hold check can
 * never be interpreted as permission to purge.
 */
export async function planWorkforceTimeDecisionRetention(
  db: WorkforceTimeDecisionRetentionDb,
  input: { organizationId: string; now?: Date },
): Promise<WorkforceTimeDecisionRetentionPlan> {
  const organizationId = validOrganizationId(input.organizationId)
  const cutoff = workforceTimeDecisionRetentionCutoff(input.now ?? new Date())
  const activeLegalHoldCount = await db.workforceLegalHold.count({
    where: { organizationId, scope: "TIME_DECISION", status: "ACTIVE" },
  })
  if (activeLegalHoldCount > 0) {
    return {
      retentionCutoff: cutoff.toISOString(),
      eligibleClasses: WORKFORCE_TIME_DECISION_RETENTION_CLASSES,
      activeLegalHoldCount,
      blockedByLegalHold: true,
      candidates: zeroCandidates(),
      execution: "NOT_AVAILABLE",
    }
  }

  const [
    workdays,
    workdayEvents,
    decidedRequests,
    resolvedExceptions,
    corrections,
    approvals,
    derivedAssessments,
    workforceAudits,
  ] = await Promise.all([
    db.mtmAgentWorkday.count({ where: { organizationId, workDate: { lt: cutoff } } }),
    db.mtmAgentWorkdayEvent.count({ where: { organizationId, occurredAt: { lt: cutoff } } }),
    db.mtmHrmRequest.count({ where: {
      organizationId,
      status: { in: ["APPROVED", "REJECTED", "CANCELLED"] },
      updatedAt: { lt: cutoff },
    } }),
    db.workforceAttendanceException.count({ where: {
      organizationId,
      status: "RESOLVED",
      resolvedAt: { lt: cutoff },
    } }),
    db.workforceTimeCorrection.count({ where: { organizationId, occurredAt: { lt: cutoff } } }),
    db.workforceTimesheetApproval.count({ where: { organizationId, approvedAt: { lt: cutoff } } }),
    db.workforceEvidenceAssessment.count({ where: { organizationId, assessedAt: { lt: cutoff } } }),
    db.mtmAuditLog.count({ where: {
      organizationId,
      createdAt: { lt: cutoff },
      OR: [
        { metadataKind: { startsWith: "workforce_" } },
        { metadataKind: { in: ["workday_transition", "hrm_request_decision"] } },
        { action: { startsWith: "WORKFORCE_" } },
        { action: { in: ["WORKDAY_START", "WORKDAY_PAUSE", "WORKDAY_RESUME", "WORKDAY_FINISH", "HRM_REQUEST_DECISION"] } },
      ],
    } }),
  ])

  return {
    retentionCutoff: cutoff.toISOString(),
    eligibleClasses: WORKFORCE_TIME_DECISION_RETENTION_CLASSES,
    activeLegalHoldCount: 0,
    blockedByLegalHold: false,
    candidates: {
      workdays,
      workdayEvents,
      decidedRequests,
      resolvedExceptions,
      corrections,
      approvals,
      derivedAssessments,
      workforceAudits,
    },
    execution: "NOT_AVAILABLE",
  }
}
