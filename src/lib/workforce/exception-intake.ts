import { workforcePolicySnapshotValues } from "@/lib/workforce/policy-definition"
import {
  createWorkforceExceptionCaseDraft,
  type WorkforceExceptionCaseDraft,
} from "@/lib/workforce/exception-case-ledger"
import type { ResolvedWorkforcePolicy } from "@/lib/workforce/policy-resolution"
import { isDateKey } from "@/lib/mtm/mobile-week"
import {
  resolveWorkforceShiftDay,
  workforceShiftDefinitionHash,
} from "@/lib/workforce/shift-definition"
import type { ResolvedWorkforceShiftTemplate } from "@/lib/workforce/shift-resolution"

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

/**
 * Server-resolved policy and shift configuration for a single expected
 * workday.  This is deliberately not a client payload: callers must resolve
 * the effective historical team/policy/shift before passing the result here.
 */
export type WorkforceResolvedNoShowConfiguration = {
  workDate: string
  policy: ResolvedWorkforcePolicy
  shift: ResolvedWorkforceShiftTemplate
}

export type WorkforcePublishedNoShowExpectedSchedule = {
  publication: "PUBLISHED"
  expectedStartAt: string
  graceSeconds: number
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

export const WORKFORCE_NO_SHOW_DETECTOR_VERSION = "workforce-no-show-v1"

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

function validDate(value: Date | null): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime())
}

function dateKey(value: Date): string {
  if (!validDate(value)) throw new WorkforceExceptionIntakeError("WORKFORCE_NO_SHOW_INPUT_INVALID")
  return value.toISOString().slice(0, 10)
}

function activeAtExpectedStart(input: {
  status: string
  activatedAt: Date | null
  retiredAt: Date | null
  expectedStartAt: number
}): boolean {
  if (!validDate(input.activatedAt) || input.activatedAt.getTime() > input.expectedStartAt) return false
  if (input.status === "ACTIVE") {
    return input.retiredAt == null || (
      validDate(input.retiredAt) && input.retiredAt.getTime() >= input.expectedStartAt
    )
  }
  return input.status === "RETIRED"
    && validDate(input.retiredAt)
    && input.retiredAt.getTime() >= input.expectedStartAt
}

/**
 * Converts already server-resolved configuration into the only schedule shape
 * accepted as "published" by the no-show detector.  It independently
 * re-verifies both immutable definition hashes, effective windows, historic
 * team context and the resolved UTC shift boundary.  A draft, future, retired
 * before-start, tampered or mismatched configuration cannot be downgraded to
 * an ordinary grace-period calculation.
 *
 * This is a pure boundary.  It creates no daily snapshot, no workday, no
 * exception case and no notification; a future scheduler must still provide
 * a complete tenant-scoped no-workday observation before any human review.
 */
