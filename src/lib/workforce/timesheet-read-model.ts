import {
  evaluateWorkforceExceptionDraftLifecycle,
  WORKFORCE_EXCEPTION_DRAFT_TYPES,
  type WorkforceExceptionDraftType,
} from "@/lib/workforce/exception-policy-draft"
import {
  buildWorkforceTimesheetApproval,
  type WorkforceTimesheetApprovalRow,
} from "@/lib/workforce/timesheet-approval"

export const WORKFORCE_TIMESHEET_READ_MODEL_LIMITS = {
  events: 1_000,
  transitions: 1_000,
  exceptions: 500,
  exceptionCases: 500,
  decisionsPerCase: 64,
  approvalRevisions: 64,
  rowsPerApproval: 93,
  eventRecordsPerRequest: 20_000,
  transitionRecordsPerRequest: 10_000,
  calculationExceptionRecordsPerRequest: 5_000,
} as const

const ATTENDANCE_REVIEW_STATES = [
  "LEGACY_UNKNOWN",
  "NOT_REQUIRED",
  "PENDING_REVIEW",
] as const

export const WORKFORCE_TIMESHEET_EXCEPTION_STATUSES = [
  "OPEN",
  "ACKNOWLEDGED",
  "AWAITING_EMPLOYEE_RESPONSE",
  "HR_REVIEW",
  "RESOLVED",
  "DATA_INTEGRITY_REVIEW",
] as const

type AttendanceReviewState = typeof ATTENDANCE_REVIEW_STATES[number]
export type WorkforceTimesheetEvidenceReviewState = AttendanceReviewState | "NOT_RECORDED"
export type WorkforceTimesheetExceptionStatus = typeof WORKFORCE_TIMESHEET_EXCEPTION_STATUSES[number]

export type WorkforceTimesheetAttendanceReviewInput = {
  attendanceReviewState: unknown
  [key: string]: unknown
}

export type WorkforceTimesheetExceptionReadInput = {
  type: unknown
  status: unknown
  [key: string]: unknown
}

export type WorkforceTimesheetExceptionCaseReadInput = {
  kind: unknown
  decisions: unknown
  decisionHistoryTruncated: unknown
  [key: string]: unknown
}

export type WorkforceTimesheetApprovalRevisionReadInput = {
  id: string
  agentId: string
  periodStart: Date
  periodEnd: Date
  recordKind: "APPROVAL" | "CORRECTION"
  revision: number
  supersedesId: string | null
  calculationVersion: number
  rowsHash: string
  factsHash: string
  rows: unknown
}

export type WorkforceTimesheetReadModel = {
  source: "BOUNDED_VERIFIED_TIMESHEET_FACTS"
  evidenceReview: {
    state: WorkforceTimesheetEvidenceReviewState
    events: WorkforceTimesheetEvidenceReviewState
    transitions: WorkforceTimesheetEvidenceReviewState
  }
  exceptions: Array<{
    type: WorkforceExceptionDraftType
    status: WorkforceTimesheetExceptionStatus
  }>
  approval: {
    state: "NOT_APPROVED" | "APPROVED" | "CORRECTED"
    verification: "NO_APPROVAL" | "HASH_AND_CHAIN_VERIFIED"
    revisionCount: number
    currentRevision: number | null
    currentCalculationVersion: 1 | 2 | null
    revisions: Array<{
      revision: number
      recordKind: "APPROVAL" | "CORRECTION"
      calculationVersion: 1 | 2
    }>
  }
  boundaries: {
    identifiers: "EXCLUDED_FROM_READ_MODEL"
    reasons: "EXCLUDED_FROM_READ_MODEL"
    rawEvidence: "EXCLUDED_FROM_READ_MODEL"
    location: "EXCLUDED_FROM_READ_MODEL"
    actors: "EXCLUDED_FROM_READ_MODEL"
  }
}

export class WorkforceTimesheetReadModelError extends Error {
  readonly code = "WORKFORCE_TIMESHEET_READ_MODEL_INVALID"

  constructor() {
    super("WORKFORCE_TIMESHEET_READ_MODEL_INVALID")
  }
}

