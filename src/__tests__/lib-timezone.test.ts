/**
 * Tests for P5 Time zones per user — slice 1 foundation utilities.
 * Pure-functional, no DB, no Prisma. Uses Node's built-in Intl ICU data.
 */
import { describe, it, expect } from "vitest"
import {
  COMMON_TIMEZONES,
  isValidTimezone,
  resolveEffectiveTimezone,
  formatInTimezone,
  getOffsetMinutes,
  timezoneLabel,
  dateInputValueInTimezone,
  localDateTimeToUtc,
} from "@/lib/timezone"

describe("P5 timezone — isValidTimezone", () => {
  it("accepts canonical IANA names", () => {
    expect(isValidTimezone("Europe/Warsaw")).toBe(true)
    expect(isValidTimezone("America/New_York")).toBe(true)
    expect(isValidTimezone("Asia/Baku")).toBe(true)
    expect(isValidTimezone("UTC")).toBe(true)
  })

  it("rejects garbage and malformed input", () => {
    expect(isValidTimezone("")).toBe(false)
    expect(isValidTimezone("Not/A/Real_Zone_xyz")).toBe(false)
    expect(isValidTimezone("GMT+5")).toBe(false)
    expect(isValidTimezone(null)).toBe(false)
    expect(isValidTimezone(undefined)).toBe(false)
    expect(isValidTimezone(42)).toBe(false)
    expect(isValidTimezone("x".repeat(200))).toBe(false) // length guard
  })

  it("accepts legacy 3-letter aliases that Node's Intl recognises (PST/EST)", () => {
    // Node's Intl ICU accepts these even though they're not strict IANA names.
    // We do NOT filter them out — the UI restricts user choice via COMMON_TIMEZONES
    // catalog, but API consumers may pass them. Downstream is unaffected.
    expect(isValidTimezone("PST")).toBe(true)
    expect(isValidTimezone("EST")).toBe(true)
  })

  it("does not throw on invalid input", () => {
    expect(() => isValidTimezone({})).not.toThrow()
    expect(() => isValidTimezone([])).not.toThrow()
  })
})

describe("P5 timezone — resolveEffectiveTimezone", () => {
  it("returns user TZ when set", () => {
    expect(resolveEffectiveTimezone({
      userTimezone: "Europe/Warsaw",
      orgTimezone: "Asia/Baku",
    })).toBe("Europe/Warsaw")
  })

  it("falls back to org TZ when user is null", () => {
    expect(resolveEffectiveTimezone({
      userTimezone: null,
      orgTimezone: "Asia/Baku",
    })).toBe("Asia/Baku")
  })

  it("falls back to UTC when both missing", () => {
    expect(resolveEffectiveTimezone({})).toBe("UTC")
    expect(resolveEffectiveTimezone({ userTimezone: null, orgTimezone: null })).toBe("UTC")
  })

  it("ignores invalid user TZ and falls through to org", () => {
    expect(resolveEffectiveTimezone({
      userTimezone: "Bogus/Zone",
      orgTimezone: "Europe/London",
    })).toBe("Europe/London")
  })

  it("ignores invalid org TZ and falls back to UTC", () => {
    expect(resolveEffectiveTimezone({
      userTimezone: null,
      orgTimezone: "Also/Bogus",
    })).toBe("UTC")
  })
})

