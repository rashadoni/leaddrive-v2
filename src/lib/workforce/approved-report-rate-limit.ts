import { NextResponse } from "next/server"
import { consumePublicRateLimitBatch, type PublicRatePolicy } from "@/lib/public-abuse-guard"
import { hashForRateLimit } from "@/lib/rate-limit"
import { workforceSensitiveResponseHeaders } from "@/lib/workforce/sensitive-response"

type WorkforceApprovedReportRateLimit = PublicRatePolicy & { retryAfterSeconds: number }
type WorkforceReportKind = "approved" | "exception" | "siteTransition" | "evidenceTimeline"

const WORKFORCE_APPROVED_REPORT_RATE_LIMIT: WorkforceApprovedReportRateLimit = {
  maxRequests: 30,
  windowSeconds: 15 * 60,
  retryAfterSeconds: 15 * 60,
}

/**
 * A distributed per-principal budget bounds repeated immutable report rebuilds
 * and employee-scope probing. Limiter unavailability fails closed.
 */
async function requireWorkforceReportRateLimit(input: {
  organizationId: string
  principalUserId: string
  reportKind: WorkforceReportKind
}): Promise<NextResponse | null> {
  const labels: Record<WorkforceReportKind, { key: string; code: string }> = {
    approved: { key: "approved-report", code: "APPROVED_REPORT" },
    exception: { key: "exception-report", code: "EXCEPTION_REPORT" },
    siteTransition: { key: "site-transition-report", code: "SITE_TRANSITION_REPORT" },
    evidenceTimeline: { key: "evidence-timeline", code: "EVIDENCE_TIMELINE" },
  }
  const { key: label, code: codeLabel } = labels[input.reportKind]
  try {
    const partition = await hashForRateLimit(
      `workforce-${label}-partition:v1:${input.organizationId}`,
    )
    const decision = await consumePublicRateLimitBatch([{
      scope: `workforce-${label}:principal`,
      identifier: `${input.organizationId}:${input.principalUserId}`,
      identifierMode: "exact",
      redisHashTag: `workforce-${label}:${partition}`,
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
        ? "Workforce report protection is temporarily unavailable."
        : "Workforce report rate limit exceeded.",
      code: decision.unavailable
        ? `WORKFORCE_${codeLabel}_RATE_LIMIT_UNAVAILABLE`
        : `WORKFORCE_${codeLabel}_RATE_LIMITED`,
      retryAfterSeconds,
    }, {
      status: decision.unavailable ? 503 : 429,
      headers: { ...workforceSensitiveResponseHeaders, "Retry-After": String(retryAfterSeconds) },
    })
  } catch {
    return NextResponse.json({
      error: "Workforce report protection is temporarily unavailable.",
      code: `WORKFORCE_${codeLabel}_RATE_LIMIT_UNAVAILABLE`,
      retryAfterSeconds: 1,
    }, {
      status: 503,
      headers: { ...workforceSensitiveResponseHeaders, "Retry-After": "1" },
    })
  }
}

export function requireWorkforceApprovedReportRateLimit(input: {
  organizationId: string
  principalUserId: string
}): Promise<NextResponse | null> {
  return requireWorkforceReportRateLimit({ ...input, reportKind: "approved" })
}

export function requireWorkforceExceptionReportRateLimit(input: {
  organizationId: string
  principalUserId: string
}): Promise<NextResponse | null> {
  return requireWorkforceReportRateLimit({ ...input, reportKind: "exception" })
}

export function requireWorkforceSiteTransitionReportRateLimit(input: {
  organizationId: string
  principalUserId: string
}): Promise<NextResponse | null> {
  return requireWorkforceReportRateLimit({ ...input, reportKind: "siteTransition" })
}

export function requireWorkforceEvidenceTimelineRateLimit(input: {
  organizationId: string
  principalUserId: string
}): Promise<NextResponse | null> {
  return requireWorkforceReportRateLimit({ ...input, reportKind: "evidenceTimeline" })
}
