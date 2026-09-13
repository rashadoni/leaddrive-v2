import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { clientIp } from "@/lib/request-ip"
import { withWorkforceSessionAuth } from "@/lib/with-workforce-rls-auth"
import { exportStoredWorkforceTimesheetApproval } from "@/lib/workforce/timesheet-export"
import { WorkforceTimesheetApprovalError } from "@/lib/workforce/timesheet-approval"
import { requireWorkforceAttendanceSecurityMfa } from "@/lib/workforce/attendance-route"
import { requireWorkforceTimesheetExportAccess } from "@/lib/workforce/timesheet-export-access"
import { requireWorkforceTimesheetExportRateLimit } from "@/lib/workforce/timesheet-export-rate-limit"
import { logWorkforceSensitiveOperationFailure } from "@/lib/workforce/sensitive-operation-log"
import { workforceSensitiveResponseHeaders } from "@/lib/workforce/sensitive-response"

type RouteContext = { params: Promise<{ id: string }> }

const approvalSelect = {
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
} as const

const DIRECT_SESSION_EXPORT_PURPOSE = "HR_RECORD_REVIEW"

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
 * GET /api/v1/workforce/timesheet/approvals/:id/export
 *
 * Download one selected immutable approval revision for a fixed HR-record
 * review purpose. This is not an external delivery or reusable artifact.
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
      error: "A supported export purpose is required before a direct-session download",
      code: "WORKFORCE_TIMESHEET_EXPORT_PURPOSE_REQUIRED",
    }, 400)
  }

  const rateLimited = await requireWorkforceTimesheetExportRateLimit({
    organizationId: auth.orgId,
    principalUserId: auth.userId,
  })
  if (rateLimited) return rateLimited

  try {
    // Resolve only the immutable subject before authorization. Approval rows
    // are not selected until the caller's exact historic scope is accepted.
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
      select: approvalSelect,
    })
    if (!approval) return sensitiveJson({ error: "Not found" }, 404)

    const exported = exportStoredWorkforceTimesheetApproval(approval)
    const audit = requestAuditContext(req)
    await prisma.mtmAuditLog.create({
      data: {
        organizationId: auth.orgId,
        agentId: approval.agentId,
        action: "WORKFORCE_TIMESHEET_APPROVED_EXPORT_VIEWED",
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
          purpose,
          recipient: "SESSION_DIRECT_DOWNLOAD",
        },
        ipAddress: audit.ipAddress,
        userAgent: audit.userAgent,
      },
    })

    const filename = `workforce-approved-timesheet-${approval.id}-r${approval.revision}.json`
    return new NextResponse(JSON.stringify(exported), {
      status: 200,
      headers: {
        ...workforceSensitiveResponseHeaders,
        "content-disposition": `attachment; filename="${filename}"`,
        "content-type": "application/json; charset=utf-8",
      },
    })
  } catch (error) {
    if (error instanceof WorkforceTimesheetApprovalError) {
      return sensitiveJson({
        error: "The immutable Workforce approval cannot be verified for export",
        code: "WORKFORCE_TIMESHEET_EXPORT_INTEGRITY_INVALID",
      }, 409)
    }
    logWorkforceSensitiveOperationFailure({ operation: "review-timesheet-approval-export" })
    return sensitiveJson({ error: "Failed to export approved Workforce timesheet" }, 500)
  }
})
