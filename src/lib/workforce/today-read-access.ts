import { logWorkforceSensitiveOperationFailure } from "@/lib/workforce/sensitive-operation-log"
import { NextResponse } from "next/server"
import {
  readPersistedWorkforceAccessGrants,
  type WorkforceAccessGrantReaderDb,
} from "@/lib/workforce/access-grant-resolution"
import {
  decideWorkforceAccess,
  type WorkforceAccessGrant,
  type WorkforceResourceScope,
} from "@/lib/workforce/access-control"
import { workforceGranularAccessEnabled } from "@/lib/workforce/granular-access-rollout"
import { workforceSensitiveResponseHeaders } from "@/lib/workforce/sensitive-response"

export type WorkforceTodayReadCandidate = {
  id: string
  teamId: string | null
}

export type WorkforceTodayReadScope = {
  granularAccess: boolean
  grants: readonly WorkforceAccessGrant[]
  now: Date
  organizationWide: boolean
  teamIds: readonly string[]
  agentIds: readonly string[]
}

function todayReadDenied(): NextResponse {
  // A missing, revoked, incompatible or differently scoped grant must not
  // reveal whether the tenant currently has any other active employee.
  return NextResponse.json({
    error: "This Workforce Today view requires an effective worktime-read grant.",
    code: "WORKFORCE_TODAY_READ_ACCESS_REQUIRED",
  }, { status: 403, headers: workforceSensitiveResponseHeaders })
}

function todayReadUnavailable(): NextResponse {
  return NextResponse.json({
    error: "Unable to verify Workforce Today access.",
    code: "WORKFORCE_TODAY_READ_ACCESS_UNAVAILABLE",
  }, { status: 503, headers: workforceSensitiveResponseHeaders })
}

function resourceForGrant(
  organizationId: string,
  grant: WorkforceAccessGrant,
): WorkforceResourceScope {
  switch (grant.scope.kind) {
    case "ORGANIZATION": return { organizationId }
    case "TEAM": return { organizationId, teamId: grant.scope.teamId }
    case "SITE": return { organizationId, siteId: grant.scope.siteId }
    case "AGENT": return { organizationId, agentId: grant.scope.agentId }
  }
}

/**
 * Resolves the bounded grant snapshot before a roster query. Site grants are
 * deliberately not converted into employee ids: Today has no reviewed,
 * immutable current-site roster resolver.
 */
export async function resolveWorkforceTodayReadScope(input: {
  db: WorkforceAccessGrantReaderDb
  organizationId: string
  organizationFeatures: unknown
  principalUserId: string
  selfAgentId: string | null
  now?: Date
}): Promise<WorkforceTodayReadScope | Response> {
  const now = input.now ?? new Date()
  if (!workforceGranularAccessEnabled(input.organizationFeatures)) {
    return {
      granularAccess: false,
      grants: [],
      now,
      organizationWide: true,
      teamIds: [],
      agentIds: input.selfAgentId ? [input.selfAgentId] : [],
    }
  }

  try {
    const grants = await readPersistedWorkforceAccessGrants({
      db: input.db,
      organizationId: input.organizationId,
      principalUserId: input.principalUserId,
      now,
    })
    if (!grants) return todayReadUnavailable()

    let organizationWide = false
    const teamIds = new Set<string>()
    const agentIds = new Set<string>()
    if (input.selfAgentId) agentIds.add(input.selfAgentId)
    for (const grant of grants) {
      if (grant.scope.kind === "SITE") continue
      const allowed = decideWorkforceAccess({
        organizationId: input.organizationId,
        principalUserId: input.principalUserId,
        selfAgentId: null,
        permission: "TEAM_ATTENDANCE_READ",
        resource: resourceForGrant(input.organizationId, grant),
        grants: [grant],
        now,
      }).allowed
      if (!allowed) continue
      if (grant.scope.kind === "ORGANIZATION") organizationWide = true
      else if (grant.scope.kind === "TEAM") teamIds.add(grant.scope.teamId)
      else if (grant.scope.kind === "AGENT") agentIds.add(grant.scope.agentId)
    }
    if (!organizationWide && teamIds.size === 0 && agentIds.size === 0) return todayReadDenied()
    return {
      granularAccess: true,
      grants,
      now,
      organizationWide,
      teamIds: [...teamIds].sort(),
      agentIds: [...agentIds].sort(),
    }
  } catch {
    logWorkforceSensitiveOperationFailure({ operation: "authorize-today-read" })
    return todayReadUnavailable()
  }
}

export function authorizeWorkforceTodayReadCandidates(input: {
  scope: WorkforceTodayReadScope
  organizationId: string
  principalUserId: string
  selfAgentId: string | null
  candidates: readonly WorkforceTodayReadCandidate[]
}): readonly string[] {
  if (!input.scope.granularAccess) return input.candidates.map((candidate) => candidate.id)
  return input.candidates.flatMap((candidate) => {
    const resource = {
      organizationId: input.organizationId,
      agentId: candidate.id,
      ...(candidate.teamId == null ? {} : { teamId: candidate.teamId }),
    }
    const self = decideWorkforceAccess({
      organizationId: input.organizationId,
      principalUserId: input.principalUserId,
      selfAgentId: input.selfAgentId,
      permission: "SELF_WORKTIME_READ",
      resource,
      grants: input.scope.grants,
      now: input.scope.now,
    })
    if (self.allowed) return [candidate.id]
    const attendance = decideWorkforceAccess({
      organizationId: input.organizationId,
      principalUserId: input.principalUserId,
      selfAgentId: null,
      permission: "TEAM_ATTENDANCE_READ",
      resource,
      grants: input.scope.grants,
      now: input.scope.now,
    })
    return attendance.allowed ? [candidate.id] : []
  })
}

/**
 * Controlled C7 fence for the current-day Workforce read model.
 *
 * The candidate query supplies only current active employee IDs and team IDs;
 * it intentionally contains no names, workday facts, calendar data or
 * location/evidence. The bounded persisted-grant snapshot is then reused for
 * every candidate, preventing an N+1 grant lookup and a growing revocation
 * race. TEAM scope is valid for this current-day model because its resource
 * explicitly carries the current team ID. A site scope is not inferred from a
 * mutable schedule or presence claim, so it fails closed until a separately
 * reviewed current-site resolver exists.
 */
export async function requireWorkforceTodayReadAccess(input: {
  db: WorkforceAccessGrantReaderDb
  organizationId: string
  organizationFeatures: unknown
  principalUserId: string
  selfAgentId: string | null
  candidates: readonly WorkforceTodayReadCandidate[]
}): Promise<{ agentIds: readonly string[] } | Response> {
  const scope = await resolveWorkforceTodayReadScope(input)
  if (scope instanceof Response) return scope
  const agentIds = authorizeWorkforceTodayReadCandidates({
    scope,
    organizationId: input.organizationId,
    principalUserId: input.principalUserId,
    selfAgentId: input.selfAgentId,
    candidates: input.candidates,
  })
  return agentIds.length > 0 ? { agentIds } : todayReadDenied()
}
