export type MtmGoogleMapCoordinate = {
  latitude: number | null | undefined
  longitude: number | null | undefined
}

const GOOGLE_MAPS_DIRECTIONS_URL = "https://www.google.com/maps/dir/"
const GOOGLE_MAPS_EMBED_DIRECTIONS_URL = "https://www.google.com/maps/embed/v1/directions"
const GOOGLE_MAPS_EMBED_MAX_POINTS = 22

export function hasMtmGoogleMapCoordinate(value: MtmGoogleMapCoordinate): value is {
  latitude: number
  longitude: number
} {
  return typeof value.latitude === "number"
    && typeof value.longitude === "number"
    && Number.isFinite(value.latitude)
    && Number.isFinite(value.longitude)
    && value.latitude >= -90
    && value.latitude <= 90
    && value.longitude >= -180
    && value.longitude <= 180
}

/** A user-triggered deeplink only; it does not calculate or persist a route. */
export function buildGoogleMapsDirectionsUrl(destination: MtmGoogleMapCoordinate): string | null {
  if (!hasMtmGoogleMapCoordinate(destination)) return null
  const url = new URL(GOOGLE_MAPS_DIRECTIONS_URL)
  url.searchParams.set("api", "1")
  url.searchParams.set("destination", coordinate(destination))
  url.searchParams.set("travelmode", "driving")
  return url.toString()
}

/**
 * A separate Google Maps surface for the product-owned manual order. No
 * Compute Routes response is copied into this URL or the current Leaflet map.
 */
export function buildGoogleMapsEmbedDirectionsUrl(input: {
  apiKey: string
  points: readonly MtmGoogleMapCoordinate[]
  language?: string
  region?: string
}): string | null {
  const apiKey = input.apiKey.trim()
  if (!apiKey || input.points.length < 2 || input.points.length > GOOGLE_MAPS_EMBED_MAX_POINTS) return null
  if (!input.points.every(hasMtmGoogleMapCoordinate)) return null

  const url = new URL(GOOGLE_MAPS_EMBED_DIRECTIONS_URL)
  url.searchParams.set("key", apiKey)
  url.searchParams.set("origin", coordinate(input.points[0]))
  url.searchParams.set("destination", coordinate(input.points[input.points.length - 1]))
  const waypoints = input.points.slice(1, -1)
  if (waypoints.length > 0) url.searchParams.set("waypoints", waypoints.map(coordinate).join("|"))
  url.searchParams.set("mode", "driving")
  url.searchParams.set("units", "metric")
  if (input.language) url.searchParams.set("language", input.language)
  if (input.region) url.searchParams.set("region", input.region)
  return url.toString()
}

function coordinate(value: { latitude: number; longitude: number }): string {
  return `${value.latitude},${value.longitude}`
}
