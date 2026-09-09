/**
 * Timezone utilities for per-user time-zone preferences.
 *
 * Resolution precedence (when displaying dates to a user):
 *   1. `User.timezone` (IANA name, e.g. "Europe/Warsaw")
 *   2. `Organization.settings.timezone` (org default)
 *   3. Server local time (UTC on Hetzner prod)
 *
 * Part of P5 Time zones per user (Phase 1 roadmap).
 */

import { createDateFormatter } from "@/lib/format-date"

/**
 * Curated list of common IANA timezones for UI dropdowns. Not exhaustive —
 * `Intl.supportedValuesOf("timeZone")` (where available) returns the full
 * ~400 zone set. We expose a sensible default ordered by region.
 *
 * Adding a new zone: keep grouped by region for readability; the UI sorts
 * alphabetically anyway.
 */
export const COMMON_TIMEZONES: readonly string[] = [
  // UTC / generic
  "UTC",

  // Europe
  "Europe/London", "Europe/Dublin", "Europe/Paris", "Europe/Madrid",
  "Europe/Lisbon", "Europe/Amsterdam", "Europe/Brussels", "Europe/Berlin",
  "Europe/Zurich", "Europe/Vienna", "Europe/Prague", "Europe/Warsaw",
  "Europe/Budapest", "Europe/Bucharest", "Europe/Athens", "Europe/Istanbul",
  "Europe/Helsinki", "Europe/Stockholm", "Europe/Oslo", "Europe/Copenhagen",
  "Europe/Tallinn", "Europe/Riga", "Europe/Vilnius",
  "Europe/Kiev", "Europe/Chisinau", "Europe/Minsk",
  "Europe/Moscow", "Europe/Samara",

  // CIS / Caucasus (LeadDrive primary market)
  "Asia/Yekaterinburg", // east of Urals — classified Asia in IANA
  "Asia/Tbilisi", "Asia/Yerevan", "Asia/Baku",
  "Asia/Almaty", "Asia/Tashkent", "Asia/Bishkek", "Asia/Dushanbe",
  "Asia/Ashgabat",

  // Middle East
  "Asia/Dubai", "Asia/Tehran", "Asia/Riyadh", "Asia/Qatar", "Asia/Jerusalem",
  "Asia/Beirut", "Asia/Amman", "Asia/Damascus",

  // South & East Asia
  "Asia/Karachi", "Asia/Kabul", "Asia/Kolkata", "Asia/Dhaka",
  "Asia/Yangon", "Asia/Bangkok", "Asia/Ho_Chi_Minh", "Asia/Jakarta",
  "Asia/Singapore", "Asia/Kuala_Lumpur", "Asia/Manila",
  "Asia/Hong_Kong", "Asia/Taipei", "Asia/Shanghai",
  "Asia/Seoul", "Asia/Tokyo",

  // Australia / Pacific
  "Australia/Perth", "Australia/Adelaide", "Australia/Brisbane",
  "Australia/Sydney", "Australia/Melbourne",
  "Pacific/Auckland", "Pacific/Honolulu",

  // Africa
  "Africa/Cairo", "Africa/Lagos", "Africa/Nairobi",
  "Africa/Johannesburg", "Africa/Casablanca",

  // Americas
  "America/Anchorage", "America/Los_Angeles", "America/Denver",
  "America/Phoenix", "America/Chicago", "America/New_York",
  "America/Toronto", "America/Halifax", "America/St_Johns",
  "America/Mexico_City", "America/Bogota", "America/Lima",
  "America/Caracas", "America/Santiago", "America/Buenos_Aires",
  "America/Sao_Paulo",
]

/**
 * Validate an IANA timezone name using Intl.DateTimeFormat. Returns true if
 * the runtime accepts the zone string. Used to gate user input before
 * persisting to `User.timezone`.
 *
 * Note: this is intentionally permissive — `COMMON_TIMEZONES` is a UI helper,
 * not a whitelist. Power users can paste any IANA zone the runtime supports.
 */
export function isValidTimezone(tz: unknown): tz is string {
  if (typeof tz !== "string" || tz.length === 0 || tz.length > 64) return false
  try {
    // Throws RangeError on invalid zones.
    // eslint-disable-next-line no-restricted-syntax -- a probe, not output: nothing here reaches a screen.
    new Intl.DateTimeFormat("en-US", { timeZone: tz }).format(new Date())
    return true
  } catch {
    return false
  }
}

export interface TimezoneResolutionSources {
  /** User-level preference; takes precedence when set. */
  userTimezone?: string | null
  /** Organization fallback (from `Organization.settings.timezone`). */
  orgTimezone?: string | null
}

/**
 * Resolve the effective timezone for a user given org defaults. Always
 * returns a usable IANA name — falls back to "UTC" as a final safety net.
 */
export function resolveEffectiveTimezone(sources: TimezoneResolutionSources = {}): string {
  if (isValidTimezone(sources.userTimezone)) return sources.userTimezone
  if (isValidTimezone(sources.orgTimezone)) return sources.orgTimezone
  return "UTC"
}

