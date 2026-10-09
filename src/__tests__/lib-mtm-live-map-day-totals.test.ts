/**
 * «Пробег сегодня» and «В движении» in the selected employee's card on the
 * live map (owner, 2026-10-09: «добей до 100 %» of the Navixy tracking
 * screen).
 *
 * The card must not have kilometres of its own: the same day is already
 * counted by «История за день», the period view and the phone, by one rule.
 * So what is tested is that a built day gives the card the numbers History
 * gives — and what those numbers do with a silent phone, a GPS jump, a poor
 * fix, a break and a day too long to count.
 */
import { describe, expect, it } from "vitest"
import { calculateDistance } from "@/lib/geo-utils"
import { buildDayTrip } from "@/lib/mtm/day-trip"
import {
  detectHistoryGaps,
  detectHistoryStops,
  prepareHistoryPoints,
  type HistoryLocationPoint,
  type HistoryVisit,
} from "@/lib/mtm/location-history"
import {
  liveMapDayPauses,
  liveMapDayPolicy,
  liveMapDayTotals,
  liveMapDayTrack,
  type LiveMapDayPolicy,
} from "@/lib/mtm/live-map-day-totals"
import { drivingDistanceMeters } from "@/lib/mtm/road-distance"

const at = (clock: string) => new Date(`2026-10-09T${clock}Z`)
let sequence = 0
const fix = (clock: string, latitude: number, over: Partial<HistoryLocationPoint> = {}): HistoryLocationPoint => ({
  id: `f${String(sequence++).padStart(5, "0")}`, latitude, longitude: 49.85, accuracy: 8, speed: null, heading: null,
  battery: null, isMoving: false, recordedAt: at(clock), workdayId: null, ...over,
})
const clockAt = (seconds: number) =>
  `${String(8 + Math.floor(seconds / 3_600)).padStart(2, "0")}:${String(Math.floor(seconds % 3_600 / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`
/** Ten minutes north, a fix every thirty seconds, about 56 m a step. */
const drive = (fromMinute: number, startLatitude: number) =>
  Array.from({ length: 21 }, (_unused, index) => fix(clockAt(fromMinute * 60 + index * 30), startLatitude + index * 0.0005))
const straight = (a: HistoryLocationPoint, b: HistoryLocationPoint) => calculateDistance(a.latitude, a.longitude, b.latitude, b.longitude)

const POLICY: LiveMapDayPolicy = {
  maxAccuracyMeters: 100, stopRadiusMeters: 50, stopMinimumSeconds: 300, gapThresholdSeconds: 300, offlineThresholdSeconds: 300,
}
const totals = (rows: HistoryLocationPoint[], over: Partial<Parameters<typeof liveMapDayTotals>[0]> = {}) =>
  liveMapDayTotals({ rows, visits: [], workday: null, pauses: [], policy: POLICY, truncated: false, ...over })

/** What «История за день» computes for the same day, call for call (location-history/route.ts). */
function history(rows: HistoryLocationPoint[], input: {
  visits?: HistoryVisit[]
  workday?: { startedAt: Date; completedAt: Date | null } | null
  roadSteps?: Array<number | null>
} = {}) {
  const prepared = prepareHistoryPoints(rows, POLICY.maxAccuracyMeters)
  const gaps = detectHistoryGaps(prepared.points, POLICY.gapThresholdSeconds, [])
  const stops = detectHistoryStops({
    points: prepared.points, visits: input.visits ?? [], radiusMeters: POLICY.stopRadiusMeters,
    minimumSeconds: POLICY.stopMinimumSeconds, offlineThresholdSeconds: POLICY.offlineThresholdSeconds,
  })
  return {
    tile: drivingDistanceMeters(prepared.points, input.roadSteps),
    trip: buildDayTrip({ points: prepared.points, stops, visits: input.visits ?? [], gaps, workday: input.workday ?? null, roadSteps: input.roadSteps }),
  }
}

// Drove 08:00–08:10, the phone silent 08:10–08:40, drove on 08:40–08:50.
const DAY = [...drive(0, 40.40), ...drive(40, 40.43)]
const SILENT_STEP = 21
const ROADS = DAY.map((_unused, index) => index === 0 ? null : index === SILENT_STEP ? 4_200 : 70)

