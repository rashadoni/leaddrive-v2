/**
 * A day with breaks, told once (verification of 2026-10-20, round 4).
 *
 * The owner's rule: a break is the employee's own time. History says how
 * long it was, never where — and it must not tell the same minutes twice.
 * Three rounds fixed the break row itself; what was left were the stops
 * around it: a stop the break covered stayed beside the «Перерыв» row, a
 * «0 мин» piece stayed where he parked and pressed «Перерыв» at once, and
 * the stop list, the map popup, the timeline and its CSV still gave the whole
 * stop — where he spent his lunch — while the trip cut it.
 *
 * Every day below — the verifier's probes and the cases of the earlier
 * rounds — goes through History's own pipeline (as the route runs it, and
 * through the route itself), and every one must hold the same four facts:
 *  1. no row of «Маршрут дня» overlaps a «Перерыв» row;
 *  2. the rows' minutes add up to the time the rows cover — none counted twice;
 *  3. «перерыв» in the summary is the journal's break time;
 *  4. on the road + standing + break + no data never exceed the shift;
 * and every reader of the day reads the same cut stops — the trip with one
 * difference, stated below: a visit's minutes beside a break, under the
 * minimum stop, are the trip's and not the stop list's.
 *
 * And a visit a break fell inside is told by its own time on site (round 7):
 * check-in to check-out — a visit still open, to the day's last fix — minus
 * the breaks. No second of it is «В пути», a lost signal or a stay without
 * the visit, unless the fixes show he left (farther than 150 m from the place
 * of the row that names it, for at least the minimum stop). The first row
 * names the visit; every later row of its time on site is «Там же, после
 * перерыва». Every day of the verifier's round-6 probe is read the same
 * way, and none may read worse on its visits than main did.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/prisma", async () => {
  const { makeMtmPrismaMock } = await import("./mocks/mtm-prisma")
  return { prisma: makeMtmPrismaMock() }
})
vi.mock("@/lib/api-auth", () => ({
  requireAuth: vi.fn(),
  isAuthError: (value: unknown) => value instanceof Response,
}))
vi.mock("@/lib/mtm-audit", () => ({ writeMtmAudit: vi.fn(() => Promise.resolve()) }))
// The workday journal is read only where Workforce is on; the route's own
// availability check is exercised elsewhere (crm-workforce-withdrawal).
vi.mock("@/lib/crm-product-availability", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/crm-product-availability")>(),
  isCrmCapabilityAvailable: () => true,
}))

import { GET } from "@/app/api/v1/mtm/location-history/route"
import { calculateDistance } from "@/lib/geo-utils"
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/lib/api-auth"
import { buildDayTrip, type DayTrip, type DayTripEdge, type DayTripEntry } from "@/lib/mtm/day-trip"
import {
  buildHistoryTimeline,
  cutHistoryStopsAtBreaks,
  detectHistoryAnomalies,
  detectHistoryGaps,
  detectHistoryStops,
  prepareHistoryPoints,
  type HistoryGap,
  type HistoryLocationPoint,
  type HistoryStop,
  type HistoryTimelineEvent,
  type HistoryVisit,
} from "@/lib/mtm/location-history"
import { liveMapDayPolicy, liveMapDayTotals } from "@/lib/mtm/live-map-day-totals"
import { mtmWorkdayPauses, type MtmWorkdayPauseEvent } from "@/lib/mtm/workday-pauses"
import { MTM_DEMO_ELVIN_WORKDAY, MTM_DEMO_HISTORY_POLICY, mtmDemoElvinFacts, mtmDemoElvinHistoryView } from "@/components/demo-center/journey/scenes/mtm-demo-day"

const DAY = "2026-10-20"
const at = (clock: string) => new Date(`${DAY}T${clock}.000Z`)
const clock = (value: Date) => value.toISOString().slice(11, 19)

/** The organization's defaults (MTM_SETTING_DEFAULTS): 50 m, 5 min, 300 s, a fix every 30 s. */
const POLICY = { stopRadiusMeters: 50, stopMinimumSeconds: 5 * 60, offlineThresholdSeconds: 300, gapThresholdSeconds: 300 }

let sequence = 0
/** Fixes from one spot to another, one every `every` seconds, both ends included. */
function seg(from: string, to: string, a: readonly [number, number], b: readonly [number, number], every = 30): HistoryLocationPoint[] {
  const t0 = at(from).getTime()
  const t1 = at(to).getTime()
  const steps = Math.max(1, Math.round((t1 - t0) / (every * 1_000)))
  const count = t1 === t0 ? 1 : steps + 1
  return Array.from({ length: count }, (_, index) => ({
    id: `p${String(sequence++).padStart(5, "0")}`,
    latitude: a[0] + (b[0] - a[0]) * index / steps,
    longitude: a[1] + (b[1] - a[1]) * index / steps,
    accuracy: 8, speed: null, heading: null, battery: 80, isMoving: a[0] !== b[0],
    recordedAt: new Date(t0 + (t1 - t0) * index / steps), workdayId: "w1",
  }))
}
const A = [40.40, 49.85] as const
const A_STREET = [40.401, 49.85] as const // 111 m from A: off the stop
const A40 = [40.40036, 49.85] as const // 40 m from A: inside the stop radius of A, past it of the drive's last fix
const A80 = [40.40072, 49.85] as const // 80 m from A: the same building, past the stop radius
const A_NORTH = [40.4009, 49.85] as const // 100 m north of A
const A_SOUTH = [40.3991, 49.85] as const // 100 m south of A, 200 m from A_NORTH
const B = [40.43, 49.87] as const
const C = [40.45, 49.89] as const
const ROAD = [40.36, 49.85] as const
const FAR = [40.45, 49.85] as const

function visit(id: string, checkIn: string, checkOut: string | null, place: readonly [number, number]): HistoryVisit {
  return {
    id, customerId: `c-${id}`, status: checkOut ? "CHECKED_OUT" : "CHECKED_IN",
    checkInAt: at(checkIn), checkOutAt: checkOut ? at(checkOut) : null,
    checkInLat: place[0], checkInLng: place[1],
    customer: { name: `Аптека ${id}`, address: null, latitude: place[0], longitude: place[1] },
  }
}
const journal = (...pairs: Array<[string, string]>): MtmWorkdayPauseEvent[] =>
  pairs.map(([type, moment]) => ({ type, occurredAt: at(moment) }))

type Case = {
  name: string
  points: HistoryLocationPoint[]
  journal: MtmWorkdayPauseEvent[]
  visits?: HistoryVisit[]
  /** completedAt null: the day is still open. */
  workday?: { startedAt: Date; completedAt: Date | null }
  /** What this day must read, beyond the four facts. */
  reads?: (day: Day) => void
}

type Day = {
  /** The accepted fixes. */
  points: HistoryLocationPoint[]
  gaps: HistoryGap[]
  /** The detector's stops as made: what the trip is handed. */
  detected: HistoryStop[]
  /** Cut at the breaks: the stop list, the map's popups, the timeline and its CSV. */
  stops: HistoryStop[]
  timeline: HistoryTimelineEvent[]
  trip: DayTrip
  card: ReturnType<typeof liveMapDayTotals>
}

const sorted = (points: HistoryLocationPoint[]) =>
  points.filter((point, index, all) => index === 0 || point.recordedAt > all[index - 1].recordedAt)

/** History's pipeline, step for step as GET /api/v1/mtm/location-history runs it. */
function historyDay(day: Case): Day {
  const visits = day.visits ?? []
  const workday = day.workday ?? { startedAt: at("09:00:00"), completedAt: at("15:00:00") }
  const pauses = mtmWorkdayPauses(day.journal).map((pause) => ({ startedAt: pause.from, endedAt: pause.to }))
  const points = prepareHistoryPoints(sorted(day.points), 100).points
  const gaps = detectHistoryGaps(points, POLICY.gapThresholdSeconds, pauses)
  const detected = detectHistoryStops({
    points, visits, radiusMeters: POLICY.stopRadiusMeters, minimumSeconds: POLICY.stopMinimumSeconds,
    offlineThresholdSeconds: POLICY.offlineThresholdSeconds,
  })
  const stops = cutHistoryStopsAtBreaks(detected, {
    points, visits, gaps, minimumSeconds: POLICY.stopMinimumSeconds, offlineThresholdSeconds: POLICY.offlineThresholdSeconds,
  })
  const anomalies = detectHistoryAnomalies({ acceptedPoints: points, rawPoints: points, gaps, maxAccuracyMeters: 100, impossibleSpeedKmh: 180 })
  const timeline = buildHistoryTimeline({ workday: { id: "w1", ...workday }, plannedStops: [], visits, stops, gaps, anomalies })
  const trip = buildDayTrip({ points, stops: detected, visits, gaps, workday, stopMinimumSeconds: POLICY.stopMinimumSeconds })
  // The live map's card counts the same day by the same calls.
  const card = liveMapDayTotals({
    rows: day.points, visits, workday, pauses,
    policy: liveMapDayPolicy({ historyMaxAccuracyMeters: 100, historyStopRadiusMeters: 50, historyStopMinimumMinutes: 5, offlineThresholdSeconds: 300, gpsInterval: 30 }),
    truncated: false,
  })
  return { points, gaps, detected, stops, timeline, trip, card }
}

