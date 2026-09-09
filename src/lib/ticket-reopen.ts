import { prisma, logAudit } from "@/lib/prisma"
import { executeWorkflows } from "@/lib/workflow-engine"
import { fireWebhooks } from "@/lib/webhooks"
import { resolveTicketSla } from "@/lib/sla-resolver"

export type ReopenChannel =
  | "whatsapp"
  | "telegram"
  | "facebook"
  | "instagram"
  | "vkontakte"
  | "sms"
  | "email"
  | "webchat"

export interface ReopenInput {
  organizationId: string
  channel: ReopenChannel
  customerMessage: string
  /** Override the auto-formatted "[Клиент (Channel)] ..." comment body.
   *  Email-inbound uses this to keep the legacy "📧 ..." prefix that the
   *  ticket detail UI relies on to render the "via email" badge. */
  commentOverride?: string
  ticketId?: string
  contactId?: string | null
  fallbackPhone?: string
  fallbackEmail?: string
}

export type ReopenReason =
  | "no_contact"
  | "no_resolved_ticket"
  | "ticket_already_open"
  | "ticket_not_found"
  | "error"

export interface ReopenResult {
  reopened: boolean
  ticketId?: string
  ticketNumber?: string
  ticketSubject?: string
  contactId?: string | null
  reason?: ReopenReason
  commentAdded?: boolean
}

const CHANNEL_LABELS: Record<ReopenChannel, string> = {
  whatsapp: "WhatsApp",
  telegram: "Telegram",
  facebook: "Facebook",
  instagram: "Instagram",
  vkontakte: "VKontakte",
  sms: "SMS",
  email: "Email",
  webchat: "Web Chat",
}

const RESOLVED_STATUSES = ["resolved", "closed"] as const

function phoneVariants(raw: string): string[] {
  const trimmed = raw.trim().replace(/[\s\-()]/g, "")
  if (!trimmed) return []
  const variants = new Set<string>()
  variants.add(trimmed)
  if (!trimmed.startsWith("+")) variants.add("+" + trimmed)
  if (trimmed.startsWith("00")) variants.add("+" + trimmed.slice(2))
  if (trimmed.startsWith("+")) variants.add(trimmed.slice(1))
  return Array.from(variants)
}

async function resolveContactId(
  orgId: string,
  contactId: string | null | undefined,
  fallbackPhone?: string,
  fallbackEmail?: string,
): Promise<string | null> {
  if (contactId) return contactId

  if (fallbackPhone) {
    const variants = phoneVariants(fallbackPhone)
    if (variants.length) {
      // Strip formatting the same way phoneVariants does, then take last 9 digits —
      // deterministic regardless of whether the number starts with '+' or not.
      const last9 = fallbackPhone.trim().replace(/[\s\-()]/g, "").slice(-9)
      const c = await prisma.contact.findFirst({
        where: {
          organizationId: orgId,
          OR: [
            { phone: { in: variants } },
            ...(last9.length === 9 ? [{ phone: { contains: last9 } }] : []),
          ],
        },
        select: { id: true },
      })
      if (c) return c.id
    }
  }

  if (fallbackEmail) {
    const c = await prisma.contact.findFirst({
      where: { organizationId: orgId, email: fallbackEmail.trim().toLowerCase() },
      select: { id: true },
    })
    if (c) return c.id
  }

  return null
}

/**
 * Reopen a ticket when a customer sends an inbound message on a resolved/closed
 * conversation. Mirrors email-inbound semantics: reopen, append the customer's
 * message as a comment, log audit, fire workflows + webhook.
 *
 * Caller passes either `ticketId` (deterministic — used by email-inbound and
 * web-chat which already know the ticket) or `contactId`/`fallbackPhone`
 * (channel webhooks where we resolve the ticket via contact + channel match).
 *
 * Always succeeds without throwing — returns `{ reopened: false, reason }` on
 * misses so the caller can decide whether to fall back to creating a new
 * ticket.
 */
