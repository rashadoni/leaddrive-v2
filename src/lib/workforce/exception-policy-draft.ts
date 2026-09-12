/**
 * Recommended v1 exception policy, deliberately stored as a pure draft.
 *
 * It does not activate a tenant, create a case, send a reminder, modify a
 * workday, decide pay or discipline an employee. A future tenant-scoped C6
 * rollout must persist an accountable approval of this draft (or a revision)
 * before it can make it operational.
 */

export const WORKFORCE_EXCEPTION_DRAFT_POLICY_VERSION = "recommended-v1" as const

export const WORKFORCE_EXCEPTION_DRAFT_TYPES = [
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
] as const

export type WorkforceExceptionDraftType = typeof WORKFORCE_EXCEPTION_DRAFT_TYPES[number]
/** A non-disciplinary triage severity; it says nothing about employee fault. */
export type WorkforceExceptionDraftTriageSeverity = "ROUTINE_REVIEW" | "ATTENTION_REVIEW"
export type WorkforceExceptionDraftStage =
  | "OPEN"
  | "AWAITING_EMPLOYEE_RESPONSE"
  | "HR_REVIEW"
  | "RESOLVED"
export type WorkforceExceptionDraftDecisionCode =
  | "ACKNOWLEDGE"
  | "REQUEST_EMPLOYEE_RESPONSE"
  | "REQUEST_TIME_CORRECTION"
  | "ESCALATE_TO_HR"
  | "RESOLVE_NO_CHANGE"
  | "RESOLVE_WITH_CORRECTION"
  | "REOPEN_FOR_REVIEW"

export type WorkforceExceptionDraftClassification = {
  type: WorkforceExceptionDraftType
  triageSeverity: WorkforceExceptionDraftTriageSeverity
  /** A target, not an automated escalation or an employee sanction. */
  proposedAcknowledgementBusinessHours: number
  proposedResolutionBusinessHours: number
}

export type WorkforceExceptionDraftPolicy = {
  version: typeof WORKFORCE_EXCEPTION_DRAFT_POLICY_VERSION
  activation: "DRAFT_ONLY_NO_TENANT_EFFECT"
  assignment: {
    primaryRole: "HR_ADMIN"
    escalationRole: "TENANT_ADMIN"
  }
  classifications: readonly WorkforceExceptionDraftClassification[]
  employeeVisibility: "REQUIRED_BEFORE_FINAL_HR_DECISION"
  automatedOutcomes: "FORBIDDEN"
  excludedOutcomes: readonly ["PAYROLL", "DISCIPLINARY", "BIOMETRIC_IDENTITY_DECISION"]
  notes: readonly [
    "Business-hour targets need an activated tenant calendar before measurement.",
    "A human decision must preserve the original attendance facts and immutable decision audit.",
  ]
}

/**
 * Owner-approved best-practice default for a later tenant activation. The
 * tier names intentionally describe review urgency rather than culpability.
 */
export const WORKFORCE_RECOMMENDED_EXCEPTION_DRAFT_POLICY_V1: WorkforceExceptionDraftPolicy = {
  version: WORKFORCE_EXCEPTION_DRAFT_POLICY_VERSION,
  activation: "DRAFT_ONLY_NO_TENANT_EFFECT",
  assignment: { primaryRole: "HR_ADMIN", escalationRole: "TENANT_ADMIN" },
  classifications: [
    { type: "LATE_START", triageSeverity: "ROUTINE_REVIEW", proposedAcknowledgementBusinessHours: 24, proposedResolutionBusinessHours: 72 },
    { type: "UNDERTIME", triageSeverity: "ATTENTION_REVIEW", proposedAcknowledgementBusinessHours: 8, proposedResolutionBusinessHours: 48 },
    { type: "OVERTIME", triageSeverity: "ROUTINE_REVIEW", proposedAcknowledgementBusinessHours: 24, proposedResolutionBusinessHours: 72 },
    { type: "LONG_PAUSE", triageSeverity: "ROUTINE_REVIEW", proposedAcknowledgementBusinessHours: 24, proposedResolutionBusinessHours: 72 },
    { type: "NO_SHOW", triageSeverity: "ATTENTION_REVIEW", proposedAcknowledgementBusinessHours: 8, proposedResolutionBusinessHours: 48 },
    { type: "MISSED_FINISH", triageSeverity: "ROUTINE_REVIEW", proposedAcknowledgementBusinessHours: 24, proposedResolutionBusinessHours: 72 },
    { type: "DELAYED_CLAIM", triageSeverity: "ROUTINE_REVIEW", proposedAcknowledgementBusinessHours: 24, proposedResolutionBusinessHours: 72 },
    { type: "SITE_TRANSITION_REVIEW", triageSeverity: "ATTENTION_REVIEW", proposedAcknowledgementBusinessHours: 8, proposedResolutionBusinessHours: 48 },
    { type: "DEVICE_SECURITY_REVIEW", triageSeverity: "ATTENTION_REVIEW", proposedAcknowledgementBusinessHours: 8, proposedResolutionBusinessHours: 48 },
    { type: "ATTENDANCE_PROOF_REVIEW", triageSeverity: "ROUTINE_REVIEW", proposedAcknowledgementBusinessHours: 24, proposedResolutionBusinessHours: 72 },
  ],
  employeeVisibility: "REQUIRED_BEFORE_FINAL_HR_DECISION",
  automatedOutcomes: "FORBIDDEN",
  excludedOutcomes: ["PAYROLL", "DISCIPLINARY", "BIOMETRIC_IDENTITY_DECISION"],
  notes: [
    "Business-hour targets need an activated tenant calendar before measurement.",
    "A human decision must preserve the original attendance facts and immutable decision audit.",
  ],
}

