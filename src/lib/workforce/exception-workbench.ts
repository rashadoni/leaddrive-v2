import {
  evaluateWorkforceExceptionDraftLifecycle,
  type WorkforceExceptionDraftStage,
} from "@/lib/workforce/exception-policy-draft"

// Keep this identical to the approval service's reviewed lifecycle bound. A
// queue must never offer an action for a history that approval would truncate.
export const MAX_WORKFORCE_EXCEPTION_DECISIONS = 64
export const MAX_WORKFORCE_EXCEPTION_CORRECTION_REQUESTS = 20

export const WORKFORCE_EXCEPTION_WORKBENCH_DECISIONS = [
  "ACKNOWLEDGE",
  "REQUEST_EMPLOYEE_RESPONSE",
  "REQUEST_TIME_CORRECTION",
  "RESOLVE_NO_CHANGE",
  "RESOLVE_WITH_CORRECTION",
  "REOPEN_FOR_REVIEW",
] as const

export type WorkforceExceptionWorkbenchDecision = typeof WORKFORCE_EXCEPTION_WORKBENCH_DECISIONS[number]
export type WorkforceExceptionCorrectionState =
  | "NOT_REQUESTED"
  | "PENDING"
  | "DECLINED"
  | "APPLIED"
  | "INTEGRITY_REVIEW"

export type WorkforceExceptionCorrectionRequestFact = {
  type: string
  status: string
  appliedCorrectionCount: number
  submittedAt: Date
}

export type WorkforceExceptionDecisionFact = {
  decisionCode: string
  createdAt: Date
}

export type WorkforceExceptionWorkbenchContext = {
  stage: WorkforceExceptionDraftStage | "DATA_INTEGRITY_REVIEW"
  correctionState: WorkforceExceptionCorrectionState
  employeeVisibility: "NOT_RECORDED" | "RECORDED"
  availableDecisions: readonly WorkforceExceptionWorkbenchDecision[]
}

function validInstant(value: unknown): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime())
}

function correctionState(input: {
  correctionRequests: readonly WorkforceExceptionCorrectionRequestFact[]
  correctionContextComplete: boolean
}): WorkforceExceptionCorrectionState {
  if (!input.correctionContextComplete
    || input.correctionRequests.length > MAX_WORKFORCE_EXCEPTION_CORRECTION_REQUESTS) {
    return "INTEGRITY_REVIEW"
  }
  let pending = 0
  let declined = 0
  let applied = 0
  for (const request of input.correctionRequests) {
    if (request.type !== "TIME_CORRECTION" || !Number.isInteger(request.appliedCorrectionCount)
      || request.appliedCorrectionCount < 0 || request.appliedCorrectionCount > 1
      || !validInstant(request.submittedAt)) {
      return "INTEGRITY_REVIEW"
    }
    switch (request.status) {
      case "PENDING":
        if (request.appliedCorrectionCount !== 0) return "INTEGRITY_REVIEW"
        pending += 1
        break
      case "REJECTED":
      case "CANCELLED":
        if (request.appliedCorrectionCount !== 0) return "INTEGRITY_REVIEW"
        declined += 1
        break
      case "APPROVED":
        if (request.appliedCorrectionCount !== 1) return "INTEGRITY_REVIEW"
        applied += 1
        break
      default:
        return "INTEGRITY_REVIEW"
    }
  }
  if (applied > 1) return "INTEGRITY_REVIEW"
  // A newer request may still be pending after an earlier correction and
  // therefore blocks every resolution until its own outcome is known.
  if (pending > 0) return "PENDING"
  if (applied === 1) return "APPLIED"
  if (declined > 0) return "DECLINED"
  return "NOT_REQUESTED"
}

function resolvedHistoryMatchesCorrection(input: {
  priorDecisions: readonly WorkforceExceptionDecisionFact[]
  correctionState: WorkforceExceptionCorrectionState
}): boolean {
  const resolution = [...input.priorDecisions].reverse().find(({ decisionCode }) => (
    decisionCode === "RESOLVE_NO_CHANGE" || decisionCode === "RESOLVE_WITH_CORRECTION"
  ))?.decisionCode
  if (resolution === "RESOLVE_WITH_CORRECTION") return input.correctionState === "APPLIED"
  if (resolution === "RESOLVE_NO_CHANGE") {
    return input.correctionState !== "APPLIED" && input.correctionState !== "PENDING"
  }
  return false
}

function scheduleOnlyNoShowDecisions(stage: WorkforceExceptionDraftStage): readonly WorkforceExceptionWorkbenchDecision[] {
  switch (stage) {
    case "OPEN": return ["ACKNOWLEDGE"]
    // Terminal resolution/reopen stays unavailable until every linked
    // request/response writer adopts the same case lock in a later slice.
    case "HR_REVIEW":
    case "RESOLVED": return []
    case "AWAITING_EMPLOYEE_RESPONSE": return []
  }
}

function currentCycleEmployeeVisibility(input: {
  priorDecisions: readonly WorkforceExceptionDecisionFact[]
  employeeResponseInstants: readonly Date[]
  correctionRequests: readonly WorkforceExceptionCorrectionRequestFact[]
}): "NOT_RECORDED" | "RECORDED" | "INTEGRITY_REVIEW" {
  if (input.employeeResponseInstants.some((instant) => !validInstant(instant))) return "INTEGRITY_REVIEW"
  const resetAt = input.priorDecisions.reduce<Date | null>((latest, decision) => (
    ["REQUEST_EMPLOYEE_RESPONSE", "REQUEST_TIME_CORRECTION", "REOPEN_FOR_REVIEW"].includes(decision.decisionCode)
      && (latest == null || decision.createdAt > latest)
      ? decision.createdAt
      : latest
  ), null)
  const signals = [
    ...input.employeeResponseInstants,
    ...input.correctionRequests.map((request) => request.submittedAt),
  ]
  return signals.some((instant) => resetAt == null || instant >= resetAt) ? "RECORDED" : "NOT_RECORDED"
}

