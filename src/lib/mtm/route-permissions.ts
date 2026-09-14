import type { MtmAgentRoleString } from "@/lib/mtm/territory-scope"
import { isValidMtmAgentRole, resolveAgentScope, resolveTerritoryTeamIds } from "@/lib/mtm/territory-scope"
import { createTtlThrottle } from "@/lib/mtm/actor-memo"

export interface MtmRouteActor {
  agentId: string | null
  role: MtmAgentRoleString
  /** Explicit agent-level planning permission. Undefined preserves legacy test fixtures. */
  canPlanOwnRoutes?: boolean
  /** Explicit agent-level self-publish grant. Absent is fail-closed for agents. */
  canSelfPublishRoutes?: boolean
  /** null means organization-wide scope (administrator). */
  scopedAgentIds: readonly string[] | null
}

export interface MtmRouteAccessTarget {
  primaryAgentId: string
  assignedAgentIds?: readonly string[]
  status?: "DRAFT" | "PLANNED" | "IN_PROGRESS" | "COMPLETED" | "INCOMPLETE" | "CANCELLED"
}

function targetAgentIds(target: MtmRouteAccessTarget): Set<string> {
  return new Set([target.primaryAgentId, ...(target.assignedAgentIds ?? [])])
}

export function isAgentInRouteScope(actor: MtmRouteActor, agentId: string): boolean {
  return actor.scopedAgentIds === null || actor.scopedAgentIds.includes(agentId)
}

export function canViewMtmRoute(actor: MtmRouteActor, target: MtmRouteAccessTarget): boolean {
  if (actor.role === "ADMIN") return true

  const assignments = targetAgentIds(target)
  if (actor.role === "AGENT") {
    return actor.agentId !== null && assignments.has(actor.agentId)
  }

  return [...assignments].some((agentId) => isAgentInRouteScope(actor, agentId))
}

export function canCreateMtmRouteFor(actor: MtmRouteActor, primaryAgentId: string): boolean {
  if (actor.role === "ADMIN") return true
  if (actor.role === "AGENT") return actor.canPlanOwnRoutes !== false && actor.agentId === primaryAgentId
  return isAgentInRouteScope(actor, primaryAgentId)
}

export function canEditMtmRouteDraft(actor: MtmRouteActor, target: MtmRouteAccessTarget): boolean {
  if (target.status !== undefined && target.status !== "DRAFT") return false
  if (actor.role === "ADMIN") return true
  if (actor.role === "AGENT") return actor.canPlanOwnRoutes !== false && actor.agentId === target.primaryAgentId
  return isAgentInRouteScope(actor, target.primaryAgentId)
}

/**
 * Drafts may be edited by their normal owner. Once a route is published,
 * structural edits are restricted to managers, supervisors, and admins in
 * scope. Completed, incomplete and cancelled routes stay immutable audit
 * records — an INCOMPLETE day was closed by the server, so editing its stops
 * afterwards would rewrite history rather than plan work.
 */
export function canEditMtmRoute(actor: MtmRouteActor, target: MtmRouteAccessTarget): boolean {
  if (target.status === undefined || target.status === "DRAFT") {
    return canEditMtmRouteDraft(actor, target)
  }
  if (target.status === "COMPLETED" || target.status === "INCOMPLETE" || target.status === "CANCELLED") return false
  if (actor.role === "AGENT") return false
  if (actor.role === "ADMIN") return true
  return isAgentInRouteScope(actor, target.primaryAgentId)
}

export function canAssignMtmRouteAgents(
  actor: MtmRouteActor,
  primaryAgentId: string,
  assignedAgentIds: readonly string[],
): boolean {
  if (actor.role === "AGENT") {
    return actor.canPlanOwnRoutes !== false && actor.agentId === primaryAgentId && assignedAgentIds.length === 0
  }
  return [primaryAgentId, ...assignedAgentIds].every((agentId) => isAgentInRouteScope(actor, agentId))
}

export function canPublishMtmRoute(
  actor: MtmRouteActor,
  target: MtmRouteAccessTarget,
  selfPublishEnabled: boolean,
): boolean {
  if (target.status !== "DRAFT") return false
  if (actor.role === "ADMIN") return true
  if (actor.role === "AGENT") {
    return actor.canPlanOwnRoutes !== false
      && actor.canSelfPublishRoutes === true
      && selfPublishEnabled
      && actor.agentId === target.primaryAgentId
  }
  return isAgentInRouteScope(actor, target.primaryAgentId)
}

export function canReviewMtmRouteRequest(
  actor: MtmRouteActor,
  requestedByAgentId: string,
): boolean {
  if (actor.role !== "ADMIN" && actor.role !== "MANAGER" && actor.role !== "SUPERVISOR") {
    return false
  }
  if (actor.agentId === requestedByAgentId) return false
  return isAgentInRouteScope(actor, requestedByAgentId)
}

type RouteActorPrisma = Parameters<typeof resolveAgentScope>[0]

/**
 * The duplicate-card check is diagnostics, not authorization: run its count
 * and warning at most once per person per 30 s instead of on every request
 * (a photo gallery alone is hundreds of requests).
 */
const duplicateCardCheck = createTtlThrottle({ ttlMs: 30_000, maxEntries: 2_000 })

/** Test hook: let the duplicate-card diagnostics run again for every user. */
export function resetMtmActorDiagnostics(): void {
  duplicateCardCheck.clear()
}