export type WorkforceExceptionDraftLifecycleDecision = {
  decisionCode: string
}

export type WorkforceExceptionDraftLifecycleEvaluation =
  | { valid: true; stage: WorkforceExceptionDraftStage }
  | {
      valid: false
      code:
        | "WORKFORCE_EXCEPTION_DRAFT_DECISION_UNKNOWN"
        | "WORKFORCE_EXCEPTION_DRAFT_TRANSITION_INVALID"
      stage: WorkforceExceptionDraftStage
    }

const DRAFT_DECISION_CODES = new Set<string>([
  "ACKNOWLEDGE",
  "REQUEST_EMPLOYEE_RESPONSE",
  "REQUEST_TIME_CORRECTION",
  "ESCALATE_TO_HR",
  "RESOLVE_NO_CHANGE",
  "RESOLVE_WITH_CORRECTION",
  "REOPEN_FOR_REVIEW",
])

/**
 * Evaluates only the suggested stage sequence. It intentionally does not
 * authorize an actor, persist a decision or calculate a deadline: those
 * require the future durable case/decision lifecycle and a tenant activation.
 */
export function evaluateWorkforceExceptionDraftLifecycle(
  decisions: readonly WorkforceExceptionDraftLifecycleDecision[],
): WorkforceExceptionDraftLifecycleEvaluation {
  let stage: WorkforceExceptionDraftStage = "OPEN"
  for (const { decisionCode } of decisions) {
    if (!DRAFT_DECISION_CODES.has(decisionCode)) {
      return { valid: false, code: "WORKFORCE_EXCEPTION_DRAFT_DECISION_UNKNOWN", stage }
    }
    switch (decisionCode as WorkforceExceptionDraftDecisionCode) {
      case "ACKNOWLEDGE":
      case "ESCALATE_TO_HR":
        if (stage === "RESOLVED") {
          return { valid: false, code: "WORKFORCE_EXCEPTION_DRAFT_TRANSITION_INVALID", stage }
        }
        stage = "HR_REVIEW"
        break
      case "REQUEST_EMPLOYEE_RESPONSE":
      case "REQUEST_TIME_CORRECTION":
        if (stage === "RESOLVED") {
          return { valid: false, code: "WORKFORCE_EXCEPTION_DRAFT_TRANSITION_INVALID", stage }
        }
        stage = "AWAITING_EMPLOYEE_RESPONSE"
        break
      case "RESOLVE_NO_CHANGE":
      case "RESOLVE_WITH_CORRECTION":
        if (stage !== "HR_REVIEW") {
          return { valid: false, code: "WORKFORCE_EXCEPTION_DRAFT_TRANSITION_INVALID", stage }
        }
        stage = "RESOLVED"
        break
      case "REOPEN_FOR_REVIEW":
        if (stage !== "RESOLVED") {
          return { valid: false, code: "WORKFORCE_EXCEPTION_DRAFT_TRANSITION_INVALID", stage }
        }
        stage = "HR_REVIEW"
        break
    }
  }
  return { valid: true, stage }
}

/**
 * Small append helper for a future immutable decision writer. The caller must
 * obtain the full tenant-scoped historical decision stream first; this helper
 * never reads storage or authorizes an actor.
 */
export function validateWorkforceExceptionDraftDecisionAppend(input: {
  priorDecisionCodes: readonly string[]
  nextDecisionCode: string
}): WorkforceExceptionDraftLifecycleEvaluation {
  return evaluateWorkforceExceptionDraftLifecycle([
    ...input.priorDecisionCodes.map((decisionCode) => ({ decisionCode })),
    { decisionCode: input.nextDecisionCode },
  ])
}
