/**
 * «AI rejimi» of one conversation — the inbox panel's switch (owner, 2026-11-15, «Давай»).
 *
 * Until now AI was switched per CHANNEL (`replyMode`) and only the website chat could pause it for
 * one visitor (`WebChatSession.aiPaused`). A manager who wanted to answer one customer himself had
 * to assign the thread to a person — and even then the keyword bot, the booking bot and flow
 * replies kept writing, because they never looked at the assignee.
 *
 * Off = every automatic reply to this customer in this conversation stays silent:
 *   - AI on every channel (`maybeAiAutoReply`, flow `ai_reply`, WhatsApp Da Vinci) — they all take
 *     the shared lease `claimConversationAiReply`, which refuses an off conversation, and each
 *     re-checks right before the irreversible send (`AUTO_REPLY_ON` in their compare-and-set);
 *   - the backlog sweep (its candidate query) and the TikTok 24-hour nudge;
 *   - the keyword bot (`maybeAutoReply`), flow `send_reply` / `menu`, the WhatsApp booking bot
 *     (live and deferred), the voice-note and unsupported-media fallbacks, the WhatsApp
 *     ticket-reopen notice;
 *   - the website chat — the switch writes `WebChatSession.aiPaused` of the same visitor.
 * Not silenced, on purpose: what a person sends (an operator's reply, an approved AI draft, a
 * bulk-close farewell), reminders about the customer's own booking, campaigns and journeys.
 *
 * A new path that writes to a customer automatically must ask `autoReplyOff` (or carry
 * `AUTO_REPLY_ON` in its update) — `inbox-conversation-auto-reply-postgres.test.ts` holds the
 * shared gates on a real database.
 */

import { prisma } from "@/lib/prisma"

/** The website-chat session an inbox shell row stands for (`ensureConversation` keys it `w:<id>`,
 *  or by contact with the session id kept in metadata). */
function webChatSessionOf(row: { platform: string; externalId: string; metadata: unknown }): string | null {
  if (row.platform !== "inbox") return null
  const meta = row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
    ? row.metadata as Record<string, unknown>
    : {}
  if (typeof meta.webChatSessionId === "string" && meta.webChatSessionId) return meta.webChatSessionId
  return row.externalId.startsWith("w:") ? row.externalId.slice(2) || null : null
}

/** Spread into any `socialConversation` where-clause of an automatic writer. */
export const AUTO_REPLY_ON = { autoReplyOffAt: null } as const

export type ConversationAutoReplyState = {
  off: boolean
  offAt: string | null
  offBy: string | null
}

/**
 * True when automatic replies are switched off for this conversation. Fails CLOSED: a conversation
 * that cannot be read is not a licence to write to a customer.
 */
export async function autoReplyOff(
  organizationId: string,
  conversationId: string | null | undefined,
): Promise<boolean> {
  if (!conversationId) return false
  try {
    const row = await prisma.socialConversation.findFirst({
      where: { id: conversationId, organizationId },
      select: { autoReplyOffAt: true },
    })
    return Boolean(row?.autoReplyOffAt)
  } catch (error) {
    console.error("[auto-reply switch] read failed — staying silent:", error instanceof Error ? error.message : error)
    return true
  }
}

/**
 * Switch automatic replies of one conversation off (`on: false`) or back to the channel's own
 * setting (`on: true`). Idempotent: switching off an already-off thread keeps who did it first.
 */
export async function setConversationAutoReply(opts: {
  organizationId: string
  conversationId: string
  on: boolean
  userId: string
}): Promise<ConversationAutoReplyState | null> {
  const row = await prisma.socialConversation.findFirst({
    where: { id: opts.conversationId, organizationId: opts.organizationId },
    select: { id: true, platform: true, externalId: true, metadata: true, autoReplyOffAt: true, autoReplyOffBy: true },
  })
  if (!row) return null

  let offAt = row.autoReplyOffAt
  let offBy = row.autoReplyOffBy
  if (opts.on) {
    await prisma.socialConversation.updateMany({
      where: { id: row.id, organizationId: opts.organizationId },
      data: { autoReplyOffAt: null, autoReplyOffBy: null },
    })
    offAt = null
    offBy = null
  } else if (!row.autoReplyOffAt) {
    const now = new Date()
    // Conditional: two managers pressing at once leave the first one's name.
    await prisma.socialConversation.updateMany({
      where: { id: row.id, organizationId: opts.organizationId, autoReplyOffAt: null },
      data: { autoReplyOffAt: now, autoReplyOffBy: opts.userId },
    })
    const after = await prisma.socialConversation.findFirst({
      where: { id: row.id, organizationId: opts.organizationId },
      select: { autoReplyOffAt: true, autoReplyOffBy: true },
    })
    offAt = after?.autoReplyOffAt ?? now
    offBy = after?.autoReplyOffBy ?? opts.userId
  }

  // The website chat answers from its own session row, which the inbox shell only mirrors.
  // Back on = paused only while a person holds the chat, as the assign route does.
  const sessionId = webChatSessionOf(row)
  if (sessionId) {
    const session = await prisma.webChatSession.findFirst({
      where: { id: sessionId, organizationId: opts.organizationId },
      select: { id: true, assignedUserId: true },
    })
    if (session) {
      await prisma.webChatSession.updateMany({
        where: { id: session.id, organizationId: opts.organizationId },
        data: { aiPaused: opts.on ? session.assignedUserId !== null : true },
      })
    }
  }

  return {
    off: offAt !== null,
    offAt: offAt ? offAt.toISOString() : null,
    offBy,
  }
}
