/**
 * Locale-aware date formatting (i18n root #3 fix; field UX audit W-02).
 *
 * Replaces the scattered `new Date(x).toLocaleDateString(undefined, opts)`
 * and `new Intl.DateTimeFormat(locale, opts)` patterns. Passing `undefined`
 * as the locale makes the runtime fall back to the browser's (or server's)
 * default locale — NOT the app locale — so those dates silently ignore the
 * user's az / ru / en choice. These helpers take the locale explicitly.
 *
 * Azerbaijani is rendered deterministically. ICU builds without `az` data
 * (seen live in Chrome and on prod: "2026 M09 5, Sat", "Mon/Tue/Wed") fall
 * back to the root locale, so month and weekday names, the numeric date
 * order and the 24-hour clock are assembled here from the wall-clock parts
 * of the requested time zone. Every other locale goes straight to Intl.
 *
 * Pure + isomorphic: works in server, API routes, and client components.
 * In client components, get the locale from next-intl's `useLocale()` and pass
 * it in: `formatDate(value, locale, opts)`.
 *
 * Returns "" for null / undefined / empty / unparseable input so callers don't
 * have to guard every usage (matches the common `value ? … : "—"` pattern).
 */
export type DateInput = Date | string | number | null | undefined

/** A drop-in for `Intl.DateTimeFormat#format` that honours the helpers above. */
export type DateFormatter = { format: (value: DateInput) => string }

const AZ_MONTHS_SHORT = ["yan", "fev", "mar", "apr", "may", "iyn", "iyl", "avq", "sen", "okt", "noy", "dek"]
const AZ_MONTHS_LONG = ["yanvar", "fevral", "mart", "aprel", "may", "iyun", "iyul", "avqust", "sentyabr", "oktyabr", "noyabr", "dekabr"]
const AZ_WEEKDAYS_SHORT = ["baz", "b.e.", "ç.a.", "ç.", "c.a.", "c.", "ş."]
const AZ_WEEKDAYS_LONG = ["bazar", "bazar ertəsi", "çərşənbə axşamı", "çərşənbə", "cümə axşamı", "cümə", "şənbə"]
const EN_WEEKDAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

type DateFields = Pick<Intl.DateTimeFormatOptions, "weekday" | "day" | "month" | "year">
type TimeFields = Pick<Intl.DateTimeFormatOptions, "hour" | "minute" | "second">

type WallClock = {
  year: number
  month: number
  day: number
  weekday: number
  hour: number
  minute: number
  second: number
}

function parse(value: DateInput): Date | null {
  if (value === null || value === undefined || value === "") return null
  const d = value instanceof Date ? value : new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

function isAz(locale: string | undefined): boolean {
  return Boolean(locale && locale.toLowerCase().startsWith("az"))
}

function hasDateFields(options: Intl.DateTimeFormatOptions | undefined): boolean {
  return Boolean(options && (options.dateStyle || options.weekday || options.day || options.month || options.year))
}

function hasTimeFields(options: Intl.DateTimeFormatOptions | undefined): boolean {
  return Boolean(options && (options.timeStyle || options.hour || options.minute || options.second))
}

/**
 * Wall-clock fields of `d` in the requested zone (or the local zone). Read
 * through the locale-independent en-US numeric formatter so the arithmetic
 * never depends on az ICU data and DST/offsets are handled by Intl.
 */
function wallClock(d: Date, timeZone: string | undefined): WallClock {
  let parts: Intl.DateTimeFormatPart[]
  try {
    parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
      hourCycle: "h23",
      weekday: "short",
    }).formatToParts(d)
  } catch {
    // An invalid time zone name must not blank a date: fall back to local time.
    return {
      year: d.getFullYear(),
      month: d.getMonth(),
      day: d.getDate(),
      weekday: d.getDay(),
      hour: d.getHours(),
      minute: d.getMinutes(),
      second: d.getSeconds(),
    }
  }
  const map: Record<string, string> = {}
  for (const part of parts) if (part.type !== "literal") map[part.type] = part.value
  return {
    year: Number(map.year),
    month: Number(map.month) - 1,
    day: Number(map.day),
    weekday: Math.max(0, EN_WEEKDAYS_SHORT.indexOf(map.weekday)),
    hour: Number(map.hour) % 24,
    minute: Number(map.minute),
    second: Number(map.second),
  }
}

function azDateFields(options: Intl.DateTimeFormatOptions | undefined): DateFields {
  switch (options?.dateStyle) {
    case "full": return { weekday: "long", day: "numeric", month: "long", year: "numeric" }
    case "long": return { day: "numeric", month: "long", year: "numeric" }
    case "medium": return { day: "numeric", month: "short", year: "numeric" }
    case "short": return { day: "2-digit", month: "2-digit", year: "numeric" }
    default: break
  }
  if (!hasDateFields(options)) {
    // No date request at all: `toLocaleDateString(locale)` semantics.
    return hasTimeFields(options) ? {} : { day: "2-digit", month: "2-digit", year: "numeric" }
  }
  return { weekday: options?.weekday, day: options?.day, month: options?.month, year: options?.year }
}

