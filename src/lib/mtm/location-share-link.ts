import { defaultLocale, locales, type Locale } from "@/i18n/routing"
import { GPS_FRESHNESS, isLiveMapAdmissibleLocation, liveMapMaxAccuracyMeters } from "@/lib/mtm/live-location"
import { addDateKeyDays, currentDateKey, localDateKeyToUtc } from "@/lib/mtm/mobile-week"
import type { MtmWorkdayPause } from "@/lib/mtm/workday-pauses"
import { isValidTimezone } from "@/lib/timezone"

/**
 * «Ссылка на местоположение» — the rules, in one place.
 *
 * A manager opens an employee's card on the live map and makes a link; whoever
 * opens it, without signing in, sees where that one employee is now. This file
 * is what the managers' routes and the public answer share about such a link:
 * what its token looks like, how long it lives, when it is alive, and — the
 * rule that matters most — when an outsider may be shown a coordinate at all
 * (locationShareLinkPositionFor).
 *
 * Pure: no database, no request, no clock of its own — every function is given
 * `now`. The token is made and hashed by src/lib/one-time-token.ts; nothing of
 * node's crypto is imported here, so the page may import the constants.
 *
 * Not «location share»: that name is the employee sending his own position
 * from the phone (agent-permissions.ts, SELF_LOCATION_SHARE).
 */

// ─── How long ───────────────────────────────────────────────────────────────

/**
 * The three buttons: «На 1 час», «На 4 часа», «До конца дня». A request names
 * one of them and nothing else — a browser never sends a moment of expiry.
 */
export const LOCATION_SHARE_LINK_DURATIONS = ["1h", "4h", "day"] as const
export type LocationShareLinkDuration = typeof LOCATION_SHARE_LINK_DURATIONS[number]

const HOUR_MS = 60 * 60 * 1000
const DURATION_MS: Record<Exclude<LocationShareLinkDuration, "day">, number> = { "1h": HOUR_MS, "4h": 4 * HOUR_MS }

/** The organization's zone, or UTC when what is stored is not a zone at all. */
export function locationShareLinkTimezone(value: unknown): string {
  return isValidTimezone(value) ? value : "UTC"
}

/**
 * The first moment of a day of the organization's calendar (`dateKey`,
 * YYYY-MM-DD, in a zone already known to be one).
 *
 * Almost always its 00:00. Where the clocks are put forward AT midnight —
 * Santiago, Havana, the Azores — that night has no 00:00: the day begins at
 * 01:00, and the conversion lands an hour short, still inside the day
 * before. A link made in that last hour would end before it was made; the
 * table refuses such a row, and every button answered «не удалось». So a
 * moment that the calendar still calls the day before is walked forward, a
 * quarter of an hour at a time, until the day has begun — two hours at most,
 * more than any zone skips.
 */
function organizationDayStart(dateKey: string, zone: string): Date {
  let start = localDateKeyToUtc(dateKey, zone)
  for (let step = 0; step < 8 && currentDateKey(start, zone) < dateKey; step += 1) {
    start = new Date(start.getTime() + 15 * 60_000)
  }
  return start
}

/** The first moment of the organization's next day. */
function organizationNextMidnight(now: Date, timezone: string): Date {
  const zone = locationShareLinkTimezone(timezone)
  return organizationDayStart(addDateKeyDays(currentDateKey(now, zone), 1), zone)
}

/**
 * The first moment of the organization's today. The card lists the links
 * that no longer work only from here on: every link ends at midnight at the
 * latest, so an older one is yesterday's news and would otherwise trail
 * under an employee's card for ever.
 */
export function locationShareLinkTodayStartedAt(now: Date, timezone: string): Date {
  const zone = locationShareLinkTimezone(timezone)
  return organizationDayStart(currentDateKey(now, zone), zone)
}

/**
 * Until when a link made now works.
 *
 * Never past the organization's midnight, whichever button was pressed: «на 4
 * часа» at 22:30 ends at 00:00, not at 02:30. The shift it shows is today's,
 * and a link that outlived the day would be an open door into tomorrow's. The
 * answer to the creation says the real moment, so the manager is not told
 * «четыре часа» about a link of ninety minutes.
 */
