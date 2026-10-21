import { calculateDistance } from "@/lib/geo-utils"
import type { HistoryGap, HistoryLocationPoint, HistoryStop, HistoryVisit } from "@/lib/mtm/location-history"
import { drivingStepMeters } from "@/lib/mtm/road-distance"

/**
 * Owner 2026-09-22: «if I sell this as a TMS, how will managers see which way
 * the agent drove to the customers». The history showed dots, a line and
 * three separate lists (stops, visits, events); nobody could read the day off
 * it. The trip is the day as a manager tells it — left at 09:12, drove 18 min
 * and 6 km, 25 min at customer A, drove on, no signal for 40 min, … — built
 * from the same stops, visits and gaps the map draws, so the two cannot
 * disagree. Every leg carries its own time window, and the map highlights the
 * track inside it.
 *
 * Distances follow road-distance.ts: along the roads where the self-hosted
 * OSRM answered (2026-09-28), straight between fixes where it did not.
 */

/** A silence shorter than this that is left over after a stop is not worth a line. */
const MIN_GAP_REMAINDER_SECONDS = 60
/** Movement shorter than this between two anchors is noise, not a drive. */
const MIN_MOVE_SECONDS = 60
/**
 * Closer than this is the same place. Prod 2026-09-23, the owner's phone on
 * one spot: GPS drift cut the day into 60 rows of «stood 7 min — drove 2 min,
 * 50 m — stood 12 min». A "drive" that ends where it started is standing.
 */
const SAME_PLACE_METERS = 150
/** A silence this short that starts and ends on one spot is part of standing there. */
const SAME_PLACE_SILENCE_SECONDS = 30 * 60
/**
 * Fixes farther than SAME_PLACE_METERS from a visit's place for this long:
 * he had left it, whatever the check-out says. A shorter run is a fix thrown
 * off indoors or a step out to the car.
 */
const LEFT_PLACE_SECONDS = 5 * 60
/** Standing this long between two visits at one place is a row of its own, not the first visit's. */
const STAND_BETWEEN_VISITS_SECONDS = 5 * 60

export type DayTripStay = {
  kind: "STAY"
  id: string
  startedAt: Date
  endedAt: Date
  durationSeconds: number
  latitude: number | null
  longitude: number | null
  /** A visit recorded without a check-out; its end is not known. */
  open: boolean
  visit: { id: string; customerId: string; customerName: string } | null
  /**
   * The same visit again, after a break that fell inside it: the visit is
   * named on its first row only, and this row is its time on site after the
   * break.
   */
  afterBreak?: true
}

export type DayTripMove = {
  kind: "MOVE"
  id: string
  startedAt: Date
  endedAt: Date
  durationSeconds: number
  distanceMeters: number
  pointCount: number
}

export type DayTripGap = {
  kind: "GAP"
  id: string
  startedAt: Date
  endedAt: Date
  durationSeconds: number
  reason: HistoryGap["reason"]
  /** Straight line between the last fix before and the first fix after. */
  displacementMeters: number
  /**
   * The shortest road between those two fixes, when OSRM answered: at least
   * this much was driven while the phone was silent. Null without an answer.
   */
  roadMeters: number | null
  fromLatitude: number
  fromLongitude: number
  toLatitude: number
  toLongitude: number
}

export type DayTripEdge = {
  kind: "START" | "END"
  id: string
  at: Date
  /** WORKDAY: the agent pressed the button. GPS: first / last signal only. */
  source: "WORKDAY" | "GPS"
}

export type DayTripEntry = DayTripEdge | DayTripStay | DayTripMove | DayTripGap

export type DayTrip = {
  entries: DayTripEntry[]
  summary: {
    movingSeconds: number
    movingMeters: number
    staySeconds: number
    visitCount: number
    unknownSeconds: number
    pausedSeconds: number
  }
}

type Interval = { from: number; to: number }

function seconds(from: number, to: number): number {
  return Math.max(0, Math.round((to - from) / 1_000))
}

