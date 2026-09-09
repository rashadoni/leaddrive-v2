import { prisma } from "@/lib/prisma"

/**
 * Resolves the display name of a related entity scoped to the given org.
 * Returns { name } when the entity exists in orgId, null when not found.
 * Throws on DB error so callers can distinguish "not found" from "outage".
 */
export async function resolveRelated(
  orgId: string,
  type: string,
  id: string
): Promise<{ name: string } | null> {
  switch (type) {
    case "company": {
      const e = await prisma.company.findFirst({ where: { id, organizationId: orgId }, select: { name: true } })
      return e ? { name: e.name || "" } : null
    }
    case "contact": {
      const e = await prisma.contact.findFirst({ where: { id, organizationId: orgId }, select: { fullName: true } })
      return e ? { name: e.fullName || "" } : null
    }
    case "deal": {
      const e = await prisma.deal.findFirst({ where: { id, organizationId: orgId }, select: { title: true } })
      return e ? { name: e.title || "" } : null
    }
    case "lead": {
      const e = await prisma.lead.findFirst({ where: { id, organizationId: orgId }, select: { contactName: true, companyName: true } })
      return e ? { name: e.contactName || e.companyName || "" } : null
    }
    case "ticket": {
      const e = await prisma.ticket.findFirst({ where: { id, organizationId: orgId }, select: { subject: true } })
      return e ? { name: e.subject || "" } : null
    }
    default:
      return null
  }
}
