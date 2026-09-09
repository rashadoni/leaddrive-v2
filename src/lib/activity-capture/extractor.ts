/**
 * Pure calendar-event → Activity extractor.
 *
 * Takes a raw `CalendarEventInput`, a `MatchedAttendees` result, and emits
 * a payload ready for `prisma.activity.create`. Slice 1 handles the simple
 * 1:N case (one event → one Activity per matched contact). Slice 2 may
 * fan out emails the same way.
 *
 * `externalKey` is the dedup primitive: same key in two sync passes means
 * already-captured; engine queries existing Activity rows by this key.
 *
 * Part of A6 Activity Capture (Phase 3 slice 1).
 */
import type { CalendarEventInput, ExtractedActivity, MatchedAttendees } from "./types"

const MAX_DESCRIPTION = 4_000

export function buildExternalKey(event: CalendarEventInput, contactId: string | null): string {
  // Stable across sync passes; contactId scopes the row for fan-out events.
  return `${event.source}:${event.id}:${contactId ?? "none"}`
}

/**
 * Extract zero, one, or N activities from one calendar event.
 *
 * - Cancelled events → empty (the engine should still record they were
 *   seen so we don't re-process them; that's the dedup-by-existing-key
 *   path on the prisma side).
 * - No matched contacts AND no matched companies → one "orphan" activity
 *   bound to neither, attributed to the event creator. Lets the firm see
 *   "we had a meeting with someone outside CRM" rather than silently drop.
 * - N matched contacts → N activities, one per contact. Salesforce calls
 *   this "Activity Sharing" — each contact's timeline sees the meeting.
 */
export function extractActivities(
  event: CalendarEventInput,
  matched: MatchedAttendees
): ExtractedActivity[] {
  if (event.cancelled) return []

  const subject = (event.summary || "(no subject)").slice(0, 240)
  const descParts: string[] = []
  if (event.description) descParts.push(event.description)
  if (event.location) descParts.push(`Location: ${event.location}`)
  if (event.organizerEmail) descParts.push(`Organizer: ${event.organizerEmail}`)
  if (event.attendeeEmails.length > 0) {
    descParts.push(`Attendees: ${event.attendeeEmails.join(", ")}`)
  }
  const description = truncate(descParts.join("\n\n"), MAX_DESCRIPTION)

  const scheduledAt = parseIso(event.startIso)
  const endAt = parseIso(event.endIso)
  // Treat past-end events as completed; future or undated as pending.
  const now = Date.now()
  const completedAt = endAt && endAt.getTime() <= now ? endAt : null

  // Orphan activity if no contacts matched. `matched.companyIds` is only
  // populated by `matchAttendees` from matched contacts, so `contacts=[]`
  // invariantly implies `companyIds=[]` — orphans never carry a company id.
  if (matched.contacts.length === 0) {
    return [{
      type: "meeting",
      subject,
      description,
      scheduledAt,
      completedAt,
      contactId: null,
      companyId: null,
      externalKey: buildExternalKey(event, null),
    }]
  }

  // Fan out: one Activity per matched contact
  return matched.contacts.map(contact => ({
    type: "meeting" as const,
    subject,
    description,
    scheduledAt,
    completedAt,
    contactId: contact.id,
    companyId: contact.companyId ?? null,
    externalKey: buildExternalKey(event, contact.id),
  }))
}

function parseIso(iso: string | null | undefined): Date | null {
  if (!iso) return null
  const t = new Date(iso).getTime()
  return Number.isFinite(t) ? new Date(t) : null
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s
  return s.slice(0, max - 1) + "…"
}
