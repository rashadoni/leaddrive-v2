/**
 * «Стоит N минут» on the live map (owner, 2026-10-09, of the tracking product
 * shown to him as the model: «бери почти всё, чего у нас нет» — there every
 * object says how long it has been standing).
 *
 * The rules of the stop kept with the latest position of each employee: what
 * a GPS point does to «where and when the current stop began, and when it
 * was last confirmed».
 */
import { describe, expect, it, vi } from "vitest"

vi.mock("@/lib/prisma", () => ({ prisma: {} }))

import { MTM_SETTING_DEFAULTS } from "@/lib/mtm-settings"
import { MTM_STOPPED_RADIUS_METERS } from "@/lib/mtm/live-field-status"
import { MATCH_SPLIT_GAP_SECONDS } from "@/lib/mtm/map-matching"
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
const vague = (minutes: number, over: Partial<MtmStationaryPoint> = {}) => point(minutes, { accuracy: 300, ...over })
/** The row as the writer leaves it: the position always advances, the stop takes what the point writes. */
const rowAfter = (previous: MtmStationaryPrevious | null, last: MtmStationaryPoint): MtmStationaryPrevious => ({
  ...(previous ?? MTM_STATIONARY_NO_ANCHOR),
  ...(nextMtmStationaryAnchor(previous, last) ?? {}),
  recordedAt: last.recordedAt,
})
const replay = (points: MtmStationaryPoint[], from: MtmStationaryPrevious | null = null) =>
  points.reduce<MtmStationaryPrevious | null>((row, next) => rowAfter(row, next), from)
const CONFIRMED = (minutes: number, extraMs = 0) => ({ stationaryConfirmedAt: at(minutes, extraMs) })

describe("what a GPS point does to the current stop", () => {
  it("the first still point starts the stop, there and then", () => {
    const started = { stationarySince: at(0), stationaryLatitude: 40.4, stationaryLongitude: 49.85, stationaryConfirmedAt: at(0) }
    expect(nextMtmStationaryAnchor(null, point(0))).toEqual(started)
    // A row written before the anchor existed has none: the same.
    expect(nextMtmStationaryAnchor({ recordedAt: at(-1), ...MTM_STATIONARY_NO_ANCHOR }, point(0))).toEqual(started)
  })

  it("an hour of still points keeps the moment the stop began; each of them only confirms it", () => {
    const row = replay(Array.from({ length: 61 }, (_unused, minute) => point(minute, { latitude: north(minute % 2 ? 6 : -4) })))
    // The place is the first point's, though the last one is ten metres from it.
    expect(row).toMatchObject({ stationarySince: at(0), stationaryLatitude: north(-4), stationaryConfirmedAt: at(60), recordedAt: at(60) })
    // Where and when the stop began are not written back — only the confirmation is.
    expect(nextMtmStationaryAnchor(row, point(61))).toEqual(CONFIRMED(61))
  })

  it("a moving point ends the stop, by the flag or by the speed alone — whatever its accuracy", () => {
    const standing = replay([point(0), point(1)])
    expect(nextMtmStationaryAnchor(standing, point(2, { isMoving: true }))).toEqual(MTM_STATIONARY_NO_ANCHOR)
    expect(nextMtmStationaryAnchor(standing, point(2, { speed: 1.5 }))).toEqual(MTM_STATIONARY_NO_ANCHOR)
    // Ending a stop is the careful direction, and the same point makes the map say «в пути».
    expect(classifyMtmStationaryPoint(vague(2, { speed: 12 }))).toBe("MOVING")
    expect(nextMtmStationaryAnchor(standing, vague(2, { isMoving: true }))).toEqual(MTM_STATIONARY_NO_ANCHOR)
    // GPS noise of a metre a second is not movement.
    expect(nextMtmStationaryAnchor(standing, point(2, { speed: 1 }))).toEqual(CONFIRMED(2))
    // He stops again: a new stop, counted from the new moment.
    expect(replay([point(0), point(1), point(2, { isMoving: true }), point(3), point(4)])).toMatchObject({ stationarySince: at(3), stationaryConfirmedAt: at(4) })
  })

  it("the stop is measured from where it BEGAN: fifty metres is still the stop, fifty-one is a new one", () => {
    const standing = replay([point(0)])
    expect(MTM_STOPPED_RADIUS_METERS).toBe(50)
    expect(nextMtmStationaryAnchor(standing, point(1, { latitude: north(49) }))).toEqual(CONFIRMED(1))
    expect(nextMtmStationaryAnchor(standing, point(1, { latitude: north(52) }))).toMatchObject({ stationarySince: at(1), stationaryLatitude: north(52) })
    // A slow drift, forty metres a minute and never «moving»: each point is
    // within fifty metres of the one before it, and it is still not one long stop.
    const drift = replay([point(0), point(1, { latitude: north(40) }), point(2, { latitude: north(80) }), point(3, { latitude: north(120) })])
    expect(drift).toMatchObject({ stationarySince: at(2), stationaryLatitude: north(80) })
  })

  it("a silence longer than ten minutes is not standing: the count starts again", () => {
    expect(MTM_STATIONARY_MAX_SILENCE_MS).toBe(600_000)
    // The same gap past which a day's track is not joined across a hole.
    expect(MTM_STATIONARY_MAX_SILENCE_MS).toBe(MATCH_SPLIT_GAP_SECONDS * 1000)
    const standing = replay([point(0)])
    expect(nextMtmStationaryAnchor(standing, point(10))).toEqual(CONFIRMED(10))
    expect(nextMtmStationaryAnchor(standing, point(10, { recordedAt: at(10, 1) }))).toMatchObject({ stationarySince: at(10, 1) })
  })

  it("a still coordinate too vague to trust says nothing: the row is left as it was, with a stop or without", () => {
    expect(MTM_STATIONARY_MAX_ACCURACY_METERS).toBe(MTM_SETTING_DEFAULTS.historyMaxAccuracyMeters)
    const standing = replay([point(0)])
    expect(classifyMtmStationaryPoint(vague(1, { latitude: north(900) }))).toBe("UNTRUSTED")
    expect(nextMtmStationaryAnchor(standing, vague(1, { latitude: north(900) }))).toBeNull()
    expect(nextMtmStationaryAnchor(null, vague(1))).toBeNull()
    expect(nextMtmStationaryAnchor(standing, point(1, { accuracy: -1 }))).toBeNull()
    expect(nextMtmStationaryAnchor(standing, point(1, { accuracy: Number.NaN }))).toBeNull()
    // A hundred metres exactly is still trusted, and so is a point that reports no accuracy at all.
    expect(classifyMtmStationaryPoint(point(1, { accuracy: 100 }))).toBe("STILL")
    expect(classifyMtmStationaryPoint(point(1, { accuracy: null }))).toBe("STILL")
  })

  it("vague points do not keep a stop alive: three hours of «somewhere within a kilometre» is three hours nobody knows about", () => {
    // 09:00 a good point at the office; then, every minute for three hours,
    // only vague ones; at 12:00 a good point five metres from the office.
    const morning = replay([point(0)])
    const lunch = replay(Array.from({ length: 179 }, (_unused, index) => vague(index + 1, { latitude: north(5_000) })), morning)
    expect(lunch).toMatchObject({ recordedAt: at(179), stationarySince: at(0), stationaryConfirmedAt: at(0) })
    expect(nextMtmStationaryAnchor(lunch, point(180, { latitude: north(5) }))).toMatchObject({ stationarySince: at(180) })
    // The smallest form of it: one vague point at 9:59 does not stretch the ten minutes.
    const stretched = replay([point(0), vague(9, { recordedAt: at(9, 59_000) })])
    expect(nextMtmStationaryAnchor(stretched, point(10, { recordedAt: at(10, 1) }))).toMatchObject({ stationarySince: at(10, 1) })
  })

  it("a stop a build without the anchor rode over is not believed when the anchor's build comes back", () => {
    // Monday: he stood at the office. The release is rolled back: the older
    // build goes on advancing the position and its time, and knows nothing of
    // the stop. Tuesday the release is back and he stands at the office again.
    const monday = replay([point(0), point(5)])
    const riddenOver: MtmStationaryPrevious = { ...monday!, recordedAt: at(24 * 60 + 3) }
    expect(nextMtmStationaryAnchor(riddenOver, point(24 * 60 + 4))).toMatchObject({ stationarySince: at(24 * 60 + 4) })
  })

  it("the same point sent twice, or an older one, changes nothing that matters", () => {
    const standing = replay([point(0), point(5)])
    expect(nextMtmStationaryAnchor(standing, point(5))).toEqual(CONFIRMED(5))
    expect(nextMtmStationaryAnchor(standing, point(3))).toBeNull()
  })
})

