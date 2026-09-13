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

function reportAccessDenied(): NextResponse {
  // An immutable aggregate can still reveal working-time patterns. Do not
  // distinguish a missing, revoked or differently scoped role grant.
  return NextResponse.json({
    error: "This Workforce approved-time report requires an effective attendance-read grant.",
    code: "WORKFORCE_APPROVED_REPORT_ACCESS_REQUIRED",
  }, { status: 403, headers: workforceSensitiveResponseHeaders })
}

function reportAccessUnavailable(): NextResponse {
  return NextResponse.json({
    error: "Unable to verify Workforce approved-time report access.",
    code: "WORKFORCE_APPROVED_REPORT_ACCESS_UNAVAILABLE",
  }, { status: 503, headers: workforceSensitiveResponseHeaders })
}

/**
 * Controlled C7 fence for hash-verified approved-time aggregates. A selected
 * employee can be checked against an exact employee grant. An all-scope
 * report intentionally accepts only an organization grant after cutover: its
 * immutable approval rows carry no historic team/site snapshot, so resolving
 * a current mutable team would silently widen a historical read.
 */
export async function requireWorkforceApprovedReportAccess(input: {
  organizationId: string
  auth: Pick<AuthResult, "principalType" | "role" | "userId">
  selectedAgentId: string | null
}): Promise<Response | null> {
  if (input.auth.principalType !== "session") return reportAccessDenied()
  try {
    const organization = await prisma.organization.findUnique({
      where: { id: input.organizationId },
      select: { features: true },
    })
    if (!organization) return reportAccessUnavailable()
    if (!workforceGranularAccessEnabled(organization.features)) {
      return isLegacyWorkforceAdministrator(input.auth.role) ? null : reportAccessDenied()
    }
    const access = await decidePersistedWorkforceAccess({
      db: prisma,
      organizationId: input.organizationId,
      principalUserId: input.auth.userId,
      selfAgentId: null,
      permission: "TEAM_ATTENDANCE_READ",
      resource: {
        organizationId: input.organizationId,
        ...(input.selectedAgentId == null ? {} : { agentId: input.selectedAgentId }),
      },
    })
    return access.allowed ? null : reportAccessDenied()
  } catch {
    logWorkforceSensitiveOperationFailure({ operation: "authorize-approved-timesheet-report" })
    return reportAccessUnavailable()
  }
}
