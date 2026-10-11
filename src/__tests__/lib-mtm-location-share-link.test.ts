/**
 * «Ссылка на местоположение» — the rules of a link (src/lib/mtm/location-share-link.ts).
 *
 * A link shows a named person's position to somebody who has no account. So
 * every rule here is one that keeps a stranger from seeing more than «где он
 * сейчас, пока он на смене»: how long a link lives, when it is alive, and —
 * most of this file — when a coordinate may be shown at all. The public route
 * (part of the same feature) calls locationShareLinkPositionFor with rows it
 * read; what it answers is decided here.
 *
 * Times are written in UTC and read in Asia/Baku (UTC+4, no summer time), the
 * zone of the organizations that use the product: 08:00Z is noon in Baku, and
 * the organization's midnight is 20:00Z.
 */
import { afterEach, describe, expect, it, vi } from "vitest"
import { generateOneTimeToken } from "@/lib/one-time-token"
import { GPS_FRESHNESS, liveMapMaxAccuracyMeters } from "@/lib/mtm/live-location"
import { MTM_SETTING_DEFAULTS } from "@/lib/mtm-settings"
import { addDateKeyDays, currentDateKey, localDateKeyToUtc } from "@/lib/mtm/mobile-week"
import { isDuringMtmWorkdayPause, mtmWorkdayPauses, type MtmWorkdayPause } from "@/lib/mtm/workday-pauses"
import {
  LOCATION_SHARE_LINK_ALIVE_LIMIT,
  LOCATION_SHARE_LINK_DURATIONS,
  LOCATION_SHARE_LINK_MAX_AGE_SECONDS,
  buildLocationShareLinkUrl,
  isLocationShareLinkAlive,
  isLocationShareLinkEndOfDay,
  isLocationShareLinkToken,
  locationShareLinkAliveWhere,
  locationShareLinkExpiresAt,
  locationShareLinkLocale,
  locationShareLinkMaxAccuracyMeters,
  locationShareLinkMaxAgeSeconds,
  locationShareLinkPointsSince,
  locationShareLinkPositionFor,
  locationShareLinkShiftStartedAt,
  locationShareLinkTimezone,
  locationShareLinkTodayStartedAt,
  locationShareLinkTodayWorkDate,
  type LocationShareLinkCandidate,
  type LocationShareLinkThresholds,
  type LocationShareLinkWorkday,
} from "@/lib/mtm/location-share-link"