async function warnOnDuplicateActiveCards(
  prisma: RouteActorPrisma,
  params: { organizationId: string; userId: string },
  chosenAgentId: string,
): Promise<void> {
  if (!duplicateCardCheck.shouldRun(`${params.organizationId}\u0000${params.userId}`)) return
  try {
    const active = await prisma.mtmAgent.count({
      where: { organizationId: params.organizationId, userId: params.userId, status: "ACTIVE" },
    })
    if (typeof active === "number" && active > 1) {
      console.warn("[MTM/actor] user is linked to several ACTIVE agent cards; using the oldest", {
        organizationId: params.organizationId,
        userId: params.userId,
        activeCards: active,
        chosenAgentId,
      })
    }
  } catch {
    // Diagnostics only: a failed count must never change the authorization result.
  }
}

export async function resolveMtmRouteActor(
  prisma: RouteActorPrisma,
  params: { organizationId: string; userId: string; webRole: string; agentId?: string | null },
): Promise<MtmRouteActor | null> {
  if (!params.agentId && (params.webRole === "superadmin" || params.webRole === "admin")) {
    return {
      agentId: null,
      role: "ADMIN",
      canPlanOwnRoutes: true,
      canSelfPublishRoutes: true,
      scopedAgentIds: null,
    }
  }

  const agentWhere = {
    organizationId: params.organizationId,
    ...(params.agentId ? { id: params.agentId } : { userId: params.userId }),
    status: "ACTIVE" as const,
  }
  // One web user may be linked to more than one ACTIVE card (there is no unique
  // index yet). Without an order Postgres may return either row, so the same
  // person could get a different role and scope from one request to the next.
  // The oldest card wins, deterministically; the duplicate is logged below.
  const agent = await prisma.mtmAgent.findFirst({
    where: agentWhere,
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, role: true, canPlanOwnRoutes: true, canSelfPublishRoutes: true },
  })
  if (!agent || !isValidMtmAgentRole(agent.role)) return null
  if (!params.agentId) await warnOnDuplicateActiveCards(prisma, params, agent.id)

  const scope = await resolveAgentScope(prisma, {
    agentId: agent.id,
    organizationId: params.organizationId,
    role: agent.role,
  })
  return {
    agentId: agent.id,
    role: agent.role,
    canPlanOwnRoutes: agent.canPlanOwnRoutes !== false,
    canSelfPublishRoutes: agent.canSelfPublishRoutes === true,
    scopedAgentIds: scope.agentIds,
  }
}

/**
 * Who may see and change visit policies (owner decision 2026-09-14, second
 * pass after the scope audit):
 *
 *   - web admin/superadmin, or an MTM ADMIN card → every policy, including
 *     organization-wide rules (teamId null);
 *   - MANAGER → reads policies that apply to their agents, writes only
 *     policies bound to a team of their territory; never an org-wide rule;
 *   - SUPERVISOR → read-only view of the policies that apply to their team;
 *   - anyone else, including a web "manager" without an MTM card → no access.
 *
 * The earlier rule let any web manager write org-wide rules and change other
 * teams' rules, while a supervisor could not even open them.
 */
export type MtmVisitPolicyAccess =
  | { kind: "admin" }
  | {
    kind: "manager" | "supervisor"
    actor: MtmRouteActor
    /** Teams whose policies this caller may read (org-wide rules are readable too). */
    readableTeamIds: string[]
    /** Teams whose policies this caller may create or change. Empty for supervisors. */
    writableTeamIds: string[]
  }
  | { kind: "none"; reason: "no_field_scope" | "role" }

export async function resolveMtmVisitPolicyAccess(
  prisma: RouteActorPrisma,
  params: { organizationId: string; userId: string; webRole: string },
): Promise<MtmVisitPolicyAccess> {
  if (params.webRole === "superadmin" || params.webRole === "admin") return { kind: "admin" }
  const actor = await resolveMtmRouteActor(prisma, params)
  if (!actor) return { kind: "none", reason: "no_field_scope" }
  if (actor.role === "ADMIN") return { kind: "admin" }
  const actorAgentId = actor.agentId
  if ((actor.role !== "MANAGER" && actor.role !== "SUPERVISOR") || !actorAgentId) {
    return { kind: "none", reason: "role" }
  }
  const territoryTeamIds = await resolveTerritoryTeamIds(prisma, {
    agentId: actorAgentId,
    organizationId: params.organizationId,
    role: actor.role,
  })
  if (actor.role === "SUPERVISOR") {
    return { kind: "supervisor", actor, readableTeamIds: territoryTeamIds, writableTeamIds: [] }
  }
  // A manager also reads the rules that apply to agents in their reporting
  // line who sit in other teams — those rules shape their agents' visits.
  const scopedAgentIds = [...(actor.scopedAgentIds ?? [])]
  const agentTeams = scopedAgentIds.length
    ? await prisma.mtmAgent.findMany({
      where: { organizationId: params.organizationId, id: { in: scopedAgentIds }, teamId: { not: null } },
      select: { teamId: true },
    })
    : []
  const readableTeamIds = [...new Set([
    ...territoryTeamIds,
    ...(agentTeams ?? []).map((agent) => agent.teamId).filter((teamId): teamId is string => !!teamId),
  ])]
  return { kind: "manager", actor, readableTeamIds, writableTeamIds: territoryTeamIds }
}

/** True when the caller may create or change a policy bound to `teamId`. */
export function canWriteMtmVisitPolicyTeam(access: MtmVisitPolicyAccess, teamId: string | null): boolean {
  if (access.kind === "admin") return true
  if (access.kind !== "manager") return false
  return teamId !== null && access.writableTeamIds.includes(teamId)
}
