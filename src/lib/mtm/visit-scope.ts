import type { Prisma } from "@prisma/client"
import type { MtmRouteActor } from "./route-permissions"

function visibleAgentIds(actor: MtmRouteActor): string[] | null {
  if (actor.role === "ADMIN") return null
  if (actor.role === "AGENT") return actor.agentId ? [actor.agentId] : []
  return [...(actor.scopedAgentIds ?? [])]
}

/**
 * Generic visit edits and deletion belong to the primary agent's current
 * management scope. Participation grants operational/read access, but must not
 * escalate into reassignment, arbitrary edits, or deletion of another agent's
 * visit.
 */
export function mutableVisitWhere(
  actor: MtmRouteActor,
  organizationId: string,
  extra: Prisma.MtmVisitWhereInput = {},
): Prisma.MtmVisitWhereInput {
  const base: Prisma.MtmVisitWhereInput = { organizationId, deletedAt: null, ...extra }
  const agentIds = visibleAgentIds(actor)
  if (agentIds === null) return base
  if (!agentIds.length) return { ...base, id: "__no_access__" }
  return { ...base, agentId: { in: agentIds } }
}

export function canMutateMtmVisit(actor: MtmRouteActor, primaryAgentId: string): boolean {
  const agentIds = visibleAgentIds(actor)
  return agentIds === null || agentIds.includes(primaryAgentId)
}

export function scopedVisitWhere(
  actor: MtmRouteActor,
  organizationId: string,
  extra: Prisma.MtmVisitWhereInput = {},
): Prisma.MtmVisitWhereInput {
  const base: Prisma.MtmVisitWhereInput = { organizationId, deletedAt: null, ...extra }
  if (actor.role === "ADMIN") return base

  const agentIds = visibleAgentIds(actor) ?? []
  if (!agentIds.length) return { ...base, id: "__no_access__" }
  return {
    ...base,
    OR: [
      { agentId: { in: agentIds } },
      {
        participants: {
          some: {
            organizationId,
            agentId: { in: agentIds },
            role: { not: "OBSERVER" },
            leftAt: null,
          },
        },
      },
    ],
  }
}

/**
 * Database-safe superset for an exact historical lookup. Timestamp boundaries
 * are verified with `canViewMtmVisitAtCheckIn` after the candidate is loaded,
 * because Prisma cannot compare participant timestamps to the parent visit's
 * check-in column in a relation filter.
 */
export function historicalVisitCandidateWhere(
  actor: MtmRouteActor,
  organizationId: string,
  extra: Prisma.MtmVisitWhereInput = {},
): Prisma.MtmVisitWhereInput {
  const base: Prisma.MtmVisitWhereInput = { organizationId, deletedAt: null, ...extra }
  const agentIds = visibleAgentIds(actor)
  if (agentIds === null) return base
  if (!agentIds.length) return { ...base, id: "__no_access__" }
  return {
    ...base,
    OR: [
      { agentId: { in: agentIds } },
      {
        participants: {
          some: {
            organizationId,
            agentId: { in: agentIds },
            role: { not: "OBSERVER" },
          },
        },
      },
    ],
  }
}

/**
 * Participant visibility is immutable evidence at check-in. A participant
 * added after the visit must not gain access to an older outside-primary visit;
 * the boundaries match the operational-week attribution contract.
 */
export function canViewMtmVisitAtCheckIn(
  actor: MtmRouteActor,
  visit: {
    agentId: string
    checkInAt: Date
    participants: ReadonlyArray<{
      agentId: string
      role: string
      joinedAt: Date
      leftAt: Date | null
    }>
  },
): boolean {
  const agentIds = visibleAgentIds(actor)
  if (agentIds === null) return true
  const visible = new Set(agentIds)
  if (visible.has(visit.agentId)) return true
  const checkInAt = visit.checkInAt.getTime()
  return visit.participants.some((participant) =>
    participant.role !== "OBSERVER" &&
    visible.has(participant.agentId) &&
    participant.joinedAt.getTime() <= checkInAt &&
    (participant.leftAt === null || participant.leftAt.getTime() > checkInAt),
  )
}
