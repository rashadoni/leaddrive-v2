import { createHash } from "node:crypto"

/**
 * The day's GPS track drawn along the streets (owner 2026-09-27: «отличная
 * идея, начинай» — self-hosted OSRM, see map-matching-pricing in the handoff).
 * Until now the track was straight lines between fixes, across houses.
 *
 * OSRM runs on the production host, bound to 127.0.0.1 and fed by the
 * `mtm-map-matching` workflow; nothing leaves the server. When it is absent,
 * slow or failing, the answer is null and the map keeps its straight lines —
 * snapping is an improvement of the drawing, never a condition for showing it.
 *
 * Distances stay as they are (haversine between accepted fixes): a matched
 * line is a picture of the likely road, not a measured one.
 */
export type MatchPoint = { latitude: number; longitude: number; recordedAt: Date | string; accuracy?: number | null }

export type MatchedTrack = {
  /** Road geometry, [latitude, longitude] pairs, one array per matched stretch. */
  segments: Array<Array<[number, number]>>
  matchedPoints: number
  totalPoints: number
  source: "osrm"
}

/** A trace is cut where the phone was silent this long: no road is invented across it. */
export const MATCH_SPLIT_GAP_SECONDS = 10 * 60
/** Coordinates per OSRM request — its default `max-matching-size`. */
export const MATCH_CHUNK_SIZE = 100
const MIN_RADIUS_METERS = 5
const MAX_RADIUS_METERS = 50
const DEFAULT_RADIUS_METERS = 25
const REQUEST_TIMEOUT_MS = 2_000
const FAILURE_COOLDOWN_MS = 60_000
const CACHE_LIMIT = 200
const CACHE_TTL_MS = 10 * 60_000

/** Where OSRM listens: the env override, else the production host's own port. */
export function mapMatchingBaseUrl(env: Record<string, string | undefined> = process.env): string | null {
  const configured = env.MTM_MAP_MATCHING_URL?.trim()
  if (configured) return configured === "off" ? null : configured.replace(/\/+$/, "")
  return env.NODE_ENV === "production" ? "http://127.0.0.1:5055" : null
}

const epochSeconds = (value: Date | string) => Math.floor(new Date(value).getTime() / 1_000)

/**
 * Traces to match: split where the phone was silent, cut to the request size
 * with one shared fix so the stretches join, and with strictly increasing
 * timestamps (OSRM refuses a repeated second).
 */
export function buildMatchChunks(points: readonly MatchPoint[], chunkSize = MATCH_CHUNK_SIZE): MatchPoint[][] {
  const runs: MatchPoint[][] = []
  let run: MatchPoint[] = []
  let lastSecond = Number.NEGATIVE_INFINITY
  for (const point of points) {
    const second = epochSeconds(point.recordedAt)
    if (!Number.isFinite(second) || !Number.isFinite(point.latitude) || !Number.isFinite(point.longitude)) continue
    if (second <= lastSecond) continue
    if (run.length && second - lastSecond > MATCH_SPLIT_GAP_SECONDS) {
      if (run.length > 1) runs.push(run)
      run = []
    }
    run.push(point)
    lastSecond = second
  }
  if (run.length > 1) runs.push(run)

  const chunks: MatchPoint[][] = []
  for (const trace of runs) {
    for (let start = 0; start < trace.length - 1; start += chunkSize - 1) {
      const chunk = trace.slice(start, start + chunkSize)
      if (chunk.length > 1) chunks.push(chunk)
    }
  }
  return chunks
}

