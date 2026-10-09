/**
 * «След» on the live map: where an employee has just been.
 *
 * Owner, 2026-10-09, of the fleet tracker shown to him as the model: «бери
 * почти всё, чего нет у нас». There the marker drags a short tail behind it,
 * so a glance says which way somebody is going and whether he is moving at
 * all. Here a marker used to jump from one place to another every thirty
 * seconds with nothing between.
 *
 * The tail is made only of positions this page has itself seen while it was
 * open — one per answer of the roster, each of them an admissible live
 * coordinate at the time. Nothing is loaded for it: the full track of the day
 * stays in «История» (SWM-12 — live mode never loads a day's GPS). So a page
 * opened a minute ago has no tails yet, and that is the truth.
 *
 * Pure data and pure functions.
 */
import { calculateDistance } from "@/lib/geo-utils"

export interface LiveMapTrailPoint {
  latitude: number
  longitude: number
  /** When the phone recorded it — not when the page received it. */
  recordedAt: string
  /**
   * The latest fix that was still at this place. Somebody standing at a client
   * for ten minutes adds no points, but his phone was not silent: the line on
   * from here is drawn, and the point does not age while he stands on it.
   */
  heardAt?: string
}

export type LiveMapTrails = ReadonlyMap<string, readonly LiveMapTrailPoint[]>

/**
 * A tail is the last half hour. The roster answers every thirty seconds, so
 * somebody who never stops adds sixty points in that time; a few more for an
 * answer asked for by hand.
 */
export const TRAIL_MAX_AGE_MS = 30 * 60_000
export const TRAIL_MAX_POINTS = 72
/** Standing still: GPS wanders a few metres, and that is not a journey. */
export const TRAIL_MIN_STEP_METERS = 15
/**
 * Two points further apart in time than this are not joined: the phone was
 * silent in between, and a straight line across the gap would be drawn through
 * buildings the employee never walked through.
 */
export const TRAIL_MAX_GAP_MS = 5 * 60_000

interface TrailSource {
  agentId: string
  latitude?: number | null
  longitude?: number | null
  recordedAt?: string | null
}

/** The last moment the phone is known to have been at this point. */
function lastHeardMs(point: LiveMapTrailPoint): number {
  return Date.parse(point.heardAt ?? point.recordedAt)
}

function admissible(agent: TrailSource): LiveMapTrailPoint | null {
  const { latitude, longitude, recordedAt } = agent
  if (typeof latitude !== "number" || !Number.isFinite(latitude) || latitude < -90 || latitude > 90) return null
  if (typeof longitude !== "number" || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) return null
  if (typeof recordedAt !== "string" || !Number.isFinite(Date.parse(recordedAt))) return null
  return { latitude, longitude, recordedAt }
}

/**
 * The tails after one more answer of the roster. A point older than the last
 * one, the same point again, or a step shorter than GPS noise adds nothing.
 *
 * Somebody missing from the answer keeps what he had until it ages out: the
 * name search narrows the roster for a moment, and clearing it must not find
 * every tail gone. A tail is drawn only beside a marker, so an employee who
 * has really left the roster has none on the map.
 */
export function extendLiveMapTrails(trails: LiveMapTrails, agents: readonly TrailSource[], nowMs: number): LiveMapTrails {
  const next = new Map<string, readonly LiveMapTrailPoint[]>()
  for (const [agentId, points] of trails) {
    const kept = points.filter((point) => nowMs - lastHeardMs(point) <= TRAIL_MAX_AGE_MS)
    if (kept.length > 0) next.set(agentId, kept)
  }
  for (const agent of agents) {
    const kept = next.get(agent.agentId) ?? []
    const point = admissible(agent)
    if (!point || nowMs - Date.parse(point.recordedAt) > TRAIL_MAX_AGE_MS) continue
    const last = kept[kept.length - 1]
    if (!last) {
      next.set(agent.agentId, [point])
      continue
    }
    // Older than what is already known, or the same answer again: nothing new.
    if (Date.parse(point.recordedAt) <= lastHeardMs(last)) continue
    const moved = calculateDistance(last.latitude, last.longitude, point.latitude, point.longitude) >= TRAIL_MIN_STEP_METERS
    next.set(agent.agentId, moved
      ? [...kept, point].slice(-TRAIL_MAX_POINTS)
      // Still standing where he was: the place is the same, the time moves on.
      : [...kept.slice(0, -1), { ...last, heardAt: point.recordedAt }])
  }
  return next
}

