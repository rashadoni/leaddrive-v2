/**
 * Safe intake boundary for Workforce attendance exceptions.
 *
 * This module deliberately does not create a database row, assign an owner,
 * apply an SLA, notify anyone, modify a workday or determine pay/discipline.
 * Those actions require the durable C6 case/decision lifecycle and a
 * tenant-approved HR policy. Keeping proposal logic pure prevents an empty
 * workday or a partially loaded roster from silently becoming an absence.
 */

export const WORKFORCE_MATERIALIZED_EXCEPTION_TYPES = [
  "LATE_START",
  "UNDERTIME",
  "OVERTIME",
  "LONG_PAUSE",
] as const

export type WorkforceMaterializedExceptionType = typeof WORKFORCE_MATERIALIZED_EXCEPTION_TYPES[number]

export type WorkforceExceptionIntakePolicy = {
  /** No global severity, owner or clock is a safe substitute for HR policy. */
  assignment: "UNASSIGNED_PENDING_TENANT_POLICY"
  severity: null
  slaSeconds: null
  automaticOutcome: "NONE"
  employeeVisibility: "REQUIRED_BEFORE_HR_DECISION"
  payrollInterpretation: "NONE"
}

/**
 * This is a product-safe baseline rather than an enabled tenant policy. In
 * particular, it must not be used to auto-resolve, punish or pay an employee.
 */
export const WORKFORCE_EXCEPTION_INTAKE_BASELINE_V1: WorkforceExceptionIntakePolicy = {
  assignment: "UNASSIGNED_PENDING_TENANT_POLICY",
  severity: null,
  slaSeconds: null,
  automaticOutcome: "NONE",
  employeeVisibility: "REQUIRED_BEFORE_HR_DECISION",
  payrollInterpretation: "NONE",
}

export type WorkforceMaterializedExceptionIntake = {
  kind: "MATERIALIZED_DEVIATION"
  type: WorkforceMaterializedExceptionType
  policy: WorkforceExceptionIntakePolicy
  /** Overtime is operational only until an approved payroll integration exists. */
  operationalLabel: "ATTENDANCE_DEVIATION" | "NON_PAYABLE_OVERTIME_DEVIATION"
}

/**
 * Converts an already-calculated deviation into a review-only intake record.
 * It does not alter the existing `WorkforceAttendanceException` lifecycle.
 */
export function intakeMaterializedWorkforceException(
  type: WorkforceMaterializedExceptionType,
): WorkforceMaterializedExceptionIntake {
  if (!WORKFORCE_MATERIALIZED_EXCEPTION_TYPES.includes(type)) {
    throw new WorkforceExceptionIntakeError("WORKFORCE_EXCEPTION_TYPE_INVALID")
  }
  return {
    kind: "MATERIALIZED_DEVIATION",
    type,
    policy: WORKFORCE_EXCEPTION_INTAKE_BASELINE_V1,
    operationalLabel: type === "OVERTIME"
      ? "NON_PAYABLE_OVERTIME_DEVIATION"
      : "ATTENDANCE_DEVIATION",
  }
}

export type WorkforceNoShowProposalInput = {
  /** The moment the complete, tenant-scoped check is performed. */
  asOf: string
  expectedSchedule: {
    /** Draft or inferred schedules are never sufficient absence evidence. */
    publication: "PUBLISHED" | "DRAFT" | "UNKNOWN"
    expectedStartAt: string
    graceSeconds: number
  }
  calendar: {
    /** Derived from the effective employee calendar, not weekday arithmetic. */
    attendanceExpected: boolean
    noShowEligible: boolean
    /** Includes approved Workforce leave/absence and other excused outcomes. */
    excused: boolean
  }
  workdayObservation: "COMPLETE_SEARCH_NO_WORKDAY" | "WORKDAY_EXISTS" | "INCOMPLETE_SEARCH"
}

export type WorkforceNoShowProposal =
  | {
      outcome: "DO_NOT_CREATE"
      code:
        | "WORKFORCE_NO_SHOW_SCHEDULE_NOT_PUBLISHED"
        | "WORKFORCE_NO_SHOW_CALENDAR_NOT_ELIGIBLE"
        | "WORKFORCE_NO_SHOW_EXCUSED"
        | "WORKFORCE_NO_SHOW_WORKDAY_EXISTS"
        | "WORKFORCE_NO_SHOW_OBSERVATION_INCOMPLETE"
        | "WORKFORCE_NO_SHOW_GRACE_NOT_EXPIRED"
    }
  | {
      outcome: "PROPOSE_REVIEW_CASE"
      code: "WORKFORCE_NO_SHOW_PUBLISHED_EXPECTATION_MISSED"
      policy: WorkforceExceptionIntakePolicy
    }

export class WorkforceExceptionIntakeError extends Error {
  constructor(readonly code: "WORKFORCE_EXCEPTION_TYPE_INVALID" | "WORKFORCE_NO_SHOW_INPUT_INVALID") {
    super(code)
  }
}

function canonicalInstant(value: string): number {
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    throw new WorkforceExceptionIntakeError("WORKFORCE_NO_SHOW_INPUT_INVALID")
  }
  return parsed
}

function nonNegativeSeconds(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new WorkforceExceptionIntakeError("WORKFORCE_NO_SHOW_INPUT_INVALID")
  }
  return value
}

/**
 * Gives a detector a safe, deterministic result for a potential no-show.
 * `PROPOSE_REVIEW_CASE` intentionally remains a proposal: a later durable
 * lifecycle may deduplicate it and ask HR to decide, but this helper cannot
 * create a case, send a notification, set a severity or fabricate a finish.
 */
export function proposeWorkforceNoShowReview(
  input: WorkforceNoShowProposalInput,
): WorkforceNoShowProposal {
  const asOf = canonicalInstant(input.asOf)
  const expectedStartAt = canonicalInstant(input.expectedSchedule.expectedStartAt)
  const graceSeconds = nonNegativeSeconds(input.expectedSchedule.graceSeconds)

  if (input.expectedSchedule.publication !== "PUBLISHED") {
    return { outcome: "DO_NOT_CREATE", code: "WORKFORCE_NO_SHOW_SCHEDULE_NOT_PUBLISHED" }
  }
  if (input.calendar.excused) {
    return { outcome: "DO_NOT_CREATE", code: "WORKFORCE_NO_SHOW_EXCUSED" }
  }
  if (!input.calendar.attendanceExpected || !input.calendar.noShowEligible) {
    return { outcome: "DO_NOT_CREATE", code: "WORKFORCE_NO_SHOW_CALENDAR_NOT_ELIGIBLE" }
  }
  if (input.workdayObservation === "INCOMPLETE_SEARCH") {
    return { outcome: "DO_NOT_CREATE", code: "WORKFORCE_NO_SHOW_OBSERVATION_INCOMPLETE" }
  }
  if (input.workdayObservation === "WORKDAY_EXISTS") {
    return { outcome: "DO_NOT_CREATE", code: "WORKFORCE_NO_SHOW_WORKDAY_EXISTS" }
  }
  if (asOf < expectedStartAt + graceSeconds * 1000) {
    return { outcome: "DO_NOT_CREATE", code: "WORKFORCE_NO_SHOW_GRACE_NOT_EXPIRED" }
  }
  return {
    outcome: "PROPOSE_REVIEW_CASE",
    code: "WORKFORCE_NO_SHOW_PUBLISHED_EXPECTATION_MISSED",
    policy: WORKFORCE_EXCEPTION_INTAKE_BASELINE_V1,
  }
}
