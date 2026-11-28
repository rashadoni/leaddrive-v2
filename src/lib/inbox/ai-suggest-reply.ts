/**
 * «Предложить ответ» in the inbox composer, for a conversation the AI can answer.
 *
 * Owner 2026-11-28: on an Instagram comment «+» under a post the button wrote, in English, «I don't see
 * the customer's message… could you provide it?». The old compose helper (ai-assist.ts) sent the model
 * one line — the last inbound text — with none of the page's character, knowledge or learned facts, no
 * conversation and no post; «+» alone read as nothing, and the model answered the operator instead.
 *
 * Now the suggestion is the reply a customer on this page would get from the AI right now: the same
 * generator as the live auto-reply (generateChannelAiReply), with the page's agent, the knowledge the
 * page learned, the KB, the price rule — on the conversation as it stands, a comment framed as a comment
 * under its post. Silent: nothing is sent, nothing joins the AI chat session, nothing is scored. The
 * operator reads it before sending, so the reviewed-by-person rules apply: no «передаю менеджеру»,
 * «___» where a fact is missing, and a price the facts do not hold is kept but flagged.
 */
import { prisma } from "@/lib/prisma"
import { generateChannelAiReply } from "@/lib/social/ai-autoreply"
import { storedInstagramComment } from "@/lib/social/instagram-comments"

/** Platforms whose conversations the live AI reply engine answers. Others keep the plain helper. */
export const SUGGEST_REPLY_CHANNELS: ReadonlySet<string> = new Set([
  "instagram", "facebook", "whatsapp", "telegram", "vkontakte", "tiktok", "chatwoot",
])

const HISTORY_ROWS = 20
const CAPTION_CHARS = 300

type Turn = { role: "user" | "assistant"; content: string }

export type SuggestReplyOutcome =
  | { ok: true; suggestion: string; unverifiedOffer: boolean }
  | { ok: false; error: "not_found" | "no_customer_message" | "budget" | "prompt_attack" | "ai_failed" }

/** What the model reads for one stored message: a comment says it is a comment, and under which post. */
export function messageForModel(body: string, metadata: unknown): string {
  const text = String(body ?? "").trim()
  const comment = storedInstagramComment(metadata)
  if (!comment) return text
  const caption = comment.caption?.replace(/\s+/g, " ").trim()
  const post = caption
    ? ` (текст поста: «${caption.length > CAPTION_CHARS ? `${caption.slice(0, CAPTION_CHARS)}…` : caption}»)`
    : ""
  return `[Комментарий клиента под постом Instagram${post}]\n${text}`
}

/**
 * The conversation as model turns, oldest first, ending at the customer's latest message: consecutive
 * messages of one side are joined (the generator would otherwise keep only the last), a failed send is
 * not something the customer saw, and an operator reply after the last customer message is dropped —
 * the suggestion answers the customer.
 */
export function historyForSuggestion(
  rows: Array<{ direction: string; body: string | null; status: string | null; metadata: unknown }>,
): Turn[] {
  const turns: Turn[] = []
  for (const row of rows) {
    if (row.direction === "outbound" && row.status === "failed") continue
    const role: Turn["role"] | null = row.direction === "inbound" ? "user" : row.direction === "outbound" ? "assistant" : null
    if (!role) continue
    const content = messageForModel(row.body ?? "", row.metadata)
    if (!content) continue
    const last = turns.at(-1)
    if (last?.role === role) last.content = `${last.content}\n${content}`
    else turns.push({ role, content })
  }
  while (turns.length && turns.at(-1)!.role !== "user") turns.pop()
  while (turns[0]?.role === "assistant") turns.shift()
  return turns
}

/**
 * The suggestion, or null when this conversation's platform is not one the AI reply engine answers
 * (the caller then uses the plain compose helper).
 */
export async function suggestConversationReply(input: {
  organizationId: string
  conversationId: string
  now?: Date
}): Promise<SuggestReplyOutcome | null> {
  const { organizationId, conversationId } = input
  const conversation = await prisma.socialConversation.findFirst({
    where: { id: conversationId, organizationId },
    select: { id: true, platform: true, externalId: true, contactName: true, contactId: true, channelConfigId: true },
  })
  if (!conversation) return { ok: false, error: "not_found" }
  if (!SUGGEST_REPLY_CHANNELS.has(conversation.platform)) return null

  const rows = await prisma.channelMessage.findMany({
    where: { organizationId, conversationId },
    orderBy: { createdAt: "desc" },
    take: HISTORY_ROWS,
    select: { direction: true, body: true, status: true, metadata: true },
  })
  const history = historyForSuggestion([...rows].reverse())
  const customerMessage = history.at(-1)?.content
  if (!customerMessage) return { ok: false, error: "no_customer_message" }

  const ai = await generateChannelAiReply({
    orgId: organizationId,
    channel: conversation.platform,
    externalId: conversation.externalId,
    userMessage: customerMessage,
    senderName: conversation.contactName ?? "",
    contactId: conversation.contactId,
    conversationId: conversation.id,
    channelConfigId: conversation.channelConfigId,
    reviewedByPerson: true,
    shadow: { history, asOf: input.now ?? new Date(), purpose: "assist" },
  })
  if (ai.reply) return { ok: true, suggestion: ai.reply.slice(0, 4000), unverifiedOffer: ai.unverifiedOffer === true }
  if (ai.skipped === "budget" || ai.skipped === "budget_unavailable") return { ok: false, error: "budget" }
  if (ai.skipped === "prompt_attack") return { ok: false, error: "prompt_attack" }
  return { ok: false, error: "ai_failed" }
}
