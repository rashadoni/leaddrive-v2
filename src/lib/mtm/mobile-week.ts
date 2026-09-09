import { dateInputValueInTimezone, getOffsetMinutes } from "@/lib/timezone"

export type PersistedRouteStatus =
  | "DRAFT"
  | "PLANNED"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "INCOMPLETE"
  | "CANCELLED"

/**
 * MISSED is derived here for a day that is over and still has stops left. Once
 * the mtm-route-day-close job has run, the same condition is persisted as
 * INCOMPLETE and no longer needs deriving. The two words for one condition are
 * deliberate for now and belong to task A5 (one status dictionary) to unify.
 */
export type EffectiveRouteStatus = PersistedRouteStatus | "MISSED"

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/

export function isDateKey(value: unknown): value is string {
  if (typeof value !== "string" || !DATE_KEY.test(value)) return false
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

export function addDateKeyDays(value: string, amount: number): string {
  if (!isDateKey(value)) throw new Error("Invalid date key")
  const date = new Date(`${value}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + amount)
  return date.toISOString().slice(0, 10)
}

export function startOfIsoWeekDateKey(value: string): string {
  if (!isDateKey(value)) throw new Error("Invalid date key")
  const date = new Date(`${value}T00:00:00.000Z`)
  const day = date.getUTCDay()
  date.setUTCDate(date.getUTCDate() - (day === 0 ? 6 : day - 1))
  return date.toISOString().slice(0, 10)
}

export function currentDateKey(now: Date, timezone: string): string {
  return dateInputValueInTimezone(now, timezone)
}

/**
 * Convert organization-local midnight to UTC without adding a timezone
 * dependency. The second offset pass handles the common DST-boundary case
 * where the offset at naive UTC midnight differs from the local instant.
 */
export function localDateKeyToUtc(value: string, timezone: string): Date {
  if (!isDateKey(value)) throw new Error("Invalid date key")
  const naiveUtc = new Date(`${value}T00:00:00.000Z`)
  const first = new Date(naiveUtc.getTime() - getOffsetMinutes(timezone, naiveUtc) * 60_000)
  return new Date(naiveUtc.getTime() - getOffsetMinutes(timezone, first) * 60_000)
}

export function effectiveRouteStatus(
  route: {
    status: PersistedRouteStatus
    date: Date | string
    totalPoints: number
    visitedPoints: number
  },
  todayDateKey: string,
  calendarDay: { isWorkingDay: boolean; routePlanningAllowed: boolean } | null = null,
): EffectiveRouteStatus {
  // Terminal states describe themselves. INCOMPLETE is terminal too: the server
  // has already decided this day is over, so deriving MISSED on top of it would
  // replace a stored fact with a guess.
  if (
    route.status === "DRAFT" ||
    route.status === "COMPLETED" ||
    route.status === "CANCELLED" ||
    route.status === "INCOMPLETE"
  ) {
    return route.status
  }

  const routeDateKey = route.date instanceof Date
    ? route.date.toISOString().slice(0, 10)
    : route.date.slice(0, 10)
  const hasOutstandingStops = route.totalPoints > 0 && route.visitedPoints < route.totalPoints
  const executionExpected = calendarDay
    ? calendarDay.isWorkingDay || calendarDay.routePlanningAllowed
    : true
  if (routeDateKey < todayDateKey && hasOutstandingStops && executionExpected) return "MISSED"
  return route.status
}

export function effectiveRoutePointStatus(
  pointStatus: string,
  routeStatus: EffectiveRouteStatus,
): "PENDING" | "VISITED" | "MISSED" {
  if (pointStatus === "VISITED") return "VISITED"
  // A stop nobody reached on a day that is over is missed, whether that day was
  // closed by the job (INCOMPLETE) or is still being derived as MISSED. Without
  // the INCOMPLETE arm, closing the route would quietly turn its unvisited stops
  // back into "pending", i.e. still to do.
  if (pointStatus === "SKIPPED" || routeStatus === "MISSED" || routeStatus === "INCOMPLETE") return "MISSED"
  return "PENDING"
}

export function isWeekendDateKey(value: string): boolean {
  if (!isDateKey(value)) throw new Error("Invalid date key")
  const day = new Date(`${value}T00:00:00.000Z`).getUTCDay()
  return day === 0 || day === 6
}
