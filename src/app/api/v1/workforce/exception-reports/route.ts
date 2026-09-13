import { NextRequest, NextResponse } from "next/server"
import { addDateKeyDays, currentDateKey, isDateKey, localDateKeyToUtc } from "@/lib/mtm/mobile-week"
import { getMtmSettings } from "@/lib/mtm-settings"
import { prisma } from "@/lib/prisma"
import { clientIp } from "@/lib/request-ip"
import { isValidTimezone } from "@/lib/timezone"
import { withWorkforceSessionExceptionQueueAuth } from "@/lib/with-workforce-rls-auth"
import {
  buildWorkforceExceptionCaseReport,
  WorkforceExceptionCaseReportError,
} from "@/lib/workforce/exception-case-report"
import { logWorkforceSensitiveOperationFailure } from "@/lib/workforce/sensitive-operation-log"
import { workforceSensitiveResponseHeaders } from "@/lib/workforce/sensitive-response"

const MAX_RANGE_DAYS = 93
const MAX_EXCEPTION_CASES = 5_000
const MAX_DECISIONS_PER_CASE = 64

function exceptionReportJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: workforceSensitiveResponseHeaders })
}

function badRange() {
  return exceptionReportJson({
    error: "start/end must be YYYY-MM-DD and cover at most 93 days",
    code: "WORKFORCE_EXCEPTION_REPORT_RANGE_INVALID",
  }, 400)
}

function auditContext(req: NextRequest) {
  const ipAddress = clientIp(req)
  return {
    ipAddress: ipAddress === "unknown" ? null : ipAddress,
    userAgent: req.headers.get("user-agent")?.slice(0, 500) ?? null,
  }
}

/**
 * Aggregate-only C11 report over persisted C6 exception cases. This does not
 * reuse approved-timesheet report access: tenant-wide exception categories
 * require their own explicit exception-queue grant boundary.
 */
export const GET = withWorkforceSessionExceptionQueueAuth(async (req: NextRequest, auth) => {
  try {
    const settings = await getMtmSettings(auth.orgId)
    const timezone = isValidTimezone(settings.timezone) ? settings.timezone : "UTC"
    const today = currentDateKey(new Date(), timezone)
    const { searchParams } = new URL(req.url)
    const start = searchParams.get("start") ?? addDateKeyDays(today, -13)
    const end = searchParams.get("end") ?? today
    if (!isDateKey(start) || !isDateKey(end) || end < start || end > addDateKeyDays(start, MAX_RANGE_DAYS - 1)) {
      return badRange()
    }

    const cases = await prisma.workforceExceptionCase.findMany({
      where: {
        organizationId: auth.orgId,
        createdAt: {
          gte: localDateKeyToUtc(start, timezone),
          lt: localDateKeyToUtc(addDateKeyDays(end, 1), timezone),
        },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: MAX_EXCEPTION_CASES + 1,
      select: {
        // The report handles only aggregate counts. Do not select IDs,
        // workday/site/evidence links, names, decision reasons or response
        // content/links, even though the privileged queue can show a row.
        agentId: true,
        kind: true,
        decisions: {
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          // Any case at the sentinel length is retained for integrity review;
          // never derive a terminal state from a truncated decision ledger.
          take: MAX_DECISIONS_PER_CASE + 1,
          select: { decisionCode: true },
        },
        employeeResponses: { take: 1, select: { id: true } },
      },
    })
    if (cases.length > MAX_EXCEPTION_CASES) {
      return exceptionReportJson({
        error: "Too many exception cases for one report; narrow the date range",
        code: "WORKFORCE_EXCEPTION_REPORT_LIMIT_EXCEEDED",
      }, 413)
    }

    const report = buildWorkforceExceptionCaseReport({
      cases: cases.map((item) => ({
        agentId: item.agentId,
        kind: item.kind,
        decisionCodes: item.decisions.slice(0, MAX_DECISIONS_PER_CASE).map((decision) => decision.decisionCode),
        decisionHistoryTruncated: item.decisions.length >= MAX_DECISIONS_PER_CASE + 1,
        recordedEmployeeResponseCount: item.employeeResponses.length,
      })),
    })
    const audit = auditContext(req)
    await prisma.mtmAuditLog.create({
      data: {
        organizationId: auth.orgId,
        action: "WORKFORCE_EXCEPTION_REPORT_VIEWED",
        entity: "workforce_exception_report",
        entityId: `${start}:${end}`,
        metadataKind: "workforce_exception_report",
        newData: {
          start,
          end,
          caseCount: report.summary.cases,
          employeeCount: report.summary.employees,
          openCount: report.summary.open,
          awaitingEmployeeResponseCount: report.summary.awaitingEmployeeResponse,
          hrReviewCount: report.summary.hrReview,
          resolvedCount: report.summary.resolved,
          dataIntegrityReviewCount: report.summary.dataIntegrityReview,
          // No employee/case IDs, names, proofs, reasons or timestamps.
        },
        ipAddress: audit.ipAddress,
        userAgent: audit.userAgent,
      },
    })
    return exceptionReportJson({
      success: true,
      data: {
        timezone,
        start,
        end,
        dateBasis: "CASE_RECORDED_AT",
        report,
      },
    })
  } catch (error) {
    if (error instanceof WorkforceExceptionCaseReportError) {
      return exceptionReportJson({
        error: "An exception case cannot be safely aggregated for reporting",
        code: error.code,
      }, 409)
    }
    // An older database may not have the C6 tables. A missing aggregate is
    // unavailable, never indistinguishable from an empty review period.
    logWorkforceSensitiveOperationFailure({ operation: "read-exception-case-report" })
    return exceptionReportJson({
      error: "Workforce exception reporting is unavailable",
      code: "WORKFORCE_EXCEPTION_REPORT_UNAVAILABLE",
    }, 503)
  }
})
