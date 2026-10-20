import { calculateDistance } from "@/lib/geo-utils"

export const LOCATION_HISTORY_DISTANCE_FORMULA = "haversine-driving-v2"
export const LOCATION_HISTORY_MAX_RAW_POINTS = 5_001
export const LOCATION_HISTORY_MAX_OUTPUT_POINTS = 1_500
/**
 * Longest window the history shows at once. Owner 2026-09-22: «these days»,
 * then: picking an earlier start must leave the end on today — a week back
 * from today is eight calendar days, so the window is two weeks.
 */
export const LOCATION_HISTORY_MAX_RANGE_DAYS = 14
/** Raw rows read for a window longer than a day; the map still gets the downsampled output. */
export const LOCATION_HISTORY_MAX_RAW_POINTS_RANGE = 20_001

export type HistoryLocationPoint = {
  id: string
  latitude: number
  longitude: number
  accuracy: number | null
  speed: number | null
  heading: number | null
  battery: number | null
  isMoving: boolean
  recordedAt: Date
  workdayId: string | null
}

export type HistoryVisit = {
  id: string
  customerId: string
  status: string
  checkInAt: Date
  checkOutAt: Date | null
  checkInLat: number | null
  checkInLng: number | null
  customer: {
    name: string
    address: string | null
    latitude: number | null
    longitude: number | null
  }
}

export type HistoryStop = {
  id: string
  startedAt: Date
  endedAt: Date
  durationSeconds: number
  latitude: number
  longitude: number
  pointCount: number
  averageAccuracy: number | null
  batteryStart: number | null
  batteryEnd: number | null
  connectivity: "ONLINE" | "OFFLINE_GAPS"
  visit: {
    id: string
    customerId: string
    customerName: string
    customerAddress: string | null
    status: string
    confirmed: true
  } | null
}

export type HistoryGap = {
  id: string
  startedAt: Date
  endedAt: Date
  durationSeconds: number
  reason: "TELEMETRY_GAP" | "WORKDAY_PAUSED"
  /**
   * The last fix before the silence and the first fix after it — except
   * beside a break, below. For a break: the last fix at or before «Перерыв»
   * and the first at or after «Продолжить»; a break with no fix on one side
   * (before the day's first, after its last) has the other one twice.
   */
  startLatitude: number
  startLongitude: number
  endLatitude: number
  endLongitude: number
  /**
   * A lost signal on one side of a break (detectHistoryGaps). One of its ends
   * is the break's edge, where no fix was taken: where he was there is not
   * known, so no line is drawn for it and no distance is told. Its start and
   * its end are both the one fix it has — the fix before it, or, after the
   * break, the fix after it.
   */
  besideBreak?: true
}

export type HistoryAnomaly = {
  id: string
  type: "IMPOSSIBLE_JUMP" | "LOW_ACCURACY" | "MISSING_SEGMENT"
  startedAt: Date
  endedAt: Date
  detail: {
    distanceMeters?: number
    speedKmh?: number
    accuracyMeters?: number
    durationSeconds?: number
  }
}

export type HistoryTimelineEvent = {
  id: string
  at: Date
  endedAt: Date | null
  kind:
    | "WORKDAY_START"
    | "WORKDAY_END"
    | "PLANNED_STOP"
    | "VISIT"
    | "STOP"
    | "TELEMETRY_GAP"
    | "WORKDAY_PAUSE"
    | "IMPOSSIBLE_JUMP"
    | "LOW_ACCURACY"
  source: "WORKDAY" | "PLAN" | "VISIT" | "GPS"
  label: string
  relatedId: string | null
  confirmed: boolean
}

function isFiniteCoordinate(point: HistoryLocationPoint): boolean {
  return Number.isFinite(point.latitude)
    && Number.isFinite(point.longitude)
    && Math.abs(point.latitude) <= 90
    && Math.abs(point.longitude) <= 180
}

