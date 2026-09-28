import { calculateDistance } from "@/lib/geo-utils"
import type { RoadMatch } from "@/lib/mtm/map-matching"

/**
 * Kilometres driven, one rule for every screen that shows them (owner
 * 2026-09-28: «считай» — along the roads, not straight between fixes).
 *
 * Each step between two fixes counts:
 * - its length along the road, where the self-hosted OSRM answered for it —
 *   the matched path, or across a silence the shortest road between the two
 *   fixes (at least that much was driven);
 * - otherwise the straight line, but never across a silence longer than ten
 *   minutes: that is unknown travel;
 * - nothing when it is faster than 180 km/h: a flight or a GPS jump is not
 *   road the agent drove.
 *
 * Measured on prod 2026-09-28, the owner's phone on 22.09: 12.9 km straight
 * while moving became 14.5 km along the roads, and 6.0 km of straight lines
 * across silences became 8.1 km of road. GPS drift at a customer's door
 * shrinks rather than grows: OSRM folds the jitter into one point.
 */
export const DRIVING_MAX_STEP_SECONDS = 10 * 60
export const DRIVING_MAX_SPEED_KMH = 180

/** What the kilometres were counted along. */
export type DistanceBasis = "ROADS" | "PARTIAL" | "STRAIGHT"

type Fix = { latitude: number; longitude: number; recordedAt: Date }

/** Metres counted for the step arriving at each fix (the first counts 0). */
export function drivingStepMeters(points: readonly Fix[], roadSteps?: ReadonlyArray<number | null> | null): number[] {
  const steps: number[] = Array(points.length).fill(0)
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1]
    const current = points[index]
    const seconds = (current.recordedAt.getTime() - previous.recordedAt.getTime()) / 1_000
    if (!(seconds > 0)) continue
    const road = roadSteps?.[index]
    const meters = road != null
      ? road
      : seconds > DRIVING_MAX_STEP_SECONDS
        ? null
        : calculateDistance(previous.latitude, previous.longitude, current.latitude, current.longitude)
    if (meters == null || !Number.isFinite(meters) || (meters / seconds) * 3.6 > DRIVING_MAX_SPEED_KMH) continue
    steps[index] = meters
  }
  return steps
}

export function drivingDistanceMeters(points: readonly Fix[], roadSteps?: ReadonlyArray<number | null> | null): number {
  return Math.round(drivingStepMeters(points, roadSteps).reduce((sum, meters) => sum + meters, 0))
}

export function distanceBasis(match: Pick<RoadMatch, "complete"> | null | undefined): DistanceBasis {
  if (!match) return "STRAIGHT"
  return match.complete ? "ROADS" : "PARTIAL"
}
