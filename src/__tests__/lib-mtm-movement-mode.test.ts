/**
 * Car, on foot or standing, and which way — read off the fixes the phones
 * already send (owner, 2026-11-01: «мне подходит макет, начинай»).
 *
 * The cases are the ones the mockup promised: a car in a jam is still a car,
 * a walk between two pharmacies is a walk, a phone with no course still gets
 * an arrow, and due north (0°) is a course, not «none».
 */
import { describe, expect, it } from "vitest"

import {
  arrowsAlong,
  bearingDegrees,
  compassPoint,
  liveMtmMovement,
  metresPerPixel,
  mtmFixSpeeds,
  readMtmMovement,
  type MtmMovementFix,
} from "@/lib/mtm/movement-mode"

const BAKU = { latitude: 40.4093, longitude: 49.8671 }
const METRES_PER_DEGREE_LAT = 111_320
const T0 = Date.parse("2026-11-01T09:00:00Z")

/** A fix `east`/`north` metres from the start, `seconds` into the day. */
function fix(seconds: number, east: number, north = 0, speed: number | null = null, heading: number | null = null): MtmMovementFix {
  return {
    latitude: BAKU.latitude + north / METRES_PER_DEGREE_LAT,
    longitude: BAKU.longitude + east / (METRES_PER_DEGREE_LAT * Math.cos((BAKU.latitude * Math.PI) / 180)),
    recordedAt: new Date(T0 + seconds * 1000).toISOString(),
    speed,
    heading,
  }
}

/** Fixes every 30 s going east at `kmh`, the phone's speed given or not. */
function going(fromSecond: number, count: number, kmh: number, startEast = 0, withSpeed = true): MtmMovementFix[] {
  return Array.from({ length: count }, (_, step) =>
    fix(fromSecond + step * 30, startEast + (kmh / 3.6) * step * 30, 0, withSpeed ? kmh : null, withSpeed ? 90 : null))
}

function standing(fromSecond: number, count: number, east: number): MtmMovementFix[] {
  return Array.from({ length: count }, (_, step) => fix(fromSecond + step * 30, east + (step % 2) * 3, 0, 0, null))
}

describe("which way", () => {
  it("measures a bearing clockwise from north and names its point of the compass", () => {
    const start = fix(0, 0)
    expect(Math.round(bearingDegrees(start, fix(0, 0, 100)))).toBe(0)
    expect(Math.round(bearingDegrees(start, fix(0, 100)))).toBe(90)
    expect(Math.round(bearingDegrees(start, fix(0, 0, -100)))).toBe(180)
    expect(Math.round(bearingDegrees(start, fix(0, -100)))).toBe(270)
    expect([0, 44, 46, 90, 180, 225, 315, 359, -10, 720].map(compassPoint))
      .toEqual(["N", "NE", "NE", "E", "S", "SW", "NW", "N", "N", "N"])
  })

  it("puts arrows along a line at a steady step, each turned the way the line runs", () => {
    const line: Array<[number, number]> = [fix(0, 0), fix(0, 1000), fix(0, 1000, 1000)].map((point) => [point.latitude, point.longitude])
    const arrows = arrowsAlong(line, 300)
    // Half a step in, then every 300 m: 150, 450, 750 east; 1050…1950 north.
    expect(arrows).toHaveLength(7)
    expect(arrows.slice(0, 3).map((arrow) => Math.round(arrow.bearing))).toEqual([90, 90, 90])
    expect(arrows.slice(3).map((arrow) => Math.round(arrow.bearing))).toEqual([0, 0, 0, 0])
    expect(arrowsAlong(line.slice(0, 1), 300)).toEqual([])
    expect(arrowsAlong(line, 0)).toEqual([])
  })

  it("knows how many metres a pixel is at a zoom", () => {
    expect(metresPerPixel(0, 0)).toBeCloseTo(156_543, 0)
    expect(metresPerPixel(15, BAKU.latitude)).toBeCloseTo(3.64, 1)
  })
})

