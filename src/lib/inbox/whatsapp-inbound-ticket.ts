import { prisma } from "@/lib/prisma"
import { createTicketWithAssignment } from "@/lib/ticket-factory"
import { sanitizeLog } from "@/lib/sanitize"
import { INBOUND_MESSAGE_MARKER, WHATSAPP_INBOUND_DESCRIPTION_HEAD } from "@/lib/ticketing/chat-transcript"
import { loadOrganizationLocale } from "@/lib/ticketing/customer-locale"
import { whatsappTicketSubject } from "@/lib/ticketing/customer-ticket-text"

export type InboundTicketResult = { ticketId: string | null; ticketNumber: string | null; created: boolean; commentAdded: boolean }

/**
 * Every inbound WhatsApp text lands on a ticket: appended to the sender's open
 * one, or opening a new one. Called by the WhatsApp webhook inside the
 * organization's tenant scope.
 *
 * The subject is in the organization's language — its team reads it in the
 * queue, and the portal shows the customer the message without the prefix.
 * The description and the comment keep the stored format of
 * `@/lib/ticketing/chat-transcript` (the agent page and the status
 * notification read it back).
 */
export async function ensureInboundWhatsAppTicket({
  organizationId,
  waPhone,
  senderName,
  messageText,
  contactId,
  leadId,
  companyId,
  channelMessageId,
  waMessageId,
}: {
  organizationId: string
  waPhone: string
  senderName: string
  messageText: string
  contactId: string | null
  leadId: string | null
  companyId: string | null
  channelMessageId: string
  waMessageId?: string
}): Promise<InboundTicketResult> {
  try {
    const existingTicket = await prisma.ticket.findFirst({
      where: {
        organizationId,
        tags: { has: "whatsapp" },
        sourceMeta: { path: ["phone"], equals: waPhone },
        status: { in: ["new", "open", "in_progress"] },
      },
      orderBy: { createdAt: "desc" },
      select: { id: true, ticketNumber: true },
    })

    if (existingTicket) {
      await prisma.ticketComment.create({
        data: {
          ticketId: existingTicket.id,
          comment: `[Клиент (WhatsApp)] ${messageText.trim()}`,
          isInternal: false,
        },
      })
      return { ticketId: existingTicket.id, ticketNumber: existingTicket.ticketNumber, created: false, commentAdded: true }
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
      data: {
        ticketId: ticket.id,
        comment: `[Клиент (WhatsApp)] ${messageText.trim()}`,
        isInternal: false,
      },
    })

    console.log(`[WA Webhook] Ticket ${ticket.ticketNumber} created from inbound WhatsApp message ${sanitizeLog(waPhone)}`)
    return { ticketId: ticket.id, ticketNumber: ticket.ticketNumber, created: true, commentAdded: true }
  } catch (err) {
    console.error("[WA Webhook] Failed to ensure inbound WhatsApp ticket:", err)
    return { ticketId: null, ticketNumber: null, created: false, commentAdded: false }
  }
}
