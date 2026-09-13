import { NextRequest, NextResponse } from "next/server"
import { addDateKeyDays, currentDateKey, isDateKey, localDateKeyToUtc } from "@/lib/mtm/mobile-week"
import { getMtmSettings } from "@/lib/mtm-settings"
import { prisma } from "@/lib/prisma"
import { clientIp } from "@/lib/request-ip"
import { isValidTimezone } from "@/lib/timezone"
import { withWorkforceSessionAuth } from "@/lib/with-workforce-rls-auth"
import { isAgentInWorkforceScope, resolveWorkforceActor } from "@/lib/workforce/actor"
import { requireWorkforceSiteTransitionReportRateLimit } from "@/lib/workforce/approved-report-rate-limit"
import { logWorkforceSensitiveOperationFailure } from "@/lib/workforce/sensitive-operation-log"
import { workforceSensitiveResponseHeaders } from "@/lib/workforce/sensitive-response"
import { requireWorkforceSiteTransitionReportAccess } from "@/lib/workforce/site-transition-report-access"
import {
  buildWorkforceSiteTransitionReport,
  WorkforceSiteTransitionReportError,
} from "@/lib/workforce/site-transition-report"

const MAX_RANGE_DAYS = 93
const MAX_TRANSITIONS = 5_000
const ID = /^[A-Za-z0-9_-]{1,100}$/

function reportJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: workforceSensitiveResponseHeaders })
}

function auditContext(req: NextRequest) {
  const ipAddress = clientIp(req)
  return {
    ipAddress: ipAddress === "unknown" ? null : ipAddress,
    userAgent: req.headers.get("user-agent")?.slice(0, 500) ?? null,
  }
}

function displayName(value: string | null | undefined, fallback: string): string {
  const name = value?.trim().replace(/[\u0000-\u001f]/g, " ").slice(0, 500)
  return name || fallback
}

/**
 * Aggregate-only report over scheduled site-transition claims. It never reads
 * raw evidence or presents an arrival/departure pair as physical presence.
 */
