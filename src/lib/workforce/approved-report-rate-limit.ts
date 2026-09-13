import { NextResponse } from "next/server"
import { consumePublicRateLimitBatch, type PublicRatePolicy } from "@/lib/public-abuse-guard"
import { hashForRateLimit } from "@/lib/rate-limit"
import { workforceSensitiveResponseHeaders } from "@/lib/workforce/sensitive-response"

type WorkforceApprovedReportRateLimit = PublicRatePolicy & { retryAfterSeconds: number }

const WORKFORCE_APPROVED_REPORT_RATE_LIMIT: WorkforceApprovedReportRateLimit = {
  maxRequests: 30,
  windowSeconds: 15 * 60,
  retryAfterSeconds: 15 * 60,
}

/**
 * A distributed per-principal budget bounds repeated immutable report rebuilds
 * and employee-scope probing. Limiter unavailability fails closed.
 */
export async function requireWorkforceApprovedReportRateLimit(input: {
  organizationId: string
  principalUserId: string
}): Promise<NextResponse | null> {
  try {
    const partition = await hashForRateLimit(
      `workforce-approved-report-partition:v1:${input.organizationId}`,
    )
    const decision = await consumePublicRateLimitBatch([{
      scope: "workforce-approved-report:principal",
      identifier: `${input.organizationId}:${input.principalUserId}`,
      identifierMode: "exact",
      redisHashTag: `workforce-approved-report:${partition}`,
      policy: WORKFORCE_APPROVED_REPORT_RATE_LIMIT,
    }])
    if (decision.allowed) return null

    const retryAfterSeconds = decision.unavailable
      ? Math.max(1, decision.retryAfterSeconds)
      : Math.min(
        WORKFORCE_APPROVED_REPORT_RATE_LIMIT.retryAfterSeconds,
        decision.retryAfterSeconds || WORKFORCE_APPROVED_REPORT_RATE_LIMIT.retryAfterSeconds,
      )
    return NextResponse.json({
      error: decision.unavailable
        ? "Workforce approved-report protection is temporarily unavailable."
        : "Workforce approved-report rate limit exceeded.",
      code: decision.unavailable
        ? "WORKFORCE_APPROVED_REPORT_RATE_LIMIT_UNAVAILABLE"
        : "WORKFORCE_APPROVED_REPORT_RATE_LIMITED",
      retryAfterSeconds,
    }, {
      status: decision.unavailable ? 503 : 429,
      headers: { ...workforceSensitiveResponseHeaders, "Retry-After": String(retryAfterSeconds) },
    })
  } catch {
    return NextResponse.json({
      error: "Workforce approved-report protection is temporarily unavailable.",
      code: "WORKFORCE_APPROVED_REPORT_RATE_LIMIT_UNAVAILABLE",
      retryAfterSeconds: 1,
    }, {
      status: 503,
      headers: { ...workforceSensitiveResponseHeaders, "Retry-After": "1" },
    })
  }
}