/**
 * Format a Date in the supplied IANA timezone:
 *   - falls back to UTC on invalid zone (defence-in-depth even though
 *     `User.timezone` should be validated on write);
 *   - accepts standard `Intl.DateTimeFormatOptions` for caller control;
 *   - never throws for the timezone parameter.
 *
 * The formatting itself goes through `format-date.ts` (field UX audit W-02,
 * task C2). This function used to call `Intl.DateTimeFormat` directly, and
 * that made it a hole straight through the C2 gate: the gate scans the two
 * MTM UI folders, so every screen that had dutifully switched to the helper
 * still rendered "2026 M09 5" in Azerbaijani the moment it reached a date
 * through here — and eleven MTM components do, for task deadlines, GPS
 * history and route drafts. `createDateFormatter` keeps the non-Azerbaijani
 * path on the same `Intl` output as before and assembles the Azerbaijani one
 * from wall-clock parts, which is the whole point of the helper.
 *
 * One deliberate change of behaviour: an unparseable date now returns "" —
 * the helper's documented contract — where `Intl.DateTimeFormat#format`
 * threw a RangeError. Callers that slice the result (route time slots) get
 * an empty string instead of a crash.
 */
export function formatInTimezone(
  date: Date | string | number,
  timezone: string,
  options: Intl.DateTimeFormatOptions = {},
  locale: string = "en-GB"
): string {
  const tz = isValidTimezone(timezone) ? timezone : "UTC"
  const d = date instanceof Date ? date : new Date(date)
  // `...options` last, exactly as before: a caller-supplied timeZone wins.
  return createDateFormatter(locale, { timeZone: tz, ...options }).format(d)
}

/** Format a moment as the YYYY-MM-DD value expected by an HTML date input. */
export function dateInputValueInTimezone(
  date: Date | string | number,
  timezone: string,
): string {
  const tz = isValidTimezone(timezone) ? timezone : "UTC"
  const d = date instanceof Date ? date : new Date(date)
  if (Number.isNaN(d.getTime())) return ""

  // eslint-disable-next-line no-restricted-syntax -- en-CA is pinned to get YYYY-MM-DD for an <input type="date">, not a locale date.
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

/**
 * Convert an organization-local date and time (YYYY-MM-DDTHH:mm) into a UTC
 * instant. HTML date/time inputs deliberately omit an offset, so interpreting
 * them with `new Date(value)` would silently use the browser timezone instead
 * of the organization's timezone.
 */
export function localDateTimeToUtc(
  value: string,
  timezone: string,
): Date {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/)
  if (!match) throw new Error("Invalid local date-time")

  const [, year, month, day, hour, minute] = match
  const naiveUtc = new Date(Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
  ))
  if (
    naiveUtc.getUTCFullYear() !== Number(year)
    || naiveUtc.getUTCMonth() !== Number(month) - 1
    || naiveUtc.getUTCDate() !== Number(day)
    || naiveUtc.getUTCHours() !== Number(hour)
    || naiveUtc.getUTCMinutes() !== Number(minute)
  ) {
    throw new Error("Invalid local date-time")
  }

  const effectiveTimezone = isValidTimezone(timezone) ? timezone : "UTC"
  const first = new Date(naiveUtc.getTime() - getOffsetMinutes(effectiveTimezone, naiveUtc) * 60_000)
  return new Date(naiveUtc.getTime() - getOffsetMinutes(effectiveTimezone, first) * 60_000)
}

/**
 * Compute the UTC offset for an IANA timezone at a specific moment.
 * Returned in minutes (positive = east of UTC). Useful for displaying
 * "GMT+04:00" labels in UI without external libs.
 *
 * Falls back to 0 (UTC) on invalid timezone.
 */
export function getOffsetMinutes(timezone: string, at: Date = new Date()): number {
  if (!isValidTimezone(timezone)) return 0
  // Use Intl with offsetName "longOffset" and parse — most reliable cross-runtime.
  // Format yields strings like "GMT+04:00" / "GMT-05:30" / "GMT".
  try {
    // eslint-disable-next-line no-restricted-syntax -- parsing "GMT+04:00" into minutes; en-US is pinned so the regex holds.
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      timeZoneName: "longOffset",
    }).formatToParts(at)
    const tzPart = parts.find(p => p.type === "timeZoneName")?.value || ""
    // KNOWN: For UTC, Node yields pure "GMT" without an offset — regex misses,
    //   we fall through to `return 0`. That's the correct answer for UTC.
    //   Any unexpected string also returns 0 silently; not a bug.
    const m = tzPart.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/)
    if (!m) return 0
    const sign = m[1] === "-" ? -1 : 1
    const hours = parseInt(m[2], 10)
    const minutes = m[3] ? parseInt(m[3], 10) : 0
    return sign * (hours * 60 + minutes)
  } catch {
    return 0
  }
}

/**
 * Friendly label for UI dropdown: "Europe/Warsaw (GMT+02:00)".
 */
export function timezoneLabel(timezone: string, at: Date = new Date()): string {
  if (!isValidTimezone(timezone)) return timezone
  const offsetMin = getOffsetMinutes(timezone, at)
  const sign = offsetMin >= 0 ? "+" : "-"
  const abs = Math.abs(offsetMin)
  const hh = String(Math.floor(abs / 60)).padStart(2, "0")
  const mm = String(abs % 60).padStart(2, "0")
  return `${timezone} (GMT${sign}${hh}:${mm})`
}
