import { createHash } from "node:crypto"

/**
 * The day's GPS track along the streets (owner 2026-09-27: «отличная идея,
 * начинай» — self-hosted OSRM, see map-matching-pricing in the handoff), and
 * since 2026-09-28 («считай») the kilometres along them too.
 *
 * OSRM runs on the production host, bound to 127.0.0.1 and fed by the
 * `mtm-map-matching` workflow; nothing leaves the server. When it is absent,
 * slow or failing, the answer is partial or null and the callers keep
 * straight lines between fixes (road-distance.ts) — roads improve the
 * picture and the count, they never condition showing either.
 *
 * Work is cached per stretch of 100 fixes, not per day: a day that grows by
 * a fix every 30 seconds asks again only for its last stretch, and a month
 * reuses the days already read.
 */
export type MatchPoint = { latitude: number; longitude: number; recordedAt: Date | string; accuracy?: number | null }

export type MatchedTrack = {
  /** Road geometry, [latitude, longitude] pairs, one array per matched stretch. */
  segments: Array<Array<[number, number]>>
  matchedPoints: number
  totalPoints: number
  source: "osrm"
}

export type RoadMatch = MatchedTrack & {
  /**
   * Per input point: metres along the road of the step that arrives at it,
   * where OSRM answered for that step (0 for a fix it folded into the step
   * after it); null where no road answer covers the step.
   */
  stepMeters: Array<number | null>
  /** Every stretch and every silence got an answer — none lost to a timeout or an outage. */
  complete: boolean
}

/** A trace is cut where the phone was silent this long: no road is invented across it. */
export const MATCH_SPLIT_GAP_SECONDS = 10 * 60
/** Coordinates per OSRM request — its default `max-matching-size`. */
export const MATCH_CHUNK_SIZE = 100
const MIN_RADIUS_METERS = 5
const MAX_RADIUS_METERS = 50
const DEFAULT_RADIUS_METERS = 25
/** Across a silence, a fix farther than this from any road is not routed. */
const SILENCE_ROUTE_RADIUS_METERS = 100
const REQUEST_TIMEOUT_MS = 2_000
const DEFAULT_DEADLINE_MS = 5_000
const CONCURRENCY = 4
const FAILURE_COOLDOWN_MS = 60_000
const CACHE_LIMIT = 4_000
/** A stretch's answer changes only with the road graph, rebuilt monthly. */
const CACHE_TTL_MS = 6 * 60 * 60_000

/** Where OSRM listens: the env override, else the production host's own port. */
export function mapMatchingBaseUrl(env: Record<string, string | undefined> = process.env): string | null {
  const configured = env.MTM_MAP_MATCHING_URL?.trim()
  if (configured) return configured === "off" ? null : configured.replace(/\/+$/, "")
  return env.NODE_ENV === "production" ? "http://127.0.0.1:5055" : null
}

const epochSeconds = (value: Date | string) => Math.floor(new Date(value).getTime() / 1_000)

/**
 * Indices of the fixes to match: runs split where the phone was silent,
 * with strictly increasing timestamps (OSRM refuses a repeated second), cut
 * to the request size with one shared fix so the stretches join.
 */
function buildIndexedTraces(points: readonly MatchPoint[], chunkSize: number): { runs: number[][]; chunks: number[][] } {
  const runs: number[][] = []
  let run: number[] = []
  let lastSecond = Number.NEGATIVE_INFINITY
  points.forEach((point, index) => {
    const second = epochSeconds(point.recordedAt)
    if (!Number.isFinite(second) || !Number.isFinite(point.latitude) || !Number.isFinite(point.longitude)) return
    if (second <= lastSecond) return
    if (run.length && second - lastSecond > MATCH_SPLIT_GAP_SECONDS) {
      runs.push(run)
      run = []
    }
    run.push(index)
    lastSecond = second
  })
  if (run.length) runs.push(run)

  const chunks: number[][] = []
  for (const trace of runs) {
    for (let start = 0; start < trace.length - 1; start += chunkSize - 1) {
      const chunk = trace.slice(start, start + chunkSize)
      if (chunk.length > 1) chunks.push(chunk)
    }
  }
  return { runs, chunks }
}

