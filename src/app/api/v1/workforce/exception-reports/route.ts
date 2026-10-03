import { Prisma } from "@prisma/client"
import { NextRequest, NextResponse } from "next/server"
import { addDateKeyDays, currentDateKey, isDateKey, localDateKeyToUtc } from "@/lib/mtm/mobile-week"
import { getMtmSettings } from "@/lib/mtm-settings"
import { prisma } from "@/lib/prisma"
import { clientIp } from "@/lib/request-ip"
import { isValidTimezone } from "@/lib/timezone"
import { withWorkforceSessionExceptionQueueAuth } from "@/lib/with-workforce-rls-auth"
import {
  WorkforceExceptionCaseReportError,
} from "@/lib/workforce/exception-case-report"
import {
  readWorkforceExceptionCaseReport,
  WorkforceExceptionCaseReportReadLimitError,
} from "@/lib/workforce/exception-case-report-read"
import { requireWorkforceExceptionReportRateLimit } from "@/lib/workforce/approved-report-rate-limit"
import { logWorkforceSensitiveOperationFailure } from "@/lib/workforce/sensitive-operation-log"
import { workforceSensitiveResponseHeaders } from "@/lib/workforce/sensitive-response"

const MAX_RANGE_DAYS = 93

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
    const rateLimited = await requireWorkforceExceptionReportRateLimit({
      organizationId: auth.orgId,
      principalUserId: auth.userId,
    })
    if (rateLimited) return rateLimited

    const settings = await getMtmSettings(auth.orgId)
    const timezone = isValidTimezone(settings.timezone) ? settings.timezone : "UTC"
    const today = currentDateKey(new Date(), timezone)
    const { searchParams } = new URL(req.url)
    const start = searchParams.get("start") ?? addDateKeyDays(today, -13)
    const end = searchParams.get("end") ?? today
    if (!isDateKey(start) || !isDateKey(end) || end < start || end > addDateKeyDays(start, MAX_RANGE_DAYS - 1)) {
      return badRange()
    }

    // The case cohort and approved-request correction proofs share one RLS-
    // scoped snapshot; a committed approval cannot appear halfway through it.
    const report = await prisma.$transaction((tx: Prisma.TransactionClient) =>
      readWorkforceExceptionCaseReport(tx, {
        organizationId: auth.orgId,
        startAt: localDateKeyToUtc(start, timezone),
        endAt: localDateKeyToUtc(addDateKeyDays(end, 1), timezone),
      }), {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      maxWait: 5_000,
      timeout: 10_000,
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
          recordedLinkedCorrectionCases: report.recordedOutcomes.linkedCorrection.recordedLinkedCorrectionCases,
          firstResolutionSampleCount: report.recordedOutcomes.firstResolution.sampleCount,
          firstResolutionIntegrityExcludedCount: report.recordedOutcomes.firstResolution.integrityExcludedCases,
          // No employee/case/request IDs, names, proofs, reasons or timestamps.
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
    if (error instanceof WorkforceExceptionCaseReportReadLimitError) {
      return exceptionReportJson({
        error: "Too many exception cases or linked corrections; narrow the date range",
        code: error.code,
      }, 413)
    }
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