describe("the card's day in numbers", () => {
  it("the kilometres are History's «Расстояние» and the time in motion is History's «В пути», for the same day", () => {
    const card = totals(DAY, { roadSteps: ROADS })
    const same = history(DAY, { roadSteps: ROADS })
    expect(card.distanceMeters).toBe(same.tile)
    expect(card.movingSeconds).toBe(same.trip.summary.movingSeconds)
    expect(card.unknownSeconds).toBe(same.trip.summary.unknownSeconds)
    // In figures a dispatcher would check by hand: forty steps of 70 m and the
    // road across the silence; two drives of ten minutes; half an hour unknown.
    expect(card).toEqual({
      distanceMeters: 40 * 70 + 4_200,
      movingSeconds: 20 * 60,
      unknownSeconds: 30 * 60,
      firstPointAt: at("08:00:00"),
      lastPointAt: at("08:50:00"),
    })
  })

  it("a silent phone is time without data, and adds kilometres only where a road across the silence is known", () => {
    const withoutRoads = totals(DAY)
    const driven = Math.round(DAY.reduce((sum, point, index) =>
      index === 0 || index === SILENT_STEP ? sum : sum + straight(DAY[index - 1], point), 0))
    // Two kilometres lie between the last fix before the silence and the first after it: not counted.
    expect(straight(DAY[SILENT_STEP - 1], DAY[SILENT_STEP])).toBeGreaterThan(2_000)
    expect(withoutRoads.distanceMeters).toBe(driven)
    expect(withoutRoads.unknownSeconds).toBe(30 * 60)
    // The silence is never «в движении», whichever way the kilometres were counted.
    expect(withoutRoads.movingSeconds).toBe(20 * 60)

    const roadAcross = totals(DAY, { roadSteps: DAY.map((_unused, index) => index === SILENT_STEP ? 4_200 : null) })
    expect(roadAcross.distanceMeters).toBe(driven + 4_200)
  })

  it("a jump no car makes — three kilometres in ten seconds — adds nothing, even when a road was found for it", () => {
    const jump = [
      fix("08:00:00", 40.4000), fix("08:00:30", 40.4005),
      fix("08:00:40", 40.4300),
      fix("08:01:10", 40.4305),
    ]
    const honest = Math.round(straight(jump[0], jump[1]) + straight(jump[2], jump[3]))
    expect(totals(jump).distanceMeters).toBe(honest)
    expect(totals(jump, { roadSteps: [null, null, 3_400, null] }).distanceMeters).toBe(honest)
  })

  it("a fix worse than the organization's limit is not on the track, and the road lengths stay on their own steps", () => {
    const rows = [
      fix("08:00:00", 40.4000),
      fix("08:00:30", 40.4100, { accuracy: 450 }),
      fix("08:01:00", 40.4010),
      fix("08:01:30", 40.4020),
    ]
    const track = liveMapDayTrack(rows, POLICY.maxAccuracyMeters)
    expect(track.map((point) => point.id)).toEqual([rows[0].id, rows[2].id, rows[3].id])
    // The road server is asked about the three fixes that count and answers per step of them.
    expect(totals(rows, { roadSteps: [null, 130, 120] }).distanceMeters).toBe(250)
    // Without the limit the poor fix would have added a kilometre there and a kilometre back.
    expect(totals(rows).distanceMeters).toBe(Math.round(straight(rows[0], rows[2]) + straight(rows[2], rows[3])))
  })

  it("fixes arrive in any order and twice: the day is counted once, in time order", () => {
    const shuffled = [...DAY.slice(10), ...DAY.slice(0, 10), DAY[3], DAY[30]]
    expect(totals(shuffled, { roadSteps: ROADS })).toEqual(totals(DAY, { roadSteps: ROADS }))
  })

  it("a break he pressed himself is not «нет данных»", () => {
    const pauses = liveMapDayPauses([
      { type: "PAUSE", occurredAt: at("08:10:20") },
      { type: "RESUME", occurredAt: at("08:39:40") },
    ])
    expect(totals(DAY, { pauses }).unknownSeconds).toBe(0)
    expect(totals(DAY).unknownSeconds).toBe(30 * 60)
  })

  it("standing at one place all morning is neither kilometres worth the name nor time in motion", () => {
    const standing = Array.from({ length: 61 }, (_unused, index) => fix(clockAt(index * 30), 40.4000 + (index % 2) * 0.00002))
    const card = totals(standing)
    expect(card.movingSeconds).toBe(0)
    // GPS drift at a door: a couple of metres a fix, not a drive.
    expect(card.distanceMeters).toBeLessThan(200)
  })

  it("is given the shift exactly as History is: a day that began with «начать день» begins there for both", () => {
    const workday = { startedAt: at("07:50:00"), completedAt: null }
    const card = totals(DAY, { workday })
    expect(card.movingSeconds).toBe(history(DAY, { workday }).trip.summary.movingSeconds)
    // Passed on, not dropped: without the shift the same fixes give a different figure.
    expect(card.movingSeconds).not.toBe(totals(DAY).movingSeconds)
  })

  it("a visit made while he stood at the client's door is not time in motion", () => {
    const door = Array.from({ length: 41 }, (_unused, index) => fix(clockAt(10 * 60 + index * 30), 40.4100))
    const rows = [...drive(0, 40.40), ...door.slice(1), ...drive(30, 40.41).slice(1)]
    const visits: HistoryVisit[] = [{
      id: "v1", customerId: "c1", status: "CHECKED_OUT", checkInAt: at("08:11:00"), checkOutAt: at("08:29:00"),
      checkInLat: 40.41, checkInLng: 49.85, customer: { name: "Аптека на углу", address: null, latitude: 40.41, longitude: 49.85 },
    }]
    const card = totals(rows, { visits })
    expect(card.movingSeconds).toBe(history(rows, { visits }).trip.summary.movingSeconds)
    // Ten minutes there, twenty at the door, ten minutes on.
    expect(card.movingSeconds).toBe(20 * 60)
  })

  it("a day cut short by the read's cap has no figures at all — only when its first and last fix were", () => {
    expect(totals(DAY, { roadSteps: ROADS, truncated: true })).toEqual({
      distanceMeters: null,
      movingSeconds: null,
      unknownSeconds: null,
      firstPointAt: at("08:00:00"),
      lastPointAt: at("08:50:00"),
    })
  })

  it("a day without a single fix is a counted day with nothing in it, not an unknown one", () => {
    expect(totals([])).toEqual({ distanceMeters: 0, movingSeconds: 0, unknownSeconds: 0, firstPointAt: null, lastPointAt: null })
  })
})