/** `interval` minus every one of `holes`, as the pieces that remain. */
function subtract(interval: Interval, holes: readonly Interval[]): Interval[] {
  let pieces: Interval[] = [interval]
  for (const hole of holes) {
    pieces = pieces.flatMap((piece) => {
      if (hole.to <= piece.from || hole.from >= piece.to) return [piece]
      const left = hole.from > piece.from ? [{ from: piece.from, to: hole.from }] : []
      const right = hole.to < piece.to ? [{ from: hole.to, to: piece.to }] : []
      return [...left, ...right]
    })
  }
  return pieces
}

function overlapMs(a: Interval, b: Interval): number {
  return Math.max(0, Math.min(a.to, b.to) - Math.max(a.from, b.from))
}

const spanOf = (stop: HistoryStop): Interval => ({ from: stop.startedAt.getTime(), to: stop.endedAt.getTime() })

/** The stop that shares most of `interval` with it, if any does. */
function stopSharing(stops: readonly HistoryStop[], interval: Interval): HistoryStop | null {
  let best: HistoryStop | null = null
  let bestMs = 0
  for (const stop of stops) {
    const shared = overlapMs(interval, spanOf(stop))
    if (shared > bestMs) {
      best = stop
      bestMs = shared
    }
  }
  return best
}

type Place = { latitude: number; longitude: number }

/**
 * When the fixes show he was away from `place`. An absence is a stretch of
 * fixes all farther than SAME_PLACE_METERS from it (and outside every stop
 * at it) — silences inside it included — whose fixes span at least
 * LEFT_PLACE_SECONDS of tracked time; a fix or two thrown off indoors are not
 * one. It runs from the fix before it, if he was seen going, to the fix after
 * it, if he was seen coming back. A silence is evidence only by the visit's
 * own record: a check-out inside the silence after the place's last fix was
 * made on site, a check-in inside the silence before he is seen back was
 * too, and a visit checked in and out inside a silence among fixes elsewhere
 * happened with the phone silent.
 */
function timeAway(input: {
  place: Place
  points: readonly HistoryLocationPoint[]
  stopsAtPlace: readonly HistoryStop[]
  /** Fixes the next fix follows only after a silence (a gap of the day). */
  silenceAfter: ReadonlySet<number>
  /** Only absences that reach into this matter: a fortnight's track is not walked once per visit. */
  within: Interval
  checkInAt: number
  checkOutAt: number | null
}): Interval[] {
  const { place, points, silenceAfter, checkInAt, checkOutAt } = input
  if (!points.length) return []
  const time = (index: number) => points[index].recordedAt.getTime()
  const farMemo = new Map<number, boolean>()
  const far = (index: number): boolean => {
    let value = farMemo.get(index)
    if (value === undefined) {
      const point = points[index]
      const at = time(index)
      value = calculateDistance(place.latitude, place.longitude, point.latitude, point.longitude) > SAME_PLACE_METERS
        && !input.stopsAtPlace.some((stop) => stop.startedAt.getTime() <= at && at <= stop.endedAt.getTime())
      farMemo.set(index, value)
    }
    return value
  }
  const inside = (at: number | null, from: number, to: number): at is number => at != null && at > from && at < to
  // From the fix before `within` to the first at or after its end, widened
  // to the whole of an absence that crosses either edge.
  let low = 0
  let high = points.length
  while (low < high) {
    const middle = (low + high) >> 1
    if (time(middle) < input.within.from) low = middle + 1
    else high = middle
  }
  let start = Math.max(0, low - 1)
  let end = Math.min(low, points.length - 1)
  while (end < points.length - 1 && time(end) < input.within.to) end += 1
  while (start > 0 && far(start) && far(start - 1)) start -= 1
  while (end < points.length - 1 && far(end) && far(end + 1)) end += 1

  const away: Interval[] = []
  for (let first = start; first <= end; first += 1) {
    if (!far(first)) continue
    let last = first
    let trackedMs = 0
    // Silences inside the absence that the visit's own record vouches for.
    const vouched: Interval[] = []
    while (last + 1 < points.length && far(last + 1)) {
      if (silenceAfter.has(time(last))) {
        if (inside(checkInAt, time(last), time(last + 1)) && inside(checkOutAt, time(last), time(last + 1))) {
          vouched.push({ from: checkInAt, to: checkOutAt })
        }
      } else {
        trackedMs += time(last + 1) - time(last)
      }
      last += 1
    }
    if (trackedMs >= LEFT_PLACE_SECONDS * 1_000) {
      let from = time(first)
      if (first > 0) {
        const before = time(first - 1)
        from = silenceAfter.has(before) && inside(checkOutAt, before, from) ? checkOutAt : before
      }
      let to = time(last)
      if (last + 1 < points.length) {
        const after = time(last + 1)
        to = silenceAfter.has(to) && inside(checkInAt, to, after) ? checkInAt : after
      }
      away.push(...subtract({ from, to }, vouched))
    }
    first = last
  }
  return away
}

