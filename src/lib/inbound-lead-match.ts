import { prisma } from "@/lib/prisma"

/**
 * Inbound lead-matching (Slice 3b — inbound writers).
 *
 * Attribute an inbound interaction (call / email / message) to a Lead by
 * phone/email so it surfaces in that lead's interaction timeline. Org-scoped.
 * Always a FALLBACK — only for inbound with no EXISTING contact (a known/converted
 * contact always takes precedence — a converted lead is a contact):
 *  - calls / 3CX webhook: when no contact matched, attribute the call to a lead.
 *  - WhatsApp webhook: when the sender is not an existing contact, try a lead FIRST;
 *    if matched, attribute the message to the lead and SKIP auto-creating a contact
 *    (no duplicate person); only auto-create a contact when no lead matches.
 *  - Telegram webhook: when no prior-message contact, match a lead by @username.
 *
 * Performance: matching is TWO-TIER so the common path is index-served.
 *  - Tier 1 (indexed exact): email (case-insensitive), and phone/phoneWhatsApp
 *    exact variants (raw, digits-only, `+`-prefixed) — served by Lead's
 *    `(organizationId, phone)` / `(organizationId, phoneWhatsApp)` indexes.
 *  - Tier 2 (fuzzy fallback): a last-9-digits `contains` to tolerate local↔intl
 *    format drift (e.g. AZ "0XX" vs "+994XX"). This is a substring scan (not
 *    indexable), so it runs ONLY when Tier 1 found nothing. Narrowed by org.
 * Returns the most-recent matching lead's id, or undefined.
 */
export async function matchInboundLeadId(
  organizationId: string,
  by: { phone?: string | null; email?: string | null; telegramHandle?: string | null },
): Promise<string | undefined> {
  const phone = by.phone?.trim()
  const email = by.email?.trim()
  const telegram = by.telegramHandle?.trim()
  if (!phone && !email && !telegram) return undefined

  // ── Tier 1: indexed exact ────────────────────────────────────────────────
  const exact: any[] = []
  if (email) exact.push({ email: { equals: email, mode: "insensitive" } })
  if (telegram) {
    // Telegram gives the @username without "@"; leads may store either form, and
    // Telegram usernames are case-insensitive — match accordingly.
    const h = telegram.replace(/^@/, "")
    if (h) {
      exact.push(
        { telegramHandle: { equals: h, mode: "insensitive" } },
        { telegramHandle: { equals: `@${h}`, mode: "insensitive" } },
      )
    }
  }
  let last9: string | undefined
  if (phone) {
    exact.push({ phone }, { phoneWhatsApp: phone })
    const clean = phone.replace(/[\s\-()+]/g, "")
    if (clean) {
      exact.push({ phone: clean }, { phone: `+${clean}` }, { phoneWhatsApp: clean })
      if (clean.length >= 9) last9 = clean.slice(-9)
    }
  }
  if (exact.length === 0) return undefined

  const exactLead = await prisma.lead.findFirst({
    where: { organizationId, OR: exact },
    select: { id: true },
    orderBy: { createdAt: "desc" },
  })
  if (exactLead) return exactLead.id

  // ── Tier 2: fuzzy fallback (only when no exact match) ─────────────────────
  if (!last9) return undefined
  const fuzzyLead = await prisma.lead.findFirst({
    where: {
      organizationId,
      OR: [{ phone: { contains: last9 } }, { phoneWhatsApp: { contains: last9 } }],
    },
    select: { id: true },
    orderBy: { createdAt: "desc" },
  })
  return fuzzyLead?.id
}