export function osrmMatchUrl(baseUrl: string, chunk: readonly MatchPoint[]): string {
  const coordinates = chunk.map((point) => `${point.longitude.toFixed(6)},${point.latitude.toFixed(6)}`).join(";")
  const timestamps = chunk.map((point) => epochSeconds(point.recordedAt)).join(";")
  const radiuses = chunk.map((point) => {
    const accuracy = typeof point.accuracy === "number" && Number.isFinite(point.accuracy) ? point.accuracy : DEFAULT_RADIUS_METERS
    return Math.round(Math.min(MAX_RADIUS_METERS, Math.max(MIN_RADIUS_METERS, accuracy)))
  }).join(";")
  const query = new URLSearchParams({
    geometries: "geojson",
    overview: "full",
    gaps: "split",
    tidy: "true",
    steps: "false",
    annotations: "false",
    timestamps,
    radiuses,
  })
  return `${baseUrl}/match/v1/driving/${coordinates}?${query.toString()}`
}

type OsrmMatchResponse = {
  code?: string
  matchings?: Array<{ geometry?: { coordinates?: Array<[number, number]> } }>
  tracepoints?: Array<unknown | null>
}

/** OSRM speaks [longitude, latitude]; the map speaks [latitude, longitude]. */
export function parseOsrmMatch(body: OsrmMatchResponse): { segments: Array<Array<[number, number]>>; matchedPoints: number } | null {
  if (body.code !== "Ok" || !Array.isArray(body.matchings)) return null
  const segments = body.matchings
    .map((matching) => (matching.geometry?.coordinates ?? [])
      .filter((pair) => Array.isArray(pair) && Number.isFinite(pair[0]) && Number.isFinite(pair[1]))
      .map(([longitude, latitude]) => [latitude, longitude] as [number, number]))
    .filter((segment) => segment.length > 1)
  const matchedPoints = (body.tracepoints ?? []).filter((tracepoint) => tracepoint !== null).length
  return { segments, matchedPoints }
}

let unavailableUntil = 0
const cache = new Map<string, { at: number; value: MatchedTrack | null }>()

/** Test hook: forget the cache and the cooldown. */
export function resetMapMatchingState() {
  unavailableUntil = 0
  cache.clear()
}

function cacheKey(scope: string, points: readonly MatchPoint[]): string {
  const hash = createHash("sha256")
  hash.update(scope)
  for (const point of points) hash.update(`|${point.latitude},${point.longitude},${epochSeconds(point.recordedAt)}`)
  return hash.digest("hex")
}

export async function matchTrack(
  points: readonly MatchPoint[],
  options: { scope?: string; baseUrl?: string | null; fetchImpl?: typeof fetch; now?: () => number } = {},
): Promise<MatchedTrack | null> {
  const baseUrl = options.baseUrl === undefined ? mapMatchingBaseUrl() : options.baseUrl
  if (!baseUrl || points.length < 2) return null
  const now = options.now ?? Date.now
  if (now() < unavailableUntil) return null

  const key = cacheKey(`${baseUrl}|${options.scope ?? ""}`, points)
  const cached = cache.get(key)
  if (cached && now() - cached.at < CACHE_TTL_MS) return cached.value

  const fetchImpl = options.fetchImpl ?? fetch
  const chunks = buildMatchChunks(points)
  const segments: Array<Array<[number, number]>> = []
  let matchedPoints = 0
  for (const chunk of chunks) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    try {
      const response = await fetchImpl(osrmMatchUrl(baseUrl, chunk), { signal: controller.signal, cache: "no-store" })
      const body = await response.json().catch(() => null) as OsrmMatchResponse | null
      // «NoMatch» for one stretch (a walk through a park) is an answer, not an outage.
      const parsed = body ? parseOsrmMatch(body) : null
      if (parsed) {
        segments.push(...parsed.segments)
        matchedPoints += parsed.matchedPoints
      }
    } catch {
      // Down, refusing connections or too slow: straight lines for a minute.
      unavailableUntil = now() + FAILURE_COOLDOWN_MS
      return null
    } finally {
      clearTimeout(timer)
    }
  }

  const value: MatchedTrack | null = segments.length
    ? { segments, matchedPoints, totalPoints: points.length, source: "osrm" }
    : null
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value as string)
  cache.set(key, { at: now(), value })
  return value
}
