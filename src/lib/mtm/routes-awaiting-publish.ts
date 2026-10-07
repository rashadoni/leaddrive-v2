import type { MtmRouteRecord } from "@/components/mtm/route-types"

/**
 * Routes that are saved but that nobody can work by yet.
 *
 * 2026-10-06: a field agent built his route, the app answered «saved», and he
 * could not start it — it was a draft waiting for a manager. The manager, on
 * her side, was told nothing: the draft was one more row among two hundred,
 * and the notification goes only to the agent, once the route is published.
 * The owner the same night: the manager must see that a route was sent.
 *
 * A draft counts when someone is waiting on it: it has stops, and its day has
 * not passed. Yesterday's unpublished draft is history, not a to-do; an empty
 * one is a route the planner abandoned.
 */
export interface RouteAwaitingPublish {
  route: MtmRouteRecord
  agentName: string
  stops: number
}

export function routesAwaitingPublish(
  routes: readonly MtmRouteRecord[],
  todayKey: string,
): RouteAwaitingPublish[] {
  return routes
    .filter((route) => route.status === "DRAFT" && typeof route.date === "string" && route.date.slice(0, 10) >= todayKey)
    .map((route) => ({
      route,
      agentName: route.agent?.name?.trim() || "—",
      stops: Math.max(route.totalPoints ?? 0, route.points?.length ?? 0),
    }))
    .filter((item) => item.stops > 0)
    // The nearest day first: that agent is the one standing still.
    .sort((left, right) => (
      left.route.date.slice(0, 10).localeCompare(right.route.date.slice(0, 10))
      || left.agentName.localeCompare(right.agentName)
    ))
}
