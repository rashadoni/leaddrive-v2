import { NextRequest, NextResponse } from "next/server"
import { addDateKeyDays, currentDateKey, isDateKey, localDateKeyToUtc } from "@/lib/mtm/mobile-week"
import { getMtmSettings } from "@/lib/mtm-settings"
import { prisma } from "@/lib/prisma"
import { clientIp } from "@/lib/request-ip"
import { isValidTimezone } from "@/lib/timezone"
import { withWorkforceSessionAuth } from "@/lib/with-workforce-rls-auth"
import { requireWorkforceEvidenceTimelineRateLimit } from "@/lib/workforce/approved-report-rate-limit"
import { requireWorkforceEvidenceTimelineAccess } from "@/lib/workforce/evidence-timeline-access"
import {
  parseWorkforceEvidenceAccessContext,
  safeWorkforceEvidenceReasonCodes,
} from "@/lib/workforce/evidence-timeline"
import { logWorkforceSensitiveOperationFailure } from "@/lib/workforce/sensitive-operation-log"
import { workforceSensitiveResponseHeaders } from "@/lib/workforce/sensitive-response"

const MAX_RANGE_DAYS = 31
const MAX_EVIDENCE_ROWS = 500
const ID = /^[A-Za-z0-9_-]{1,100}$/

function sensitiveJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: workforceSensitiveResponseHeaders })
}

function auditContext(req: NextRequest) {
  const ipAddress = clientIp(req)
  return {
    ipAddress: ipAddress === "unknown" ? null : ipAddress,
    userAgent: req.headers.get("user-agent")?.slice(0, 500) ?? null,
  }
}

/**
 * Restricted, derived-only attendance evidence. Raw coordinates, encrypted
 * envelopes, QR material, device proof and reversible distance/accuracy are
 * absent from both the Prisma projection and response. A purpose and bounded
 * reason code are mandatory and the audit write must succeed before data is
 * returned.
 */
