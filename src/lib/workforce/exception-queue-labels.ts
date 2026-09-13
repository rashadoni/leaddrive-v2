export const workforceExceptionQueueLabelValues = {
  types: [
    "LATE_START",
    "UNDERTIME",
    "OVERTIME",
    "LONG_PAUSE",
    "NO_SHOW",
    "MISSED_FINISH",
    "DELAYED_CLAIM",
    "SITE_TRANSITION_REVIEW",
    "DEVICE_SECURITY_REVIEW",
    "ATTENDANCE_PROOF_REVIEW",
  ],
  severities: ["ROUTINE_REVIEW", "ATTENTION_REVIEW"],
  stages: ["OPEN", "AWAITING_EMPLOYEE_RESPONSE", "HR_REVIEW", "RESOLVED", "DATA_INTEGRITY_REVIEW"],
  evidenceStates: ["NOT_REQUIRED", "LINKED_RESTRICTED", "MISSING_OR_UNAVAILABLE"],
  employeeResponses: ["NOT_REQUESTED", "PENDING", "RECEIVED"],
  nextActions: [
    "ACKNOWLEDGE_HR_REVIEW",
    "WAIT_FOR_EMPLOYEE_RESPONSE",
    "HUMAN_REVIEW_REQUIRED",
    "NO_FURTHER_ACTION",
    "ESCALATE_DATA_INTEGRITY_REVIEW",
  ],
} as const

export type WorkforceExceptionQueueLabelGroup = keyof typeof workforceExceptionQueueLabelValues

/**
 * Browser responses are untrusted at the presentation boundary. Keep a future
 * or malformed queue enum in local unavailable copy instead of making a
 * translation lookup throw or rendering a transport value.
 */
export function workforceExceptionQueueLabelKey(group: WorkforceExceptionQueueLabelGroup, value: string): string {
  const allowed = workforceExceptionQueueLabelValues[group] as readonly string[]
  return allowed.includes(value) ? `${group}.${value}` : `${group}.unavailable`
}
