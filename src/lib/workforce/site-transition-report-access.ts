import { NextResponse } from "next/server"
import type { AuthResult } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import { decidePersistedWorkforceAccess } from "@/lib/workforce/access-grant-resolution"
import { workforceGranularAccessEnabled } from "@/lib/workforce/granular-access-rollout"
import { logWorkforceSensitiveOperationFailure } from "@/lib/workforce/sensitive-operation-log"
import { workforceSensitiveResponseHeaders } from "@/lib/workforce/sensitive-response"

function denied(): NextResponse {
  return NextResponse.json({
    error: "This Workforce site-transition report requires an effective attendance-read grant.",
    code: "WORKFORCE_SITE_TRANSITION_REPORT_ACCESS_REQUIRED",
  }, { status: 403, headers: workforceSensitiveResponseHeaders })
}

function unavailable(): NextResponse {
  return NextResponse.json({
    error: "Unable to verify Workforce site-transition report access.",
    code: "WORKFORCE_SITE_TRANSITION_REPORT_ACCESS_UNAVAILABLE",
  }, { status: 503, headers: workforceSensitiveResponseHeaders })
}

/**
 * Site and employee filters can be matched to exact durable scopes. An
 * unfiltered aggregate deliberately requires organization scope: transition
 * rows do not carry an immutable historical team assignment.
 */
export async function requireWorkforceSiteTransitionReportAccess(input: {
  organizationId: string
  auth: Pick<AuthResult, "principalType" | "role" | "userId">
  selectedAgentId: string | null
  selectedSiteId: string | null
}): Promise<Response | null> {
  if (input.auth.principalType !== "session") return denied()
  if (input.selectedAgentId && input.selectedSiteId) return denied()
  try {
    const organization = await prisma.organization.findUnique({
      where: { id: input.organizationId },
      select: { features: true },
    })
    if (!organization) return unavailable()
    if (!workforceGranularAccessEnabled(organization.features)) {
      return input.auth.role === "admin" || input.auth.role === "superadmin" ? null : denied()
    }
    const resource = input.selectedAgentId
      ? { organizationId: input.organizationId, agentId: input.selectedAgentId }
      : input.selectedSiteId
        ? { organizationId: input.organizationId, siteId: input.selectedSiteId }
        : { organizationId: input.organizationId }
    const access = await decidePersistedWorkforceAccess({
      db: prisma,
      organizationId: input.organizationId,
      principalUserId: input.auth.userId,
      selfAgentId: null,
      permission: "TEAM_ATTENDANCE_READ",
      resource,
    })
    return access.allowed ? null : denied()
  } catch {
    logWorkforceSensitiveOperationFailure({ operation: "authorize-site-transition-report" })
    return unavailable()
  }
}