export function locationShareLinkExpiresAt(duration: LocationShareLinkDuration, now: Date, timezone: string): Date {
  const midnight = organizationNextMidnight(now, timezone)
  if (duration === "day") return midnight
  return new Date(Math.min(now.getTime() + DURATION_MS[duration], midnight.getTime()))
}

/**
 * Whether a moment is the end of a day of the organization's calendar — the
 * very moment its next day begins, which is where every «до конца дня» link
 * ends and where a late «на 4 часа» is cut.
 *
 * Both screens ask this so as to say «до конца дня» in words: printed as a
 * clock the moment reads «до 00:00» (in English «until 12:00 AM»), which
 * names no day and looks like a mistake. The same first-moment-of-a-day as
 * the expiry above is counted from, so the two cannot disagree — on the
 * night the clocks skip midnight as well.
 */
export function isLocationShareLinkEndOfDay(moment: Date, timezone: string): boolean {
  const ms = moment instanceof Date ? moment.getTime() : Number.NaN
  if (!Number.isFinite(ms)) return false
  const zone = locationShareLinkTimezone(timezone)
  return organizationDayStart(currentDateKey(moment, zone), zone).getTime() === ms
}

// ─── Alive ──────────────────────────────────────────────────────────────────

/**
 * How many links of one employee may be alive at once. A link whose answer was
 * lost cannot be shown again (only its hash is kept), so a few are left lying
 * about by honest use; more than a few is a script.
 */
export const LOCATION_SHARE_LINK_ALIVE_LIMIT = 5

/**
 * A link is alive until it is revoked or its time is up. This is the row's
 * own part of the answer: the public route asks the organization's switch,
 * the organization and the employee as well, on every view.
 */
export function isLocationShareLinkAlive(link: { revokedAt: Date | null; expiresAt: Date }, now: Date): boolean {
  return link.revokedAt === null && link.expiresAt.getTime() > now.getTime()
}

/** The same rule as a filter for the table — one wording for the list, the limit and the predicate. */
export function locationShareLinkAliveWhere(now: Date) {
  return { revokedAt: null, expiresAt: { gt: now } } as const
}

// ─── The token and the link ─────────────────────────────────────────────────

const TOKEN_SHAPE = /^[a-f0-9]{64}$/

/**
 * What generateOneTimeToken() makes: 64 lowercase hex characters. Anything
 * else in the address is not a link of ours, and is answered without a hash
 * being computed or the database being asked.
 */
export function isLocationShareLinkToken(value: unknown): value is string {
  return typeof value === "string" && TOKEN_SHAPE.test(value)
}

/** Where the public page lives; the token follows. */
export const LOCATION_SHARE_LINK_PAGE_PATH = "/share/location/"

/** The language a link is read in: one of the product's three, Russian when it is none of them. */
export function locationShareLinkLocale(value: unknown): Locale {
  return (locales as readonly unknown[]).includes(value) ? value as Locale : defaultLocale
}

/**
 * The link as it is handed to the manager — once, in the answer to its
 * creation.
 *
 * Built here from the application's own address, never from the page's
 * `window.location`: on a tenant's subdomain a recipient who is signed in to
 * another organization would be thrown out to the login page. `?lang=` is the
 * language of the manager who made it — the recipient has no account and no
 * language cookie, and would otherwise always read Russian.
 */
export function buildLocationShareLinkUrl(token: string, locale: Locale): string {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || process.env.NEXTAUTH_URL || ""
  const path = `${LOCATION_SHARE_LINK_PAGE_PATH}${encodeURIComponent(token)}?lang=${locationShareLinkLocale(locale)}`
  return baseUrl ? `${baseUrl.replace(/\/$/, "")}${path}` : path
}

// ─── What an outsider may be shown ──────────────────────────────────────────