describe("a day read as trips", () => {
  it("tells a drive from a walk from standing", () => {
    const day = [
      ...standing(0, 6, 0),
      ...going(180, 20, 40, 10),
      ...standing(780, 20, 6700),
      ...going(1380, 12, 5, 6710),
    ]
    const { modes, trips } = readMtmMovement(day)
    expect(trips.map((trip) => trip.mode)).toEqual(["DRIVE", "WALK"])
    expect(modes.slice(0, 6).every((mode) => mode === "STAY")).toBe(true)
    expect(modes.slice(7, 26).every((mode) => mode === "DRIVE")).toBe(true)
    expect(modes.slice(27, 45).every((mode) => mode === "STAY")).toBe(true)
    expect(modes.slice(47).every((mode) => mode === "WALK")).toBe(true)
  })

  it("keeps a car a car through a red light and a jam", () => {
    const day = [
      ...going(0, 8, 40),
      // Two minutes at a light: the phone says 0.
      ...standing(240, 4, 2700),
      ...going(360, 8, 4, 2710),
      ...going(600, 6, 35, 2980),
    ]
    const { modes, trips } = readMtmMovement(day)
    expect(trips).toHaveLength(1)
    expect(trips[0].mode).toBe("DRIVE")
    expect(modes.every((mode) => mode === "DRIVE")).toBe(true)
  })

  it("does not make a walk a drive out of one wild fix", () => {
    const day = going(0, 12, 5)
    day[5] = { ...day[5], speed: 48 }
    expect(readMtmMovement(day).trips.map((trip) => trip.mode)).toEqual(["WALK"])
  })

  it("reads speed and course off the fixes where the phone gave none — the demo pulse, an old phone", () => {
    const drive = going(0, 10, 40, 0, false)
    const speeds = mtmFixSpeeds(drive)
    expect(speeds.every((speed) => speed != null && Math.abs(speed - 40) <= 1)).toBe(true)
    const reading = readMtmMovement(drive)
    expect(reading.trips.map((trip) => trip.mode)).toEqual(["DRIVE"])
    expect(reading.headings.every((heading) => heading != null && Math.round(heading) === 90)).toBe(true)
  })

  it("takes the phone's course of 0° as north, not as no course", () => {
    const north = Array.from({ length: 6 }, (_, step) => fix(step * 30, 0, step * 300, 36, 0))
    expect(readMtmMovement(north).headings).toEqual([0, 0, 0, 0, 0, 0])
  })

  it("never joins two fixes across a silence longer than five minutes", () => {
    const day = [...going(0, 4, 40), ...going(90 + 10 * 60, 4, 40, 10_000)]
    const { trips } = readMtmMovement(day)
    expect(trips.map((trip) => [trip.fromIndex, trip.toIndex])).toEqual([[0, 3], [4, 7]])
  })
})

describe("the live point", () => {
  const now = going(0, 1, 34)[0]

  it("says nothing for a grey last known point", () => {
    expect(liveMtmMovement({ ...now, freshness: "STALE", fieldStatus: "ON_ROAD" })).toBeNull()
  })

  it("stands at a visit whatever the GPS says, and stands below 3 km/h", () => {
    expect(liveMtmMovement({ ...now, freshness: "ONLINE", fieldStatus: "CHECKED_IN" })).toEqual({ mode: "STAY", heading: null })
    expect(liveMtmMovement({ ...now, speed: 2, freshness: "ONLINE", fieldStatus: "STOPPED" })).toEqual({ mode: "STAY", heading: null })
  })

  it("drives at car speed, with the phone's course", () => {
    expect(liveMtmMovement({ ...now, speed: 34, heading: 0, freshness: "ONLINE", fieldStatus: "ON_ROAD" })).toEqual({ mode: "DRIVE", heading: 0 })
  })

  it("walks at walking speed, with the course read off the tail when the phone gave none", () => {
    const tail = going(0, 6, 5, 0, false)
    const current = { ...tail.pop()!, speed: 5, heading: null }
    const reading = liveMtmMovement({ ...current, freshness: "ONLINE", fieldStatus: "ON_ROAD", trail: tail })
    expect(reading?.mode).toBe("WALK")
    expect(Math.round(reading!.heading!)).toBe(90)
  })

  it("is still driving in a jam at 4 km/h when the tail just drove", () => {
    const tail = [...going(0, 8, 40, 0, false), ...going(240, 3, 4, 2700, false)]
    const current = { ...tail.pop()!, speed: 4, heading: null }
    expect(liveMtmMovement({ ...current, freshness: "ONLINE", fieldStatus: "ON_ROAD", trail: tail })?.mode).toBe("DRIVE")
  })

  it("does not carry a drive across a break: the tail before it is not his trip now", () => {
    const before = going(0, 8, 40, 0, false)
    const after = going(3600, 3, 5, 5000, false)
    const current = { ...after.pop()!, speed: 5, heading: null }
    const trail = [...before, { ...before.at(-1)!, breakCut: true as const }, ...after]
    expect(liveMtmMovement({ ...current, freshness: "ONLINE", fieldStatus: "ON_ROAD", trail })?.mode).toBe("WALK")
  })
})
