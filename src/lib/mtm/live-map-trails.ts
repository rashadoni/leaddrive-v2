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
 * A break ends a tail. It is the employee's own time (owner's rule): nothing
 * is recorded during it, and a line from where he paused to where he resumed
 * would say where he went in between. So the tail of somebody on a break is
 * cut: what is left of it is one mark, never drawn, at the newest moment the
 * page knew of him then, and only a position recorded after that mark starts
 * a new tail. Dropping the tail alone was not enough (verification of
 * 2026-10-20): the first answer after RESUME can still carry the point he
 * left before the break, and with no tail to compare it with it began a new
 * one that the first fix after the break then joined — a line across the
 * break. The server, for its part, no longer calls that point live
 * (isMtmPositionHeldByBreak). A break that began and ended between two
 * answers of the roster is given away by the server's running total of
 * breaks.
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
  /**
   * The workday's seconds of break already over when this position was seen
   * (`workdayPausedSeconds`). A position with a different total lies on the
   * other side of a break, and the tail does not join the two.
   */
  workdayPausedSeconds?: number | null
  /**
   * Where the tail was cut by a break: the newest moment the page knew of
   * him when he was seen on it. Never drawn; it only says that nothing
   * recorded up to it may start a tail again.
   */
  breakCut?: true
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
  /** See LiveMapTrailPoint; absent where the organization keeps no workday breaks. */
  workdayPausedSeconds?: number | null
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
  const breaks = breaksOver(agent.workdayPausedSeconds)
  return breaks == null ? { latitude, longitude, recordedAt } : { latitude, longitude, recordedAt, workdayPausedSeconds: breaks }
}

function breaksOver(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null
}

/** A break was taken between the two: both totals are known and they differ. */
function breakBetween(last: LiveMapTrailPoint, next: LiveMapTrailPoint): boolean {
  const before = breaksOver(last.workdayPausedSeconds)
  const after = breaksOver(next.workdayPausedSeconds)
  return before != null && after != null && before !== after
}

/**
 * The tails after one more answer of the roster. A point older than the last
 * one, the same point again, or a step shorter than GPS noise adds nothing.
 *
 * Somebody missing from the answer keeps what he had until it ages out: the
 * name search narrows the roster for a moment, and clearing it must not find
 * every tail gone. A tail is drawn only beside a marker, so an employee who
 * has really left the roster has none on the map.
 *
 * `onBreak` — who is on a break in this answer, with the position that came
 * with him: his tail is cut (see the top of this file), and he adds nothing
 * to it whatever position comes with him.
 */
export function extendLiveMapTrails(
  trails: LiveMapTrails,
  agents: readonly TrailSource[],
  nowMs: number,
  onBreak: readonly TrailSource[] = [],
): LiveMapTrails {
  const fresh = (point: LiveMapTrailPoint) => nowMs - lastHeardMs(point) <= TRAIL_MAX_AGE_MS
  const next = new Map<string, readonly LiveMapTrailPoint[]>()
  for (const [agentId, points] of trails) {
    const kept = points.filter(fresh)
    if (kept.length > 0) next.set(agentId, kept)
  }
  const resting = new Set<string>()
  for (const agent of onBreak) {
    resting.add(agent.agentId)
    const known = [next.get(agent.agentId)?.at(-1), admissible(agent)]
      .filter((point): point is LiveMapTrailPoint => point != null && fresh(point))
    const newest = known.reduce<LiveMapTrailPoint | null>((found, point) => (!found || lastHeardMs(point) > lastHeardMs(found) ? point : found), null)
    if (!newest) {
      next.delete(agent.agentId)
      continue
    }
    next.set(agent.agentId, [{
      latitude: newest.latitude,
      longitude: newest.longitude,
      recordedAt: newest.recordedAt,
      ...(newest.heardAt ? { heardAt: newest.heardAt } : {}),
      breakCut: true,
    }])
  }
  for (const agent of agents) {
    if (resting.has(agent.agentId)) continue
    const kept = next.get(agent.agentId) ?? []
    const point = admissible(agent)
    if (!point || nowMs - Date.parse(point.recordedAt) > TRAIL_MAX_AGE_MS) continue
    const last = kept[kept.length - 1]
    if (!last) {
      next.set(agent.agentId, [point])
      continue
    }
    // Older than what is already known, or the same answer again: nothing new
    // — nor anything recorded up to the place a break cut the tail at.
    if (Date.parse(point.recordedAt) <= lastHeardMs(last)) continue
    // After a break: a new tail.
    if (last.breakCut || breakBetween(last, point)) {
      next.set(agent.agentId, [point])
      continue
    }
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
    // A break's mark is never drawn, and nothing is drawn across it.
    if (point.breakCut) {
      if (current.length >= 2) segments.push(current)
      current = []
      continue
    }
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
