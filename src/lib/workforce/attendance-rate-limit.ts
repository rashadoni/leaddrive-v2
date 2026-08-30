import { checkRateLimit, hashForRateLimit, type RateLimitConfig } from "@/lib/rate-limit"

export type WorkforceAttendanceRateLimitOperation =
  | "DEVICE_ENROLLMENT_START"
  | "DEVICE_ENROLLMENT_PROOF"
  | "QR_ISSUE"

type WorkforceAttendanceRateLimit = RateLimitConfig & { retryAfterSeconds: number }

/**
 * Small, independent buckets protect the expensive key/proof path without
 * making an office QR controller share an employee's enrollment budget. The
 * identifiers are fingerprinted before they enter the in-memory limiter; its
 * process memory and diagnostics never retain tenant, employee, user or
 * station identifiers in plaintext.
 */
const WORKFORCE_ATTENDANCE_RATE_LIMITS: Record<
  WorkforceAttendanceRateLimitOperation,
  WorkforceAttendanceRateLimit
> = {
  DEVICE_ENROLLMENT_START: { maxRequests: 3, windowMs: 60_000, retryAfterSeconds: 60 },
  DEVICE_ENROLLMENT_PROOF: { maxRequests: 5, windowMs: 60_000, retryAfterSeconds: 60 },
  QR_ISSUE: { maxRequests: 60, windowMs: 60_000, retryAfterSeconds: 60 },
}

export async function checkWorkforceAttendanceRateLimit(input: {
  operation: WorkforceAttendanceRateLimitOperation
  organizationId: string
  principalId: string
  resourceId?: string
}): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
  const policy = WORKFORCE_ATTENDANCE_RATE_LIMITS[input.operation]
  const key = await hashForRateLimit([
    "workforce-attendance-rate-limit:v1",
    input.operation,
    input.organizationId,
    input.principalId,
    input.resourceId ?? "",
  ].join(":"))
  return {
    allowed: checkRateLimit(`workforce-attendance:${input.operation}:${key}`, policy),
    retryAfterSeconds: policy.retryAfterSeconds,
  }
}