/**
 * In time order; of two that start together the shorter first — a visit of
 * no length (opened where no stop tells its end) before the stand it opens,
 * so that the stand joins the visit and not the row before.
 */
function byTime(a: { id: string; startedAt: Date; endedAt: Date }, b: { id: string; startedAt: Date; endedAt: Date }): number {
  return a.startedAt.getTime() - b.startedAt.getTime()
    || a.endedAt.getTime() - b.endedAt.getTime()
    || a.id.localeCompare(b.id)
}

/** Metres of a contiguous run of the day's fixes: the counted steps inside it. */
function pathMeters(points: readonly HistoryLocationPoint[], counted: ReadonlyMap<HistoryLocationPoint, number>): number {
  let meters = 0
  for (let index = 1; index < points.length; index += 1) meters += counted.get(points[index]) ?? 0
  return Math.round(meters)
}

/**
 * One place, one row; one silence, one row. Two stays on the same spot merge
 * unless each is a different visit, or one is a stand between two visits
 * (`apart`). Back-to-back silences (a phone sending a fix every ten minutes)
 * merge into one, measured from its first edge to its last.
 */
function mergeNeighbours(entries: readonly DayTripEntry[], apart: ReadonlySet<string>): DayTripEntry[] {
  const merged: DayTripEntry[] = []
  for (const entry of entries) {
    const previous = merged[merged.length - 1]
    if (previous?.kind === "STAY" && entry.kind === "STAY"
      && !(previous.visit && entry.visit && previous.visit.id !== entry.visit.id)
      && !apart.has(previous.id) && !apart.has(entry.id)
      && previous.latitude != null && previous.longitude != null
      && entry.latitude != null && entry.longitude != null
      && calculateDistance(previous.latitude, previous.longitude, entry.latitude, entry.longitude) < SAME_PLACE_METERS) {
      const withVisit = previous.visit ? previous : entry.visit ? entry : previous
      const startedAt = previous.startedAt
      const endedAt = entry.endedAt > previous.endedAt ? entry.endedAt : previous.endedAt
      merged[merged.length - 1] = {
        ...withVisit,
        id: previous.id,
        startedAt,
        endedAt,
        durationSeconds: seconds(startedAt.getTime(), endedAt.getTime()),
      }
      continue
    }
    if (previous?.kind === "GAP" && entry.kind === "GAP" && previous.reason === entry.reason) {
      merged[merged.length - 1] = {
        ...previous,
        endedAt: entry.endedAt,
        durationSeconds: seconds(previous.startedAt.getTime(), entry.endedAt.getTime()),
        toLatitude: entry.toLatitude,
        toLongitude: entry.toLongitude,
        displacementMeters: Math.round(calculateDistance(
          previous.fromLatitude, previous.fromLongitude, entry.toLatitude, entry.toLongitude,
        )),
        roadMeters: previous.roadMeters != null && entry.roadMeters != null ? previous.roadMeters + entry.roadMeters : null,
      }
      continue
    }
    merged.push(entry)
  }
  return merged
}

