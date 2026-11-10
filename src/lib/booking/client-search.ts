/**
 * Who the staff booking form is for: the customers this organization already
 * has, found by the name or the number being typed into the form itself.
 *
 * Before this, every staff booking typed the customer from scratch and the
 * effect worker filed one more lead for them — the same person five visits
 * deep was five rows. Picking a match here links the meeting to that record
 * instead (see createStoredBooking / effect-worker).
 *
 * Numbers are matched on digits only. Phones in this CRM are stored exactly
 * as somebody typed them — "+994 50 111 22 33", "0501112233", "994501112233"
 * all live side by side — so a `contains` on the raw column finds the number
 * only for whoever happens to have typed it the same way. The digits are
 * compared in SQL (`regexp_replace`) and the LAST NINE are used once enough
 * were typed: that is the subscriber part in Azerbaijan, so the local "050…"
 * form and the international "+994 50…" form meet.
 *
 * Rows come back through Prisma afterwards, by id, so record-sharing rules and
 * field permissions decide what this person may actually see — the raw query
 * only narrows, it never answers.
 */
import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { applyRecordFilter } from "@/lib/sharing-rules"
import { getFieldPermissions, isFieldVisible } from "@/lib/field-filter"
import { containsInsensitive } from "@/lib/list-view"

/** Shorter than this and a typeahead answers with half the customer base. */
export const CLIENT_SEARCH_MIN_CHARS = 2
/** Fewer digits than this match everybody; the field is still a free-text name search. */
export const CLIENT_SEARCH_MIN_DIGITS = 4
/** What the panel shows. The list never scrolls — past this, type more. */
export const CLIENT_SEARCH_LIMIT = 5
/** Taken per entity before ranking, so a good match is not lost to the limit. */
const PER_ENTITY = 12
const MAX_QUERY_CHARS = 100

export interface BookingClientMatch {
  type: "contact" | "lead"
  id: string
  name: string
  phone: string | null
  email: string | null
  /** Where this person is from, in one line: company, or how the lead arrived. */
  subtitle: string
}

export interface BookingClientSearchOptions {
  orgId: string
  userId: string
  role: string
  query: string
  /** Contacts may be read: the role allows it and the tenant has the module. */
  contacts: boolean
  /** Leads may be read. */
  leads: boolean
  /** This principal must not see customer numbers (customer-phone-privacy). */
  phonesHidden: boolean
}

/** The digits a typed number should be matched by, or "" when it is not a number. */
export function phoneNeedle(query: string): string {
  const digits = query.replace(/\D/g, "")
  if (digits.length < CLIENT_SEARCH_MIN_DIGITS) return ""
  return digits.length > 9 ? digits.slice(-9) : digits
}

/** Ids whose stored number carries these digits, whatever punctuation it was typed with. */
async function contactIdsByPhone(orgId: string, needle: string): Promise<string[]> {
  const pattern = `%${needle}%`
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id FROM contacts
     WHERE "organizationId" = ${orgId}
       AND (
         regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g') LIKE ${pattern}
         OR EXISTS (
           SELECT 1 FROM unnest(phones) AS extra
            WHERE regexp_replace(COALESCE(extra, ''), '[^0-9]', '', 'g') LIKE ${pattern}
         )
       )
     LIMIT ${PER_ENTITY}
  `
  return rows.map((row) => row.id)
}

async function leadIdsByPhone(orgId: string, needle: string): Promise<string[]> {
  const pattern = `%${needle}%`
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id FROM leads
     WHERE "organizationId" = ${orgId}
       AND (
         regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g') LIKE ${pattern}
         OR regexp_replace(COALESCE("phoneWhatsApp", ''), '[^0-9]', '', 'g') LIKE ${pattern}
       )
     LIMIT ${PER_ENTITY}
  `
  return rows.map((row) => row.id)
}

/**
 * Best first: the number that was typed, then a name that starts with it, then
 * a name that merely holds it, then the e-mail. Equal rows go by name so two
 * keystrokes apart never reshuffle the list under the mouse.
 */
function rank(match: BookingClientMatch, query: string, byPhone: boolean): number {
  if (byPhone) return 0
  const name = match.name.toLocaleLowerCase()
  const needle = query.toLocaleLowerCase()
  if (name.startsWith(needle)) return 1
  if (name.includes(needle)) return 2
  return 3
}

