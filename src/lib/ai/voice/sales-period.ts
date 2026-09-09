import { dateInputValueInTimezone, localDateTimeToUtc } from "@/lib/timezone"

/**
 * Turn what a person said about time into a concrete window.
 *
 * Kept apart from the reader so it can be tested without a database: every bug
 * this code can have is an off-by-one in a boundary, and those are only visible
 * when you can run December, January and leap years cheaply.
 */
type RelativeSalesPeriod = "this_month" | "last_month" | "this_quarter" | "this_year" | "last_year"

/** The only three request shapes accepted by the voice tool schema. */
export type SalesPeriodInput =
  | { period?: undefined; month?: undefined; year?: undefined }
  | { period: RelativeSalesPeriod; month?: never; year?: never }
  | { period?: never; month: number; year?: number }

const MONTHS_RU = [
  "январь", "февраль", "март", "апрель", "май", "июнь",
  "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь",
]

export function resolveSalesPeriod(
  input: SalesPeriodInput,
  now: Date,
  timezone = "UTC",
): { from: Date; to: Date; toExclusive: Date; label: string; timezone: string } {
  const localKey = dateInputValueInTimezone(now, timezone)
  if (!localKey) throw new Error("Could not resolve voice sales date")
  const [localYear, localMonth] = localKey.split("-").map(Number)
  const atMidnight = (year: number, month: number) =>
    localDateTimeToUtc(`${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-01T00:00`, timezone)
  const nextMonth = (year: number, month: number) => {
    const shifted = new Date(Date.UTC(year, month, 1))
    return atMidnight(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1)
  }
  const closedWindow = (year: number, month: number, label: string) => {
    const from = atMidnight(year, month)
    const toExclusive = nextMonth(year, month)
    return {
      from,
      to: new Date(toExclusive.getTime() - 1),
      toExclusive,
      label,
      timezone,
    }
  }

  if (input.month) {
    const month = input.month
    /*
     * No year given and the month is still ahead of us → the person means the
     * one that already happened. Asked in January, "in December" is last
     * December; answering with a December that has not arrived would return a
     * confident zero.
     */
    const year = input.year ?? (month > localMonth ? localYear - 1 : localYear)
    return closedWindow(year, month, `${MONTHS_RU[month - 1]} ${year}`)
  }

  const y = localYear
  switch (input.period) {
    case "last_month": {
      const d = new Date(Date.UTC(y, localMonth - 2, 1))
      const year = d.getUTCFullYear()
      const month = d.getUTCMonth() + 1
      return closedWindow(year, month, `${MONTHS_RU[month - 1]} ${year}`)
    }
    case "this_quarter": {
      const q = Math.floor((localMonth - 1) / 3)
      return {
        from: atMidnight(y, q * 3 + 1),
        to: now,
        toExclusive: now,
        label: `${q + 1} квартал ${y}`,
        timezone,
      }
    }
    case "this_year":
      return {
        from: atMidnight(y, 1),
        to: now,
        toExclusive: now,
        label: `${y} год`,
        timezone,
      }
    case "last_year": {
      const from = atMidnight(y - 1, 1)
      const toExclusive = atMidnight(y, 1)
      return {
        from,
        to: new Date(toExclusive.getTime() - 1),
        toExclusive,
        label: `${y - 1} год`,
        timezone,
      }
    }
    case "this_month":
    default:
      return {
        from: atMidnight(y, localMonth),
        to: now,
        toExclusive: now,
        label: `${MONTHS_RU[localMonth - 1]} ${y}`,
        timezone,
      }
  }
}