export function prepareHistoryPoints(
  rows: HistoryLocationPoint[],
  maxAccuracyMeters: number,
): {
  points: HistoryLocationPoint[]
  rejectedByAccuracy: number
  rejectedInvalid: number
  duplicateCount: number
} {
  const sorted = [...rows].sort((a, b) =>
    a.recordedAt.getTime() - b.recordedAt.getTime() || a.id.localeCompare(b.id),
  )
  const seen = new Set<string>()
  const points: HistoryLocationPoint[] = []
  let rejectedByAccuracy = 0
  let rejectedInvalid = 0
  let duplicateCount = 0

  for (const point of sorted) {
    const fingerprint = `${point.recordedAt.toISOString()}:${point.latitude}:${point.longitude}`
    if (seen.has(fingerprint)) {
      duplicateCount += 1
      continue
    }
    seen.add(fingerprint)
    if (!isFiniteCoordinate(point)) {
      rejectedInvalid += 1
      continue
    }
    if (point.accuracy != null && point.accuracy > maxAccuracyMeters) {
      rejectedByAccuracy += 1
      continue
    }
    points.push(point)
  }

  return { points, rejectedByAccuracy, rejectedInvalid, duplicateCount }
}

/** Deterministic first/last-preserving downsampling for a safe map payload. */
export function downsampleHistoryPoints(
  points: HistoryLocationPoint[],
  limit: number,
): HistoryLocationPoint[] {
  if (points.length <= limit) return points
  if (limit <= 1) return points.slice(0, 1)
  const result: HistoryLocationPoint[] = []
  for (let index = 0; index < limit; index += 1) {
    const sourceIndex = Math.round(index * (points.length - 1) / (limit - 1))
    result.push(points[sourceIndex])
  }
  return result
}

