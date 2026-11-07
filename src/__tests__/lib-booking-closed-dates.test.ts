import { describe, it, expect } from "vitest"
import { closedDateSet, isCalendarDate, normalizeClosedDates, parseClosedDates, readClosedDates } from "@/lib/booking/closed-dates"
import { computeSlots, defaultWeeklyHours } from "@/lib/booking/availability"

/**
 * A salon closed on the 14th is closed for every service it sells. What
 * matters is that the day disappears from the free times everywhere, and that
 * a list nobody can read leaves the salon open rather than silently shut.
 */
describe("the days a salon does not work", () => {
  it("takes a real calendar day and nothing else", () => {
    expect(isCalendarDate("2026-03-14")).toBe(true)
    expect(isCalendarDate("2026-02-31")).toBe(false)
    expect(isCalendarDate("2026-13-01")).toBe(false)
    expect(isCalendarDate("14.03.2026")).toBe(false)
    expect(isCalendarDate(20260314)).toBe(false)
  })

  it("reads a list written as plain dates or with notes, sorted and without repeats", () => {
    expect(parseClosedDates(["2026-03-15", { date: "2026-03-14", note: "  Bayram  " }, "2026-03-15"]))
      .toEqual([{ date: "2026-03-14", note: "Bayram" }, { date: "2026-03-15", note: null }])
  })

  it("leaves the salon open when the setting cannot be understood", () => {
    // Silently refusing every booking would be the worse of the two answers.
    expect(parseClosedDates(undefined)).toEqual([])
    expect(parseClosedDates("2026-03-14")).toEqual([])
    expect(parseClosedDates([{ day: "2026-03-14" }, null, 42])).toEqual([])
    expect(readClosedDates({ bookingClosedDates: [{ date: "2026-03-14", note: null }] }))
      .toEqual([{ date: "2026-03-14", note: null }])
    expect(readClosedDates(null)).toEqual([])
  })

  it("keeps today and the days after it when saving", () => {
    const saved = normalizeClosedDates([{ date: "2025-01-01" }, { date: "2026-03-14" }, { date: "2026-03-20" }], "2026-03-14")
    expect(saved.map((entry) => entry.date)).toEqual(["2026-03-14", "2026-03-20"])
  })
})

describe("a closed day in the free times", () => {
  const rules = {
    timezone: "Asia/Baku",
    durationMinutes: 60,
    bufferMinutes: 0,
    minNoticeMinutes: 0,
    maxDaysAhead: 6,
    weekly: defaultWeeklyHours(),
  }
  // A Wednesday at noon, so the week ahead holds several working days.
  const now = new Date("2026-03-11T08:00:00.000Z")
  const days = (closedDates: string[]) =>
    computeSlots({ rules: { ...rules, closedDates }, hostIds: ["host"], busyByHost: new Map([["host", []]]), now }).map((day) => day.date)

  it("offers the working days while nothing is closed", () => {
    expect(days([])).toContain("2026-03-12")
    expect(days([])).toContain("2026-03-13")
  })

  it("drops the closed day and keeps the rest", () => {
    const left = days(["2026-03-12"])
    expect(left).not.toContain("2026-03-12")
    expect(left).toContain("2026-03-13")
  })

  it("beats the weekly timetable, not the other way round", () => {
    // Thursday is a working day in the default week; closed wins.
    expect(defaultWeeklyHours()["4"].length).toBeGreaterThan(0)
    expect(days(["2026-03-12"])).not.toContain("2026-03-12")
  })

  it("ignores a day that is not in the window at all", () => {
    expect(days(["2027-01-01"])).toEqual(days([]))
  })

  it("hands the computation a set it can ask about", () => {
    expect(closedDateSet([{ date: "2026-03-14", note: null }]).has("2026-03-14")).toBe(true)
  })
})