export function resolvePublishedWorkforceNoShowExpectedSchedule(
  input: WorkforceResolvedNoShowConfiguration,
): WorkforcePublishedNoShowExpectedSchedule {
  if (!isDateKey(input.workDate)) {
    throw new WorkforceExceptionIntakeError("WORKFORCE_NO_SHOW_INPUT_INVALID")
  }
  if (
    input.policy.teamMembershipId !== input.shift.teamMembershipId
    || input.policy.teamIdAtWorkday !== input.shift.teamIdAtWorkday
  ) {
    throw new WorkforceExceptionIntakeError("WORKFORCE_NO_SHOW_INPUT_INVALID")
  }

  const resolvedSchedule = resolveWorkforceShiftDay({
    workDate: input.workDate,
    definition: input.shift.definition,
    templateTimezone: input.shift.timezone,
  })
  if (
    resolvedSchedule == null
    || input.shift.schedule == null
    || input.shift.schedule.workDate !== input.workDate
    || input.shift.schedule.plannedStartAt !== resolvedSchedule.plannedStartAt
    || input.shift.schedule.plannedEndAt !== resolvedSchedule.plannedEndAt
    || !/^[a-f0-9]{64}$/i.test(input.shift.definitionHash)
    || workforceShiftDefinitionHash(input.shift.definition) !== input.shift.definitionHash.toLowerCase()
  ) {
    throw new WorkforceExceptionIntakeError("WORKFORCE_NO_SHOW_INPUT_INVALID")
  }

  const expectedStartAt = canonicalInstant(resolvedSchedule.plannedStartAt)
  if (!activeAtExpectedStart({
    status: input.shift.status,
    activatedAt: input.shift.activatedAt,
    retiredAt: input.shift.retiredAt,
    expectedStartAt,
  })) {
    throw new WorkforceExceptionIntakeError("WORKFORCE_NO_SHOW_INPUT_INVALID")
  }

  const policyValues = workforcePolicySnapshotValues({
    definition: input.policy.definition,
    definitionHash: input.policy.definitionHash,
  })
  if (
    dateKey(input.policy.effectiveFrom) > input.workDate
    || (input.policy.effectiveTo != null && dateKey(input.policy.effectiveTo) < input.workDate)
    || !activeAtExpectedStart({
      status: input.policy.status,
      activatedAt: input.policy.activatedAt,
      retiredAt: input.policy.retiredAt,
      expectedStartAt,
    })
  ) {
    throw new WorkforceExceptionIntakeError("WORKFORCE_NO_SHOW_INPUT_INVALID")
  }

  return {
    publication: "PUBLISHED",
    expectedStartAt: resolvedSchedule.plannedStartAt,
    graceSeconds: policyValues.lateGraceSeconds,
  }
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

/**
 * The server-only counterpart to `proposeWorkforceNoShowReview`. It derives
 * its publication/grace input from hash-verified effective configuration so a
 * future C6 detector does not have to accept a caller-provided PUBLISHED flag
 * or grace value. It remains review-only and has no persistence side effects.
 */
export function proposeWorkforceNoShowReviewFromResolvedConfiguration(input: {
  asOf: string
  configuration: WorkforceResolvedNoShowConfiguration
  calendar: WorkforceNoShowProposalInput["calendar"]
  workdayObservation: WorkforceNoShowProposalInput["workdayObservation"]
}): WorkforceNoShowProposal {
  return proposeWorkforceNoShowReview({
    asOf: input.asOf,
    expectedSchedule: resolvePublishedWorkforceNoShowExpectedSchedule(input.configuration),
    calendar: input.calendar,
    workdayObservation: input.workdayObservation,
  })
}

/**
 * Turns an already server-derived no-show proposal into an immutable C6 case
 * subject. A scheduled absence has no accepted workday by definition, so its
 * published segment and exact expected work date are both required. This
 * helper cannot query configuration, write a row, notify anyone or turn the
 * review proposal into a payroll or disciplinary outcome.
 */
export function createWorkforceNoShowExceptionCaseDraft(input: {
  organizationId: string
  agentId: string
  segmentId: string
  expectedWorkDate: string
  proposal: WorkforceNoShowProposal
}): WorkforceExceptionCaseDraft | null {
  if (input.proposal.outcome !== "PROPOSE_REVIEW_CASE") return null
  return createWorkforceExceptionCaseDraft({
    organizationId: input.organizationId,
    agentId: input.agentId,
    kind: "NO_SHOW",
    detectorVersion: WORKFORCE_NO_SHOW_DETECTOR_VERSION,
    links: {
      segmentId: input.segmentId,
      expectedWorkDate: input.expectedWorkDate,
    },
  })
}

export type WorkforceMissedFinishProposalInput = {
  /** The moment the complete, tenant-scoped open-workday check is performed. */
  asOf: string
  workday: {
    /** A completed workday is never reopened by this proposal path. */
    status: "STARTED" | "PAUSED" | "COMPLETED"
    /** Expected finish comes from an immutable accepted-workday snapshot. */
    scheduleSnapshot: "IMMUTABLE" | "MISSING_OR_AMBIGUOUS"
    expectedFinishAt: string
  }
  observation: "COMPLETE" | "INCOMPLETE"
  timing: {
    /** Eligible only after the expected finish has passed this grace. */
    privateReminderAfterSeconds: number
    /** Must be at or after the reminder threshold; leads to human review. */
    reviewAfterSeconds: number
  }
}

export type WorkforceMissedFinishProposal =
  | {
      outcome: "DO_NOT_ACT"
      code:
        | "WORKFORCE_MISSED_FINISH_WORKDAY_NOT_OPEN"
        | "WORKFORCE_MISSED_FINISH_SNAPSHOT_UNAVAILABLE"
        | "WORKFORCE_MISSED_FINISH_OBSERVATION_INCOMPLETE"
        | "WORKFORCE_MISSED_FINISH_GRACE_NOT_EXPIRED"
    }
  | {
      outcome: "PROPOSE_PRIVATE_REMINDER"
      code: "WORKFORCE_MISSED_FINISH_REMINDER_DUE"
      /** Notification delivery must use generic copy, never reasons/location. */
      notificationPayload: "GENERIC_OPEN_WORKDAY_REMINDER"
    }
  | {
      outcome: "PROPOSE_REVIEW_CASE"
      code: "WORKFORCE_MISSED_FINISH_STALE_OPEN_WORKDAY"
      policy: WorkforceExceptionIntakePolicy
      automaticFinish: "FORBIDDEN"
      correction: "REQUIRES_HUMAN_REVIEW"
  }

/**
 * A stale open workday is a distinct, concrete workday subject. Its detector
 * key therefore has no timing value: retries with the same immutable workday
 * cannot fork cases just because a worker ran later.
 */
export const WORKFORCE_MISSED_FINISH_DETECTOR_VERSION = "workforce-missed-finish-v1"

/**
 * Converts only a server-derived stale-open-workday proposal into the
 * raw-proof-free immutable C6 case subject. This helper neither closes the
 * workday nor sends the preceding private reminder.
 */
export function createWorkforceMissedFinishExceptionCaseDraft(input: {
  organizationId: string
  agentId: string
  workdayId: string
  proposal: WorkforceMissedFinishProposal
}): WorkforceExceptionCaseDraft | null {
  if (input.proposal.outcome !== "PROPOSE_REVIEW_CASE") return null
  return createWorkforceExceptionCaseDraft({
    organizationId: input.organizationId,
    agentId: input.agentId,
    kind: "MISSED_FINISH",
    detectorVersion: WORKFORCE_MISSED_FINISH_DETECTOR_VERSION,
    links: { workdayId: input.workdayId },
  })
}

/**
 * Plans a safe next step for an open workday without inventing a FINISH event.
 * Delivery and case persistence remain separate, audited C6 services.
 */
export function proposeWorkforceMissedFinishAction(
  input: WorkforceMissedFinishProposalInput,
): WorkforceMissedFinishProposal {
  const asOf = canonicalInstant(input.asOf)
  const expectedFinishAt = canonicalInstant(input.workday.expectedFinishAt)
  const privateReminderAfterSeconds = nonNegativeSeconds(input.timing.privateReminderAfterSeconds)
  const reviewAfterSeconds = nonNegativeSeconds(input.timing.reviewAfterSeconds)
  if (reviewAfterSeconds < privateReminderAfterSeconds) {
    throw new WorkforceExceptionIntakeError("WORKFORCE_NO_SHOW_INPUT_INVALID")
  }

  if (input.workday.status === "COMPLETED") {
    return { outcome: "DO_NOT_ACT", code: "WORKFORCE_MISSED_FINISH_WORKDAY_NOT_OPEN" }
  }
  if (input.workday.scheduleSnapshot !== "IMMUTABLE") {
    return { outcome: "DO_NOT_ACT", code: "WORKFORCE_MISSED_FINISH_SNAPSHOT_UNAVAILABLE" }
  }
  if (input.observation !== "COMPLETE") {
    return { outcome: "DO_NOT_ACT", code: "WORKFORCE_MISSED_FINISH_OBSERVATION_INCOMPLETE" }
  }
  if (asOf < expectedFinishAt + privateReminderAfterSeconds * 1000) {
    return { outcome: "DO_NOT_ACT", code: "WORKFORCE_MISSED_FINISH_GRACE_NOT_EXPIRED" }
  }
  if (asOf < expectedFinishAt + reviewAfterSeconds * 1000) {
    return {
      outcome: "PROPOSE_PRIVATE_REMINDER",
      code: "WORKFORCE_MISSED_FINISH_REMINDER_DUE",
      notificationPayload: "GENERIC_OPEN_WORKDAY_REMINDER",
    }
  }
  return {
    outcome: "PROPOSE_REVIEW_CASE",
    code: "WORKFORCE_MISSED_FINISH_STALE_OPEN_WORKDAY",
    policy: WORKFORCE_EXCEPTION_INTAKE_BASELINE_V1,
    automaticFinish: "FORBIDDEN",
    correction: "REQUIRES_HUMAN_REVIEW",
  }
}
