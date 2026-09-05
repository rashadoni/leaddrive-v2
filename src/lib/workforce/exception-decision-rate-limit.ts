import { NextResponse } from "next/server"
import { consumePublicRateLimitBatch, type PublicRatePolicy } from "@/lib/public-abuse-guard"
import { hashForRateLimit } from "@/lib/rate-limit"
import { workforceSensitiveResponseHeaders } from "@/lib/workforce/sensitive-response"

type WorkforceExceptionDecisionRateLimit = PublicRatePolicy & {
  retryAfterSeconds: number
}

// A human exception decision changes the review lifecycle for an employee's
// attendance record. Keep this rare, high-integrity action behind the shared
// tenant/principal guard; a Redis outage must not become permission to append
// an unbounded decision or audit stream from one compromised session.
const WORKFORCE_EXCEPTION_DECISION_RATE_LIMIT: WorkforceExceptionDecisionRateLimit = {
  maxRequests: 12,
  windowSeconds: 60,
  retryAfterSeconds: 60,
}

export async function requireWorkforceExceptionDecisionRateLimit(input: {
  organizationId: string
  principalUserId: string
}): Promise<NextResponse | null> {
  try {
    const partition = await hashForRateLimit(
      `workforce-exception-decision-partition:v1:${input.organizationId}`,
    )
    const decision = await consumePublicRateLimitBatch([{
      scope: "workforce-exception-decision:principal",
      identifier: `${input.organizationId}:${input.principalUserId}`,
      identifierMode: "exact",
      redisHashTag: `workforce-exception-decision:${partition}`,
      policy: WORKFORCE_EXCEPTION_DECISION_RATE_LIMIT,
    }])
    if (decision.allowed) return null

    const retryAfterSeconds = decision.unavailable
      ? Math.max(1, decision.retryAfterSeconds)
      : Math.min(
        WORKFORCE_EXCEPTION_DECISION_RATE_LIMIT.retryAfterSeconds,
        decision.retryAfterSeconds || WORKFORCE_EXCEPTION_DECISION_RATE_LIMIT.retryAfterSeconds,
      )
    return NextResponse.json({
      error: decision.unavailable
        ? "Workforce exception-decision protection is temporarily unavailable."
        : "Workforce exception-decision rate limit exceeded.",
      code: decision.unavailable
        ? "WORKFORCE_EXCEPTION_DECISION_RATE_LIMIT_UNAVAILABLE"
        : "WORKFORCE_EXCEPTION_DECISION_RATE_LIMITED",
      retryAfterSeconds,
    }, {
      status: decision.unavailable ? 503 : 429,
      headers: { ...workforceSensitiveResponseHeaders, "Retry-After": String(retryAfterSeconds) },
    })
  } catch {
    return NextResponse.json({
      error: "Workforce exception-decision protection is temporarily unavailable.",
      code: "WORKFORCE_EXCEPTION_DECISION_RATE_LIMIT_UNAVAILABLE",
      retryAfterSeconds: 1,
    }, {
      status: 503,
      headers: { ...workforceSensitiveResponseHeaders, "Retry-After": "1" },
    })
  }
}