export function buildDayTrip(input: {
  /** Accepted points in time order — the same set the distance is counted on. */
  points: readonly HistoryLocationPoint[]
  stops: readonly HistoryStop[]
  visits: readonly HistoryVisit[]
  gaps: readonly HistoryGap[]
  workday: { startedAt: Date; completedAt: Date | null } | null
  /** Road metres per step of `points` (map-matching.ts), where OSRM answered. */
  roadSteps?: ReadonlyArray<number | null> | null
}): DayTrip {
  const { points } = input
  const steps = drivingStepMeters(points, input.roadSteps)
  const counted = new Map(points.map((point, index) => [point, steps[index]] as const))
  // A silence ends on a fix; the road step arriving at it spans the silence.
  const roadAcross = new Map<number, number>()
  points.forEach((point, index) => {
    if (input.roadSteps?.[index] != null) roadAcross.set(point.recordedAt.getTime(), Math.round(steps[index]))
  })

  // 1. Where the agent stood, told by the visits first. Until 2026-10-20 a
  //    GPS stop was named by the first visit that touched it and any other
  //    visit touching it was dropped: two doctors seen one after the other in
  //    one clinic read as one visit, and the second was in no row at all. Now
  //    each visit is its own row, from check-in to check-out (a visit still
  //    open: to the end of the stop it was opened in), and a GPS stop keeps
  //    only the time no visit tells. Of a visit's time, the trip leaves out
  //    only what the fixes show was elsewhere — he had left (timeAway), so a
  //    check-out forgotten until the evening does not swallow the day's
  //    drives — and the breaks, the employee's own time. A visit's time on
  //    site is therefore never a drive.
  const breaks = input.gaps
    .filter((gap) => gap.reason === "WORKDAY_PAUSED")
    .map((gap) => ({ from: gap.startedAt.getTime(), to: gap.endedAt.getTime() }))
  const silenceAfter = new Set(input.gaps.map((gap) => gap.startedAt.getTime()))
  const visits = input.visits
    .filter((visit) => visit.status !== "CANCELLED")
    .sort((a, b) => a.checkInAt.getTime() - b.checkInAt.getTime() || a.id.localeCompare(b.id))
  const visitStays: DayTripStay[] = visits.flatMap((visit, index) => {
    const from = visit.checkInAt.getTime()
    const openedIn = input.stops.find((stop) => stop.startedAt.getTime() <= from && from <= stop.endedAt.getTime()) ?? null
    const recordedEnd = visit.checkOutAt?.getTime() ?? openedIn?.endedAt.getTime() ?? from
    // The next visit begins where this one ends at the latest, and none
    // runs past a closed day: a check-out made at home in the evening, after
    // the last fix, is not time at the customer's.
    const nextAt = visits[index + 1]?.checkInAt.getTime() ?? Number.POSITIVE_INFINITY
    const dayClosedAt = input.workday?.completedAt?.getTime() ?? Number.POSITIVE_INFINITY
    const span = { from, to: Math.max(from, Math.min(recordedEnd, nextAt, dayClosedAt)) }
    const own = openedIn ?? stopSharing(input.stops, span)
    const place: Place | null = own
      ? { latitude: own.latitude, longitude: own.longitude }
      : visit.checkInLat != null && visit.checkInLng != null
        ? { latitude: visit.checkInLat, longitude: visit.checkInLng }
        : visit.customer.latitude != null && visit.customer.longitude != null
          ? { latitude: visit.customer.latitude, longitude: visit.customer.longitude }
          : null
    // On site until he is first seen gone; what follows, if he came back, is
    // not this visit's.
    const away = place
      ? timeAway({
        place,
        points,
        stopsAtPlace: input.stops.filter((stop) =>
          calculateDistance(place.latitude, place.longitude, stop.latitude, stop.longitude) < SAME_PLACE_METERS),
        silenceAfter,
        within: span,
        checkInAt: from,
        checkOutAt: visit.checkOutAt?.getTime() ?? null,
      })
      : []
    const onSite = subtract(span, away)[0] ?? null
    const pieces = onSite ? subtract(onSite, breaks) : []
    if (!pieces.length) pieces.push({ from, to: from })
    return pieces.map((piece, pieceIndex): DayTripStay => {
      const stop = stopSharing(input.stops, piece) ?? own
      return {
        kind: "STAY",
        id: pieceIndex === 0 ? `visit-${visit.id}` : `visit-${visit.id}-${pieceIndex}`,
        startedAt: new Date(piece.from),
        endedAt: new Date(piece.to),
        durationSeconds: seconds(piece.from, piece.to),
        latitude: stop?.latitude ?? place?.latitude ?? null,
        longitude: stop?.longitude ?? place?.longitude ?? null,
        // A stop it was opened in tells how long he stayed.
        open: visit.checkOutAt == null && !openedIn,
        visit: { id: visit.id, customerId: visit.customerId, customerName: visit.customer.name },
      }
    })
  })
  const visitIntervals = visitStays.map((stay) => ({ from: stay.startedAt.getTime(), to: stay.endedAt.getTime() }))
  // What is left of each GPS stop: arriving before a check-in and leaving
  // after a check-out join the visit's row (mergeNeighbours), and so does a
  // moment between two visits. A longer stand between two different visits
  // is a row of its own; a break inside it is still part of the stop.
  const apart = new Set<string>()
  const visitEndingAt = (at: number) => visitStays.find((stay) => stay.endedAt.getTime() === at)?.visit?.id
  const visitStartingAt = (at: number) => visitStays.find((stay) => stay.startedAt.getTime() === at)?.visit?.id
  const stopStays: DayTripStay[] = input.stops.flatMap((stop) =>
    subtract(spanOf(stop), visitIntervals).map((piece, index): DayTripStay => {
      const id = index === 0 ? `stay-${stop.id}` : `stay-${stop.id}-${index}`
      const before = visitEndingAt(piece.from)
      const after = visitStartingAt(piece.to)
      if (before && after && before !== after
        && seconds(piece.from, piece.to) >= STAND_BETWEEN_VISITS_SECONDS
        && !breaks.some((span) => overlapMs(span, piece) > 0)) apart.add(id)
      return {
        kind: "STAY",
        id,
        startedAt: new Date(piece.from),
        endedAt: new Date(piece.to),
        durationSeconds: seconds(piece.from, piece.to),
        latitude: stop.latitude,
        longitude: stop.longitude,
        open: false,
        visit: null,
      }
    }))
  const stays = [...visitStays, ...stopStays].sort(byTime)
  const stayIntervals = stays.map((stay) => ({ from: stay.startedAt.getTime(), to: stay.endedAt.getTime() }))

  // 2. Silence, minus the part of it spent standing at a stop: a phone quiet
  //    in a customer's back room is a visit, not a hole in the day.
  const silences: DayTripGap[] = input.gaps.flatMap((gap) =>
    subtract({ from: gap.startedAt.getTime(), to: gap.endedAt.getTime() }, stayIntervals)
      .filter((piece) => seconds(piece.from, piece.to) >= MIN_GAP_REMAINDER_SECONDS)
      .map((piece, index) => ({
        kind: "GAP" as const,
        id: `${gap.id}-${index}`,
        startedAt: new Date(piece.from),
        endedAt: new Date(piece.to),
        durationSeconds: seconds(piece.from, piece.to),
        reason: gap.reason,
        displacementMeters: Math.round(calculateDistance(
          gap.startLatitude, gap.startLongitude, gap.endLatitude, gap.endLongitude,
        )),
        // The road of the whole silence belongs to one piece of it, not to each.
        roadMeters: index === 0 ? roadAcross.get(gap.endedAt.getTime()) ?? null : null,
        fromLatitude: gap.startLatitude,
        fromLongitude: gap.startLongitude,
        toLatitude: gap.endLatitude,
        toLongitude: gap.endLongitude,
      })))

  // 3. Everything between those anchors is movement, measured on the track.
  const anchors: Array<DayTripStay | DayTripGap> = [...stays, ...silences].sort(byTime)
  const firstPointAt = points[0]?.recordedAt.getTime()
  const lastPointAt = points.at(-1)?.recordedAt.getTime()
  const candidatesFrom = [input.workday?.startedAt.getTime(), firstPointAt, anchors[0]?.startedAt.getTime()]
    .filter((value): value is number => value != null)
  const candidatesTo = [input.workday?.completedAt?.getTime(), lastPointAt, ...anchors.map((a) => a.endedAt.getTime())]
    .filter((value): value is number => value != null)
  if (!candidatesFrom.length) {
    return { entries: [], summary: { movingSeconds: 0, movingMeters: 0, staySeconds: 0, visitCount: 0, unknownSeconds: 0, pausedSeconds: 0 } }
  }
  const dayFrom = Math.min(...candidatesFrom)
  const dayTo = Math.max(...candidatesTo)

  const stayStill = (id: string, from: number, to: number, latitude: number, longitude: number): DayTripStay => ({
    kind: "STAY",
    id,
    startedAt: new Date(from),
    endedAt: new Date(to),
    durationSeconds: seconds(from, to),
    latitude,
    longitude,
    open: false,
    visit: null,
  })

  const entries: DayTripEntry[] = []
  const startAt = input.workday?.startedAt.getTime() ?? firstPointAt ?? dayFrom
  entries.push({ kind: "START", id: "start", at: new Date(startAt), source: input.workday ? "WORKDAY" : "GPS" })

  const moveBetween = (from: number, to: number) => {
    if (seconds(from, to) < MIN_MOVE_SECONDS) return
    const inside = points.filter((point) => {
      const at = point.recordedAt.getTime()
      return at >= from && at <= to
    })
    // Fewer than two fixes in the window: nothing is known about it — the
    // tail after the last fix to the closed workday is not «stood there».
    if (inside.length < 2) return
    const first = inside[0]
    const last = inside[inside.length - 1]
    if (calculateDistance(first.latitude, first.longitude, last.latitude, last.longitude) < SAME_PLACE_METERS) {
      entries.push(stayStill(`still-${from}`, from, to, first.latitude, first.longitude))
      return
    }
    entries.push({
      kind: "MOVE",
      id: `move-${from}`,
      startedAt: new Date(from),
      endedAt: new Date(to),
      durationSeconds: seconds(from, to),
      distanceMeters: pathMeters(inside, counted),
      pointCount: inside.length,
    })
  }

  let cursor = dayFrom
  for (const anchor of anchors) {
    const from = anchor.startedAt.getTime()
    const to = anchor.endedAt.getTime()
    if (to <= cursor && anchor.kind === "GAP") continue
    moveBetween(cursor, from)
    // A short silence that ends where it began: the phone was quiet while
    // the agent stood there.
    if (anchor.kind === "GAP" && anchor.reason === "TELEMETRY_GAP"
      && anchor.displacementMeters < SAME_PLACE_METERS && anchor.durationSeconds <= SAME_PLACE_SILENCE_SECONDS) {
      entries.push(stayStill(`still-${anchor.id}`, from, to, anchor.fromLatitude, anchor.fromLongitude))
    } else {
      entries.push(anchor)
    }
    cursor = Math.max(cursor, to)
  }
  moveBetween(cursor, dayTo)
  // A visit is named once. A break inside it parts its time on site in two
  // rows (unless one GPS stop spans the break, and the rows merge back), and
  // the second is «the same place, after the break», not a second visit.
  const named = new Set<string>()
  const legs = mergeNeighbours(entries.splice(1), apart).map((leg): DayTripEntry => {
    if (leg.kind !== "STAY" || !leg.visit) return leg
    if (!named.has(leg.visit.id)) {
      named.add(leg.visit.id)
      return leg
    }
    return { ...leg, afterBreak: true }
  })
  entries.push(...legs)

  const completedAt = input.workday?.completedAt?.getTime()
  if (completedAt != null) entries.push({ kind: "END", id: "end", at: new Date(completedAt), source: "WORKDAY" })
  else if (lastPointAt != null) entries.push({ kind: "END", id: "end", at: new Date(lastPointAt), source: "GPS" })

  const moves = entries.filter((entry): entry is DayTripMove => entry.kind === "MOVE")
  const gapsKept = entries.filter((entry): entry is DayTripGap => entry.kind === "GAP")
  const staysKept = entries.filter((entry): entry is DayTripStay => entry.kind === "STAY")
  return {
    entries,
    summary: {
      movingSeconds: moves.reduce((sum, move) => sum + move.durationSeconds, 0),
      movingMeters: moves.reduce((sum, move) => sum + move.distanceMeters, 0),
      staySeconds: staysKept.reduce((sum, stay) => sum + stay.durationSeconds, 0),
      visitCount: new Set(staysKept.flatMap((stay) => stay.visit ? [stay.visit.id] : [])).size,
      unknownSeconds: gapsKept.filter((gap) => gap.reason === "TELEMETRY_GAP").reduce((sum, gap) => sum + gap.durationSeconds, 0),
      pausedSeconds: gapsKept.filter((gap) => gap.reason === "WORKDAY_PAUSED").reduce((sum, gap) => sum + gap.durationSeconds, 0),
    },
  }
}
