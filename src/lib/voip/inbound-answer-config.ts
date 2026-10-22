import { prisma } from "@/lib/prisma"
import { readInboundAnswerPolicy, type InboundAnswerPolicy } from "@/lib/voip/inbound-answer"

/**
 * The inbound answer policy of the organisation's station line.
 *
 * Read from the newest active Asterisk VoIP config, preferring one whose voice
 * agent is on — the same row the voice agent takes its rules from when there
 * is no outbound-only config, so the "AI answers" decision and the words the AI
 * then speaks come from one place. Must run inside the tenant's RLS scope.
 */
export async function loadInboundAnswerPolicy(organizationId: string): Promise<InboundAnswerPolicy> {
  return (await loadInboundAnswerSelection(organizationId)).policy
}

/** Keep the selected line with its policy; the call must retain this identity
 * when it is handed to AI, rather than guessing the newest line during search. */
export async function loadInboundAnswerSelection(organizationId: string): Promise<{
  channelConfigId: string | null; policy: InboundAnswerPolicy
}> {
  const configs = await prisma.channelConfig.findMany({
    where: { organizationId, channelType: "voip", isActive: true },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    select: { id: true, settings: true },
  })
  const asterisk = configs
    .filter((config: { id: string; settings: unknown }) => (
      Boolean(config.settings)
      && typeof config.settings === "object"
      && (config.settings as Record<string, unknown>).provider === "asterisk"
    )) as Record<string, unknown>[]
  const chosen = asterisk.find((config) => (config.settings as Record<string, unknown>).voiceAgentEnabled === true) ?? asterisk[0]
  return { channelConfigId: typeof chosen?.id === "string" ? chosen.id : null, policy: readInboundAnswerPolicy(chosen?.settings) }
}
