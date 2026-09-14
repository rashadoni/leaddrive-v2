/**
 * Read-side facts for the employee cards on «Агенты».
 *
 * Prod 2026-09-14: every card said «2 визита · 0% eff.» and an amber «не
 * активен» for the app, while the same agent's route for the day was 100% done
 * and the phone was sending a GPS point every ~30 seconds. Both figures read
 * fields the list never returned (`visitEffectiveness`, `expoPushToken`), so
 * the page printed its fallbacks as if they were facts.
 *
 * The card now shows only what it can derive from data it actually has:
 *   - plan fulfilment — the same inputs as analytics' `visitPlanFulfillment`
 *     (visited / planned route points over routes with a plan), for the same
 *     window analytics calls "weekly" (the last seven days). No planned points
 *     is `null`, not 0%: "nothing was planned" is not "nothing was done".
 *   - app activity — a fresh GPS point (or any other mobile call that stamps
 *     `lastSeenAt`) means the app is running. A push token says only whether
 *     notifications are connected, which is a separate, neutral fact.
 */

import { dateInputValueInTimezone, isValidTimezone } from "@/lib/timezone"
import { localDateKeyToUtc } from "@/lib/mtm/mobile-week"

/** Seven organization-local calendar days, today included. */
export const MTM_AGENT_CARD_ACTIVITY_DAYS = 7

/**
 * How fresh a mobile signal must be for "the app is active" — and for the
 * page's "online" dot and counter. One window, so a card never says "online"
 * and "no app signal" at the same time.
 */
export const MTM_AGENT_APP_ACTIVE_WINDOW_MS = 15 * 60 * 1000

export type MtmAgentCardActivity = {
  periodDays: number
  visits: number
  plannedPoints: number
  visitedPoints: number
  /** Whole percent, or null when nothing was planned in the window. */
  planFulfillment: number | null
}

function shiftDateKey(key: string, days: number): string {
  const date = new Date(`${key}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

/**
 * The card window as seven org-local days ending today.
 *
 * Review of #209: bounding routes only from below counted next week's already
 * planned routes, so an agent at 100% today with next week planned read ~20%.
 * `MtmRoute.date` is a `@db.Date` holding the org-local date at UTC midnight
 * (the workday convention), so routes take `routeDate`; visits are instants
 * and take `visitsSince`, the org-local midnight of the first day.
 */
export function mtmAgentActivityWindow(now: Date, timezone: string): {
  visitsSince: Date
  routeDate: { gte: Date; lte: Date }
} {
  const tz = isValidTimezone(timezone) ? timezone : "UTC"
  const todayKey = dateInputValueInTimezone(now, tz)
  const firstKey = shiftDateKey(todayKey, -(MTM_AGENT_CARD_ACTIVITY_DAYS - 1))
  return {
    visitsSince: localDateKeyToUtc(firstKey, tz),
    routeDate: {
      gte: new Date(`${firstKey}T00:00:00.000Z`),
      lte: new Date(`${todayKey}T00:00:00.000Z`),
    },
  }
}

/** Upper bound for route dates: today in the organization, never the future. */
export function mtmRouteDateTodayBound(now: Date, timezone: string): Date {
  const tz = isValidTimezone(timezone) ? timezone : "UTC"
  return new Date(`${dateInputValueInTimezone(now, tz)}T00:00:00.000Z`)
}

export function mtmAgentPlanFulfillment(plannedPoints: number, visitedPoints: number): number | null {
  if (!Number.isFinite(plannedPoints) || plannedPoints <= 0) return null
  const visited = Math.max(0, Number.isFinite(visitedPoints) ? visitedPoints : 0)
  return Math.round((Math.min(visited, plannedPoints) / plannedPoints) * 100)
}

export function mtmAgentCardActivity(input: {
  visits?: number | null
  plannedPoints?: number | null
  visitedPoints?: number | null
}): MtmAgentCardActivity {
  const plannedPoints = Math.max(0, input.plannedPoints ?? 0)
  const visitedPoints = Math.max(0, input.visitedPoints ?? 0)
  return {
    periodDays: MTM_AGENT_CARD_ACTIVITY_DAYS,
    visits: Math.max(0, input.visits ?? 0),
    plannedPoints,
    visitedPoints,
    planFulfillment: mtmAgentPlanFulfillment(plannedPoints, visitedPoints),
  }
}

export type MtmAgentAppState = "active" | "quiet" | "never"

export type MtmAgentAppActivity = {
  state: MtmAgentAppState
  /** Latest mobile signal the server received, ISO string. */
  lastSignalAt: string | null
  /** Whether a push token is registered. Says nothing about the app running. */
  notificationsConnected: boolean
}

function time(value: Date | string | null | undefined): number | null {
  if (!value) return null
  const ms = value instanceof Date ? value.getTime() : Date.parse(value)
  return Number.isFinite(ms) ? ms : null
}

export function mtmAgentAppActivity(input: {
  lastLocationAt?: Date | string | null
  lastSeenAt?: Date | string | null
  hasPushToken?: boolean
  now: Date | number
}): MtmAgentAppActivity {
  const now = typeof input.now === "number" ? input.now : input.now.getTime()
  const candidates = [time(input.lastLocationAt), time(input.lastSeenAt)].filter((ms): ms is number => ms !== null)
  const last = candidates.length ? Math.max(...candidates) : null
  const state: MtmAgentAppState = last === null
    ? "never"
    : now - last <= MTM_AGENT_APP_ACTIVE_WINDOW_MS ? "active" : "quiet"
  return {
    state,
    lastSignalAt: last === null ? null : new Date(last).toISOString(),
    notificationsConnected: Boolean(input.hasPushToken),
  }
}
