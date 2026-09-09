/**
 * Activity Capture type contracts — A6 Phase 3.
 *
 * Salesforce Einstein Activity Capture analogue: auto-pull meetings from
 * Google Calendar (slice 1) and emails from Gmail/Outlook (slice 2) into
 * the CRM `Activity` table, with attendee → Contact / Company matching
 * via email lookup.
 *
 * Slice 1 ships the pure matching + extraction + dedup helpers. Engine
 * wiring + cron endpoint follow.
 */

/* ─── Raw event shape ─────────────────────────────────────────────────── */

/**
 * The minimal subset of a Google Calendar event we care about for capture.
 * Mirrors `calendar_v3.Schema$Event` selectively so tests can construct
 * fixtures without dragging in the googleapis types.
 */
export interface CalendarEventInput {
  /** Provider-side event id (stable per series; not unique across calendars). */
  id: string
  /** Source identifier — e.g. `google_calendar:primary`. Used for dedup. */
  source: string
  summary?: string | null
  description?: string | null
  /** ISO timestamp or null when all-day. */
  startIso?: string | null
  endIso?: string | null
  /** Event creator's email. */
  organizerEmail?: string | null
  /** Attendees as email strings. Trimmed + lowercased before matching. */
  attendeeEmails: string[]
  /** Event location (e.g. meeting URL, address). */
  location?: string | null
  /** Whether the event is cancelled — engine treats as no-op. */
  cancelled?: boolean
}

/* ─── Matching ────────────────────────────────────────────────────────── */

/** A CRM row that can be matched by email. Caller fetches from Prisma. */
export interface MatchableContact {
  id: string
  email: string | null
  companyId: string | null
}

export interface MatchedAttendees {
  /** Contacts found by email match (1:1 on each attendee). */
  contacts: MatchableContact[]
  /** Distinct company ids from matched contacts (could be empty). */
  companyIds: string[]
  /** Emails that didn't match any CRM contact — slice 2 may auto-create leads. */
  unmatchedEmails: string[]
}

/* ─── Activity extraction ─────────────────────────────────────────────── */

/**
 * The shape produced from a calendar event, ready for `prisma.activity.create`.
 * Engine fills in `organizationId` + dedup-related fields at write-time.
 */
export interface ExtractedActivity {
  type: "meeting" | "email"
  subject: string
  description: string
  scheduledAt: Date | null
  completedAt: Date | null
  contactId: string | null
  companyId: string | null
  /** Stable dedup key — same key in two sync passes means already-captured. */
  externalKey: string
}

/**
 * Result of one sync pass. Used for cron-route observability + tests.
 */
export interface SyncResult {
  eventsScanned: number
  activitiesCreated: number
  activitiesSkipped: number
  attendeesUnmatched: number
  errors: number
}
