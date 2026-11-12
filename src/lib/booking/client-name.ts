/**
 * The name this organisation already has for the person who booked.
 *
 * A meeting keeps the name the customer typed into the form — or the one
 * their WhatsApp profile carries, which is whatever they set years ago. When
 * the CRM already knows that number, it usually knows them better: the
 * administrator wrote «Rəşad Rəhimov» on the contact, and that is the name
 * the salon says out loud (owner, 2026-11-12: «если в CRM имя контакта
 * добавлено, то пусть отображает имя»).
 *
 * Matched on digits, never on the string: phones in this CRM are stored
 * exactly as somebody typed them — «+994 50 111 22 33», «0501112233»,
 * «994501112233» live side by side — so the LAST NINE digits are compared,
 * the subscriber part in Azerbaijan. The same rule as the staff booking form
 * (client-search.ts), kept separate because this one answers for a list of
 * numbers at once and never widens: an unknown number simply has no name.
 *
 * A contact outranks a lead: a lead is someone who wrote once, a contact is
 * someone the salon keeps.
 */
import { bookingDb as prisma } from "./db"

/** Enough of a number to be that person and not their neighbour. */
const SUBSCRIBER_DIGITS = 9

export function phoneKey(value: string | null | undefined): string {
  const digits = (value ?? "").replace(/\D/g, "")
  return digits.length >= SUBSCRIBER_DIGITS ? digits.slice(-SUBSCRIBER_DIGITS) : digits
}

/**
 * `phoneKey(phone)` → the name the CRM holds, for the numbers asked about.
 *
 * Runs under the caller's tenant scope. Nothing is widened here: the query
 * asks for these numbers and no others, so a screen cannot accidentally show
 * a name for a meeting it did not ask about.
 */
export async function crmNamesByPhone(organizationId: string, phones: readonly string[]): Promise<Map<string, string>> {
  const keys = [...new Set(phones.map(phoneKey).filter((key) => key.length === SUBSCRIBER_DIGITS))]
  const names = new Map<string, string>()
  if (!keys.length) return names
  const patterns = keys.map((key) => `%${key}`)
  // Leads first, contacts second: the second write wins, so a contact's name
  // replaces a lead's for the same number. The column that holds the name is
  // each table's own — a lead has a `contactName`, a contact a `fullName`.
  for (const [table, column] of [["leads", "contactName"], ["contacts", "fullName"]] as const) {
    const rows = await prisma.$queryRawUnsafe<{ phone: string | null; name: string | null }[]>(
      `SELECT phone, "${column}" AS name FROM ${table}
        WHERE "organizationId" = $1
          AND regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g') LIKE ANY($2::text[])
        LIMIT 500`,
      organizationId, patterns,
    ).catch(() => [])
    for (const row of rows) {
      const name = (row.name ?? "").trim()
      const key = phoneKey(row.phone)
      if (name && key.length === SUBSCRIBER_DIGITS) names.set(key, name)
    }
  }
  return names
}
