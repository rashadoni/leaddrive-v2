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
}

export type LiveMapTrails = ReadonlyMap<string, readonly LiveMapTrailPoint[]>

/** A tail is the last half hour, and no longer than this many points. */
export const TRAIL_MAX_AGE_MS = 30 * 60_000
export const TRAIL_MAX_POINTS = 40
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
    const kept = points.filter((point) => nowMs - Date.parse(point.recordedAt) <= TRAIL_MAX_AGE_MS)
    if (kept.length > 0) next.set(agentId, kept)
  }
  for (const agent of agents) {
    const kept = next.get(agent.agentId) ?? []
    const point = admissible(agent)
    const last = kept[kept.length - 1]
    const fresh = point != null && nowMs - Date.parse(point.recordedAt) <= TRAIL_MAX_AGE_MS
    const moved = point != null && (last == null || (
      Date.parse(point.recordedAt) > Date.parse(last.recordedAt) &&
      calculateDistance(last.latitude, last.longitude, point.latitude, point.longitude) >= TRAIL_MIN_STEP_METERS
    ))
    if (fresh && moved && point) next.set(agent.agentId, [...kept, point].slice(-TRAIL_MAX_POINTS))
  }
  return next
}

/** The tail as lines to draw: broken wherever the phone was silent for too long. */
export function liveMapTrailSegments(points: readonly LiveMapTrailPoint[]): LiveMapTrailPoint[][] {
  const segments: LiveMapTrailPoint[][] = []
  let current: LiveMapTrailPoint[] = []
  for (const point of points) {
    const previous = current[current.length - 1]
    if (previous && Date.parse(point.recordedAt) - Date.parse(previous.recordedAt) > TRAIL_MAX_GAP_MS) {
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
