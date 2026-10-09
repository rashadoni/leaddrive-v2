import { calculateDistance } from "@/lib/geo-utils"

/**
 * Where the selected employee is, in words, for the live map.
 *
 * Owner, 2026-10-09, on the public Navixy demo: «бери почти всё, чего у нас
 * нет». Their card names the place under the pin. Ours answers in the order
 * a dispatcher thinks in:
 *
 *   1. at a client — the visit he is in, or a stop of today's route whose
 *      check-in circle his coordinate is inside (nothing is asked of anyone);
 *   2. otherwise the street, from the company's own road server — the
 *      coordinate does not leave the server for a public address service;
 *   3. otherwise nothing is claimed.
 *
 * Pure: no React, no fetch. The page decides when to ask for the street.
 */

export interface LiveMapPlaceStop {
  name: string
  address?: string | null
  latitude: number
  longitude: number
  /** The radius a check-in at this client is accepted in. */
  zoneRadiusMeters?: number | null
  /** The visit at this stop is open right now. */
  inVisit?: boolean
}

export interface LiveMapPlacePosition {
  latitude: number
  longitude: number
  accuracy?: number | null
}

export type LiveMapPlace =
  /** `visit` — he checked in there; `zone` — his coordinate is inside the client's circle. */
  | { kind: "client"; basis: "visit" | "zone"; name: string; address: string | null }
  /**
   * The visit at this client is still open, and a live coordinate puts him
   * clearly somewhere else: he left without finishing it. Both are said — the
   * open visit and how far from it he is — and the street is asked as for
   * anybody on the road.
   */
  | { kind: "away"; name: string; distanceMeters: number; latitude: number; longitude: number }
  /** Not at a client of today's route: the street is to be asked for this coordinate. */
  | { kind: "street"; latitude: number; longitude: number }
  /** No live coordinate, so nothing is said about a place. */
  | { kind: "unknown" }

/** Beyond this the fix is a neighbourhood, not a place: the line says «примерно». */
export const PLACE_APPROXIMATE_ACCURACY_METERS = 50
/** The street is asked again only after the employee has moved at least this far. */
export const PLACE_MIN_MOVE_METERS = 50
/**
 * …and however poor the fix, a move of this much always asks again: beyond it
 * the street on screen is no longer shown, so a question must be on its way.
 */
export const PLACE_MAX_MOVE_METERS = 300
/**
 * How far outside the client's circle, beyond the fix's own error, a live
 * coordinate must be before «he is in a visit there» stops being the answer.
 * Indoors a phone drifts by a building or two; that is still «у клиента».
 */
export const PLACE_VISIT_AWAY_MARGIN_METERS = 150
/** A road farther than this from the fix is not «his street» (a yard, a field, the sea). */
export const PLACE_MAX_ROAD_DISTANCE_METERS = 75

function usable(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value)
}

export function liveMapPlace(input: {
  /** Null when the live map shows no current position for him (stale, shift closed). */
  position: LiveMapPlacePosition | null
  /** He is in a visit right now (field status CHECKED_IN). */
  inVisit: boolean
  stops: readonly LiveMapPlaceStop[]
}): LiveMapPlace {
  const { position, stops } = input
  const located = position && usable(position.latitude) && usable(position.longitude) ? position : null
  // The open visit is evidence on its own: he pressed «начать визит» there.
  // It stays the answer without a live coordinate, without a pin to measure
  // from, and through indoor drift — but not against a coordinate that is
  // plainly somewhere else.
  if (input.inVisit) {
    const open = stops.find((stop) => stop.inVisit)
    if (open) {
      const measurable = located && usable(open.latitude) && usable(open.longitude)
        && usable(open.zoneRadiusMeters) && open.zoneRadiusMeters > 0
      if (measurable) {
        const meters = calculateDistance(located.latitude, located.longitude, open.latitude, open.longitude)
        const reach = (open.zoneRadiusMeters as number) + (usable(located.accuracy) ? Math.max(0, located.accuracy) : 0) + PLACE_VISIT_AWAY_MARGIN_METERS
        if (meters > reach) {
          return { kind: "away", name: open.name, distanceMeters: Math.round(meters), latitude: located.latitude, longitude: located.longitude }
        }
      }
      return { kind: "client", basis: "visit", name: open.name, address: open.address?.trim() || null }
    }
  }
  if (!located) return { kind: "unknown" }

  let nearest: { stop: LiveMapPlaceStop; meters: number } | null = null
  for (const stop of stops) {
    if (!usable(stop.latitude) || !usable(stop.longitude)) continue
    if (!usable(stop.zoneRadiusMeters) || stop.zoneRadiusMeters <= 0) continue
    const meters = calculateDistance(located.latitude, located.longitude, stop.latitude, stop.longitude)
    if (meters > stop.zoneRadiusMeters) continue
    if (!nearest || meters < nearest.meters) nearest = { stop, meters }
  }
  if (nearest) {
    return { kind: "client", basis: "zone", name: nearest.stop.name, address: nearest.stop.address?.trim() || null }
  }
  return { kind: "street", latitude: located.latitude, longitude: located.longitude }
}

/**
 * The coordinate a street is asked for and remembered under: four decimals,
 * about eleven metres. Rounded before it is sent, so two dispatchers looking
 * at the same corner share one answer and no more precision travels than the
 * question needs.
 */
export function placeLookupPoint(latitude: number, longitude: number): { latitude: number; longitude: number; key: string } {
  const lat = Number(latitude.toFixed(4))
  const lng = Number(longitude.toFixed(4))
  return { latitude: lat, longitude: lng, key: `${lat.toFixed(4)},${lng.toFixed(4)}` }
}

/**
 * Has he moved enough since the street on screen was asked for? Measured from
 * that anchor, not on a grid: an employee standing on the edge of a rounding
 * cell must not flip between two answers on every refresh.
 */
export function placeMovedFromAnchor(
  anchor: { latitude: number; longitude: number } | null,
  position: LiveMapPlacePosition,
): boolean {
  if (!anchor) return true
  const threshold = Math.min(PLACE_MAX_MOVE_METERS, Math.max(PLACE_MIN_MOVE_METERS, usable(position.accuracy) ? position.accuracy : 0))
  return calculateDistance(anchor.latitude, anchor.longitude, position.latitude, position.longitude) >= threshold
}

export function isPlaceApproximate(position: LiveMapPlacePosition | null): boolean {
  return Boolean(position && usable(position.accuracy) && position.accuracy > PLACE_APPROXIMATE_ACCURACY_METERS)
}
