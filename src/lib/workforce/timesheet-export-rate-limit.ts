import { NextResponse } from "next/server"
import { consumePublicRateLimitBatch, type PublicRatePolicy } from "@/lib/public-abuse-guard"
import { hashForRateLimit } from "@/lib/rate-limit"
import { workforceSensitiveResponseHeaders } from "@/lib/workforce/sensitive-response"

type WorkforceTimesheetExportRateLimit = PublicRatePolicy & { retryAfterSeconds: number }

const WORKFORCE_TIMESHEET_EXPORT_RATE_LIMIT: WorkforceTimesheetExportRateLimit = {
  maxRequests: 6,
  windowSeconds: 15 * 60,
  retryAfterSeconds: 15 * 60,
}

export async function requireWorkforceTimesheetExportRateLimit(input: {
  organizationId: string
  principalUserId: string
}): Promise<NextResponse | null> {
  try {
    const partition = await hashForRateLimit(
      `workforce-timesheet-export-partition:v1:${input.organizationId}`,
    )
    const decision = await consumePublicRateLimitBatch([{
      scope: "workforce-timesheet-export:principal",
      identifier: `${input.organizationId}:${input.principalUserId}`,
      identifierMode: "exact",
      redisHashTag: `workforce-timesheet-export:${partition}`,
      policy: WORKFORCE_TIMESHEET_EXPORT_RATE_LIMIT,
    }])
    if (decision.allowed) return null

    const retryAfterSeconds = decision.unavailable
      ? Math.max(1, decision.retryAfterSeconds)
      : Math.min(
        WORKFORCE_TIMESHEET_EXPORT_RATE_LIMIT.retryAfterSeconds,
        decision.retryAfterSeconds || WORKFORCE_TIMESHEET_EXPORT_RATE_LIMIT.retryAfterSeconds,
      )
    return NextResponse.json({
      error: decision.unavailable
        ? "Workforce timesheet-export protection is temporarily unavailable."
        : "Workforce timesheet-export rate limit exceeded.",
      code: decision.unavailable
        ? "WORKFORCE_TIMESHEET_EXPORT_RATE_LIMIT_UNAVAILABLE"
        : "WORKFORCE_TIMESHEET_EXPORT_RATE_LIMITED",
      retryAfterSeconds,
    }, {
      status: decision.unavailable ? 503 : 429,
      headers: { ...workforceSensitiveResponseHeaders, "Retry-After": String(retryAfterSeconds) },
    })
  } catch {
    return NextResponse.json({
      error: "Workforce timesheet-export protection is temporarily unavailable.",
      code: "WORKFORCE_TIMESHEET_EXPORT_RATE_LIMIT_UNAVAILABLE",
      retryAfterSeconds: 1,
    }, {
      status: 503,
      headers: { ...workforceSensitiveResponseHeaders, "Retry-After": "1" },
    })
  }
}