describe("what the live map may show of it", () => {
  const shown = { latitude: 40.4, longitude: 49.85, recordedAt: at(30) }
  const row = { recordedAt: at(30), stationarySince: at(5), stationaryLatitude: 40.4, stationaryLongitude: 49.85, stationaryConfirmedAt: at(30) }
  const now = at(31)

  it("the anchor of the very point on the map", () => {
    expect(shownMtmStationarySince(shown, row, now)).toEqual(at(5))
    // The projection may be a point ahead of the answer being built.
    expect(shownMtmStationarySince(shown, { ...row, recordedAt: at(31), stationaryConfirmedAt: at(31) }, now)).toEqual(at(5))
  })

  it("nothing whenever the two disagree — a missing duration, never a wrong one", () => {
    expect(shownMtmStationarySince(null, row, now)).toBeNull()
    expect(shownMtmStationarySince(shown, null, now)).toBeNull()
    for (const column of ["stationarySince", "stationaryLatitude", "stationaryLongitude", "stationaryConfirmedAt"] as const) {
      expect(shownMtmStationarySince(shown, { ...row, [column]: null }, now), column).toBeNull()
    }
    // The projection is behind the point on the map.
    expect(shownMtmStationarySince(shown, { ...row, recordedAt: at(29) }, now)).toBeNull()
    // The stop began after the point on the map was recorded.
    expect(shownMtmStationarySince(shown, { ...row, recordedAt: at(40), stationarySince: at(35), stationaryConfirmedAt: at(40) }, at(41))).toBeNull()
    // The map shows him eighty metres from where the anchor says he stands.
    expect(shownMtmStationarySince({ ...shown, latitude: north(80) }, row, now)).toBeNull()
  })

  it("nothing across a silence the writer itself would not count as standing", () => {
    // An organization that calls a position fresh for half an hour: the map
    // still says «стоит» for a phone silent for twenty-five minutes.
    expect(shownMtmStationarySince(shown, row, at(40))).toEqual(at(5))
    expect(shownMtmStationarySince(shown, row, at(40, 1))).toBeNull()
    // The map shows a point its own, looser accuracy rule accepts; the stop was last confirmed long before it.
    expect(shownMtmStationarySince(shown, { ...row, stationaryConfirmedAt: at(19) }, now)).toBeNull()
    expect(shownMtmStationarySince(shown, { ...row, stationaryConfirmedAt: at(20) }, at(30))).toEqual(at(5))
  })
})