/**
 * Computes the complete bounded v1 manager action set from immutable decision
 * history plus status-only employee/correction context. It never consumes a
 * reason, request id, proof payload or mutable directory team.
 */
export function evaluateWorkforceExceptionWorkbenchContext(input: {
  kind: string
  workdayId: string | null
  priorDecisions: readonly WorkforceExceptionDecisionFact[]
  decisionHistoryComplete: boolean
  employeeResponseInstants: readonly Date[]
  correctionRequests: readonly WorkforceExceptionCorrectionRequestFact[]
  correctionContextComplete: boolean
}): WorkforceExceptionWorkbenchContext {
  const correction = correctionState(input)
  const decisionFactsValid = input.priorDecisions.every((decision) => validInstant(decision.createdAt))
  const employeeVisibility = currentCycleEmployeeVisibility(input)
  const lifecycle = input.decisionHistoryComplete
    && input.priorDecisions.length <= MAX_WORKFORCE_EXCEPTION_DECISIONS
    && decisionFactsValid
    ? evaluateWorkforceExceptionDraftLifecycle(
        input.priorDecisions.map(({ decisionCode }) => ({ decisionCode })),
      )
    : { valid: false as const }
  if (!lifecycle.valid || correction === "INTEGRITY_REVIEW"
    || employeeVisibility === "INTEGRITY_REVIEW") {
    return {
      stage: "DATA_INTEGRITY_REVIEW",
      correctionState: "INTEGRITY_REVIEW",
      employeeVisibility: "NOT_RECORDED",
      availableDecisions: [],
    }
  }
  // Sixty-four is the maximum stored stream accepted by downstream approval.
  // It remains a valid readable history, but only an exact operation replay
  // may succeed at the bound; the queue must not offer a 65th append.
  const decisionCapacityReached = input.priorDecisions.length >= MAX_WORKFORCE_EXCEPTION_DECISIONS

  const scheduleOnlyNoShow = input.kind === "NO_SHOW" && input.workdayId == null
  if (scheduleOnlyNoShow) {
    const invalidHistory = input.priorDecisions.some(({ decisionCode }) => ![
      "ACKNOWLEDGE", "ESCALATE_TO_HR", "RESOLVE_NO_CHANGE", "REOPEN_FOR_REVIEW",
    ].includes(decisionCode))
    if (input.employeeResponseInstants.length > 0 || input.correctionRequests.length > 0
      || invalidHistory || lifecycle.stage === "AWAITING_EMPLOYEE_RESPONSE") {
      return {
        stage: "DATA_INTEGRITY_REVIEW",
        correctionState: "INTEGRITY_REVIEW",
        employeeVisibility: "NOT_RECORDED",
        availableDecisions: [],
      }
    }
    return {
      stage: lifecycle.stage,
      correctionState: "NOT_REQUESTED",
      employeeVisibility: "NOT_RECORDED",
      availableDecisions: decisionCapacityReached ? [] : scheduleOnlyNoShowDecisions(lifecycle.stage),
    }
  }

  if (lifecycle.stage === "RESOLVED" && !resolvedHistoryMatchesCorrection({
    priorDecisions: input.priorDecisions,
    correctionState: correction,
  })) {
    return {
      stage: "DATA_INTEGRITY_REVIEW",
      correctionState: "INTEGRITY_REVIEW",
      employeeVisibility: "NOT_RECORDED",
      availableDecisions: [],
    }
  }

  let availableDecisions: readonly WorkforceExceptionWorkbenchDecision[]
  switch (lifecycle.stage) {
    case "OPEN":
      availableDecisions = ["ACKNOWLEDGE"]
      break
    case "AWAITING_EMPLOYEE_RESPONSE":
      availableDecisions = employeeVisibility === "RECORDED" ? ["ACKNOWLEDGE"] : []
      break
    case "HR_REVIEW":
      if (correction === "PENDING") availableDecisions = []
      else if (correction === "APPLIED") availableDecisions = []
      else availableDecisions = input.workdayId
        ? ["REQUEST_EMPLOYEE_RESPONSE", "REQUEST_TIME_CORRECTION"]
        : []
      break
    case "RESOLVED":
      availableDecisions = []
      break
  }
  return {
    stage: lifecycle.stage,
    correctionState: correction,
    employeeVisibility,
    availableDecisions: decisionCapacityReached ? [] : availableDecisions,
  }
}

export class WorkforceExceptionWorkbenchContextError extends Error {
  constructor(readonly code = "WORKFORCE_EXCEPTION_DECISION_CONTEXT_INVALID") {
    super(code)
  }
}

export function requireWorkforceExceptionWorkbenchDecision(input: {
  context: WorkforceExceptionWorkbenchContext
  decisionCode: string
}): asserts input is {
  context: WorkforceExceptionWorkbenchContext
  decisionCode: WorkforceExceptionWorkbenchDecision
} {
  if (!input.context.availableDecisions.includes(input.decisionCode as WorkforceExceptionWorkbenchDecision)) {
    throw new WorkforceExceptionWorkbenchContextError()
  }
}
