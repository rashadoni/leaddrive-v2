import { prisma } from "@/lib/prisma"

/**
 * Sanitize client-supplied entity references (Slice 3b hardening — deferred #2/#P3).
 *
 * Writers (whatsapp/send, inbox POST, calls, …) accept `leadId`/`contactId`/
 * `companyId`/`dealId`/`ticketId`/`conversationId` from the request body and persist them on the created
 * record. Without a check, a buggy or malicious client could tag a record with an
 * id from ANOTHER tenant. The timeline READ is already org-filtered (so a forged
 * id can't surface cross-tenant), but persisting a non-org id is an integrity hole
 * (orphan tag).
 *
 * Drops any id that doesn't belong to `organizationId`, returning only the verified
 * ones. Each PROVIDED id costs one indexed `findFirst`; omitted refs are skipped and
 * the provided ones run in parallel. Callers may destructure only the refs they pass
 * — extra keys are harmless.
 */
export async function sanitizeOwnedRefs(
  organizationId: string,
  refs: {
    leadId?: string | null
    contactId?: string | null
    companyId?: string | null
    dealId?: string | null
    ticketId?: string | null
    conversationId?: string | null
  },
): Promise<{ leadId?: string; contactId?: string; companyId?: string; dealId?: string; ticketId?: string; conversationId?: string }> {
  const [lead, contact, company, deal, ticket, conversation] = await Promise.all([
    refs.leadId
      ? prisma.lead.findFirst({ where: { id: refs.leadId, organizationId }, select: { id: true } })
      : null,
    refs.contactId
      ? prisma.contact.findFirst({ where: { id: refs.contactId, organizationId }, select: { id: true } })
      : null,
    refs.companyId
      ? prisma.company.findFirst({ where: { id: refs.companyId, organizationId }, select: { id: true } })
      : null,
    refs.dealId
      ? prisma.deal.findFirst({ where: { id: refs.dealId, organizationId }, select: { id: true } })
      : null,
    refs.ticketId
      ? prisma.ticket.findFirst({ where: { id: refs.ticketId, organizationId }, select: { id: true } })
      : null,
    refs.conversationId
      ? prisma.socialConversation.findFirst({ where: { id: refs.conversationId, organizationId }, select: { id: true } })
      : null,
  ])

  const out: { leadId?: string; contactId?: string; companyId?: string; dealId?: string; ticketId?: string; conversationId?: string } = {}
  if (lead) out.leadId = lead.id
  if (contact) out.contactId = contact.id
  if (company) out.companyId = company.id
  if (deal) out.dealId = deal.id
  if (ticket) out.ticketId = ticket.id
  if (conversation) out.conversationId = conversation.id
  return out
}