export function calculateHistoryDistance(points: HistoryLocationPoint[]): number {
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

/** A stretch of the day the agent put the workday on hold. */
export type HistoryPauseInterval = { startedAt: Date; endedAt: Date | null }

/** A stretch of time, in epoch milliseconds. */
export type HistorySpan = { from: number; to: number }

function wholeSeconds(span: HistorySpan): number {
  return Math.floor((span.to - span.from) / 1_000)
}

/** The breaks as one set of times: two that overlap or touch are one stretch. */
function mergedSpans(spans: readonly HistorySpan[]): HistorySpan[] {
  const merged: HistorySpan[] = []
  for (const span of [...spans].sort((a, b) => a.from - b.from)) {
    const last = merged.at(-1)
    if (last && span.from <= last.to) last.to = Math.max(last.to, span.to)
    else merged.push({ ...span })
  }
  return merged
}

/** `span` minus every one of `holes`, as the pieces that remain, in time order. */
function spanWithout(span: HistorySpan, holes: readonly HistorySpan[]): HistorySpan[] {
  let pieces: HistorySpan[] = [span]
  for (const hole of holes) {
    pieces = pieces.flatMap((piece) => {
      if (hole.to <= piece.from || hole.from >= piece.to) return [piece]
      const left = hole.from > piece.from ? [{ from: piece.from, to: hole.from }] : []
      const right = hole.to < piece.to ? [{ from: hole.to, to: piece.to }] : []
      return [...left, ...right]
    })
  }
  return pieces.sort((a, b) => a.from - b.from)
}

/** The day's breaks, as detectHistoryGaps gave them: the journal's own times. */
export function historyBreakSpans(gaps: readonly HistoryGap[]): HistorySpan[] {
  return mergedSpans(gaps
    .filter((gap) => gap.reason === "WORKDAY_PAUSED")
    .map((gap) => ({ from: gap.startedAt.getTime(), to: gap.endedAt.getTime() })))
}

/**
 * Why the phone was silent decides what the day's card says. A pause the
 * agent pressed themselves is not a telemetry failure, and calling it one
 * costs twice: the manager sees "GPS quality problems" on an ordinary lunch
 * break, and a real outage no longer stands out among them. The workday's own
 * PAUSE/RESUME events are the evidence — the app stops tracking on pause by
 * design, so the silence is expected, dated and explainable.
 *
 * Every break that is over is a gap of its own, however short, and exactly as
 * long as the journal says — from the second he pressed «Перерыв» to the
 * second he pressed «Продолжить», the figure the attendance report counts.
 * The fixes do not decide it: not the silence around the break, not a fix
 * recorded inside it (data from before 2026-10-11, when such fixes were still
 * accepted), and not the lack of a fix after it. Until 2026-10-20 they did: a
 * break with fixes inside it was read from fix to fix and split at each, so
 * History counted 14 minutes of a 38-minute lunch; and a break after the
 * day's last fix (finished from the break) or before its first was no gap at
 * all — its time was told as a drive.
 *
 * The silence between two fixes, without the breaks in it, is work time
 * without a fix, and each stretch of it is told as any such silence is: a
 * lost signal when it alone is longer than the threshold, and otherwise
 * nothing — part of the drive, as it would be with no break at all. So an
 * hour without a fix around a four-minute break is «Нет сигнала»,
 * «Перерыв 4 мин», «Нет сигнала»; a one-minute break in six minutes without
 * a fix is «Перерыв 1 мин», not six; and the few seconds between the last fix
 * and the press of «Перерыв» are no lost signal, whatever follows the break.
 *
 * A silence with no break in it is one gap from fix to fix, as before. A
 * break still running has no end yet and is not a gap. A day without a single
 * fix has no path and no silence, and gets no gaps.
 */
export function detectHistoryGaps(
  points: HistoryLocationPoint[],
  gapThresholdSeconds: number,
  pauses: readonly HistoryPauseInterval[] = [],
): HistoryGap[] {
  const gaps: HistoryGap[] = []
  if (!points.length) return gaps
  const times = points.map((point) => point.recordedAt.getTime())
  const breaks = mergedSpans(pauses.flatMap((pause) => pause.endedAt && pause.endedAt.getTime() > pause.startedAt.getTime()
    ? [{ from: pause.startedAt.getTime(), to: pause.endedAt.getTime() }]
    : []))

  // Each break, named after the silence it began in: the last fix at or
  // before «Перерыв» (that second is work) and the fix after it.
  const begunIn = new Map<string, number>()
  for (const span of breaks) {
    let lastBefore = -1
    while (lastBefore + 1 < points.length && times[lastBefore + 1] <= span.from) lastBefore += 1
    let firstAfter = lastBefore + 1
    while (firstAfter < points.length && times[firstAfter] < span.to) firstAfter += 1
    const before = points[lastBefore] ?? null
    const next = points[lastBefore + 1] ?? null
    const after = points[firstAfter] ?? null
    const base = `gap-${before?.id ?? "start"}-${next?.id ?? "end"}`
    const order = begunIn.get(base) ?? 0
    begunIn.set(base, order + 1)
    const startFix = before ?? (after as HistoryLocationPoint)
    const endFix = after ?? (before as HistoryLocationPoint)
    gaps.push({
      id: order === 0 ? base : `${base}-break-${order}`,
      startedAt: new Date(span.from),
      endedAt: new Date(span.to),
      durationSeconds: wholeSeconds(span),
      reason: "WORKDAY_PAUSED",
      startLatitude: startFix.latitude,
      startLongitude: startFix.longitude,
      endLatitude: endFix.latitude,
      endLongitude: endFix.longitude,
    })
  }

  for (let index = 1; index < points.length; index += 1) {
    const before = points[index - 1]
    const after = points[index]
    const silence = { from: times[index - 1], to: times[index] }
    const id = `gap-${before.id}-${after.id}`
    const inside = breaks.filter((span) => span.from < silence.to && span.to > silence.from)
    if (!inside.length) {
      if (wholeSeconds(silence) > gapThresholdSeconds) {
        gaps.push({
          id,
          startedAt: before.recordedAt,
          endedAt: after.recordedAt,
          durationSeconds: wholeSeconds(silence),
          reason: "TELEMETRY_GAP",
          startLatitude: before.latitude,
          startLongitude: before.longitude,
          endLatitude: after.latitude,
          endLongitude: after.longitude,
        })
      }
      continue
    }
    spanWithout(silence, inside)
      .filter((span) => wholeSeconds(span) > gapThresholdSeconds)
      .forEach((span, order) => {
        // The one fix this stretch has: after the last break, the one after it.
        const fix = span.to === silence.to ? after : before
        gaps.push({
          id: `${id}-signal-${order}`,
          startedAt: new Date(span.from),
          endedAt: new Date(span.to),
          durationSeconds: wholeSeconds(span),
          reason: "TELEMETRY_GAP",
          startLatitude: fix.latitude,
          startLongitude: fix.longitude,
          endLatitude: fix.latitude,
          endLongitude: fix.longitude,
          besideBreak: true,
        })
      })
  }
  return gaps.sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime() || a.id.localeCompare(b.id))
}