const BAKU = "Asia/Baku"
const at = (iso: string) => new Date(iso)
const SECOND = 1000
const MINUTE = 60 * SECOND

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("how long a link lives", () => {
  it("offers exactly the card's three buttons", () => {
    expect(LOCATION_SHARE_LINK_DURATIONS).toEqual(["1h", "4h", "day"])
  })

  it("an hour is an hour, four hours are four hours, and «до конца дня» is the organization's midnight", () => {
    const noon = at("2026-10-10T08:00:00.000Z")
    expect(locationShareLinkExpiresAt("1h", noon, BAKU)).toEqual(at("2026-10-10T09:00:00.000Z"))
    expect(locationShareLinkExpiresAt("4h", noon, BAKU)).toEqual(at("2026-10-10T12:00:00.000Z"))
    // Midnight in Baku, not in UTC: four hours before the UTC date changes.
    expect(locationShareLinkExpiresAt("day", noon, BAKU)).toEqual(at("2026-10-10T20:00:00.000Z"))
  })

  it("never lets a link outlive the organization's day: «на 4 часа» at 22:30 ends at midnight", () => {
    const midnight = at("2026-10-10T20:00:00.000Z")
    expect(locationShareLinkExpiresAt("4h", at("2026-10-10T18:30:00.000Z"), BAKU)).toEqual(midnight)
    expect(locationShareLinkExpiresAt("1h", at("2026-10-10T19:30:00.000Z"), BAKU)).toEqual(midnight)
    // A minute earlier than «an hour before midnight» the hour still fits whole.
    expect(locationShareLinkExpiresAt("1h", at("2026-10-10T18:59:00.000Z"), BAKU)).toEqual(at("2026-10-10T19:59:00.000Z"))
    expect(locationShareLinkExpiresAt("4h", at("2026-10-10T16:00:00.000Z"), BAKU)).toEqual(midnight)
  })

  it("made at the first moment of a day belongs to that day", () => {
    const firstMoment = at("2026-10-10T20:00:00.000Z")
    expect(locationShareLinkExpiresAt("day", firstMoment, BAKU)).toEqual(at("2026-10-11T20:00:00.000Z"))
    expect(locationShareLinkExpiresAt("1h", firstMoment, BAKU)).toEqual(at("2026-10-10T21:00:00.000Z"))
  })

  it("always ends after it was made, whenever that was — the table refuses a link that does not", () => {
    for (const zone of [BAKU, "UTC", "America/New_York", "Pacific/Kiritimati"]) {
      for (let minute = 0; minute < 24 * 60; minute += 7) {
        const now = new Date(Date.parse("2026-10-10T00:00:00.000Z") + minute * MINUTE + 999)
        for (const duration of LOCATION_SHARE_LINK_DURATIONS) {
          const expiresAt = locationShareLinkExpiresAt(duration, now, zone)
          expect(expiresAt.getTime(), `${zone} ${now.toISOString()} ${duration}`).toBeGreaterThan(now.getTime())
          expect(expiresAt.getTime() - now.getTime(), `${zone} ${now.toISOString()} ${duration}`).toBeLessThanOrEqual(24 * 60 * MINUTE)
        }
      }
    }
  })

  it("reads the day in UTC when the stored zone is not a zone", () => {
    expect(locationShareLinkTimezone("Mars/Olympus")).toBe("UTC")
    expect(locationShareLinkTimezone(undefined)).toBe("UTC")
    expect(locationShareLinkTimezone(BAKU)).toBe(BAKU)
    const noon = at("2026-10-10T08:00:00.000Z")
    expect(locationShareLinkExpiresAt("day", noon, "Mars/Olympus")).toEqual(at("2026-10-11T00:00:00.000Z"))
    expect(locationShareLinkExpiresAt("4h", at("2026-10-10T22:00:00.000Z"), "")).toEqual(at("2026-10-11T00:00:00.000Z"))
  })

  it("finds midnight on the night the clocks go back", () => {
    // Berlin, 25 October 2026: a day of twenty-five hours. 00:30 local is 22:30Z of the day before.
    expect(locationShareLinkExpiresAt("day", at("2026-10-24T22:30:00.000Z"), "Europe/Berlin")).toEqual(at("2026-10-25T23:00:00.000Z"))
  })

  // Where the clocks are put forward AT midnight the night has no 00:00: the
  // new day begins at 01:00. The plain conversion lands an hour short — 23:00
  // of the evening before — so a link made between 23:00 and midnight would
  // end before it was made; the table's CHECK refuses that row, and all three
  // buttons answered «не удалось» for an hour.
  describe("on the night a zone has no midnight", () => {
    const nights: Array<[string, string, string]> = [
      // zone, 23:30 local of the last evening on the old time, the first moment of the new day (01:00 local)
      ["America/Santiago", "2026-09-06T03:30:00.000Z", "2026-09-06T04:00:00.000Z"],
      ["America/Havana", "2026-03-08T04:30:00.000Z", "2026-03-08T05:00:00.000Z"],
      ["Atlantic/Azores", "2026-03-29T00:30:00.000Z", "2026-03-29T01:00:00.000Z"],
    ]

    it.each(nights)("%s: «до конца дня» ends at the first moment of the next day, and a link is made — not refused", (zone, evening, newDay) => {
      const now = at(evening)
      // The premise: the plain conversion of «tomorrow 00:00» is still this evening, and before `now`.
      const plain = localDateKeyToUtc(addDateKeyDays(currentDateKey(now, zone), 1), zone)
      expect(plain.getTime()).toBeLessThan(now.getTime())
      expect(currentDateKey(plain, zone)).toBe(currentDateKey(now, zone))

      const midnight = locationShareLinkExpiresAt("day", now, zone)
      expect(midnight).toEqual(at(newDay))
      // It IS the first moment of the next day: a millisecond earlier the calendar still says today.
      expect(currentDateKey(midnight, zone)).toBe(addDateKeyDays(currentDateKey(now, zone), 1))
      expect(currentDateKey(new Date(midnight.getTime() - 1), zone)).toBe(currentDateKey(now, zone))
      // Half an hour is left of the day, so every button gives half an hour.
      for (const duration of LOCATION_SHARE_LINK_DURATIONS) {
        expect(locationShareLinkExpiresAt(duration, now, zone), duration).toEqual(at(newDay))
      }
    })

    it.each(nights)("%s: all through that night a link ends after it was made and within the day", (zone, evening) => {
      // Three hours either side of 23:30, every seven minutes.
      for (let minute = -180; minute <= 180; minute += 7) {
        const now = new Date(Date.parse(evening) + minute * MINUTE + 999)
        for (const duration of LOCATION_SHARE_LINK_DURATIONS) {
          const expiresAt = locationShareLinkExpiresAt(duration, now, zone)
          const said = `${zone} ${now.toISOString()} ${duration}`
          expect(expiresAt.getTime(), said).toBeGreaterThan(now.getTime())
          // Never past the day it was made in: the last millisecond before it ends is still that day.
          expect(currentDateKey(new Date(expiresAt.getTime() - 1), zone), said).toBe(currentDateKey(now, zone))
        }
      }
    })

    it("changes nothing where midnight exists: Baku, UTC, Berlin and New York answer as the plain conversion does", () => {
      const HOUR = 60 * MINUTE
      const moments: number[] = []
      // Through all of 2026, about every three days — a step that walks through every hour of the day…
      for (let moment = Date.parse("2026-01-01T00:00:00.000Z"); moment < Date.parse("2027-01-01T00:00:00.000Z"); moment += 73 * HOUR + 7 * MINUTE) moments.push(moment)
      // …and, every two hours, the day and a half either side of each clock change of Berlin and New York.
      for (const change of ["2026-03-08T07:00:00.000Z", "2026-03-29T01:00:00.000Z", "2026-10-25T01:00:00.000Z", "2026-11-01T06:00:00.000Z"]) {
        for (let hour = -36; hour <= 36; hour += 2) moments.push(Date.parse(change) + hour * HOUR + 13 * MINUTE)
      }
      for (const zone of [BAKU, "UTC", "Europe/Berlin", "America/New_York"]) {
        for (const moment of moments) {
          const now = new Date(moment)
          const plain = localDateKeyToUtc(addDateKeyDays(currentDateKey(now, zone), 1), zone)
          expect(locationShareLinkExpiresAt("day", now, zone), `${zone} ${now.toISOString()}`).toEqual(plain)
        }
      }
      expect(moments.length).toBeGreaterThan(250)
    })
  })

  // Both screens say «до конца дня» in words where a link ends with the
  // organization's day: as a clock that moment reads «до 00:00».
  describe("whether a moment is the end of the organization's day", () => {
    it("is yes for the moment «до конца дня» ends at — and for no other, a millisecond either side", () => {
      for (const [zone, now] of [
        [BAKU, "2026-10-10T08:00:00.000Z"], ["UTC", "2026-10-10T08:00:00.000Z"], ["Europe/Berlin", "2026-10-24T22:30:00.000Z"],
        ["America/New_York", "2026-11-01T03:00:00.000Z"], ["Asia/Kolkata", "2026-10-10T08:00:00.000Z"], ["Mars/Olympus", "2026-10-10T08:00:00.000Z"],
      ] as const) {
        const end = locationShareLinkExpiresAt("day", at(now), zone)
        expect(isLocationShareLinkEndOfDay(end, zone), zone).toBe(true)
        expect(isLocationShareLinkEndOfDay(new Date(end.getTime() - 1), zone), zone).toBe(false)
        expect(isLocationShareLinkEndOfDay(new Date(end.getTime() + 1), zone), zone).toBe(false)
        expect(isLocationShareLinkEndOfDay(new Date(end.getTime() - MINUTE), zone), zone).toBe(false)
        expect(isLocationShareLinkEndOfDay(new Date(end.getTime() + 60 * MINUTE), zone), zone).toBe(false)
      }
    })

    it("is yes for a «на 4 часа» that was cut at midnight, and no for one that was not", () => {
      expect(isLocationShareLinkEndOfDay(locationShareLinkExpiresAt("4h", at("2026-10-10T18:30:00.000Z"), BAKU), BAKU)).toBe(true)
      expect(isLocationShareLinkEndOfDay(locationShareLinkExpiresAt("1h", at("2026-10-10T19:30:00.000Z"), BAKU), BAKU)).toBe(true)
      expect(isLocationShareLinkEndOfDay(locationShareLinkExpiresAt("4h", at("2026-10-10T08:00:00.000Z"), BAKU), BAKU)).toBe(false)
      expect(isLocationShareLinkEndOfDay(locationShareLinkExpiresAt("1h", at("2026-10-10T18:59:00.000Z"), BAKU), BAKU)).toBe(false)
    })

    it("is judged in the organization's zone: Baku's midnight is eight in the evening by UTC, and an ordinary hour in Warsaw", () => {
      const bakuMidnight = at("2026-10-10T20:00:00.000Z")
      expect(isLocationShareLinkEndOfDay(bakuMidnight, BAKU)).toBe(true)
      expect(isLocationShareLinkEndOfDay(bakuMidnight, "UTC")).toBe(false)
      expect(isLocationShareLinkEndOfDay(bakuMidnight, "Europe/Warsaw")).toBe(false)
      // A zone that is none is read as UTC, as the expiry itself is counted.
      expect(isLocationShareLinkEndOfDay(at("2026-10-11T00:00:00.000Z"), "Mars/Olympus")).toBe(true)
      expect(isLocationShareLinkEndOfDay(bakuMidnight, "")).toBe(false)
    })

    it("agrees with the expiry on the night a zone has no midnight: the day ends at 01:00 there, and that is «конец дня»", () => {
      for (const [zone, evening, newDay] of [
        ["America/Santiago", "2026-09-06T03:30:00.000Z", "2026-09-06T04:00:00.000Z"],
        ["America/Havana", "2026-03-08T04:30:00.000Z", "2026-03-08T05:00:00.000Z"],
        ["Atlantic/Azores", "2026-03-29T00:30:00.000Z", "2026-03-29T01:00:00.000Z"],
      ] as const) {
        expect(locationShareLinkExpiresAt("day", at(evening), zone)).toEqual(at(newDay))
        expect(isLocationShareLinkEndOfDay(at(newDay), zone), zone).toBe(true)
        // The hour the plain conversion lands on — 23:00 of the evening before — is not the end of anything.
        expect(isLocationShareLinkEndOfDay(new Date(Date.parse(newDay) - 60 * MINUTE), zone), zone).toBe(false)
      }
    })

    it("is no for a moment that is none", () => {
      expect(isLocationShareLinkEndOfDay(new Date(Number.NaN), BAKU)).toBe(false)
      expect(isLocationShareLinkEndOfDay(null as unknown as Date, BAKU)).toBe(false)
    })
  })

  describe("where the organization's today began", () => {
    it("is its last midnight, in its own zone — UTC when the stored zone is not one", () => {
      expect(locationShareLinkTodayStartedAt(at("2026-10-10T08:00:00.000Z"), BAKU)).toEqual(at("2026-10-09T20:00:00.000Z"))
      // The first moment of a day belongs to that day; the millisecond before it to the one before.
      expect(locationShareLinkTodayStartedAt(at("2026-10-09T20:00:00.000Z"), BAKU)).toEqual(at("2026-10-09T20:00:00.000Z"))
      expect(locationShareLinkTodayStartedAt(at("2026-10-09T19:59:59.999Z"), BAKU)).toEqual(at("2026-10-08T20:00:00.000Z"))
      expect(locationShareLinkTodayStartedAt(at("2026-10-10T08:00:00.000Z"), "Mars/Olympus")).toEqual(at("2026-10-10T00:00:00.000Z"))
    })

    it("is where yesterday's «до конца дня» ended — a link of yesterday is never «today's», also on a day that begins at 01:00", () => {
      const HOUR = 60 * MINUTE
      const year: number[] = []
      for (let moment = Date.parse("2026-01-01T00:00:00.000Z"); moment < Date.parse("2027-01-01T00:00:00.000Z"); moment += 211 * HOUR + 13 * MINUTE) year.push(moment)
      const cases: Array<[string, number[]]> = [
        [BAKU, year], ["UTC", year], ["Europe/Berlin", year],
        // The day without a midnight: an hour into it, at noon and in its last minute.
        ["America/Santiago", ["2026-09-06T05:00:00.000Z", "2026-09-06T15:00:00.000Z", "2026-09-07T02:59:00.000Z"].map((iso) => Date.parse(iso))],
        ["America/Havana", ["2026-03-08T06:00:00.000Z", "2026-03-08T16:00:00.000Z", "2026-03-09T03:59:00.000Z"].map((iso) => Date.parse(iso))],
        ["Atlantic/Azores", ["2026-03-29T02:00:00.000Z", "2026-03-29T12:00:00.000Z", "2026-03-29T23:59:00.000Z"].map((iso) => Date.parse(iso))],
      ]
      for (const [zone, moments] of cases) {
        for (const moment of moments) {
          const now = new Date(moment)
          const began = locationShareLinkTodayStartedAt(now, zone)
          const said = `${zone} ${now.toISOString()}`
          expect(began.getTime(), said).toBeLessThanOrEqual(now.getTime())
          expect(currentDateKey(began, zone), said).toBe(currentDateKey(now, zone))
          expect(currentDateKey(new Date(began.getTime() - 1), zone), said).toBe(addDateKeyDays(currentDateKey(now, zone), -1))
          // What a link made in the last moment of yesterday was given as its end.
          expect(locationShareLinkExpiresAt("day", new Date(began.getTime() - 1), zone), said).toEqual(began)
        }
      }
      expect(locationShareLinkTodayStartedAt(at("2026-09-06T15:00:00.000Z"), "America/Santiago")).toEqual(at("2026-09-06T04:00:00.000Z"))
    })
  })
})

