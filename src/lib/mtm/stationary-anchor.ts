import { calculateDistance } from "@/lib/geo-utils"
import { MTM_STATIONARY_MAX_SILENCE_MS } from "@/lib/mtm-types"
import { MTM_STOPPED_RADIUS_METERS, mtmSampleMoving } from "@/lib/mtm/live-field-status"

/**
 * Since when an employee has been standing where he stands.
 *
 * The live map says «Стоит» from the last five minutes of GPS. How long he
 * has stood is not in those five minutes, and reading a whole day of raw
 * points for every person on every poll is not an answer either. So the one
 * row kept per employee — the latest-location projection — also remembers
 * the current stop: where it began, when, and when a trustworthy still point
 * last confirmed it. Each incoming point confirms the stop, ends it, starts a
 * new one, or says nothing.
 *
 * The rules, all of them:
 *  - a moving point ends the stop — whatever its accuracy: ending is always
 *    the careful direction, and it is the same reading of «moving» that makes
 *    the map say «в пути»;
 *  - a still point too inaccurate to trust says nothing: the row is left
 *    exactly as it was, and such points do not keep a stop alive either;
 *  - a still, trustworthy point confirms the stop while it is within
 *    {@link MTM_STOPPED_RADIUS_METERS} of the place where the stop BEGAN (not
 *    of the previous point: a slow drift of forty metres at a time is a walk,
 *    not standing) and no more than {@link MTM_STATIONARY_MAX_SILENCE_MS}
 *    after the previous confirmation — a gap in trustworthy tracking is not
 *    standing still. Otherwise the stop starts again, here and now.
 *
 * The silence is measured from the last confirmation and not from the row's
 * own `recordedAt` on purpose. `recordedAt` is advanced by every point, also
 * by the vague ones — three hours of «somewhere within a kilometre» would
 * have kept a stop alive. And it is advanced by a build that knows nothing
 * of the anchor: after a rollback and a roll-forward a stop of two days ago
 * would have been believed. A confirmation only this code writes goes stale
 * in both cases, and a stale stop is started again.
 *
 * Pure: no database, no clock.
 */

/**
 * A coordinate vaguer than this cannot say «he has not moved fifty metres».
 * The same figure as the default `historyMaxAccuracyMeters`; kept as a number
 * here because the settings module brings the database with it.
 */
export const MTM_STATIONARY_MAX_ACCURACY_METERS = 100

export { MTM_STATIONARY_MAX_SILENCE_MS }

export interface MtmStationaryAnchor {
  stationarySince: Date | null
  stationaryLatitude: number | null
  stationaryLongitude: number | null
  /** The trustworthy still point that started the stop or last confirmed it. */
  stationaryConfirmedAt: Date | null
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
  stationaryConfirmedAt: null,
}

export function classifyMtmStationaryPoint(point: MtmStationaryPoint): MtmStationaryPointKind {
  if (mtmSampleMoving(point)) return "MOVING"
  const { accuracy } = point
  if (accuracy != null && !(accuracy >= 0 && accuracy <= MTM_STATIONARY_MAX_ACCURACY_METERS)) return "UNTRUSTED"
  return "STILL"
}

/**
 * What this point writes into the four columns of the stop:
 *  - `null` — nothing at all;
 *  - only `stationaryConfirmedAt` — the same stop, confirmed. Where and when
 *    it began are deliberately not written back: a moving point that lands at
 *    the same moment has cleared them, and must not be overwritten;
 *  - all four — the stop is over (nulls) or begins here.
 */
export function nextMtmStationaryAnchor(
  previous: MtmStationaryPrevious | null,
  point: MtmStationaryPoint,
): null | Pick<MtmStationaryAnchor, "stationaryConfirmedAt"> | MtmStationaryAnchor {
  const kind = classifyMtmStationaryPoint(point)
  if (kind === "MOVING") return MTM_STATIONARY_NO_ANCHOR
  if (kind === "UNTRUSTED") return null
  const started: MtmStationaryAnchor = {
    stationarySince: point.recordedAt,
    stationaryLatitude: point.latitude,
    stationaryLongitude: point.longitude,
    stationaryConfirmedAt: point.recordedAt,
  }
  if (!previous) return started
  // An older point never reaches the row (the writer's own guard); it changes nothing here either.
  if (point.recordedAt.getTime() < previous.recordedAt.getTime()) return null
  const { stationarySince, stationaryLatitude, stationaryLongitude, stationaryConfirmedAt } = previous
  if (stationarySince == null || stationaryLatitude == null || stationaryLongitude == null || stationaryConfirmedAt == null) return started
  const silenceMs = point.recordedAt.getTime() - stationaryConfirmedAt.getTime()
  if (!(silenceMs >= 0 && silenceMs <= MTM_STATIONARY_MAX_SILENCE_MS)) return started
  const fromAnchor = calculateDistance(point.latitude, point.longitude, stationaryLatitude, stationaryLongitude)
  return fromAnchor <= MTM_STOPPED_RADIUS_METERS ? { stationaryConfirmedAt: point.recordedAt } : started
}

/**
 * The moment the live map may show as «стоит с …»: the anchor of a row, when
 * it is about the very point the map shows and that point is still.
 *
 * The map reads its position from the raw points with the organization's own
 * accuracy rule and its own idea of how old a position may be; the anchor is
 * kept by the writer with fixed ones — so they can disagree. Whenever they
 * do, nothing is shown: a missing duration, never a wrong one. In
 * particular the stop must have been confirmed close to the shown point and
 * close to now — the writer would start it again after a longer silence, so
 * the reader does not count that silence as standing either.
 */
export function shownMtmStationarySince(
  shown: { latitude: number; longitude: number; recordedAt: Date } | null,
  row: MtmStationaryPrevious | null | undefined,
  now: Date,
): Date | null {
  if (!shown || !row) return null
  const { stationarySince, stationaryLatitude, stationaryLongitude, stationaryConfirmedAt } = row
  if (stationarySince == null || stationaryLatitude == null || stationaryLongitude == null || stationaryConfirmedAt == null) return null
  // The projection has not yet caught up with the point on the map, or the stop began after it.
  if (row.recordedAt.getTime() < shown.recordedAt.getTime()) return null
  if (stationarySince.getTime() > shown.recordedAt.getTime()) return null
  if (shown.recordedAt.getTime() - stationaryConfirmedAt.getTime() > MTM_STATIONARY_MAX_SILENCE_MS) return null
  if (now.getTime() - stationaryConfirmedAt.getTime() > MTM_STATIONARY_MAX_SILENCE_MS) return null
  const fromAnchor = calculateDistance(shown.latitude, shown.longitude, stationaryLatitude, stationaryLongitude)
  return fromAnchor <= MTM_STOPPED_RADIUS_METERS ? stationarySince : null
}
