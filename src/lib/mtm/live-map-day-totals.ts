import { buildDayTrip } from "@/lib/mtm/day-trip"
import {
  detectHistoryGaps,
  detectHistoryStops,
  prepareHistoryPoints,
  type HistoryLocationPoint,
  type HistoryPauseInterval,
  type HistoryVisit,
} from "@/lib/mtm/location-history"
import { drivingDistanceMeters } from "@/lib/mtm/road-distance"

/**
 * «Пробег сегодня» and «В движении» of the selected employee, for the live
 * map's card (owner, 2026-10-09: «добей до 100 %» of the Navixy tracking
 * screen, whose card says how far a vehicle has gone today).
 *
 * Nothing stores a day's kilometres: every screen counts them again from the
 * raw fixes, by one rule (road-distance.ts). A lighter rule of the card's own
 * would be a second figure for the same day, so this calls what «История за
 * день» calls, in its order, on its inputs, and keeps three numbers of it:
 *  - the kilometres of History's «Расстояние» tile — every counted step of
 *    the accepted track;
 *  - the time of the day's legs that are drives — «В пути» of History's
 *    «Маршрут дня»;
 *  - the time the phone was silent and neither a break nor a stop explains it.
 *
 * The time in motion is not read off the fixes' `speed` or `isMoving`: that
 * field is taken as m/s in one place and printed as km/h in another, and a
 * drive is a stretch of track between two places, not a flag on a fix.
 *
 * Pure: no React, no fetch, no database.
 */

/** The organization's settings the day is counted with. */
export interface LiveMapDayPolicy {
  maxAccuracyMeters: number
  stopRadiusMeters: number
  stopMinimumSeconds: number
  gapThresholdSeconds: number
  offlineThresholdSeconds: number
}

export interface LiveMapDayTotals {
  /** Null when the day was not counted. Zero is a counted day without a counted step. */
  distanceMeters: number | null
  /** Null when the day was not counted. */
  movingSeconds: number | null
  /** Null when the day was not counted. */
  unknownSeconds: number | null
  firstPointAt: Date | null
  lastPointAt: Date | null
}

function bounded(value: number, minimum: number, maximum: number): number {
  return Number.isFinite(value) ? Math.min(maximum, Math.max(minimum, value)) : value
}

/**
 * The settings bounded exactly as GET /api/v1/mtm/location-history bounds
 * them. History lets its viewer loosen the accuracy for one look; the card
 * has no such control and counts with the organization's own limit — the
 * number History opens with.
 */
export function liveMapDayPolicy(settings: {
  historyMaxAccuracyMeters: number
  historyStopRadiusMeters: number
  historyStopMinimumMinutes: number
  offlineThresholdSeconds: number
  gpsInterval: number
}): LiveMapDayPolicy {
  return {
    maxAccuracyMeters: bounded(settings.historyMaxAccuracyMeters, 5, 1_000),
    stopRadiusMeters: bounded(settings.historyStopRadiusMeters, 10, 1_000),
    stopMinimumSeconds: bounded(settings.historyStopMinimumMinutes, 1, 240) * 60,
    gapThresholdSeconds: Math.max(settings.offlineThresholdSeconds, settings.gpsInterval * 3),
    offlineThresholdSeconds: settings.offlineThresholdSeconds,
  }
}

/**
 * The shift's breaks as intervals, from its PAUSE and RESUME events in time
 * order. A second PAUSE without a RESUME does not open a second break; a
 * break still going on has no end.
 */
export function liveMapDayPauses(events: ReadonlyArray<{ type: string; occurredAt: Date }>): HistoryPauseInterval[] {
  const pauses: HistoryPauseInterval[] = []
  for (const event of events) {
    const open = pauses.length > 0 && !pauses[pauses.length - 1].endedAt
    if (event.type === "PAUSE") {
      if (!open) pauses.push({ startedAt: event.occurredAt, endedAt: null })
    } else if (event.type === "RESUME" && open) {
      pauses[pauses.length - 1].endedAt = event.occurredAt
    }
  }
  return pauses
}

/**
 * The fixes the day is counted on: in time order, without repeats, without
 * the ones the accuracy limit rejects. The road server is asked about exactly
 * this list — its answer is one length per step of it, and a list that
 * differs by one fix would put every road length on the wrong step.
 */
export function liveMapDayTrack(rows: HistoryLocationPoint[], maxAccuracyMeters: number): HistoryLocationPoint[] {
  return prepareHistoryPoints(rows, maxAccuracyMeters).points
}

export function liveMapDayTotals(input: {
  /** The day's raw fixes, as read. */
  rows: HistoryLocationPoint[]
  visits: HistoryVisit[]
  /** The shift of this day; null where the organization has no workforce module. */
  workday: { startedAt: Date; completedAt: Date | null } | null
  pauses: readonly HistoryPauseInterval[]
  policy: LiveMapDayPolicy
  /** Road metres per step of liveMapDayTrack(rows), where the road server answered. */
  roadSteps?: ReadonlyArray<number | null> | null
  /** The read stopped at its cap: the day has more fixes than were read. */
  truncated: boolean
}): LiveMapDayTotals {
  const { policy } = input
  const points = liveMapDayTrack(input.rows, policy.maxAccuracyMeters)
  const firstPointAt = points[0]?.recordedAt ?? null
  const lastPointAt = points.at(-1)?.recordedAt ?? null
  // The beginning of a day is not the day. History withholds its distance and
  // its trip when the read was cut short, and the card must not print a
  // number History refuses to.
  if (input.truncated) {
    return { distanceMeters: null, movingSeconds: null, unknownSeconds: null, firstPointAt, lastPointAt }
  }

  const distanceMeters = drivingDistanceMeters(points, input.roadSteps)
  const gaps = detectHistoryGaps(points, policy.gapThresholdSeconds, input.pauses)
  const stops = detectHistoryStops({
    points,
    visits: input.visits,
    radiusMeters: policy.stopRadiusMeters,
    minimumSeconds: policy.stopMinimumSeconds,
    offlineThresholdSeconds: policy.offlineThresholdSeconds,
  })
  const trip = buildDayTrip({
    points,
    stops,
    visits: input.visits,
    gaps,
    workday: input.workday,
    roadSteps: input.roadSteps,
  })

  return {
    distanceMeters,
    movingSeconds: trip.summary.movingSeconds,
    unknownSeconds: trip.summary.unknownSeconds,
    firstPointAt,
    lastPointAt,
  }
}