/**
 * The oldest coordinate an outsider is ever shown as «сейчас»: fifteen
 * minutes. The managers' map lets an organization stretch its own «свежая»
 * to a whole day (offlineThresholdSeconds up to 86 400); a stranger must not
 * be shown yesterday's position as today's, so this ceiling is not a setting.
 */
export const LOCATION_SHARE_LINK_MAX_AGE_SECONDS = GPS_FRESHNESS.delayedSeconds

/** The part of the organization's MTM settings the rule reads. */
export interface LocationShareLinkThresholds {
  offlineThresholdSeconds: number
  locationWindowMinutes: number
  historyMaxAccuracyMeters: number
}

/**
 * How vague a point may be and still be a position — the live roster's own
 * bound (GET /api/v1/mtm/locations, liveMapMaxAccuracyMeters), so the
 * outsider is never shown a point the manager's map refuses. A setting that
 * is not a number reads as the tightest bound, never as «any».
 */
export function locationShareLinkMaxAccuracyMeters(historyMaxAccuracyMeters: number): number {
  return liveMapMaxAccuracyMeters(Number.isFinite(historyMaxAccuracyMeters) ? historyMaxAccuracyMeters : 0)
}

/**
 * How old a coordinate may be. The organization's own «свежая» for the map
 * (as the roster computes `delayedSeconds`) may make this stricter and never
 * looser than the ceiling above.
 */
export function locationShareLinkMaxAgeSeconds(settings: LocationShareLinkThresholds): number {
  const own = Math.max(settings.offlineThresholdSeconds, settings.locationWindowMinutes * 60)
  if (!Number.isFinite(own) || own <= 0) return LOCATION_SHARE_LINK_MAX_AGE_SECONDS
  return Math.min(LOCATION_SHARE_LINK_MAX_AGE_SECONDS, own)
}

/** `workDate` of the organization's today, as mtm_agent_workdays stores a date: UTC midnight of that day. */
export function locationShareLinkTodayWorkDate(now: Date, timezone: string): Date {
  return new Date(`${currentDateKey(now, locationShareLinkTimezone(timezone))}T00:00:00.000Z`)
}

/** A row of mtm_agent_workdays, as much of it as the rule reads. */
export interface LocationShareLinkWorkday {
  status: string
  workDate: Date
  startedAt: Date
}

/** A row of mtm_agent_locations, as much of it as the rule reads. */
export interface LocationShareLinkCandidate {
  latitude: number
  longitude: number
  accuracy: number | null
  recordedAt: Date
}

export type LocationShareLinkPosition =
  | { state: "AVAILABLE"; latitude: number; longitude: number; recordedAt: Date }
  | { state: "UNAVAILABLE" }

const UNAVAILABLE: LocationShareLinkPosition = { state: "UNAVAILABLE" }

const timeOf = (value: Date | null | undefined): number | null => {
  const ms = value instanceof Date ? value.getTime() : Number.NaN
  return Number.isFinite(ms) ? ms : null
}

/**
 * When the shift he is in now began — or null when he is not on shift: no
 * workday, a break, a closed day, a shift left open since an earlier day.
 * The first half of the rule below, on its own for whoever reads the rows:
 * off shift nothing of where he is is read at all.
 */
export function locationShareLinkShiftStartedAt(
  workday: LocationShareLinkWorkday | null | undefined,
  now: Date,
  timezone: string,
): Date | null {
  if (timeOf(now) === null) return null
  if (!workday || workday.status !== "STARTED") return null
  const startedMs = timeOf(workday.startedAt)
  const workDateMs = timeOf(workday.workDate)
  if (startedMs === null || workDateMs === null) return null
  if (workDateMs !== locationShareLinkTodayWorkDate(now, timezone).getTime()) return null
  return new Date(startedMs)
}

