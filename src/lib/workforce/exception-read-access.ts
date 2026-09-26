import {
  decideWorkforceAccess,
  type WorkforceAccessGrant,
} from "@/lib/workforce/access-control"

export type WorkforceExceptionReadCandidate = {
  id: string
  agentId: string
  siteId: string | null
}

export type WorkforceExceptionReadAuthorization = {
  readable: boolean
  decidable: boolean
}

/**
 * Evaluates a bounded metadata-only candidate set against one effective grant
 * snapshot. Names, reasons, proof and decision contents must not be loaded
 * until the caller has filtered to ids marked readable here.
 */
export function authorizeWorkforceExceptionReadCandidates(input: {
  organizationId: string
  principalUserId: string
  candidates: readonly WorkforceExceptionReadCandidate[]
  historicalTeamByCaseId: ReadonlyMap<string, string | null>
  grants: readonly WorkforceAccessGrant[]
  now: Date
}): ReadonlyMap<string, WorkforceExceptionReadAuthorization> {
  const result = new Map<string, WorkforceExceptionReadAuthorization>()
  for (const candidate of input.candidates) {
    if (!candidate.id || !candidate.agentId || result.has(candidate.id)) {
      result.set(candidate.id, { readable: false, decidable: false })
      continue
    }
    const resource = {
      organizationId: input.organizationId,
      agentId: candidate.agentId,
      teamId: input.historicalTeamByCaseId.get(candidate.id) ?? null,
      siteId: candidate.siteId,
    }
    const readable = decideWorkforceAccess({
      organizationId: input.organizationId,
      principalUserId: input.principalUserId,
      selfAgentId: null,
      permission: "TEAM_EXCEPTION_READ",
      resource,
      grants: input.grants,
      now: input.now,
    }).allowed
    const decidable = readable && decideWorkforceAccess({
      organizationId: input.organizationId,
      principalUserId: input.principalUserId,
      selfAgentId: null,
      permission: "TEAM_EXCEPTION_DECIDE",
      resource,
      grants: input.grants,
      now: input.now,
    }).allowed
    result.set(candidate.id, { readable, decidable })
  }
  return result
}
