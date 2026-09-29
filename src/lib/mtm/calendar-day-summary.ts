import type { MtmRouteStatus } from "@/components/mtm/route-types"

/**
 * One day of the team calendar in numbers (routes audit 2026-09-26, item 2).
 *
 * A cell listed three routes and «+ещё 6» — nine agents a day on the demo
 * tenant — with the text cut off, and the month still did not answer the one
 * question a manager opens it with: who did not do the plan. The cell now
 * carries the day in numbers and the day's list opens on a click.
 */
type CalendarRoute = { status: MtmRouteStatus; totalPoints: number; visitedPoints: number }

export type MtmCalendarDaySummary = {
  /** Every route of the day except withdrawn ones. */
  routes: number
  /** Not published: the agent has not seen them. */
  drafts: number
  /** Stops on published routes, and how many of them were visited. */
  planned: number
  visited: number
  /** Routes that are over with stops left unvisited. */
  missed: number
}

/**
 * A route is over when the agent finished it, the day-close job marked it
 * INCOMPLETE, or its day has passed — «Завершён» at 3 of 5 stops is still two
 * stops nobody visited.
 */
export function isMtmRouteShortOfPlan(route: CalendarRoute, dayIsPast: boolean): boolean {
  if (route.status === "DRAFT" || route.status === "CANCELLED") return false
  const over = route.status === "COMPLETED" || route.status === "INCOMPLETE" || dayIsPast
  return over && route.visitedPoints < route.totalPoints
}

export function summarizeMtmCalendarDay(routes: readonly CalendarRoute[], dayIsPast: boolean): MtmCalendarDaySummary {
  const active = routes.filter((route) => route.status !== "CANCELLED")
  const published = active.filter((route) => route.status !== "DRAFT")
  return {
    routes: active.length,
    drafts: active.length - published.length,
    planned: published.reduce((sum, route) => sum + route.totalPoints, 0),
    visited: published.reduce((sum, route) => sum + Math.min(route.visitedPoints, route.totalPoints), 0),
    missed: published.filter((route) => isMtmRouteShortOfPlan(route, dayIsPast)).length,
  }
}