export const GET = withWorkforceSessionAuth("read", async (req: NextRequest, auth) => {
  try {
    const rateLimited = await requireWorkforceEvidenceTimelineRateLimit({
      organizationId: auth.orgId,
      principalUserId: auth.userId,
    })
    if (rateLimited) return rateLimited

    const accessContext = parseWorkforceEvidenceAccessContext(req.headers)
    if (!accessContext) {
      return sensitiveJson({
        error: "A valid Workforce evidence purpose and reason code are required.",
        code: "WORKFORCE_EVIDENCE_ACCESS_CONTEXT_REQUIRED",
      }, 400)
    }

    const { searchParams } = new URL(req.url)
    const targetAgentId = searchParams.get("agentId")?.trim() ?? ""
    if (!ID.test(targetAgentId)) {
      return sensitiveJson({ error: "A valid employee scope is required.", code: "WORKFORCE_EVIDENCE_SCOPE_REQUIRED" }, 400)
    }
    const accessDenied = await requireWorkforceEvidenceTimelineAccess({
      organizationId: auth.orgId,
      auth,
      targetAgentId,
    })
    if (accessDenied) return accessDenied

    const settings = await getMtmSettings(auth.orgId)
    const timezone = isValidTimezone(settings.timezone) ? settings.timezone : "UTC"
    const today = currentDateKey(new Date(), timezone)
    const start = searchParams.get("start") ?? addDateKeyDays(today, -6)
    const end = searchParams.get("end") ?? today
    if (!isDateKey(start) || !isDateKey(end) || end < start || end > addDateKeyDays(start, MAX_RANGE_DAYS - 1)) {
      return sensitiveJson({
        error: "start/end must be YYYY-MM-DD and cover at most 31 days.",
        code: "WORKFORCE_EVIDENCE_RANGE_INVALID",
      }, 400)
    }
    const range = {
      gte: localDateKeyToUtc(start, timezone),
      lt: localDateKeyToUtc(addDateKeyDays(end, 1), timezone),
    }
    const employee = await prisma.mtmAgent.findFirst({
      where: { id: targetAgentId, organizationId: auth.orgId },
      select: { id: true, name: true },
    })
    if (!employee) {
      return sensitiveJson({ error: "Employee evidence scope was not found.", code: "WORKFORCE_EVIDENCE_SCOPE_NOT_FOUND" }, 404)
    }

    const evidenceRows = await prisma.workforceAttendanceEvidence.findMany({
      where: {
        organizationId: auth.orgId,
        capturedAt: range,
        OR: [
          { workdayEvent: { is: { agentId: targetAgentId } } },
          { siteTransition: { is: { agentId: targetAgentId } } },
        ],
      },
      orderBy: [{ capturedAt: "desc" }, { id: "desc" }],
      take: MAX_EVIDENCE_ROWS + 1,
      select: {
        id: true,
        source: true,
        capturedAt: true,
        rawPurgedAt: true,
        workdayEvent: {
          select: { id: true, type: true, occurredAt: true, attendanceReviewState: true },
        },
        siteTransition: {
          select: { id: true, kind: true, claimedAt: true, attendanceReviewState: true },
        },
        assessments: {
          orderBy: [{ assessedAt: "desc" }, { id: "desc" }],
          take: 20,
          select: { id: true, kind: true, assessorVersion: true, verdict: true, reasonCodes: true, assessedAt: true },
        },
      },
    })
    if (evidenceRows.length > MAX_EVIDENCE_ROWS) {
      return sensitiveJson({
        error: "Too much evidence for one timeline; narrow the date range.",
        code: "WORKFORCE_EVIDENCE_LIMIT_EXCEEDED",
      }, 413)
    }

    const audit = auditContext(req)
    await prisma.auditLog.create({
      data: {
        organizationId: auth.orgId,
        userId: auth.userId,
        action: "read",
        entityType: "workforce_evidence_timeline",
        entityId: targetAgentId,
        entityName: null,
        newValue: {
          event: "WORKFORCE_DERIVED_EVIDENCE_VIEWED",
          purpose: accessContext.purpose,
          reasonCode: accessContext.reasonCode,
          caseReference: accessContext.caseReference,
          start,
          end,
          evidenceCount: evidenceRows.length,
          projection: "DERIVED_ONLY",
        },
        ipAddress: audit.ipAddress,
        userAgent: audit.userAgent,
      },
    })

    return sensitiveJson({
      success: true,
      data: {
        timezone,
        start,
        end,
        employee,
        access: accessContext,
        boundaries: {
          projection: "DERIVED_ONLY",
          rawEvidence: "NOT_RETURNED",
          physicalPresence: "VERDICT_IS_NOT_IDENTITY_OR_PRESENCE_PROOF",
        },
        evidence: evidenceRows.map((row) => ({
          id: row.id,
          source: row.source,
          capturedAt: row.capturedAt,
          rawRetentionState: row.rawPurgedAt == null ? "WITHIN_RETENTION" : "PURGED",
          subject: row.workdayEvent
            ? {
                kind: "WORKDAY_EVENT",
                id: row.workdayEvent.id,
                action: row.workdayEvent.type,
                claimedAt: row.workdayEvent.occurredAt,
                reviewState: row.workdayEvent.attendanceReviewState,
              }
            : row.siteTransition
              ? {
                  kind: "SITE_TRANSITION",
                  id: row.siteTransition.id,
                  action: row.siteTransition.kind,
                  claimedAt: row.siteTransition.claimedAt,
                  reviewState: row.siteTransition.attendanceReviewState,
                }
              : { kind: "UNAVAILABLE", id: null, action: null, claimedAt: null, reviewState: "PENDING_REVIEW" },
          assessments: row.assessments.map((assessment) => ({
            id: assessment.id,
            kind: assessment.kind,
            assessorVersion: assessment.assessorVersion,
            verdict: assessment.verdict,
            reasonCodes: safeWorkforceEvidenceReasonCodes(assessment.reasonCodes),
            assessedAt: assessment.assessedAt,
          })),
        })),
      },
    })
  } catch {
    logWorkforceSensitiveOperationFailure({ operation: "read-evidence-timeline" })
    return sensitiveJson({
      error: "Workforce evidence timeline is unavailable.",
      code: "WORKFORCE_EVIDENCE_TIMELINE_UNAVAILABLE",
    }, 503)
  }
})
