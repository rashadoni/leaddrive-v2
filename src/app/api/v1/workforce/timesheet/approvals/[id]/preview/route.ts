import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { clientIp } from "@/lib/request-ip"
import { withWorkforceSessionAuth } from "@/lib/with-workforce-rls-auth"
import { requireWorkforceAttendanceSecurityMfa } from "@/lib/workforce/attendance-route"
import { WorkforceTimesheetApprovalError } from "@/lib/workforce/timesheet-approval"
import { requireWorkforceTimesheetExportAccess } from "@/lib/workforce/timesheet-export-access"
import { requireWorkforceTimesheetExportRateLimit } from "@/lib/workforce/timesheet-export-rate-limit"
import { exportStoredWorkforceTimesheetApproval } from "@/lib/workforce/timesheet-export"
import { logWorkforceSensitiveOperationFailure } from "@/lib/workforce/sensitive-operation-log"
import { workforceSensitiveResponseHeaders } from "@/lib/workforce/sensitive-response"

type RouteContext = { params: Promise<{ id: string }> }

const DIRECT_SESSION_EXPORT_PURPOSE = "HR_RECORD_REVIEW"

const approvalPreviewSelect = {
  id: true,
  agentId: true,
  agent: { select: { id: true, name: true } },
  periodStart: true,
  periodEnd: true,
  recordKind: true,
  revision: true,
  calculationVersion: true,
  rowsHash: true,
  factsHash: true,
  rows: true,
  approvedAt: true,
} as const

function sensitiveJson(body: Record<string, unknown>, status: number): NextResponse {
  return NextResponse.json(body, { status, headers: workforceSensitiveResponseHeaders })
}

function requestAuditContext(req: NextRequest) {
  const ipAddress = clientIp(req)
  return {
    ipAddress: ipAddress === "unknown" ? null : ipAddress,
    userAgent: req.headers.get("user-agent")?.slice(0, 500) ?? null,
  }
}

/**
 * Preview the exact immutable, ordinary time-fact payload before the matching
 * direct-session download. Authorization and integrity checks deliberately
 * mirror the export route; current workdays and raw proof are never read.
 */
export const GET = withWorkforceSessionAuth<RouteContext>("read", async (req: NextRequest, auth, { params }) => {
  const mfaDenied = await requireWorkforceAttendanceSecurityMfa(auth.orgId, auth)
  if (mfaDenied) return mfaDenied

  const { id } = await params
  if (!/^[A-Za-z0-9_-]{1,191}$/.test(id)) {
    return sensitiveJson({ error: "Invalid Workforce approval id" }, 400)
  }
  const purpose = new URL(req.url).searchParams.get("purpose")
  if (purpose !== DIRECT_SESSION_EXPORT_PURPOSE) {
    return sensitiveJson({
      error: "A supported export purpose is required before preview",
      code: "WORKFORCE_TIMESHEET_EXPORT_PURPOSE_REQUIRED",
    }, 400)
  }

  const rateLimited = await requireWorkforceTimesheetExportRateLimit({
    organizationId: auth.orgId,
    principalUserId: auth.userId,
  })
  if (rateLimited) return rateLimited

  try {
    const subject = await prisma.workforceTimesheetApproval.findFirst({
      where: { id, organizationId: auth.orgId },
      select: { id: true, agentId: true },
    })
    const denied = await requireWorkforceTimesheetExportAccess({
      organizationId: auth.orgId,
      auth,
      approvalAgentId: subject?.agentId ?? null,
    })
    if (denied) return denied
    if (!subject) return sensitiveJson({ error: "Not found" }, 404)

    const approval = await prisma.workforceTimesheetApproval.findFirst({
      where: { id: subject.id, organizationId: auth.orgId, agentId: subject.agentId },
      select: approvalPreviewSelect,
    })
    if (!approval) return sensitiveJson({ error: "Not found" }, 404)

    const exported = exportStoredWorkforceTimesheetApproval(approval)
    const audit = requestAuditContext(req)
    await prisma.mtmAuditLog.create({
      data: {
        organizationId: auth.orgId,
        agentId: approval.agentId,
        action: "WORKFORCE_TIMESHEET_APPROVED_EXPORT_PREVIEWED",
        entity: "workforce_timesheet_approval",
        entityId: approval.id,
        metadataKind: "workforce_timesheet_export",
        newData: {
          approvalId: approval.id,
          recordKind: approval.recordKind,
          revision: approval.revision,
          periodStart: approval.periodStart.toISOString().slice(0, 10),
          periodEnd: approval.periodEnd.toISOString().slice(0, 10),
          rowsHash: approval.rowsHash,
          factsHash: approval.factsHash,
          format: exported.export.format,
          rowCount: exported.export.rows.length,
          siteScope: "EXCLUDED_FROM_ORDINARY_EXPORT",
          purpose,
          recipient: "SESSION_DIRECT_DOWNLOAD",
        },
        ipAddress: audit.ipAddress,
        userAgent: audit.userAgent,
      },
    })

    return sensitiveJson({
      success: true,
      data: {
        approval: {
          id: approval.id,
          recordKind: approval.recordKind,
          revision: approval.revision,
          calculationVersion: approval.calculationVersion,
          approvedAt: approval.approvedAt.toISOString(),
        },
        scope: {
          employee: approval.agent,
          periodStart: exported.export.periodStart,
          periodEnd: exported.export.periodEnd,
          rowCount: exported.export.rows.length,
          siteScope: "EXCLUDED_FROM_ORDINARY_EXPORT",
        },
        delivery: {
          purpose,
          recipient: "SESSION_DIRECT_DOWNLOAD",
          artifactPersistence: "NONE",
        },
        warningCodes: [
          "WORKFORCE_EXPORT_TIME_FACTS_ONLY",
          "WORKFORCE_EXPORT_SITE_SCOPE_EXCLUDED",
          "WORKFORCE_EXPORT_OVERTIME_NOT_PAYABLE",
        ],
        rows: exported.export.rows,
      },
    }, 200)
  } catch (error) {
    if (error instanceof WorkforceTimesheetApprovalError) {
      return sensitiveJson({
        error: "The immutable Workforce approval cannot be verified for preview",
        code: "WORKFORCE_TIMESHEET_EXPORT_INTEGRITY_INVALID",
      }, 409)
    }
    logWorkforceSensitiveOperationFailure({ operation: "preview-timesheet-approval-export" })
    return sensitiveJson({ error: "Failed to preview approved Workforce timesheet" }, 500)
  }
})