describe("when a link is alive", () => {
  const now = at("2026-10-10T08:00:00.000Z")

  it("is alive until it is revoked or its time is up — and at the very moment of expiry it is not", () => {
    expect(isLocationShareLinkAlive({ revokedAt: null, expiresAt: at("2026-10-10T08:00:00.001Z") }, now)).toBe(true)
    expect(isLocationShareLinkAlive({ revokedAt: null, expiresAt: now }, now)).toBe(false)
    expect(isLocationShareLinkAlive({ revokedAt: null, expiresAt: at("2026-10-10T07:59:59.999Z") }, now)).toBe(false)
    expect(isLocationShareLinkAlive({ revokedAt: at("2026-10-10T07:00:00.000Z"), expiresAt: at("2026-10-10T20:00:00.000Z") }, now)).toBe(false)
  })

  it("asks the table for the same thing the predicate says", () => {
    expect(locationShareLinkAliveWhere(now)).toEqual({ revokedAt: null, expiresAt: { gt: now } })
  })

  it("lets an employee have a handful of working links, not a pile", () => {
    expect(LOCATION_SHARE_LINK_ALIVE_LIMIT).toBe(5)
  })
})

describe("the token and the link", () => {
  it("knows its own tokens: 64 lowercase hex characters, as they are issued", () => {
    for (let turn = 0; turn < 5; turn += 1) expect(isLocationShareLinkToken(generateOneTimeToken().token)).toBe(true)
    expect(isLocationShareLinkToken("a".repeat(64))).toBe(true)
  })

  it.each([
    ["one character short", "a".repeat(63)],
    ["one character long", "a".repeat(65)],
    ["upper case", "A".repeat(64)],
    ["not hex", "g".repeat(64)],
    ["a token with a line break after it", `${"a".repeat(64)}\n`],
    ["a token with a path after it", `${"a".repeat(64)}/../x`],
    ["nothing", ""],
    ["not a string", 12345],
    ["null", null],
    ["a list holding a token", ["a".repeat(64)]],
  ])("refuses %s before anything is hashed or looked up", (_what, value) => {
    expect(isLocationShareLinkToken(value)).toBe(false)
  })

  it("is built on the application's own address, with the page's path and the maker's language", () => {
    const token = "c".repeat(64)
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.test/")
    expect(buildLocationShareLinkUrl(token, "az")).toBe(`https://app.example.test/share/location/${token}?lang=az`)
    expect(buildLocationShareLinkUrl(token, "en")).toBe(`https://app.example.test/share/location/${token}?lang=en`)
    expect(buildLocationShareLinkUrl(token, "ru")).toBe(`https://app.example.test/share/location/${token}?lang=ru`)
  })

  it("falls back along the same addresses a closure link uses, and to a path when none is set", () => {
    const token = "d".repeat(64)
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "")
    vi.stubEnv("APP_URL", "")
    vi.stubEnv("NEXTAUTH_URL", "https://auth.example.test")
    expect(buildLocationShareLinkUrl(token, "ru")).toBe(`https://auth.example.test/share/location/${token}?lang=ru`)
    vi.stubEnv("APP_URL", "https://second.example.test")
    expect(buildLocationShareLinkUrl(token, "ru")).toBe(`https://second.example.test/share/location/${token}?lang=ru`)
    vi.stubEnv("APP_URL", "")
    vi.stubEnv("NEXTAUTH_URL", "")
    expect(buildLocationShareLinkUrl(token, "ru")).toBe(`/share/location/${token}?lang=ru`)
  })

  it("speaks one of the product's three languages, Russian when asked for any other", () => {
    expect(["ru", "en", "az"].map(locationShareLinkLocale)).toEqual(["ru", "en", "az"])
    for (const other of ["de", "RU", "", undefined, null, 7, "en-US"]) expect(locationShareLinkLocale(other)).toBe("ru")
    // Whatever reaches the builder, nothing but one of the three is written into a link.
    expect(buildLocationShareLinkUrl("e".repeat(64), "tr&next=//evil.example" as never)).toMatch(/\?lang=ru$/)
  })
})