/** The tail as lines to draw: broken wherever the phone was silent for too long. */
export function liveMapTrailSegments(points: readonly LiveMapTrailPoint[]): LiveMapTrailPoint[][] {
  const segments: LiveMapTrailPoint[][] = []
  let current: LiveMapTrailPoint[] = []
  for (const point of points) {
    const previous = current[current.length - 1]
    if (previous && Date.parse(point.recordedAt) - lastHeardMs(previous) > TRAIL_MAX_GAP_MS) {
      if (current.length >= 2) segments.push(current)
      current = []
    }
    current.push(point)
  }
  if (current.length >= 2) segments.push(current)
  return segments
}

/** Metres along a line of points — the ruler's total. */
export function pathLengthMeters(points: readonly { latitude: number; longitude: number }[]): number {
  let total = 0
  for (let index = 1; index < points.length; index += 1) {
    total += calculateDistance(points[index - 1].latitude, points[index - 1].longitude, points[index].latitude, points[index].longitude)
  }
  return total
}

/**
 * Square metres inside the line of points when it is closed back to its
 * first point — the ruler's area, from three points on. The sum of spherical
 * trapezoids under each edge: exact enough for a district or a field, and it
 * does not care which way round the points were put.
 */
export function polygonAreaSquareMeters(points: readonly { latitude: number; longitude: number }[]): number {
  if (points.length < 3) return 0
  const radians = (degrees: number) => (degrees * Math.PI) / 180
  const earthRadiusMeters = 6_371_000
  let sum = 0
  for (let index = 0; index < points.length; index += 1) {
    const from = points[index]
    const to = points[(index + 1) % points.length]
    sum += radians(to.longitude - from.longitude) * (2 + Math.sin(radians(from.latitude)) + Math.sin(radians(to.latitude)))
  }
  return Math.abs((sum * earthRadiusMeters * earthRadiusMeters) / 2)
}

type RulerPoint = { latitude: number; longitude: number }

function turn(a: RulerPoint, b: RulerPoint, c: RulerPoint): number {
  return (b.longitude - a.longitude) * (c.latitude - a.latitude) - (b.latitude - a.latitude) * (c.longitude - a.longitude)
}

function properlyCross(a: RulerPoint, b: RulerPoint, c: RulerPoint, d: RulerPoint): boolean {
  const d1 = turn(a, b, c)
  const d2 = turn(a, b, d)
  const d3 = turn(c, d, a)
  const d4 = turn(c, d, b)
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
}

/**
 * Does the outline — the points in order, closed back to the first — cross
 * itself? A figure of eight has no single «area»: the sum above subtracts one
 * loop from the other and reads near zero under a shape that is plainly not
 * empty. The ruler then says no area rather than that number. A handful of
 * points, so every pair of edges is simply tried.
 */
export function outlineCrossesItself(points: readonly RulerPoint[]): boolean {
  const count = points.length
  if (count < 4) return false
  for (let first = 0; first < count; first += 1) {
    for (let second = first + 1; second < count; second += 1) {
      // Neighbouring edges share a corner; that is not a crossing.
      if (second === first + 1 || (first === 0 && second === count - 1)) continue
      if (properlyCross(points[first], points[(first + 1) % count], points[second], points[(second + 1) % count])) return true
    }
  }
  return false
}
