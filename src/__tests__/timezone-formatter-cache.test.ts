import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// Use the real ICU for correctness and observe constructor calls only. No
// mocked offsets or clocks can make a DST transition pass these checks.
beforeEach(() => vi.resetModules())
afterEach(() => vi.restoreAllMocks())

function observeConstructors() {
  const NativeDateTimeFormat = Intl.DateTimeFormat
  return vi.spyOn(Intl, "DateTimeFormat").mockImplementation(function (...args: Parameters<typeof Intl.DateTimeFormat>) {
    return new NativeDateTimeFormat(...args)
  })
}

describe("bounded timezone machine formatters", () => {
  it("reuses four fixed formatters while still resolving each supplied instant", async () => {
    const constructor = observeConstructors()
    const { dateInputValueInTimezone, localDateTimeToUnambiguousUtc, getOffsetMinutes } = await import("@/lib/timezone")
    const zone = "America/New_York"
    expect(dateInputValueInTimezone("2026-01-15T02:00:00Z", zone)).toBe("2026-01-14")
    expect(localDateTimeToUnambiguousUtc("2026-01-15T09:30", zone).toISOString()).toBe("2026-01-15T14:30:00.000Z")
    const first = constructor.mock.calls.length
    expect(first).toBe(4)
    expect(dateInputValueInTimezone("2026-07-15T23:00:00Z", zone)).toBe("2026-07-15")
    expect(localDateTimeToUnambiguousUtc("2026-07-15T09:30", zone).toISOString()).toBe("2026-07-15T13:30:00.000Z")
    expect(getOffsetMinutes(zone, new Date("2026-01-15T12:00:00Z"))).toBe(-300)
    expect(getOffsetMinutes(zone, new Date("2026-07-15T12:00:00Z"))).toBe(-240)
    expect(constructor).toHaveBeenCalledTimes(first)
  })

  it.each([
    ["America/New_York", "2026-03-08T02:30", "Non-existent local date-time"],
    ["America/New_York", "2026-11-01T01:30", "Ambiguous local date-time"],
    ["Australia/Lord_Howe", "2026-10-04T02:15", "Non-existent local date-time"],
    ["Australia/Lord_Howe", "2026-04-05T01:45", "Ambiguous local date-time"],
    ["Pacific/Apia", "2011-12-30T12:00", "Non-existent local date-time"],
  ])("keeps %s %s unresolved after the cache is warm", async (zone, value, error) => {
    const { localDateTimeToUnambiguousUtc } = await import("@/lib/timezone")
    localDateTimeToUnambiguousUtc("2026-01-15T12:00", zone)
    expect(() => localDateTimeToUnambiguousUtc(value, zone)).toThrow(error)
    expect(() => localDateTimeToUnambiguousUtc(value, zone)).toThrow(error)
  })

  it.each([
    ["America/New_York", "2026-03-08T03:30", "2026-03-08T07:30:00.000Z"],
    ["America/New_York", "2026-11-01T02:30", "2026-11-01T07:30:00.000Z"],
    ["Australia/Lord_Howe", "2026-10-04T02:30", "2026-10-03T15:30:00.000Z"],
    ["Australia/Lord_Howe", "2026-04-05T02:00", "2026-04-04T15:30:00.000Z"],
    ["Pacific/Apia", "2011-12-29T12:00", "2011-12-29T22:00:00.000Z"],
    ["Pacific/Apia", "2011-12-31T12:00", "2011-12-30T22:00:00.000Z"],
  ])("retains the real instant for %s %s beside a transition", async (zone, value, expected) => {
    const { localDateTimeToUnambiguousUtc } = await import("@/lib/timezone")
    localDateTimeToUnambiguousUtc("2026-01-15T12:00", zone)
    expect(localDateTimeToUnambiguousUtc(value, zone).toISOString()).toBe(expected)
  })

  it("preserves UTC fallbacks, invalid dates and accepted aliases independently", async () => {
    const { isValidTimezone, dateInputValueInTimezone, getOffsetMinutes, localDateTimeToUtc, localDateTimeToUnambiguousUtc } = await import("@/lib/timezone")
    const date = new Date("2026-07-15T12:00:00Z")
    expect(isValidTimezone("PST")).toBe(true)
    expect(isValidTimezone("EST")).toBe(true)
    for (const zone of ["invalid", "Not/A/Zone", "invalid"]) {
      expect(isValidTimezone(zone)).toBe(false)
      expect(dateInputValueInTimezone(date, zone)).toBe("2026-07-15")
      expect(getOffsetMinutes(zone, date)).toBe(0)
      expect(localDateTimeToUtc("2026-07-15T09:30", zone).toISOString()).toBe("2026-07-15T09:30:00.000Z")
      expect(localDateTimeToUnambiguousUtc("2026-07-15T09:30", zone).toISOString()).toBe("2026-07-15T09:30:00.000Z")
    }
    expect(dateInputValueInTimezone("invalid-date", "UTC")).toBe("")
    expect(getOffsetMinutes("UTC", new Date("invalid-date"))).toBe(0)
    expect(() => localDateTimeToUnambiguousUtc("2026-02-30T09:30", "UTC")).toThrow("Invalid local date-time")
    expect(isValidTimezone(null)).toBe(false)
    expect(isValidTimezone("x".repeat(65))).toBe(false)
  })

  it("bounds all formatter kinds together and evicts cold entries without changing answers", async () => {
    const constructor = observeConstructors()
    const { COMMON_TIMEZONES, dateInputValueInTimezone, localDateTimeToUnambiguousUtc } = await import("@/lib/timezone")
    const zones = COMMON_TIMEZONES.slice(0, 33)
    const exercise = (zone: string) => [
      dateInputValueInTimezone("2026-01-15T12:00:00Z", zone),
      localDateTimeToUnambiguousUtc("2026-01-15T12:00", zone).toISOString(),
    ]
    const expected = zones.slice(0, 32).map(exercise)
    expect(constructor).toHaveBeenCalledTimes(128)
    expect(zones.slice(0, 32).map(exercise)).toEqual(expected)
    expect(constructor).toHaveBeenCalledTimes(128)
    exercise(zones[32])
    expect(constructor).toHaveBeenCalledTimes(132)
    expect(exercise(zones[31])).toEqual(expected[31])
    expect(constructor).toHaveBeenCalledTimes(132)
    expect(exercise(zones[0])).toEqual(expected[0])
    expect(constructor).toHaveBeenCalledTimes(136)
  })
})
