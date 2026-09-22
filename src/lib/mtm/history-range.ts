import { LOCATION_HISTORY_MAX_RANGE_DAYS } from "@/lib/mtm/location-history"

/** The longest window the history API accepts (LOCATION_HISTORY_MAX_RANGE_DAYS). */
export const MAX_RANGE_DAYS = LOCATION_HISTORY_MAX_RANGE_DAYS

export function addDays(dateKey: string, days: number): string {
  return new Date(Date.parse(`${dateKey}T00:00:00.000Z`) + days * 86_400_000).toISOString().slice(0, 10)
}

/**
 * Owner 2026-09-22: «why can't I choose a range of dates to see where he was
 * these days and his path». The end date follows the start: never before it,
 * never more than a week after it.
 */
export function clampHistoryEndDate(startDate: string, endDate: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate) || endDate < startDate) return startDate
  const latest = addDays(startDate, MAX_RANGE_DAYS - 1)
  return endDate > latest ? latest : endDate
}