type Row = Exclude<DayTripEntry, { kind: "START" | "END" }>
const rowsOf = (trip: DayTrip) => trip.entries.filter((entry): entry is Row => entry.kind !== "START" && entry.kind !== "END")
const span = (row: { startedAt: Date; endedAt: Date | null }) => ({ from: row.startedAt.getTime(), to: (row.endedAt ?? row.startedAt).getTime() })
const overlapping = (a: { from: number; to: number }, b: { from: number; to: number }) => a.from < b.to && b.from < a.to
const told = (row: Row) => `${row.kind}${row.kind === "GAP" ? ` ${row.reason}` : ""} ${clock(row.startedAt)}–${clock(row.endedAt)}`
/** The trip's stays: start, end, the visit it names, and how it tells the visit. */
const stayRows = (day: Pick<Day, "trip">) => rowsOf(day.trip).flatMap((row) => row.kind === "STAY" ? [[
  clock(row.startedAt), clock(row.endedAt), row.visit?.id ?? null,
  row.visitTimes ? `${clock(row.visitTimes.checkInAt)}–${clock(row.visitTimes.checkOutAt)}` : row.open ? "open" : row.afterBreak ? "after break" : null,
]] : [])

/** Seconds covered by a set of spans, each second once. */
function coveredSeconds(spans: Array<{ from: number; to: number }>): number {
  let total = 0
  let reach = Number.NEGATIVE_INFINITY
  for (const piece of [...spans].sort((a, b) => a.from - b.from)) {
    const from = Math.max(piece.from, reach)
    if (piece.to > from) total += piece.to - from
    reach = Math.max(reach, piece.to)
  }
  return Math.round(total / 1_000)
}

/** The journal's breaks that are over: what the attendance report counts. */
const journalBreaks = (events: MtmWorkdayPauseEvent[]) =>
  mtmWorkdayPauses(events).flatMap((pause) => pause.to ? [{ from: pause.from.getTime(), to: pause.to.getTime() }] : [])

type Span = { from: number; to: number }
const overlapSeconds = (a: Span, b: Span) => Math.max(0, Math.min(a.to, b.to) - Math.max(a.from, b.from)) / 1_000
function minus(pieces: Span[], holes: Span[]): Span[] {
  for (const hole of holes) {
    pieces = pieces.flatMap((piece) => hole.to <= piece.from || hole.from >= piece.to ? [piece] : [
      ...hole.from > piece.from ? [{ from: piece.from, to: hole.from }] : [],
      ...hole.to < piece.to ? [{ from: hole.to, to: piece.to }] : [],
    ])
  }
  return pieces
}

/** The visit's check-in..check-out; a visit still open runs to the day's last fix. */
function visitSpan(visit: HistoryVisit, points: HistoryLocationPoint[]): Span {
  const from = visit.checkInAt.getTime()
  return { from, to: visit.checkOutAt?.getTime() ?? Math.max(from, points.at(-1)?.recordedAt.getTime() ?? from) }
}

/**
 * The rule, read off the day itself. A visit's time on site: check-in to
 * check-out (still open: to the day's last fix), minus the breaks, minus
 * where the fixes show he left — a run of fixes farther than 150 m from the
 * place of the row that names the visit, for at least the minimum stop, from
 * the last fix there to the first fix back. Only for a visit a break fell
 * inside: a visit with no break inside it is told by its GPS stop, as on any
 * day — a stop ends at its last fix, and a check-out pressed a minute later
 * in the car is in the drive (the demo day has three); that is not a break's
 * doing, and main tells it the same way.
 */
function timeOnSite(visit: HistoryVisit, breaks: Span[], points: HistoryLocationPoint[], place: { latitude: number | null; longitude: number | null } | null): Span[] {
  const whole = visitSpan(visit, points)
  if (!breaks.some((pause) => pause.from < whole.to && pause.to > whole.from)) return []
  const away: Span[] = []
  if (place?.latitude != null && place.longitude != null) {
    const far = points.map((point) => calculateDistance(place.latitude!, place.longitude!, point.latitude, point.longitude) > 150)
    for (let first = 0; first < points.length; first += 1) {
      if (!far[first]) continue
      let last = first
      while (far[last + 1]) last += 1
      if (points[last].recordedAt.getTime() - points[first].recordedAt.getTime() >= POLICY.stopMinimumSeconds * 1_000) {
        away.push({ from: points[first - 1]?.recordedAt.getTime() ?? -Infinity, to: points[last + 1]?.recordedAt.getTime() ?? Infinity })
      }
      first = last
    }
  }
  return minus([whole], [...breaks, ...away]).filter((piece) => piece.to > piece.from)
}

/**
 * Whose time each row tells: a row naming a visit, that visit's; a «Там же,
 * после перерыва» row, the visit of the row that named it, with only breaks,
 * lost signals beside them and other «Там же» rows between — anything else
 * is a failure of its own.
 */
function visitOfRows(name: string, rows: Row[]): Array<string | null> {
  return rows.map((row, index) => {
    if (row.kind !== "STAY") return null
    if (row.visit) return row.visit.id
    if (!row.afterBreak) return null
    for (let back = index - 1; back >= 0; back -= 1) {
      const before = rows[back]
      if (before.kind === "GAP" && (before.reason === "WORKDAY_PAUSED" || before.displacementMeters == null)) continue
      if (before.kind === "STAY" && before.afterBreak) continue
      if (before.kind === "STAY" && before.visit) return before.visit.id
      break
    }
    throw new Error(`${name}: «Там же» ${told(row)} follows no visit`)
  })
}

function holdsTheFourFacts(name: string, day: Pick<Day, "points" | "stops" | "timeline" | "trip">, events: MtmWorkdayPauseEvent[], shift: { startedAt: Date; completedAt: Date | null }, visits: HistoryVisit[]) {
  const rows = rowsOf(day.trip)
  const breakRows = rows.filter((row) => row.kind === "GAP" && row.reason === "WORKDAY_PAUSED")
  const breaks = journalBreaks(events)

  // 1. Nothing is told inside a break: no row overlaps one, and the breaks are the journal's.
  const inside = rows.flatMap((row) => breakRows
    .filter((pause) => pause !== row && overlapping(span(row), span(pause)))
    .map((pause) => `${told(row)} inside ${told(pause)}`))
  expect(inside, `${name}: rows inside a break`).toEqual([])
  expect(breakRows.map((row) => [row.startedAt.getTime(), row.endedAt.getTime()]), `${name}: break rows`)
    .toEqual(breaks.map((pause) => [pause.from, pause.to]))

  // 2. No minute counted twice: the rows' durations are the time they cover.
  expect(rows.reduce((sum, row) => sum + row.durationSeconds, 0), `${name}: rows' minutes`)
    .toBe(coveredSeconds(rows.map(span)))

  // 3. «перерыв» in the summary is the journal's.
  expect(day.trip.summary.pausedSeconds, `${name}: summary.pausedSeconds`)
    .toBe(breaks.reduce((sum, pause) => sum + Math.round((pause.to - pause.from) / 1_000), 0))

  // 4. The day's four figures never add up to more than the shift — an
  //    open one ends where the trip ends it — and no row is told after its end.
  const end = day.trip.entries.find((entry): entry is DayTripEdge => entry.kind === "END")
  expect(rows.filter((row) => end && row.endedAt > end.at).map(told), `${name}: rows after the day's end`).toEqual([])
  const shiftEnd = shift.completedAt ?? end?.at ?? shift.startedAt
  const { movingSeconds, staySeconds, pausedSeconds, unknownSeconds } = day.trip.summary
  expect(movingSeconds + staySeconds + pausedSeconds + unknownSeconds, `${name}: summary within the shift`)
    .toBeLessThanOrEqual(Math.round((shiftEnd.getTime() - shift.startedAt.getTime()) / 1_000))

  // And the readers of the day read one cut set: the stop list and the map
  // popup (`stops`), the timeline and its CSV (STOP events) — none overlaps a break.
  const stopsInside = day.stops.filter((stop) => breaks.some((pause) => overlapping(span(stop), pause)))
  expect(stopsInside.map((stop) => `${clock(stop.startedAt)}–${clock(stop.endedAt)}`), `${name}: stops inside a break`).toEqual([])
  const pauseEvents = day.timeline.filter((event) => event.kind === "WORKDAY_PAUSE")
  const stopEvents = day.timeline.filter((event) => event.kind === "STOP")
  expect(stopEvents.filter((event) => pauseEvents.some((pause) => overlapping(span({ startedAt: event.at, endedAt: event.endedAt }), span({ startedAt: pause.at, endedAt: pause.endedAt })))), `${name}: timeline STOP inside a break`).toEqual([])
  expect(stopEvents.map((event) => event.id), `${name}: timeline stops are the stop list`).toEqual(day.stops.map((stop) => stop.id))
  // The trip and the stop list differ in one thing. Every stay the trip took
  // from a GPS stop is a stop of the list, never a whole one the list has
  // cut — except a piece beside a break, under the minimum, in a visit's
  // time: the list drops it («Детали остановок» promises the minimum), the
  // trip keeps it as that visit's (he was at the customer's, not «В пути»).
  const visitOfRow = visitOfRows(name, rows)
  rows.forEach((row, index) => {
    if (row.kind !== "STAY" || !row.id.startsWith("stay-")) return
    const stop = day.stops.find((candidate) => `stay-${candidate.id}` === row.id)
    if (stop) {
      expect(row.startedAt.getTime(), `${name}: ${told(row)} starts where its stop does`).toBe(stop.startedAt.getTime())
      return
    }
    const own = visits.find((visit) => visit.id === visitOfRow[index])
    expect(Boolean(own && overlapping(span(row), visitSpan(own, day.points))), `${name}: ${told(row)}, not in the stop list, is a visit's`).toBe(true)
  })
  // No row told by a visit's place — the visit's own, or «Там же» — lies in a drive's time.
  const drives = rows.filter((row) => row.kind === "MOVE")
  const atVisit = rows.filter((row) => row.kind === "STAY" && (row.visit || row.afterBreak))
  expect(atVisit.flatMap((row) => drives.filter((drive) => overlapping(span(row), span(drive))).map((drive) => `${told(row)} inside ${told(drive)}`)), `${name}: a visit's row inside a drive`).toEqual([])
  // A visit is named once, and a visit a break fell inside is told whole: its
  // time on site, minus the breaks, lies wholly in rows that name it or say
  // «Там же» after it — no second of it «В пути», «Нет данных» or a stop
  // without it, unless the fixes show he left.
  const named = rows.flatMap((row) => row.kind === "STAY" && row.visit ? [row.visit.id] : [])
  expect(named, `${name}: a visit named twice`).toEqual([...new Set(named)])
  for (const visit of visits) {
    const namer = rows.find((row) => row.kind === "STAY" && row.visit?.id === visit.id) as Extract<Row, { kind: "STAY" }> | undefined
    const pieces = timeOnSite(visit, breaks, day.points, namer ?? null)
    const total = pieces.reduce((sum, piece) => sum + (piece.to - piece.from) / 1_000, 0)
    const ownRows = rows.filter((_, index) => visitOfRow[index] === visit.id)
    const inOwnRows = pieces.reduce((sum, piece) => sum + ownRows.reduce((inRows, row) => inRows + overlapSeconds(span(row), piece), 0), 0)
    expect(total - inOwnRows, `${name}: seconds of ${visit.id}'s time on site told as something else`).toBe(0)
    // The first row of it names it — by its own times, its minutes not being the visit's.
    if (pieces.length) {
      expect(namer?.visitTimes ?? (namer?.open ? "open" : null), `${name}: ${visit.id} named by its own times`)
        .toEqual(visit.checkOutAt ? { checkInAt: visit.checkInAt, checkOutAt: visit.checkOutAt } : "open")
    }
  }
  // No stop is shorter than the minimum «Детали остановок» promises — not
  // even one with a visit: the visit is the trip's to tell, by its own times.
  expect(day.stops.filter((stop) => stop.durationSeconds < POLICY.stopMinimumSeconds).map((stop) => stop.id), `${name}: stops under the minimum`).toEqual([])
}

