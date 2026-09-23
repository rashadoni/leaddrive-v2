import { calculateDistance } from "@/lib/geo-utils"
import type { HistoryGap, HistoryLocationPoint, HistoryStop, HistoryVisit } from "@/lib/mtm/location-history"

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
 * What this does NOT claim: the road taken. The line between two fixes is a
 * straight chord; snapping it to streets needs a map-matching service.
 */

/** A silence shorter than this that is left over after a stop is not worth a line. */
const MIN_GAP_REMAINDER_SECONDS = 60
/** Movement shorter than this between two anchors is noise, not a drive. */
const MIN_MOVE_SECONDS = 60

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

function pathMeters(points: readonly HistoryLocationPoint[]): number {
  let meters = 0
  for (let index = 1; index < points.length; index += 1) {
    meters += calculateDistance(
      points[index - 1].latitude,
      points[index - 1].longitude,
      points[index].latitude,
      points[index].longitude,
    )
  }
  return Math.round(meters)
}

export function buildDayTrip(input: {
  /** Accepted points in time order — the same set the distance is counted on. */
  points: readonly HistoryLocationPoint[]
  stops: readonly HistoryStop[]
  visits: readonly HistoryVisit[]
  gaps: readonly HistoryGap[]
  workday: { startedAt: Date; completedAt: Date | null } | null
}): DayTrip {
  const { points } = input

  // 1. Where the agent stood: every GPS stop, plus every visit no stop covers
  //    (a visit made with the phone silent still happened).
  const stays: DayTripStay[] = input.stops.map((stop) => ({
    kind: "STAY",
    id: `stay-${stop.id}`,
    startedAt: stop.startedAt,
    endedAt: stop.endedAt,
    durationSeconds: stop.durationSeconds,
    latitude: stop.latitude,
    longitude: stop.longitude,
    open: false,
    visit: stop.visit
      ? { id: stop.visit.id, customerId: stop.visit.customerId, customerName: stop.visit.customerName }
      : null,
  }))
  const coveredVisitIds = new Set(input.stops.flatMap((stop) => stop.visit ? [stop.visit.id] : []))
  for (const visit of input.visits) {
    if (coveredVisitIds.has(visit.id) || visit.status === "CANCELLED") continue
    const end = visit.checkOutAt ?? visit.checkInAt
    const overlapsStop = input.stops.some((stop) =>
      visit.checkInAt <= stop.endedAt && end >= stop.startedAt)
    if (overlapsStop) continue
    stays.push({
      kind: "STAY",
      id: `visit-${visit.id}`,
      startedAt: visit.checkInAt,
      endedAt: end,
      durationSeconds: seconds(visit.checkInAt.getTime(), end.getTime()),
      latitude: visit.checkInLat ?? visit.customer.latitude,
      longitude: visit.checkInLng ?? visit.customer.longitude,
      open: visit.checkOutAt == null,
      visit: { id: visit.id, customerId: visit.customerId, customerName: visit.customer.name },
    })
  }
  stays.sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime() || a.id.localeCompare(b.id))
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
      })))

  // 3. Everything between those anchors is movement, measured on the track.
  const anchors: Array<DayTripStay | DayTripGap> = [...stays, ...silences]
    .sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime() || a.id.localeCompare(b.id))
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

  const entries: DayTripEntry[] = []
  const startAt = input.workday?.startedAt.getTime() ?? firstPointAt ?? dayFrom
  entries.push({ kind: "START", id: "start", at: new Date(startAt), source: input.workday ? "WORKDAY" : "GPS" })

  const moveBetween = (from: number, to: number) => {
    if (seconds(from, to) < MIN_MOVE_SECONDS) return
    const inside = points.filter((point) => {
      const at = point.recordedAt.getTime()
      return at >= from && at <= to
    })
    // No fix at all in the window: nothing is known about it, and the gap
    // detector only sees silence between two fixes.
    if (!inside.length) return
    entries.push({
      kind: "MOVE",
      id: `move-${from}`,
      startedAt: new Date(from),
      endedAt: new Date(to),
      durationSeconds: seconds(from, to),
      distanceMeters: pathMeters(inside),
      pointCount: inside.length,
    })
  }

  let cursor = dayFrom
  for (const anchor of anchors) {
    const from = anchor.startedAt.getTime()
    const to = anchor.endedAt.getTime()
    if (to <= cursor && anchor.kind === "GAP") continue
    moveBetween(cursor, from)
    entries.push(anchor)
    cursor = Math.max(cursor, to)
  }
  moveBetween(cursor, dayTo)

  const completedAt = input.workday?.completedAt?.getTime()
  if (completedAt != null) entries.push({ kind: "END", id: "end", at: new Date(completedAt), source: "WORKDAY" })
  else if (lastPointAt != null) entries.push({ kind: "END", id: "end", at: new Date(lastPointAt), source: "GPS" })

  const moves = entries.filter((entry): entry is DayTripMove => entry.kind === "MOVE")
  const gapsKept = entries.filter((entry): entry is DayTripGap => entry.kind === "GAP")
  return {
    entries,
    summary: {
      movingSeconds: moves.reduce((sum, move) => sum + move.durationSeconds, 0),
      movingMeters: moves.reduce((sum, move) => sum + move.distanceMeters, 0),
      staySeconds: stays.reduce((sum, stay) => sum + stay.durationSeconds, 0),
      visitCount: stays.filter((stay) => stay.visit).length,
      unknownSeconds: gapsKept.filter((gap) => gap.reason === "TELEMETRY_GAP").reduce((sum, gap) => sum + gap.durationSeconds, 0),
      pausedSeconds: gapsKept.filter((gap) => gap.reason === "WORKDAY_PAUSED").reduce((sum, gap) => sum + gap.durationSeconds, 0),
    },
  }
}