describe("what an outsider may be shown", () => {
  // Noon in Baku on 10 October; he started at nine and his phone sent a point three minutes ago.
  const NOW = at("2026-10-10T08:00:00.000Z")
  const before = (ms: number) => new Date(NOW.getTime() - ms)
  const TODAY = at("2026-10-10T00:00:00.000Z")
  const YESTERDAY = at("2026-10-09T00:00:00.000Z")
  const TOMORROW = at("2026-10-11T00:00:00.000Z")
  const onShift: LocationShareLinkWorkday = { status: "STARTED", workDate: TODAY, startedAt: at("2026-10-10T05:00:00.000Z") }
  const point = (over: Partial<LocationShareLinkCandidate> = {}): LocationShareLinkCandidate =>
    ({ latitude: 40.4093, longitude: 49.8671, accuracy: 12, recordedAt: before(3 * MINUTE), ...over })
  // The organization's own numbers as they ship: «не в сети» after five minutes, a ten-minute window, a hundred metres.
  const shipped: LocationShareLinkThresholds = {
    offlineThresholdSeconds: MTM_SETTING_DEFAULTS.offlineThresholdSeconds,
    locationWindowMinutes: MTM_SETTING_DEFAULTS.locationWindowMinutes,
    historyMaxAccuracyMeters: MTM_SETTING_DEFAULTS.historyMaxAccuracyMeters,
  }
  // An organization that stretched «свежая» to a whole day, as the settings allow.
  const loosest: LocationShareLinkThresholds = { offlineThresholdSeconds: 86_400, locationWindowMinutes: 1_440, historyMaxAccuracyMeters: 1_000 }
  // No break yet today, unless a case says otherwise.
  const ask = (over: Partial<Parameters<typeof locationShareLinkPositionFor>[0]> = {}) =>
    locationShareLinkPositionFor({ workday: onShift, breaks: [], location: point(), settings: shipped, now: NOW, timezone: BAKU, ...over })
  const UNAVAILABLE = { state: "UNAVAILABLE" }

  it("shows where he is while he is on shift and his phone has just said so — the point and when, and nothing else of the row", () => {
    const row = { ...point(), speed: 14, heading: 270, battery: 0.4, isMoving: true, id: "loc-1", agentId: "agent-1" }
    const shown = ask({ location: row })
    expect(shown).toEqual({ state: "AVAILABLE", latitude: 40.4093, longitude: 49.8671, recordedAt: before(3 * MINUTE) })
    // The accuracy that admitted the point is not a thing to tell a stranger, nor is anything else the phone reported.
    expect(Object.keys(shown).sort()).toEqual(["latitude", "longitude", "recordedAt", "state"])
  })

  it("shows nothing during a break — where a person spends his break is his own", () => {
    expect(ask({ workday: { ...onShift, status: "PAUSED" } })).toEqual(UNAVAILABLE)
    // Also with a point that arrived a moment ago: not every way a point arrives is refused during a break.
    expect(ask({ workday: { ...onShift, status: "PAUSED" }, breaks: [{ from: before(5 * MINUTE), to: null }], location: point({ recordedAt: before(1 * MINUTE) }) }))
      .toEqual(UNAVAILABLE)
  })

  // The break is over and he pressed «продолжить». A point recorded DURING the
  // break can be in the table (the batch ingestion and «поделиться своим
  // местоположением» take one); it is then the newest row, and without this
  // bound a stranger would be shown where he had lunch until the phone
  // reported again.
  describe("after a break", () => {
    // A break of five minutes that ended four minutes ago: every point below
    // is fresh enough to be shown, so what hides it is the break and nothing else.
    const pause: MtmWorkdayPause = { from: before(9 * MINUTE), to: before(4 * MINUTE) }

    it("never shows a point from the break, though the shift is running again and the point is fresh", () => {
      for (const minutesAgo of [8, 6, 4.001]) {
        const location = point({ recordedAt: before(minutesAgo * MINUTE) })
        // The premise: the very same point is shown to a stranger when there was no break.
        expect(ask({ breaks: [], location }), `${minutesAgo} min ago, no break`).toMatchObject({ state: "AVAILABLE" })
        expect(ask({ breaks: [pause], location }), `${minutesAgo} min ago`).toEqual(UNAVAILABLE)
      }
    })

    it("shows the first point after it — the one taken at the very second he resumed included, as GPS ingestion counts it", () => {
      expect(ask({ breaks: [pause], location: point({ recordedAt: before(4 * MINUTE) }) })).toMatchObject({ state: "AVAILABLE", recordedAt: before(4 * MINUTE) })
      expect(ask({ breaks: [pause], location: point({ recordedAt: before(3 * MINUTE) }) })).toMatchObject({ state: "AVAILABLE" })
      // The same boundary the ingestion draws: that instant is work, a millisecond before it is the break.
      expect(isDuringMtmWorkdayPause(before(4 * MINUTE), [pause])).toBe(false)
      expect(isDuringMtmWorkdayPause(before(4 * MINUTE + 1), [pause])).toBe(true)
      expect(ask({ breaks: [pause], location: point({ recordedAt: before(4 * MINUTE + 1) }) })).toEqual(UNAVAILABLE)
    })

    it("does not show a point from BEFORE the break either: the newest thing known of him is then older than his break", () => {
      const location = point({ recordedAt: before(9 * MINUTE + 30 * SECOND) })
      expect(ask({ breaks: [], location })).toMatchObject({ state: "AVAILABLE" })
      expect(ask({ breaks: [pause], location })).toEqual(UNAVAILABLE)
    })

    it("goes by the last of several breaks, in whatever order they are handed over", () => {
      const coffee: MtmWorkdayPause = { from: before(150 * MINUTE), to: before(140 * MINUTE) }
      const smoke: MtmWorkdayPause = { from: before(3 * MINUTE), to: before(2 * MINUTE) }
      for (const breaks of [[coffee, pause, smoke], [smoke, pause, coffee]]) {
        expect(locationShareLinkPointsSince(onShift.startedAt, breaks)).toEqual(before(2 * MINUTE))
        expect(ask({ breaks, location: point({ recordedAt: before(3 * MINUTE + 30 * SECOND) }) })).toEqual(UNAVAILABLE)
        expect(ask({ breaks, location: point({ recordedAt: before(1 * MINUTE) }) })).toMatchObject({ state: "AVAILABLE" })
      }
    })

    it("shows nothing while the shift's own journal says a break is still running, whatever the workday row says", () => {
      const running: MtmWorkdayPause = { from: before(5 * MINUTE), to: null }
      expect(locationShareLinkPointsSince(onShift.startedAt, [running])).toBeNull()
      expect(ask({ breaks: [running], location: point({ recordedAt: before(1 * MINUTE) }) })).toEqual(UNAVAILABLE)
      expect(ask({ breaks: [pause, running], location: point({ recordedAt: before(1 * MINUTE) }) })).toEqual(UNAVAILABLE)
    })

    it("shows nothing when the breaks cannot be vouched for: not read, or a break whose end is not a moment", () => {
      for (const breaks of [null, undefined, "none" as never, [{ from: before(40 * MINUTE), to: new Date("never") }]]) {
        expect(locationShareLinkPointsSince(onShift.startedAt, breaks), JSON.stringify(breaks)).toBeNull()
        expect(ask({ breaks }), JSON.stringify(breaks)).toEqual(UNAVAILABLE)
      }
    })

    it("a break that ends after this moment — a phone whose clock runs ahead — shows nothing until then", () => {
      const ahead: MtmWorkdayPause = { from: before(5 * MINUTE), to: new Date(NOW.getTime() + 2 * MINUTE) }
      expect(ask({ breaks: [ahead], location: point({ recordedAt: before(1 * MINUTE) }) })).toEqual(UNAVAILABLE)
      expect(ask({ breaks: [ahead], location: point({ recordedAt: NOW }) })).toEqual(UNAVAILABLE)
    })

    it("is read from the shift's own events by the reader GPS ingestion uses, a manager's reopening included", () => {
      const journal = [
        { type: "PAUSE", occurredAt: before(9 * MINUTE) },
        { type: "RESUME", occurredAt: before(4 * MINUTE) },
      ]
      expect(locationShareLinkPointsSince(onShift.startedAt, mtmWorkdayPauses(journal))).toEqual(before(4 * MINUTE))
      // Closed an hour ago, reopened by a manager, resumed five minutes ago: the gap in between was not work.
      const reopened = [
        { type: "FINISH", occurredAt: before(60 * MINUTE), appliedAt: before(60 * MINUTE) },
        { type: "REOPEN", occurredAt: before(60 * MINUTE), appliedAt: before(8 * MINUTE) },
        { type: "RESUME", occurredAt: before(5 * MINUTE), appliedAt: before(5 * MINUTE) },
      ]
      expect(locationShareLinkPointsSince(onShift.startedAt, mtmWorkdayPauses(reopened))).toEqual(before(5 * MINUTE))
      // Reopened and not resumed yet: still a break.
      expect(locationShareLinkPointsSince(onShift.startedAt, mtmWorkdayPauses(reopened.slice(0, 2)))).toBeNull()
    })

    it("with no break the points are read from the start of the shift, and off shift from nowhere", () => {
      expect(locationShareLinkPointsSince(onShift.startedAt, [])).toEqual(onShift.startedAt)
      // A break that ended before the shift's recorded start does not move the bound back.
      expect(locationShareLinkPointsSince(before(2 * MINUTE), [pause])).toEqual(before(2 * MINUTE))
      for (const offShift of [null, undefined, new Date("never")]) expect(locationShareLinkPointsSince(offShift, [])).toBeNull()
    })
  })

  it.each([
    ["no shift was started today", null],
    ["the shift is closed", { ...onShift, status: "COMPLETED" }],
    ["the status is one nobody knows", { ...onShift, status: "ACTIVE" }],
  ])("shows nothing when %s, however fresh the point", (_what, workday) => {
    expect(ask({ workday: workday as LocationShareLinkWorkday | null })).toEqual(UNAVAILABLE)
  })

  it("shows nothing for a shift left open since an earlier day — the managers' map keeps it «active», a stranger's screen does not", () => {
    expect(ask({ workday: { status: "STARTED", workDate: YESTERDAY, startedAt: at("2026-10-09T05:00:00.000Z") } })).toEqual(UNAVAILABLE)
    // Nor for a row dated ahead of the organization's calendar.
    expect(ask({ workday: { ...onShift, workDate: TOMORROW } })).toEqual(UNAVAILABLE)
  })

  it("has no answer without a point", () => {
    expect(ask({ location: null })).toEqual(UNAVAILABLE)
    expect(ask({ location: undefined })).toEqual(UNAVAILABLE)
  })

  describe("how old the point may be", () => {
    it("is fifteen minutes at the very most, to the millisecond, whatever the organization calls fresh", () => {
      expect(LOCATION_SHARE_LINK_MAX_AGE_SECONDS).toBe(GPS_FRESHNESS.delayedSeconds)
      expect(LOCATION_SHARE_LINK_MAX_AGE_SECONDS).toBe(15 * 60)
      expect(ask({ settings: loosest, location: point({ recordedAt: before(15 * MINUTE) }) })).toMatchObject({ state: "AVAILABLE" })
      expect(ask({ settings: loosest, location: point({ recordedAt: before(15 * MINUTE + 1) }) })).toEqual(UNAVAILABLE)
      // On the managers' map this organization would still show a point of yesterday evening.
      expect(ask({ settings: loosest, location: point({ recordedAt: before(3 * 60 * MINUTE) }) })).toEqual(UNAVAILABLE)
      expect(locationShareLinkMaxAgeSeconds(loosest)).toBe(900)
    })

    it("is the organization's own threshold where that is stricter: ten minutes as shipped", () => {
      expect(locationShareLinkMaxAgeSeconds(shipped)).toBe(600)
      expect(ask({ location: point({ recordedAt: before(10 * MINUTE) }) })).toMatchObject({ state: "AVAILABLE" })
      expect(ask({ location: point({ recordedAt: before(10 * MINUTE + 1) }) })).toEqual(UNAVAILABLE)
    })

    it("follows an organization that wants «сейчас» to mean a minute", () => {
      const strict = { ...shipped, offlineThresholdSeconds: 60, locationWindowMinutes: 1 }
      expect(locationShareLinkMaxAgeSeconds(strict)).toBe(60)
      expect(ask({ settings: strict, location: point({ recordedAt: before(60 * SECOND) }) })).toMatchObject({ state: "AVAILABLE" })
      expect(ask({ settings: strict, location: point({ recordedAt: before(61 * SECOND) }) })).toEqual(UNAVAILABLE)
      // The map's own «свежая» is the larger of its two numbers, and so is this.
      expect(locationShareLinkMaxAgeSeconds({ ...shipped, offlineThresholdSeconds: 30, locationWindowMinutes: 5 })).toBe(300)
    })

    it("never reads a broken setting as «no limit»", () => {
      for (const broken of [Number.NaN, Number.POSITIVE_INFINITY, -5, 0]) {
        const settings = { ...shipped, offlineThresholdSeconds: broken, locationWindowMinutes: broken }
        expect(locationShareLinkMaxAgeSeconds(settings), String(broken)).toBeLessThanOrEqual(900)
        expect(ask({ settings, location: point({ recordedAt: before(15 * MINUTE + 1) }) }), String(broken)).toEqual(UNAVAILABLE)
      }
    })
  })

  it("shows only a point of THIS shift: one recorded before he started is yesterday's whereabouts", () => {
    const justStarted = { ...onShift, startedAt: before(2 * MINUTE) }
    expect(ask({ workday: justStarted, location: point({ recordedAt: before(2 * MINUTE + 1) }) })).toEqual(UNAVAILABLE)
    expect(ask({ workday: justStarted, location: point({ recordedAt: before(3 * MINUTE) }) })).toEqual(UNAVAILABLE)
    // The point taken as the shift was started is the first one of it.
    expect(ask({ workday: justStarted, location: point({ recordedAt: before(2 * MINUTE) }) })).toMatchObject({ state: "AVAILABLE" })
  })

  it("does not take a point from the future for «сейчас» — a phone whose clock runs ahead waits", () => {
    expect(ask({ location: point({ recordedAt: new Date(NOW.getTime() + 1) }) })).toEqual(UNAVAILABLE)
    expect(ask({ location: point({ recordedAt: new Date(NOW.getTime() + 4 * MINUTE) }) })).toEqual(UNAVAILABLE)
    expect(ask({ location: point({ recordedAt: NOW }) })).toMatchObject({ state: "AVAILABLE", recordedAt: NOW })
  })

  describe("how vague the point may be", () => {
    it("is the bound of the managers' own map: a hundred metres as shipped, or no accuracy reported at all", () => {
      expect(ask({ location: point({ accuracy: 100 }) })).toMatchObject({ state: "AVAILABLE" })
      expect(ask({ location: point({ accuracy: 100.5 }) })).toEqual(UNAVAILABLE)
      expect(ask({ location: point({ accuracy: 2_500 }) })).toEqual(UNAVAILABLE)
      expect(ask({ location: point({ accuracy: null }) })).toMatchObject({ state: "AVAILABLE" })
      expect(ask({ location: point({ accuracy: 0 }) })).toMatchObject({ state: "AVAILABLE" })
    })

    it("refuses an accuracy that is not a measurement", () => {
      for (const accuracy of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
        expect(ask({ location: point({ accuracy }) }), String(accuracy)).toEqual(UNAVAILABLE)
      }
    })

    it("is clamped as the roster clamps it: never looser than a kilometre, never tighter than five metres", () => {
      expect([1, 5, 100, 1_000, 5_000, Number.NaN].map(locationShareLinkMaxAccuracyMeters)).toEqual([5, 5, 100, 1_000, 1_000, 5])
      // Not a second copy of the roster's arithmetic: the roster's own function, for every setting that is a number.
      for (const stored of [0, 1, 4.9, 5, 37, 100, 999, 1_000, 1_001, 50_000]) {
        expect(locationShareLinkMaxAccuracyMeters(stored), String(stored)).toBe(liveMapMaxAccuracyMeters(stored))
      }
      const wide = { ...shipped, historyMaxAccuracyMeters: 5_000 }
      expect(ask({ settings: wide, location: point({ accuracy: 1_000 }) })).toMatchObject({ state: "AVAILABLE" })
      expect(ask({ settings: wide, location: point({ accuracy: 1_001 }) })).toEqual(UNAVAILABLE)
      const narrow = { ...shipped, historyMaxAccuracyMeters: 1 }
      expect(ask({ settings: narrow, location: point({ accuracy: 5 }) })).toMatchObject({ state: "AVAILABLE" })
      expect(ask({ settings: narrow, location: point({ accuracy: 6 }) })).toEqual(UNAVAILABLE)
    })
  })

  it.each([
    ["a latitude off the globe", { latitude: 90.01 }],
    ["a longitude off the globe", { longitude: -180.01 }],
    ["a latitude that is not a number", { latitude: Number.NaN }],
    ["a longitude that is not a number", { longitude: Number.POSITIVE_INFINITY }],
    ["a moment that is not a date", { recordedAt: new Date("never") }],
  ])("shows nothing for %s", (_what, over) => {
    expect(ask({ location: point(over) })).toEqual(UNAVAILABLE)
  })

  it("shows nothing when the shift's own dates cannot be read", () => {
    expect(ask({ workday: { ...onShift, startedAt: new Date("never") } })).toEqual(UNAVAILABLE)
    expect(ask({ workday: { ...onShift, workDate: new Date("never") } })).toEqual(UNAVAILABLE)
    expect(ask({ now: new Date("never") })).toEqual(UNAVAILABLE)
  })

  // The first half of the rule on its own: the public answer asks it before
  // it reads where he is at all, and reads his points from the moment it names.
  describe("when the shift he is in began", () => {
    const began = (workday: LocationShareLinkWorkday | null | undefined, now = NOW, zone = BAKU) => locationShareLinkShiftStartedAt(workday, now, zone)

    it("is the start of today's started workday", () => {
      expect(began(onShift)).toEqual(at("2026-10-10T05:00:00.000Z"))
      // A moment of its own, not the row's object.
      expect(began(onShift)).not.toBe(onShift.startedAt)
    })

    it.each([
      ["there is no workday", null],
      ["there is no workday at all", undefined],
      ["he is on a break", { ...onShift, status: "PAUSED" }],
      ["the day is closed", { ...onShift, status: "COMPLETED" }],
      ["the status is one nobody knows", { ...onShift, status: "started" }],
      ["the shift was left open since yesterday", { ...onShift, workDate: YESTERDAY }],
      ["the row is dated tomorrow", { ...onShift, workDate: TOMORROW }],
      ["its start cannot be read", { ...onShift, startedAt: new Date("never") }],
      ["its date cannot be read", { ...onShift, workDate: new Date("never") }],
    ])("is nothing when %s", (_what, workday) => {
      expect(began(workday as LocationShareLinkWorkday | null | undefined)).toBeNull()
    })

    it("is nothing at a moment that is not one, and follows the organization's calendar and not UTC's", () => {
      expect(began(onShift, new Date("never"))).toBeNull()
      // One o'clock at night in Baku on the 11th: the shift of the 10th is yesterday's there, and still today's by UTC.
      const night = at("2026-10-10T21:00:00.000Z")
      expect(began(onShift, night, BAKU)).toBeNull()
      expect(began(onShift, night, "UTC")).toEqual(at("2026-10-10T05:00:00.000Z"))
    })

    it("is what the rule itself goes by: no point is shown where this says nothing", () => {
      for (const workday of [null, { ...onShift, status: "PAUSED" }, { ...onShift, workDate: YESTERDAY }, onShift]) {
        const shown = ask({ workday }).state === "AVAILABLE"
        expect(shown, JSON.stringify(workday)).toBe(began(workday) !== null)
      }
    })
  })

  describe("which day «today» is", () => {
    // One o'clock at night in Baku on 11 October. In UTC it is still the 10th.
    const NIGHT = at("2026-10-10T21:00:00.000Z")
    const aMinuteAgo = { latitude: 40.4, longitude: 49.85, accuracy: 10, recordedAt: at("2026-10-10T20:59:00.000Z") }
    // He never closed the shift of the 10th; the phone is still sending.
    const forgotten: LocationShareLinkWorkday = { status: "STARTED", workDate: at("2026-10-10T00:00:00.000Z"), startedAt: at("2026-10-10T05:00:00.000Z") }
    // A night shift of the 11th, started half an hour past the organization's midnight.
    const nightShift: LocationShareLinkWorkday = { status: "STARTED", workDate: at("2026-10-11T00:00:00.000Z"), startedAt: at("2026-10-10T20:30:00.000Z") }

    it("is the organization's day, not UTC's: after midnight in Baku yesterday's open shift shows nothing", () => {
      expect(locationShareLinkTodayWorkDate(NIGHT, BAKU)).toEqual(at("2026-10-11T00:00:00.000Z"))
      expect(locationShareLinkPositionFor({ workday: forgotten, breaks: [], location: aMinuteAgo, settings: shipped, now: NIGHT, timezone: BAKU }))
        .toEqual(UNAVAILABLE)
      expect(locationShareLinkPositionFor({ workday: nightShift, breaks: [], location: aMinuteAgo, settings: shipped, now: NIGHT, timezone: BAKU }))
        .toEqual({ state: "AVAILABLE", latitude: 40.4, longitude: 49.85, recordedAt: at("2026-10-10T20:59:00.000Z") })
    })

    it("turns over at the organization's midnight to the minute", () => {
      const lastMinute = at("2026-10-10T19:59:30.000Z")
      const firstMinute = at("2026-10-10T20:00:30.000Z")
      const fresh = (now: Date) => ({ ...aMinuteAgo, recordedAt: new Date(now.getTime() - 20 * SECOND) })
      expect(locationShareLinkPositionFor({ workday: forgotten, breaks: [], location: fresh(lastMinute), settings: shipped, now: lastMinute, timezone: BAKU }))
        .toMatchObject({ state: "AVAILABLE" })
      expect(locationShareLinkPositionFor({ workday: forgotten, breaks: [], location: fresh(firstMinute), settings: shipped, now: firstMinute, timezone: BAKU }))
        .toEqual(UNAVAILABLE)
    })

    it("reads the same rows the other way round for an organization that lives by UTC, or whose zone cannot be read", () => {
      for (const zone of ["UTC", "Mars/Olympus"]) {
        expect(locationShareLinkTodayWorkDate(NIGHT, zone)).toEqual(at("2026-10-10T00:00:00.000Z"))
        expect(locationShareLinkPositionFor({ workday: forgotten, breaks: [], location: aMinuteAgo, settings: shipped, now: NIGHT, timezone: zone }))
          .toMatchObject({ state: "AVAILABLE" })
        expect(locationShareLinkPositionFor({ workday: nightShift, breaks: [], location: aMinuteAgo, settings: shipped, now: NIGHT, timezone: zone }))
          .toEqual(UNAVAILABLE)
      }
    })
  })
})
