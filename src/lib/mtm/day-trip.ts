import { calculateDistance } from "@/lib/geo-utils"
import {
  cutHistoryStopsAtBreaks,
  historyBreakSpans,
  historyStayOutsideBreaks,
  type HistoryGap,
  type HistoryLocationPoint,
  type HistoryStop,
  type HistoryVisit,
} from "@/lib/mtm/location-history"
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
/** The organization's minimum stop when the caller does not say (MTM_SETTING_DEFAULTS.historyStopMinimumMinutes). */
const DEFAULT_STOP_MINIMUM_SECONDS = 5 * 60

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
   * A break fell inside this row's visit: the visit as recorded, from
   * check-in to check-out. The row itself is only its time outside the break,
   * so its minutes are not the visit's.
   */
  visitTimes?: { checkInAt: Date; checkOutAt: Date }
  /**
   * The same place after a break, while the visit named on the row before
   * the break went on: its minutes on site, with the visit not named twice.
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
  /**
   * Straight line between the last fix before and the first fix after. Null
   * for a lost signal beside a break: one of its ends is the break's edge,
   * where no fix was taken, so how far he went in it is not known.
   */
  displacementMeters: number | null
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

/** Metres of a contiguous run of the day's fixes: the counted steps inside it. */
function pathMeters(points: readonly HistoryLocationPoint[], counted: ReadonlyMap<HistoryLocationPoint, number>): number {
  let meters = 0
  for (let index = 1; index < points.length; index += 1) meters += counted.get(points[index]) ?? 0
  return Math.round(meters)
}

/**
 * One place, one row; one silence, one row. Two stays on the same spot merge
 * unless each is a different visit. Back-to-back silences (a phone sending a
 * fix every ten minutes) merge into one, measured from its first edge to its
 * last. Two breaks merge only where one ends the second the next begins:
 * between two breaks he worked, and a row from the first to the second would
 * count that time as his own.
 */