export function detectHistoryAnomalies(input: {
  acceptedPoints: HistoryLocationPoint[]
  rawPoints: HistoryLocationPoint[]
  gaps: HistoryGap[]
  maxAccuracyMeters: number
  impossibleSpeedKmh: number
}): HistoryAnomaly[] {
  // A paused workday explains itself; only unexplained silence is an anomaly.
  const anomalies: HistoryAnomaly[] = input.gaps.filter((gap) => gap.reason === "TELEMETRY_GAP").map((gap) => ({
    id: `missing-${gap.id}`,
    type: "MISSING_SEGMENT",
    startedAt: gap.startedAt,
    endedAt: gap.endedAt,
    detail: { durationSeconds: gap.durationSeconds },
  }))

  for (let index = 1; index < input.acceptedPoints.length; index += 1) {
    const previous = input.acceptedPoints[index - 1]
    const current = input.acceptedPoints[index]
    const elapsedSeconds = (current.recordedAt.getTime() - previous.recordedAt.getTime()) / 1_000
    if (elapsedSeconds <= 0) continue
    const distanceMeters = calculateDistance(
      previous.latitude,
      previous.longitude,
      current.latitude,
      current.longitude,
    )
    const speedKmh = distanceMeters / elapsedSeconds * 3.6
    if (speedKmh > input.impossibleSpeedKmh) {
      anomalies.push({
        id: `jump-${previous.id}-${current.id}`,
        type: "IMPOSSIBLE_JUMP",
        startedAt: previous.recordedAt,
        endedAt: current.recordedAt,
        detail: {
          distanceMeters: Math.round(distanceMeters),
          speedKmh: Math.round(speedKmh * 10) / 10,
        },
      })
    }
  }

  for (const point of input.rawPoints) {
    if (point.accuracy != null && point.accuracy > input.maxAccuracyMeters) {
      anomalies.push({
        id: `accuracy-${point.id}`,
        type: "LOW_ACCURACY",
        startedAt: point.recordedAt,
        endedAt: point.recordedAt,
        detail: { accuracyMeters: point.accuracy },
      })
    }
  }

  return anomalies.sort((a, b) =>
    a.startedAt.getTime() - b.startedAt.getTime()
    || a.type.localeCompare(b.type)
    || a.id.localeCompare(b.id),
  )
}

function visitOverlapsStop(visit: HistoryVisit, startedAt: Date, endedAt: Date): boolean {
  const visitEnd = visit.checkOutAt ?? visit.checkInAt
  return visit.checkInAt <= endedAt && visitEnd >= startedAt
}

function confirmedVisitForStop(
  visits: readonly HistoryVisit[],
  startedAt: Date,
  endedAt: Date,
): HistoryStop["visit"] {
  const visit = visits.find((candidate) => visitOverlapsStop(candidate, startedAt, endedAt))
  if (!visit) return null
  return {
    id: visit.id,
    customerId: visit.customerId,
    customerName: visit.customer.name,
    customerAddress: visit.customer.address,
    status: visit.status,
    confirmed: true,
  }
}

/** One piece of a stretch at one place that the breaks leave standing (historyStayOutsideBreaks). */
export type HistoryStayPiece = HistorySpan & {
  /** Its order among all the stretch's pieces, those not kept included — a stable suffix for its id. */
  index: number
  /** The visit this piece is part of, if any. */
  visitId: string | null
}

/**
 * The one rule for time at one place around the employee's breaks — a GPS
 * stop (detectHistoryStops) and a visit no stop covers (day-trip.ts) alike.
 * A break is his own time and its own row (detectHistoryGaps), so what is
 * told of the place is only its time outside the breaks:
 *  - a stretch the breaks cover wholly is gone: it was the break;
 *  - a piece shorter than the organization's minimum stop is gone, unless it
 *    is the first piece of its visit (`visitOf`) — the visit is never lost,
 *    and a piece of a few seconds without one is no stop (parked, pressed
 *    «Перерыв» at once, resumed and drove off: two pieces of five seconds).
 *    Only the trip names a GPS stop's visits here (cutHistoryStopsAtBreaks):
 *    the stop list keeps no stop under the minimum;
 *  - a piece without a place of its own (`hasPlace`: for a GPS stop, no fix
 *    of its own outside the breaks) is gone: its place would be the break's.
 *
 * Null when no break touches the stretch: it stays exactly as it is.
 */
