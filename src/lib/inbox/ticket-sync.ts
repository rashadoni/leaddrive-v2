import { prisma } from "@/lib/prisma"

/**
 * Keep an OPEN WhatsApp ticket's thread in sync with the ongoing conversation.
 *
 * When WhatsApp Da Vinci escalates, it creates a support ticket and SNAPSHOTS the chat-so-far
 * into ticket_comments. But messages that arrive AFTER creation were never appended → the agent
 * working the ticket saw a stale snapshot. This appends a later exchange (customer message + bot
 * reply) to a ticket that ALREADY existed before this turn.
 *
 * `before` MUST be a timestamp captured at the START of handling the current message, and we only
 * append to tickets with `createdAt < before` — so a ticket that was *just created this turn*
 * (whose snapshot already contains this exchange) is excluded and never double-counted.
 *
 * Matches the duplicate-guard's lookup (tags has "whatsapp" + sourceMeta.phone + open status).
 * Best-effort: a sync failure must never break the webhook 200 or the reply.
 */
export async function syncWhatsAppExchangeToTicket(opts: {
  orgId: string
  phone: string
  before: Date
  customerMessage?: string | null
  botReply?: string | null
}): Promise<{ appended: boolean }> {
  try {
    const ticket = await prisma.ticket.findFirst({
      where: {
        organizationId: opts.orgId,
        tags: { has: "whatsapp" },
        sourceMeta: { path: ["phone"], equals: opts.phone },
        status: { in: ["open", "in_progress"] },
        createdAt: { lt: opts.before },
      },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    })
    if (!ticket) return { appended: false }

    // Created SEQUENTIALLY (not createMany) so the two rows get distinct createdAt — the ticket
    // thread sorts by createdAt asc, so the customer message must land strictly before the bot
    // reply. createMany would give both the same now() → non-deterministic render order.
    let appended = false
    if (opts.customerMessage?.trim()) {
      await prisma.ticketComment.create({
        data: { ticketId: ticket.id, comment: `[Клиент (WhatsApp)] ${opts.customerMessage.trim()}`, isInternal: false },
      })
      appended = true
    }
    if (opts.botReply?.trim()) {
      await prisma.ticketComment.create({
        data: { ticketId: ticket.id, comment: `[Da Vinci Bot] ${opts.botReply.trim()}`, isInternal: false },
      })
      appended = true
    }
    return { appended }
  } catch (e) {
    console.error("[ticket-sync] append to open ticket failed", e)
    return { appended: false }
  }
}
