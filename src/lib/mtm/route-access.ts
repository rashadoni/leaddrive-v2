import type { Prisma } from "@prisma/client"
import type { MtmRouteActor } from "@/lib/mtm/route-permissions"

/**
 * Reusable exact-record fence for additive route subresources. It intentionally
 * mirrors the established route detail scope: a caller may reach a current
 * assignment or a historical assigned route, while the handler decides which
 * action is allowed after the route has been loaded under tenant RLS.
 */
export function mtmRouteExactScopeWhere(
  actor: MtmRouteActor,
  organizationId: string,
  id: string,
): Prisma.MtmRouteWhereInput {
  const base: Prisma.MtmRouteWhereInput = { id, organizationId, deletedAt: null }
  if (actor.role === "ADMIN") return base
  const agentIds = actor.role === "AGENT"
    ? actor.agentId ? [actor.agentId] : []
    : [...(actor.scopedAgentIds ?? [])]
  if (!agentIds.length) return { ...base, id: "__no_access__" }
  return {
    ...base,
    OR: [
      { agentId: { in: agentIds } },
      {
        assignments: {
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