const ATTENDANCE_REVIEW_STATE_SET = new Set<string>(ATTENDANCE_REVIEW_STATES)
const EXCEPTION_TYPE_SET = new Set<string>(WORKFORCE_EXCEPTION_DRAFT_TYPES)
const EXCEPTION_STATUS_SET = new Set<string>(WORKFORCE_TIMESHEET_EXCEPTION_STATUSES)
const CALCULATED_EXCEPTION_TYPE_SET = new Set<string>([
  "LATE_START",
  "UNDERTIME",
  "OVERTIME",
  "LONG_PAUSE",
])
const CALCULATED_EXCEPTION_STATUS_SET = new Set<string>(["OPEN", "ACKNOWLEDGED", "RESOLVED"])
const EXCEPTION_TYPE_ORDER = new Map<string, number>(
  WORKFORCE_EXCEPTION_DRAFT_TYPES.map((value, index) => [value, index]),
)
const EXCEPTION_STATUS_ORDER = new Map<string, number>(
  WORKFORCE_TIMESHEET_EXCEPTION_STATUSES.map((value, index) => [value, index]),
)
const HASH = /^[a-f0-9]{64}$/
const PRIVATE_IDENTIFIER = /^[^\u0000-\u001f\u007f]{1,191}$/

function invalid(): never {
  throw new WorkforceTimesheetReadModelError()
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function boundedArray(value: unknown, maximum: number): readonly unknown[] {
  if (!Array.isArray(value) || value.length > maximum) invalid()
  return value
}

function attendanceState(value: unknown): AttendanceReviewState {
  if (typeof value !== "string" || !ATTENDANCE_REVIEW_STATE_SET.has(value)) invalid()
  return value as AttendanceReviewState
}

function reviewState(records: readonly unknown[]): WorkforceTimesheetEvidenceReviewState {
  let result: WorkforceTimesheetEvidenceReviewState = "NOT_RECORDED"
  for (const item of records) {
    if (!record(item)) invalid()
    const state = attendanceState(item.attendanceReviewState)
    if (state === "PENDING_REVIEW") result = "PENDING_REVIEW"
    else if (state === "LEGACY_UNKNOWN" && result !== "PENDING_REVIEW") result = "LEGACY_UNKNOWN"
    else if (state === "NOT_REQUIRED" && result === "NOT_RECORDED") result = "NOT_REQUIRED"
  }
  return result
}

function combinedReviewState(
  events: WorkforceTimesheetEvidenceReviewState,
  transitions: WorkforceTimesheetEvidenceReviewState,
): WorkforceTimesheetEvidenceReviewState {
  if (events === "PENDING_REVIEW" || transitions === "PENDING_REVIEW") return "PENDING_REVIEW"
  if (events === "LEGACY_UNKNOWN" || transitions === "LEGACY_UNKNOWN") return "LEGACY_UNKNOWN"
  if (events === "NOT_REQUIRED" || transitions === "NOT_REQUIRED") return "NOT_REQUIRED"
  return "NOT_RECORDED"
}

export function projectWorkforceTimesheetEvidenceReview(input: {
  events: readonly WorkforceTimesheetAttendanceReviewInput[]
  transitions: readonly WorkforceTimesheetAttendanceReviewInput[]
}): WorkforceTimesheetReadModel["evidenceReview"] {
  if (!record(input)) invalid()
  const events = reviewState(boundedArray(input.events, WORKFORCE_TIMESHEET_READ_MODEL_LIMITS.events))
  const transitions = reviewState(boundedArray(
    input.transitions,
    WORKFORCE_TIMESHEET_READ_MODEL_LIMITS.transitions,
  ))
  return {
    state: combinedReviewState(events, transitions),
    events,
    transitions,
  }
}

export function projectWorkforceTimesheetExceptions(
  value: readonly WorkforceTimesheetExceptionReadInput[],
  caseValue: readonly WorkforceTimesheetExceptionCaseReadInput[] = [],
): WorkforceTimesheetReadModel["exceptions"] {
  const input = boundedArray(value, WORKFORCE_TIMESHEET_READ_MODEL_LIMITS.exceptions)
  const cases = boundedArray(caseValue, WORKFORCE_TIMESHEET_READ_MODEL_LIMITS.exceptionCases)
  const projected = new Map<string, WorkforceTimesheetReadModel["exceptions"][number]>()
  for (const item of input) {
    if (
      !record(item)
      || typeof item.type !== "string"
      || !CALCULATED_EXCEPTION_TYPE_SET.has(item.type)
      || typeof item.status !== "string"
      || !CALCULATED_EXCEPTION_STATUS_SET.has(item.status)
    ) invalid()
    const exception = {
      type: item.type as WorkforceExceptionDraftType,
      status: item.status as WorkforceTimesheetExceptionStatus,
    }
    projected.set(`${exception.type}\u0000${exception.status}`, exception)
  }
  for (const item of cases) {
    if (
      !record(item)
      || typeof item.kind !== "string"
      || !EXCEPTION_TYPE_SET.has(item.kind)
      || typeof item.decisionHistoryTruncated !== "boolean"
    ) invalid()
    const decisions = boundedArray(
      item.decisions,
      WORKFORCE_TIMESHEET_READ_MODEL_LIMITS.decisionsPerCase + 1,
    )
    let contiguous = decisions.length <= WORKFORCE_TIMESHEET_READ_MODEL_LIMITS.decisionsPerCase
    const decisionCodes: Array<{ decisionCode: string }> = []
    for (let index = 0; index < decisions.length; index += 1) {
      const decision = decisions[index]
      if (
        !record(decision)
        || typeof decision.decisionCode !== "string"
        || !decision.decisionCode
        || decision.decisionCode.length > 64
        || typeof decision.caseRevision !== "number"
        || !Number.isSafeInteger(decision.caseRevision)
        || decision.caseRevision < 1
      ) invalid()
      if (decision.caseRevision !== index + 1) contiguous = false
      decisionCodes.push({ decisionCode: decision.decisionCode })
    }
    const lifecycle = contiguous && !item.decisionHistoryTruncated
      ? evaluateWorkforceExceptionDraftLifecycle(decisionCodes)
      : null
    const exception = {
      type: item.kind as WorkforceExceptionDraftType,
      status: (
        lifecycle?.valid ? lifecycle.stage : "DATA_INTEGRITY_REVIEW"
      ) as WorkforceTimesheetExceptionStatus,
    }
    if (!EXCEPTION_STATUS_SET.has(exception.status)) invalid()
    projected.set(`${exception.type}\u0000${exception.status}`, exception)
  }
  return [...projected.values()].sort((left, right) => (
    EXCEPTION_TYPE_ORDER.get(left.type)! - EXCEPTION_TYPE_ORDER.get(right.type)!
    || EXCEPTION_STATUS_ORDER.get(left.status)! - EXCEPTION_STATUS_ORDER.get(right.status)!
  ))
}

function privateIdentifier(value: unknown): string {
  if (typeof value !== "string" || value.trim() !== value || !PRIVATE_IDENTIFIER.test(value)) invalid()
  return value
}

function dateKey(value: unknown): string {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) invalid()
  const serialized = value.toISOString()
  const result = serialized.slice(0, 10)
  if (serialized !== `${result}T00:00:00.000Z`) invalid()
  return result
}

