/**
 * The days the salon does not work: a holiday, an inventory day, the owner's
 * own wedding.
 *
 * They belong to the organization, not to one service. A salon closed on the
 * 14th is closed for every service it sells, and marking twenty services by
 * hand is how one of them stays open by accident and takes a booking nobody
 * will keep. Calendly calls the same thing date-specific hours; ours is the
 * simple half of it — closed or not — because that is what a salon says.
 *
 * Stored in `organizations.settings.bookingClosedDates`, beside the other
 * organization settings, so no booking table changes shape for it.
 */

export interface ClosedDate {
  /** `YYYY-MM-DD` on the organization's own clock. */
  date: string
  /** What the customer is never shown — it is for the people who work here. */
  note: string | null
}

export const MAX_CLOSED_DATES = 120
const MAX_NOTE = 80
const DATE_SHAPE = /^(\d{4})-(\d{2})-(\d{2})$/

/** A real day in the calendar, not merely four-two-two digits. */
export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== "string") return false
  const match = DATE_SHAPE.exec(value.trim())
  if (!match) return false
  const [, year, month, day] = match
  const date = new Date(`${year}-${month}-${day}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return false
  // 2026-02-31 parses into the 3rd of March; a day that rolls over is not a day.
  return date.toISOString().slice(0, 10) === `${year}-${month}-${day}`
}

/**
 * The setting as it may be read back: written by an older release, by hand, or
 * not at all. A list that cannot be understood is no closed days — the salon
 * then works its usual hours, which is the answer that takes bookings rather
 * than silently refusing them all.
 */
export function parseClosedDates(value: unknown): ClosedDate[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const out: ClosedDate[] = []
  for (const raw of value) {
    const entry = typeof raw === "string" ? { date: raw, note: null } : raw
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue
    const candidate = entry as { date?: unknown; note?: unknown }
    if (!isCalendarDate(candidate.date)) continue
    const date = (candidate.date as string).trim()
    if (seen.has(date)) continue
    seen.add(date)
    const note = typeof candidate.note === "string" && candidate.note.trim() ? candidate.note.trim().slice(0, MAX_NOTE) : null
    out.push({ date, note })
    if (out.length >= MAX_CLOSED_DATES) break
  }
  return out.sort((left, right) => left.date.localeCompare(right.date))
}

/** Where the organization keeps them. */
export function readClosedDates(settings: unknown): ClosedDate[] {
  if (!settings || typeof settings !== "object") return []
  return parseClosedDates((settings as Record<string, unknown>).bookingClosedDates)
}

/**
 * What is worth storing: today and the days after it. A closed day that has
 * passed changes nothing and would grow into a list nobody can read, and the
 * list is what the owner looks at to answer «are we open on Saturday».
 */
export function normalizeClosedDates(value: unknown, today: string): ClosedDate[] {
  const from = isCalendarDate(today) ? today : ""
  return parseClosedDates(value).filter((entry) => entry.date >= from)
}

/** The days to skip, for the one thing that asks: free-time computation. */
export function closedDateSet(dates: readonly ClosedDate[]): Set<string> {
  return new Set(dates.map((entry) => entry.date))
}
