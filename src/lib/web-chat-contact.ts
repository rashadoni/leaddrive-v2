import { prisma } from "@/lib/prisma"

/**
 * Match-or-create the CRM Contact for a web-chat visitor. Extracted verbatim
 * from web-chat-escalate.ts so session start and ticket escalation share ONE
 * matching policy: email match first (more reliable), then phone, else create
 * with source "web_chat". Must run inside a tenant RLS scope.
 *
 * Matching tries BOTH the raw and the trimmed value: legacy rows were created
 * from untrimmed input, so a trimmed-only lookup would duplicate the contact
 * when an old session (padded phone) escalates after this deploy.
 */
export async function matchOrCreateWebChatContact(
  organizationId: string,
  visitor: { name?: string | null; email?: string | null; phone?: string | null },
  opts: { createIfMissing?: boolean } = {},
): Promise<{ contactId: string; companyId: string | null; created: boolean } | null> {
  const createIfMissing = opts.createIfMissing !== false
  const email = visitor.email?.trim() || null
  const phone = visitor.phone?.trim() || null
  if (!email && !phone) return null

  const or: Array<{ email: string } | { phone: string }> = []
  if (email) {
    or.push({ email })
    if (visitor.email && visitor.email !== email) or.push({ email: visitor.email })
  }
  if (phone) {
    or.push({ phone })
    if (visitor.phone && visitor.phone !== phone) or.push({ phone: visitor.phone })
  }

  const existing = await prisma.contact.findFirst({
    where: { organizationId, OR: or as never },
    select: { id: true, companyId: true },
  })
  if (existing) {
    return { contactId: existing.id, companyId: existing.companyId ?? null, created: false }
  }
  if (!createIfMissing) return null

  const created = await prisma.contact.create({
    data: {
      organizationId,
      fullName: visitor.name?.trim() || email || phone || "Web-chat visitor",
      email,
      phone,
      source: "web_chat",
    },
  })
  return { contactId: created.id, companyId: null, created: true }
}
