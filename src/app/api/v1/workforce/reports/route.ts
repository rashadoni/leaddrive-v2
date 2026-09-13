import { NextRequest, NextResponse } from "next/server"
import { addDateKeyDays, currentDateKey, isDateKey } from "@/lib/mtm/mobile-week"
import { getMtmSettings } from "@/lib/mtm-settings"
import { prisma } from "@/lib/prisma"
import { clientIp } from "@/lib/request-ip"
import { isValidTimezone } from "@/lib/timezone"
import { withWorkforceSessionAuth } from "@/lib/with-workforce-rls-auth"
import { isAgentInWorkforceScope, resolveWorkforceActor } from "@/lib/workforce/actor"
import {
  buildWorkforceApprovedTimesheetReport,
} from "@/lib/workforce/approved-timesheet-report"
import { requireWorkforceApprovedReportAccess } from "@/lib/workforce/approved-report-access"
import { WorkforceTimesheetApprovalError } from "@/lib/workforce/timesheet-approval"
import { logWorkforceSensitiveOperationFailure } from "@/lib/workforce/sensitive-operation-log"
import { workforceSensitiveResponseHeaders } from "@/lib/workforce/sensitive-response"

const MAX_RANGE_DAYS = 93
const MAX_APPROVALS = 5_000

function reportJson(body: Record<string, unknown>, status: number) {
  return NextResponse.json(body, { status, headers: workforceSensitiveResponseHeaders })
}

function badRange() {
  return reportJson({
    error: "start/end must be YYYY-MM-DD and cover at most 93 days",
    code: "WORKFORCE_REPORT_RANGE_INVALID",
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
 * Read-only operational summary. The report intentionally aggregates only
 * hash-verified immutable approval rows; it does not expose live workday
 * state, raw location, QR/device evidence or free-text employee requests.
 */
export const GET = withWorkforceSessionAuth("read", async (req: NextRequest, auth) => {
  try {
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
  const requestedAgentId = searchParams.get("agentId")
  if (!isDateKey(start) || !isDateKey(end) || end < start || end > addDateKeyDays(start, MAX_RANGE_DAYS - 1)) {
    return badRange()
  }
  if (requestedAgentId && (
    !/^[A-Za-z0-9_-]{1,100}$/.test(requestedAgentId)
    || !isAgentInWorkforceScope(actor, requestedAgentId)
  )) {
    return reportJson({ error: "Forbidden", code: "WORKFORCE_SCOPE_DENIED" }, 403)
  }
  const accessDenied = await requireWorkforceApprovedReportAccess({
    organizationId: auth.orgId,
    auth,
    selectedAgentId: requestedAgentId,
  })
  if (accessDenied) return accessDenied

  const rangeStart = new Date(`${start}T00:00:00.000Z`)
  const rangeEnd = new Date(`${end}T00:00:00.000Z`)
  const agentWhere = requestedAgentId
    ? { agentId: requestedAgentId }
    : actor.scopedAgentIds === null ? {} : { agentId: { in: [...actor.scopedAgentIds] } }

    const approvals = await prisma.workforceTimesheetApproval.findMany({
      where: {
        organizationId: auth.orgId,
        ...agentWhere,
        periodStart: { lte: rangeEnd },
        periodEnd: { gte: rangeStart },
      },
      orderBy: [{ approvedAt: "asc" }, { revision: "asc" }, { id: "asc" }],
      take: MAX_APPROVALS + 1,
      select: {
        id: true,
        agentId: true,
        periodStart: true,
        periodEnd: true,
        recordKind: true,
        revision: true,
        calculationVersion: true,
        rowsHash: true,
        factsHash: true,
        rows: true,
        approvedAt: true,
      },
    })
    if (approvals.length > MAX_APPROVALS) {
      return reportJson({
        error: "Too many approvals for one report; split the date range or employee scope",
        code: "WORKFORCE_REPORT_LIMIT_EXCEEDED",
      }, 413)
    }
    const report = buildWorkforceApprovedTimesheetReport({
      start,
      end,
      approvals: approvals.map((approval) => ({
        ...approval,
        recordKind: approval.recordKind as "APPROVAL" | "CORRECTION",
      })),
    })
    const employeeIds = report.byEmployee.map((employee) => employee.agentId)
    const employees = employeeIds.length === 0
      ? []
      : await prisma.mtmAgent.findMany({
          where: { organizationId: auth.orgId, id: { in: employeeIds } },
          orderBy: { name: "asc" },
          select: { id: true, name: true },
        })
    const names = new Map(employees.map((employee) => [employee.id, employee.name]))
    const audit = auditContext(req)
    await prisma.mtmAuditLog.create({
      data: {
        organizationId: auth.orgId,
        action: "WORKFORCE_APPROVED_REPORT_VIEWED",
        entity: "workforce_approved_report",
        entityId: `${start}:${end}:${requestedAgentId ?? "scope"}`,
        metadataKind: "workforce_approved_report",
        newData: {
          start,
          end,
          scopedEmployeeCount: report.summary.employees,
          workdayCount: report.summary.workdays,
          approvalsExamined: report.summary.approvalsExamined,
          overlappingRowsSuppressed: report.summary.overlappingRowsSuppressed,
          // Never record employee identifiers, individual metrics, raw
          // evidence, location, QR/device proof or free-text reasons here.
        },
        ipAddress: audit.ipAddress,
        userAgent: audit.userAgent,
      },
    })
    return reportJson({
      success: true,
      data: {
        timezone,
        report: {
          ...report,
          byEmployee: report.byEmployee.map((employee) => ({
            ...employee,
            name: names.get(employee.agentId) ?? "Unavailable employee",
          })),
        },
      },
    }, 200)
  } catch (error) {
    if (error instanceof WorkforceTimesheetApprovalError) {
      return reportJson({
        error: "An immutable approval cannot be verified for reporting",
        code: "WORKFORCE_REPORT_APPROVAL_INVALID",
      }, 409)
    }
    logWorkforceSensitiveOperationFailure({ operation: "read-approved-timesheet-report" })
    return reportJson({ error: "Failed to load Workforce approved-time report" }, 500)
  }
})
