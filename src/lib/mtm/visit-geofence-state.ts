import { calculateDistance } from "@/lib/geo-utils"
import { hasMtmCoordinates } from "@/lib/mtm/geo-coordinates"

/**
 * Was the visit recorded where the customer is?
 *
 * Prod audit 2026-09-14: the GPS history printed «Təsdiqlənib» next to every
 * visit, unconditionally. On the test route both check-ins were 7.8 km and
 * 13.1 km from the customer pins, and the page still called them confirmed.
 * A stored visit row proves that a visit was *recorded*; whether it was
 * recorded at the door is a separate question with a measurable answer — the
 * distance from the check-in (and check-out) coordinate to the customer pin,
 * compared with the geofence the check-in itself is judged by.
 *
 * The answer has four values, not two, because "we cannot tell" must not be
 * shown as either "inside" or "outside":
 *
 * - `INSIDE`  — every recorded coordinate is within the radius;
 * - `OUTSIDE` — at least one recorded coordinate is beyond it;
 * - `NO_VISIT_GPS` — the visit carries no coordinate at all;
 * - `NO_CUSTOMER_COORDINATES` — the customer has no usable pin, so there is
 *   nothing to measure against (never measured against (0, 0)).
 */
export type MtmVisitGeofenceState = "INSIDE" | "OUTSIDE" | "NO_VISIT_GPS" | "NO_CUSTOMER_COORDINATES"

export interface MtmVisitGeofenceInput {
  checkInLat?: number | null
  checkInLng?: number | null
  checkOutLat?: number | null
  checkOutLng?: number | null
  customerLatitude?: number | null
  customerLongitude?: number | null
  /** Per-customer override (MtmCustomer.geofenceRadius). */
  customerGeofenceRadius?: number | null
  /** Organization default (MtmSettings.geofenceRadius). */
  defaultGeofenceRadius: number
}

export interface MtmVisitGeofenceResult {
  state: MtmVisitGeofenceState
  radiusMeters: number
  checkInDistanceMeters: number | null
  checkOutDistanceMeters: number | null
  /** The larger of the two measured distances, for a one-number label. */
  distanceMeters: number | null
}

function effectiveRadius(customerRadius: number | null | undefined, fallback: number): number {
  if (typeof customerRadius === "number" && Number.isFinite(customerRadius) && customerRadius > 0) {
    return customerRadius
  }
  return Number.isFinite(fallback) && fallback > 0 ? fallback : 100
}

function measure(
  latitude: number | null | undefined,
  longitude: number | null | undefined,
  customer: { latitude: number; longitude: number } | null,
): number | null {
  if (!customer) return null
  const point = { latitude, longitude }
  if (!hasMtmCoordinates(point)) return null
  return Math.round(calculateDistance(point.latitude, point.longitude, customer.latitude, customer.longitude))
}

export function mtmVisitGeofenceState(input: MtmVisitGeofenceInput): MtmVisitGeofenceResult {
  const radiusMeters = effectiveRadius(input.customerGeofenceRadius, input.defaultGeofenceRadius)
  const customerPoint = { latitude: input.customerLatitude, longitude: input.customerLongitude }
  const customer = hasMtmCoordinates(customerPoint) ? customerPoint : null
  const checkInDistanceMeters = measure(input.checkInLat, input.checkInLng, customer)
  const checkOutDistanceMeters = measure(input.checkOutLat, input.checkOutLng, customer)
  const measured = [checkInDistanceMeters, checkOutDistanceMeters].filter((value): value is number => value !== null)
  const distanceMeters = measured.length ? Math.max(...measured) : null

  if (!customer) {
    return { state: "NO_CUSTOMER_COORDINATES", radiusMeters, checkInDistanceMeters, checkOutDistanceMeters, distanceMeters }
  }
  if (distanceMeters === null) {
    return { state: "NO_VISIT_GPS", radiusMeters, checkInDistanceMeters, checkOutDistanceMeters, distanceMeters }
  }
  return {
    state: distanceMeters > radiusMeters ? "OUTSIDE" : "INSIDE",
    radiusMeters,
    checkInDistanceMeters,
    checkOutDistanceMeters,
    distanceMeters,
  }
}

/** Puts a formatted number and its unit together, e.g. through `mtmMap.distanceUnits`. */
export type MtmDistanceUnitLabel = (unit: "m" | "km", value: string) => string

const LATIN_UNITS: MtmDistanceUnitLabel = (unit, value) => `${value} ${unit}`

/**
 * «7,8 km» / «450 m» in the reader's number format. Kept here because every
 * geofence label needs it and `geo-utils.formatDistance` glues the unit on
 * without a space or a locale. Units come from the caller's translations —
 * Russian reads «м»/«км» (review of #205); the Latin default is for tests and
 * non-UI callers.
 */
export function formatMtmDistance(meters: number, locale: string, unitLabel: MtmDistanceUnitLabel = LATIN_UNITS): string {
  const safe = Math.max(0, meters)
  if (safe < 1_000) {
    return unitLabel("m", new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(Math.round(safe)))
  }
  return unitLabel("km", new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(safe / 1_000))
}
