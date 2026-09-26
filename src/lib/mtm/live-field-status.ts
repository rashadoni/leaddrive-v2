import { calculateDistance } from "@/lib/geo-utils"
import type { MtmFieldStatus, MtmGpsFreshness } from "@/lib/mtm-types"

/**
 * What the live map says an employee is doing right now.
 *
 * Prod audit 2026-09-14: Anar Mammadov had closed both stops of his route and
 * was standing still, and the map called him «Yolda». The old derivation fell
 * through to ON_ROAD for anyone whose app was online, so "on the road" meant
 * "the phone is on" — including after the day's work was done.
 *
 * Order of precedence:
 *
 * 1. GPS is not fresh → OFFLINE. Nothing below can be claimed from an old point.
 * 2. An open visit → CHECKED_IN.
 * 3. The day's routes are over → ROUTE_FINISHED. Movement after that is not
 *    route work.
 * 4. Published routes not started past the tenant's late hour → LATE.
 * 5. Moving → ON_ROAD. "Moving" is judged over the last few minutes, not one
 *    sample (see {@link isMtmAgentMoving}).
 * 6. Online but not moving → STOPPED.
 * 7. Otherwise OFFLINE.
 */

export interface MtmLiveRouteFact {
  status: string
  totalPoints: number
  visitedPoints: number
}

/**
 * All of an employee's routes for the day, read as one.
 *
 * - `FINISHED`    — every route that counts is closed or fully visited;
 * - `NOT_STARTED` — every route that counts is published and untouched;
 * - `ACTIVE`      — anything in between.
 */
export interface MtmDayRouteState {
  state: "FINISHED" | "ACTIVE" | "NOT_STARTED"
  totalPoints: number
  visitedPoints: number
  completion: number
}

export interface MtmLiveFieldStatusInput {
  freshness: MtmGpsFreshness
  isCheckedIn: boolean
  isOnline: boolean
  isMoving: boolean
  dayRoutes: MtmDayRouteState | null
  tenantHour: number
  lateAfterHour: number
}

const CLOSED_ROUTE_STATUSES = new Set(["COMPLETED", "INCOMPLETE"])
/** A draft was never handed to the agent; a cancelled route is not work. */
const NON_WORK_ROUTE_STATUSES = new Set(["DRAFT", "CANCELLED"])

function isRouteFinished(route: MtmLiveRouteFact): boolean {
  return CLOSED_ROUTE_STATUSES.has(route.status) || (route.totalPoints > 0 && route.visitedPoints >= route.totalPoints)
}

/**
 * Review of #205: an agent can hold several routes a day, and the endpoint
 * kept whichever row the database returned last. A cancelled morning route
 * then read «Marşrut bitib» while the afternoon route was running. Routes are
 * now combined, drafts and cancelled routes do not count, and "finished" needs
 * every counted route to be finished.
 */
export function combineMtmDayRoutes(routes: MtmLiveRouteFact[]): MtmDayRouteState | null {
  const counted = routes.filter((route) => !NON_WORK_ROUTE_STATUSES.has(route.status))
  if (counted.length === 0) return null
  const totalPoints = counted.reduce((sum, route) => sum + Math.max(0, route.totalPoints), 0)
  const visitedPoints = counted.reduce((sum, route) => sum + Math.max(0, route.visitedPoints), 0)
  const completion = totalPoints > 0 ? Math.round((Math.min(visitedPoints, totalPoints) / totalPoints) * 100) : 0
  const state: MtmDayRouteState["state"] = counted.every(isRouteFinished)
    ? "FINISHED"
    : counted.every((route) => route.status === "PLANNED" && route.visitedPoints === 0)
      ? "NOT_STARTED"
      : "ACTIVE"
  return { state, totalPoints, visitedPoints, completion }
}

export const MTM_STOPPED_DWELL_MS = 5 * 60_000
export const MTM_STOPPED_RADIUS_METERS = 50

export interface MtmMovementSample {
  latitude: number
  longitude: number
  recordedAt: Date | string
  isMoving?: boolean | null
  speed?: number | null
}

function sampleMs(sample: MtmMovementSample): number {
  return sample.recordedAt instanceof Date ? sample.recordedAt.getTime() : Date.parse(sample.recordedAt)
}

function sampleMoving(sample: MtmMovementSample): boolean {
  return sample.isMoving === true || (typeof sample.speed === "number" && sample.speed > 1)
}

/**
 * Is the agent moving, judged over a short dwell rather than one sample?
 *
 * Review of #205: one motionless sample at a red light flipped «Yolda» to
 * «Dayanıb». An agent counts as stopped only when, for the last
 * {@link MTM_STOPPED_DWELL_MS}, no sample reported movement (flag or speed
 * above 1 m/s) and every sample stayed within {@link MTM_STOPPED_RADIUS_METERS}
 * of the newest one. `lastMovingAt` is the newest moving sample the database
 * holds for that window, so a sparse set of loaded points cannot hide it.
 */
export function isMtmAgentMoving(input: {
  samples: MtmMovementSample[]
  lastMovingAt?: Date | string | null
  now: Date
  dwellMs?: number
  radiusMeters?: number
}): boolean {
  const dwellMs = input.dwellMs ?? MTM_STOPPED_DWELL_MS
  const radius = input.radiusMeters ?? MTM_STOPPED_RADIUS_METERS
  const since = input.now.getTime() - dwellMs
  const samples = input.samples
    .filter((sample) => Number.isFinite(sampleMs(sample)))
    .sort((a, b) => sampleMs(b) - sampleMs(a))
  const latest = samples[0]
  if (!latest) return false
  if (sampleMoving(latest)) return true
  const lastMovingMs = input.lastMovingAt == null
    ? Number.NaN
    : input.lastMovingAt instanceof Date ? input.lastMovingAt.getTime() : Date.parse(input.lastMovingAt)
  if (Number.isFinite(lastMovingMs) && lastMovingMs >= since) return true
  return samples.some((sample) => sampleMs(sample) >= since && (
    sampleMoving(sample) ||
    calculateDistance(sample.latitude, sample.longitude, latest.latitude, latest.longitude) > radius
  ))
}

export function deriveMtmLiveFieldStatus(input: MtmLiveFieldStatusInput): MtmFieldStatus {
  if (input.freshness === "STALE" || input.freshness === "NO_LOCATION") return "OFFLINE"
  if (input.isCheckedIn) return "CHECKED_IN"
  if (input.dayRoutes?.state === "FINISHED") return "ROUTE_FINISHED"
  if (input.dayRoutes?.state === "NOT_STARTED" && input.isOnline && input.tenantHour >= input.lateAfterHour) return "LATE"
  if (input.isMoving && (input.isOnline || input.dayRoutes?.state === "ACTIVE")) return "ON_ROAD"
  if (input.isOnline) return "STOPPED"
  return "OFFLINE"
}
