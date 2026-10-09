/**
 * «Стоит N минут» on the live map (owner, 2026-10-09, of the tracking product
 * shown to him as the model: «бери почти всё, чего у нас нет» — there every
 * object says how long it has been standing).
 *
 * The rules of the anchor kept with the latest position of each employee:
 * what a GPS point does to «where and when the current stop began».
 */
import { describe, expect, it, vi } from "vitest"

vi.mock("@/lib/prisma", () => ({ prisma: {} }))

import { MTM_SETTING_DEFAULTS } from "@/lib/mtm-settings"
import { MTM_STOPPED_RADIUS_METERS } from "@/lib/mtm/live-field-status"
import {
  MTM_STATIONARY_MAX_ACCURACY_METERS,
  MTM_STATIONARY_MAX_SILENCE_MS,
  MTM_STATIONARY_NO_ANCHOR,
  classifyMtmStationaryPoint,
  nextMtmStationaryAnchor,
  shownMtmStationarySince,
  type MtmStationaryPoint,
  type MtmStationaryPrevious,
} from "@/lib/mtm/stationary-anchor"

const T0 = Date.parse("2026-10-09T08:00:00.000Z")
const at = (minutes: number, extraMs = 0) => new Date(T0 + minutes * 60_000 + extraMs)
/** One degree of latitude is about 111.2 km: this many metres north of the place. */
const north = (meters: number) => 40.4 + meters / 111_195
const point = (minutes: number, over: Partial<MtmStationaryPoint> = {}): MtmStationaryPoint =>
  ({ latitude: 40.4, longitude: 49.85, accuracy: 10, speed: 0, isMoving: false, recordedAt: at(minutes), ...over })
/** The row as the writer leaves it: the anchor decided for `last`, with `last`'s own time. */
const rowAfter = (previous: MtmStationaryPrevious | null, last: MtmStationaryPoint): MtmStationaryPrevious => {
  const next = nextMtmStationaryAnchor(previous, last)
  const anchor = next === "KEEP" ? (previous ?? MTM_STATIONARY_NO_ANCHOR) : next
  return { recordedAt: last.recordedAt, stationarySince: anchor.stationarySince, stationaryLatitude: anchor.stationaryLatitude, stationaryLongitude: anchor.stationaryLongitude }
}
const replay = (points: MtmStationaryPoint[]) => points.reduce<MtmStationaryPrevious | null>((row, next) => rowAfter(row, next), null)

