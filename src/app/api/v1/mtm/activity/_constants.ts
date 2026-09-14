import { addDateKeyDays, currentDateKey, localDateKeyToUtc } from "@/lib/mtm/mobile-week"

/**
 * Shared constants for the MTM Activity route.
 *
 * Lives outside route.ts so the route file exports only handlers (Next.js
 * route-type constraint), while the regression test asserts against this
 * single source of truth (src/__tests__/api-mtm-activity.test.ts).
 */

/** Hard cap on page size. Bumping the cap is a one-line change here. */
export const MAX_PAGE_LIMIT = 100

/**
 * Reads are not activity. Prod 2026-09-14: the manager's journal was full of
 * GPS_HISTORY_VIEW and WEEK_GPS_LATEST_READ — the office looking at the map —
 * between the two real check-ins of the day. Those rows stay in the audit log
 * (who looked at whose location is evidence), they just are not the feed.
 * Any action ending in _READ or _VIEW is a viewer event by naming convention.
 */
export const VIEWER_READ_ACTION_SUFFIXES = ["_READ", "_VIEW"] as const
/** Viewer events whose names do not follow the suffix convention. */
export const VIEWER_READ_ACTIONS = ["ROUTE_TRAVEL_PREVIEW"] as const

/**
 * Inclusive start of the selected period at ORGANIZATION-local midnight, or
 * null for "all". It used to be the server's own midnight: the box runs in
 * UTC, Baku is UTC+4, so "today" began at 04:00 local and a 01:30 check-in
 * belonged to yesterday.
 */
export function activityPeriodStart(period: string, now: Date, timezone: string): Date | null {
  if (period === "all") return null
  const todayKey = currentDateKey(now, timezone)
  const days = period === "7d" ? 6 : period === "30d" ? 29 : 0 // "today" (default)
  return localDateKeyToUtc(addDateKeyDays(todayKey, -days), timezone)
}

