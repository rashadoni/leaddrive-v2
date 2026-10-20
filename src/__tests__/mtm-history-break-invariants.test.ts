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
 * and every reader of the day reads the same cut stops.
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
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/lib/api-auth"
import { buildDayTrip, type DayTrip, type DayTripEntry } from "@/lib/mtm/day-trip"
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
const A80 = [40.40072, 49.85] as const // 80 m from A: the same building, past the stop radius
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
  workday?: { startedAt: Date; completedAt: Date }
  /** What this day must read, beyond the four facts. */
  reads?: (day: Day) => void
}

type Day = {
  gaps: HistoryGap[]
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
  const stops = detectHistoryStops({
    points, visits, radiusMeters: POLICY.stopRadiusMeters, minimumSeconds: POLICY.stopMinimumSeconds,
    offlineThresholdSeconds: POLICY.offlineThresholdSeconds, gaps,
  })
  const anomalies = detectHistoryAnomalies({ acceptedPoints: points, rawPoints: points, gaps, maxAccuracyMeters: 100, impossibleSpeedKmh: 180 })
  const timeline = buildHistoryTimeline({ workday: { id: "w1", ...workday }, plannedStops: [], visits, stops, gaps, anomalies })
  const trip = buildDayTrip({ points, stops, visits, gaps, workday, stopMinimumSeconds: POLICY.stopMinimumSeconds })
  // The live map's card counts the same day by the same calls.
  const card = liveMapDayTotals({
    rows: day.points, visits, workday, pauses,
    policy: liveMapDayPolicy({ historyMaxAccuracyMeters: 100, historyStopRadiusMeters: 50, historyStopMinimumMinutes: 5, offlineThresholdSeconds: 300, gpsInterval: 30 }),
    truncated: false,
  })
  return { gaps, stops, timeline, trip, card }
}

type Row = Exclude<DayTripEntry, { kind: "START" | "END" }>
const rowsOf = (trip: DayTrip) => trip.entries.filter((entry): entry is Row => entry.kind !== "START" && entry.kind !== "END")
const span = (row: { startedAt: Date; endedAt: Date | null }) => ({ from: row.startedAt.getTime(), to: (row.endedAt ?? row.startedAt).getTime() })
const overlapping = (a: { from: number; to: number }, b: { from: number; to: number }) => a.from < b.to && b.from < a.to
const told = (row: Row) => `${row.kind}${row.kind === "GAP" ? ` ${row.reason}` : ""} ${clock(row.startedAt)}–${clock(row.endedAt)}`

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

