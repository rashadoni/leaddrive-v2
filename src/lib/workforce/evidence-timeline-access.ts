import { NextResponse } from "next/server"
import type { AuthResult } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import { decidePersistedWorkforceAccess } from "@/lib/workforce/access-grant-resolution"
import { workforceGranularAccessEnabled } from "@/lib/workforce/granular-access-rollout"
import { logWorkforceSensitiveOperationFailure } from "@/lib/workforce/sensitive-operation-log"
import { workforceSensitiveResponseHeaders } from "@/lib/workforce/sensitive-response"

function denied(): NextResponse {
  return NextResponse.json({
    error: "This Workforce evidence timeline requires an effective evidence-review grant.",
    code: "WORKFORCE_EVIDENCE_TIMELINE_ACCESS_REQUIRED",
  }, { status: 403, headers: workforceSensitiveResponseHeaders })
}

function unavailable(): NextResponse {
  return NextResponse.json({
    error: "Unable to verify Workforce evidence timeline access.",
    code: "WORKFORCE_EVIDENCE_TIMELINE_ACCESS_UNAVAILABLE",
  }, { status: 503, headers: workforceSensitiveResponseHeaders })
}

/**
 * Derived evidence is a separate privacy role, not an implied manager or
 * time-approver privilege. Legacy tenants retain only the established live
 * admin boundary; after granular cutover an exact employee or organization
 * EVIDENCE_REVIEWER grant is mandatory.
 */
export async function requireWorkforceEvidenceTimelineAccess(input: {
  organizationId: string
  auth: Pick<AuthResult, "principalType" | "role" | "userId">
  targetAgentId: string
}): Promise<Response | null> {
  if (input.auth.principalType !== "session") return denied()
  try {
    const organization = await prisma.organization.findUnique({
      where: { id: input.organizationId },
      select: { features: true },
    })
    if (!organization) return unavailable()
    if (!workforceGranularAccessEnabled(organization.features)) {
      return input.auth.role === "admin" || input.auth.role === "superadmin" ? null : denied()
    }
    const access = await decidePersistedWorkforceAccess({
      db: prisma,
      organizationId: input.organizationId,
      principalUserId: input.auth.userId,
      selfAgentId: null,
      permission: "EVIDENCE_DERIVED_READ",
      resource: { organizationId: input.organizationId, agentId: input.targetAgentId },
    })
    return access.allowed ? null : denied()
  } catch {
    logWorkforceSensitiveOperationFailure({ operation: "authorize-evidence-timeline" })
    return unavailable()
  }
}
