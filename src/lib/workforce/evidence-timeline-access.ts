import { NextResponse } from "next/server"
import type { AuthResult } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import {
  readPersistedWorkforceAccessGrants,
} from "@/lib/workforce/access-grant-resolution"
import {
  decideWorkforceAccess,
  type WorkforceAccessGrant,
} from "@/lib/workforce/access-control"
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

type EvidenceAccessSnapshot =
  | { mode: "LEGACY_ADMIN" }
  | { mode: "GRANULAR"; grants: readonly WorkforceAccessGrant[] }

export type WorkforceEvidenceDirectoryAccess =
  | { mode: "ALL_ACTIVE_AGENTS" }
  | { mode: "EXACT_AGENTS"; agentIds: readonly string[] }

async function evidenceAccessSnapshot(input: {
  organizationId: string
  auth: Pick<AuthResult, "principalType" | "role" | "userId">
  operation: "authorize-evidence-timeline" | "authorize-evidence-directory"
}): Promise<EvidenceAccessSnapshot | Response> {
  if (input.auth.principalType !== "session") return denied()
  try {
    const organization = await prisma.organization.findUnique({
      where: { id: input.organizationId },
      select: { features: true },
    })
    if (!organization) return unavailable()
    if (!workforceGranularAccessEnabled(organization.features)) {
      return input.auth.role === "admin" || input.auth.role === "superadmin"
        ? { mode: "LEGACY_ADMIN" }
        : denied()
    }
    const grants = await readPersistedWorkforceAccessGrants({
      db: prisma,
      organizationId: input.organizationId,
      principalUserId: input.auth.userId,
    })
    return grants ? { mode: "GRANULAR", grants } : unavailable()
  } catch {
    logWorkforceSensitiveOperationFailure({ operation: input.operation })
    return unavailable()
  }
}

function canReadAgent(input: {
  organizationId: string
  principalUserId: string
  agentId: string
  grants: readonly WorkforceAccessGrant[]
}): boolean {
  return decideWorkforceAccess({
    organizationId: input.organizationId,
    principalUserId: input.principalUserId,
    selfAgentId: null,
    permission: "EVIDENCE_DERIVED_READ",
    resource: { organizationId: input.organizationId, agentId: input.agentId },
    grants: input.grants,
  }).allowed
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
  const snapshot = await evidenceAccessSnapshot({
    organizationId: input.organizationId,
    auth: input.auth,
    operation: "authorize-evidence-timeline",
  })
  if (snapshot instanceof Response) return snapshot
  if (snapshot.mode === "LEGACY_ADMIN") return null
  return canReadAgent({
    organizationId: input.organizationId,
    principalUserId: input.auth.userId,
    agentId: input.targetAgentId,
    grants: snapshot.grants,
  }) ? null : denied()
}

/**
 * Resolves the smallest safe employee-directory predicate for the timeline
 * picker. Organization grants may search all active tenant employees. Exact
 * AGENT grants may search only those employee IDs. TEAM/SITE grants fail
 * closed because this timeline has no stable team/site resource context.
 */
export async function resolveWorkforceEvidenceDirectoryAccess(input: {
  organizationId: string
  auth: Pick<AuthResult, "principalType" | "role" | "userId">
}): Promise<WorkforceEvidenceDirectoryAccess | Response> {
  const snapshot = await evidenceAccessSnapshot({
    organizationId: input.organizationId,
    auth: input.auth,
    operation: "authorize-evidence-directory",
  })
  if (snapshot instanceof Response) return snapshot
  if (snapshot.mode === "LEGACY_ADMIN") return { mode: "ALL_ACTIVE_AGENTS" }

  const organizationGrant = snapshot.grants.some((grant) => (
    grant.scope.kind === "ORGANIZATION"
    && canReadAgent({
      organizationId: input.organizationId,
      principalUserId: input.auth.userId,
      agentId: "workforce-evidence-scope-probe",
      grants: [grant],
    })
  ))
  if (organizationGrant) return { mode: "ALL_ACTIVE_AGENTS" }

  const agentIds = [...new Set(snapshot.grants.flatMap((grant) => {
    if (grant.scope.kind !== "AGENT") return []
    return canReadAgent({
      organizationId: input.organizationId,
      principalUserId: input.auth.userId,
      agentId: grant.scope.agentId,
      grants: snapshot.grants,
    }) ? [grant.scope.agentId] : []
  }))]
  return agentIds.length > 0 ? { mode: "EXACT_AGENTS", agentIds } : denied()
}