export function historyStayOutsideBreaks(input: {
  from: number
  to: number
  breaks: readonly HistorySpan[]
  minimumSeconds: number
  visitOf: (piece: HistorySpan) => string | null
  hasPlace?: (piece: HistorySpan) => boolean
}): HistoryStayPiece[] | null {
  const whole = { from: input.from, to: input.to }
  const touching = input.breaks.filter((span) => span.from < whole.to && span.to > whole.from)
  if (!touching.length) return null
  const kept: HistoryStayPiece[] = []
  const named = new Set<string>()
  spanWithout(whole, touching).forEach((piece, index) => {
    if (input.hasPlace && !input.hasPlace(piece)) return
    const visitId = input.visitOf(piece)
    const firstOfVisit = visitId != null && !named.has(visitId)
    if (wholeSeconds(piece) < input.minimumSeconds && !firstOfVisit) return
    if (visitId != null) named.add(visitId)
    kept.push({ ...piece, index, visitId })
  })
  return kept
}

function historyStop(input: {
  id: string
  fixes: readonly HistoryLocationPoint[]
  startedAt: Date
  endedAt: Date
  visits: readonly HistoryVisit[]
  /** Without it, the stop the piece was cut from lends its own. */
  offlineThresholdSeconds: number | null
  connectivity?: HistoryStop["connectivity"]
}): HistoryStop {
  const { fixes, startedAt, endedAt } = input
  const accuracies = fixes.flatMap((point) => point.accuracy == null ? [] : [point.accuracy])
  const batteries = fixes.flatMap((point) => point.battery == null ? [] : [point.battery])
  // A silence inside the stop, its edges included: a piece cut at a break
  // runs to the second of «Перерыв» or from the second of «Продолжить».
  const moments = [startedAt.getTime(), ...fixes.map((point) => point.recordedAt.getTime()), endedAt.getTime()]
  const offline = input.offlineThresholdSeconds
  const hasOfflineGap = offline != null && moments.some((moment, index) =>
    index > 0 && moment - moments[index - 1] > offline * 1_000)
  return {
    id: input.id,
    startedAt,
    endedAt,
    durationSeconds: Math.floor((endedAt.getTime() - startedAt.getTime()) / 1_000),
    latitude: fixes.reduce((sum, point) => sum + point.latitude, 0) / fixes.length,
    longitude: fixes.reduce((sum, point) => sum + point.longitude, 0) / fixes.length,
    pointCount: fixes.length,
    averageAccuracy: accuracies.length
      ? Math.round(accuracies.reduce((sum, value) => sum + value, 0) / accuracies.length * 10) / 10
      : null,
    batteryStart: batteries[0] ?? null,
    batteryEnd: batteries.at(-1) ?? null,
    connectivity: offline == null ? input.connectivity ?? "ONLINE" : hasOfflineGap ? "OFFLINE_GAPS" : "ONLINE",
    visit: confirmedVisitForStop(input.visits, startedAt, endedAt),
  }
}

/**
 * The stops cut at the employee's breaks — one cut, read by every reader of
 * the day, with one difference between them.
 *
 * Standing at one spot before and after a break, the fixes make one stop
 * across it. Until 2026-10-20 only the trip cut it, so «Детали остановок»,
 * the map's popup, the timeline and its CSV still gave the whole stop —
 * «1 ч 19 мин» at the place where he spent his lunch — while the trip said
 * 26 and 16 minutes around the break. The pieces follow
 * historyStayOutsideBreaks; each piece's place, accuracy and battery are read
 * off its own fixes, and its visit is the one it overlaps.
 *
 * The difference is a piece shorter than the minimum that is the first of
 * its visit: the minutes at a customer's door before «Перерыв».
 *  - The stop list, the map's popup, the timeline and its CSV drop it (the
 *    default): «Детали остановок» promises stops of at least the minimum, and
 *    a «0 мин» stop there is noise.
 *  - The trip keeps it (`keepFirstPieceOfVisit`, buildDayTrip): those
 *    minutes are the visit, not a drive. Dropped, they went into the drive
 *    before the break — «В пути» across the check-in.
 * So the History route hands the trip the detector's stops as made, and the
 * trip cuts them itself; stops already cut come back exactly as they are.
 */
