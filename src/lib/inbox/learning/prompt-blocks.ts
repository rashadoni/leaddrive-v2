/**
 * The learned character and knowledge of the channel a conversation came in on, for the reply prompt
 * of every assistant that answers there — the inbox engine (lib/social/ai-autoreply) and WhatsApp's
 * Da Vinci (lib/inbox/page-agent whatsAppPageTurn). Fail-soft: a failed read means "nothing learned",
 * exactly what the assistants did before training existed.
 */
import { prisma } from "@/lib/prisma"
import { composeLearnedCharacter, composeLearnedKnowledge, type LearnedRow } from "@/lib/inbox/learning/compose"

export type LearnedBlocks = { character: string; knowledge: string }
const NONE: LearnedBlocks = { character: "", knowledge: "" }

export async function learnedPromptBlocks(params: {
  organizationId: string
  channelConfigId?: string | null
  conversationId?: string | null
}): Promise<LearnedBlocks> {
  try {
    let channelConfigId = params.channelConfigId ?? null
    if (!channelConfigId && params.conversationId) {
      const conversation = await prisma.socialConversation.findFirst({
        where: { id: params.conversationId, organizationId: params.organizationId },
        select: { channelConfigId: true },
      })
      channelConfigId = conversation?.channelConfigId ?? null
    }
    if (!channelConfigId) return NONE
    const rows: LearnedRow[] = await prisma.inboxLearnedItem.findMany({
      where: { organizationId: params.organizationId, channelConfigId, removedAt: null },
      orderBy: [{ lastSeenAt: "desc" }, { id: "asc" }],
      select: { kind: true, type: true, title: true, body: true, status: true, removedAt: true },
      take: 400,
    })
    return { character: composeLearnedCharacter(rows), knowledge: composeLearnedKnowledge(rows) }
  } catch (error) {
    console.error("[inbox-learning prompt]", error instanceof Error ? error.message : error)
    return NONE
  }
}
