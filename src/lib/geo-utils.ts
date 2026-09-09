/**
 * Haversine formula: calculates the great-circle distance between two GPS coordinates.
 * @returns Distance in meters
 */
export function calculateDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371000 // Earth's radius in meters
  const toRad = (deg: number) => (deg * Math.PI) / 180

  const φ1 = toRad(lat1)
  const φ2 = toRad(lat2)
  const Δφ = toRad(lat2 - lat1)
  const Δλ = toRad(lon2 - lon1)

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2)

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

/**
 * Returns a human-readable distance string.
 * @param meters Distance in meters
 */
export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)}m`
  return `${(meters / 1000).toFixed(1)}km`
}

/**
 * Calculates minimum distance from a point to a polyline (series of segments).
 * Uses equirectangular projection (accurate for distances < 50km).
 * @returns Distance in meters
 */
export function distanceToPolyline(
  lat: number,
  lon: number,
  polyline: Array<{ lat: number; lng: number }>
): number {
  if (polyline.length === 0) return Infinity
  if (polyline.length === 1) return calculateDistance(lat, lon, polyline[0].lat, polyline[0].lng)

  // Convert to flat meters relative to the point for projection math
  const DEG_TO_M_LAT = 111_320 // meters per degree latitude
  const cosLat = Math.cos((lat * Math.PI) / 180)
  const DEG_TO_M_LNG = 111_320 * cosLat // meters per degree longitude at this latitude

  const px = 0 // point is origin
  const py = 0

  let minDist = Infinity

  for (let i = 0; i < polyline.length - 1; i++) {
    const ax = (polyline[i].lng - lon) * DEG_TO_M_LNG
    const ay = (polyline[i].lat - lat) * DEG_TO_M_LAT
    const bx = (polyline[i + 1].lng - lon) * DEG_TO_M_LNG
    const by = (polyline[i + 1].lat - lat) * DEG_TO_M_LAT

    const d = pointToSegmentDistance(px, py, ax, ay, bx, by)
    if (d < minDist) minDist = d
  }

  return minDist
}

/**
 * Distance from point (px,py) to the closest point on segment (ax,ay)-(bx,by).
 * All coordinates in flat meters.
 */
function pointToSegmentDistance(
  px: number, py: number,
  ax: number, ay: number,
  bx: number, by: number
): number {
  const dx = bx - ax
  const dy = by - ay
  const lenSq = dx * dx + dy * dy

  if (lenSq === 0) {
    // Segment is a point
    return Math.sqrt((px - ax) ** 2 + (py - ay) ** 2)
  }

  // Project point onto segment, clamped to [0, 1]
  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq
  t = Math.max(0, Math.min(1, t))

  const projX = ax + t * dx
  const projY = ay + t * dy

  return Math.sqrt((px - projX) ** 2 + (py - projY) ** 2)
}