export function buildMatchChunks(points: readonly MatchPoint[], chunkSize = MATCH_CHUNK_SIZE): MatchPoint[][] {
  return buildIndexedTraces(points, chunkSize).chunks.map((chunk) => chunk.map((index) => points[index]))
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

export function osrmRouteUrl(baseUrl: string, from: MatchPoint, to: MatchPoint): string {
  const coordinates = [from, to].map((point) => `${point.longitude.toFixed(6)},${point.latitude.toFixed(6)}`).join(";")
  const query = new URLSearchParams({
    overview: "false",
    steps: "false",
    radiuses: `${SILENCE_ROUTE_RADIUS_METERS};${SILENCE_ROUTE_RADIUS_METERS}`,
  })
  return `${baseUrl}/route/v1/driving/${coordinates}?${query.toString()}`
}

type OsrmTracepoint = { matchings_index?: number; waypoint_index?: number } | null

type OsrmMatchResponse = {
  code?: string
  matchings?: Array<{ geometry?: { coordinates?: Array<[number, number]> }; legs?: Array<{ distance?: number }> }>
  tracepoints?: OsrmTracepoint[]
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

type ChunkAnswer = { segments: Array<Array<[number, number]>>; matched: boolean[]; steps: Array<number | null> }

/**
 * One stretch's answer, step by step. A leg of a matching joins two matched
 * fixes; its length is the step arriving at the later one, and the fixes
 * OSRM folded in between (tidy, or unmatched inside the leg) add nothing.
 * «NoMatch» (a walk through a park) is an answer with no roads, not an outage.
 */
export function parseOsrmMatchSteps(body: OsrmMatchResponse, length: number): ChunkAnswer | null {
  const empty = (): ChunkAnswer => ({ segments: [], matched: Array(length).fill(false), steps: Array(length).fill(null) })
  if (body.code === "NoMatch") return empty()
  const drawn = parseOsrmMatch(body)
  if (!drawn) return null
  const answer = empty()
  answer.segments = drawn.segments
  const tracepoints = body.tracepoints ?? []
  const previous = new Map<number, { index: number; waypoint: number }>()
  for (let index = 0; index < Math.min(length, tracepoints.length); index += 1) {
    const tracepoint = tracepoints[index]
    if (!tracepoint || !Number.isInteger(tracepoint.matchings_index) || !Number.isInteger(tracepoint.waypoint_index)) continue
    const matching = tracepoint.matchings_index as number
    const waypoint = tracepoint.waypoint_index as number
    answer.matched[index] = true
    const before = previous.get(matching)
    const leg = body.matchings?.[matching]?.legs?.[waypoint - 1]?.distance
    if (before && waypoint === before.waypoint + 1 && typeof leg === "number" && Number.isFinite(leg)) {
      for (let folded = before.index + 1; folded < index; folded += 1) answer.steps[folded] = 0
      answer.steps[index] = leg
    }
    previous.set(matching, { index, waypoint })
  }
  return answer
}

let unavailableUntil = 0
const chunkCache = new Map<string, { at: number; value: ChunkAnswer }>()
const routeCache = new Map<string, { at: number; value: number | null }>()
const pathCache = new Map<string, { at: number; value: Array<[number, number]> | null }>()

/** Test hook: forget the caches and the cooldown. */
export function resetMapMatchingState() {
  unavailableUntil = 0
  chunkCache.clear()
  routeCache.clear()
  pathCache.clear()
}

function remember<T>(cache: Map<string, { at: number; value: T }>, key: string, value: T, at: number) {
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value as string)
  cache.set(key, { at, value })
}

function recall<T>(cache: Map<string, { at: number; value: T }>, key: string, now: number): { value: T } | null {
  const hit = cache.get(key)
  if (!hit || now - hit.at >= CACHE_TTL_MS) return null
  return { value: hit.value }
}

function hashKey(parts: string[]): string {
  const hash = createHash("sha256")
  for (const part of parts) hash.update(`|${part}`)
  return hash.digest("hex")
}

/**
 * The track along the streets and the metres along them, for the points as
 * given (stepMeters is aligned with them). Null only where there is no OSRM
 * to ask, it is cooling down after a failure, or there is nothing to match.
 */
export async function matchRoads(
  points: readonly MatchPoint[],
  options: { baseUrl?: string | null; fetchImpl?: typeof fetch; now?: () => number; deadlineMs?: number } = {},
): Promise<RoadMatch | null> {
  const baseUrl = options.baseUrl === undefined ? mapMatchingBaseUrl() : options.baseUrl
  if (!baseUrl || points.length < 2) return null
  const now = options.now ?? Date.now
  if (now() < unavailableUntil) return null
  const fetchImpl = options.fetchImpl ?? fetch
  const deadline = now() + (options.deadlineMs ?? DEFAULT_DEADLINE_MS)

  const { runs, chunks } = buildIndexedTraces(points, MATCH_CHUNK_SIZE)
  const stepMeters: Array<number | null> = Array(points.length).fill(null)
  const matched: boolean[] = Array(points.length).fill(false)
  const chunkAnswers: Array<ChunkAnswer | null> = Array(chunks.length).fill(null)
  const silences = runs.slice(1).map((run, index) => ({ from: runs[index].at(-1) as number, to: run[0] }))
  const silenceAnswers: Array<{ value: number | null } | null> = Array(silences.length).fill(null)
  let failed = false

  const ask = async (url: string): Promise<unknown | null> => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), Math.max(1, Math.min(REQUEST_TIMEOUT_MS, deadline - now())))
    try {
      const response = await fetchImpl(url, { signal: controller.signal, cache: "no-store" })
      return await response.json().catch(() => null)
    } catch {
      // Down, refusing connections or too slow: straight lines for a minute.
      failed = true
      unavailableUntil = now() + FAILURE_COOLDOWN_MS
      return null
    } finally {
      clearTimeout(timer)
    }
  }

  // What is cached is taken first and never waits behind a request.
  const jobs: Array<() => Promise<void>> = []
  chunks.forEach((chunk, position) => {
    const url = osrmMatchUrl(baseUrl, chunk.map((index) => points[index]))
    const key = hashKey([url])
    const cached = recall(chunkCache, key, now())
    if (cached) {
      chunkAnswers[position] = cached.value
      return
    }
    jobs.push(async () => {
      const body = await ask(url)
      const answer = body ? parseOsrmMatchSteps(body as OsrmMatchResponse, chunk.length) : null
      if (answer) {
        chunkAnswers[position] = answer
        remember(chunkCache, key, answer, now())
      }
    })
  })
  silences.forEach((silence, position) => {
    const url = osrmRouteUrl(baseUrl, points[silence.from], points[silence.to])
    const cached = recall(routeCache, url, now())
    if (cached) {
      silenceAnswers[position] = cached
      return
    }
    jobs.push(async () => {
      const body = await ask(url) as { code?: string; routes?: Array<{ distance?: number }> } | null
      if (!body || typeof body.code !== "string") return
      const distance = body.code === "Ok" ? body.routes?.[0]?.distance : undefined
      // «NoSegment»: a fix far from any road of the graph (abroad, a field) — answered, no road.
      const value = typeof distance === "number" && Number.isFinite(distance) ? distance : null
      silenceAnswers[position] = { value }
      remember(routeCache, url, value, now())
    })
  })

  let next = 0
  const worker = async () => {
    while (next < jobs.length && !failed && now() < deadline) {
      const job = jobs[next]
      next += 1
      await job()
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, worker))

  const segments: Array<Array<[number, number]>> = []
  chunks.forEach((chunk, position) => {
    const answer = chunkAnswers[position]
    if (!answer) return
    segments.push(...answer.segments)
    chunk.forEach((pointIndex, offset) => {
      if (answer.matched[offset]) matched[pointIndex] = true
      // The first fix of a stretch is the last of the one before: its step belongs there.
      if (offset > 0 && answer.steps[offset] != null) stepMeters[pointIndex] = answer.steps[offset]
    })
  })
  silences.forEach((silence, position) => {
    const answer = silenceAnswers[position]
    if (answer?.value != null) stepMeters[silence.to] = answer.value
  })

  const answeredAll = chunkAnswers.every(Boolean) && silenceAnswers.every(Boolean)
  if (!chunkAnswers.some(Boolean) && !silenceAnswers.some(Boolean)) return null
  return {
    segments,
    matchedPoints: matched.filter(Boolean).length,
    totalPoints: points.length,
    source: "osrm",
    stepMeters,
    complete: answeredAll,
  }
}

