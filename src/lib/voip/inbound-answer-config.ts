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
  const configs = await prisma.channelConfig.findMany({
    where: { organizationId, channelType: "voip", isActive: true },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    select: { settings: true },
  })
  const asterisk = configs
    .map((config: { settings: unknown }) => config.settings)
    .filter((settings: unknown) => (
      Boolean(settings)
      && typeof settings === "object"
      && (settings as Record<string, unknown>).provider === "asterisk"
    )) as Record<string, unknown>[]
  const chosen = asterisk.find((settings) => settings.voiceAgentEnabled === true) ?? asterisk[0]
  return readInboundAnswerPolicy(chosen)
}