describe("what the day is counted with", () => {
  it("the organization's settings, bounded as History bounds them", () => {
    expect(liveMapDayPolicy({
      historyMaxAccuracyMeters: 100, historyStopRadiusMeters: 50, historyStopMinimumMinutes: 5, offlineThresholdSeconds: 300, gpsInterval: 30,
    })).toEqual(POLICY)
    expect(liveMapDayPolicy({
      historyMaxAccuracyMeters: 50_000, historyStopRadiusMeters: 1, historyStopMinimumMinutes: 0, offlineThresholdSeconds: 60, gpsInterval: 30,
    })).toEqual({
      maxAccuracyMeters: 1_000, stopRadiusMeters: 10, stopMinimumSeconds: 60,
      // Three missed fixes are a silence where the organization's own threshold is shorter than that.
      gapThresholdSeconds: 90, offlineThresholdSeconds: 60,
    })
  })

  it("breaks are read off the shift's own events: a second «пауза» opens nothing, one still going on has no end", () => {
    expect(liveMapDayPauses([
      { type: "PAUSE", occurredAt: at("09:00:00") },
      { type: "PAUSE", occurredAt: at("09:05:00") },
      { type: "RESUME", occurredAt: at("09:30:00") },
      { type: "RESUME", occurredAt: at("09:31:00") },
      { type: "PAUSE", occurredAt: at("12:00:00") },
    ])).toEqual([
      { startedAt: at("09:00:00"), endedAt: at("09:30:00") },
      { startedAt: at("12:00:00"), endedAt: null },
    ])
  })
})
