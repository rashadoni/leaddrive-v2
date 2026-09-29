import { describe, expect, it } from "vitest"
import { calculateDistance } from "@/lib/geo-utils"
import { agentPeriodDayTracks, buildAgentPeriod } from "@/lib/mtm/agent-period"
import { buildDayTrip, type DayTripGap, type DayTripMove } from "@/lib/mtm/day-trip"
import { detectHistoryGaps, detectHistoryStops, type HistoryLocationPoint } from "@/lib/mtm/location-history"
import { distanceBasis, drivingDistanceMeters, drivingStepMeters } from "@/lib/mtm/road-distance"

/**
 * Owner 2026-09-28: «считай» — kilometres along the roads. One rule for the
 * history map, the day's trip, the agent's period and the phone.
 */
const at = (clock: string) => new Date(`2026-09-22T${clock}Z`)
let sequence = 0
const fix = (clock: string, latitude: number, longitude = 49.85): HistoryLocationPoint => ({
  id: `f${sequence++}`, latitude, longitude, accuracy: 8, speed: null, heading: null, battery: null, isMoving: true, recordedAt: at(clock), workdayId: null,
})
const straight = (a: HistoryLocationPoint, b: HistoryLocationPoint) => calculateDistance(a.latitude, a.longitude, b.latitude, b.longitude)

describe("what a step counts", () => {
  it("counts the road where OSRM answered and the straight line where it did not", () => {
    const day = [fix("08:00:00", 40.40), fix("08:01:00", 40.405), fix("08:02:00", 40.41)]
    const steps = drivingStepMeters(day, [null, 700, null])
    expect(steps[0]).toBe(0)
    expect(steps[1]).toBe(700)
    expect(steps[2]).toBeCloseTo(straight(day[1], day[2]), 6)
  })

  it("counts a silence only by its road: without one it is unknown travel", () => {
    const day = [fix("08:00:00", 40.40), fix("08:40:00", 40.45)]
    expect(drivingDistanceMeters(day)).toBe(0)
    expect(drivingDistanceMeters(day, [null, 7_800])).toBe(7_800)
  })

  it("never counts a flight or a GPS jump, whichever way it was measured", () => {
    // Baku to Frankfurt in four hours, and a 3 km jump in ten seconds.
    const flight = [fix("08:00:00", 40.46, 50.05), fix("12:00:00", 50.03, 8.57)]
    expect(drivingDistanceMeters(flight)).toBe(0)
    expect(drivingDistanceMeters(flight, [null, 3_000_000])).toBe(0)
    const jump = [fix("08:00:00", 40.40), fix("08:00:10", 40.43)]
    expect(drivingDistanceMeters(jump)).toBe(0)
  })

  it("says what the kilometres were counted along", () => {
    expect(distanceBasis(null)).toBe("STRAIGHT")
    expect(distanceBasis({ complete: true })).toBe("ROADS")
    expect(distanceBasis({ complete: false })).toBe("PARTIAL")
  })
})

describe("the day's trip along the roads", () => {
  // Drive 08:00–08:10 north, the phone silent 08:10–08:40, drive on 08:40–08:50.
  const drive = (from: number, to: number, startLatitude: number) => Array.from({ length: 21 }, (_, index) => {
    const seconds = from * 60 + index * 30
    const clock = `${String(8 + Math.floor(seconds / 3_600)).padStart(2, "0")}:${String(Math.floor(seconds % 3_600 / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`
    return fix(clock, startLatitude + index * 0.0005)
  })
  const points = [...drive(0, 10, 40.40), ...drive(40, 50, 40.43)]
  const gaps = detectHistoryGaps(points, 300)
  const stops = detectHistoryStops({ points, visits: [], radiusMeters: 80, minimumSeconds: 5 * 60, offlineThresholdSeconds: 300 })
  const silentAt = 21

  it("measures a drive by its road steps and a silence by the shortest road across it", () => {
    const roadSteps = points.map((_, index) => index === 0 ? null : index === silentAt ? 4_200 : 70)
    const trip = buildDayTrip({ points, stops, visits: [], gaps, workday: null, roadSteps })
    const moves = trip.entries.filter((entry): entry is DayTripMove => entry.kind === "MOVE")
    expect(moves.map((move) => move.distanceMeters)).toEqual([20 * 70, 20 * 70])
    expect(trip.summary.movingMeters).toBe(40 * 70)
    const silence = trip.entries.find((entry): entry is DayTripGap => entry.kind === "GAP")
    expect(silence?.roadMeters).toBe(4_200)
    expect(silence?.displacementMeters).toBe(Math.round(straight(points[silentAt - 1], points[silentAt])))
  })

  it("keeps the straight lines, and no road across the silence, when OSRM did not answer", () => {
    const trip = buildDayTrip({ points, stops, visits: [], gaps, workday: null })
    const moves = trip.entries.filter((entry): entry is DayTripMove => entry.kind === "MOVE")
    const straightDrive = Math.round(points.slice(1, silentAt).reduce((sum, point, index) => sum + straight(points[index], point), 0))
    expect(moves[0].distanceMeters).toBe(straightDrive)
    expect(trip.entries.find((entry): entry is DayTripGap => entry.kind === "GAP")?.roadMeters).toBeNull()
  })
})

describe("the agent's period along the roads", () => {
  it("uses each day's road steps on exactly the track the route asked OSRM about", () => {
    const points = [fix("05:00:00", 40.40), fix("05:01:00", 40.405), fix("05:02:00", 40.41)]
    const input = { from: "2026-09-22", to: "2026-09-22", timezone: "Asia/Baku", now: at("15:00:00"), maxAccuracyMeters: 100, workdays: [], visits: [], routes: [], points }
    const track = agentPeriodDayTracks({ points, timezone: "Asia/Baku", maxAccuracyMeters: 100 }).get("2026-09-22")
    expect(track).toHaveLength(3)
    const withRoads = buildAgentPeriod({ ...input, roadStepsByDay: new Map([["2026-09-22", [null, 900, 800]]]) })
    expect(withRoads.days[0].distanceMeters).toBe(1_700)
    expect(buildAgentPeriod(input).days[0].distanceMeters).toBe(drivingDistanceMeters(track!))
  })
})