describe("what a GPS point does to the anchor of the current stop", () => {
  it("the first still point starts the stop, there and then", () => {
    expect(nextMtmStationaryAnchor(null, point(0))).toEqual({ stationarySince: at(0), stationaryLatitude: 40.4, stationaryLongitude: 49.85 })
    // A row written before the anchor existed has none: the same.
    const before = { recordedAt: at(-1), ...MTM_STATIONARY_NO_ANCHOR }
    expect(nextMtmStationaryAnchor(before, point(0))).toMatchObject({ stationarySince: at(0) })
  })

  it("an hour of still points keeps the moment the stop began", () => {
    const row = replay(Array.from({ length: 61 }, (_unused, minute) => point(minute, { latitude: north(minute % 2 ? 6 : -4) })))
    expect(row?.stationarySince).toEqual(at(0))
    expect(row?.recordedAt).toEqual(at(60))
    // KEEP means the three columns are not written — not that the old values are written back.
    expect(nextMtmStationaryAnchor(row, point(61))).toBe("KEEP")
  })

  it("a moving point ends the stop, by the flag or by the speed alone", () => {
    const standing = replay([point(0), point(1)])
    expect(nextMtmStationaryAnchor(standing, point(2, { isMoving: true }))).toEqual(MTM_STATIONARY_NO_ANCHOR)
    expect(nextMtmStationaryAnchor(standing, point(2, { speed: 1.5 }))).toEqual(MTM_STATIONARY_NO_ANCHOR)
    // GPS noise of a metre a second is not movement.
    expect(nextMtmStationaryAnchor(standing, point(2, { speed: 1 }))).toBe("KEEP")
    // He stops again: a new stop, counted from the new moment.
    expect(replay([point(0), point(1), point(2, { isMoving: true }), point(3), point(4)])?.stationarySince).toEqual(at(3))
  })

  it("the stop is measured from where it BEGAN: fifty metres is still the stop, fifty-one is a new one", () => {
    const standing = replay([point(0)])
    expect(MTM_STOPPED_RADIUS_METERS).toBe(50)
    expect(nextMtmStationaryAnchor(standing, point(1, { latitude: north(49) }))).toBe("KEEP")
    expect(nextMtmStationaryAnchor(standing, point(1, { latitude: north(52) }))).toMatchObject({ stationarySince: at(1), stationaryLatitude: north(52) })
    // A slow drift, forty metres a minute and never «moving»: not one long stop.
    const drift = replay([point(0), point(1, { latitude: north(40) }), point(2, { latitude: north(80) }), point(3, { latitude: north(120) })])
    expect(drift?.stationarySince?.getTime()).toBeGreaterThan(at(0).getTime())
  })

  it("a silence longer than ten minutes is not standing: the count starts again", () => {
    expect(MTM_STATIONARY_MAX_SILENCE_MS).toBe(600_000)
    const standing = replay([point(0)])
    expect(nextMtmStationaryAnchor(standing, point(10))).toBe("KEEP")
    expect(nextMtmStationaryAnchor(standing, point(10, { recordedAt: at(10, 1) }))).toMatchObject({ stationarySince: at(10, 1) })
  })

  it("a coordinate too vague to trust says nothing: the anchor is left as it was, kept or missing", () => {
    expect(MTM_STATIONARY_MAX_ACCURACY_METERS).toBe(MTM_SETTING_DEFAULTS.historyMaxAccuracyMeters)
    const standing = replay([point(0)])
    const vague = point(1, { accuracy: 101, latitude: north(900), isMoving: true })
    expect(classifyMtmStationaryPoint(vague)).toBe("UNTRUSTED")
    expect(nextMtmStationaryAnchor(standing, vague)).toBe("KEEP")
    expect(nextMtmStationaryAnchor(null, vague)).toBe("KEEP")
    expect(nextMtmStationaryAnchor(standing, point(1, { accuracy: -1 }))).toBe("KEEP")
    expect(nextMtmStationaryAnchor(standing, point(1, { accuracy: Number.NaN }))).toBe("KEEP")
    // A hundred metres exactly is still trusted, and so is a point that reports no accuracy at all.
    expect(classifyMtmStationaryPoint(point(1, { accuracy: 100 }))).toBe("STILL")
    expect(classifyMtmStationaryPoint(point(1, { accuracy: null }))).toBe("STILL")
  })

  it("the same point sent twice, or an older one, changes nothing", () => {
    const standing = replay([point(0), point(5)])
    expect(nextMtmStationaryAnchor(standing, point(5))).toBe("KEEP")
    expect(nextMtmStationaryAnchor(standing, point(3))).toBe("KEEP")
  })
})

describe("what the live map may show of it", () => {
  const shown = { latitude: 40.4, longitude: 49.85, recordedAt: at(30) }
  const row = { recordedAt: at(30), stationarySince: at(5), stationaryLatitude: 40.4, stationaryLongitude: 49.85 }

  it("the anchor of the very point on the map", () => {
    expect(shownMtmStationarySince(shown, row)).toEqual(at(5))
    // The projection may be a point ahead of the answer being built.
    expect(shownMtmStationarySince(shown, { ...row, recordedAt: at(31) })).toEqual(at(5))
  })

  it("nothing whenever the two disagree — a missing duration, never a wrong one", () => {
    expect(shownMtmStationarySince(null, row)).toBeNull()
    expect(shownMtmStationarySince(shown, null)).toBeNull()
    expect(shownMtmStationarySince(shown, { ...row, stationarySince: null })).toBeNull()
    expect(shownMtmStationarySince(shown, { ...row, stationaryLatitude: null })).toBeNull()
    // The projection is behind the point on the map.
    expect(shownMtmStationarySince(shown, { ...row, recordedAt: at(29) })).toBeNull()
    // The stop began after the point on the map was recorded.
    expect(shownMtmStationarySince(shown, { ...row, recordedAt: at(40), stationarySince: at(35) })).toBeNull()
    // The map shows him eighty metres from where the anchor says he stands.
    expect(shownMtmStationarySince({ ...shown, latitude: north(80) }, row)).toBeNull()
  })
})
