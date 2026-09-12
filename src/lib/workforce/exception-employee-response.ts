/**
 * Canonical, raw-proof-free employee response envelope for an immutable C6
 * case. Referential ownership is verified by the database migration trigger;
 * this source boundary ensures callers cannot smuggle an explanation, evidence
 * reference or mutable outcome into the response ledger itself.
 */

export const WORKFORCE_EXCEPTION_EMPLOYEE_RESPONSE_CODES = [
  "ACKNOWLEDGED",
  "CORRECTION_REQUESTED",
] as const

export type WorkforceExceptionEmployeeResponseCode =
  (typeof WORKFORCE_EXCEPTION_EMPLOYEE_RESPONSE_CODES)[number]

export type WorkforceExceptionEmployeeResponseDraft = {
  organizationId: string
  caseId: string
  agentId: string
  workdayId: string
  segmentId: string | null
  correctionRequestId: string | null
  responseCode: WorkforceExceptionEmployeeResponseCode
  clientResponseId: string
  actorUserId: string
}

export class WorkforceExceptionEmployeeResponseError extends Error {
  constructor(readonly code: "WORKFORCE_EXCEPTION_EMPLOYEE_RESPONSE_INPUT_INVALID") {
    super(code)
  }
}

function requiredIdentifier(value: unknown, maxLength = 191): string {
  if (typeof value !== "string" || !value.trim() || value.length > maxLength || /[\u0000-\u001f]/.test(value)) {
    throw new WorkforceExceptionEmployeeResponseError("WORKFORCE_EXCEPTION_EMPLOYEE_RESPONSE_INPUT_INVALID")
  }
  return value
}

function optionalIdentifier(value: unknown, maxLength = 191): string | null {
  if (value == null) return null
  return requiredIdentifier(value, maxLength)
}

function responseCode(value: unknown): WorkforceExceptionEmployeeResponseCode {
  if (value === "ACKNOWLEDGED" || value === "CORRECTION_REQUESTED") return value
  throw new WorkforceExceptionEmployeeResponseError("WORKFORCE_EXCEPTION_EMPLOYEE_RESPONSE_INPUT_INVALID")
}

/**
 * Builds a storage-ready reference only. A correction request's protected
 * reason remains in the existing self-request record and is never copied here.
 */
export function createWorkforceExceptionEmployeeResponseDraft(input: {
  organizationId: unknown
  caseId: unknown
  agentId: unknown
  workdayId: unknown
  segmentId?: unknown
  correctionRequestId?: unknown
  responseCode: unknown
  clientResponseId: unknown
  actorUserId: unknown
}): WorkforceExceptionEmployeeResponseDraft {
  const code = responseCode(input.responseCode)
  const correctionRequestId = optionalIdentifier(input.correctionRequestId)
  if ((code === "ACKNOWLEDGED" && correctionRequestId !== null)
    || (code === "CORRECTION_REQUESTED" && correctionRequestId === null)) {
    throw new WorkforceExceptionEmployeeResponseError("WORKFORCE_EXCEPTION_EMPLOYEE_RESPONSE_INPUT_INVALID")
  }
  return {
    organizationId: requiredIdentifier(input.organizationId),
    caseId: requiredIdentifier(input.caseId),
    agentId: requiredIdentifier(input.agentId),
    workdayId: requiredIdentifier(input.workdayId),
    segmentId: optionalIdentifier(input.segmentId),
    correctionRequestId,
    responseCode: code,
    clientResponseId: requiredIdentifier(input.clientResponseId, 100),
    actorUserId: requiredIdentifier(input.actorUserId),
  }
}
