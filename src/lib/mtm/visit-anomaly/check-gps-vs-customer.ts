/**
 * M3-5a — Visit anomaly: GPS cross-check leg.
 *
 * Compares the GPS the agent submitted with the upload against the
 * stored customer location. If the distance exceeds the threshold
 * (default 100m, matching the M1-2 anti-tampering tolerance ×2 so
 * legit GPS drift doesn't false-positive), the photo is flagged for
 * supervisor review via the PHOTO_GPS_VS_CUSTOMER_MISMATCH audit
 * channel.
 *
 * Pure function. Reuses M1-2 haversineMeters — same earth-radius
 * model so anomaly and tampering thresholds compose cleanly.
 */
import { haversineMeters } from "@/lib/mtm/photo-watermark"

export interface GpsVsCustomerInput {
  photoLatitude: number | null
  photoLongitude: number | null
  customerLatitude: number | null
  customerLongitude: number | null
  /** Threshold in meters; default 100m (≥M1-2 tampering tolerance ×2). */
  maxDistanceMeters?: number
}

export interface GpsVsCustomerResult {
  /** True only when both GPS pairs are present AND distance > threshold. */
  isAnomaly: boolean
  /** Meters between the two points, or null if either GPS is missing. */
  distanceMeters: number | null
}

const DEFAULT_MAX_DISTANCE_M = 100

export function checkGpsVsCustomer(input: GpsVsCustomerInput): GpsVsCustomerResult {
  const {
    photoLatitude,
    photoLongitude,
    customerLatitude,
    customerLongitude,
    maxDistanceMeters = DEFAULT_MAX_DISTANCE_M,
  } = input

  // Either pair incomplete → can't compare, refuse to flag (a missing
  // GPS isn't an anomaly; M3-0 / M1-2 already cover missing-GPS cases
  // via different signals).
  if (
    photoLatitude == null ||
    photoLongitude == null ||
    customerLatitude == null ||
    customerLongitude == null
  ) {
    return { isAnomaly: false, distanceMeters: null }
  }

  const distance = haversineMeters(
    { latitude: photoLatitude, longitude: photoLongitude },
    { latitude: customerLatitude, longitude: customerLongitude },
  )

  // Strict `>` so distance exactly at threshold is not an anomaly —
  // matches the M1-2 tampering boundary semantic.
  return {
    isAnomaly: distance > maxDistanceMeters,
    distanceMeters: distance,
  }
}

export { DEFAULT_MAX_DISTANCE_M as VISIT_ANOMALY_GPS_THRESHOLD_M }