function positiveSafeInteger(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) invalid()
  return value
}

function calculationVersion(value: unknown): 1 | 2 {
  if (value !== 1 && value !== 2) invalid()
  return value
}

type VerifiedApprovalRevision = {
  id: string
  supersedesId: string | null
  scope: string
  recordKind: "APPROVAL" | "CORRECTION"
  revision: number
  calculationVersion: 1 | 2
  rowsHash: string
  factsHash: string
}

function verifyApprovalRevision(value: unknown): VerifiedApprovalRevision {
  if (!record(value)) invalid()
  const id = privateIdentifier(value.id)
  const agentId = privateIdentifier(value.agentId)
  const periodStart = dateKey(value.periodStart)
  const periodEnd = dateKey(value.periodEnd)
  const periodDays = (
    Date.parse(`${periodEnd}T00:00:00.000Z`) - Date.parse(`${periodStart}T00:00:00.000Z`)
  ) / 86_400_000
  if (periodStart > periodEnd || periodDays > WORKFORCE_TIMESHEET_READ_MODEL_LIMITS.rowsPerApproval - 1) {
    invalid()
  }
  if (value.recordKind !== "APPROVAL" && value.recordKind !== "CORRECTION") invalid()
  const revision = positiveSafeInteger(value.revision)
  if (revision > WORKFORCE_TIMESHEET_READ_MODEL_LIMITS.approvalRevisions) invalid()
  const version = calculationVersion(value.calculationVersion)
  if (typeof value.rowsHash !== "string" || !HASH.test(value.rowsHash)) invalid()
  if (typeof value.factsHash !== "string" || !HASH.test(value.factsHash)) invalid()
  if (value.supersedesId !== null && typeof value.supersedesId !== "string") invalid()
  const supersedesId = value.supersedesId === null ? null : privateIdentifier(value.supersedesId)
  const rows = boundedArray(value.rows, WORKFORCE_TIMESHEET_READ_MODEL_LIMITS.rowsPerApproval)
  if (rows.length === 0) invalid()
  for (const row of rows) {
    if (
      !record(row)
      || row.calculationVersion !== version
      || !record(row.calculation)
      || row.calculation.calculationVersion !== version
      || (
        version === 2
        && (row.calculation.coreCalculationVersion !== 1 || !record(row.calculation.immutableSchedule))
      )
    ) invalid()
  }

  try {
    const verified = buildWorkforceTimesheetApproval({
      periodStart,
      periodEnd,
      agentId,
      rows: rows as readonly WorkforceTimesheetApprovalRow[],
    })
    if (
      verified.calculationVersion !== version
      || verified.rowsHash !== value.rowsHash
      || verified.factsHash !== value.factsHash
    ) invalid()
  } catch (error) {
    if (error instanceof WorkforceTimesheetReadModelError) throw error
    invalid()
  }

  return {
    id,
    supersedesId,
    scope: `${agentId}\u0000${periodStart}\u0000${periodEnd}`,
    recordKind: value.recordKind,
    revision,
    calculationVersion: version,
    rowsHash: value.rowsHash,
    factsHash: value.factsHash,
  }
}