function holdsTheFourFacts(name: string, day: Pick<Day, "stops" | "timeline" | "trip">, events: MtmWorkdayPauseEvent[], shift: { startedAt: Date; completedAt: Date }) {
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

  // 4. The day's four figures never add up to more than the shift.
  const { movingSeconds, staySeconds, pausedSeconds, unknownSeconds } = day.trip.summary
  expect(movingSeconds + staySeconds + pausedSeconds + unknownSeconds, `${name}: summary within the shift`)
    .toBeLessThanOrEqual(Math.round((shift.completedAt.getTime() - shift.startedAt.getTime()) / 1_000))

  // And the readers of the day read one cut set: the stop list and the map
  // popup (`stops`), the timeline and its CSV (STOP events) — none overlaps a break.
  const stopsInside = day.stops.filter((stop) => breaks.some((pause) => overlapping(span(stop), pause)))
  expect(stopsInside.map((stop) => `${clock(stop.startedAt)}–${clock(stop.endedAt)}`), `${name}: stops inside a break`).toEqual([])
  const pauseEvents = day.timeline.filter((event) => event.kind === "WORKDAY_PAUSE")
  const stopEvents = day.timeline.filter((event) => event.kind === "STOP")
  expect(stopEvents.filter((event) => pauseEvents.some((pause) => overlapping(span({ startedAt: event.at, endedAt: event.endedAt }), span({ startedAt: pause.at, endedAt: pause.endedAt })))), `${name}: timeline STOP inside a break`).toEqual([])
  expect(stopEvents.map((event) => event.id), `${name}: timeline stops are the stop list`).toEqual(day.stops.map((stop) => stop.id))
  // Every stay the trip took from a stop is that stop, never a whole one the list has cut.
  for (const row of rows) {
    if (row.kind !== "STAY" || !row.id.startsWith("stay-")) continue
    const stop = day.stops.find((candidate) => `stay-${candidate.id}` === row.id)
    expect(stop, `${name}: ${told(row)} is a stop of the list`).toBeDefined()
    expect(row.startedAt.getTime(), `${name}: ${told(row)} starts where its stop does`).toBe(stop!.startedAt.getTime())
  }
  // A visit is named once.
  const named = rows.flatMap((row) => row.kind === "STAY" && row.visit ? [row.visit.id] : [])
  expect(named, `${name}: a visit named twice`).toEqual([...new Set(named)])
  // A stop piece under the minimum is there only for its visit.
  expect(day.stops.filter((stop) => stop.durationSeconds < POLICY.stopMinimumSeconds && !stop.visit).map((stop) => stop.id), `${name}: short stops without a visit`).toEqual([])
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
      const stays = rowsOf(day.trip).filter((row) => row.kind === "STAY")
      // Named once, by its own check-in and check-out — not «Визит 0 мин».
      expect(stays.map((stay) => [stay.kind === "STAY" && stay.visit?.id, stay.kind === "STAY" && stay.visitTimes])).toEqual([
        ["v1", { checkInAt: at("09:10:10"), checkOutAt: at("09:40:20") }],
      ])
      expect(day.stops.map((stop) => [clock(stop.startedAt), clock(stop.endedAt), stop.visit?.id])).toEqual([["09:10:00", "09:10:20", "v1"]])
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
      holdsTheFourFacts(day.name, read, day.journal, day.workday ?? { startedAt: at("09:00:00"), completedAt: at("15:00:00") })
      // The stops are cut once: a second pass — the trip's — finds nothing to cut.
      expect(cutHistoryStopsAtBreaks(read.stops, { points: sorted(day.points), visits: day.visits ?? [], gaps: read.gaps, minimumSeconds: POLICY.stopMinimumSeconds, offlineThresholdSeconds: POLICY.offlineThresholdSeconds }))
        .toEqual(read.stops)
      // The live map's card reads the same day.
      expect([read.card.movingSeconds, read.card.unknownSeconds]).toEqual([read.trip.summary.movingSeconds, read.trip.summary.unknownSeconds])
      day.reads?.(read)
    })
  }

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
    holdsTheFourFacts("demo day", { stops, timeline, trip }, events, facts.workday)
    // «Fasilə» 12:26–13:04, as MTM_DEMO_ELVIN_WORKDAY has it.
    expect(trip.entries.filter((entry) => entry.kind === "GAP" && entry.reason === "WORKDAY_PAUSED").map((entry) => entry.kind === "GAP" && entry.durationSeconds)).toEqual([38 * 60])
    expect(MTM_DEMO_ELVIN_WORKDAY.paused).toBe("12:26")
  })
})

// The same days through the route itself: what the page, the stop list, the
// map's popups, the timeline and the CSV are handed.
describe("GET /api/v1/mtm/location-history on a day with breaks", () => {
  const ROUTE_CASES = ["a fix at the second of «Перерыв» and of «Продолжить», at one spot", "parked, pressed «Перерыв» at once, resumed and drove off", "parked at a customer's door, checked in, a break, checked out", "a 38-minute lunch at one spot", "a dozing phone inside a break (old data)", "a break in the middle of a visit, at one spot", "a break in the middle of a visit, two GPS stops after it", "a visit wholly inside a break (old data)"]

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
      { workdayId: "w1", type: "FINISH", occurredAt: workday.completedAt, appliedAt: workday.completedAt },
    ]
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ id: "agent-1", name: "Anar", role: "AGENT", team: null } as never)
    vi.mocked(prisma.mtmVisit.findMany).mockResolvedValue((day.visits ?? []) as never)
    vi.mocked(prisma.mtmRoute.findMany).mockResolvedValue([] as never)
    vi.mocked(prisma.mtmAgentLocation.findMany).mockResolvedValue(sorted(day.points) as never)
    vi.mocked(prisma.mtmAgentWorkday.findFirst).mockResolvedValue({
      id: "w1", status: "COMPLETED", startedAt: workday.startedAt, pausedAt: null, completedAt: workday.completedAt,
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
      holdsTheFourFacts(`route: ${name}`, data, day.journal, day.workday ?? { startedAt: at("09:00:00"), completedAt: at("15:00:00") })
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