const CASES: Case[] = [
  // The verifier's route probe «fix_at_both_edges» / S14: a fix at the very second of PAUSE and of RESUME, at one spot.
  {
    name: "a fix at the second of «Перерыв» and of «Продолжить», at one spot",
    points: [...seg("09:00:00", "09:10:00", ROAD, A), ...seg("09:40:00", "09:40:00", A, A), ...seg("09:40:30", "10:00:00", A_STREET, FAR)],
    journal: journal(["PAUSE", "09:10:00"], ["RESUME", "09:40:00"]),
    reads: (day) => {
      // The stop was the break: gone, from the list and from the trip.
      expect(day.stops).toEqual([])
      expect(rowsOf(day.trip).filter((row) => row.kind === "STAY")).toEqual([])
    },
  },
  // «pull_over» / S12: parked, «Перерыв» 5 s after the fix, resumed, drove off 5 s after the next.
  {
    name: "parked, pressed «Перерыв» at once, resumed and drove off",
    points: [...seg("09:00:00", "09:10:00", ROAD, A), ...seg("09:40:05", "09:40:05", A, A), ...seg("09:40:35", "10:00:00", A_STREET, FAR)],
    journal: journal(["PAUSE", "09:10:05"], ["RESUME", "09:40:00"]),
    reads: (day) => {
      // Two pieces of five seconds are no stop: no «Остановка 0 мин».
      expect(day.stops).toEqual([])
      expect(rowsOf(day.trip).map(told)).toEqual(["MOVE 09:00:00–09:10:05", "GAP WORKDAY_PAUSED 09:10:05–09:40:00", "MOVE 09:40:00–15:00:00"])
    },
  },
  // S13: the same at a customer's door, checked in on arrival and out on leaving.
  {
    name: "parked at a customer's door, checked in, a break, checked out",
    points: [...seg("09:00:00", "09:10:00", ROAD, A), ...seg("09:40:05", "09:40:05", A, A), ...seg("09:40:35", "10:00:00", A_STREET, FAR)],
    journal: journal(["PAUSE", "09:10:20"], ["RESUME", "09:40:00"]),
    visits: [visit("v1", "09:10:10", "09:40:20", A)],
    reads: (day) => {
      // Named once, by its own check-in and check-out — not «Визит 0 мин».
      // The twenty seconds after «Продолжить», at the door until the
      // check-out, are the visit's too: «Там же», not the drive's (round 7;
      // until then the drive ran from the press, across the check-out).
      expect(stayRows(day)).toEqual([["09:10:00", "09:10:20", "v1", "09:10:10–09:40:20"], ["09:40:00", "09:40:20", null, "after break"]])
      // Seconds at the door are no stop: not «0 мин» in «Детали остановок»,
      // on the map's popup, in the timeline or the CSV. The trip keeps them,
      // from where he parked, as the stop's own pieces: they are the visit's.
      expect(day.stops).toEqual([])
      expect(rowsOf(day.trip).flatMap((row) => row.kind === "STAY" ? [row.id] : [])).toEqual([`stay-${day.detected[0].id}`, `stay-${day.detected[0].id}-1`])
      // The visit itself is never re-timed: once in the timeline, as recorded.
      expect(day.timeline.filter((event) => event.kind === "VISIT").map((event) => [clock(event.at), event.endedAt && clock(event.endedAt)])).toEqual([["09:10:10", "09:40:20"]])
    },
  },
  // «lunch_38_min»: at one spot 25 min before «Перерыв» and 15 min after «Продолжить».
  {
    name: "a 38-minute lunch at one spot",
    points: [...seg("09:00:00", "09:10:00", ROAD, A), ...seg("09:10:30", "09:35:30", A, A), ...seg("10:14:00", "10:29:00", A, A), ...seg("10:29:30", "10:29:30", A_STREET, A_STREET)],
    journal: journal(["PAUSE", "09:35:50"], ["RESUME", "10:13:50"]),
    reads: (day) => {
      // The stop list, the popup and the timeline: 26 and 15 minutes around the break, not «1 ч 19 мин» at the spot.
      expect(day.stops.map((stop) => [clock(stop.startedAt), clock(stop.endedAt), stop.durationSeconds])).toEqual([
        ["09:10:00", "09:35:50", 1_550],
        ["10:13:50", "10:29:00", 910],
      ])
      expect(day.timeline.filter((event) => event.kind === "STOP").map((event) => [clock(event.at), event.endedAt && clock(event.endedAt)]))
        .toEqual([["09:10:00", "09:35:50"], ["10:13:50", "10:29:00"]])
    },
  },
  // «lunch_at_one_spot»: a 20-second break with fixes every 30 s around it.
  {
    name: "a 20-second break at one spot",
    points: [...seg("09:00:00", "09:10:00", ROAD, A), ...seg("09:10:30", "09:35:30", A, A), ...seg("09:36:30", "10:01:00", A, A), ...seg("10:01:30", "10:20:00", A_STREET, FAR)],
    journal: journal(["PAUSE", "09:35:50"], ["RESUME", "09:36:10"]),
  },
  // S7, old data: a visit checked in and out during the break, no fix in it.
  {
    name: "a visit wholly inside a break (old data)",
    points: [...seg("12:00:00", "12:25:30", C, A), ...seg("13:04:00", "13:30:00", B, C)],
    journal: journal(["PAUSE", "12:26:00"], ["RESUME", "13:04:00"]),
    visits: [visit("v1", "12:30:00", "12:40:00", B)],
    reads: (day) => {
      // Its time is the break's: not a row inside it, nor one beside it.
      expect(rowsOf(day.trip).filter((row) => row.kind === "STAY")).toEqual([])
      expect(day.timeline.filter((event) => event.kind === "VISIT").map((event) => event.relatedId)).toEqual(["v1"])
    },
  },
  // S9b, old data: lunch at a cafe, the dozing phone sent two fixes in the break.
  {
    name: "a dozing phone inside a break (old data)",
    points: [...seg("12:00:00", "12:25:30", C, A), ...seg("12:40:00", "12:40:00", A, A), ...seg("12:55:00", "12:55:00", A, A), ...seg("13:05:00", "13:05:00", A, A), ...seg("13:05:30", "13:30:00", A_STREET, B)],
    journal: journal(["PAUSE", "12:26:00"], ["RESUME", "13:04:00"]),
    reads: (day) => {
      expect(day.gaps.filter((gap) => gap.reason === "WORKDAY_PAUSED").map((gap) => [clock(gap.startedAt), clock(gap.endedAt)])).toEqual([["12:26:00", "13:04:00"]])
      expect(day.stops).toEqual([])
    },
  },
  // S9, old data: one fix inside the break.
  {
    name: "one fix inside a break (old data)",
    points: [...seg("12:00:00", "12:25:30", C, A), ...seg("12:45:00", "12:45:00", A, A), ...seg("13:05:00", "13:30:00", A, B)],
    journal: journal(["PAUSE", "12:26:00"], ["RESUME", "13:04:00"]),
  },
  // S2: a break in the middle of a visit, at one spot.
  {
    name: "a break in the middle of a visit, at one spot",
    points: [...seg("11:30:00", "11:59:30", C, A), ...seg("12:00:00", "12:25:50", A, A), ...seg("13:04:10", "13:30:00", A, A), ...seg("13:30:30", "13:50:00", A, B)],
    journal: journal(["PAUSE", "12:26:00"], ["RESUME", "13:04:00"]),
    visits: [visit("v1", "12:01:00", "13:29:00", A)],
    reads: (day) => {
      // The stop list has the place on both sides of the break, each confirmed by the visit…
      expect(day.stops.map((stop) => [clock(stop.startedAt), clock(stop.endedAt), stop.visit?.id])).toEqual([
        ["11:59:30", "12:26:00", "v1"],
        ["13:04:00", "13:30:30", "v1"],
      ])
      // …and the trip names the visit once, by its own times; after the break, the same place.
      const stays = rowsOf(day.trip).flatMap((row) => row.kind === "STAY" ? [[row.visit?.id ?? null, row.visitTimes ?? null, row.afterBreak ?? false]] : [])
      expect(stays).toEqual([
        ["v1", { checkInAt: at("12:01:00"), checkOutAt: at("13:29:00") }, false],
        [null, null, true],
      ])
    },
  },
  // Verification of round 4 (probe «visit_spanning_break_two_stops_after»):
  // after the break he stood at the spot, then 80 m off in the same building
  // — two GPS stops of the visit. Merging the «Там же» row with the second
  // took that stop's visit, and the visit was named twice.
  {
    name: "a break in the middle of a visit, two GPS stops after it",
    points: [...seg("09:00:00", "10:00:00", ROAD, A), ...seg("10:00:30", "10:20:00", A, A), ...seg("10:50:00", "11:00:00", A, A), ...seg("11:00:30", "11:10:00", A80, A80), ...seg("11:10:30", "11:30:00", A_STREET, FAR)],
    journal: journal(["PAUSE", "10:20:10"], ["RESUME", "10:50:00"]),
    visits: [visit("v1", "10:00:30", "11:10:00", A)],
    reads: (day) => {
      expect(day.stops.map((stop) => [clock(stop.startedAt), clock(stop.endedAt), stop.visit?.id])).toEqual([
        ["09:59:30", "10:20:10", "v1"],
        ["10:50:00", "11:00:00", "v1"],
        ["11:00:30", "11:10:30", "v1"],
      ])
      const stays = rowsOf(day.trip).flatMap((row) => row.kind === "STAY" ? [[clock(row.startedAt), clock(row.endedAt), row.visit?.id ?? null, row.afterBreak ?? false]] : [])
      expect(stays).toEqual([["09:59:30", "10:20:10", "v1", false], ["10:50:00", "11:10:30", null, true]])
    },
  },
  // Verification of round 5 (probe A1): the first fix after «Продолжить» is
  // 80 m off, in the same building — past the stop radius, so the time after
  // the break is a stop of its own, starting at that fix, not at the break's
  // end. Told by where a stop starts, the visit was named again: «Визит
  // 10:00–11:10», «Перерыв», «Визит · на месте 20 мин» for one visit.
  {
    name: "a break in the middle of a visit, the first fix after it 80 m off",
    points: [...seg("09:00:00", "10:00:00", ROAD, A), ...seg("10:00:30", "10:20:00", A, A), ...seg("10:50:20", "11:10:00", A80, A80), ...seg("11:10:30", "11:30:00", A_STREET, FAR)],
    journal: journal(["PAUSE", "10:20:10"], ["RESUME", "10:50:00"]),
    visits: [visit("v1", "10:00:30", "11:10:00", A)],
    reads: (day) => {
      expect(day.stops.map((stop) => [clock(stop.startedAt), clock(stop.endedAt), stop.visit?.id])).toEqual([
        ["09:59:30", "10:20:00", "v1"],
        ["10:50:20", "11:10:30", "v1"],
      ])
      // Its time on site runs to «Перерыв» and from «Продолжить», whatever
      // second the fixes on either side came.
      expect(stayRows(day)).toEqual([["09:59:30", "10:20:10", "v1", "10:00:30–11:10:00"], ["10:50:00", "11:10:30", null, "after break"]])
    },
  },
  // Its twin (probe A2): the first fix after «Продолжить» twenty seconds late, at the spot.
  {
    name: "a break in the middle of a visit, the first fix after it late, at the spot",
    points: [...seg("09:00:00", "10:00:00", ROAD, A), ...seg("10:00:30", "10:20:00", A, A), ...seg("10:50:20", "11:10:00", A, A), ...seg("11:10:30", "11:30:00", A_STREET, FAR)],
    journal: journal(["PAUSE", "10:20:10"], ["RESUME", "10:50:00"]),
    visits: [visit("v1", "10:00:30", "11:10:00", A)],
    reads: (day) => {
      const stays = rowsOf(day.trip).flatMap((row) => row.kind === "STAY" ? [[clock(row.startedAt), clock(row.endedAt), row.visit?.id ?? null, row.afterBreak ?? false]] : [])
      expect(stays).toEqual([["09:59:30", "10:20:10", "v1", false], ["10:50:00", "11:10:00", null, true]])
    },
  },
  // Drift inside the building after the break: two stops of the visit, 100 m
  // either side of the spot — too far apart to merge, each the same place as
  // the visit's. Neither brings the name back, and with the half minute
  // between them told as the visit's (round 7), they read as one «Там же».
  {
    name: "a break in the middle of a visit, two stops after it on either side of the spot",
    points: [...seg("09:00:00", "10:00:00", ROAD, A), ...seg("10:00:30", "10:20:00", A, A), ...seg("10:50:20", "11:00:00", A_NORTH, A_NORTH), ...seg("11:00:30", "11:10:00", A_SOUTH, A_SOUTH), ...seg("11:10:30", "11:30:00", [40.398, 49.85], ROAD)],
    journal: journal(["PAUSE", "10:20:10"], ["RESUME", "10:50:00"]),
    visits: [visit("v1", "10:00:30", "11:10:00", A)],
    reads: (day) => {
      expect(day.stops.map((stop) => [clock(stop.startedAt), clock(stop.endedAt), stop.visit?.id])).toEqual([
        ["09:59:30", "10:20:00", "v1"],
        ["10:50:20", "11:00:00", "v1"],
        ["11:00:30", "11:10:00", "v1"],
      ])
      expect(stayRows(day)).toEqual([["09:59:30", "10:20:10", "v1", "10:00:30–11:10:00"], ["10:50:00", "11:10:00", null, "after break"]])
    },
  },
  // Verification of round 5 (probe B): checked in at 10:00:30, «Перерыв» at
  // 10:03. The minutes at the customer's before it are under the minimum
  // stop. The stop list drops them, and the trip did too: «В пути» ran from
  // 09:00 to the break, across the check-in.
  {
    name: "checked in, a break three minutes later, a long stay after it",
    points: [...seg("09:00:00", "10:00:00", ROAD, A), ...seg("10:00:30", "10:03:00", A, A), ...seg("10:33:00", "11:10:00", A, A), ...seg("11:10:30", "11:30:00", A_STREET, FAR)],
    journal: journal(["PAUSE", "10:03:00"], ["RESUME", "10:33:00"]),
    visits: [visit("v1", "10:00:30", "11:10:00", A)],
    reads: (day) => {
      // The stop list: only the stay after the break — none under the minimum.
      expect(day.stops.map((stop) => [clock(stop.startedAt), clock(stop.endedAt), stop.visit?.id])).toEqual([["10:33:00", "11:10:00", "v1"]])
      // The trip: the minutes before the break are the visit, named by its own times; after it, the same place.
      expect(rowsOf(day.trip).map(told)).toEqual([
        "MOVE 09:00:00–09:59:30", "STAY 09:59:30–10:03:00", "GAP WORKDAY_PAUSED 10:03:00–10:33:00", "STAY 10:33:00–11:10:00", "MOVE 11:10:00–15:00:00",
      ])
      const stays = rowsOf(day.trip).flatMap((row) => row.kind === "STAY" ? [[row.visit?.id ?? null, row.visitTimes ? [clock(row.visitTimes.checkInAt), clock(row.visitTimes.checkOutAt)] : null, row.afterBreak ?? false]] : [])
      expect(stays).toEqual([["v1", ["10:00:30", "11:10:00"], false], [null, null, true]])
      expect(day.trip.summary.movingSeconds).toBe(3_570 + 13_800)
    },
  },
  // Verification of round 6 (probe E10, a regression against main): a visit
  // still open — he is at the customer's now — with a break inside it. The
  // open visit had no check-out to overlap, so the stop's piece after
  // «Продолжить» matched no visit: «Визит», «Перерыв», «Остановка без
  // визита» at the same customer's, in the trip and in «Детали остановок».
  {
    name: "a visit still open, a break inside it, the day open",
    points: [...seg("09:00:00", "10:00:00", ROAD, A), ...seg("10:00:30", "10:20:00", A, A), ...seg("10:50:20", "11:10:00", A, A)],
    journal: journal(["PAUSE", "10:20:10"], ["RESUME", "10:50:00"]),
    visits: [visit("v1", "10:00:30", null, A)],
    workday: { startedAt: at("09:00:00"), completedAt: null },
    reads: (day) => {
      // The stop list: both pieces are the visit's.
      expect(day.stops.map((stop) => [clock(stop.startedAt), clock(stop.endedAt), stop.visit?.id])).toEqual([
        ["09:59:30", "10:20:10", "v1"],
        ["10:50:00", "11:10:00", "v1"],
      ])
      // The trip: named once, as a visit not closed; after the break, the same place.
      expect(stayRows(day)).toEqual([["09:59:30", "10:20:10", "v1", "open"], ["10:50:00", "11:10:00", null, "after break"]])
    },
  },
  // Probe E5c: B with the first fix after «Продолжить» 80 m off. The minutes
  // before the break made no stop of their own (under the minimum), and the
  // stop after the break covered the visit: «В пути» ran to the break, across
  // the check-in.
  {
    name: "checked in, a break three minutes later, the first fix after it 80 m off",
    points: [...seg("09:00:00", "10:00:00", ROAD, A), ...seg("10:00:30", "10:03:00", A, A), ...seg("10:33:20", "11:10:00", A80, A80), ...seg("11:10:30", "11:30:00", A_STREET, FAR)],
    journal: journal(["PAUSE", "10:03:00"], ["RESUME", "10:33:00"]),
    visits: [visit("v1", "10:00:30", "11:10:00", A)],
    reads: (day) => {
      expect(day.stops.map((stop) => [clock(stop.startedAt), clock(stop.endedAt), stop.visit?.id])).toEqual([["10:33:20", "11:10:30", "v1"]])
      expect(rowsOf(day.trip).map(told)).toEqual([
        "MOVE 09:00:00–10:00:30", "STAY 10:00:30–10:03:00", "GAP WORKDAY_PAUSED 10:03:00–10:33:00", "STAY 10:33:00–11:10:30", "MOVE 11:10:30–15:00:00",
      ])
      expect(stayRows(day)).toEqual([["10:00:30", "10:03:00", "v1", "10:00:30–11:10:00"], ["10:33:00", "11:10:30", null, "after break"]])
    },
  },
  // Probe E5, the mirror of B: three minutes at the customer's after
  // «Продолжить», under the minimum, then the check-out and the drive off.
  // They were «В пути» from the press, across the check-out.
  {
    name: "checked in, a break, three minutes after it, checked out and drove off",
    points: [...seg("09:00:00", "10:00:00", ROAD, A), ...seg("10:00:30", "10:03:00", A, A), ...seg("10:33:00", "10:36:00", A, A), ...seg("10:36:30", "11:00:00", A_STREET, FAR)],
    journal: journal(["PAUSE", "10:03:00"], ["RESUME", "10:33:00"]),
    visits: [visit("v1", "10:00:30", "10:36:00", A)],
    reads: (day) => {
      // «Детали остановок» still lists nothing under the minimum.
      expect(day.stops).toEqual([])
      expect(rowsOf(day.trip).map(told)).toEqual([
        "MOVE 09:00:00–09:59:30", "STAY 09:59:30–10:03:00", "GAP WORKDAY_PAUSED 10:03:00–10:33:00", "STAY 10:33:00–10:36:00", "MOVE 10:36:00–15:00:00",
      ])
      expect(stayRows(day)).toEqual([["09:59:30", "10:03:00", "v1", "10:00:30–10:36:00"], ["10:33:00", "10:36:00", null, "after break"]])
    },
  },
  // Probes E8 and E8b: the first fix after «Продолжить» seven minutes late,
  // 80 m and 40 m off. The silence beside the break was «Нет данных», and
  // the stop after it named the visit a second time («Визит · на месте 13
  // мин»). He was checked in and the fixes on both sides are at the place:
  // those minutes are the visit's.
  ...([["80 m", A80, "11:10:30"], ["40 m", A40, "11:10:00"]] as const).map(([off, place, stopEnd]): Case => ({
    name: `the first fix after «Продолжить» seven minutes late, ${off} off`,
    points: [...seg("09:00:00", "10:00:00", ROAD, A), ...seg("10:00:30", "10:20:00", A, A), ...seg("10:57:00", "11:10:00", place, place), ...seg("11:10:30", "11:30:00", A_STREET, FAR)],
    journal: journal(["PAUSE", "10:20:10"], ["RESUME", "10:50:00"]),
    visits: [visit("v1", "10:00:30", "11:10:00", A)],
    reads: (day) => {
      expect(day.stops.map((stop) => [clock(stop.startedAt), clock(stop.endedAt), stop.visit?.id])).toEqual([
        ["09:59:30", "10:20:00", "v1"],
        ["10:57:00", stopEnd, "v1"],
      ])
      expect(rowsOf(day.trip).map(told)).toEqual([
        "MOVE 09:00:00–09:59:30", "STAY 09:59:30–10:20:10", "GAP WORKDAY_PAUSED 10:20:10–10:50:00", `STAY 10:50:00–${stopEnd}`, `MOVE ${stopEnd}–15:00:00`,
      ])
      expect(stayRows(day)).toEqual([["09:59:30", "10:20:10", "v1", "10:00:30–11:10:00"], ["10:50:00", stopEnd, null, "after break"]])
      expect(day.trip.summary.unknownSeconds).toBe(0)
    },
  })),
  // The exception in the rule: checked out from the road. After the break he
  // stood at the spot ten minutes, drove off, and pressed check-out twenty
  // minutes later. The fixes show he left: the drive is «В пути», not «Там же».
  {
    name: "a break in the middle of a visit, checked out from the road",
    points: [...seg("09:00:00", "10:00:00", ROAD, A), ...seg("10:00:30", "10:20:00", A, A), ...seg("10:50:20", "11:00:00", A, A), ...seg("11:00:30", "11:30:00", A_STREET, FAR)],
    journal: journal(["PAUSE", "10:20:10"], ["RESUME", "10:50:00"]),
    visits: [visit("v1", "10:00:30", "11:20:00", A)],
    reads: (day) => {
      expect(rowsOf(day.trip).map(told)).toEqual([
        "MOVE 09:00:00–09:59:30", "STAY 09:59:30–10:20:10", "GAP WORKDAY_PAUSED 10:20:10–10:50:00", "STAY 10:50:00–11:00:30", "MOVE 11:00:30–15:00:00",
      ])
      expect(stayRows(day)).toEqual([["09:59:30", "10:20:10", "v1", "10:00:30–11:20:00"], ["10:50:00", "11:00:30", null, "after break"]])
    },
  },
  // S5: sparse fixes at a customer, a 4-minute break in a 20-minute silence.
  {
    name: "sparse fixes at a customer, a 4-minute break in a 20-minute silence",
    points: [...seg("10:30:00", "10:59:30", C, A), ...seg("11:00:00", "12:00:00", A, A, 600), ...seg("12:20:00", "13:00:00", A, A, 600), ...seg("13:00:30", "13:20:00", A, B)],
    journal: journal(["PAUSE", "12:08:00"], ["RESUME", "12:12:00"]),
    visits: [visit("v1", "11:01:00", "12:59:00", A)],
  },
  // Round 2: drive, a 4-minute break between two fixes, drive.
  {
    name: "drive, a 4-minute break, drive",
    points: [...seg("09:00:00", "09:10:00", ROAD, A), ...seg("09:14:30", "09:30:00", A, FAR)],
    journal: journal(["PAUSE", "09:10:05"], ["RESUME", "09:14:25"]),
  },
  // Round 3: a 1-minute break in 6 minutes without a fix.
  {
    name: "a 1-minute break in 6 minutes without a fix",
    points: [...seg("09:00:00", "09:26:00", ROAD, A), ...seg("09:32:00", "10:00:00", [40.41, 49.85], FAR)],
    journal: journal(["PAUSE", "09:30:30"], ["RESUME", "09:31:30"]),
  },
  // Round 3: 115 s of break with 300 s after it, and one second more.
  {
    name: "115 s of break, 300 s without a fix after it",
    points: [...seg("09:00:00", "09:30:00", ROAD, A), ...seg("09:37:00", "10:00:00", [40.41, 49.85], FAR)],
    journal: journal(["PAUSE", "09:30:05"], ["RESUME", "09:32:00"]),
  },
  {
    name: "115 s of break, 301 s without a fix after it",
    points: [...seg("09:00:00", "09:30:00", ROAD, A), ...seg("09:37:01", "10:00:01", [40.41, 49.85], FAR)],
    journal: journal(["PAUSE", "09:30:05"], ["RESUME", "09:32:00"]),
  },
  // Round 3: an hour without a fix around a 4-minute break.
  {
    name: "an hour without a fix around a 4-minute break",
    points: [...seg("12:30:00", "13:00:00", ROAD, A), ...seg("14:00:00", "14:30:00", B, FAR)],
    journal: journal(["PAUSE", "13:30:00"], ["RESUME", "13:34:00"]),
  },
  // S6: a break, then six minutes without a fix after «Продолжить».
  {
    name: "a break, then six minutes without a fix",
    points: [...seg("09:00:00", "09:30:00", ROAD, A), ...seg("09:46:00", "10:00:00", [40.42, 49.85], FAR)],
    journal: journal(["PAUSE", "09:30:10"], ["RESUME", "09:40:00"]),
  },
  // S8: two breaks in one silence, 30 s of work between them.
  {
    name: "two breaks in one silence, half a minute of work between",
    points: [...seg("12:00:00", "12:25:30", C, A), ...seg("12:40:20", "13:00:00", A, B)],
    journal: journal(["PAUSE", "12:26:00"], ["RESUME", "12:30:00"], ["PAUSE", "12:30:30"], ["RESUME", "12:40:00"]),
  },
  // S10: finished from a break, nothing after it.
  {
    name: "finished from a break, no fix after «Перерыв»",
    points: seg("12:00:00", "12:25:30", C, A),
    journal: journal(["PAUSE", "12:26:00"], ["FINISH", "13:00:00"]),
    workday: { startedAt: at("09:00:00"), completedAt: at("13:00:00") },
    reads: (day) => {
      // The drive ends at «Перерыв», not at «Закрыл день».
      // (The drive is told from «Начал день», as any first drive is.)
      expect(rowsOf(day.trip).map(told)).toEqual(["MOVE 09:00:00–12:26:00", "GAP WORKDAY_PAUSED 12:26:00–13:00:00"])
    },
  },
  // Verification of round 4 (probe «break_after_last_fix_day_open»): the day
  // still open, no fix since «Продолжить» (the app killed, or the next fix not
  // in yet). The day's end was put at the last fix, above the «Перерыв» row.
  // Round 5 (probe C): the end is now the press of «Продолжить», and it says
  // so — not «Последний сигнал»: no signal came after 10:00, and that half
  // hour is the stop of tracking a manager wants to see.
  {
    name: "the day open, a break after the last fix",
    points: seg("09:00:00", "10:00:00", ROAD, A),
    journal: journal(["PAUSE", "10:00:30"], ["RESUME", "10:30:00"]),
    workday: { startedAt: at("09:00:00"), completedAt: null },
    reads: (day) => {
      expect(day.trip.entries.at(-1)).toEqual({ kind: "END", id: "end", at: at("10:30:00"), source: "GPS", noFixSinceBreak: true })
      expect(rowsOf(day.trip).map(told)).toEqual(["MOVE 09:00:00–10:00:30", "GAP WORKDAY_PAUSED 10:00:30–10:30:00"])
    },
  },
  // …and with a fix after «Продолжить», the end is that fix: «Последний сигнал».
  {
    name: "the day open, a fix after the last break",
    points: [...seg("09:00:00", "10:00:00", ROAD, A), ...seg("10:30:30", "10:45:00", A_STREET, FAR)],
    journal: journal(["PAUSE", "10:00:30"], ["RESUME", "10:30:00"]),
    workday: { startedAt: at("09:00:00"), completedAt: null },
    reads: (day) => {
      expect(day.trip.entries.at(-1)).toEqual({ kind: "END", id: "end", at: at("10:45:00"), source: "GPS" })
    },
  },
  // Paused right after «Начать», the first fix after «Продолжить».
  {
    name: "a break before the day's first fix",
    points: [...seg("09:31:00", "10:00:00", ROAD, FAR)],
    journal: journal(["PAUSE", "09:00:30"], ["RESUME", "09:30:00"]),
  },
  // A visit made with the phone silent, a break in the middle of it.
  {
    name: "a visit with the phone silent, a break in the middle of it",
    points: [...seg("09:30:00", "10:00:00", ROAD, A), ...seg("11:30:00", "12:00:00", A_STREET, FAR)],
    journal: journal(["PAUSE", "10:30:00"], ["RESUME", "11:00:00"]),
    visits: [visit("v1", "10:01:00", "11:29:00", A)],
    reads: (day) => {
      const stays = rowsOf(day.trip).flatMap((row) => row.kind === "STAY" ? [[clock(row.startedAt), clock(row.endedAt), row.visit?.id ?? null, row.afterBreak ?? false]] : [])
      expect(stays).toEqual([["10:01:00", "10:30:00", "v1", false], ["11:00:00", "11:29:00", null, true]])
    },
  },
  // Round 1: a 40-minute break with a drive across it, then a lost signal.
  {
    name: "a break with a drive across it, then a lost signal",
    points: [...seg("09:00:00", "09:30:00", ROAD, A), ...seg("10:10:00", "10:40:00", C, B), ...seg("11:20:00", "11:40:00", A, ROAD)],
    journal: journal(["PAUSE", "09:31:00"], ["RESUME", "10:10:00"]),
  },
]

