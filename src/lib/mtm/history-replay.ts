/**
 * «Проиграть день» by the clock.
 *
 * The replay used to step from one GPS fix to the next, one per beat: forty
 * minutes at a client went by as fast as thirty seconds of driving, and the
 * line along the streets vanished while it played, because a road line could
 * not be cut at a moment of the day. Now the replay holds a moment — a time
 * of day — and everything is drawn as it was then: the employee between two
 * fixes, the way he was moving and heading, the track up to that moment, on
 * the streets too.
 *
 * A break is the employee's own time (owner's rule). Nothing is drawn across
 * it: the marker waits at the point he left before it, as a break, and moves
 * on from his first fix after it. The same holds for a lost signal — nobody
 * saw the way he went, so it is not invented.
 *
 * Pure data and pure functions.
 */
import { calculateDistance } from "@/lib/geo-utils"
import {
  bearingDegrees,
  MTM_TRIP_GAP_MAX_MS,
  readMtmMovement,
  type MtmMovementFix,
  type MtmMovementMode,
  type MtmMovementReading,
} from "@/lib/mtm/movement-mode"

export type HistoryReplayGap = {
  startedAt: string
  endedAt: string
  reason?: "TELEMETRY_GAP" | "WORKDAY_PAUSED"
}

/** What lies after each fix: nothing, a lost signal, or a break. */
export type HistoryReplayCut = null | "GAP" | "BREAK"

/**
 * After which fixes the track breaks. A gap starts at the last fix before the
 * silence, to the second (the same rule as splitHistoryPathAtGaps); two fixes
 * further apart than a trip allows are a silence even if no gap was recorded.
 */
export function historyReplayCuts(points: readonly MtmMovementFix[], gaps: readonly HistoryReplayGap[]): HistoryReplayCut[] {
  const starts = gaps
    .map((gap) => ({ at: Date.parse(gap.startedAt), reason: gap.reason }))
    .filter((gap) => Number.isFinite(gap.at))
  return points.map((point, index) => {
    if (index === points.length - 1) return null
    const at = Date.parse(point.recordedAt)
    const next = Date.parse(points[index + 1].recordedAt)
    const gap = starts.find((start) => Math.abs(start.at - at) < 1_000 && next > start.at)
    if (gap) return gap.reason === "WORKDAY_PAUSED" ? "BREAK" : "GAP"
    return next - at > MTM_TRIP_GAP_MAX_MS ? "GAP" : null
  })
}

/** The day read as trips, never joining two fixes across a cut. */
export function readHistoryMovement(points: readonly MtmMovementFix[], cuts: readonly HistoryReplayCut[]): MtmMovementReading {
  const reading: MtmMovementReading = { modes: [], headings: [], trips: [] }
  let start = 0
  for (let index = 0; index < points.length; index += 1) {
    if (index < points.length - 1 && cuts[index] == null) continue
    const run = readMtmMovement(points.slice(start, index + 1))
    reading.modes.push(...run.modes)
    reading.headings.push(...run.headings)
    reading.trips.push(...run.trips.map((trip) => ({ ...trip, fromIndex: trip.fromIndex + start, toIndex: trip.toIndex + start })))
    start = index + 1
  }
  return reading
}

export interface HistoryReplayFrame {
  /** The last fix at or before the moment. */
  index: number
  latitude: number
  longitude: number
  /** How he was moving; a break or a lost signal while the moment is inside one. */
  mode: MtmMovementMode | "GAP" | "BREAK"
  heading: number | null
}

/** The last fix at or before `atMs`; 0 before the first. */
export function historyReplayIndex(points: readonly MtmMovementFix[], atMs: number): number {
  let low = 0
  let high = points.length - 1
  let found = 0
  while (low <= high) {
    const middle = (low + high) >> 1
    if (Date.parse(points[middle].recordedAt) <= atMs) {
      found = middle
      low = middle + 1
    } else {
      high = middle - 1
    }
  }
  return found
}

