export interface GeoPoint {
  latitude: number
  longitude: number
}

const EARTH_RADIUS_M = 6_371_000

/**
 * Great-circle distance between two lat/lng points, in meters.
 * Standard haversine formula — deterministic to ~0.1m on sub-100m
 * distances (relevant for the M1-2 anti-tampering ±50m threshold).
 */
export function haversineMeters(a: GeoPoint, b: GeoPoint): number {
  if (a.latitude === b.latitude && a.longitude === b.longitude) return 0

  const toRad = (deg: number) => (deg * Math.PI) / 180
  const dLat = toRad(b.latitude - a.latitude)
  const dLng = toRad(b.longitude - a.longitude)

  const sinLat = Math.sin(dLat / 2)
  const sinLng = Math.sin(dLng / 2)

  const h =
    sinLat * sinLat +
    Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * sinLng * sinLng

  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
  return EARTH_RADIUS_M * c
}
