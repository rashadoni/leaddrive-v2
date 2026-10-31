/**
 * «Проиграть день» by the clock (owner, 2026-11-01, of the mockup): the
 * marker is where he was at that minute, a stop lasts as long as it lasted,
 * the line along the streets stays and is cut at the moment, and nothing is
 * drawn across a break.
 */
import { describe, expect, it } from "vitest"

import {
  historyReplayCuts,
  historyReplayFrame,
  historyReplayIndex,
  historyReplaySkipStill,
  modeRuns,
  readHistoryMovement,
  timeRoadTrack,
} from "@/lib/mtm/history-replay"
import type { MtmMovementFix } from "@/lib/mtm/movement-mode"

const BAKU = { latitude: 40.4093, longitude: 49.8671 }
const M_LAT = 111_320
const M_LON = M_LAT * Math.cos((BAKU.latitude * Math.PI) / 180)
const T0 = Date.parse("2026-11-01T09:00:00Z")
const iso = (seconds: number) => new Date(T0 + seconds * 1000).toISOString()

function fix(seconds: number, east: number, speed: number | null): MtmMovementFix {
  return { latitude: BAKU.latitude, longitude: BAKU.longitude + east / M_LON, recordedAt: iso(seconds), speed, heading: null }
}

/** 09:00 drive 5 min east at 36 km/h (10 m/s); stand 10 min; break 09:16–09:46; walk 5 min. */
function day() {
  const points: MtmMovementFix[] = []
  for (let step = 0; step <= 10; step += 1) points.push(fix(step * 30, step * 300, 36))
  for (let step = 1; step <= 20; step += 1) points.push(fix(300 + step * 30, 3000, 0))
  for (let step = 0; step <= 10; step += 1) points.push(fix(46 * 60 + step * 30, 3000 + step * 40, 5))
  const gaps = [{ startedAt: iso(900), endedAt: iso(46 * 60), reason: "WORKDAY_PAUSED" as const }]
  const cuts = historyReplayCuts(points, gaps)
  return { points, gaps, cuts, reading: readHistoryMovement(points, cuts) }
}

describe("the replay holds a moment of the day", () => {
  it("finds the last fix at or before a moment", () => {
    const { points } = day()
    expect(historyReplayIndex(points, T0 - 1000)).toBe(0)
    expect(historyReplayIndex(points, T0 + 45_000)).toBe(1)
    expect(historyReplayIndex(points, T0 + 10 * 3600_000)).toBe(points.length - 1)
  })

  it("puts him between two fixes while he drives, heading the way he went", () => {
    const { points, cuts, reading } = day()
    const frame = historyReplayFrame(points, reading, cuts, T0 + 45_000)!
    expect(frame.mode).toBe("DRIVE")
    expect(frame.index).toBe(1)
    // 45 s at 10 m/s.
    expect((frame.longitude - BAKU.longitude) * M_LON).toBeCloseTo(450, 0)
    expect(Math.round(frame.heading!)).toBe(90)
  })

  it("stands still at the client for as long as he stood there", () => {
    const { points, cuts, reading } = day()
    for (const minute of [6, 10, 14]) {
      const frame = historyReplayFrame(points, reading, cuts, T0 + minute * 60_000)!
      expect(frame.mode, `${minute}`).toBe("STAY")
      expect(frame.heading).toBeNull()
    }
  })

  it("waits out a break at the point he left, and draws nothing across it", () => {
    const { points, cuts, reading } = day()
    expect(cuts.filter(Boolean)).toEqual(["BREAK"])
    const frame = historyReplayFrame(points, reading, cuts, T0 + 30 * 60_000)!
    expect(frame.mode).toBe("BREAK")
    expect((frame.longitude - BAKU.longitude) * M_LON).toBeCloseTo(3000, 0)
    // The run before the break and the walk after it are separate trips.
    expect(reading.trips.map((trip) => trip.mode)).toEqual(["DRIVE", "WALK"])
  })

  it("skips standing and the break when asked, and leaves a moving moment alone", () => {
    const { points, cuts, reading } = day()
    const moving = T0 + 45_000
    expect(historyReplaySkipStill(points, reading, cuts, moving)).toBe(moving)
    const skipped = historyReplaySkipStill(points, reading, cuts, T0 + 8 * 60_000)
    // Past the rest of the stop and the break, to his first fix after it.
    expect(skipped).toBe(T0 + 46 * 60_000)
    const afterBreak = historyReplaySkipStill(points, reading, cuts, T0 + 30 * 60_000)
    expect(afterBreak).toBe(T0 + 46 * 60_000)
  })
})

describe("the line up to the moment", () => {
  it("is cut at the employee and coloured by the way he moved", () => {
    const { points, cuts, reading } = day()
    const raw = points.map((point, fixIndex) => ({ latitude: point.latitude, longitude: point.longitude, fixIndex }))
    const frame = historyReplayFrame(points, reading, cuts, T0 + 45_000)!
    const runs = modeRuns(raw, reading.modes, frame)
    expect(runs.map((run) => run.mode)).toEqual(["DRIVE"])
    expect(runs[0].path.at(-1)).toEqual([frame.latitude, frame.longitude])

    const whole = modeRuns(raw, reading.modes)
    expect(whole.map((run) => run.mode)).toEqual(["DRIVE", "STAY", "WALK"])
    // Where the mode changes, the place belongs to both pieces.
    expect(whole[0].path.at(-1)).toEqual(whole[1].path[0])
  })

  it("times the line along the streets by the nearest fix, in order", () => {
    const { points } = day()
    const road: Array<[number, number]> = [0, 140, 310, 2990, 3010, 3390].map((east) => [BAKU.latitude + 4 / M_LAT, BAKU.longitude + east / M_LON])
    const timed = timeRoadTrack([road], points)[0]
    expect(timed.map((vertex) => vertex.fixIndex).slice(0, 3)).toEqual([0, 0, 1])
    // Indices never go back, even where the walk passes the parking place again.
    const indices = timed.map((vertex) => vertex.fixIndex)
    expect([...indices].sort((a, b) => a - b)).toEqual(indices)
  })
})
