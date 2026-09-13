import {
  decideWorkforceAccess,
  type WorkforceAccessGrant,
  type WorkforceAccessPermission,
} from "@/lib/workforce/access-control"

export type WorkforceRequestReadCandidate = {
  id: string
  agentId: string
  type: string
}

export type WorkforceRequestReadAuthorization = {
  readable: boolean
  decidable: boolean
}

function requestPermission(type: string, action: "read" | "decide"): WorkforceAccessPermission | null {
  switch (type) {
    case "LEAVE":
    case "ABSENCE":
      return action === "read" ? "TEAM_REQUEST_READ" : "TEAM_REQUEST_DECIDE"
    case "TIME_CORRECTION":
      // Reading a correction exposes a proposed immutable fact change, so it
      // shares the explicit time-approval authority rather than a generic
      // team-request permission.
      return "TIME_APPROVE"
    default:
      return null
  }
}

/**
 * Evaluates a metadata-only candidate page against one grant snapshot. Full
 * reasons and decision notes must be loaded only for ids marked readable.
 */
export function authorizeWorkforceRequestReadCandidates(input: {
  organizationId: string
  principalUserId: string
  selfAgentId: string | null
  candidates: readonly WorkforceRequestReadCandidate[]
  historicalTeamByRequestId: ReadonlyMap<string, string | null>
  grants: readonly WorkforceAccessGrant[]
  now: Date
}): ReadonlyMap<string, WorkforceRequestReadAuthorization> {
  const result = new Map<string, WorkforceRequestReadAuthorization>()
  for (const candidate of input.candidates) {
    if (!candidate.id || !candidate.agentId) {
      result.set(candidate.id, { readable: false, decidable: false })
      continue
    }
    const isExactSelf = input.selfAgentId != null && input.selfAgentId === candidate.agentId
    if (isExactSelf) {
      result.set(candidate.id, { readable: true, decidable: false })
      continue
    }

    const teamId = input.historicalTeamByRequestId.get(candidate.id) ?? null
    const readPermission = requestPermission(candidate.type, "read")
    const decidePermission = requestPermission(candidate.type, "decide")
    const readable = readPermission != null && decideWorkforceAccess({
      organizationId: input.organizationId,
      principalUserId: input.principalUserId,
      selfAgentId: null,
      permission: readPermission,
      resource: { organizationId: input.organizationId, agentId: candidate.agentId, teamId },
      grants: input.grants,
      now: input.now,
    }).allowed
    const decidable = readable && decidePermission != null && decideWorkforceAccess({
      organizationId: input.organizationId,
      principalUserId: input.principalUserId,
      selfAgentId: null,
      permission: decidePermission,
      resource: { organizationId: input.organizationId, agentId: candidate.agentId, teamId },
      grants: input.grants,
      now: input.now,
    }).allowed
    result.set(candidate.id, { readable, decidable })
  }
  return result
}