export function cutHistoryStopsAtBreaks(stops: readonly HistoryStop[], input: {
  points: readonly HistoryLocationPoint[]
  visits: readonly HistoryVisit[]
  gaps: readonly HistoryGap[]
  minimumSeconds: number
  offlineThresholdSeconds?: number
  /** The trip's cut: the first piece of a visit is kept however short. */
  keepFirstPieceOfVisit?: boolean
}): HistoryStop[] {
  const breaks = historyBreakSpans(input.gaps)
  if (!breaks.length) return [...stops]
  return stops.flatMap((stop) => {
    // A stop is one run of consecutive fixes: its fixes are those of its time.
    const within = (span: HistorySpan) => input.points.filter((point) => {
      const at = point.recordedAt.getTime()
      return at >= span.from && at <= span.to
    })
    const pieces = historyStayOutsideBreaks({
      from: stop.startedAt.getTime(),
      to: stop.endedAt.getTime(),
      breaks,
      minimumSeconds: input.minimumSeconds,
      // For the list no piece is kept only to carry its visit: seconds at a
      // customer's door before «Перерыв» were a stop of «0 мин» in «Детали
      // остановок» and on the map's popup. The trip keeps them as the visit.
      visitOf: input.keepFirstPieceOfVisit
        ? (piece) => confirmedVisitForStop(input.visits, new Date(piece.from), new Date(piece.to))?.id ?? null
        : () => null,
      hasPlace: (piece) => within(piece).length > 0,
    })
    if (!pieces) return [stop]
    return pieces.map((piece) => historyStop({
      id: piece.index === 0 ? stop.id : `${stop.id}-${piece.index}`,
      fixes: within(piece),
      startedAt: new Date(piece.from),
      endedAt: new Date(piece.to),
      visits: input.visits,
      offlineThresholdSeconds: input.offlineThresholdSeconds ?? null,
      connectivity: stop.connectivity,
    }))
  })
}

/**
 * Where the agent stood, from the accepted fixes: runs of fixes within the
 * stop radius for at least the minimum stop. With the day's `gaps`
 * (detectHistoryGaps) they come back cut at his breaks as the stop list
 * reads them (cutHistoryStopsAtBreaks). The trip takes them as made, without
 * the gaps: it cuts them by its own rule (buildDayTrip).
 */
export function detectHistoryStops(input: {
  points: HistoryLocationPoint[]
  visits: HistoryVisit[]
  radiusMeters: number
  minimumSeconds: number
  offlineThresholdSeconds: number
  gaps?: readonly HistoryGap[]
}): HistoryStop[] {
  const { points, visits, radiusMeters, minimumSeconds, offlineThresholdSeconds } = input
  const stops: HistoryStop[] = []
  let startIndex = 0

  while (startIndex < points.length) {
    const anchor = points[startIndex]
    let endIndex = startIndex
    while (
      endIndex + 1 < points.length
      && calculateDistance(
        anchor.latitude,
        anchor.longitude,
        points[endIndex + 1].latitude,
        points[endIndex + 1].longitude,
      ) <= radiusMeters
    ) {
      endIndex += 1
    }

    const endedAt = points[endIndex].recordedAt
    const durationSeconds = Math.floor((endedAt.getTime() - anchor.recordedAt.getTime()) / 1_000)
    if (endIndex > startIndex && durationSeconds >= minimumSeconds) {
      stops.push(historyStop({
        id: `stop-${anchor.id}-${points[endIndex].id}`,
        fixes: points.slice(startIndex, endIndex + 1),
        startedAt: anchor.recordedAt,
        endedAt,
        visits,
        offlineThresholdSeconds,
      }))
      startIndex = endIndex + 1
      continue
    }
    startIndex += 1
  }

  return input.gaps
    ? cutHistoryStopsAtBreaks(stops, { points, visits, gaps: input.gaps, minimumSeconds, offlineThresholdSeconds })
    : stops
}

const TIMELINE_PRIORITY: Record<HistoryTimelineEvent["kind"], number> = {
  WORKDAY_START: 10,
  PLANNED_STOP: 20,
  VISIT: 30,
  STOP: 40,
  TELEMETRY_GAP: 50,
  WORKDAY_PAUSE: 50,
  IMPOSSIBLE_JUMP: 60,
  LOW_ACCURACY: 70,
  WORKDAY_END: 80,
}

