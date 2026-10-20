import { calculateDistance } from "@/lib/geo-utils"
import {
  cutHistoryStopsAtBreaks,
  historyBreakSpans,
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
  /**
   * A visit recorded without a check-out; its end is not known. Also the
   * row naming such a visit when a break fell inside it: its minutes are
   * not the visit's, and the visit has no check-out to tell instead.
   */
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
  /**
   * END(GPS) only: the last thing known of the day is a «Продолжить» after
   * its last fix. The end is that press, and no signal has come since.
   */
  noFixSinceBreak?: true
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

/** Every one of `intervals` minus every one of `holes`, as the pieces that remain, in time order. */
function without(intervals: readonly Interval[], holes: readonly Interval[]): Interval[] {
  return intervals.flatMap((interval) => subtract(interval, holes))
    .filter((piece) => piece.to > piece.from)
    .sort((a, b) => a.from - b.from)
}

type Place = { latitude: number; longitude: number }

/** Where he checked in, or the customer's own place: a visit's place when no stop of its own tells it. */
function checkInPlace(visit: HistoryVisit): Place | null {
  if (visit.checkInLat != null && visit.checkInLng != null) return { latitude: visit.checkInLat, longitude: visit.checkInLng }
  if (visit.customer.latitude != null && visit.customer.longitude != null) return { latitude: visit.customer.latitude, longitude: visit.customer.longitude }
  return null
}

/**
 * The time on site of every visit a break fell inside: from its check-in to
 * its check-out — for a visit still open, to the day's last fix, since its
 * end is not known — as one interval, the breaks still in it. A visit no
 * break fell inside is told by its stops, as on any day.
 */
function visitsBrokenByBreaks(visits: readonly HistoryVisit[], breaks: readonly Interval[], lastPointAt: number | undefined): Map<string, Interval> {
  const sites = new Map<string, Interval>()
  for (const visit of visits) {
    const from = visit.checkInAt.getTime()
    const to = visit.checkOutAt?.getTime() ?? Math.max(from, lastPointAt ?? from)
    if (breaks.some((span) => span.from < to && span.to > from)) sites.set(visit.id, { from, to })
  }
  return sites
}

/**
 * When the fixes show he had left a place: a run of fixes all farther than
 * SAME_PLACE_METERS from it, lasting at least the minimum stop, from the
 * last fix at the place before it to the first fix back. A shorter run is
 * a fix thrown off indoors or a step to the car, not a departure.
 */
function awayFrom(place: Place, points: readonly HistoryLocationPoint[], minimumSeconds: number): Interval[] {
  const away: Interval[] = []
  const far = points.map((point) => calculateDistance(place.latitude, place.longitude, point.latitude, point.longitude) > SAME_PLACE_METERS)
  for (let first = 0; first < points.length; first += 1) {
    if (!far[first]) continue
    let last = first
    while (last + 1 < points.length && far[last + 1]) last += 1
    if (seconds(points[first].recordedAt.getTime(), points[last].recordedAt.getTime()) >= minimumSeconds) {
      away.push({
        from: first > 0 ? points[first - 1].recordedAt.getTime() : Number.NEGATIVE_INFINITY,
        to: last + 1 < points.length ? points[last + 1].recordedAt.getTime() : Number.POSITIVE_INFINITY,
      })
    }
    first = last
  }
  return away
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
  /**
   * The detector's stops as made (detectHistoryStops without the gaps). The
   * trip cuts them at the breaks itself and keeps a piece in a visit's time
   * on site however short (cutHistoryStopsAtBreaks); the stop list's cut
   * drops it. Stops already cut come back as they are; what that cut dropped
   * of a visit is still the visit's, told from the visit's own times.
   */
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

  // 1. Where the agent stood: every GPS stop, cut at the breaks, and every
  //    visit's time on site that no stop tells. A break is the employee's own
  //    time and its own row, exactly as long as the journal says
  //    (detectHistoryGaps): no stay is told inside it. A piece of a stop in a
  //    visit's time on site stays however short (cutHistoryStopsAtBreaks):
  //    checked in at 10:00, «Перерыв» at 10:03 — those minutes were at the
  //    customer's, and without them the drive before ran on to the break,
  //    across the check-in.
  const breaks = historyBreakSpans(input.gaps)
  const minimumSeconds = input.stopMinimumSeconds ?? DEFAULT_STOP_MINIMUM_SECONDS
  const stops = cutHistoryStopsAtBreaks(input.stops, { points, visits: input.visits, gaps: input.gaps, minimumSeconds, keepVisitPieces: true })
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
  const firstPointAt = points[0]?.recordedAt.getTime()
  const lastPointAt = points.at(-1)?.recordedAt.getTime()
  const sitesOfVisits = visitsBrokenByBreaks(input.visits, breaks, lastPointAt)
  const visitStay = (visit: HistoryVisit, id: string, from: number, to: number, place: { latitude: number | null; longitude: number | null } | null): DayTripStay => ({
    kind: "STAY",
    id,
    startedAt: new Date(from),
    endedAt: new Date(to),
    durationSeconds: seconds(from, to),
    latitude: place?.latitude ?? null,
    longitude: place?.longitude ?? null,
    open: visit.checkOutAt == null,
    visit: { id: visit.id, customerId: visit.customerId, customerName: visit.customer.name },
  })
  // A visit no break fell inside, that no stop covers (made with the phone
  // silent): the visit as recorded, as on any day.
  const coveredVisitIds = new Set(stops.flatMap((stop) => stop.visit ? [stop.visit.id] : []))
  for (const visit of input.visits) {
    if (sitesOfVisits.has(visit.id) || coveredVisitIds.has(visit.id) || visit.status === "CANCELLED") continue
    const end = visit.checkOutAt ?? visit.checkInAt
    const overlapsStop = stops.some((stop) =>
      visit.checkInAt <= stop.endedAt && end >= stop.startedAt)
    if (overlapsStop) continue
    placed.push(visitStay(visit, `visit-${visit.id}`, visit.checkInAt.getTime(), end.getTime(), {
      latitude: visit.checkInLat ?? visit.customer.latitude,
      longitude: visit.checkInLng ?? visit.customer.longitude,
    }))
  }
  // A visit a break fell inside: no second of its time on site is told as a
  // drive, a lost signal or a stay without it, unless the fixes show he left
  // (awayFrom). The stops tell what they cover; every second they leave —
  // before the first fix after «Продолжить», after the last fix before
  // «Перерыв», a lost signal beside the break, minutes under the minimum
  // stop that no stop made — is the visit's, at the place of its own stops.
  // Until 2026-10-20 those seconds went to whatever the fixes made of them:
  // with the first fix after the break 80 m off, the minutes before an early
  // break were «В пути» across the check-in; three minutes after it, «В пути»
  // across the check-out; seven minutes late, «Нет данных», and the visit
  // named a second time after it.
  for (const visit of input.visits) {
    const site = sitesOfVisits.get(visit.id)
    if (!site || visit.status === "CANCELLED") continue
    const ownStops = placed.filter((stay) => stay.visit?.id === visit.id && stay.latitude != null && stay.longitude != null)
    const place = ownStops.length
      ? { latitude: ownStops[0].latitude as number, longitude: ownStops[0].longitude as number }
      : checkInPlace(visit)
    const told = placed.map((stay) => ({ from: stay.startedAt.getTime(), to: stay.endedAt.getTime() }))
    const away = place ? awayFrom(place, points, minimumSeconds) : []
    without([site], [...breaks, ...away, ...told]).forEach((piece, index) => {
      // Its own fixes, if any: a fix at either edge is the neighbouring stop's.
      const fixes = points.filter((point) => point.recordedAt.getTime() > piece.from && point.recordedAt.getTime() < piece.to)
      const own = fixes.length
        ? { latitude: fixes.reduce((sum, point) => sum + point.latitude, 0) / fixes.length, longitude: fixes.reduce((sum, point) => sum + point.longitude, 0) / fixes.length }
        : place
      placed.push(visitStay(visit, index === 0 ? `visit-${visit.id}` : `visit-${visit.id}-${index}`, piece.from, piece.to, own))
    })
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

  // A visit is named once, on the first row of its time on site — when a
  // break fell inside it, by its own check-in and check-out (or «not closed»,
  // a visit still open), not the minutes of the row («Визит 0 мин» for half
  // an hour at a customer who saw him at once, then made him wait). Every
  // later row of its time on site is «Там же, после перерыва», the visit not
  // named again: a row at the same place that is the visit's, or that lies
  // inside its check-in..check-out (an open visit's end is not known, so it
  // is never before the row), with only breaks, lost signals beside them and
  // rows of that same time on site between it and the named row. A drive, a
  // lost signal of its own or another place ends the visit's time on site:
  // he left. Named on the merged rows: a «Там же» row merged with the next
  // GPS stop of the visit (drift indoors) would have taken that stop's visit.
  const visitsById = new Map(input.visits.map((visit) => [visit.id, visit] as const))
  const named = new Set<string>()
  // The visit whose time on site the rows are telling, from the row that names it.
  let site: { visitId: string; first: DayTripStay; checkInAt: number; checkOutAt: number; pastBreak: boolean } | null = null
  const ofSite = (stay: DayTripStay): boolean => {
    if (!site) return false
    // A row of the visit is in its time by its own stop; a row of none, if it lies inside check-in..check-out.
    const inTime = stay.visit
      ? stay.visit.id === site.visitId
      : stay.startedAt.getTime() < site.checkOutAt && stay.endedAt.getTime() > site.checkInAt
    const { first } = site
    return inTime && (first.latitude == null || first.longitude == null || stay.latitude == null || stay.longitude == null
      || calculateDistance(first.latitude, first.longitude, stay.latitude, stay.longitude) < SAME_PLACE_METERS)
  }
  for (const leg of legs) {
    if (leg.kind === "GAP" && leg.reason === "WORKDAY_PAUSED") {
      if (site) site.pastBreak = true
      entries.push(leg)
    } else if (leg.kind === "GAP" && leg.displacementMeters == null) {
      // A lost signal beside a break: where he was in it is not known
      // (displacementMeters), so it is no evidence that he left.
      entries.push(leg)
    } else if (leg.kind === "STAY" && ofSite(leg)) {
      entries.push(site?.pastBreak ? { ...leg, visit: null, open: false, afterBreak: true } : leg)
    } else if (leg.kind !== "STAY" || !leg.visit) {
      site = null
      entries.push(leg)
    } else {
      const own = visitsById.get(leg.visit.id)
      site = {
        visitId: leg.visit.id,
        first: leg,
        checkInAt: own?.checkInAt.getTime() ?? leg.startedAt.getTime(),
        checkOutAt: own ? own.checkOutAt?.getTime() ?? Number.POSITIVE_INFINITY : leg.endedAt.getTime(),
        pastBreak: false,
      }
      // Named again only after a drive, a lost signal or another place.
      const firstTime = !named.has(leg.visit.id)
      named.add(leg.visit.id)
      const broken = firstTime && own && sitesOfVisits.has(own.id)
      entries.push(!broken ? leg
        : own.checkOutAt ? { ...leg, visitTimes: { checkInAt: own.checkInAt, checkOutAt: own.checkOutAt } }
          : { ...leg, open: true })
    }
  }

  const completedAt = input.workday?.completedAt?.getTime()
  const lastBreakEnd = breaks.at(-1)?.to
  if (completedAt != null) entries.push({ kind: "END", id: "end", at: new Date(completedAt), source: "WORKDAY" })
  // An open day: not before the end of its last break. With no fix since
  // «Продолжить» the «Перерыв» row runs past the last fix, and an END at the
  // fix put the day's end above a row that ends half an hour later. Such an
  // end is the press, not a signal, and says so: that half hour without a
  // fix is the stop of tracking a manager wants to see.
  else if (lastPointAt != null && lastBreakEnd != null && lastBreakEnd > lastPointAt) entries.push({ kind: "END", id: "end", at: new Date(lastBreakEnd), source: "GPS", noFixSinceBreak: true })
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