describe("a day with breaks, told once", () => {
  for (const day of CASES) {
    it(day.name, () => {
      const read = historyDay(day)
      holdsTheFourFacts(day.name, read, day.journal, day.workday ?? { startedAt: at("09:00:00"), completedAt: at("15:00:00") }, day.visits ?? [])
      // The stops are cut once: a second pass finds nothing to cut, by the
      // list's rule or the trip's; the detector given the gaps cuts as the list does.
      const cut = { points: sorted(day.points), visits: day.visits ?? [], gaps: read.gaps, minimumSeconds: POLICY.stopMinimumSeconds, offlineThresholdSeconds: POLICY.offlineThresholdSeconds }
      expect(cutHistoryStopsAtBreaks(read.stops, cut)).toEqual(read.stops)
      expect(cutHistoryStopsAtBreaks(read.stops, { ...cut, keepVisitPieces: true })).toEqual(read.stops)
      expect(detectHistoryStops({ points: cut.points, visits: cut.visits, radiusMeters: POLICY.stopRadiusMeters, minimumSeconds: POLICY.stopMinimumSeconds, offlineThresholdSeconds: POLICY.offlineThresholdSeconds, gaps: read.gaps }))
        .toEqual(read.stops)
      // The live map's card reads the same day.
      expect([read.card.movingSeconds, read.card.unknownSeconds]).toEqual([read.trip.summary.movingSeconds, read.trip.summary.unknownSeconds])
      day.reads?.(read)
    })
  }

  // A range has no workday (the route passes none): its END is a signal's,
  // or — no fix since the last «Продолжить» — that press, told as such.
  it("a range's end: the last fix, or a «Продолжить» after it", () => {
    for (const [name, flagged] of [["the day open, a break after the last fix", true], ["the day open, a fix after the last break", false]] as const) {
      const day = CASES.find((candidate) => candidate.name === name)!
      const read = historyDay(day)
      const range = buildDayTrip({ points: prepareHistoryPoints(sorted(day.points), 100).points, stops: read.detected, visits: [], gaps: read.gaps, workday: null, stopMinimumSeconds: POLICY.stopMinimumSeconds })
      const end = range.entries.at(-1) as DayTripEdge
      expect([end.kind, end.source, end.noFixSinceBreak ?? false], name).toEqual(["END", "GPS", flagged])
    }
  })

  // The demo day builds its view with the library's calls (demo-center, not
  // edited here): its stops are the detector's, without the day's gaps. Its
  // only stop near the break ends at 12:24, two minutes before «Fasilə», so
  // the cut changes nothing — and the trip it shows is History's own.
  it("the demo day reads as History reads it", () => {
    const today = DAY
    const view = mtmDemoElvinHistoryView(today)
    const facts = mtmDemoElvinFacts(today)
    const points = prepareHistoryPoints(facts.points, MTM_DEMO_HISTORY_POLICY.maxAccuracyMeters).points
    const gaps = detectHistoryGaps(points, view.policy.gapThresholdSeconds, facts.pauses)
    const stops = detectHistoryStops({
      points, visits: facts.visits, radiusMeters: MTM_DEMO_HISTORY_POLICY.stopRadiusMeters,
      minimumSeconds: MTM_DEMO_HISTORY_POLICY.stopMinimumMinutes * 60, offlineThresholdSeconds: MTM_DEMO_HISTORY_POLICY.offlineThresholdSeconds, gaps,
    })
    const trip = buildDayTrip({ points, stops, visits: facts.visits, gaps, workday: facts.workday, roadSteps: facts.roadSteps, stopMinimumSeconds: MTM_DEMO_HISTORY_POLICY.stopMinimumMinutes * 60 })
    expect(JSON.parse(JSON.stringify(stops))).toEqual(view.stops)
    expect(JSON.parse(JSON.stringify(trip))).toEqual(view.trip)
    const timeline = buildHistoryTimeline({ workday: { id: "w", ...facts.workday }, plannedStops: [], visits: facts.visits, stops, gaps, anomalies: [] })
    const events = [
      { type: "PAUSE", occurredAt: facts.pauses[0].startedAt },
      { type: "RESUME", occurredAt: facts.pauses[0].endedAt as Date },
    ]
    holdsTheFourFacts("demo day", { points, stops, timeline, trip }, events, facts.workday, facts.visits)
    // «Fasilə» 12:26–13:04, as MTM_DEMO_ELVIN_WORKDAY has it.
    expect(trip.entries.filter((entry) => entry.kind === "GAP" && entry.reason === "WORKDAY_PAUSED").map((entry) => entry.kind === "GAP" && entry.durationSeconds)).toEqual([38 * 60])
    expect(MTM_DEMO_ELVIN_WORKDAY.paused).toBe("12:26")
  })
})

