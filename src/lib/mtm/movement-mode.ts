/**
 * How an employee is moving — by car, on foot or not at all — and which way.
 *
 * Owner, 2026-11-01, of the mockup «MTM: движение на карте» («мне подходит
 * макет, начинай»): an icon that says car / on foot / standing, arrows on the
 * line and beside the live point, and a replay of the day by the clock.
 *
 * Nothing new is asked of the phone. Each fix already carries the speed the
 * phone measured (km/h, src/lib/mtm/gps-speed.ts) and, when it had one, its
 * course; where either is missing — a fix with no speed, the demo pulse,
 * a phone that sends no course — the same is read off the neighbouring fixes.
 *
 * The decision is per trip between two stops, never per fix: a car at a red
 * light or in a jam is a car that stands for a minute, not somebody who got
 * out and walked. A trip is a car when it reached car speed (at least twice,
 * so one wild GPS fix does not make a walk a drive), or when it covered its
 * distance faster than anybody walks. Everything else that moves is on foot.
 *
 * A trip must also get somewhere. A phone lying on a desk reports 3–5 km/h
 * and wanders 5–20 m: on the first live day (2026-11-01, one employee over
 * three days) that made 94 «walks», none of which got 100 m from where it
 * began, most not 10 m — while the two real drives went 10 km and 1.2 km.
 *
 * Pure data and pure functions — no Leaflet, no React.
 */
import { calculateDistance } from "@/lib/geo-utils"
import { MTM_MOVING_FROM_KMH, mtmSpeedKmh } from "@/lib/mtm/gps-speed"

export type MtmMovementMode = "DRIVE" | "WALK" | "STAY"

/** From this speed a fix can only be a vehicle: a brisk walk is 6–7 km/h, a jog under 12. */
export const MTM_DRIVE_FROM_KMH = 12
/** A whole trip covered faster than this on average was not walked. */
export const MTM_DRIVE_AVERAGE_FROM_KMH = 9
/** A pause in motion shorter than this is part of the trip: a red light, a jam, a door. */
export const MTM_TRIP_PAUSE_MAX_MS = 3 * 60_000
/**
 * Two fixes further apart in time than this are not one trip: the phone was
 * silent, or a break lay between them. Same line as the live tail
 * (TRAIL_MAX_GAP_MS in live-map-trails.ts).
 */
export const MTM_TRIP_GAP_MAX_MS = 5 * 60_000
/** A step shorter than this says nothing about a direction: GPS wanders a few metres. */
export const MTM_HEADING_MIN_STEP_METERS = 15
/**
 * A trip that never got this far from where it began was GPS wander, not a
 * trip: about a minute's walk, and well outside the 20–50 m a still phone's
 * fixes scatter over (accuracy 15–70 m on the first live day).
 */
export const MTM_TRIP_MIN_REACH_METERS = 60

export interface MtmMovementFix {
  latitude: number
  longitude: number
  recordedAt: string
  /** km/h as stored; null when the phone gave none. */
  speed?: number | null
  /** Degrees clockwise from north as the phone measured it; null when it had none. */
  heading?: number | null
}

/** Degrees clockwise from north, 0–359, from one place to another. */
export function bearingDegrees(
  from: { latitude: number; longitude: number },
  to: { latitude: number; longitude: number },
): number {
  const radians = (degrees: number) => (degrees * Math.PI) / 180
  const φ1 = radians(from.latitude)
  const φ2 = radians(to.latitude)
  const Δλ = radians(to.longitude - from.longitude)
  const y = Math.sin(Δλ) * Math.cos(φ2)
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ)
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360
}

export type MtmCompassPoint = "N" | "NE" | "E" | "SE" | "S" | "SW" | "W" | "NW"
const COMPASS: readonly MtmCompassPoint[] = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"]

/** The nearest of the eight points of the compass — «на север», «на юго-восток». */
export function compassPoint(degrees: number): MtmCompassPoint {
  return COMPASS[Math.round((((degrees % 360) + 360) % 360) / 45) % 8]
}

/** The phone's own course, when it is a course: 0° is north, not «none». */
function phoneHeading(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 360 ? value % 360 : null
}

const at = (fix: MtmMovementFix) => Date.parse(fix.recordedAt)
const metres = (a: MtmMovementFix, b: MtmMovementFix) => calculateDistance(a.latitude, a.longitude, b.latitude, b.longitude)

/**
 * The speed of each fix in km/h: the phone's, or, where it gave none, the
 * distance to its neighbours over the time between them. Never across a gap.
 */
export function mtmFixSpeeds(fixes: readonly MtmMovementFix[]): Array<number | null> {
  return fixes.map((fix, index) => {
    const own = mtmSpeedKmh(fix.speed)
    if (own != null) return own
    const before = index > 0 && at(fix) - at(fixes[index - 1]) <= MTM_TRIP_GAP_MAX_MS ? fixes[index - 1] : null
    const after = index < fixes.length - 1 && at(fixes[index + 1]) - at(fix) <= MTM_TRIP_GAP_MAX_MS ? fixes[index + 1] : null
    const from = before ?? fix
    const to = after ?? fix
    const seconds = (at(to) - at(from)) / 1000
    if (seconds <= 0) return null
    return Math.round((metres(from, to) / seconds) * 3.6)
  })
}