/**
 * The road between two places as a line of [latitude, longitude], for the
 * demo pulse to drive along (demo-pulse.ts). Null when there is no OSRM, no
 * road near either end, or no answer — the caller keeps its straight line.
 */
export async function roadPath(
  from: { latitude: number; longitude: number },
  to: { latitude: number; longitude: number },
  options: { baseUrl?: string | null; fetchImpl?: typeof fetch; now?: () => number } = {},
): Promise<Array<[number, number]> | null> {
  const baseUrl = options.baseUrl === undefined ? mapMatchingBaseUrl() : options.baseUrl
  if (!baseUrl) return null
  const now = options.now ?? Date.now
  if (now() < unavailableUntil) return null
  const coordinates = [from, to].map((point) => `${point.longitude.toFixed(6)},${point.latitude.toFixed(6)}`).join(";")
  const url = `${baseUrl}/route/v1/driving/${coordinates}?${new URLSearchParams({
    overview: "full",
    geometries: "geojson",
    steps: "false",
  }).toString()}`
  const cached = recall(pathCache, url, now())
  if (cached) return cached.value
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await (options.fetchImpl ?? fetch)(url, { signal: controller.signal, cache: "no-store" })
    const body = await response.json().catch(() => null) as { code?: string; routes?: Array<{ geometry?: { coordinates?: Array<[number, number]> } }> } | null
    if (!body || typeof body.code !== "string") return null
    const line = body.code === "Ok"
      ? (body.routes?.[0]?.geometry?.coordinates ?? [])
        .filter((pair) => Array.isArray(pair) && Number.isFinite(pair[0]) && Number.isFinite(pair[1]))
        .map(([longitude, latitude]) => [latitude, longitude] as [number, number])
      : []
    const value = line.length > 1 ? line : null
    remember(pathCache, url, value, now())
    return value
  } catch {
    unavailableUntil = now() + FAILURE_COOLDOWN_MS
    return null
  } finally {
    clearTimeout(timer)
  }
}

/** The drawing alone, for callers that only show the track. */
export async function matchTrack(
  points: readonly MatchPoint[],
  options: { baseUrl?: string | null; fetchImpl?: typeof fetch; now?: () => number; deadlineMs?: number } = {},
): Promise<MatchedTrack | null> {
  const match = await matchRoads(points, options)
  if (!match || !match.segments.length) return null
  return { segments: match.segments, matchedPoints: match.matchedPoints, totalPoints: match.totalPoints, source: match.source }
}
