import {
  evaluateWorkforceExceptionDraftLifecycle,
  WORKFORCE_RECOMMENDED_EXCEPTION_DRAFT_POLICY_V1,
  type WorkforceExceptionDraftClassification,
  type WorkforceExceptionDraftStage,
  type WorkforceExceptionDraftTriageSeverity,
} from "@/lib/workforce/exception-policy-draft"

/**
 * Raw-proof-free view model for a future C6/C8 exception queue. This is not a
 * database reader or a case workflow: callers must first apply tenant scope
 * and authorization, and must never attach raw location, QR or device proof.
 */

export type WorkforceExceptionQueueEmployeeResponse =
  | "NOT_REQUESTED"
  | "PENDING"
  | "RECEIVED"

export type WorkforceExceptionQueueEvidenceState =
  | "NOT_REQUIRED"
  | "LINKED_RESTRICTED"
  | "MISSING_OR_UNAVAILABLE"

export type WorkforceExceptionQueueItem = {
  displayReference: string
  employeeDisplayName: string
  type: WorkforceExceptionDraftClassification["type"]
  triageSeverity: WorkforceExceptionDraftTriageSeverity
  ageSeconds: number
  stage: WorkforceExceptionDraftStage | "DATA_INTEGRITY_REVIEW"
  evidenceState: WorkforceExceptionQueueEvidenceState
  employeeResponse: WorkforceExceptionQueueEmployeeResponse
  nextAction:
    | "ACKNOWLEDGE_HR_REVIEW"
    | "WAIT_FOR_EMPLOYEE_RESPONSE"
    | "HUMAN_REVIEW_REQUIRED"
    | "NO_FURTHER_ACTION"
    | "ESCALATE_DATA_INTEGRITY_REVIEW"
}

export class WorkforceExceptionQueueError extends Error {
  constructor(readonly code: "WORKFORCE_EXCEPTION_QUEUE_INPUT_INVALID") {
    super(code)
  }
}

const CLASSIFICATION_BY_TYPE = new Map<string, WorkforceExceptionDraftClassification>(
  WORKFORCE_RECOMMENDED_EXCEPTION_DRAFT_POLICY_V1.classifications.map((classification) => [classification.type, classification]),
)

function displayText(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.length > 160 || /[\u0000-\u001f]/.test(value)) {
    throw new WorkforceExceptionQueueError("WORKFORCE_EXCEPTION_QUEUE_INPUT_INVALID")
  }
  return value
}

function canonicalInstant(value: unknown): Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new WorkforceExceptionQueueError("WORKFORCE_EXCEPTION_QUEUE_INPUT_INVALID")
  }
  return value
}

function canonicalEvidenceState(value: unknown): WorkforceExceptionQueueEvidenceState {
  if (value === "NOT_REQUIRED" || value === "LINKED_RESTRICTED" || value === "MISSING_OR_UNAVAILABLE") return value
  throw new WorkforceExceptionQueueError("WORKFORCE_EXCEPTION_QUEUE_INPUT_INVALID")
}

function canonicalEmployeeResponse(value: unknown): WorkforceExceptionQueueEmployeeResponse {
  if (value === "NOT_REQUESTED" || value === "PENDING" || value === "RECEIVED") return value
  throw new WorkforceExceptionQueueError("WORKFORCE_EXCEPTION_QUEUE_INPUT_INVALID")
}

/**
 * Derives only a lifecycle signal for the HR queue. The response itself,
 * correction link and employee explanation remain outside this projection.
 */
export function workforceExceptionQueueEmployeeResponseState(input: {
  decisionCodes: readonly string[]
  recordedResponseCount: number
}): WorkforceExceptionQueueEmployeeResponse {
  if (!Number.isInteger(input.recordedResponseCount) || input.recordedResponseCount < 0) {
    throw new WorkforceExceptionQueueError("WORKFORCE_EXCEPTION_QUEUE_INPUT_INVALID")
  }
  if (input.recordedResponseCount > 0) return "RECEIVED"
  const lifecycle = evaluateWorkforceExceptionDraftLifecycle(
    input.decisionCodes.map((decisionCode) => ({ decisionCode })),
  )
  return lifecycle.valid && lifecycle.stage === "AWAITING_EMPLOYEE_RESPONSE"
    ? "PENDING"
    : "NOT_REQUESTED"
}

function nextAction(input: {
  stage: WorkforceExceptionDraftStage
  employeeResponse: WorkforceExceptionQueueEmployeeResponse
}): WorkforceExceptionQueueItem["nextAction"] {
  switch (input.stage) {
    case "OPEN": return "ACKNOWLEDGE_HR_REVIEW"
    case "AWAITING_EMPLOYEE_RESPONSE": return input.employeeResponse === "RECEIVED"
      ? "ACKNOWLEDGE_HR_REVIEW"
      : "WAIT_FOR_EMPLOYEE_RESPONSE"
    case "HR_REVIEW": return "HUMAN_REVIEW_REQUIRED"
    case "RESOLVED": return "NO_FURTHER_ACTION"
  }
  throw new WorkforceExceptionQueueError("WORKFORCE_EXCEPTION_QUEUE_INPUT_INVALID")
}

export function projectWorkforceExceptionQueueItem(input: {
  displayReference: unknown
  employeeDisplayName: unknown
  type: unknown
  createdAt: unknown
  decisionCodes: readonly string[]
  evidenceState: unknown
  employeeResponse: unknown
  now?: Date
}): WorkforceExceptionQueueItem {
  const classification = typeof input.type === "string" ? CLASSIFICATION_BY_TYPE.get(input.type) : undefined
  if (!classification || !Array.isArray(input.decisionCodes)) {
    throw new WorkforceExceptionQueueError("WORKFORCE_EXCEPTION_QUEUE_INPUT_INVALID")
  }
  const createdAt = canonicalInstant(input.createdAt)
  const now = canonicalInstant(input.now ?? new Date())
  if (now < createdAt) throw new WorkforceExceptionQueueError("WORKFORCE_EXCEPTION_QUEUE_INPUT_INVALID")
  const evidenceState = canonicalEvidenceState(input.evidenceState)
  const employeeResponse = canonicalEmployeeResponse(input.employeeResponse)
  const lifecycle = evaluateWorkforceExceptionDraftLifecycle(input.decisionCodes.map((decisionCode) => ({ decisionCode })))
  if (!lifecycle.valid) {
    return {
      displayReference: displayText(input.displayReference),
      employeeDisplayName: displayText(input.employeeDisplayName),
      type: classification.type,
      triageSeverity: classification.triageSeverity,
      ageSeconds: Math.floor((now.getTime() - createdAt.getTime()) / 1000),
      stage: "DATA_INTEGRITY_REVIEW",
      evidenceState,
      employeeResponse,
      nextAction: "ESCALATE_DATA_INTEGRITY_REVIEW",
    }
  }
  return {
    displayReference: displayText(input.displayReference),
    employeeDisplayName: displayText(input.employeeDisplayName),
    type: classification.type,
    triageSeverity: classification.triageSeverity,
    ageSeconds: Math.floor((now.getTime() - createdAt.getTime()) / 1000),
    stage: lifecycle.stage,
    evidenceState,
    employeeResponse,
    nextAction: nextAction({ stage: lifecycle.stage, employeeResponse }),
  }
}
