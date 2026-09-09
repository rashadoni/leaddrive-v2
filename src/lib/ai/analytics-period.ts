import { dateInputValueInTimezone, localDateTimeToUtc } from "@/lib/timezone"

export const ANALYTICS_PERIODS = [
  "today",
  "yesterday",
  "this_week",
  "last_7_days",
  "this_month",
  "last_30_days",
  "last_month",
  "this_quarter",
  "this_year",
  "all_time",
  "custom",
] as const

export type AnalyticsPeriod = (typeof ANALYTICS_PERIODS)[number]

export type AnalyticsPeriodInput = {
  period: AnalyticsPeriod
  dateFrom?: string
  dateTo?: string
}

export type ResolvedAnalyticsPeriod = {
  period: AnalyticsPeriod
  label: string
  timezone: string
  from: Date
  /** Every analytics query uses `[from, toExclusive)` — never an inclusive date-only midnight. */
  toExclusive: Date
  dateFrom: string | null
  dateTo: string | null
}

type DateParts = { year: number; month: number; day: number }

function parseDateKey(value: string): DateParts {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) throw new Error("Date must use YYYY-MM-DD")
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const check = new Date(Date.UTC(year, month - 1, day))
  if (
    check.getUTCFullYear() !== year
    || check.getUTCMonth() !== month - 1
    || check.getUTCDate() !== day
  ) {
    throw new Error("Invalid calendar date")
  }
  return { year, month, day }
}

function dateKey(parts: DateParts): string {
  return `${parts.year.toString().padStart(4, "0")}-${parts.month.toString().padStart(2, "0")}-${parts.day.toString().padStart(2, "0")}`
}

function shiftDateKey(value: string, days: number): string {
  const { year, month, day } = parseDateKey(value)
  const shifted = new Date(Date.UTC(year, month - 1, day + days))
  return dateKey({
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  })
}

function firstOfMonth(value: string): string {
  const { year, month } = parseDateKey(value)
  return dateKey({ year, month, day: 1 })
}

function firstOfQuarter(value: string): string {
  const { year, month } = parseDateKey(value)
  return dateKey({ year, month: Math.floor((month - 1) / 3) * 3 + 1, day: 1 })
}

function firstOfYear(value: string): string {
  const { year } = parseDateKey(value)
  return dateKey({ year, month: 1, day: 1 })
}

function shiftMonth(value: string, months: number): string {
  const { year, month } = parseDateKey(value)
  const shifted = new Date(Date.UTC(year, month - 1 + months, 1))
  return dateKey({
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: 1,
  })
}

function localMidnight(date: string, timezone: string): Date {
  return localDateTimeToUtc(`${date}T00:00`, timezone)
}

/**
 * Resolve natural reporting periods in the authenticated user's effective IANA
 * timezone. Date-only custom ranges are inclusive to the user, but become an
 * end-exclusive UTC interval for Prisma (`gte` + `lt`).
 */
export function resolveAnalyticsPeriod(
  input: AnalyticsPeriodInput,
  now: Date,
  timezone: string,
): ResolvedAnalyticsPeriod {
  if (Number.isNaN(now.getTime())) throw new Error("Invalid current time")

  const today = dateInputValueInTimezone(now, timezone)
  if (!today) throw new Error("Could not resolve current date")

  let fromKey: string
  let fromInstant: Date | null = null
  let toKeyInclusive: string | null = today
  let toExclusive: Date = now

  switch (input.period) {
    case "today":
      fromKey = today
      break
    case "yesterday":
      fromKey = shiftDateKey(today, -1)
      toKeyInclusive = fromKey
      toExclusive = localMidnight(today, timezone)
      break
    case "this_week": { // ISO week: Monday 00:00 in the user's timezone.
      const { year, month, day } = parseDateKey(today)
      const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay()
      fromKey = shiftDateKey(today, -(weekday === 0 ? 6 : weekday - 1))
      break
    }
    case "last_7_days":
      fromInstant = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
      fromKey = dateInputValueInTimezone(fromInstant, timezone)
      break
    case "this_month":
      fromKey = firstOfMonth(today)
      break
    case "last_30_days":
      fromInstant = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
      fromKey = dateInputValueInTimezone(fromInstant, timezone)
      break
    case "last_month": {
      fromKey = shiftMonth(firstOfMonth(today), -1)
      const currentMonth = firstOfMonth(today)
      toKeyInclusive = shiftDateKey(currentMonth, -1)
      toExclusive = localMidnight(currentMonth, timezone)
      break
    }
    case "this_quarter":
      fromKey = firstOfQuarter(today)
      break
    case "this_year":
      fromKey = firstOfYear(today)
      break
    case "all_time":
      fromKey = "1970-01-01"
      toKeyInclusive = today
      break
    case "custom": {
      if (!input.dateFrom || !input.dateTo) {
        throw new Error("Custom period requires dateFrom and dateTo")
      }
      parseDateKey(input.dateFrom)
      parseDateKey(input.dateTo)
      if (input.dateFrom > input.dateTo) throw new Error("dateFrom must not be after dateTo")
      fromKey = input.dateFrom
      toKeyInclusive = input.dateTo
      toExclusive = localMidnight(shiftDateKey(input.dateTo, 1), timezone)
      break
    }
  }

  const from = fromInstant ?? localMidnight(fromKey, timezone)
  if (from.getTime() >= toExclusive.getTime()) throw new Error("Reporting period is empty")

  return {
    period: input.period,
    label: toKeyInclusive && fromKey !== toKeyInclusive ? `${fromKey} — ${toKeyInclusive}` : fromKey,
    timezone,
    from,
    toExclusive,
    dateFrom: input.period === "all_time" ? null : fromKey,
    dateTo: input.period === "all_time" ? null : toKeyInclusive,
  }
}
