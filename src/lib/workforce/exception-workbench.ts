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
  /** Decision revision observed while the linked request held the case lock. */
  exceptionCaseRevision: number | null
}

export type WorkforceExceptionDecisionFact = {
  decisionCode: string
  caseRevision: number
}

export type WorkforceExceptionEmployeeResponseFact = {
  /** Decision revision observed while the response held the case lock. */
  observedCaseRevision: number | null
}

export type WorkforceExceptionWorkbenchContext = {
  stage: WorkforceExceptionDraftStage | "DATA_INTEGRITY_REVIEW"
  correctionState: WorkforceExceptionCorrectionState
  employeeVisibility: "NOT_RECORDED" | "RECORDED"
  availableDecisions: readonly WorkforceExceptionWorkbenchDecision[]
}

export type WorkforceExceptionSelfResponseState =
  | "UNAVAILABLE"
  | "NOT_ACKNOWLEDGED"
  | "ACKNOWLEDGED"

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
      || request.appliedCorrectionCount < 0 || request.appliedCorrectionCount > 1) {
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
    // Terminal resolution/reopen stays unavailable until a separately
    // reviewed, versioned and default-off terminal policy is activated.
    case "HR_REVIEW":
    case "RESOLVED": return []
    case "AWAITING_EMPLOYEE_RESPONSE": return []
  }
}

function currentCycleEmployeeVisibility(input: {
  priorDecisions: readonly WorkforceExceptionDecisionFact[]
  employeeResponses: readonly WorkforceExceptionEmployeeResponseFact[]
  correctionRequests: readonly WorkforceExceptionCorrectionRequestFact[]
}): "NOT_RECORDED" | "RECORDED" | "INTEGRITY_REVIEW" {
  const currentRevision = input.priorDecisions.length
  const revisions = [
    ...input.employeeResponses.map((response) => response.observedCaseRevision),
    ...input.correctionRequests.map((request) => request.exceptionCaseRevision),
  ]
  if (revisions.some((revision) => revision !== null
    && (!Number.isInteger(revision) || revision < 0 || revision > currentRevision))) {
    return "INTEGRITY_REVIEW"
  }
  const resetRevision = input.priorDecisions.reduce<number>((latest, decision) => (
    ["REQUEST_EMPLOYEE_RESPONSE", "REQUEST_TIME_CORRECTION", "REOPEN_FOR_REVIEW"].includes(decision.decisionCode)
      && decision.caseRevision > latest
      ? decision.caseRevision
      : latest
  ), 0)
  // A signal written after revision N records N. Legacy NULL signals are
  // deliberately ignored: timestamp inference would reintroduce transaction-
  // start/client-clock ordering into a lifecycle decision.
  return revisions.some((revision) => revision !== null && revision >= resetRevision)
    ? "RECORDED"
    : "NOT_RECORDED"
}

/**
 * Projects only whether the signed-in employee may record or has already
 * recorded a response for the current case lifecycle. This reader uses the
 * same lock-observed revision semantics as the manager workbench and fails
 * closed when the bounded decision stream cannot be proven complete.
 */
export function projectWorkforceExceptionSelfResponseState(input: {
  workdayId: string | null
  priorDecisions: readonly WorkforceExceptionDecisionFact[]
  decisionHistoryComplete: boolean
  employeeResponses: readonly WorkforceExceptionEmployeeResponseFact[]
}): WorkforceExceptionSelfResponseState {
  if (input.workdayId == null
    || !input.decisionHistoryComplete
    || input.priorDecisions.length > MAX_WORKFORCE_EXCEPTION_DECISIONS
    || !input.priorDecisions.every((decision, index) => decision.caseRevision === index + 1)) {
    return "UNAVAILABLE"
  }
  const lifecycle = evaluateWorkforceExceptionDraftLifecycle(
    input.priorDecisions.map(({ decisionCode }) => ({ decisionCode })),
  )
  if (!lifecycle.valid || lifecycle.stage === "RESOLVED") return "UNAVAILABLE"

  const visibility = currentCycleEmployeeVisibility({
    priorDecisions: input.priorDecisions,
    employeeResponses: input.employeeResponses,
    correctionRequests: [],
  })
  if (visibility === "INTEGRITY_REVIEW") return "UNAVAILABLE"
  if (visibility === "RECORDED") return "ACKNOWLEDGED"
  // A complete 64-entry history is still readable, but cannot accept a 65th
  // decision or response-linked lifecycle append through this surface.
  if (input.priorDecisions.length >= MAX_WORKFORCE_EXCEPTION_DECISIONS) return "UNAVAILABLE"
  return "NOT_ACKNOWLEDGED"
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
  employeeResponses: readonly WorkforceExceptionEmployeeResponseFact[]
  correctionRequests: readonly WorkforceExceptionCorrectionRequestFact[]
  correctionContextComplete: boolean
}): WorkforceExceptionWorkbenchContext {
  const correction = correctionState(input)
  const decisionFactsValid = input.priorDecisions.every((decision, index) => (
    decision.caseRevision === index + 1
  ))
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
    if (input.employeeResponses.length > 0 || input.correctionRequests.length > 0
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
