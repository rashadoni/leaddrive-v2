import { describe, expect, it } from "vitest"
import {
  classifyGpsFreshness,
  explainMissingLocation,
  isLiveMapAdmissibleLocation,
  liveMapAdmissibleLocationWhere,
  liveMapMaxAccuracyMeters,
  liveMapWorkdayOf,
  liveMapWorkdayRead,
  mapWorkdayState,
} from "@/lib/mtm/live-location"

const NOW = new Date("2026-08-01T12:00:00.000Z")

describe("SWM-12 live location states", () => {
  it.each([
    ["2026-08-01T11:55:00.000Z", "ONLINE"],
    ["2026-08-01T11:54:59.000Z", "DELAYED"],
    ["2026-08-01T11:45:00.000Z", "DELAYED"],
    ["2026-08-01T11:44:59.000Z", "STALE"],
    [null, "NO_LOCATION"],
  ])("classifies %s as %s at exact freshness thresholds", (recordedAt, expected) => {
    expect(classifyGpsFreshness(recordedAt, NOW)).toBe(expected)
  })

  it("keeps GPS freshness independent from workday state", () => {
    expect(mapWorkdayState("STARTED")).toBe("ACTIVE")
    expect(mapWorkdayState("PAUSED")).toBe("PAUSED")
    expect(mapWorkdayState("COMPLETED")).toBe("CLOSED")
    expect(mapWorkdayState(null)).toBe("NOT_STARTED")
  })

  it("explains roster rows that cannot create a marker", () => {
    expect(explainMissingLocation({ hasLocation: false, lastSeenAt: null })).toBe("NO_LOCATION_REPORTED")
    expect(explainMissingLocation({ hasLocation: false, lastSeenAt: NOW })).toBe("NO_LOCATION_REPORTED")
    expect(explainMissingLocation({ hasLocation: false, lastSeenAt: null, permissionState: "DENIED" })).toBe("PERMISSION_NOT_GRANTED")
    expect(explainMissingLocation({ hasLocation: true, lastSeenAt: null })).toBe("AVAILABLE")
  })
})

// The managers' roster and the public answer of a «ссылка на местоположение»
// read an employee's point and shift through these, so that an outsider is
// never shown what the managers' own map reads differently. What the roster
// asks the database with them is pinned in api-mtm-locations.test.ts; what the
// public answer does with them, in api-mtm-location-share-public.test.ts.
describe("what the live roster reads of an employee", () => {
  it("holds the organization's accuracy bound between five metres and a kilometre", () => {
    expect([0, 1, 5, 100, 1_000, 5_000].map(liveMapMaxAccuracyMeters)).toEqual([5, 5, 5, 100, 1_000, 1_000])
  })

  it("asks for points on the globe that are exact enough, or carry no accuracy at all", () => {
    expect(liveMapAdmissibleLocationWhere(100)).toEqual({
      latitude: { gte: -90, lte: 90 },
      longitude: { gte: -180, lte: 180 },
      OR: [{ accuracy: null }, { accuracy: { gte: 0, lte: 100 } }],
    })
  })

  it("asks a row already read the very same thing — a legacy row may hold a number that is not one", () => {
    const row = { latitude: 40.4, longitude: 49.85, accuracy: 100 as number | null }
    expect(isLiveMapAdmissibleLocation(row, 100)).toBe(true)
    expect(isLiveMapAdmissibleLocation({ ...row, accuracy: null }, 100)).toBe(true)
    expect(isLiveMapAdmissibleLocation({ ...row, accuracy: 0 }, 100)).toBe(true)
    for (const [what, refused] of [
      ["vaguer than the bound", { ...row, accuracy: 100.5 }],
      ["a negative accuracy", { ...row, accuracy: -1 }],
      ["an accuracy that is not a number", { ...row, accuracy: Number.NaN }],
      ["a latitude off the globe", { ...row, latitude: 90.01 }],
      ["a latitude off the globe the other way", { ...row, latitude: -90.01 }],
      ["a longitude off the globe", { ...row, longitude: 180.01 }],
      ["a latitude that is not a number", { ...row, latitude: Number.NaN }],
      ["a longitude that is not a number", { ...row, longitude: Number.POSITIVE_INFINITY }],
    ] as const) {
      expect(isLiveMapAdmissibleLocation(refused, 100), what).toBe(false)
    }
    // The poles and the date line are on the globe.
    expect(isLiveMapAdmissibleLocation({ latitude: -90, longitude: 180, accuracy: null }, 5)).toBe(true)
  })

  const TODAY = new Date("2026-08-01T00:00:00.000Z")
  const YESTERDAY = new Date("2026-07-31T00:00:00.000Z")

  it("reads the open shift whatever day it was opened on, and today's — the two newest first", () => {
    expect(liveMapWorkdayRead(TODAY)).toEqual({
      where: { OR: [{ status: { in: ["STARTED", "PAUSED"] } }, { workDate: TODAY }] },
      take: 2,
      orderBy: [{ startedAt: "desc" }, { workDate: "desc" }],
    })
    // A fresh object each time: one caller narrowing its own copy changes nobody else's.
    expect(liveMapWorkdayRead(TODAY)).not.toBe(liveMapWorkdayRead(TODAY))
  })

  it("takes the open shift for the one he is in, and today's row when none is open", () => {
    const started = { status: "STARTED", workDate: TODAY }
    const paused = { status: "PAUSED", workDate: TODAY }
    const closedToday = { status: "COMPLETED", workDate: TODAY }
    const leftOpen = { status: "STARTED", workDate: YESTERDAY }
    const closedYesterday = { status: "COMPLETED", workDate: YESTERDAY }

    expect(liveMapWorkdayOf([started], TODAY)).toEqual({ active: started, effective: started })
    expect(liveMapWorkdayOf([paused], TODAY)).toEqual({ active: paused, effective: paused })
    expect(liveMapWorkdayOf([closedToday], TODAY)).toEqual({ active: undefined, effective: closedToday })
    expect(liveMapWorkdayOf([], TODAY)).toEqual({ active: undefined, effective: undefined })
    // A shift left open since yesterday is still the shift he is in — beside
    // today's closed row too. Whether to call it today's is the caller's to say.
    expect(liveMapWorkdayOf([closedToday, leftOpen], TODAY)).toEqual({ active: leftOpen, effective: leftOpen })
    // A closed day that is not today's says nothing about now.
    expect(liveMapWorkdayOf([closedYesterday], TODAY)).toEqual({ active: undefined, effective: undefined })
  })
})
