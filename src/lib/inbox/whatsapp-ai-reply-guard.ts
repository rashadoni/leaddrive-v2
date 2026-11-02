import { prisma } from "@/lib/prisma"
import { checkAiBudget } from "@/lib/ai/budget"
import { claimConversationAiReply, releaseConversationAiReplyClaim } from "@/lib/social/ai-autoreply"

const OPERATION_LEASE_MS = 150_000

/** Native WhatsApp support AI uses the same human handoff and owned lease as
 * inbox AI/flows. Missing state or a failed budget read must not authorize spend. */
export async function withWhatsAppAiReplyGuard(
  organizationId: string,
  conversationId: string | null | undefined,
  operation: (stillOwned: () => Promise<boolean>) => Promise<void>,
): Promise<void> {
  if (!conversationId) return
  const owner = await prisma.socialConversation.findFirst({
    where: { id: conversationId, organizationId },
    select: { assignedTo: true, status: true },
  })
  if (!owner || owner.assignedTo || owner.status !== "open") return
  const claim = await claimConversationAiReply({ organizationId, conversationId, holdMs: OPERATION_LEASE_MS })
  if (!claim.claimed) return
  try {
    const budget = await checkAiBudget(organizationId).catch(() => null)
    if (!budget?.allowed) return
    const stillOwned = async () => {
      // CAS also rechecks human ownership and protects against an expired owner
      // sending after a newer flow/webhook has reclaimed this conversation.
      const renewed = await prisma.socialConversation.updateMany({
        where: { id: conversationId, organizationId, assignedTo: null, status: "open", aiReplyClaimToken: claim.token },
        data: { aiReplyClaimedUntil: new Date(Date.now() + OPERATION_LEASE_MS) },
      })
      return renewed.count === 1
    }
    if (await stillOwned()) await operation(stillOwned)
  } finally {
    await releaseConversationAiReplyClaim({ organizationId, conversationId, token: claim.token })
  }
}

/** Rows arrive newest first. Keep the latest same-role turn, including the
 * current inbound, when a previous generation failed without an assistant turn. */
export function whatsappAiHistory(rows: Array<{ role: string; content: string }>, currentMessage: string) {
  const messages: Array<{ role: "user" | "assistant"; content: string }> = []
  for (const row of [...rows].reverse()) {
    if (row.role !== "user" && row.role !== "assistant") continue
    const message = { role: row.role, content: row.content } as { role: "user" | "assistant"; content: string }
    if (messages.at(-1)?.role === row.role) messages[messages.length - 1] = message
    else messages.push(message)
  }
  while (messages[0]?.role === "assistant") messages.shift()
  if (messages.at(-1)?.role === "user") messages[messages.length - 1] = { role: "user", content: currentMessage }
  else messages.push({ role: "user", content: currentMessage })
  return messages
}
