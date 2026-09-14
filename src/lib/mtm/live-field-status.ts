import type { MtmFieldStatus, MtmGpsFreshness } from "@/lib/mtm-types"

/**
 * What the live map says an employee is doing right now.
 *
 * Prod audit 2026-09-14: Anar Mammadov had closed both stops of his route and
 * was standing still, and the map called him «Yolda». The old derivation fell
 * through to ON_ROAD for anyone whose app was online, so "on the road" meant
 * "the phone is on" — including after the day's work was done.
 *
 * Two facts decide it now, in this order:
 *
 * 1. GPS is not fresh → OFFLINE. Nothing below can be claimed from an old point.
 * 2. An open visit → CHECKED_IN.
 * 3. The route is over (closed by the agent or the day-close job, or every
 *    stop is visited) → ROUTE_FINISHED. Movement after that is not route work.
 * 4. A published route not started past the tenant's late hour → LATE.
 * 5. Moving → ON_ROAD.
 * 6. Online but not moving → STOPPED.
 * 7. Otherwise OFFLINE.
 */
export interface MtmLiveFieldStatusInput {
  freshness: MtmGpsFreshness
  isCheckedIn: boolean
  isOnline: boolean
  isMoving: boolean
  route: {
    status: string
    totalPoints: number
    visitedPoints: number
  } | null
  tenantHour: number
  lateAfterHour: number
}

const FINISHED_ROUTE_STATUSES = new Set(["COMPLETED", "INCOMPLETE", "CANCELLED"])

export function isMtmRouteFinished(route: MtmLiveFieldStatusInput["route"]): boolean {
  if (!route) return false
  if (FINISHED_ROUTE_STATUSES.has(route.status)) return true
  return route.status === "IN_PROGRESS" && route.totalPoints > 0 && route.visitedPoints >= route.totalPoints
}

export function deriveMtmLiveFieldStatus(input: MtmLiveFieldStatusInput): MtmFieldStatus {
  if (input.freshness === "STALE" || input.freshness === "NO_LOCATION") return "OFFLINE"
  if (input.isCheckedIn) return "CHECKED_IN"
  if (isMtmRouteFinished(input.route)) return "ROUTE_FINISHED"
  if (input.route?.status === "PLANNED" && input.isOnline && input.tenantHour >= input.lateAfterHour) return "LATE"
  if (input.isMoving && (input.isOnline || input.route?.status === "IN_PROGRESS")) return "ON_ROAD"
  if (input.isOnline) return "STOPPED"
  return "OFFLINE"
}