export interface MtmMovementTrip {
  mode: "DRIVE" | "WALK"
  /** Index of the trip's first and last moving fix. */
  fromIndex: number
  toIndex: number
}

export interface MtmMovementReading {
  /** One per fix: how he was moving at it. */
  modes: MtmMovementMode[]
  /** One per fix: which way he was heading, null where that cannot be told. */
  headings: Array<number | null>
  trips: MtmMovementTrip[]
}

/** Is this trip a drive? See the top of this file. */
function tripMode(fixes: readonly MtmMovementFix[], speeds: ReadonlyArray<number | null>, fromIndex: number, toIndex: number): "DRIVE" | "WALK" {
  let fast = 0
  for (let index = fromIndex; index <= toIndex; index += 1) {
    if ((speeds[index] ?? 0) >= MTM_DRIVE_FROM_KMH) fast += 1
  }
  if (fast >= 2) return "DRIVE"
  let distance = 0
  for (let index = fromIndex + 1; index <= toIndex; index += 1) distance += metres(fixes[index - 1], fixes[index])
  const seconds = (at(fixes[toIndex]) - at(fixes[fromIndex])) / 1000
  return seconds >= 60 && (distance / seconds) * 3.6 >= MTM_DRIVE_AVERAGE_FROM_KMH ? "DRIVE" : "WALK"
}

/**
 * The day read as trips: each fix gets a mode and, where it can be told, a
 * heading. The fixes must be in time order, and a break must already lie as
 * a gap between them — nothing here joins two fixes further apart than
 * {@link MTM_TRIP_GAP_MAX_MS}.
 */
export function readMtmMovement(fixes: readonly MtmMovementFix[]): MtmMovementReading {
  const speeds = mtmFixSpeeds(fixes)
  const moving = speeds.map((speed) => speed != null && speed >= MTM_MOVING_FROM_KMH)
  const modes: MtmMovementMode[] = fixes.map(() => "STAY")
  const trips: MtmMovementTrip[] = []

  let index = 0
  while (index < fixes.length) {
    if (!moving[index]) {
      index += 1
      continue
    }
    const fromIndex = index
    let toIndex = index
    let cursor = index + 1
    while (cursor < fixes.length) {
      if (at(fixes[cursor]) - at(fixes[cursor - 1]) > MTM_TRIP_GAP_MAX_MS) break
      if (moving[cursor]) {
        toIndex = cursor
        cursor += 1
        continue
      }
      // Standing: still the same trip if he moves on again soon enough.
      let resume = cursor
      while (resume < fixes.length && !moving[resume] && at(fixes[resume]) - at(fixes[resume - 1]) <= MTM_TRIP_GAP_MAX_MS) resume += 1
      if (resume < fixes.length && moving[resume] &&
          at(fixes[resume]) - at(fixes[resume - 1]) <= MTM_TRIP_GAP_MAX_MS &&
          at(fixes[resume]) - at(fixes[toIndex]) <= MTM_TRIP_PAUSE_MAX_MS) {
        toIndex = resume
        cursor = resume + 1
        continue
      }
      break
    }
    index = toIndex + 1
    // Where he stood before it, when that is still part of the same stretch.
    const origin = fromIndex > 0 && at(fixes[fromIndex]) - at(fixes[fromIndex - 1]) <= MTM_TRIP_GAP_MAX_MS ? fixes[fromIndex - 1] : fixes[fromIndex]
    const last = toIndex + 1 < fixes.length && at(fixes[toIndex + 1]) - at(fixes[toIndex]) <= MTM_TRIP_GAP_MAX_MS ? toIndex + 1 : toIndex
    let reach = 0
    for (let inside = fromIndex; inside <= last; inside += 1) reach = Math.max(reach, metres(origin, fixes[inside]))
    if (reach < MTM_TRIP_MIN_REACH_METERS) continue
    const mode = tripMode(fixes, speeds, fromIndex, toIndex)
    for (let inside = fromIndex; inside <= toIndex; inside += 1) modes[inside] = mode
    trips.push({ mode, fromIndex, toIndex })
  }

  const headings = fixes.map((fix, position) => {
    if (modes[position] === "STAY") return null
    const own = phoneHeading(fix.heading)
    if (own != null && (speeds[position] ?? 0) >= MTM_MOVING_FROM_KMH) return own
    // The way to the next fix far enough away, else the way from the last one.
    for (let next = position + 1; next < fixes.length && at(fixes[next]) - at(fix) <= MTM_TRIP_GAP_MAX_MS; next += 1) {
      if (metres(fix, fixes[next]) >= MTM_HEADING_MIN_STEP_METERS) return bearingDegrees(fix, fixes[next])
    }
    for (let previous = position - 1; previous >= 0 && at(fix) - at(fixes[previous]) <= MTM_TRIP_GAP_MAX_MS; previous -= 1) {
      if (metres(fixes[previous], fix) >= MTM_HEADING_MIN_STEP_METERS) return bearingDegrees(fixes[previous], fix)
    }
    return null
  })

  return { modes, headings, trips }
}

