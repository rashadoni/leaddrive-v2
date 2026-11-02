import { addDateKeyDays, isDateKey, localDateKeyToUtc, startOfIsoWeekDateKey } from "@/lib/mtm/mobile-week"
import { dateInputValueInTimezone } from "@/lib/timezone"

/**
 * The period of an MTM report: a preset or the manager's own «from — to».
 *
 * Owner, 2026-11-01: «нет от какой даты до какой даты». Until then a report
 * could show only today, the last seven days or this month, and two of the
 * report APIs counted those from the server's own midnight (UTC), so in Baku
 * a morning visit fell into yesterday. Every bound here is an organization-
 * local day, and the end is exclusive: the next day's local midnight.
 */
export const REPORT_PRESETS = ["today", "week", "month", "lastMonth", "quarter"] as const
export type ReportPreset = (typeof REPORT_PRESETS)[number]

/** A custom range longer than this is refused rather than read. */
export const MAX_REPORT_DAYS = 366

export interface ReportRange {
  preset: ReportPreset | "custom"
  /** First day, organization-local, inclusive. */
  fromKey: string
  /** Last day, organization-local, inclusive. */
  toKey: string
  /** Local midnight of `fromKey`. */
  start: Date
  /** Local midnight of the day after `toKey`: `createdAt < end`. */
  end: Date
  days: number
}

function monthStart(key: string): string {
  return `${key.slice(0, 7)}-01`
}

function presetBounds(preset: ReportPreset, todayKey: string): [string, string] {
  switch (preset) {
    case "today": return [todayKey, todayKey]
    // «Bu həftə» is the week since Monday, as on «Analitika» — it used to be
    // the last seven days here, and the two pages told different numbers.
    case "week": return [startOfIsoWeekDateKey(todayKey), todayKey]
    case "month": return [monthStart(todayKey), todayKey]
    case "lastMonth": {
      const lastDay = addDateKeyDays(monthStart(todayKey), -1)
      return [monthStart(lastDay), lastDay]
    }
    case "quarter": {
      const month = Number(todayKey.slice(5, 7))
      const first = String(month - ((month - 1) % 3)).padStart(2, "0")
      return [`${todayKey.slice(0, 4)}-${first}-01`, todayKey]
    }
  }
}

export function daysBetween(fromKey: string, toKey: string): number {
  return Math.round((Date.parse(`${toKey}T00:00:00Z`) - Date.parse(`${fromKey}T00:00:00Z`)) / 86_400_000) + 1
}

function rangeOf(preset: ReportRange["preset"], fromKey: string, toKey: string, timezone: string): ReportRange {
  return {
    preset,
    fromKey,
    toKey,
    start: localDateKeyToUtc(fromKey, timezone),
    end: localDateKeyToUtc(addDateKeyDays(toKey, 1), timezone),
    days: daysBetween(fromKey, toKey),
  }
}

/**
 * `from` and `to` (YYYY-MM-DD) when both are given, else `period`. Unknown
 * presets read as «this week», the page's default. A range turned around, or
 * longer than a year, is an error the caller answers with 400.
 */
export function resolveReportRange(
  params: URLSearchParams,
  todayKey: string,
  timezone: string,
): ReportRange | { error: "invalid_range" | "range_too_long" } {
  const from = params.get("from")
  const to = params.get("to")
  if (from || to) {
    if (!isDateKey(from) || !isDateKey(to) || from > to) return { error: "invalid_range" }
    if (daysBetween(from, to) > MAX_REPORT_DAYS) return { error: "range_too_long" }
    return rangeOf("custom", from, to, timezone)
  }
  const asked = params.get("period")
  const preset = (REPORT_PRESETS as readonly string[]).includes(asked ?? "") ? asked as ReportPreset : "week"
  const [fromKey, toKey] = presetBounds(preset, todayKey)
  return rangeOf(preset, fromKey, toKey, timezone)
}

/** The same number of days right before `range`: what «compared with the previous period» compares with. */
export function previousReportRange(range: ReportRange, timezone: string): ReportRange {
  const toKey = addDateKeyDays(range.fromKey, -1)
  return rangeOf("custom", addDateKeyDays(toKey, -(range.days - 1)), toKey, timezone)
}

/** Every day of the range, oldest first. */
export function reportDayKeys(range: Pick<ReportRange, "fromKey" | "toKey">): string[] {
  const out: string[] = []
  for (let key = range.fromKey, guard = 0; key <= range.toKey && guard < MAX_REPORT_DAYS + 1; key = addDateKeyDays(key, 1), guard++) out.push(key)
  return out
}

/**
 * Values summed by organization-local day over the whole range — a day with
 * nothing is a 0, not a missing point, so a line does not jump over it.
 */
export function reportDailySeries(
  items: ReadonlyArray<{ at: Date; value?: number }>,
  range: Pick<ReportRange, "fromKey" | "toKey">,
  timezone: string,
): { date: string; count: number }[] {
  const sums = new Map<string, number>()
  for (const item of items) {
    const key = dateInputValueInTimezone(item.at, timezone)
    sums.set(key, (sums.get(key) ?? 0) + (item.value ?? 1))
  }
  return reportDayKeys(range).map((date) => ({ date, count: Math.round((sums.get(date) ?? 0) * 100) / 100 }))
}

/**
 * How much of a monthly plan line falls into the range: a plan for November
 * read for one week of November is a quarter of it, not all of it, and a plan
 * that started before the range is not lost (before, `periodStart >= start`
 * dropped a month's plan from every week but the first).
 */
export function planShareInRange(periodStart: Date, range: Pick<ReportRange, "fromKey" | "toKey">): number {
  const planFrom = periodStart.toISOString().slice(0, 10)
  const planTo = addDateKeyDays(`${addDateKeyDays(`${planFrom.slice(0, 7)}-28`, 4).slice(0, 7)}-01`, -1)
  const from = planFrom > range.fromKey ? planFrom : range.fromKey
  const to = planTo < range.toKey ? planTo : range.toKey
  if (from > to) return 0
  return daysBetween(from, to) / daysBetween(planFrom, planTo)
}
