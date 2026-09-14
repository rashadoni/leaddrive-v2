import { calculateDistance } from "@/lib/geo-utils"
import { hasMtmCoordinates, type MtmCoordinateInput } from "@/lib/mtm/geo-coordinates"

/**
 * Was the visit recorded at the customer? — the one answer for every web page.
 *
 * 2026-09-14 two helpers answered this differently: the visit review (#203)
 * and the route detail / GPS history (#205). #205 read "in zone" for a
 * finished visit whose check-out carried no GPS, measured the check-out of a
 * cancelled visit, and judged a visit by its check-out alone, so the same
 * visit read «Zonada» on the route and a warning on the review. The #203 rule
 * below is the source of truth; `visit-review.ts` re-exports it and no other
 * module measures a visit against its customer on its own
 * (`src/__tests__/lib-mtm-visit-place-check.test.ts` scans for it).
 *
 * Pure: no React, no Prisma.
 *
 * - `effectiveGeofenceRadius(customerRadius, organizationRadius)` — customer
 *   override (F-22), else the organization setting, else 100 m.
 * - `placeCheck(fix, pin, radiusMeters)` — one fix against the pin:
 *   `at_point` | `outside` | `no_gps` | `no_pin`. Both pairs go through
 *   `hasMtmCoordinates`, so (0, 0), half pairs and out-of-range values are
 *   "unknown", never a position in the Gulf of Guinea.
 * - `visitPlaceSummary(visit, organizationRadius)` — check-in and check-out
 *   together. Check-out is measured only for a `CHECKED_OUT` visit. `verdict`,
 *   worst fact first: `no_pin`, `outside`, `no_gps`, `checkin_gps_missing`,
 *   `checkout_gps_missing`, `at_point`.
 * - `VISIT_PLACE_VERDICT_MESSAGE_KEYS` — the label of each verdict under the
 *   shared `mtmPlaceCheck` messages namespace, so every page words it alike.
 * - `formatMtmDistance(meters, locale, unitLabel)` — «7,8 km» / «450 m».
 */

/** Same fallback as POST /api/v1/mtm/visits and MTM_SETTING_DEFAULTS.geofenceRadius. */
export const DEFAULT_VISIT_GEOFENCE_RADIUS_METERS = 100

/**
 * The radius the check-in itself was measured against: the customer's own
 * override when set (F-22), otherwise the organization setting.
 */
export function effectiveGeofenceRadius(customerRadius: number | null | undefined, organizationRadius: number | null | undefined): number {
  if (typeof customerRadius === "number" && Number.isFinite(customerRadius) && customerRadius > 0) return customerRadius
  if (typeof organizationRadius === "number" && Number.isFinite(organizationRadius) && organizationRadius > 0) return organizationRadius
  return DEFAULT_VISIT_GEOFENCE_RADIUS_METERS
}

export type PlaceCheckState = "at_point" | "outside" | "no_gps" | "no_pin"

export interface PlaceCheck {
  state: PlaceCheckState
  /** Rounded meters between the fix and the customer pin; null when either is unknown. */
  distanceMeters: number | null
  radiusMeters: number
}

/** One GPS fix against the customer pin and its geofence. */
export function placeCheck(fix: MtmCoordinateInput | null | undefined, pin: MtmCoordinateInput | null | undefined, radiusMeters: number): PlaceCheck {
  if (!hasMtmCoordinates(pin)) return { state: "no_pin", distanceMeters: null, radiusMeters }
  if (!hasMtmCoordinates(fix)) return { state: "no_gps", distanceMeters: null, radiusMeters }
  const distanceMeters = Math.round(calculateDistance(fix.latitude, fix.longitude, pin.latitude, pin.longitude))
  return { state: distanceMeters <= radiusMeters ? "at_point" : "outside", distanceMeters, radiusMeters }
}

export interface VisitPlaceInput {
  status: string
  checkInLat?: number | null
  checkInLng?: number | null
  checkOutLat?: number | null
  checkOutLng?: number | null
  customer?: { latitude?: number | null; longitude?: number | null; geofenceRadius?: number | null } | null
}

export type VisitPlaceVerdict = "at_point" | "outside" | "checkout_gps_missing" | "checkin_gps_missing" | "no_gps" | "no_pin"