export const GET = withWorkforceSessionAuth("read", async (req: NextRequest, auth) => {
  try {
    const rateLimited = await requireWorkforceSiteTransitionReportRateLimit({
      organizationId: auth.orgId,
      principalUserId: auth.userId,
    })
    if (rateLimited) return rateLimited

    const actor = await resolveWorkforceActor(prisma, {
      organizationId: auth.orgId,
      userId: auth.userId,
      webRole: auth.role,
    })
    if (!actor) return reportJson({ error: "Forbidden", code: "WORKFORCE_SCOPE_DENIED" }, 403)

    const settings = await getMtmSettings(auth.orgId)
    const timezone = isValidTimezone(settings.timezone) ? settings.timezone : "UTC"
    const today = currentDateKey(new Date(), timezone)
    const { searchParams } = new URL(req.url)
    const start = searchParams.get("start") ?? addDateKeyDays(today, -13)
    const end = searchParams.get("end") ?? today
    const selectedAgentId = searchParams.get("agentId") || null
    const selectedSiteId = searchParams.get("siteId") || null
    if (!isDateKey(start) || !isDateKey(end) || end < start || end > addDateKeyDays(start, MAX_RANGE_DAYS - 1)) {
      return reportJson({
        error: "start/end must be YYYY-MM-DD and cover at most 93 days",
        code: "WORKFORCE_SITE_TRANSITION_REPORT_RANGE_INVALID",
      }, 400)
    }
    if (
      (selectedAgentId != null && !ID.test(selectedAgentId))
      || (selectedSiteId != null && !ID.test(selectedSiteId))
      || (selectedAgentId != null && selectedSiteId != null)
      || (selectedAgentId != null && !isAgentInWorkforceScope(actor, selectedAgentId))
    ) {
      return reportJson({ error: "Forbidden", code: "WORKFORCE_SCOPE_DENIED" }, 403)
    }
    const accessDenied = await requireWorkforceSiteTransitionReportAccess({
      organizationId: auth.orgId,
      auth,
      selectedAgentId,
      selectedSiteId,
    })
    if (accessDenied) return accessDenied

    const actorAgentWhere = selectedAgentId
      ? { agentId: selectedAgentId }
      : actor.scopedAgentIds === null ? {} : { agentId: { in: [...actor.scopedAgentIds] } }
    const transitions = await prisma.workforceSiteTransition.findMany({
      where: {
        organizationId: auth.orgId,
        ...actorAgentWhere,
        claimedAt: {
          gte: localDateKeyToUtc(start, timezone),
          lt: localDateKeyToUtc(addDateKeyDays(end, 1), timezone),
        },
        ...(selectedSiteId ? { segment: { siteId: selectedSiteId } } : {}),
      },
      orderBy: [{ claimedAt: "asc" }, { id: "asc" }],
      take: MAX_TRANSITIONS + 1,
      select: {
        agentId: true,
        workdayId: true,
        segmentId: true,
        kind: true,
        claimedAt: true,
        attendanceReviewState: true,
        segment: { select: { siteId: true } },
      },
    })
    if (transitions.length > MAX_TRANSITIONS) {
      return reportJson({
        error: "Too many transition claims for one report; narrow the date or employee/site scope",
        code: "WORKFORCE_SITE_TRANSITION_REPORT_LIMIT_EXCEEDED",
      }, 413)
    }
    const report = buildWorkforceSiteTransitionReport(transitions.map((transition) => ({
      agentId: transition.agentId,
      workdayId: transition.workdayId,
      segmentId: transition.segmentId,
      siteId: transition.segment.siteId ?? "",
      kind: transition.kind,
      claimedAt: transition.claimedAt,
      attendanceReviewState: transition.attendanceReviewState,
    })))
    const [sites, employees] = await Promise.all([
      report.bySite.length === 0 ? [] : prisma.workforceSite.findMany({
        where: { organizationId: auth.orgId, id: { in: report.bySite.map((site) => site.siteId) } },
        select: { id: true, name: true },
      }),
      report.byEmployee.length === 0 ? [] : prisma.mtmAgent.findMany({
        where: { organizationId: auth.orgId, id: { in: report.byEmployee.map((employee) => employee.agentId) } },
        select: { id: true, name: true },
      }),
    ])
    const siteNames = new Map(sites.map((site) => [site.id, displayName(site.name, "Unavailable site")]))
    const employeeNames = new Map(employees.map((employee) => [employee.id, displayName(employee.name, "Unavailable employee")]))
    const audit = auditContext(req)
    await prisma.mtmAuditLog.create({
      data: {
        organizationId: auth.orgId,
        action: "WORKFORCE_SITE_TRANSITION_REPORT_VIEWED",
        entity: "workforce_site_transition_report",
        entityId: `${start}:${end}:${selectedAgentId || selectedSiteId ? "filtered" : "scope"}`,
        metadataKind: "workforce_site_transition_report",
        newData: {
          start,
          end,
          filterKind: selectedAgentId ? "AGENT" : selectedSiteId ? "SITE" : "SCOPE",
          claims: report.summary.claims,
          employees: report.summary.employees,
          sites: report.summary.sites,
          completedSegments: report.summary.completedSegments,
          incompleteSegments: report.summary.incompleteSegments,
          pendingReviewClaims: report.summary.pendingReviewClaims,
          // No employee/site IDs, names, coordinates, proof or reasons.
        },
        ipAddress: audit.ipAddress,
        userAgent: audit.userAgent,
      },
    })
    return reportJson({
      success: true,
      data: {
        timezone,
        start,
        end,
        dateBasis: "CLAIMED_AT",
        report: {
          ...report,
          bySite: report.bySite.map((site) => ({
            ...site,
            name: siteNames.get(site.siteId) ?? "Unavailable site",
          })),
          byEmployee: report.byEmployee.map((employee) => ({
            ...employee,
            name: employeeNames.get(employee.agentId) ?? "Unavailable employee",
          })),
        },
      },
    })
  } catch (error) {
    if (error instanceof WorkforceSiteTransitionReportError) {
      return reportJson({
        error: "A site-transition claim cannot be safely aggregated",
        code: error.code,
      }, 409)
    }
    logWorkforceSensitiveOperationFailure({ operation: "read-site-transition-report" })
    return reportJson({
      error: "Workforce site-transition reporting is unavailable",
      code: "WORKFORCE_SITE_TRANSITION_REPORT_UNAVAILABLE",
    }, 503)
  }
})
