/**
 * One line between «moving» and «standing» for a GPS fix: 3 km/h as the
 * screens show it (owner, 2026-10-15). Until then the writers and the live
 * status said above 1 km/h and the list beside the map said above 2.
 *
 * The values are production's (2026-10-15, read only, 30 days of real phones;
 * src/lib/mtm/gps-speed.ts has the measurement): a standing phone's GPS jitter
 * is stored at 1–2.4 km/h, a walk at 3–4 km/h, a drive at tens.
 */
import { describe, expect, it } from "vitest"
import { MTM_MOVING_FROM_KMH, MTM_MOVING_MIN_STORED_SPEED, mtmSpeedKmh, mtmSpeedMoving } from "@/lib/mtm/gps-speed"
import { isMtmAgentMoving, mtmSampleMoving } from "@/lib/mtm/live-field-status"
import { rosterValue } from "@/lib/mtm/live-map-roster"
import { classifyMtmStationaryPoint } from "@/lib/mtm/stationary-anchor"
import type { MtmDashboardAgent } from "@/lib/mtm-types"

/** Stored speeds of a phone lying on a pharmacy counter. `null` is what the app sends for Android's 0. */
const STANDING = [null, 0.3, 1, 1.4, 1.9, 2.4, 2.49]
/** A walk in from the car, a slow drive, a drive. */
const MOVING = [2.5, 2.73, 3, 3.4, 4.1, 12, 52.2]

const at = (seconds: number) => new Date(Date.parse("2026-10-15T09:00:00.000Z") + seconds * 1000)
/** About this many metres north of a pharmacy door. */
const north = (meters: number) => 40.4093 + meters / 111_195

const listed = (speed: number | null) => rosterValue({ agentId: "a", speed } as MtmDashboardAgent, "speed")

describe("the line between moving and standing", () => {
  it("is 3 km/h as a screen shows it: a fix shown as «2 km/h» stands, one shown as «3 km/h» moves", () => {
    expect(MTM_MOVING_FROM_KMH).toBe(3)
    expect(STANDING.map(mtmSpeedMoving)).toEqual(STANDING.map(() => false))
    expect(MOVING.map(mtmSpeedMoving)).toEqual(MOVING.map(() => true))
    expect(STANDING.map(mtmSpeedKmh).every((kmh) => kmh == null || kmh < 3)).toBe(true)
    expect(MOVING.map(mtmSpeedKmh).every((kmh) => kmh != null && kmh >= 3)).toBe(true)
    // What is not a speed says nothing about movement.
    expect([undefined, Number.NaN, Number.POSITIVE_INFINITY, -4].map(mtmSpeedMoving)).toEqual([false, false, false, false])
  })

  it("the database filter on the stored column draws it at the same place", () => {
    expect(MTM_MOVING_MIN_STORED_SPEED).toBe(2.5)
    const largestBelow = 2.5 - Number.EPSILON * 2
    for (const speed of [largestBelow, 2.5, 2.5 + Number.EPSILON * 2]) {
      expect(mtmSpeedMoving(speed), String(speed)).toBe(speed >= MTM_MOVING_MIN_STORED_SPEED)
    }
    for (let hundredths = 0; hundredths <= 1_000; hundredths += 1) {
      const speed = hundredths / 100
      expect(mtmSpeedMoving(speed), String(speed)).toBe(speed >= MTM_MOVING_MIN_STORED_SPEED)
    }
  })

  it("the stored flag, the live status, the stop and the list all read a fix the same", () => {
    for (const speed of [...STANDING, ...MOVING]) {
      const moving = mtmSpeedMoving(speed)
      expect(mtmSampleMoving({ isMoving: moving, speed }), String(speed)).toBe(moving)
      // A row whose flag the writer did not set (the web and API-key entry) is read by its speed alone.
      expect(mtmSampleMoving({ isMoving: false, speed }), String(speed)).toBe(moving)
      expect(classifyMtmStationaryPoint({ latitude: 40.4, longitude: 49.8, accuracy: 10, speed, isMoving: false, recordedAt: at(0) }), String(speed))
        .toBe(moving ? "MOVING" : "STILL")
      if (speed != null) expect(listed(speed), String(speed)).toBe(moving ? "MOVING" : "STILL")
    }
    expect(listed(null)).toBe("UNKNOWN")
  })
})

describe("the live status of an employee", () => {
  it("stays «Стоит» while his standing phone's GPS jitters by a few metres at one or two km/h", () => {
    const jitter = [1.4, 2.4, 1.9, 2.4, 1.1, 2.2]
    const samples = jitter.map((speed, index) => ({
      latitude: north(index % 2 === 0 ? 6 : -7), longitude: 49.8671, recordedAt: at(index * 30), isMoving: mtmSpeedMoving(speed), speed,
    }))
    expect(samples.some((sample) => sample.isMoving)).toBe(false)
    expect(isMtmAgentMoving({ now: at(150), samples })).toBe(false)
  })

  it("says «В пути» once he walks at three km/h — and a slower walk still shows by the distance", () => {
    const walk = [3.4, 3.1, 3.6].map((speed, index) => ({
      latitude: north(index * 28), longitude: 49.8671, recordedAt: at(index * 30), isMoving: mtmSpeedMoving(speed), speed,
    }))
    expect(isMtmAgentMoving({ now: at(60), samples: walk })).toBe(true)
    // At 2 km/h the phone says «standing», but a minute and a half of it is sixty metres.
    const slow = [2.1, 2.2, 2.0, 2.3].map((speed, index) => ({
      latitude: north(index * 17), longitude: 49.8671, recordedAt: at(index * 30), isMoving: mtmSpeedMoving(speed), speed,
    }))
    expect(slow.some((sample) => sample.isMoving)).toBe(false)
    expect(isMtmAgentMoving({ now: at(90), samples: slow })).toBe(true)
  })
})