// Every day of the verifier's round-6 probe (zz-v9-new; its report says 25,
// the probe holds 26 with the two controls): visits around breaks
// at one place and 100 m off, check-ins and check-outs inside a break, open
// visits, late and off first fixes, two breaks. Each holds every fact above,
// and none reads worse on its visits than main did (merge base 9365d3632, as
// the route gave it): no visit main named is missing, and no second main
// told as a visit, inside that visit's check-in..check-out, is «В пути» now.
// (Of two visits at one place, main and this branch both name only the
// first — an older fault, not a break's; the table holds it as main had it.)
const V9_DAYS: Array<Case & { main: Array<[visitId: string, from: string, to: string]> }> = [
  { name: "E1 check-in during a break, long stay before and after",
    points: [...seg("09:00:00", "09:55:00", ROAD, A), ...seg("09:55:30", "10:00:00", A, A), ...seg("10:30:20", "11:00:00", A, A), ...seg("11:00:30", "11:30:00", A_STREET, FAR)],
    journal: journal(["PAUSE", "10:00:10"], ["RESUME", "10:30:00"]), visits: [visit("v1", "10:10:00", "11:00:00", A)],
    main: [["v1", "09:54:30", "11:00:00"]] },
  { name: "E1b check-in during a break, short stay before",
    points: [...seg("09:00:00", "09:58:00", ROAD, A), ...seg("09:58:30", "10:00:00", A, A), ...seg("10:30:20", "11:00:00", A, A), ...seg("11:00:30", "11:30:00", A_STREET, FAR)],
    journal: journal(["PAUSE", "10:00:10"], ["RESUME", "10:30:00"]), visits: [visit("v1", "10:10:00", "11:00:00", A)],
    main: [["v1", "09:57:30", "11:00:00"]] },
  { name: "E2 check-out during a break, stays after",
    points: [...seg("09:00:00", "10:00:00", ROAD, A), ...seg("10:00:30", "10:20:00", A, A), ...seg("10:50:20", "11:00:00", A, A), ...seg("11:00:30", "11:30:00", A_STREET, FAR)],
    journal: journal(["PAUSE", "10:20:10"], ["RESUME", "10:50:00"]), visits: [visit("v1", "10:00:30", "10:25:00", A)],
    main: [["v1", "09:59:30", "11:00:00"]] },
  { name: "E2b check-out during a break, leaves at once",
    points: [...seg("09:00:00", "10:00:00", ROAD, A), ...seg("10:00:30", "10:20:00", A, A), ...seg("10:50:20", "10:52:00", A, A), ...seg("10:52:30", "11:30:00", A_STREET, FAR)],
    journal: journal(["PAUSE", "10:20:10"], ["RESUME", "10:50:00"]), visits: [visit("v1", "10:00:30", "10:25:00", A)],
    main: [["v1", "09:59:30", "10:52:00"]] },
  { name: "E3 two visits at one place, the break between",
    points: [...seg("09:00:00", "10:00:00", ROAD, A), ...seg("10:00:30", "10:20:00", A, A), ...seg("10:50:20", "11:20:00", A, A), ...seg("11:20:30", "11:40:00", A_STREET, FAR)],
    journal: journal(["PAUSE", "10:20:10"], ["RESUME", "10:50:00"]), visits: [visit("v1", "10:00:30", "10:20:00", A), visit("v2", "10:51:00", "11:20:00", A)],
    main: [["v1", "09:59:30", "11:20:00"]] },
  { name: "E3b two visits at one place, the first checked out after «Продолжить»",
    points: [...seg("09:00:00", "10:00:00", ROAD, A), ...seg("10:00:30", "10:20:00", A, A), ...seg("10:50:20", "11:20:00", A, A), ...seg("11:20:30", "11:40:00", A_STREET, FAR)],
    journal: journal(["PAUSE", "10:20:10"], ["RESUME", "10:50:00"]), visits: [visit("v1", "10:00:30", "10:50:40", A), visit("v2", "10:51:00", "11:20:00", A)],
    main: [["v1", "09:59:30", "11:20:00"]] },
  { name: "E3c two visits back to back at one place, the break inside the first",
    points: [...seg("09:00:00", "10:00:00", ROAD, A), ...seg("10:00:30", "10:20:00", A, A), ...seg("10:50:20", "11:30:00", A, A), ...seg("11:30:30", "11:50:00", A_STREET, FAR)],
    journal: journal(["PAUSE", "10:20:10"], ["RESUME", "10:50:00"]), visits: [visit("v1", "10:00:30", "11:00:00", A), visit("v2", "11:00:30", "11:30:00", A)],
    main: [["v1", "09:59:30", "11:30:00"]] },
  { name: "E3d two visits at one place, no break (control)",
    points: [...seg("09:00:00", "10:00:00", ROAD, A), ...seg("10:00:30", "11:30:00", A, A), ...seg("11:30:30", "11:50:00", A_STREET, FAR)],
    journal: [], visits: [visit("v1", "10:00:30", "11:00:00", A), visit("v2", "11:00:30", "11:30:00", A)],
    main: [["v1", "09:59:30", "11:30:00"]] },
  { name: "E4 visit at A, break, visit at B 100 m off",
    points: [...seg("09:00:00", "10:00:00", ROAD, A), ...seg("10:00:30", "10:20:00", A, A), ...seg("10:50:20", "11:20:00", A_NORTH, A_NORTH), ...seg("11:20:30", "11:40:00", [40.402, 49.85], FAR)],
    journal: journal(["PAUSE", "10:20:10"], ["RESUME", "10:50:00"]), visits: [visit("v1", "10:00:30", "10:20:00", A), visit("v2", "10:51:00", "11:20:00", A_NORTH)],
    main: [["v1", "09:59:30", "10:20:00"], ["v2", "10:50:20", "11:20:00"]] },
  { name: "E4b visit at A, break, visit at B 100 m off, A checked out after «Продолжить»",
    points: [...seg("09:00:00", "10:00:00", ROAD, A), ...seg("10:00:30", "10:20:00", A, A), ...seg("10:50:20", "11:20:00", A_NORTH, A_NORTH), ...seg("11:20:30", "11:40:00", [40.402, 49.85], FAR)],
    journal: journal(["PAUSE", "10:20:10"], ["RESUME", "10:50:00"]), visits: [visit("v1", "10:00:30", "10:51:00", A), visit("v2", "10:51:30", "11:20:00", A_NORTH)],
    main: [["v1", "09:59:30", "10:20:00"], ["v1", "10:50:20", "11:20:00"]] },
  { name: "E4c visit at A, break, a stop at B 100 m off without a visit",
    points: [...seg("09:00:00", "10:00:00", ROAD, A), ...seg("10:00:30", "10:20:00", A, A), ...seg("10:50:20", "11:10:00", A_NORTH, A_NORTH), ...seg("11:10:30", "11:40:00", [40.402, 49.85], FAR)],
    journal: journal(["PAUSE", "10:20:10"], ["RESUME", "10:50:00"]), visits: [visit("v1", "10:00:30", "10:20:00", A)],
    main: [["v1", "09:59:30", "10:20:00"]] },
  { name: "E4d visit at A spanning the break, then a visit at B 100 m off",
    points: [...seg("09:00:00", "10:00:00", ROAD, A), ...seg("10:00:30", "10:20:00", A, A), ...seg("10:50:20", "11:00:00", A, A), ...seg("11:00:30", "11:30:00", A_NORTH, A_NORTH), ...seg("11:30:30", "11:50:00", [40.402, 49.85], FAR)],
    journal: journal(["PAUSE", "10:20:10"], ["RESUME", "10:50:00"]), visits: [visit("v1", "10:00:30", "11:00:00", A), visit("v2", "11:01:00", "11:30:00", A_NORTH)],
    main: [["v1", "09:59:30", "11:00:00"], ["v2", "11:00:30", "11:30:00"]] },
  { name: "E5 a visit under the minimum before and after a break, drives off",
    points: [...seg("09:00:00", "10:00:00", ROAD, A), ...seg("10:00:30", "10:03:00", A, A), ...seg("10:33:00", "10:36:00", A, A), ...seg("10:36:30", "11:00:00", A_STREET, FAR)],
    journal: journal(["PAUSE", "10:03:00"], ["RESUME", "10:33:00"]), visits: [visit("v1", "10:00:30", "10:36:00", A)],
    main: [["v1", "09:59:30", "10:36:00"]] },
  { name: "E5b under the minimum before and after a break, no visit",
    points: [...seg("09:00:00", "10:00:00", ROAD, A), ...seg("10:00:30", "10:03:00", A, A), ...seg("10:33:00", "10:36:00", A, A), ...seg("10:36:30", "11:00:00", A_STREET, FAR)],
    journal: journal(["PAUSE", "10:03:00"], ["RESUME", "10:33:00"]),
    main: [] },
  { name: "E5c a visit under the minimum before a break, the first fix after it 80 m off (B with drift)",
    points: [...seg("09:00:00", "10:00:00", ROAD, A), ...seg("10:00:30", "10:03:00", A, A), ...seg("10:33:20", "11:10:00", A80, A80), ...seg("11:10:30", "11:30:00", A_STREET, FAR)],
    journal: journal(["PAUSE", "10:03:00"], ["RESUME", "10:33:00"]), visits: [visit("v1", "10:00:30", "11:10:00", A)],
    main: [["v1", "10:33:20", "11:10:30"]] },
  { name: "E5d a visit under the minimum before a break, first fix after it 6 min late at the spot",
    points: [...seg("09:00:00", "10:00:00", ROAD, A), ...seg("10:00:30", "10:03:00", A, A), ...seg("10:39:00", "11:10:00", A, A), ...seg("11:10:30", "11:30:00", A_STREET, FAR)],
    journal: journal(["PAUSE", "10:03:00"], ["RESUME", "10:33:00"]), visits: [visit("v1", "10:00:30", "11:10:00", A)],
    main: [["v1", "09:59:30", "11:10:00"]] },
  { name: "E6 two breaks inside one visit",
    points: [...seg("09:00:00", "10:00:00", ROAD, A), ...seg("10:00:30", "10:20:00", A, A), ...seg("10:30:20", "11:00:00", A, A), ...seg("11:10:20", "12:00:00", A, A), ...seg("12:00:30", "12:20:00", A_STREET, FAR)],
    journal: journal(["PAUSE", "10:20:10"], ["RESUME", "10:30:00"], ["PAUSE", "11:00:10"], ["RESUME", "11:10:00"]), visits: [visit("v1", "10:00:30", "12:00:00", A)],
    main: [["v1", "09:59:30", "12:00:00"]] },
  { name: "E7 two breaks inside one visit, three minutes of work between",
    points: [...seg("09:00:00", "10:00:00", ROAD, A), ...seg("10:00:30", "10:20:00", A, A), ...seg("10:30:20", "10:33:00", A, A), ...seg("10:50:20", "11:10:00", A, A), ...seg("11:10:30", "11:30:00", A_STREET, FAR)],
    journal: journal(["PAUSE", "10:20:10"], ["RESUME", "10:30:00"], ["PAUSE", "10:33:10"], ["RESUME", "10:50:00"]), visits: [visit("v1", "10:00:30", "11:10:00", A)],
    main: [["v1", "09:59:30", "11:10:00"]] },
  { name: "E8 first fix after «Продолжить» 7 min late and 80 m off",
    points: [...seg("09:00:00", "10:00:00", ROAD, A), ...seg("10:00:30", "10:20:00", A, A), ...seg("10:57:00", "11:10:00", A80, A80), ...seg("11:10:30", "11:30:00", A_STREET, FAR)],
    journal: journal(["PAUSE", "10:20:10"], ["RESUME", "10:50:00"]), visits: [visit("v1", "10:00:30", "11:10:00", A)],
    main: [["v1", "09:59:30", "10:20:00"], ["v1", "10:57:00", "11:10:30"]] },
  { name: "E8b first fix after «Продолжить» 7 min late, 40 m off (inside the radius)",
    points: [...seg("09:00:00", "10:00:00", ROAD, A), ...seg("10:00:30", "10:20:00", A, A), ...seg("10:57:00", "11:10:00", A40, A40), ...seg("11:10:30", "11:30:00", A_STREET, FAR)],
    journal: journal(["PAUSE", "10:20:10"], ["RESUME", "10:50:00"]), visits: [visit("v1", "10:00:30", "11:10:00", A)],
    main: [["v1", "09:59:30", "10:20:00"], ["v1", "10:57:00", "11:10:00"]] },
  { name: "E9 check-in during a break, leaves three minutes after «Продолжить»",
    points: [...seg("09:00:00", "09:58:00", ROAD, A), ...seg("09:58:30", "10:00:00", A, A), ...seg("10:30:20", "10:33:00", A, A), ...seg("10:33:30", "11:00:00", A_STREET, FAR)],
    journal: journal(["PAUSE", "10:00:10"], ["RESUME", "10:30:00"]), visits: [visit("v1", "10:10:00", "10:33:00", A)],
    main: [["v1", "09:57:30", "10:33:00"]] },
  { name: "E10 a visit still open, a break inside it, day open",
    points: [...seg("09:00:00", "10:00:00", ROAD, A), ...seg("10:00:30", "10:20:00", A, A), ...seg("10:50:20", "11:10:00", A, A)],
    journal: journal(["PAUSE", "10:20:10"], ["RESUME", "10:50:00"]), visits: [visit("v1", "10:00:30", null, A)],
    workday: { startedAt: at("09:00:00"), completedAt: null },
    main: [["v1", "09:59:30", "11:10:00"]] },
  { name: "E10b a visit still open, no break (control), day open",
    points: [...seg("09:00:00", "10:00:00", ROAD, A), ...seg("10:00:30", "11:10:00", A, A)],
    journal: [], visits: [visit("v1", "10:00:30", null, A)],
    workday: { startedAt: at("09:00:00"), completedAt: null },
    main: [["v1", "09:59:30", "11:10:00"]] },
  { name: "E11 visit with the phone silent, under the minimum before and after the break",
    points: [...seg("09:30:00", "09:59:00", ROAD, A), ...seg("10:45:00", "11:00:00", A_STREET, FAR)],
    journal: journal(["PAUSE", "10:03:00"], ["RESUME", "10:33:00"]), visits: [visit("v1", "10:00:00", "10:36:00", A)],
    main: [["v1", "09:59:00", "10:45:00"]] },
  { name: "E12 B, then a second visit at the same spot after the break",
    points: [...seg("09:00:00", "10:00:00", ROAD, A), ...seg("10:00:30", "10:03:00", A, A), ...seg("10:33:00", "11:10:00", A, A), ...seg("11:10:30", "11:30:00", A_STREET, FAR)],
    journal: journal(["PAUSE", "10:03:00"], ["RESUME", "10:33:00"]), visits: [visit("v1", "10:00:30", "10:02:30", A), visit("v2", "10:34:00", "11:10:00", A)],
    main: [["v1", "09:59:30", "11:10:00"]] },
  { name: "E13 open day, currently on a second break after a resumed first one",
    points: seg("09:00:00", "10:00:00", ROAD, A_STREET),
    journal: journal(["PAUSE", "10:00:30"], ["RESUME", "10:30:00"], ["PAUSE", "10:31:00"]),
    workday: { startedAt: at("09:00:00"), completedAt: null },
    main: [] },
]