/**
 * The live point: how the employee is moving now and which way.
 *
 * `trail` is what the live page itself saw of him in the last half hour
 * (live-map-trails.ts) — positions without a speed. The roster's status
 * already says whether he is moving: it counts any 50 m in five minutes, so
 * a car crawling in a jam is «в пути» with a speed of 4. Then the trail says
 * which: a drive is a drive until he stops. Any other status is standing.
 * Without a status (the manager's phone asks the server, which has none) he
 * is moving only when the trail shows a trip that got somewhere and ended at
 * most a red light ago — the phone's own speed alone is 3–5 km/h on a desk.
 */
export function liveMtmMovement(input: {
  fieldStatus?: string | null
  freshness: "ONLINE" | "DELAYED" | "STALE"
  latitude: number
  longitude: number
  recordedAt: string
  speed?: number | null
  heading?: number | null
  trail?: ReadonlyArray<{ latitude: number; longitude: number; recordedAt: string; breakCut?: true }>
}): { mode: MtmMovementMode; heading: number | null } | null {
  // A grey last known point says nothing about now: no icon, no arrow.
  if (input.freshness === "STALE") return null
  const kmh = mtmSpeedKmh(input.speed)
  const status = input.fieldStatus ?? null
  // The roster has already decided whether he moves; only «в пути» moves.
  if (status != null && status !== "ON_ROAD") return { mode: "STAY", heading: null }

  const nowMs = Date.parse(input.recordedAt)
  const current: MtmMovementFix = { latitude: input.latitude, longitude: input.longitude, recordedAt: input.recordedAt, speed: input.speed, heading: input.heading }
  const tail: MtmMovementFix[] = []
  for (const point of input.trail ?? []) {
    if (point.breakCut) {
      tail.length = 0
      continue
    }
    if (Date.parse(point.recordedAt) < nowMs) tail.push({ latitude: point.latitude, longitude: point.longitude, recordedAt: point.recordedAt })
  }
  const fixes = [...tail, current]
  const reading = readMtmMovement(fixes)
  const last = fixes.length - 1
  // A red light keeps a trip going: it ended at most a pause ago.
  const recentTrips = reading.trips.filter((trip) => nowMs - Date.parse(fixes[trip.toIndex].recordedAt) <= MTM_TRIP_PAUSE_MAX_MS)
  if (status == null && !recentTrips.length) return { mode: "STAY", heading: null }
  const drive = (kmh != null && kmh >= MTM_DRIVE_FROM_KMH) || recentTrips.some((trip) => trip.mode === "DRIVE")

  let heading = kmh != null && kmh >= MTM_MOVING_FROM_KMH ? phoneHeading(input.heading) : null
  if (heading == null) {
    for (let previous = last - 1; previous >= 0; previous -= 1) {
      if (nowMs - Date.parse(fixes[previous].recordedAt) > MTM_TRIP_GAP_MAX_MS) break
      if (metres(fixes[previous], current) >= MTM_HEADING_MIN_STEP_METERS) {
        heading = bearingDegrees(fixes[previous], current)
        break
      }
    }
  }
  return { mode: drive ? "DRIVE" : "WALK", heading }
}

/**
 * Where the arrows go along a line: one every `everyMeters`, starting half a
 * step in, each turned the way the line runs there. The line is drawn in the
 * order he went, so an arrow always points the way he was going.
 */
export function arrowsAlong(
  path: ReadonlyArray<readonly [number, number]>,
  everyMeters: number,
): Array<{ latitude: number; longitude: number; bearing: number }> {
  if (path.length < 2 || !(everyMeters > 0)) return []
  const arrows: Array<{ latitude: number; longitude: number; bearing: number }> = []
  let next = everyMeters / 2
  let walked = 0
  for (let index = 1; index < path.length; index += 1) {
    const [lat1, lon1] = path[index - 1]
    const [lat2, lon2] = path[index]
    const length = calculateDistance(lat1, lon1, lat2, lon2)
    if (length <= 0) continue
    const bearing = bearingDegrees({ latitude: lat1, longitude: lon1 }, { latitude: lat2, longitude: lon2 })
    while (next <= walked + length) {
      const share = (next - walked) / length
      arrows.push({ latitude: lat1 + (lat2 - lat1) * share, longitude: lon1 + (lon2 - lon1) * share, bearing })
      next += everyMeters
    }
    walked += length
  }
  return arrows
}

/** Metres one screen pixel covers at this zoom and latitude, on the web map's projection. */
export function metresPerPixel(zoom: number, latitude: number): number {
  return (156_543.03392 * Math.cos((latitude * Math.PI) / 180)) / 2 ** zoom
}
