import { featureFlagsToArray } from "@/lib/modules"

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
