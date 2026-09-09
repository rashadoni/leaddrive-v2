import type { MtmAgentRoleString } from "@/lib/mtm/territory-scope"
import { isValidMtmAgentRole, resolveAgentScope } from "@/lib/mtm/territory-scope"

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

  const agent = await prisma.mtmAgent.findFirst({
    where: {
      organizationId: params.organizationId,
      ...(params.agentId ? { id: params.agentId } : { userId: params.userId }),
      status: "ACTIVE",
    },
    select: { id: true, role: true, canPlanOwnRoutes: true, canSelfPublishRoutes: true },
  })
  if (!agent || !isValidMtmAgentRole(agent.role)) return null

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
