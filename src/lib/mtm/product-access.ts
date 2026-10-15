import { prisma } from "@/lib/prisma"
import { expandVisibleProductGroupIds } from "@/lib/mtm/product-group-access"
import { resolveMtmRouteActor } from "@/lib/mtm/route-permissions"

/**
 * Which product groups a web user sees and which he manages. An administrator
 * sees and manages every group; anybody else sees the groups he is a member of
 * and manages those where he is a MANAGER — each with all its subgroups.
 *
 * Shared by the catalog's routes (`/api/v1/mtm/products…`), so the file a
 * user may download is decided by the same rule as the list he is shown.
 */
export async function resolveMtmProductAccess(auth: {
  orgId: string
  userId: string
  role: string
  agentId?: string | null
}) {
  const actor = await resolveMtmRouteActor(prisma, {
    organizationId: auth.orgId,
    userId: auth.userId,
    webRole: auth.role,
    agentId: auth.agentId,
  })
  if (!actor) return null

  const groups = await prisma.mtmProductGroup.findMany({
    where: { organizationId: auth.orgId },
    select: {
      id: true,
      parentId: true,
      members: {
        where: { agentId: actor.agentId ?? "__no_agent__" },
        select: { role: true },
      },
    },
  })
  const visibleIds = actor.role === "ADMIN"
    ? new Set(groups.map((group) => group.id))
    : expandVisibleProductGroupIds(groups.map((group) => ({
      id: group.id,
      parentId: group.parentId,
      hasDirectMembership: group.members.length > 0,
    })))
  const managedIds = actor.role === "ADMIN"
    ? visibleIds
    : expandVisibleProductGroupIds(groups.map((group) => ({
      id: group.id,
      parentId: group.parentId,
      hasDirectMembership: group.members.some((member) => member.role === "MANAGER"),
    })))
  return { actor, visibleIds, managedIds }
}
