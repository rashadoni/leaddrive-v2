/**
 * Activity Capture sync engine.
 *
 * Consumes pure helpers (`matcher.ts`, `extractor.ts`) and persists results
 * via Prisma. The actual Google Calendar pull is injected as a `fetchEvents`
 * callback so tests can substitute a stub returning canned events without
 * mocking `googleapis`.
 *
 * Idempotency: each extracted activity carries a stable `externalKey`
 * derived from `${source}:${eventId}:${contactId|none}`. The engine
 * queries existing `Activity.description` for the marker `__capture_key=…`
 * appended at write-time; rows already captured are skipped on the next
 * pass. (Slice 2 will switch to a dedicated `externalKey` column on
 * Activity for cleaner queries.)
 *
 * Part of A6 Activity Capture (Phase 3 roadmap, slice 1).
 */
import type { PrismaClient } from "@prisma/client"
import { matchAttendees } from "./matcher"
import { extractActivities } from "./extractor"
import type {
  CalendarEventInput,
  MatchableContact,
  SyncResult,
} from "./types"

/** Marker token appended to Activity.description to support dedup. */
export const CAPTURE_KEY_MARKER = "__capture_key="

export interface SyncOptions {
  organizationId: string
  /** Pulled by caller from the connected user's Account row + org users. */
  excludeEmails: string[]
  /** Caller-provided event stream; engine doesn't know how to fetch. */
  fetchEvents: () => Promise<CalendarEventInput[]>
  /** Optional override for now-time in tests. */
  now?: Date
  /**
   * `Activity.createdBy` value to attribute new rows to. Convention is the
   * userId whose connected calendar this sync runs against — that way the
   * CRM UI's existing `userMap[a.createdBy]` join surfaces the right name.
   */
  createdBy?: string
}

type PrismaSubset = Pick<PrismaClient, "contact" | "activity">

/**
 * One sync pass. Resolves contacts for the org (subset needed for match),
 * fetches calendar events via the injected callback, extracts activities,
 * checks dedup, and writes new rows.
 */
export async function syncCalendarActivities(
  prisma: PrismaSubset,
  opts: SyncOptions
): Promise<SyncResult> {
  const result: SyncResult = {
    eventsScanned: 0,
    activitiesCreated: 0,
    activitiesSkipped: 0,
    attendeesUnmatched: 0,
    errors: 0,
  }

  const events = await opts.fetchEvents()
  result.eventsScanned = events.length
  if (events.length === 0) return result

  // Load org contacts ONCE per sync pass (capped — slice 1 assumption is
  // <100k contacts per org; slice 2 may stream + chunk for larger).
  const contacts: MatchableContact[] = await prisma.contact.findMany({
    where: { organizationId: opts.organizationId, email: { not: null } },
    select: { id: true, email: true, companyId: true },
    take: 100_000,
  })

  // Pre-query dedup markers. PERF: avoid an `O(events × contacts)` OR-of-LIKE
  // explosion (would force a sequential scan over `activities` per sync).
  // Instead: one LIKE per distinct event source — typically ≤2-3 sources
  // (`google_calendar:primary`, future Outlook source, etc.) — pull every
  // captured row that mentions any of them, then parse the marker locally.
  const sourceMarkers = [...new Set(events.map(e => e.source))]
    .map(src => `${CAPTURE_KEY_MARKER}${src}:`)
  const existing = sourceMarkers.length > 0
    ? await prisma.activity.findMany({
        where: {
          organizationId: opts.organizationId,
          OR: sourceMarkers.map(m => ({ description: { contains: m } })),
        },
        select: { description: true },
      })
    : []
  const existingKeys = new Set<string>()
  for (const row of existing) {
    if (!row.description) continue
    const idx = row.description.indexOf(CAPTURE_KEY_MARKER)
    if (idx < 0) continue
    // Capture key extends from after the marker to the first whitespace OR end.
    // `match(/^[^\s]+/)` is precise; prior `.split(/\s|$/)[0]` could yield ""
    // depending on what followed the marker.
    const tail = row.description.slice(idx + CAPTURE_KEY_MARKER.length)
    const m = tail.match(/^[^\s]+/)
    if (m && m[0]) existingKeys.add(m[0])
  }

  // Extract + write
  for (const event of events) {
    try {
      const matched = matchAttendees(event.attendeeEmails, contacts, opts.excludeEmails)
      result.attendeesUnmatched += matched.unmatchedEmails.length
      const extracted = extractActivities(event, matched)

      for (const activity of extracted) {
        if (existingKeys.has(activity.externalKey)) {
          result.activitiesSkipped++
          continue
        }
        const descriptionWithKey = `${activity.description}\n\n${CAPTURE_KEY_MARKER}${activity.externalKey}`
        await prisma.activity.create({
          data: {
            organizationId: opts.organizationId,
            type: activity.type,
            subject: activity.subject,
            description: descriptionWithKey,
            contactId: activity.contactId,
            companyId: activity.companyId,
            scheduledAt: activity.scheduledAt,
            completedAt: activity.completedAt,
            // Falls back to a sentinel string only if caller didn't supply a
            // real userId — UI's `userMap[createdBy]` join will then render
            // raw text. Cron route always passes the connected user's id.
            createdBy: opts.createdBy ?? "activity-capture:google-calendar",
          },
        })
        existingKeys.add(activity.externalKey) // prevent in-pass duplicates
        result.activitiesCreated++
      }
    } catch (e) {
      console.error(`[activity-capture] event ${event.id} failed:`, e)
      result.errors++
    }
  }

  return result
}
