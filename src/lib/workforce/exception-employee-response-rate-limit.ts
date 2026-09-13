import { NextResponse } from "next/server"
import { consumePublicRateLimitBatch, type PublicRatePolicy } from "@/lib/public-abuse-guard"
import { hashForRateLimit } from "@/lib/rate-limit"
import { workforceSensitiveResponseHeaders } from "@/lib/workforce/sensitive-response"

type WorkforceExceptionEmployeeResponseRateLimit = PublicRatePolicy & {
  retryAfterSeconds: number
}

// An employee response never decides a case, but it does append a durable
// self-owned lifecycle/audit record. A shared tenant/principal fence prevents
// a compromised session from turning acknowledgement into write churn while
// keeping normal one-at-a-time employee recovery available.
const WORKFORCE_EXCEPTION_EMPLOYEE_RESPONSE_RATE_LIMIT: WorkforceExceptionEmployeeResponseRateLimit = {
  maxRequests: 12,
  windowSeconds: 60,
  retryAfterSeconds: 60,
}

export async function requireWorkforceExceptionEmployeeResponseRateLimit(input: {
  organizationId: string
  principalUserId: string
}): Promise<NextResponse | null> {
  try {
    const partition = await hashForRateLimit(
      `workforce-exception-employee-response-partition:v1:${input.organizationId}`,
    )
    const decision = await consumePublicRateLimitBatch([{
      scope: "workforce-exception-employee-response:principal",
      identifier: `${input.organizationId}:${input.principalUserId}`,
      identifierMode: "exact",
      redisHashTag: `workforce-exception-employee-response:${partition}`,
      policy: WORKFORCE_EXCEPTION_EMPLOYEE_RESPONSE_RATE_LIMIT,
    }])
    if (decision.allowed) return null

    const retryAfterSeconds = decision.unavailable
      ? Math.max(1, decision.retryAfterSeconds)
      : Math.min(
        WORKFORCE_EXCEPTION_EMPLOYEE_RESPONSE_RATE_LIMIT.retryAfterSeconds,
        decision.retryAfterSeconds || WORKFORCE_EXCEPTION_EMPLOYEE_RESPONSE_RATE_LIMIT.retryAfterSeconds,
      )
    return NextResponse.json({
      error: decision.unavailable
        ? "Workforce employee-response protection is temporarily unavailable."
        : "Workforce employee-response rate limit exceeded.",
      code: decision.unavailable
        ? "WORKFORCE_EXCEPTION_EMPLOYEE_RESPONSE_RATE_LIMIT_UNAVAILABLE"
        : "WORKFORCE_EXCEPTION_EMPLOYEE_RESPONSE_RATE_LIMITED",
      retryAfterSeconds,
    }, {
      status: decision.unavailable ? 503 : 429,
      headers: { ...workforceSensitiveResponseHeaders, "Retry-After": String(retryAfterSeconds) },
    })
  } catch {
    return NextResponse.json({
      error: "Workforce employee-response protection is temporarily unavailable.",
      code: "WORKFORCE_EXCEPTION_EMPLOYEE_RESPONSE_RATE_LIMIT_UNAVAILABLE",
      retryAfterSeconds: 1,
    }, {
      status: 503,
      headers: { ...workforceSensitiveResponseHeaders, "Retry-After": "1" },
    })
  }
}