export async function reopenTicketForCustomerReply(input: ReopenInput): Promise<ReopenResult> {
  try {
    const { organizationId: orgId, channel, customerMessage } = input

    let ticket: {
      id: string
      ticketNumber: string
      subject: string
      status: string
      contactId: string | null
      source: string | null
      companyId: string | null
      priority: string
    } | null = null

    if (input.ticketId) {
      ticket = await prisma.ticket.findFirst({
        where: { id: input.ticketId, organizationId: orgId },
        select: {
          id: true, ticketNumber: true, subject: true, status: true,
          contactId: true, source: true, companyId: true, priority: true,
        },
      })
      if (!ticket) {
        return { reopened: false, reason: "ticket_not_found" }
      }
    } else {
      const contactId = await resolveContactId(
        orgId, input.contactId, input.fallbackPhone, input.fallbackEmail,
      )
      if (!contactId) {
        return { reopened: false, reason: "no_contact" }
      }

      // Most recent resolved/closed ticket for this contact on this channel.
      // Match by `source` OR `tags has channel` to handle legacy tickets that
      // have one but not the other (this is what made DV-0026 silently fail).
      ticket = await prisma.ticket.findFirst({
        where: {
          organizationId: orgId,
          contactId,
          status: { in: [...RESOLVED_STATUSES] },
          OR: [
            { source: channel },
            { tags: { has: channel } },
          ],
        },
        orderBy: { updatedAt: "desc" },
        select: {
          id: true, ticketNumber: true, subject: true, status: true,
          contactId: true, source: true, companyId: true, priority: true,
        },
      })

      if (!ticket) {
        return { reopened: false, reason: "no_resolved_ticket", contactId }
      }
    }

    const channelLabel = CHANNEL_LABELS[channel]
    const commentBody = input.commentOverride ?? `[Клиент (${channelLabel})] ${customerMessage}`
    const wasResolved = RESOLVED_STATUSES.includes(
      ticket.status as (typeof RESOLVED_STATUSES)[number],
    )

    // Reopen first so the workflow/audit see the new status.
    if (wasResolved) {
      // Recompute the SLA window from the moment of reopen: the old slaDueAt is
      // in the past, so without this the re-engaged ticket would show as
      // instantly breached. firstResponseAt is deliberately left untouched — a
      // reopened ticket owes a *resolution*, not a brand-new first response, and
      // clearing it would drop the historical first-response metric. When no
      // policy matches, `sla` is empty and the existing fields are left as-is.
      const sla = await resolveTicketSla(orgId, {
        companyId: ticket.companyId,
        priority: ticket.priority,
      })
      await prisma.ticket.update({
        where: { id: ticket.id },
        // reopenCount feeds the KPI Arena reopen-rate — this customer-reply path is
        // the dominant reopen entry point (the manual PUT status-change bumps it too).
        data: { status: "open", resolvedAt: null, closedAt: null, reopenCount: { increment: 1 }, ...sla },
      })
    }

    await prisma.ticketComment.create({
      data: { ticketId: ticket.id, comment: commentBody, isInternal: false },
    })

    logAudit(orgId, wasResolved ? "reopen" : "reply", "ticket", ticket.id, ticket.subject, {
      oldValue: wasResolved ? { status: ticket.status } : undefined,
      newValue: {
        ...(wasResolved ? { status: "open" } : {}),
        via: channel,
        reason: "customer_reply",
      },
    })

    executeWorkflows(orgId, "ticket", "replied", {
      id: ticket.id,
      status: wasResolved ? "open" : ticket.status,
      ticketNumber: ticket.ticketNumber,
      subject: ticket.subject,
      contactId: ticket.contactId,
      source: ticket.source,
    }).catch(err => console.error("[ticket-reopen] workflow error:", err))

    if (wasResolved) {
      fireWebhooks(orgId, "ticket.updated", {
        id: ticket.id,
        ticketNumber: ticket.ticketNumber,
        subject: ticket.subject,
        status: "open",
        reopenedVia: channel,
      }).catch(err => console.error("[ticket-reopen] webhook error:", err))
    }

    return {
      reopened: wasResolved,
      reason: wasResolved ? undefined : "ticket_already_open",
      ticketId: ticket.id,
      ticketNumber: ticket.ticketNumber,
      ticketSubject: ticket.subject,
      contactId: ticket.contactId,
      commentAdded: true,
    }
  } catch (err) {
    console.error("[ticket-reopen] error:", err)
    return { reopened: false, reason: "error" }
  }
}