describe("P5 timezone — formatInTimezone", () => {
  // Reference moment: 2026-05-14 12:00:00 UTC
  const T = new Date(Date.UTC(2026, 4, 14, 12, 0, 0))

  it("formats date in arbitrary timezone", () => {
    const out = formatInTimezone(T, "America/New_York", {
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit",
      hour12: false,
    })
    // NY is UTC-4 in May (EDT)
    expect(out).toMatch(/14\/05\/2026.*08:00/)
  })

  it("formats date in Asia/Baku", () => {
    const out = formatInTimezone(T, "Asia/Baku", {
      hour: "2-digit", minute: "2-digit", hour12: false,
    })
    // Baku is UTC+4 year-round (no DST)
    expect(out).toMatch(/16:00/)
  })

  it("falls back to UTC for invalid timezone (no throw)", () => {
    const out = formatInTimezone(T, "Bogus/Zone", {
      hour: "2-digit", minute: "2-digit", hour12: false,
    })
    expect(out).toMatch(/12:00/)
  })

  it("accepts ISO string input", () => {
    const out = formatInTimezone("2026-05-14T12:00:00Z", "UTC", {
      hour: "2-digit", minute: "2-digit", hour12: false,
    })
    expect(out).toMatch(/12:00/)
  })

  it("accepts millis timestamp input", () => {
    const out = formatInTimezone(T.getTime(), "UTC", { hour: "2-digit", hour12: false })
    expect(out).toMatch(/12/)
  })

  // Field UX audit W-02 / task C2. Eleven MTM components read task deadlines,
  // GPS history and route drafts through this function, so an ICU build with
  // no Azerbaijani data turned all of them into "2026 M05 14" at once.
  it("writes the month in Azerbaijani instead of the ICU root fallback", () => {
    const out = formatInTimezone(T, "Asia/Baku", { dateStyle: "medium", timeStyle: "short" }, "az")
    expect(out).toContain("may")
    expect(out).toContain("16:00")
    expect(out).not.toMatch(/M0?5/)
  })

  it("keeps the Azerbaijani date in the local order and on a 24-hour clock", () => {
    const evening = new Date(Date.UTC(2026, 4, 14, 19, 30, 0))
    expect(formatInTimezone(evening, "Asia/Baku", { dateStyle: "short" }, "az")).toBe("14.05.2026")
    expect(formatInTimezone(evening, "Asia/Baku", { timeStyle: "short" }, "az")).toBe("23:30")
  })

  it("leaves every other locale on the output it had before", () => {
    // The helper only assembles Azerbaijani; en/ru still go straight to Intl.
    for (const locale of ["en-GB", "ru", "en-US"]) {
      const opts: Intl.DateTimeFormatOptions = { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Baku" }
      // eslint-disable-next-line no-restricted-syntax -- this IS the reference output under test.
      expect(formatInTimezone(T, "Asia/Baku", { dateStyle: "medium", timeStyle: "short" }, locale))
        .toBe(new Intl.DateTimeFormat(locale, opts).format(T))
    }
  })

  it("returns an empty string for an unparseable date instead of throwing", () => {
    // route-builder and route-planning-matrix slice this result into a time
    // slot; a RangeError there took the whole planner down.
    expect(formatInTimezone("not a date", "Asia/Baku", { hour: "2-digit", minute: "2-digit" })).toBe("")
  })

  it("still yields a sliceable HH:mm for the route time slots", () => {
    const slot = formatInTimezone(T, "Asia/Baku", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    expect(slot.slice(0, 5)).toBe("16:00")
  })
})

describe("P5 timezone — HTML date input", () => {
  it("uses the configured timezone across the UTC midnight boundary", () => {
    const moment = new Date("2026-07-13T20:30:00.000Z")
    expect(dateInputValueInTimezone(moment, "Asia/Baku")).toBe("2026-07-14")
    expect(dateInputValueInTimezone(moment, "America/New_York")).toBe("2026-07-13")
  })

  it("falls back to UTC for an invalid timezone and rejects invalid dates", () => {
    expect(dateInputValueInTimezone("2026-07-13T20:30:00.000Z", "invalid")).toBe("2026-07-13")
    expect(dateInputValueInTimezone("not-a-date", "Asia/Baku")).toBe("")
  })
})

describe("P5 timezone — local date-time input", () => {
  it("converts an organization-local route time to UTC", () => {
    expect(localDateTimeToUtc("2026-07-15T09:30", "Asia/Baku").toISOString())
      .toBe("2026-07-15T05:30:00.000Z")
  })

  it("handles DST using the offset at the selected local time", () => {
    expect(localDateTimeToUtc("2026-07-15T09:30", "America/New_York").toISOString())
      .toBe("2026-07-15T13:30:00.000Z")
    expect(localDateTimeToUtc("2026-01-15T09:30", "America/New_York").toISOString())
      .toBe("2026-01-15T14:30:00.000Z")
  })

  it("falls back to UTC and rejects malformed values", () => {
    expect(localDateTimeToUtc("2026-07-15T09:30", "invalid").toISOString())
      .toBe("2026-07-15T09:30:00.000Z")
    expect(() => localDateTimeToUtc("2026-07-15 09:30", "Asia/Baku")).toThrow("Invalid local date-time")
    expect(() => localDateTimeToUtc("2026-02-30T09:30", "Asia/Baku")).toThrow("Invalid local date-time")
  })
})

describe("P5 timezone — getOffsetMinutes", () => {
  // Use a fixed July reference to avoid DST ambiguity for half-hour zones
  const summer = new Date(Date.UTC(2026, 6, 15, 12, 0, 0)) // 15 July 2026

  it("UTC = 0", () => {
    expect(getOffsetMinutes("UTC", summer)).toBe(0)
  })

  it("Asia/Baku = +240 (UTC+4)", () => {
    expect(getOffsetMinutes("Asia/Baku", summer)).toBe(240)
  })

  it("Asia/Kolkata = +330 (UTC+5:30 — half-hour zone)", () => {
    expect(getOffsetMinutes("Asia/Kolkata", summer)).toBe(330)
  })

  it("Asia/Kathmandu = +345 (UTC+5:45 — quarter-hour zone)", () => {
    expect(getOffsetMinutes("Asia/Kathmandu", summer)).toBe(345)
  })

  it("America/New_York summer = -240 (EDT)", () => {
    expect(getOffsetMinutes("America/New_York", summer)).toBe(-240)
  })

  it("America/New_York winter = -300 (EST)", () => {
    const winter = new Date(Date.UTC(2026, 0, 15, 12, 0, 0))
    expect(getOffsetMinutes("America/New_York", winter)).toBe(-300)
  })

  it("invalid TZ → 0", () => {
    expect(getOffsetMinutes("Bogus/Zone", summer)).toBe(0)
  })
})

describe("P5 timezone — timezoneLabel", () => {
  const summer = new Date(Date.UTC(2026, 6, 15, 12, 0, 0))

  it("formats GMT+HH:MM suffix", () => {
    expect(timezoneLabel("Europe/Warsaw", summer)).toBe("Europe/Warsaw (GMT+02:00)")
    expect(timezoneLabel("Asia/Baku", summer)).toBe("Asia/Baku (GMT+04:00)")
    expect(timezoneLabel("UTC", summer)).toBe("UTC (GMT+00:00)")
  })

  it("formats negative offset", () => {
    expect(timezoneLabel("America/New_York", summer)).toBe("America/New_York (GMT-04:00)")
  })

  it("formats half-hour offset", () => {
    expect(timezoneLabel("Asia/Kolkata", summer)).toBe("Asia/Kolkata (GMT+05:30)")
  })

  it("returns raw key for invalid TZ", () => {
    expect(timezoneLabel("Bogus/Zone")).toBe("Bogus/Zone")
  })
})

describe("P5 timezone — COMMON_TIMEZONES catalog", () => {
  it("all entries are valid IANA names recognised by Intl", () => {
    for (const tz of COMMON_TIMEZONES) {
      expect(isValidTimezone(tz)).toBe(true)
    }
  })

  it("includes UTC and key CIS zones for LeadDrive primary market", () => {
    expect(COMMON_TIMEZONES).toContain("UTC")
    expect(COMMON_TIMEZONES).toContain("Asia/Baku")
    expect(COMMON_TIMEZONES).toContain("Europe/Moscow")
    expect(COMMON_TIMEZONES).toContain("Asia/Almaty")
  })

  it("has no duplicates", () => {
    const set = new Set(COMMON_TIMEZONES)
    expect(set.size).toBe(COMMON_TIMEZONES.length)
  })
})
