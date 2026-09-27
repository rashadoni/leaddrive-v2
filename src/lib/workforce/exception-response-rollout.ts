import { featureFlagsToArray } from "@/lib/modules"
import type { WorkforceExceptionWorkbenchDecision } from "@/lib/workforce/exception-workbench"

/**
 * Additive C6 employee-response records must be migrated and rehearsed before
 * a tenant can expose their acknowledgement write. The Workforce entitlement
 * alone is deliberately insufficient.
 */
export const WORKFORCE_EXCEPTION_RESPONSE_FLAG = "workforce-exception-response-v1"

export type WorkforceExceptionResponseRecording = "AVAILABLE" | "MIGRATION_REQUIRED"

export function resolveWorkforceExceptionResponseRecording(
  features: unknown,
): WorkforceExceptionResponseRecording {
  return featureFlagsToArray(features).includes(WORKFORCE_EXCEPTION_RESPONSE_FLAG)
    ? "AVAILABLE"
    : "MIGRATION_REQUIRED"
}

/**
 * The manager decision stream predates the employee-response channel. Keep
 * every unrelated decision available while failing closed only for the
 * request that depends on that tenant's migrated response channel.
 */
export function isWorkforceExceptionDecisionEnabledForResponseRollout(
  decisionCode: WorkforceExceptionWorkbenchDecision,
  features: unknown,
): boolean {
  return decisionCode !== "REQUEST_EMPLOYEE_RESPONSE"
    || resolveWorkforceExceptionResponseRecording(features) === "AVAILABLE"
}
