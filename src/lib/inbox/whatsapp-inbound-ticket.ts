import { logAudit, prisma } from "@/lib/prisma"
import { lockTurns, withAdvisoryLock } from "@/lib/lock-turns"
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
  /** The ticket the demo holds is gone (deleted): nothing was filed, and the demo opens the next one itself. */
  missing?: boolean
}

/** What marks the ticket a demo opened in its sales organisation. */
export const DEMO_WHATSAPP_TICKET_TAGS = ["demo", "demo_whatsapp"] as const

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
 * The three steps run for one sender (organization + phone) at a time — in
 * this process, then under an advisory lock across processes. WhatsApp
 * delivers a burst of messages as concurrent webhook calls, and two calls that
 * both found nothing used to open two tickets.
 *
 * The subject is in the organization's language — its team reads it in the
 * queue, and the portal shows the customer the message without the prefix.
 * The description and the comment keep the stored format of
 * `@/lib/ticketing/chat-transcript` (the agent page and the status
 * notification read it back).
 *
 * `demo` is the guided demo's own ticket (src/lib/demo-center/
 * demo-whatsapp-agent.ts), opened only after the prospect pressed for it, in
 * the same turn and lock: it is found by the id the demo's thread keeps —
 * never by the phone, which may have tickets of its own — and created with
 * the demo's mark (see `placeDemoMessage`). Without `demo` nothing changes.
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
  /** The guided demo's own ticket: its grant, and the ticket its thread holds (null before the first). */
  demo?: { grantId: string; ticketId: string | null }
}): Promise<InboundTicketResult> {
  const key = whatsappIntakeLockKey(input.organizationId, input.waPhone)
  try {
    return await intakeTurns.run(key, () => withAdvisoryLock(input.organizationId, key, () => placeInboundMessage(input), {
      maxWait: 10_000,
      timeout: 60_000,
    }))
  } catch (err) {
    console.error("[WA Webhook] Failed to ensure inbound WhatsApp ticket:", err)
    return NO_TICKET
  }
}

/** The advisory lock every process takes for one sender of one organization. */
export function whatsappIntakeLockKey(organizationId: string, waPhone: string): string {
  return `whatsapp-inbound-ticket:${organizationId}:${waPhone}`
}

/**
 * Deliveries from one sender take their turn in this process before the lock,
 * and at most two hold a lock transaction at once (`@/lib/lock-turns`):
 * without that, eight messages from one phone took all five connections of the
 * CI pool waiting for the lock, and the intake holding it could not get one more.
 */
const intakeTurns = lockTurns("whatsapp-inbound-ticket", 2)

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
  demo,
}: Parameters<typeof ensureInboundWhatsAppTicket>[0]): Promise<InboundTicketResult> {
  if (demo) {
    return placeDemoMessage({ organizationId, waPhone, senderName, messageText, contactId, leadId, companyId, channelMessageId, waMessageId }, demo)
  }
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

/**
 * The guided demo's own ticket. The one it holds, by its id: a message is added
 * (one `waiting` goes back to `open`, as above), a resolved or closed one is
 * reopened through the product's reopen — which also cancels its pending
 * closure link — and a ticket that is gone is reported `missing`, so the demo
 * lets one message open the replacement. Without one, a new WA- ticket with
 * the demo's mark; if a later step fails, its id still comes back — the
 * ticket exists and its description holds the message.
 */
async function placeDemoMessage(
  input: Omit<Parameters<typeof ensureInboundWhatsAppTicket>[0], "demo" | "reopenResolved">,
  demo: { grantId: string; ticketId: string | null },
): Promise<InboundTicketResult> {
  const { organizationId, waPhone, senderName, messageText, contactId, leadId, companyId, channelMessageId, waMessageId } = input
  const comment = `[Клиент (WhatsApp)] ${messageText.trim()}`

  if (demo.ticketId) {
    const own = await prisma.ticket.findFirst({
      where: { id: demo.ticketId, organizationId },
      select: { id: true, ticketNumber: true, subject: true, status: true },
    })
    if (!own) return { ...NO_TICKET, missing: true }
    const held = { ticketId: own.id, ticketNumber: own.ticketNumber, created: false, commentAdded: true }
    if (own.status === "resolved" || own.status === "closed") {
      const reopened = await reopenTicketForCustomerReply({ organizationId, channel: "whatsapp", customerMessage: messageText.trim(), ticketId: own.id })
      if (reopened.reopened) return { ...held, reopened: true }
      // Another message reopened it a moment ago: the helper already stored this one.
      if (reopened.commentAdded) return { ...held, reopened: false }
    }
    await prisma.ticketComment.create({ data: { ticketId: own.id, comment, isInternal: false } })
    if (own.status === "waiting") {
      const answered = await prisma.ticket.updateMany({ where: { id: own.id, organizationId, status: "waiting" }, data: { status: "open" } })
      if (answered.count > 0) {
        await logAudit(organizationId, "update", "ticket", own.id, own.subject, {
          oldValue: { status: "waiting" },
          newValue: { status: "open", via: "whatsapp", reason: "customer_reply" },
        })
      }
    }
    return { ...held, reopened: false }
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
    tags: ["whatsapp", "inbound_whatsapp", "auto_created", ...DEMO_WHATSAPP_TICKET_TAGS],
    source: "whatsapp",
    sourceMeta: {
      phone: waPhone,
      channelMessageId,
      waMessageId: waMessageId || null,
      reasons: ["inbound_message", "demo_whatsapp"],
      demoGrantId: demo.grantId,
    },
    requesterName: senderName,
    requesterPhone: `+${waPhone}`,
    requesterExternalId: contactId || waPhone,
    requesterMeta: { source: "whatsapp", channelMessageId, waMessageId: waMessageId || null },
  })
  try {
    await prisma.ticketComment.create({ data: { ticketId: ticket.id, comment, isInternal: false } })
  } catch (err) {
    console.error("[WA Webhook] Demo ticket created, its first comment not stored:", err)
    return { ticketId: ticket.id, ticketNumber: ticket.ticketNumber, created: true, commentAdded: false, reopened: false }
  }
  console.log(`[WA Webhook] Demo ticket ${ticket.ticketNumber} created from inbound WhatsApp message ${sanitizeLog(waPhone)}`)
  return { ticketId: ticket.id, ticketNumber: ticket.ticketNumber, created: true, commentAdded: true, reopened: false }
}
