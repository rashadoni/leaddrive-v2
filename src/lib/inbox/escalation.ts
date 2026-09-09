import { prisma } from "@/lib/prisma"
import { createNotification } from "@/lib/notifications"

/**
 * Keyword auto-escalation for the omnichannel inbox. When a customer's inbound message
 * contains one of the channel's `escalateKeywords` (configured in the channel-reply settings,
 * e.g. "жалоба", "менеджер", "manager"), the conversation is handed to a human: the AI is NOT
 * allowed to auto-answer it, and the inbox team (admin/manager/support) is notified. Works in
 * BOTH "ai" and "agent" reply modes — the gate lives in the webhook, ahead of the reply branch.
 */

/**
 * Returns the first escalate keyword found in `text` (case-insensitive substring match), or
 * null. Substring (not word-boundary) is deliberate: keywords are short intent phrases and we
 * want "жалобу"/"complaints" to match "жалоб"/"complaint" without per-language stemming.
 */
export function matchEscalationKeyword(
  text: string | null | undefined,
  keywords: string[] | null | undefined,
): string | null {
  if (!text || !Array.isArray(keywords) || keywords.length === 0) return null
  const hay = text.toLowerCase()
  for (const kw of keywords) {
    const needle = typeof kw === "string" ? kw.trim().toLowerCase() : ""
    if (needle && hay.includes(needle)) return kw
  }
  return null
}

/**
 * Notify the inbox team (admin/manager/support) that a conversation hit an escalate keyword and
 * needs a human. Best-effort — a notification failure must never block the webhook's 200.
 */
export async function notifyEscalationTeam(opts: {
  orgId: string
  conversationId: string
  platform: string
  keyword: string
  contactName: string
}): Promise<void> {
  try {
    const team = await prisma.user.findMany({
      where: { organizationId: opts.orgId, role: { in: ["admin", "manager", "support"] }, isActive: true },
      select: { id: true },
    })
    await Promise.all(
      team.map((u: { id: string }) =>
        createNotification({
          organizationId: opts.orgId,
          userId: u.id,
          type: "warning",
          title: "Диалог требует оператора",
          message: `Клиент ${opts.contactName} написал ключевое слово «${opts.keyword}» (${opts.platform}) — нужен ответ человека`,
          entityType: "inbox_message",
          entityId: opts.conversationId,
          kind: "inbox.message",
          push: true,
        }).catch(() => {}),
      ),
    )
  } catch {
    /* notification failure must never block the webhook 200 */
  }
}
