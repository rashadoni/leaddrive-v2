/**
 * The learned character and knowledge of the channel a conversation came in on, for the reply prompt
 * of every assistant that answers there — the inbox engine (lib/social/ai-autoreply) and WhatsApp's
 * Da Vinci (lib/inbox/page-agent whatsAppPageTurn). Fail-soft: a failed read means "nothing learned",
 * exactly what the assistants did before training existed.
 */
import { prisma } from "@/lib/prisma"
import { MANUAL_SOURCE, composeLearnedCharacter, composeLearnedKnowledge, type LearnedRow } from "@/lib/inbox/learning/compose"

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
    const channelRows = { organizationId: params.organizationId, channelConfigId, removedAt: null }
    const read = {
      orderBy: [{ lastSeenAt: "desc" }, { id: "asc" }],
      select: { kind: true, type: true, title: true, body: true, status: true, source: true, approvedAt: true, removedAt: true },
      take: 400,
    }
    const activeLearned = { ...channelRows, kind: "knowledge", status: "active", source: { not: MANUAL_SOURCE } }
    // Separate reads, so that learned rows, however many and however fresh, cannot push the character,
    // what a person added or what a person confirmed out of the window. Waiting and conflicting prices
    // are in none of them.
    const [fixed, confirmed, learned]: LearnedRow[][] = await Promise.all([
      prisma.inboxLearnedItem.findMany({
        ...read,
        where: { ...channelRows, OR: [{ kind: "trait" }, { kind: "knowledge", status: "active", source: MANUAL_SOURCE }] },
      }),
      prisma.inboxLearnedItem.findMany({ ...read, where: { ...activeLearned, approvedAt: { not: null } } }),
      prisma.inboxLearnedItem.findMany({ ...read, where: { ...activeLearned, approvedAt: null } }),
    ])
    const rows = [...fixed, ...confirmed, ...learned]
    return { character: composeLearnedCharacter(rows), knowledge: composeLearnedKnowledge(rows) }
  } catch (error) {
    console.error("[inbox-learning prompt]", error instanceof Error ? error.message : error)
    return NONE
  }
}