function mergeNeighbours(entries: readonly DayTripEntry[]): DayTripEntry[] {
  const merged: DayTripEntry[] = []
  for (const entry of entries) {
    const previous = merged[merged.length - 1]
    if (previous?.kind === "STAY" && entry.kind === "STAY"
      && !(previous.visit && entry.visit && previous.visit.id !== entry.visit.id)
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
    if (previous?.kind === "GAP" && entry.kind === "GAP" && previous.reason === entry.reason
      && (entry.reason !== "WORKDAY_PAUSED" || previous.endedAt.getTime() === entry.startedAt.getTime())) {
      merged[merged.length - 1] = {
        ...previous,
        endedAt: entry.endedAt,
        durationSeconds: seconds(previous.startedAt.getTime(), entry.endedAt.getTime()),
        toLatitude: entry.toLatitude,
        toLongitude: entry.toLongitude,
        // Beside a break one end is unknown, and so is the whole stretch's.
        displacementMeters: previous.displacementMeters != null && entry.displacementMeters != null
          ? Math.round(calculateDistance(previous.fromLatitude, previous.fromLongitude, entry.toLatitude, entry.toLongitude))
          : null,
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
  /** The organization's minimum stop, in seconds (detectHistoryStops' minimumSeconds). */
  stopMinimumSeconds?: number
}): DayTrip {
  const { points } = input
  const steps = drivingStepMeters(points, input.roadSteps)
  const counted = new Map(points.map((point, index) => [point, steps[index]] as const))
  // A silence ends on a fix; the road step arriving at it spans the silence.
  const roadAcross = new Map<number, number>()
  points.forEach((point, index) => {
    if (input.roadSteps?.[index] != null) roadAcross.set(point.recordedAt.getTime(), Math.round(steps[index]))
  })

  // 1. Where the agent stood: every GPS stop, cut at the breaks — the stops
  //    History hands over are cut already (detectHistoryStops), and come
  //    back from cutHistoryStopsAtBreaks as they are — plus every visit no
  //    stop covers (a visit made with the phone silent still happened), cut
  //    by the same rule (historyStayOutsideBreaks). A break is the employee's
  //    own time and its own row, exactly as long as the journal says
  //    (detectHistoryGaps): no stay is told inside it.
  const breaks = historyBreakSpans(input.gaps)
  const minimumSeconds = input.stopMinimumSeconds ?? DEFAULT_STOP_MINIMUM_SECONDS
  const stops = cutHistoryStopsAtBreaks(input.stops, { points, visits: input.visits, gaps: input.gaps, minimumSeconds })
  const placed: DayTripStay[] = stops.map((stop) => ({
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
  const coveredVisitIds = new Set(stops.flatMap((stop) => stop.visit ? [stop.visit.id] : []))
  for (const visit of input.visits) {
    if (coveredVisitIds.has(visit.id) || visit.status === "CANCELLED") continue
    const end = visit.checkOutAt ?? visit.checkInAt
    const overlapsStop = stops.some((stop) =>
      visit.checkInAt <= stop.endedAt && end >= stop.startedAt)
    if (overlapsStop) continue
    const stay = (id: string, from: number, to: number): DayTripStay => ({
      kind: "STAY",
      id,
      startedAt: new Date(from),
      endedAt: new Date(to),
      durationSeconds: seconds(from, to),
      latitude: visit.checkInLat ?? visit.customer.latitude,
      longitude: visit.checkInLng ?? visit.customer.longitude,
      open: visit.checkOutAt == null,
      visit: { id: visit.id, customerId: visit.customerId, customerName: visit.customer.name },
    })
    const pieces = historyStayOutsideBreaks({
      from: visit.checkInAt.getTime(),
      to: end.getTime(),
      breaks,
      minimumSeconds,
      visitOf: () => visit.id,
    })
    if (!pieces) placed.push(stay(`visit-${visit.id}`, visit.checkInAt.getTime(), end.getTime()))
    else for (const piece of pieces) placed.push(stay(piece.index === 0 ? `visit-${visit.id}` : `visit-${visit.id}-${piece.index}`, piece.from, piece.to))
  }
  placed.sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime() || a.id.localeCompare(b.id))
  const stayIntervals = placed.map((stay) => ({ from: stay.startedAt.getTime(), to: stay.endedAt.getTime() }))

  // 2. Silence, minus the part of it spent standing at a stop: a phone quiet
  //    in a customer's back room is a visit, not a hole in the day. A break
  //    is kept whole, however short.
  const silences: DayTripGap[] = input.gaps.flatMap((gap) => {
    const paused = gap.reason === "WORKDAY_PAUSED"
    const pieces = paused
      ? [{ from: gap.startedAt.getTime(), to: gap.endedAt.getTime() }]
      : subtract({ from: gap.startedAt.getTime(), to: gap.endedAt.getTime() }, stayIntervals)
        .filter((piece) => seconds(piece.from, piece.to) >= MIN_GAP_REMAINDER_SECONDS)
    return pieces.map((piece, index) => ({
      kind: "GAP" as const,
      id: `${gap.id}-${index}`,
      startedAt: new Date(piece.from),
      endedAt: new Date(piece.to),
      durationSeconds: seconds(piece.from, piece.to),
      reason: gap.reason,
      displacementMeters: gap.besideBreak ? null : Math.round(calculateDistance(
        gap.startLatitude, gap.startLongitude, gap.endLatitude, gap.endLongitude,
      )),
      // The road of the whole silence belongs to one piece of it, not to
      // each — and beside a break to none: part of it was driven in his own time.
      roadMeters: index === 0 && !gap.besideBreak ? roadAcross.get(gap.endedAt.getTime()) ?? null : null,
      fromLatitude: gap.startLatitude,
      fromLongitude: gap.startLongitude,
      toLatitude: gap.endLatitude,
      toLongitude: gap.endLongitude,
    }))
  })

  // 3. Everything between those anchors is movement, measured on the track.
  const anchors: Array<DayTripStay | DayTripGap> = [...placed, ...silences]
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
    // the agent stood there. Beside a break nobody knows where it ended.
    if (anchor.kind === "GAP" && anchor.reason === "TELEMETRY_GAP" && anchor.displacementMeters != null
      && anchor.displacementMeters < SAME_PLACE_METERS && anchor.durationSeconds <= SAME_PLACE_SILENCE_SECONDS) {
      entries.push(stayStill(`still-${anchor.id}`, from, to, anchor.fromLatitude, anchor.fromLongitude))
    } else {
      entries.push(anchor)
    }
    cursor = Math.max(cursor, to)
  }
  moveBetween(cursor, dayTo)
  const legs = mergeNeighbours(entries.splice(1))

  // A visit is named once. Cut at a break taken during it, its time on site
  // is on both sides of the break: the first row names it — with its own
  // check-in and check-out, not the minutes of the piece («Визит 0 мин» for
  // half an hour at a customer who saw him at once, then made him wait);
  // the row after the break is the same place, the visit not named again.
  // Named on the merged rows: after the break the place can be two GPS
  // stops (drift indoors past the stop radius), and the merge of a «Там же»
  // row with the next one took that stop's visit and named it again.
  const visitsById = new Map(input.visits.map((visit) => [visit.id, visit] as const))
  const breakEnds = new Set(breaks.map((span) => span.to))
  const named = new Map<string, DayTripStay>()
  entries.push(...legs.map((stay) => {
    if (stay.kind !== "STAY" || !stay.visit) return stay
    const first = named.get(stay.visit.id)
    if (!first) {
      named.set(stay.visit.id, stay)
      const own = visitsById.get(stay.visit.id)
      const checkOutAt = own?.checkOutAt
      return own && checkOutAt && breaks.some((span) => span.from < checkOutAt.getTime() && span.to > own.checkInAt.getTime())
        ? { ...stay, visitTimes: { checkInAt: own.checkInAt, checkOutAt } }
        : stay
    }
    const samePlace = first.latitude == null || first.longitude == null || stay.latitude == null || stay.longitude == null
      || calculateDistance(first.latitude, first.longitude, stay.latitude, stay.longitude) < SAME_PLACE_METERS
    return breakEnds.has(stay.startedAt.getTime()) && samePlace
      ? { ...stay, visit: null, afterBreak: true as const }
      : stay
  }))

  const completedAt = input.workday?.completedAt?.getTime()
  if (completedAt != null) entries.push({ kind: "END", id: "end", at: new Date(completedAt), source: "WORKDAY" })
  // An open day: not before the end of its last break. With no fix since
  // «Продолжить» the «Перерыв» row runs past the last fix, and an END at the
  // fix put the day's end above a row that ends half an hour later.
  else if (lastPointAt != null) entries.push({ kind: "END", id: "end", at: new Date(Math.max(lastPointAt, ...breaks.map((span) => span.to))), source: "GPS" })

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
