import { createHash } from "node:crypto"

/**
 * Privacy boundary for the future C6 exception-notification delivery path.
 *
 * This is deliberately a pure planner. It neither queries a case nor writes
 * to the shared MTM notification table: the latter is a Route & Field outbox
 * and must not become an accidental HR evidence channel. A tenant-approved
 * Workforce delivery service may materialize only a `PLAN_IN_APP` result.
 */

export const WORKFORCE_EXCEPTION_NOTIFICATION_CHANNELS = ["IN_APP"] as const
export type WorkforceExceptionNotificationChannel = typeof WORKFORCE_EXCEPTION_NOTIFICATION_CHANNELS[number]

export const WORKFORCE_EXCEPTION_NOTIFICATION_KINDS = [
  "EMPLOYEE_ACTION_REQUIRED",
  "HR_REVIEW_AGING",
] as const
export type WorkforceExceptionNotificationKind = typeof WORKFORCE_EXCEPTION_NOTIFICATION_KINDS[number]

export type WorkforceExceptionNotificationAudience = "EMPLOYEE" | "HR_REVIEWER"

export type WorkforceExceptionNotificationDeliveryPreference = "ENABLED" | "DISABLED" | "UNKNOWN"
export type WorkforceExceptionNotificationPriorDelivery = "NONE" | "PENDING" | "DELIVERED" | "SUPPRESSED"

export type WorkforceExceptionNotificationDraftInput = {
  organizationId: string
  caseId: string
  recipient: {
    /** An internal agent id used only to calculate an opaque deduplication key. */
    agentId: string
    audience: WorkforceExceptionNotificationAudience
    inAppPreference: WorkforceExceptionNotificationDeliveryPreference
  }
  case: {
    /** A notification to an employee is forbidden until the case is visible. */
    employeeVisibility: "VISIBLE" | "NOT_VISIBLE"
    lifecycle: "AWAITING_EMPLOYEE" | "AWAITING_HR_REVIEW" | "CLOSED"
  }
  priorDelivery: WorkforceExceptionNotificationPriorDelivery
}

export type WorkforceExceptionNotificationPlan = {
  outcome: "PLAN_IN_APP"
  channel: WorkforceExceptionNotificationChannel
  audience: WorkforceExceptionNotificationAudience
  kind: WorkforceExceptionNotificationKind
  /** Opaque and stable. It contains no raw case id in the delivered row. */
  dedupeKey: string
  /** Safe generic copy keys; a client resolves these locally. */
  copy: {
    titleKey: "workforce.exceptionNotification.actionRequired" | "workforce.exceptionNotification.reviewRequired"
    bodyKey: "workforce.exceptionNotification.openWorkforce"
  }
  /** Safe metadata excludes case ids, reason text and attendance evidence. */
  metadata: {
    domain: "workforce"
    notificationKind: WorkforceExceptionNotificationKind
    reference: "WORKFORCE_EXCEPTION"
  }
}

export type WorkforceExceptionNotificationSuppression = {
  outcome: "SUPPRESS"
  code:
    | "WORKFORCE_EXCEPTION_NOTIFICATION_INVALID_INPUT"
    | "WORKFORCE_EXCEPTION_NOTIFICATION_PREFERENCE_DISABLED"
    | "WORKFORCE_EXCEPTION_NOTIFICATION_EMPLOYEE_NOT_VISIBLE"
    | "WORKFORCE_EXCEPTION_NOTIFICATION_LIFECYCLE_INELIGIBLE"
    | "WORKFORCE_EXCEPTION_NOTIFICATION_ALREADY_PLANNED"
}

export type WorkforceExceptionNotificationDraft =
  | WorkforceExceptionNotificationPlan
  | WorkforceExceptionNotificationSuppression

function validOpaqueId(value: unknown): value is string {
  return typeof value === "string"
    && value.trim().length > 0
    && value.length <= 191
    && !/[\u0000-\u001f]/.test(value)
}

function notificationKind(input: WorkforceExceptionNotificationDraftInput): WorkforceExceptionNotificationKind | null {
  if (input.case.lifecycle === "AWAITING_EMPLOYEE" && input.recipient.audience === "EMPLOYEE") {
    return "EMPLOYEE_ACTION_REQUIRED"
  }
  if (input.case.lifecycle === "AWAITING_HR_REVIEW" && input.recipient.audience === "HR_REVIEWER") {
    return "HR_REVIEW_AGING"
  }
  return null
}

function opaqueDedupeKey(input: WorkforceExceptionNotificationDraftInput, kind: WorkforceExceptionNotificationKind): string {
  return createHash("sha256").update(JSON.stringify({
    version: 1,
    domain: "workforce",
    organizationId: input.organizationId,
    caseId: input.caseId,
    recipientAgentId: input.recipient.agentId,
    audience: input.recipient.audience,
    kind,
  })).digest("hex")
}

/**
 * Produces a minimal private in-app notification plan or a deliberate
 * suppression. The function never accepts reason text, location, QR/device
 * proof, employee contact details or a URL, so those data classes cannot
 * accidentally cross into a notification subject/body/metadata.
 */
export function planWorkforceExceptionNotification(
  input: WorkforceExceptionNotificationDraftInput,
): WorkforceExceptionNotificationDraft {
  if (!validOpaqueId(input.organizationId) || !validOpaqueId(input.caseId) || !validOpaqueId(input.recipient.agentId)) {
    return { outcome: "SUPPRESS", code: "WORKFORCE_EXCEPTION_NOTIFICATION_INVALID_INPUT" }
  }
  if (input.recipient.inAppPreference !== "ENABLED") {
    return { outcome: "SUPPRESS", code: "WORKFORCE_EXCEPTION_NOTIFICATION_PREFERENCE_DISABLED" }
  }
  if (input.priorDelivery !== "NONE") {
    return { outcome: "SUPPRESS", code: "WORKFORCE_EXCEPTION_NOTIFICATION_ALREADY_PLANNED" }
  }
  if (input.recipient.audience === "EMPLOYEE" && input.case.employeeVisibility !== "VISIBLE") {
    return { outcome: "SUPPRESS", code: "WORKFORCE_EXCEPTION_NOTIFICATION_EMPLOYEE_NOT_VISIBLE" }
  }
  const kind = notificationKind(input)
  if (kind === null) {
    return { outcome: "SUPPRESS", code: "WORKFORCE_EXCEPTION_NOTIFICATION_LIFECYCLE_INELIGIBLE" }
  }
  return {
    outcome: "PLAN_IN_APP",
    channel: "IN_APP",
    audience: input.recipient.audience,
    kind,
    dedupeKey: opaqueDedupeKey(input, kind),
    copy: {
      titleKey: kind === "EMPLOYEE_ACTION_REQUIRED"
        ? "workforce.exceptionNotification.actionRequired"
        : "workforce.exceptionNotification.reviewRequired",
      bodyKey: "workforce.exceptionNotification.openWorkforce",
    },
    metadata: {
      domain: "workforce",
      notificationKind: kind,
      reference: "WORKFORCE_EXCEPTION",
    },
  }
}
