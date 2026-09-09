/**
 * Pure email → Contact matching helpers.
 *
 * Given a list of attendee emails from a calendar event and a roster of
 * CRM contacts (caller fetches from Prisma scoped to the org), determine
 * which CRM rows the event ties back to. Email comparison is
 * case-insensitive + trimmed; the org's own user emails (and the
 * connected calendar user's email) are excluded so we don't surface
 * "the deal owner" as an external attendee.
 *
 * Part of A6 Activity Capture (Phase 3 slice 1).
 */
import type { MatchableContact, MatchedAttendees } from "./types"

/** Normalise email for case-insensitive comparison. Pure. */
export function normalizeEmail(email: string | null | undefined): string {
  if (!email) return ""
  return email.trim().toLowerCase()
}

/**
 * Pure matcher. Filters attendees against `excludeEmails` (the org's own
 * users + connected calendar user) and looks each remaining attendee up
 * in the contact roster.
 *
 * Returns: matched contacts, distinct company ids, and a list of
 * unmatched external emails (slice 2 may auto-promote these to leads).
 */
export function matchAttendees(
  attendeeEmails: string[],
  contacts: MatchableContact[],
  excludeEmails: string[] = []
): MatchedAttendees {
  const excludeSet = new Set(excludeEmails.map(normalizeEmail).filter(Boolean))
  const contactsByEmail = new Map<string, MatchableContact>()
  for (const c of contacts) {
    const norm = normalizeEmail(c.email)
    if (norm) contactsByEmail.set(norm, c)
  }

  const matchedContacts: MatchableContact[] = []
  const matchedCompanyIds = new Set<string>()
  const unmatchedEmails: string[] = []
  const seen = new Set<string>()

  for (const raw of attendeeEmails) {
    const norm = normalizeEmail(raw)
    if (!norm) continue
    if (seen.has(norm)) continue
    seen.add(norm)
    if (excludeSet.has(norm)) continue

    const contact = contactsByEmail.get(norm)
    if (contact) {
      matchedContacts.push(contact)
      if (contact.companyId) matchedCompanyIds.add(contact.companyId)
    } else {
      unmatchedEmails.push(norm)
    }
  }

  return {
    contacts: matchedContacts,
    companyIds: [...matchedCompanyIds],
    unmatchedEmails,
  }
}
