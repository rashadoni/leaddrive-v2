import type { PrismaClient } from "@prisma/client"
import {
  isValidMtmAgentRole,
  resolveAgentScope,
  type MtmAgentRoleString,
} from "@/lib/mtm/territory-scope"

/**
 * Workforce shares the organization → team → employee directory, but has no
 * Route & Field entitlement dependency.  Keep its actor vocabulary here so
 * new HRM endpoints never need to import route-specific authorization.
 */
export interface WorkforceActor {
  agentId: string | null
  role: MtmAgentRoleString
  /** null means organization-wide scope for an administrator. */
  scopedAgentIds: readonly string[] | null
}

type WorkforceActorPrisma = Pick<PrismaClient, "mtmAgent" | "mtmTeam">

export function isAgentInWorkforceScope(actor: WorkforceActor, agentId: string): boolean {
  return actor.scopedAgentIds === null || actor.scopedAgentIds.includes(agentId)
}

/**
 * Resolve the personnel scope of a web/API-key/mobile principal. Web tenant
 * administrators may operate without an MtmAgent row; everyone else must map
 * to an active employee before HRM records are read or changed.
 */
export async function resolveWorkforceActor(
  prisma: WorkforceActorPrisma,
  params: { organizationId: string; userId: string; webRole: string; agentId?: string | null },
): Promise<WorkforceActor | null> {
  if (!params.agentId && (params.webRole === "superadmin" || params.webRole === "admin")) {
    return { agentId: null, role: "ADMIN", scopedAgentIds: null }
  }

  const agent = await prisma.mtmAgent.findFirst({
    where: {
      organizationId: params.organizationId,
      ...(params.agentId ? { id: params.agentId } : { userId: params.userId }),
      status: "ACTIVE",
    },
    select: { id: true, role: true },
  })
  if (!agent || !isValidMtmAgentRole(agent.role)) return null

  const scope = await resolveAgentScope(prisma, {
    agentId: agent.id,
    organizationId: params.organizationId,
    role: agent.role,
  })
  return { agentId: agent.id, role: agent.role, scopedAgentIds: scope.agentIds }
}
