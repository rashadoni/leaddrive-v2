import type { Prisma } from "@prisma/client"
import { logAudit, prisma } from "@/lib/prisma"
import { runWithTenant } from "@/lib/rls-context"
import { createTicketWithAssignment } from "@/lib/ticket-factory"
import { reopenTicketForCustomerReply } from "@/lib/ticket-reopen"
import { sanitizeLog } from "@/lib/sanitize"
import { INBOUND_MESSAGE_MARKER, WHATSAPP_INBOUND_DESCRIPTION_HEAD } from "@/lib/ticketing/chat-transcript"
import { loadOrganizationLocale } from "@/lib/ticketing/customer-locale"
import { whatsappTicketSubject } from "@/lib/ticketing/customer-ticket-text"

export type InboundTicketResult = {
  ticketId: string | null
  ticketNumber: string | null
  created: boolean
  commentAdded: boolean
  /** The message reopened a resolved or closed ticket of the sender's. */
  reopened: boolean
}

/**
 * A ticket still being worked — the set the queue's take-next and the reports
 * count as active. `waiting` is the team waiting for the customer: the reply it
 * waits for belongs on it.
 */
const ACTIVE_TICKET_STATUSES = ["new", "open", "in_progress", "waiting", "escalated"] as const

const NO_TICKET: InboundTicketResult = { ticketId: null, ticketNumber: null, created: false, commentAdded: false, reopened: false }

/**
 * Every inbound WhatsApp text lands on exactly one ticket of its sender's:
 *
 *  1. the sender's ticket that is still being worked — the message is added to
 *     it, and one `waiting` for the customer goes back to `open`: the reply it
 *     waited for has come;
 *  2. otherwise, with `reopenResolved`, the sender's latest resolved or closed
 *     WhatsApp ticket is reopened (`reopenTicketForCustomerReply`);
 *  3. otherwise a new WA- ticket.
 *
 * Until 2026-10-18 step 2 ran first, in the webhook: a customer with an old
 * resolved ticket had it reopened while another of theirs was open, and every
 * following message reopened the next older one. Step 1 skipped `waiting` and
 * `escalated`, so the reply to a ticket waiting for it opened a second ticket.
 *
 * The three steps run under one lock per organization and phone. WhatsApp
 * delivers a burst of messages as concurrent webhook calls, and two calls that
 * both found nothing used to open two tickets.
 *
 * The subject is in the organization's language — its team reads it in the
 * queue, and the portal shows the customer the message without the prefix.
 * The description and the comment keep the stored format of
 * `@/lib/ticketing/chat-transcript` (the agent page and the status
 * notification read it back).
 */
export async function ensureInboundWhatsAppTicket(input: {
  organizationId: string
  waPhone: string
  senderName: string
  messageText: string
  contactId: string | null
  leadId: string | null
  companyId: string | null
  channelMessageId: string
  waMessageId?: string
  /** Step 2. The webhook reopens only for a typed text, not for a caption or a button reply. */
  reopenResolved?: boolean
}): Promise<InboundTicketResult> {
  try {
    return await withSenderLock(input.organizationId, input.waPhone, () => placeInboundMessage(input))
  } catch (err) {
    console.error("[WA Webhook] Failed to ensure inbound WhatsApp ticket:", err)
    return NO_TICKET
  }
}

async function withSenderLock<T>(organizationId: string, waPhone: string, work: () => Promise<T>) {
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`whatsapp-inbound-ticket:${organizationId}:${waPhone}`}, 0))`
    // The transaction owns only the lock, held by its connection until commit.
    // Inside it the RLS context is marked in-transaction, which would send the
    // global Prisma calls below out with no tenant at all; runWithTenant gives
    // each of them the tenant on the connection it actually uses.
    return runWithTenant(organizationId, work)
  }, { maxWait: 10_000, timeout: 60_000 })
}

async function placeInboundMessage({
  organizationId,
  waPhone,
  senderName,
  messageText,
  contactId,
  leadId,
  companyId,
  channelMessageId,
  waMessageId,
  reopenResolved,
}: Parameters<typeof ensureInboundWhatsAppTicket>[0]): Promise<InboundTicketResult> {
  const comment = `[Клиент (WhatsApp)] ${messageText.trim()}`

  const activeTicket = await prisma.ticket.findFirst({
    where: {
      organizationId,
      tags: { has: "whatsapp" },
      sourceMeta: { path: ["phone"], equals: waPhone },
      status: { in: [...ACTIVE_TICKET_STATUSES] },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, ticketNumber: true, subject: true, status: true },
  })

  if (activeTicket) {
    await prisma.ticketComment.create({
      data: { ticketId: activeTicket.id, comment, isInternal: false },
    })
    if (activeTicket.status === "waiting") {
      const answered = await prisma.ticket.updateMany({
        where: { id: activeTicket.id, organizationId, status: "waiting" },
        data: { status: "open" },
      })
      if (answered.count > 0) {
        await logAudit(organizationId, "update", "ticket", activeTicket.id, activeTicket.subject, {
          oldValue: { status: "waiting" },
          newValue: { status: "open", via: "whatsapp", reason: "customer_reply" },
        })
      }
    }
    return { ticketId: activeTicket.id, ticketNumber: activeTicket.ticketNumber, created: false, commentAdded: true, reopened: false }
  }

  if (reopenResolved) {
    const reopen = await reopenTicketForCustomerReply({
      organizationId,
      channel: "whatsapp",
      customerMessage: messageText,
      contactId,
      fallbackPhone: waPhone,
    })
    if (reopen.reopened && reopen.ticketId) {
      return { ticketId: reopen.ticketId, ticketNumber: reopen.ticketNumber ?? null, created: false, commentAdded: true, reopened: true }
    }
  }

  const ticket = await createTicketWithAssignment({
    organizationId,
    ticketNumberPrefix: "WA",
    subject: whatsappTicketSubject(await loadOrganizationLocale(organizationId), "general", messageText),
    description: `${WHATSAPP_INBOUND_DESCRIPTION_HEAD}\nКлиент: ${senderName} (+${waPhone})\n\n${INBOUND_MESSAGE_MARKER}\n${messageText.trim()}`,
    priority: "medium",
    initialStatus: "open",
    category: "general",
    contactId,
    companyId,
    leadId,
    tags: ["whatsapp", "inbound_whatsapp", "auto_created"],
    source: "whatsapp",
    sourceMeta: {
      phone: waPhone,
      channelMessageId,
      waMessageId: waMessageId || null,
      reasons: ["inbound_message"],
    },
    requesterName: senderName,
    requesterPhone: `+${waPhone}`,
    requesterExternalId: contactId || waPhone,
    requesterMeta: { source: "whatsapp", channelMessageId, waMessageId: waMessageId || null },
  })

  await prisma.ticketComment.create({
    data: { ticketId: ticket.id, comment, isInternal: false },
  })

  console.log(`[WA Webhook] Ticket ${ticket.ticketNumber} created from inbound WhatsApp message ${sanitizeLog(waPhone)}`)
  return { ticketId: ticket.id, ticketNumber: ticket.ticketNumber, created: true, commentAdded: true, reopened: false }
}