export async function searchBookingClients(options: BookingClientSearchOptions): Promise<BookingClientMatch[]> {
  const query = options.query.trim().slice(0, MAX_QUERY_CHARS)
  if (query.length < CLIENT_SEARCH_MIN_CHARS) return []
  // A number is never matched for somebody who is not allowed to see numbers:
  // a typeahead that confirms "this number exists" is the masking undone.
  const needle = options.phonesHidden ? "" : phoneNeedle(query)
  const { orgId, userId, role } = options

  const [contactPhoneIds, leadPhoneIds] = await Promise.all([
    needle && options.contacts ? contactIdsByPhone(orgId, needle) : Promise.resolve([]),
    needle && options.leads ? leadIdsByPhone(orgId, needle) : Promise.resolve([]),
  ])

  const [contacts, leads, contactFields, leadFields] = await Promise.all([
    options.contacts ? loadContacts(orgId, userId, role, query, contactPhoneIds) : Promise.resolve([]),
    options.leads ? loadLeads(orgId, userId, role, query, leadPhoneIds) : Promise.resolve([]),
    options.contacts ? getFieldPermissions(orgId, role, "contact") : Promise.resolve({}),
    options.leads ? getFieldPermissions(orgId, role, "lead") : Promise.resolve({}),
  ])

  const show = (fields: Record<string, string>, field: string, value: string | null) =>
    value && isFieldVisible(fields, role, field) ? value : null

  const matches: { match: BookingClientMatch; score: number }[] = [
    ...contacts.map((row) => {
      const match: BookingClientMatch = {
        type: "contact",
        id: row.id,
        name: row.fullName,
        phone: options.phonesHidden ? null : show(contactFields, "phone", row.phone),
        email: show(contactFields, "email", row.email),
        subtitle: [isFieldVisible(contactFields, role, "companyId") ? row.company?.name ?? "" : ""].filter(Boolean).join(" · "),
      }
      return { match, score: rank(match, query, contactPhoneIds.includes(row.id)) }
    }),
    ...leads.map((row) => {
      const match: BookingClientMatch = {
        type: "lead",
        id: row.id,
        name: row.contactName,
        phone: options.phonesHidden ? null : show(leadFields, "phone", row.phone),
        email: show(leadFields, "email", row.email),
        subtitle: [
          isFieldVisible(leadFields, role, "companyName") ? row.companyName ?? "" : "",
          isFieldVisible(leadFields, role, "source") ? row.source ?? "" : "",
        ].filter(Boolean).join(" · "),
      }
      return { match, score: rank(match, query, leadPhoneIds.includes(row.id)) }
    }),
  ]

  return matches
    .sort((left, right) => left.score - right.score
      || left.match.name.localeCompare(right.match.name)
      || left.match.id.localeCompare(right.match.id))
    .slice(0, CLIENT_SEARCH_LIMIT)
    .map((entry) => entry.match)
}

async function loadContacts(orgId: string, userId: string, role: string, query: string, phoneIds: string[]) {
  const where = await applyRecordFilter(orgId, userId, role, "contact", {
    organizationId: orgId,
    isActive: true,
    OR: [
      { fullName: containsInsensitive(query) },
      { email: containsInsensitive(query) },
      ...(phoneIds.length ? [{ id: { in: phoneIds } }] : []),
    ],
  }) as Prisma.ContactWhereInput
  return prisma.contact.findMany({
    where,
    select: { id: true, fullName: true, phone: true, email: true, company: { select: { name: true } } },
    orderBy: [{ fullName: "asc" }, { id: "asc" }],
    take: PER_ENTITY,
  })
}

async function loadLeads(orgId: string, userId: string, role: string, query: string, phoneIds: string[]) {
  const where = await applyRecordFilter(orgId, userId, role, "lead", {
    organizationId: orgId,
    // A lead already turned into a contact is that contact now; offering both
    // would be the duplicate this search exists to stop.
    status: { not: "converted" },
    OR: [
      { contactName: containsInsensitive(query) },
      { email: containsInsensitive(query) },
      ...(phoneIds.length ? [{ id: { in: phoneIds } }] : []),
    ],
  }) as Prisma.LeadWhereInput
  return prisma.lead.findMany({
    where,
    select: { id: true, contactName: true, phone: true, email: true, companyName: true, source: true },
    orderBy: [{ contactName: "asc" }, { id: "asc" }],
    take: PER_ENTITY,
  })
}