/** Where the employee was at a moment of the day, and how he was moving. */
export function historyReplayFrame(
  points: readonly MtmMovementFix[],
  reading: MtmMovementReading,
  cuts: readonly HistoryReplayCut[],
  atMs: number,
): HistoryReplayFrame | null {
  if (points.length === 0) return null
  const index = historyReplayIndex(points, atMs)
  const fix = points[index]
  const here = { index, latitude: fix.latitude, longitude: fix.longitude }
  const mode = reading.modes[index] ?? "STAY"
  const fixAt = Date.parse(fix.recordedAt)
  if (index === points.length - 1 || atMs <= fixAt) {
    return { ...here, mode, heading: mode === "STAY" ? null : reading.headings[index] ?? null }
  }
  const cut = cuts[index]
  if (cut) return { ...here, mode: cut, heading: null }
  const next = points[index + 1]
  const nextAt = Date.parse(next.recordedAt)
  const share = nextAt > fixAt ? Math.min(1, (atMs - fixAt) / (nextAt - fixAt)) : 0
  const nextMode = reading.modes[index + 1] ?? "STAY"
  // Standing, and the next fix already moves: he is setting off.
  const nowMode = mode === "STAY" ? nextMode : mode
  const moved = calculateDistance(fix.latitude, fix.longitude, next.latitude, next.longitude)
  const heading = nowMode === "STAY"
    ? null
    : moved >= 15 ? bearingDegrees(fix, next) : reading.headings[index] ?? reading.headings[index + 1] ?? null
  return {
    index,
    latitude: fix.latitude + (next.latitude - fix.latitude) * share,
    longitude: fix.longitude + (next.longitude - fix.longitude) * share,
    mode: nowMode,
    heading,
  }
}

/**
 * «Пропускать стоянки»: from a moment he stands, sits out a break or is out
 * of signal, the moment he next moves — or the end of the day. A moment he
 * is moving is returned as it is.
 */
export function historyReplaySkipStill(
  points: readonly MtmMovementFix[],
  reading: MtmMovementReading,
  cuts: readonly HistoryReplayCut[],
  atMs: number,
): number {
  const frame = historyReplayFrame(points, reading, cuts, atMs)
  if (!frame || frame.mode === "DRIVE" || frame.mode === "WALK") return atMs
  for (let index = frame.index + 1; index < points.length; index += 1) {
    if (reading.modes[index] !== "STAY") {
      // Across a break or a lost signal: straight to his first fix after it.
      if (cuts[index - 1]) return Date.parse(points[index].recordedAt)
      // Otherwise a moment before the move, from the last still fix, so the
      // marker is seen setting off rather than appearing on the road.
      return Math.max(atMs, Date.parse(points[index - 1].recordedAt))
    }
  }
  return Date.parse(points[points.length - 1].recordedAt)
}

export interface TimedVertex {
  latitude: number
  longitude: number
  /** The fix this place of the line belongs to. */
  fixIndex: number
}

/**
 * The line along the streets with a fix for each of its places, so it can be
 * cut at a moment and coloured by the way he was moving. The street line has
 * no times of its own; it runs the way the fixes do, so each place is given
 * the nearest fix at or after the one before it.
 */
export function timeRoadTrack(
  segments: ReadonlyArray<ReadonlyArray<readonly [number, number]>>,
  points: readonly MtmMovementFix[],
): TimedVertex[][] {
  if (points.length === 0) return []
  const LOOK_AHEAD = 40
  let cursor = 0
  return segments.map((segment) => segment.map(([latitude, longitude]) => {
    let best = cursor
    let bestMetres = Number.POSITIVE_INFINITY
    for (let index = cursor; index < Math.min(points.length, cursor + LOOK_AHEAD); index += 1) {
      const distance = calculateDistance(latitude, longitude, points[index].latitude, points[index].longitude)
      if (distance < bestMetres) {
        bestMetres = distance
        best = index
      }
    }
    cursor = best
    return { latitude, longitude, fixIndex: best }
  }))
}

export interface ModeRun {
  mode: MtmMovementMode
  path: Array<[number, number]>
}

/**
 * A line as pieces of one way of moving each — car, on foot, standing — up
 * to the moment the replay holds. The place where the way of moving changes
 * belongs to both pieces, so the line is not broken there.
 *
 * `until` — the frame of the replay: the line ends at its fix, and, between
 * two fixes, at the employee himself. Absent: the whole line.
 */
export function modeRuns(
  vertices: readonly TimedVertex[],
  modes: readonly MtmMovementMode[],
  until?: HistoryReplayFrame | null,
): ModeRun[] {
  const runs: ModeRun[] = []
  let reached: TimedVertex | null = null
  for (const vertex of vertices) {
    if (until && vertex.fixIndex > until.index) break
    reached = vertex
    const mode = modes[vertex.fixIndex] ?? "STAY"
    const place: [number, number] = [vertex.latitude, vertex.longitude]
    const current = runs.at(-1)
    if (current && current.mode === mode) {
      current.path.push(place)
      continue
    }
    const joint = current?.path.at(-1)
    runs.push({ mode, path: joint ? [joint, place] : [place] })
  }
  // Between two fixes the line runs on to the employee himself — only on the
  // piece he is on now, never on one that ended before the moment.
  const current = runs.at(-1)
  const end = current?.path.at(-1)
  if (until && current && end && reached?.fixIndex === until.index && (until.mode === "DRIVE" || until.mode === "WALK") &&
      (end[0] !== until.latitude || end[1] !== until.longitude)) {
    current.path.push([until.latitude, until.longitude])
  }
  return runs.filter((run) => run.path.length >= 2)
}
