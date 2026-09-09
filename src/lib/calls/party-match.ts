import type { Prisma } from "@prisma/client"

import { threeCxPhoneVariants } from "@/lib/voip/threecx-crm"

type CallPartyStore = Pick<Prisma.TransactionClient, "contact" | "lead">

export type MatchedCallParty = {
  contactId?: string
  leadId?: string
  targetPhoneE164?: string
}

/**
 * Resolve one external caller to the newest exact CRM identity in its tenant.
 *
 * A Contact wins over a Lead because conversion can leave the source lead in
 * place, and suffix-only phone matching is deliberately excluded: it is not
 * strong enough evidence to put one customer's card in front of a salesperson.
 */
export async function matchCallParty(
  store: CallPartyStore,
  organizationId: string,
  phone: string,
): Promise<MatchedCallParty> {
  const { exact, canonicalE164 } = threeCxPhoneVariants(phone)
  if (exact.length === 0) return {}

  const contact = await store.contact.findFirst({
    where: {
      organizationId,
      OR: [{ phone: { in: exact } }, { phones: { hasSome: exact } }],
    },
    select: { id: true },
    orderBy: { updatedAt: "desc" },
  })
  if (contact) return { contactId: contact.id, targetPhoneE164: canonicalE164 }

  const lead = await store.lead.findFirst({
    where: {
      organizationId,
      OR: [{ phone: { in: exact } }, { phoneWhatsApp: { in: exact } }],
    },
    select: { id: true },
    orderBy: { updatedAt: "desc" },
  })
  return lead
    ? { leadId: lead.id, targetPhoneE164: canonicalE164 }
    : { targetPhoneE164: canonicalE164 }
}
