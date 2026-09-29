import { NextResponse } from "next/server"
import {
  consumePublicRateLimitBatch,
  type PublicRatePolicy,
} from "@/lib/public-abuse-guard"
import { hashForRateLimit } from "@/lib/rate-limit"
import { workforceSensitiveResponseHeaders } from "@/lib/workforce/sensitive-response"

const WINDOW_SECONDS = 15 * 60
const PRINCIPAL_POLICY: PublicRatePolicy = {
  maxRequests: 3,
  windowSeconds: WINDOW_SECONDS,
}
const TENANT_POLICY: PublicRatePolicy = {
  maxRequests: 12,
  windowSeconds: WINDOW_SECONDS,
}

function denied(input: {
  unavailable: boolean
  retryAfterSeconds: number
}): NextResponse {
  const retryAfterSeconds = input.unavailable
    ? Math.min(WINDOW_SECONDS, Math.max(1, input.retryAfterSeconds))
    : Math.min(WINDOW_SECONDS, input.retryAfterSeconds || WINDOW_SECONDS)
  return NextResponse.json({
    error: input.unavailable
      ? "Workforce exception-response audit protection is temporarily unavailable."
      : "Workforce exception-response audit rate limit exceeded.",
    code: input.unavailable
      ? "WORKFORCE_EXCEPTION_RESPONSE_CYCLE_AUDIT_RATE_LIMIT_UNAVAILABLE"
      : "WORKFORCE_EXCEPTION_RESPONSE_CYCLE_AUDIT_RATE_LIMITED",
    retryAfterSeconds,
  }, {
    status: input.unavailable ? 503 : 429,
    headers: {
      ...workforceSensitiveResponseHeaders,
      "Retry-After": String(retryAfterSeconds),
    },
  })
}

/**
 * The complete-ledger diagnostic is intentionally rare. Charge principal and
 * tenant buckets atomically; a Redis or hashing outage fails the scan closed.
 */
export async function requireWorkforceExceptionResponseCycleAuditRateLimit(input: {
  organizationId: string
  principalUserId: string
}): Promise<NextResponse | null> {
  try {
    const partition = await hashForRateLimit(
      `workforce-exception-response-cycle-audit-partition:v1:${input.organizationId}`,
    )
    const redisHashTag = `workforce-exception-response-cycle-audit:${partition}`
    const decision = await consumePublicRateLimitBatch([
      {
        scope: "workforce-exception-response-cycle-audit:principal",
        identifier: `${input.organizationId}:${input.principalUserId}`,
        identifierMode: "exact",
        redisHashTag,
        policy: PRINCIPAL_POLICY,
      },
      {
        scope: "workforce-exception-response-cycle-audit:tenant",
        identifier: input.organizationId,
        identifierMode: "exact",
        redisHashTag,
        policy: TENANT_POLICY,
      },
    ])
    return decision.allowed ? null : denied(decision)
  } catch {
    return denied({ unavailable: true, retryAfterSeconds: 1 })
  }
}