function azTimeFields(options: Intl.DateTimeFormatOptions | undefined): TimeFields {
  switch (options?.timeStyle) {
    case "full":
    case "long":
    case "medium": return { hour: "2-digit", minute: "2-digit", second: "2-digit" }
    case "short": return { hour: "2-digit", minute: "2-digit" }
    default: break
  }
  return { hour: options?.hour, minute: options?.minute, second: options?.second }
}

function pad(value: number): string {
  return String(value).padStart(2, "0")
}

function azDate(clock: WallClock, fields: DateFields): string {
  const named = fields.month === "short" || fields.month === "long"
  const day = fields.day ? (fields.day === "2-digit" ? pad(clock.day) : String(clock.day)) : ""
  const year = fields.year ? (fields.year === "2-digit" ? pad(clock.year % 100) : String(clock.year)) : ""
  const month = fields.month
    ? named
      ? (fields.month === "long" ? AZ_MONTHS_LONG : AZ_MONTHS_SHORT)[clock.month]
      : fields.month === "2-digit" ? pad(clock.month + 1) : String(clock.month + 1)
    : ""
  const weekday = fields.weekday
    ? (fields.weekday === "long" ? AZ_WEEKDAYS_LONG : AZ_WEEKDAYS_SHORT)[clock.weekday]
    : ""
  // Named months read "5 sen 2026"; numeric dates use the Azerbaijani
  // dd.MM.yyyy order.
  const date = [day, month, year].filter(Boolean).join(named ? " " : ".")
  return [date, weekday].filter(Boolean).join(date && weekday ? ", " : "")
}

function azTime(clock: WallClock, fields: TimeFields): string {
  const pieces: string[] = []
  if (fields.hour) pieces.push(fields.hour === "2-digit" ? pad(clock.hour) : String(clock.hour))
  if (fields.minute || fields.hour) pieces.push(pad(clock.minute))
  if (fields.second) pieces.push(pad(clock.second))
  return pieces.join(":")
}

function formatAz(d: Date, options: Intl.DateTimeFormatOptions | undefined, includeTime: boolean): string {
  const clock = wallClock(d, options?.timeZone)
  const date = azDate(clock, azDateFields(options))
  const time = includeTime && hasTimeFields(options) ? azTime(clock, azTimeFields(options)) : ""
  return [date, time].filter(Boolean).join(", ")
}

export function formatDate(
  date: DateInput,
  locale: string,
  options?: Intl.DateTimeFormatOptions,
): string {
  const d = parse(date)
  if (!d) return ""
  if (isAz(locale)) return formatAz(d, options, false)
  return d.toLocaleDateString(locale, options)
}

/**
 * Time of day only. Defaults to hours and minutes; Azerbaijani is always
 * the 24-hour clock that the root-locale fallback cannot be trusted to give.
 */
export function formatTime(
  date: DateInput,
  locale: string,
  options: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit" },
): string {
  const d = parse(date)
  if (!d) return ""
  if (isAz(locale)) {
    const clock = wallClock(d, options.timeZone)
    return azTime(clock, azTimeFields(hasTimeFields(options) ? options : { hour: "2-digit", minute: "2-digit" }))
  }
  return d.toLocaleTimeString(locale, options)
}

/**
 * Locale-aware date + time formatting. Same invalid-input guard as
 * {@link formatDate}. Defaults to short date + short time; override via
 * `options` (any mix of `dateStyle`/`timeStyle` or explicit fields).
 */
export function formatDateTime(
  date: DateInput,
  locale: string,
  options?: Intl.DateTimeFormatOptions,
): string {
  const d = parse(date)
  if (!d) return ""
  const resolved = options ?? { dateStyle: "short", timeStyle: "short" }
  if (isAz(locale)) return formatAz(d, resolved, true)
  return d.toLocaleString(locale, resolved)
}

/** Weekday name alone, e.g. column headers of the team week. */
export function formatWeekday(date: DateInput, locale: string, style: "short" | "long" = "short", timeZone?: string): string {
  return formatDate(date, locale, { weekday: style, ...(timeZone ? { timeZone } : {}) })
}

/**
 * Drop-in for `new Intl.DateTimeFormat(locale, options)` in components that
 * build one formatter and call `.format()` many times. Options with a time
 * component render date and time; otherwise the date alone.
 */
export function createDateFormatter(locale: string, options?: Intl.DateTimeFormatOptions): DateFormatter {
  const withTime = hasTimeFields(options)
  return {
    format: (value) => (withTime ? formatDateTime(value, locale, options) : formatDate(value, locale, options)),
  }
}
