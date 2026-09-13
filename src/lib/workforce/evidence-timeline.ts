export const WORKFORCE_EVIDENCE_ACCESS_PURPOSES = [
  "ATTENDANCE_REVIEW",
  "EMPLOYEE_INQUIRY",
  "CORRECTION_REVIEW",
  "SECURITY_INVESTIGATION",
] as const

export const WORKFORCE_EVIDENCE_ACCESS_REASONS = [
  "OPEN_EXCEPTION",
  "EMPLOYEE_REQUEST",
  "APPROVAL_BLOCKER",
  "SECURITY_ALERT",
] as const

export type WorkforceEvidenceAccessPurpose = typeof WORKFORCE_EVIDENCE_ACCESS_PURPOSES[number]
export type WorkforceEvidenceAccessReason = typeof WORKFORCE_EVIDENCE_ACCESS_REASONS[number]

const CASE_REFERENCE = /^[A-Za-z0-9._:/-]{1,100}$/

export type WorkforceEvidenceAccessContext = {
  purpose: WorkforceEvidenceAccessPurpose
  reasonCode: WorkforceEvidenceAccessReason
  caseReference: string | null
}

export function parseWorkforceEvidenceAccessContext(headers: Headers): WorkforceEvidenceAccessContext | null {
  const purpose = headers.get("x-workforce-access-purpose")?.trim() ?? ""
  const reasonCode = headers.get("x-workforce-access-reason-code")?.trim() ?? ""
  const caseReference = headers.get("x-workforce-case-reference")?.trim() || null
  if (
    !WORKFORCE_EVIDENCE_ACCESS_PURPOSES.includes(purpose as WorkforceEvidenceAccessPurpose)
    || !WORKFORCE_EVIDENCE_ACCESS_REASONS.includes(reasonCode as WorkforceEvidenceAccessReason)
    || (caseReference != null && !CASE_REFERENCE.test(caseReference))
  ) return null
  return {
    purpose: purpose as WorkforceEvidenceAccessPurpose,
    reasonCode: reasonCode as WorkforceEvidenceAccessReason,
    caseReference,
  }
}

export function safeWorkforceEvidenceReasonCodes(value: unknown): string[] {
  if (!Array.isArray(value)) return ["UNAVAILABLE"]
  const reasons = value
    .filter((reason): reason is string => typeof reason === "string")
    .map((reason) => reason.trim())
    .filter((reason) => /^[A-Z][A-Z0-9_]{0,63}$/.test(reason))
    .slice(0, 20)
  return reasons.length > 0 ? reasons : ["UNAVAILABLE"]
}