describe("the verifier's days of round 6, never worse than main on their visits", () => {
  it("are the probe's 26", () => expect(new Set(V9_DAYS.map((day) => day.name.split(" ")[0])).size).toBe(26))
  for (const day of V9_DAYS) {
    it(day.name, () => {
      const read = historyDay(day)
      const visits = day.visits ?? []
      holdsTheFourFacts(day.name, read, day.journal, day.workday ?? { startedAt: at("09:00:00"), completedAt: at("15:00:00") }, visits)
      const rows = rowsOf(read.trip)
      const named = new Set(rows.flatMap((row) => row.kind === "STAY" && row.visit ? [row.visit.id] : []))
      const drives = rows.filter((row) => row.kind === "MOVE")
      for (const [visitId, from, to] of day.main) {
        expect(named.has(visitId), `${day.name}: ${visitId}, named on main, is named`).toBe(true)
        const own = visitSpan(visits.find((candidate) => candidate.id === visitId)!, read.points)
        const toldAsVisit = { from: Math.max(at(from).getTime(), own.from), to: Math.min(at(to).getTime(), own.to) }
        expect(drives.reduce((sum, drive) => sum + overlapSeconds(span(drive), toldAsVisit), 0), `${day.name}: seconds of ${visitId} main told as the visit, «В пути» now`).toBe(0)
      }
    })
  }
})

