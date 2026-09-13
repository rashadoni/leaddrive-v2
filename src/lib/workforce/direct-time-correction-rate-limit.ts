import { NextResponse } from "next/server"
import { consumePublicRateLimitBatch, type PublicRatePolicy } from "@/lib/public-abuse-guard"
import { hashForRateLimit } from "@/lib/rate-limit"
import { workforceSensitiveResponseHeaders } from "@/lib/workforce/sensitive-response"

type WorkforceDirectTimeCorrectionRateLimit = PublicRatePolicy & {
  retryAfterSeconds: number
}

const WORKFORCE_DIRECT_TIME_CORRECTION_RATE_LIMIT: WorkforceDirectTimeCorrectionRateLimit = {
  maxRequests: 12,
  windowSeconds: 60,
  retryAfterSeconds: 60,
}

export async function requireWorkforceDirectTimeCorrectionRateLimit(input: {
  organizationId: string
  principalUserId: string
}): Promise<NextResponse | null> {
  try {
    const partition = await hashForRateLimit(
      `workforce-direct-time-correction-partition:v1:${input.organizationId}`,
    )
    const decision = await consumePublicRateLimitBatch([{
      scope: "workforce-direct-time-correction:principal",
      identifier: `${input.organizationId}:${input.principalUserId}`,
      identifierMode: "exact",
      redisHashTag: `workforce-direct-time-correction:${partition}`,
      policy: WORKFORCE_DIRECT_TIME_CORRECTION_RATE_LIMIT,
    }])
    if (decision.allowed) return null

    const retryAfterSeconds = decision.unavailable
      ? Math.max(1, decision.retryAfterSeconds)
      : Math.min(
        WORKFORCE_DIRECT_TIME_CORRECTION_RATE_LIMIT.retryAfterSeconds,
        decision.retryAfterSeconds || WORKFORCE_DIRECT_TIME_CORRECTION_RATE_LIMIT.retryAfterSeconds,
      )
    return NextResponse.json({
      error: decision.unavailable
        ? "Workforce time-correction protection is temporarily unavailable."
        : "Workforce time-correction rate limit exceeded.",
      code: decision.unavailable
        ? "WORKFORCE_DIRECT_TIME_CORRECTION_RATE_LIMIT_UNAVAILABLE"
        : "WORKFORCE_DIRECT_TIME_CORRECTION_RATE_LIMITED",
      retryAfterSeconds,
    }, {
      status: decision.unavailable ? 503 : 429,
      headers: { ...workforceSensitiveResponseHeaders, "Retry-After": String(retryAfterSeconds) },
    })
  } catch {
    return NextResponse.json({
      error: "Workforce time-correction protection is temporarily unavailable.",
      code: "WORKFORCE_DIRECT_TIME_CORRECTION_RATE_LIMIT_UNAVAILABLE",
      retryAfterSeconds: 1,
    }, {
      status: 503,
      headers: { ...workforceSensitiveResponseHeaders, "Retry-After": "1" },
    })
  }
}
