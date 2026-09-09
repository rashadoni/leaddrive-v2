import { prisma } from "@/lib/prisma"
import { createTicketWithAssignment, fireTicketHooks } from "@/lib/ticket-factory"
import { matchOrCreateWebChatContact } from "@/lib/web-chat-contact"

interface EscalateResult {
  ticketId: string
  ticketNumber: string
  alreadyEscalated: boolean
}

/**
 * Escalate a web chat session to a Ticket.
 * Idempotent: if the session already has ticketId, returns the existing ticket.
 * Race-safe: uses conditional updateMany to ensure only one ticket is attached.
 * Goes through createTicketWithAssignment → SLA resolution + auto-assign + notifications.
 */
export async function escalateWebChatToTicket(
  sessionId: string,
  actingUserId?: string | null,
): Promise<EscalateResult | null> {
  const chat = await prisma.webChatSession.findUnique({
    where: { id: sessionId },
    include: { messages: { orderBy: { createdAt: "asc" } } },
  })
  if (!chat) return null

  if (chat.ticketId) {
    const existing = await prisma.ticket.findUnique({
      where: { id: chat.ticketId },
      select: { id: true, ticketNumber: true },
    })
    if (existing) {
      return { ticketId: existing.id, ticketNumber: existing.ticketNumber, alreadyEscalated: true }
    }
  }

  type M = { fromRole: string; text: string; createdAt: Date }
  const firstVisitor = chat.messages.find((m: M) => m.fromRole === "visitor")
  const rawSubject = firstVisitor?.text.split(/\r?\n/)[0] || "Web chat escalation"
  const subject = rawSubject.length > 100 ? rawSubject.slice(0, 97) + "…" : rawSubject

  const transcript = chat.messages
    .map((m: M) => `[${new Date(m.createdAt).toISOString()}] ${m.fromRole}: ${m.text}`)
    .join("\n")
  const description = [
    chat.visitorName ? `Visitor: ${chat.visitorName}` : null,
    chat.visitorEmail ? `Email: ${chat.visitorEmail}` : null,
    chat.visitorPhone ? `Phone: ${chat.visitorPhone}` : null,
    chat.pageUrl ? `Page: ${chat.pageUrl}` : null,
    "",
    "Transcript:",
    transcript,
  ]
    .filter(Boolean)
    .join("\n")

  // Prefer the contactId already linked at session creation. Fall back to email lookup.
  let contactId: string | null = chat.contactId ?? null
  let companyId: string | null = null
  if (contactId) {
    const linked = await prisma.contact.findUnique({
      where: { id: contactId },
      select: { companyId: true },
    })
    companyId = linked?.companyId ?? null
  } else if (chat.visitorEmail || chat.visitorPhone) {
    // Shared matcher (email first, then phone, else create with source
    // "web_chat") — the same policy session-start linking uses, so escalation
    // and session creation can never produce diverging duplicates.
    const matched = await matchOrCreateWebChatContact(chat.organizationId, {
      name: chat.visitorName,
      email: chat.visitorEmail,
      phone: chat.visitorPhone,
    })
    if (matched) {
      contactId = matched.contactId
      companyId = matched.companyId
    }
  }

  // Create ticket silently (no hooks fired yet). If the race is lost below,
  // we delete this ticket before any notifications/webhooks run.
  const ticket = await createTicketWithAssignment({
    organizationId: chat.organizationId,
    subject,
    description,
    priority: "medium",
    category: "general",
    contactId,
    companyId,
    createdBy: actingUserId || null,
    tags: ["web-chat"],
    source: "web_chat",
    sourceMeta: { sessionId: chat.id },
    fireHooks: false,
  })

  // Atomic claim: attach the ticket only if no one else already did.
  const claim = await prisma.webChatSession.updateMany({
    where: { id: chat.id, ticketId: null },
    data: { ticketId: ticket.id, status: "escalated" },
  })
  if (claim.count === 0) {
    // Lost the race — silently drop our ticket (no hooks fired), return the winner's.
    await prisma.ticket.delete({ where: { id: ticket.id } }).catch(() => {})
    const winner = await prisma.webChatSession.findUnique({
      where: { id: chat.id },
      select: { ticketId: true },
    })
    if (winner?.ticketId) {
      const t = await prisma.ticket.findUnique({
        where: { id: winner.ticketId },
        select: { id: true, ticketNumber: true },
      })
      if (t) return { ticketId: t.id, ticketNumber: t.ticketNumber, alreadyEscalated: true }
    }
    return null
  }

  // Claim won — now fire audit/workflow/webhook/notification hooks.
  await fireTicketHooks(ticket.id)

  await prisma.webChatMessage.create({
    data: {
      organizationId: chat.organizationId,
      sessionId: chat.id,
      fromRole: "bot",
      text: `Your chat has been escalated to ticket ${ticket.ticketNumber}. An agent will contact you shortly.`,
    },
  })

  return { ticketId: ticket.id, ticketNumber: ticket.ticketNumber, alreadyEscalated: false }
}