// The same days through the route itself: what the page, the stop list, the
// map's popups, the timeline and the CSV are handed.
describe("GET /api/v1/mtm/location-history on a day with breaks", () => {
  const ROUTE_CASES = [
    "a fix at the second of «Перерыв» and of «Продолжить», at one spot", "parked, pressed «Перерыв» at once, resumed and drove off",
    "parked at a customer's door, checked in, a break, checked out", "a 38-minute lunch at one spot", "a dozing phone inside a break (old data)",
    "a break in the middle of a visit, at one spot", "a break in the middle of a visit, two GPS stops after it", "a visit wholly inside a break (old data)",
    "a break in the middle of a visit, the first fix after it 80 m off", "a break in the middle of a visit, two stops after it on either side of the spot",
    "checked in, a break three minutes later, a long stay after it", "the day open, a break after the last fix",
    "a visit still open, a break inside it, the day open", "checked in, a break three minutes later, the first fix after it 80 m off",
    "checked in, a break, three minutes after it, checked out and drove off", "the first fix after «Продолжить» seven minutes late, 80 m off",
    "the first fix after «Продолжить» seven minutes late, 40 m off", "a break in the middle of a visit, checked out from the road",
  ]

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(requireAuth).mockResolvedValue({ orgId: "org-1", userId: "admin-user", role: "admin", email: "admin@example.com", name: "Admin" } as never)
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({ plan: "enterprise", addons: [], features: [], modules: { mtm: true } } as never)
  })

  async function viaRoute(day: Case, format = "") {
    const workday = day.workday ?? { startedAt: at("09:00:00"), completedAt: at("15:00:00") }
    const events = [
      { workdayId: "w1", type: "START", occurredAt: workday.startedAt, appliedAt: workday.startedAt },
      ...day.journal.map((event) => ({ workdayId: "w1", ...event, appliedAt: event.occurredAt })),
      ...workday.completedAt ? [{ workdayId: "w1", type: "FINISH", occurredAt: workday.completedAt, appliedAt: workday.completedAt }] : [],
    ]
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ id: "agent-1", name: "Anar", role: "AGENT", team: null } as never)
    vi.mocked(prisma.mtmVisit.findMany).mockResolvedValue((day.visits ?? []) as never)
    vi.mocked(prisma.mtmRoute.findMany).mockResolvedValue([] as never)
    vi.mocked(prisma.mtmAgentLocation.findMany).mockResolvedValue(sorted(day.points) as never)
    vi.mocked(prisma.mtmAgentWorkday.findFirst).mockResolvedValue({
      id: "w1", status: workday.completedAt ? "COMPLETED" : "ACTIVE", startedAt: workday.startedAt, pausedAt: null, completedAt: workday.completedAt,
      totalPausedSeconds: 0, startLatitude: null, startLongitude: null, endLatitude: null, endLongitude: null,
    } as never)
    vi.mocked(prisma.mtmAgentWorkdayEvent.findMany).mockImplementation((async (args: { where: { type?: { in: string[] } } }) =>
      events.filter((event) => !args.where.type || args.where.type.in.includes(event.type))) as never)
    return GET(new NextRequest(`http://localhost:3000/api/v1/mtm/location-history?agentId=agent-1&date=${DAY}${format}`))
  }

  const dated = (_key: string, value: unknown) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value) ? new Date(value) : value

  for (const name of ROUTE_CASES) {
    it(name, async () => {
      const day = CASES.find((candidate) => candidate.name === name)!
      const response = await viaRoute(day)
      expect(response.status).toBe(200)
      const { data } = JSON.parse(await response.text(), dated) as { data: Day & { summary: { stopCount: number; pausedGapCount: number } } }
      holdsTheFourFacts(`route: ${name}`, data, day.journal, day.workday ?? { startedAt: at("09:00:00"), completedAt: at("15:00:00") }, day.visits ?? [])
      expect(data.summary.stopCount).toBe(data.stops.length)
      // The route reads the day exactly as the pipeline above does.
      const expected = JSON.parse(JSON.stringify(historyDay(day)), dated) as Day
      expect(data.stops).toEqual(expected.stops)
      expect(data.trip).toEqual(expected.trip)

      // The CSV export: no stop row inside a break row.
      const csv = await (await viaRoute(day, "&format=csv")).text()
      const lines = csv.split("\r\n").map((line) => line.split(",").map((cell) => cell.replace(/^"|"$/g, "")))
      const rowsOfKind = (kind: string) => lines.filter((cells) => cells[3] === kind).map((cells) => ({ from: Date.parse(cells[0]), to: Date.parse(cells[1]) }))
      const pauses = rowsOfKind("WORKDAY_PAUSE")
      expect(pauses.length).toBe(journalBreaks(day.journal).length)
      expect(rowsOfKind("STOP").filter((stop) => pauses.some((pause) => overlapping(stop, pause)))).toEqual([])
    })
  }
})
