import { prisma } from "@/lib/prisma"

/**
 * The org's active SUPPORT agent for customer-facing support/ticketing AI — WhatsApp Da Vinci
 * (handleAiAutoReply) and the customer portal chat. CRITICAL: filters by `agentType: "support"`.
 *
 * Both call sites used to do `findFirst({ organizationId, isActive }, orderBy: updatedAt desc)`
 * with NO agentType filter, so they picked the most-recently-updated agent of ANY type. Once the
 * omnichannel **inbox** persona (agentType="inbox", e.g. the "Gobustone" greeting + menu) was
 * created, it became the newest active config and BLED into the support AI — the support bot
 * started appending the Gobustone menu to tech-support replies. The per-group-agent architecture
 * uses agentType to keep modules separate; this restores that boundary for the support path.
 *
 * Returns null when the org has no active support agent → the caller falls back to its built-in
 * base prompt (no custom "additional instructions"), which is the correct degrade.
 */
export function getSupportAgentConfig(organizationId: string) {
  return prisma.aiAgentConfig.findFirst({
    where: { organizationId, isActive: true, agentType: "support" },
    orderBy: { updatedAt: "desc" },
  })
}
