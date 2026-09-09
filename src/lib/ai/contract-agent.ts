import { prisma } from "@/lib/prisma"

/**
 * Resolve the active "Contract Agent" config for an org. Returns null when none
 * is configured — callers then fall back to their default model. Deliberately
 * does NOT fall back to a general/sales agent: a support agent's model/prompt is
 * wrong for CLM. Org-scoped query (no cross-tenant leak).
 */
export async function getContractAgentConfig(organizationId: string) {
  return prisma.aiAgentConfig.findFirst({
    where: { organizationId, isActive: true, agentType: "contract" },
    orderBy: { priority: "desc" },
  })
}