/**
 * The moment his points are read from: the start of the shift he is in, or —
 * when he has had a break in it — the end of the last one.
 *
 * Where he spent a break is his own. The phone's regular reports are refused
 * by the server while a break runs, but not every way a point arrives is
 * (the batch ingestion and «поделиться своим местоположением» take one), so
 * a point from lunch can be in the table; without this bound it would be the
 * newest one the moment he pressed «продолжить», and a stranger would be
 * shown it until the phone reported again.
 *
 * `breaks` are the shift's own, as mtmWorkdayPauses reconstructs them from
 * its journal. Null — nothing may be read — when he is not on shift, when
 * the journal says a break is still running although the workday says he is
 * working, or when the breaks cannot be read at all: in doubt nothing is
 * shown. A point recorded at the very second he resumed is the first of the
 * new leg, as GPS ingestion counts it (isDuringMtmWorkdayPause).
 */
export function locationShareLinkPointsSince(
  shiftStartedAt: Date | null | undefined,
  breaks: readonly MtmWorkdayPause[] | null | undefined,
): Date | null {
  const startedMs = timeOf(shiftStartedAt)
  const pauses: readonly MtmWorkdayPause[] | null = Array.isArray(breaks) ? breaks : null
  if (startedMs === null || pauses === null) return null
  let sinceMs = startedMs
  for (const pause of pauses) {
    // No end: the break is still running.
    const endedMs = timeOf(pause.to)
    if (endedMs === null) return null
    if (endedMs > sinceMs) sinceMs = endedMs
  }
  return new Date(sinceMs)
}

/**
 * May an outsider be shown where the employee is — and if so, which point.
 *
 * Stricter than the managers' map, on purpose, and nothing here is the
 * organization's to loosen:
 *
 *   - he is on shift NOW: a workday that is STARTED and is today's, by the
 *     organization's calendar. On a break (PAUSED) nothing is shown. A shift
 *     left open since an earlier day shows nothing either: the managers' map
 *     keeps such a shift «active» so that somebody closes it, and a phone
 *     still tracking would put a person at home, at night, on a stranger's
 *     screen. The roster asks every organization for a field session, with
 *     or without the Workforce module, so there is no second notion of «on
 *     shift» to follow for anybody;
 *   - the point is one the roster itself would draw: on the globe, and exact
 *     enough (locationShareLinkMaxAccuracyMeters);
 *   - it was recorded during this shift and after his last break
 *     (locationShareLinkPointsSince), and not in the future — a phone whose
 *     clock runs ahead does not get to say «сейчас»;
 *   - it is at most fifteen minutes old, or less where the organization's own
 *     threshold is stricter.
 *
 * Anything else is UNAVAILABLE, with no reason: «на перерыве» and «смена не
 * начата» are facts about a person that the link was not made to tell.
 *
 * `location` is the candidate the caller selected — the newest row of
 * mtm_agent_locations of that employee with `recordedAt` between that moment
 * and now, never the latest-location projection (a vague point advances that
 * one). Every condition is checked again here, so a caller that selected too
 * widely still cannot show what must not be shown.
 */
export function locationShareLinkPositionFor(input: {
  workday: LocationShareLinkWorkday | null | undefined
  breaks: readonly MtmWorkdayPause[] | null | undefined
  location: LocationShareLinkCandidate | null | undefined
  settings: LocationShareLinkThresholds
  now: Date
  timezone: string
}): LocationShareLinkPosition {
  const { workday, location, settings, now } = input
  const nowMs = timeOf(now)
  if (nowMs === null) return UNAVAILABLE

  const sinceMs = timeOf(locationShareLinkPointsSince(locationShareLinkShiftStartedAt(workday, now, input.timezone), input.breaks))
  if (sinceMs === null) return UNAVAILABLE

  // The roster's own test of a row, with the roster's own bound.
  if (!location) return UNAVAILABLE
  if (!isLiveMapAdmissibleLocation(location, locationShareLinkMaxAccuracyMeters(settings.historyMaxAccuracyMeters))) return UNAVAILABLE

  const recordedMs = timeOf(location.recordedAt)
  if (recordedMs === null || recordedMs < sinceMs || recordedMs > nowMs) return UNAVAILABLE
  if (nowMs - recordedMs > locationShareLinkMaxAgeSeconds(settings) * 1000) return UNAVAILABLE

  return { state: "AVAILABLE", latitude: location.latitude, longitude: location.longitude, recordedAt: new Date(recordedMs) }
}
