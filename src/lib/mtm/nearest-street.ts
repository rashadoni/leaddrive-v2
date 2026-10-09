import { mapMatchingBaseUrl } from "@/lib/mtm/map-matching"
import { PLACE_MAX_ROAD_DISTANCE_METERS, placeLookupPoint } from "@/lib/mtm/live-map-place"

/**
 * The street under a coordinate, from the company's own road server.
 *
 * The live map names the place the selected employee is at. A public address
 * service would do it with a house number — and would be told where a named
 * company's employee is standing. The self-hosted OSRM that already draws
 * the day's track along the streets (map-matching.ts) answers «which road is
 * nearest» on 127.0.0.1: less precise, and nothing leaves the server.
 *
 * `ok: false` means the road server is absent or did not answer — not «no
 * street here». The caller then says nothing about a street.
 */
export type NearestStreet =
  | { ok: true; street: string | null; distanceMeters: number | null }
  | { ok: false }

const REQUEST_TIMEOUT_MS = 2_000
const FAILURE_COOLDOWN_MS = 60_000
/** A road's name changes only when the road graph is rebuilt, monthly. */
const CACHE_TTL_MS = 6 * 60 * 60_000
const CACHE_LIMIT = 2_000
const MAX_NAME_LENGTH = 120

const cache = new Map<string, { at: number; value: { street: string | null; distanceMeters: number | null } }>()
let unavailableUntil = 0

export function nearestStreetUrl(baseUrl: string, latitude: number, longitude: number): string {
  // OSRM speaks [longitude, latitude].
  return `${baseUrl}/nearest/v1/driving/${longitude.toFixed(4)},${latitude.toFixed(4)}?number=1`
}

/** Read OSRM's answer: the nearest road's name, if it has one and is close enough to be «his street». */
export function parseNearestStreet(body: unknown): { street: string | null; distanceMeters: number | null } | null {
  if (!body || typeof body !== "object") return null
  const answer = body as { code?: unknown; waypoints?: unknown }
  if (typeof answer.code !== "string") return null
  // «NoSegment»: no road of the graph anywhere near (abroad, open sea) — answered, no street.
  if (answer.code !== "Ok" || !Array.isArray(answer.waypoints) || answer.waypoints.length === 0) {
    return { street: null, distanceMeters: null }
  }
  const waypoint = answer.waypoints[0] as { name?: unknown; distance?: unknown }
  const distance = typeof waypoint.distance === "number" && Number.isFinite(waypoint.distance) && waypoint.distance >= 0
    ? Math.round(waypoint.distance)
    : null
  const name = typeof waypoint.name === "string" ? waypoint.name.trim().slice(0, MAX_NAME_LENGTH) : ""
  // A road a block away is not where he is standing; an unnamed lane has nothing to say.
  if (!name || distance === null || distance > PLACE_MAX_ROAD_DISTANCE_METERS) return { street: null, distanceMeters: distance }
  return { street: name, distanceMeters: distance }
}

export async function nearestStreet(
  input: { latitude: number; longitude: number },
  options: {
    fetchImpl?: typeof fetch
    now?: () => number
    env?: Record<string, string | undefined>
  } = {},
): Promise<NearestStreet> {
  const now = options.now ?? Date.now
  const baseUrl = mapMatchingBaseUrl(options.env)
  if (!baseUrl) return { ok: false }

  const point = placeLookupPoint(input.latitude, input.longitude)
  const known = cache.get(point.key)
  if (known && now() - known.at < CACHE_TTL_MS) return { ok: true, ...known.value }
  // Down a moment ago: do not queue every open map behind a dead port.
  if (now() < unavailableUntil) return { ok: false }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await (options.fetchImpl ?? fetch)(
      nearestStreetUrl(baseUrl, point.latitude, point.longitude),
      { signal: controller.signal, cache: "no-store" },
    )
    const value = parseNearestStreet(await response.json().catch(() => null))
    if (!value) return { ok: false }
    if (cache.size >= CACHE_LIMIT) {
      const oldest = cache.keys().next().value
      if (oldest !== undefined) cache.delete(oldest)
    }
    cache.set(point.key, { at: now(), value })
    return { ok: true, ...value }
  } catch {
    unavailableUntil = now() + FAILURE_COOLDOWN_MS
    return { ok: false }
  } finally {
    clearTimeout(timer)
  }
}

export function resetNearestStreetStateForTests(): void {
  cache.clear()
  unavailableUntil = 0
}
