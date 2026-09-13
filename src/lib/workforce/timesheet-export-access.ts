import { NextResponse } from "next/server"
import type { AuthResult } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import { decidePersistedWorkforceAccess } from "@/lib/workforce/access-grant-resolution"
import { workforceGranularAccessEnabled } from "@/lib/workforce/granular-access-rollout"
import { logWorkforceSensitiveOperationFailure } from "@/lib/workforce/sensitive-operation-log"
import { workforceSensitiveResponseHeaders } from "@/lib/workforce/sensitive-response"

function isLegacyWorkforceAdministrator(role: string | null | undefined): boolean {
  return role === "admin" || role === "superadmin"
}

function exportAccessDenied(): NextResponse {
  return NextResponse.json({
    error: "This Workforce export action requires an effective export-custodian grant.",
    code: "WORKFORCE_TIMESHEET_EXPORT_ACCESS_REQUIRED",
  }, { status: 403, headers: workforceSensitiveResponseHeaders })
}

function exportAccessUnavailable(): NextResponse {
  return NextResponse.json({
    error: "Unable to verify Workforce export access.",
    code: "WORKFORCE_TIMESHEET_EXPORT_ACCESS_UNAVAILABLE",
  }, { status: 503, headers: workforceSensitiveResponseHeaders })
}

/**
 * Preserve the legacy session-admin boundary until granular access is enabled.
 * After cutover, only an organization-wide or exact employee-scoped export
 * custodian grant can cover the immutable approval; current team membership
 * cannot widen a historical timesheet read.
 */
export async function requireWorkforceTimesheetExportAccess(input: {
  organizationId: string
  auth: Pick<AuthResult, "principalType" | "role" | "userId">
  approvalAgentId: string | null
}): Promise<Response | null> {
  if (input.auth.principalType !== "session") return exportAccessDenied()
  try {
    const organization = await prisma.organization.findUnique({
      where: { id: input.organizationId },
      select: { features: true },
    })
    if (!organization) return exportAccessUnavailable()
    if (!workforceGranularAccessEnabled(organization.features)) {
      return isLegacyWorkforceAdministrator(input.auth.role) ? null : exportAccessDenied()
    }
    if (input.approvalAgentId == null) return exportAccessDenied()
    const access = await decidePersistedWorkforceAccess({
      db: prisma,
      organizationId: input.organizationId,
      principalUserId: input.auth.userId,
      selfAgentId: null,
      permission: "TIMESHEET_EXPORT",
      resource: { organizationId: input.organizationId, agentId: input.approvalAgentId },
    })
    return access.allowed ? null : exportAccessDenied()
  } catch {
    logWorkforceSensitiveOperationFailure({ operation: "review-timesheet-approval-export" })
    return exportAccessUnavailable()
  }
}