export interface VisitPlaceSummary {
  checkIn: PlaceCheck
  /** Measured only for a CHECKED_OUT visit; null otherwise (see `checkOutSkipped`). */
  checkOut: PlaceCheck | null
  /** Why there is no check-out measurement: the visit is still open, or it ended without a check-out (cancelled). */
  checkOutSkipped: "visit_open" | "not_checked_out" | null
  /** One word for a table cell. The worst fact wins: being elsewhere beats a missing fix. */
  verdict: VisitPlaceVerdict
  /** The distance that explains the verdict: the farthest "outside" fix, else the check-in (or check-out) distance. */
  distanceMeters: number | null
  radiusMeters: number
}

/**
 * Check-in and check-out against the pin. The old badge measured only the
 * check-in with a fixed 100 m, so a visit whose check-out came from nowhere
 * still read "confirmed".
 */
export function visitPlaceSummary(visit: VisitPlaceInput, organizationRadius?: number | null): VisitPlaceSummary {
  const radiusMeters = effectiveGeofenceRadius(visit.customer?.geofenceRadius, organizationRadius)
  const pin = { latitude: visit.customer?.latitude, longitude: visit.customer?.longitude }
  const checkIn = placeCheck({ latitude: visit.checkInLat, longitude: visit.checkInLng }, pin, radiusMeters)
  const finished = visit.status === "CHECKED_OUT"
  const checkOut = finished
    ? placeCheck({ latitude: visit.checkOutLat, longitude: visit.checkOutLng }, pin, radiusMeters)
    : null
  const checkOutSkipped = finished ? null : visit.status === "CHECKED_IN" ? "visit_open" as const : "not_checked_out" as const
  const summary = (verdict: VisitPlaceVerdict, distanceMeters: number | null): VisitPlaceSummary => (
    { checkIn, checkOut, checkOutSkipped, verdict, distanceMeters, radiusMeters }
  )

  if (checkIn.state === "no_pin") return summary("no_pin", null)
  const outside = [checkIn, checkOut].filter((check): check is PlaceCheck => check?.state === "outside")
  if (outside.length) return summary("outside", Math.max(...outside.map((check) => check.distanceMeters ?? 0)))
  if (checkIn.state === "no_gps") {
    // A check-out fix alone proves the agent left from the point, not that they arrived there.
    return checkOut?.state === "at_point" ? summary("checkin_gps_missing", checkOut.distanceMeters) : summary("no_gps", null)
  }
  if (checkOut?.state === "no_gps") return summary("checkout_gps_missing", checkIn.distanceMeters)
  return summary("at_point", checkIn.distanceMeters)
}

/**
 * Message key of each verdict under the `mtmPlaceCheck` namespace. `outside`
 * takes `{distance}`; `distanceDetail` (not a verdict) takes `{distance}` and
 * `{radius}`.
 */
export const VISIT_PLACE_VERDICT_MESSAGE_KEYS: Readonly<Record<VisitPlaceVerdict, string>> = Object.freeze({
  at_point: "atPoint",
  outside: "outside",
  checkout_gps_missing: "checkoutGpsMissing",
  checkin_gps_missing: "checkinGpsMissing",
  no_gps: "noGps",
  no_pin: "noPin",
})

/** Puts a formatted number and its unit together, e.g. through `mtmMap.distanceUnits`. */
export type MtmDistanceUnitLabel = (unit: "m" | "km", value: string) => string

const LATIN_UNITS: MtmDistanceUnitLabel = (unit, value) => `${value} ${unit}`

/**
 * «7,8 km» / «450 m» in the reader's number format. `geo-utils.formatDistance`
 * glues the unit on without a space or a locale. Units come from the caller's
 * translations — Russian reads «м»/«км» (review of #205); the Latin default is
 * for tests and non-UI callers.
 */
export function formatMtmDistance(meters: number, locale: string, unitLabel: MtmDistanceUnitLabel = LATIN_UNITS): string {
  const safe = Math.max(0, meters)
  if (safe < 1_000) {
    return unitLabel("m", new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(Math.round(safe)))
  }
  return unitLabel("km", new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(safe / 1_000))
}
