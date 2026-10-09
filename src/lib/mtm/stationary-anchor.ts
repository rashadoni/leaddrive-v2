import { calculateDistance } from "@/lib/geo-utils"
import { MTM_STOPPED_RADIUS_METERS, mtmSampleMoving } from "@/lib/mtm/live-field-status"
import { MATCH_SPLIT_GAP_SECONDS } from "@/lib/mtm/map-matching"

/**
 * Since when an employee has been standing where he stands.
 *
 * The live map says «Стоит» from the last five minutes of GPS. How long he
 * has stood is not in those five minutes, and reading a whole day of raw
 * points for every person on every poll is not an answer either. So the one
 * row kept per employee — the latest-location projection — also remembers
 * where the current stop began and when: its anchor. Each incoming point
 * either keeps the anchor, ends the stop or starts a new one.
 *
 * The rules, all of them:
 *  - a point too inaccurate to trust says nothing about the stop: the anchor
 *    is left exactly as it was;
 *  - a moving point ends the stop;
 *  - a still, trustworthy point keeps the anchor while it is within
 *    {@link MTM_STOPPED_RADIUS_METERS} of the place where the stop BEGAN (not
 *    of the previous point: a slow drift of forty metres at a time is a walk,
 *    not standing) and the phone has not been silent for longer than
 *    {@link MTM_STATIONARY_MAX_SILENCE_MS} — a gap in tracking is not standing
 *    still. Otherwise the stop starts again, here and now.
 *
 * Pure: no database, no clock.
 */

/**
 * A coordinate vaguer than this cannot say «he has not moved fifty metres».
 * The same figure as the default `historyMaxAccuracyMeters`; kept as a number
 * here because the settings module brings the database with it.
 */
export const MTM_STATIONARY_MAX_ACCURACY_METERS = 100

/** Longer than this without a single point, and nobody knows whether he stood. */
export const MTM_STATIONARY_MAX_SILENCE_MS = MATCH_SPLIT_GAP_SECONDS * 1000

export interface MtmStationaryAnchor {
  stationarySince: Date | null
  stationaryLatitude: number | null
  stationaryLongitude: number | null
}

/** What the projection row held before this point. */
export interface MtmStationaryPrevious extends MtmStationaryAnchor {
  recordedAt: Date
}

export interface MtmStationaryPoint {
  latitude: number
  longitude: number
  accuracy: number | null
  speed: number | null
  isMoving: boolean
  recordedAt: Date
}

export type MtmStationaryPointKind = "UNTRUSTED" | "MOVING" | "STILL"

export const MTM_STATIONARY_NO_ANCHOR: MtmStationaryAnchor = {
  stationarySince: null,
  stationaryLatitude: null,
  stationaryLongitude: null,
}

export function classifyMtmStationaryPoint(point: MtmStationaryPoint): MtmStationaryPointKind {
  const { accuracy } = point
  if (accuracy != null && !(accuracy >= 0 && accuracy <= MTM_STATIONARY_MAX_ACCURACY_METERS)) return "UNTRUSTED"
  return mtmSampleMoving(point) ? "MOVING" : "STILL"
}

/**
 * What the three anchor columns become with this point: `"KEEP"` — they are
 * not written at all — or the values to write.
 */
export function nextMtmStationaryAnchor(
  previous: MtmStationaryPrevious | null,
  point: MtmStationaryPoint,
): "KEEP" | MtmStationaryAnchor {
  const kind = classifyMtmStationaryPoint(point)
  if (kind === "UNTRUSTED") return "KEEP"
  if (kind === "MOVING") return MTM_STATIONARY_NO_ANCHOR
  const started: MtmStationaryAnchor = {
    stationarySince: point.recordedAt,
    stationaryLatitude: point.latitude,
    stationaryLongitude: point.longitude,
  }
  if (!previous) return started
  const { stationarySince, stationaryLatitude, stationaryLongitude } = previous
  if (stationarySince == null || stationaryLatitude == null || stationaryLongitude == null) return started
  const silenceMs = point.recordedAt.getTime() - previous.recordedAt.getTime()
  // An older point never reaches the row (the writer's own guard); it changes nothing here either.
  if (!(silenceMs >= 0)) return "KEEP"
  if (silenceMs > MTM_STATIONARY_MAX_SILENCE_MS) return started
  const fromAnchor = calculateDistance(point.latitude, point.longitude, stationaryLatitude, stationaryLongitude)
  return fromAnchor <= MTM_STOPPED_RADIUS_METERS ? "KEEP" : started
}

/**
 * The moment the live map may show as «стоит с …»: the anchor of a row, when
 * it is about the very point the map shows and that point is still.
 *
 * The map reads its position from the raw points with the organization's own
 * accuracy rule, the anchor is kept by the writer with a fixed one — so they
 * can disagree. Whenever they do, nothing is shown: a missing duration, never
 * a wrong one.
 */
export function shownMtmStationarySince(
  shown: { latitude: number; longitude: number; recordedAt: Date } | null,
  row: (MtmStationaryPrevious) | null | undefined,
): Date | null {
  if (!shown || !row) return null
  const { stationarySince, stationaryLatitude, stationaryLongitude } = row
  if (stationarySince == null || stationaryLatitude == null || stationaryLongitude == null) return null
  // The projection has not yet caught up with the point on the map, or the stop began after it.
  if (row.recordedAt.getTime() < shown.recordedAt.getTime()) return null
  if (stationarySince.getTime() > shown.recordedAt.getTime()) return null
  const fromAnchor = calculateDistance(shown.latitude, shown.longitude, stationaryLatitude, stationaryLongitude)
  return fromAnchor <= MTM_STOPPED_RADIUS_METERS ? stationarySince : null
}
