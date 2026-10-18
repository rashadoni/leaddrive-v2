import { prisma } from "@/lib/prisma"
import { createTicketWithAssignment } from "@/lib/ticket-factory"
import { sanitizeLog } from "@/lib/sanitize"
import { INBOUND_MESSAGE_MARKER, WHATSAPP_INBOUND_DESCRIPTION_HEAD } from "@/lib/ticketing/chat-transcript"
import { loadOrganizationLocale } from "@/lib/ticketing/customer-locale"
import { whatsappTicketSubject } from "@/lib/ticketing/customer-ticket-text"
import { cancelPendingTicketClosureRequests } from "@/lib/ticketing/closure-requests"
import { reopenTicketForCustomerReply } from "@/lib/ticket-reopen"

export type InboundTicketResult = {
  ticketId: string | null
  ticketNumber: string | null
  created: boolean
  commentAdded: boolean
  /** The demo's resolved or closed ticket was reopened by this message (see `demo`). */
  reopened?: boolean
  /** The ticket the demo holds is gone (deleted): nothing was filed, and the demo opens the next one itself. */
  missing?: boolean
}

/** What marks the ticket a demo opened in its sales organisation. */
export const DEMO_WHATSAPP_TICKET_TAGS = ["demo", "demo_whatsapp"] as const

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
 *
 * `demo` is the guided demo's own ticket (src/lib/demo-center/
 * demo-whatsapp-agent.ts), opened only after the prospect pressed for it: it
 * is found by the id the demo's thread keeps — never by the phone, which may
 * have older tickets of its own — reopened when it was resolved or closed
 * (and its closure link cancelled), and created with the demo's mark. A held
 * ticket that is gone is reported `missing` rather than replaced here: the
 * demo lets one message open the replacement. Without `demo` nothing changes.
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
  demo,
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
  demo?: { grantId: string; ticketId: string | null }
}): Promise<InboundTicketResult> {
  // A demo ticket committed before a later step failed: the demo must still keep its id.
  let createdForDemo: { id: string; ticketNumber: string } | null = null
  try {
    if (demo?.ticketId) {
      const own = await prisma.ticket.findFirst({
        where: { id: demo.ticketId, organizationId },
        select: { id: true, ticketNumber: true, status: true },
      })
      if (own && (own.status === "resolved" || own.status === "closed")) {
        const reopened = await reopenTicketForCustomerReply({
          organizationId,
          channel: "whatsapp",
          customerMessage: messageText.trim(),
          ticketId: own.id,
        })
        if (reopened.reopened) {
          // The link sent with «resolved» must not close the reopened ticket.
          await cancelPendingTicketClosureRequests(organizationId, own.id).catch(() => 0)
          return { ticketId: own.id, ticketNumber: own.ticketNumber, created: false, commentAdded: true, reopened: true }
        }
        // Another message reopened it a moment ago: the helper already stored this one.
        if (reopened.commentAdded) {
          return { ticketId: own.id, ticketNumber: own.ticketNumber, created: false, commentAdded: true }
        }
      }
      if (own) {
        await prisma.ticketComment.create({
          data: { ticketId: own.id, comment: `[Клиент (WhatsApp)] ${messageText.trim()}`, isInternal: false },
        })
        return { ticketId: own.id, ticketNumber: own.ticketNumber, created: false, commentAdded: true }
      }
      return { ticketId: null, ticketNumber: null, created: false, commentAdded: false, missing: true }
    }

    const existingTicket = demo ? null : await prisma.ticket.findFirst({
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
      tags: ["whatsapp", "inbound_whatsapp", "auto_created", ...(demo ? DEMO_WHATSAPP_TICKET_TAGS : [])],
      source: "whatsapp",
      sourceMeta: {
        phone: waPhone,
        channelMessageId,
        waMessageId: waMessageId || null,
        reasons: demo ? ["inbound_message", "demo_whatsapp"] : ["inbound_message"],
        ...(demo ? { demoGrantId: demo.grantId } : {}),
      },
      requesterName: senderName,
      requesterPhone: `+${waPhone}`,
      requesterExternalId: contactId || waPhone,
      requesterMeta: { source: "whatsapp", channelMessageId, waMessageId: waMessageId || null },
    })
    if (demo) createdForDemo = { id: ticket.id, ticketNumber: ticket.ticketNumber }

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
    // The ticket exists and its description holds the message.
    if (createdForDemo) return { ticketId: createdForDemo.id, ticketNumber: createdForDemo.ticketNumber, created: true, commentAdded: false }
    return { ticketId: null, ticketNumber: null, created: false, commentAdded: false }
  }
}