export function buildHistoryTimeline(input: {
  workday: { id: string; startedAt: Date; completedAt: Date | null } | null
  plannedStops: Array<{ id: string; plannedTime: Date | null; label: string }>
  visits: HistoryVisit[]
  stops: HistoryStop[]
  gaps: HistoryGap[]
  anomalies: HistoryAnomaly[]
}): HistoryTimelineEvent[] {
  const events: HistoryTimelineEvent[] = []
  if (input.workday) {
    events.push({
      id: `workday-start-${input.workday.id}`,
      at: input.workday.startedAt,
      endedAt: null,
      kind: "WORKDAY_START",
      source: "WORKDAY",
      label: "workday_start",
      relatedId: input.workday.id,
      confirmed: true,
    })
    if (input.workday.completedAt) {
      events.push({
        id: `workday-end-${input.workday.id}`,
        at: input.workday.completedAt,
        endedAt: null,
        kind: "WORKDAY_END",
        source: "WORKDAY",
        label: "workday_end",
        relatedId: input.workday.id,
        confirmed: true,
      })
    }
  }
  for (const stop of input.plannedStops) {
    if (!stop.plannedTime) continue
    events.push({
      id: `plan-${stop.id}`,
      at: stop.plannedTime,
      endedAt: null,
      kind: "PLANNED_STOP",
      source: "PLAN",
      label: stop.label,
      relatedId: stop.id,
      confirmed: false,
    })
  }
  for (const visit of input.visits) {
    events.push({
      id: `visit-${visit.id}`,
      at: visit.checkInAt,
      endedAt: visit.checkOutAt,
      kind: "VISIT",
      source: "VISIT",
      label: visit.customer.name,
      relatedId: visit.id,
      confirmed: true,
    })
  }
  for (const stop of input.stops) {
    events.push({
      id: stop.id,
      at: stop.startedAt,
      endedAt: stop.endedAt,
      kind: "STOP",
      source: "GPS",
      label: stop.visit?.customerName ?? "gps_stop",
      relatedId: stop.visit?.id ?? null,
      confirmed: Boolean(stop.visit),
    })
  }
  for (const gap of input.gaps) {
    const paused = gap.reason === "WORKDAY_PAUSED"
    events.push({
      id: gap.id,
      at: gap.startedAt,
      endedAt: gap.endedAt,
      kind: paused ? "WORKDAY_PAUSE" : "TELEMETRY_GAP",
      source: paused ? "WORKDAY" : "GPS",
      label: paused ? "workday_pause" : "telemetry_gap",
      relatedId: null,
      confirmed: true,
    })
  }
  for (const anomaly of input.anomalies) {
    if (anomaly.type === "MISSING_SEGMENT") continue // represented by its gap event
    events.push({
      id: anomaly.id,
      at: anomaly.startedAt,
      endedAt: anomaly.endedAt,
      kind: anomaly.type,
      source: "GPS",
      label: anomaly.type.toLowerCase(),
      relatedId: null,
      confirmed: true,
    })
  }
  return events.sort((a, b) =>
    a.at.getTime() - b.at.getTime()
    || TIMELINE_PRIORITY[a.kind] - TIMELINE_PRIORITY[b.kind]
    || a.id.localeCompare(b.id),
  )
}

function csvCell(value: unknown): string {
  const text = value == null ? "" : String(value)
  return `"${text.replaceAll("\"", "\"\"")}"`
}

export function buildHistoryCsv(input: {
  agentName: string
  timezone: string
  date: string
  distanceMeters: number | null
  timeline: HistoryTimelineEvent[]
}): string {
  const rows: unknown[][] = [
    ["Agent", input.agentName],
    ["Date", input.date],
    ["Timezone", input.timezone],
    ["Distance meters", input.distanceMeters ?? "not_calculated"],
    [],
    ["Timestamp UTC", "End UTC", "Source", "Kind", "Label", "Confirmed", "Related ID"],
    ...input.timeline.map((event) => [
      event.at.toISOString(),
      event.endedAt?.toISOString() ?? "",
      event.source,
      event.kind,
      event.label,
      event.confirmed ? "yes" : "no",
      event.relatedId ?? "",
    ]),
  ]
  return `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`
}
