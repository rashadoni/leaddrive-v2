import { NextResponse } from "next/server"
import { consumePublicRateLimitBatch, type PublicRatePolicy } from "@/lib/public-abuse-guard"
import { hashForRateLimit } from "@/lib/rate-limit"
import { workforceSensitiveResponseHeaders } from "@/lib/workforce/sensitive-response"

export type WorkforceAccessGrantRateLimitOperation = "MUTATION" | "INVENTORY"

type WorkforceAccessGrantRateLimit = PublicRatePolicy & { retryAfterSeconds: number }

/**
 * Privilege-management is a rare human control-plane action. Independent
 * tenant/principal buckets prevent one compromised session from churning role
 * assignments or repeatedly enumerating the active role map. Production uses
 * the shared Redis guard and fails closed if it is unavailable; it never falls
 * back to a per-process rate map for this security boundary.
 */
const WORKFORCE_ACCESS_GRANT_RATE_LIMITS: Record<
  WorkforceAccessGrantRateLimitOperation,
  WorkforceAccessGrantRateLimit
> = {
  MUTATION: { maxRequests: 12, windowSeconds: 60, retryAfterSeconds: 60 },
  INVENTORY: { maxRequests: 30, windowSeconds: 60, retryAfterSeconds: 30 },
}

export async function requireWorkforceAccessGrantRateLimit(input: {
  operation: WorkforceAccessGrantRateLimitOperation
  organizationId: string
  principalUserId: string
}): Promise<NextResponse | null> {
  const policy = WORKFORCE_ACCESS_GRANT_RATE_LIMITS[input.operation]
  try {
    const partition = await hashForRateLimit(`workforce-access-grant-partition:v1:${input.organizationId}`)
    const decision = await consumePublicRateLimitBatch([{
      scope: `workforce-access-grant:${input.operation}:principal`,
      identifier: `${input.organizationId}:${input.principalUserId}`,
      policy,
      identifierMode: "exact",
      redisHashTag: `workforce-access-grant:${partition}`,
    }])
    if (decision.allowed) return null
    const retryAfterSeconds = decision.unavailable
      ? Math.max(1, decision.retryAfterSeconds)
      : Math.min(policy.retryAfterSeconds, decision.retryAfterSeconds || policy.retryAfterSeconds)
    return NextResponse.json({
      error: decision.unavailable
        ? "Workforce role-management protection is temporarily unavailable."
        : "Workforce role-management rate limit exceeded.",
      code: decision.unavailable
        ? "WORKFORCE_ACCESS_GRANT_RATE_LIMIT_UNAVAILABLE"
        : "WORKFORCE_ACCESS_GRANT_RATE_LIMITED",
      retryAfterSeconds,
    }, {
      status: decision.unavailable ? 503 : 429,
      headers: { ...workforceSensitiveResponseHeaders, "Retry-After": String(retryAfterSeconds) },
    })
  } catch {
    // Treat an unexpected hashing/guard failure exactly like a production
    // guard outage, never as permission to issue a high-privilege request.
    return NextResponse.json({
      error: "Workforce role-management protection is temporarily unavailable.",
      code: "WORKFORCE_ACCESS_GRANT_RATE_LIMIT_UNAVAILABLE",
      retryAfterSeconds: 1,
    }, {
      status: 503,
      headers: { ...workforceSensitiveResponseHeaders, "Retry-After": "1" },
    })
  }
}