export function summarizeWorkforceTimesheetApprovalRevisions(
  value: readonly WorkforceTimesheetApprovalRevisionReadInput[],
): WorkforceTimesheetReadModel["approval"] {
  const input = boundedArray(value, WORKFORCE_TIMESHEET_READ_MODEL_LIMITS.approvalRevisions)
  if (input.length === 0) {
    return {
      state: "NOT_APPROVED",
      verification: "NO_APPROVAL",
      revisionCount: 0,
      currentRevision: null,
      currentCalculationVersion: null,
      revisions: [],
    }
  }

  const revisions = input.map(verifyApprovalRevision)
    .sort((left, right) => left.revision - right.revision || left.id.localeCompare(right.id))
  const ids = new Set<string>()
  const scope = revisions[0].scope
  for (let index = 0; index < revisions.length; index += 1) {
    const current = revisions[index]
    const previous = revisions[index - 1]
    if (ids.has(current.id) || current.scope !== scope) invalid()
    ids.add(current.id)
    if (index === 0) {
      if (current.revision !== 1 || current.recordKind !== "APPROVAL" || current.supersedesId !== null) {
        invalid()
      }
      continue
    }
    if (
      current.revision !== previous.revision + 1
      || current.recordKind !== "CORRECTION"
      || current.supersedesId !== previous.id
      || current.calculationVersion < previous.calculationVersion
      || (
        current.rowsHash === previous.rowsHash
        && current.factsHash === previous.factsHash
      )
    ) invalid()
  }

  const latest = revisions[revisions.length - 1]
  return {
    state: latest.recordKind === "CORRECTION" ? "CORRECTED" : "APPROVED",
    verification: "HASH_AND_CHAIN_VERIFIED",
    revisionCount: revisions.length,
    currentRevision: latest.revision,
    currentCalculationVersion: latest.calculationVersion,
    revisions: revisions.map(({ revision, recordKind, calculationVersion }) => ({
      revision,
      recordKind,
      calculationVersion,
    })),
  }
}

export function buildWorkforceTimesheetReadModel(input: {
  events: readonly WorkforceTimesheetAttendanceReviewInput[]
  transitions: readonly WorkforceTimesheetAttendanceReviewInput[]
  exceptions: readonly WorkforceTimesheetExceptionReadInput[]
  exceptionCases: readonly WorkforceTimesheetExceptionCaseReadInput[]
  approvals: readonly WorkforceTimesheetApprovalRevisionReadInput[]
}): WorkforceTimesheetReadModel {
  if (!record(input)) invalid()
  return {
    source: "BOUNDED_VERIFIED_TIMESHEET_FACTS",
    evidenceReview: projectWorkforceTimesheetEvidenceReview({
      events: input.events,
      transitions: input.transitions,
    }),
    exceptions: projectWorkforceTimesheetExceptions(input.exceptions, input.exceptionCases),
    approval: summarizeWorkforceTimesheetApprovalRevisions(input.approvals),
    boundaries: {
      identifiers: "EXCLUDED_FROM_READ_MODEL",
      reasons: "EXCLUDED_FROM_READ_MODEL",
      rawEvidence: "EXCLUDED_FROM_READ_MODEL",
      location: "EXCLUDED_FROM_READ_MODEL",
      actors: "EXCLUDED_FROM_READ_MODEL",
    },
  }
}
