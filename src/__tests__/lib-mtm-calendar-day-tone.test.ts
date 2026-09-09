import { describe, expect, it } from "vitest"
import { isPastMtmCalendarDay, mtmCalendarDayKey } from "@/lib/mtm/calendar-day-tone"

describe("calendar cell shading (field UX audit C6)", () => {
  const today = new Date(2026, 8, 8, 12, 0, 0) // 8 September 2026, local noon

  it("dims a day that is over", () => {
    expect(isPastMtmCalendarDay(new Date(2026, 8, 7), today)).toBe(true)
    expect(isPastMtmCalendarDay(new Date(2026, 7, 31), today)).toBe(true)
  })

  it("never dims today, whatever the hour", () => {
    // A route planned for today is still plannable at 23:59.
    expect(isPastMtmCalendarDay(new Date(2026, 8, 8, 0, 1), today)).toBe(false)
    expect(isPastMtmCalendarDay(new Date(2026, 8, 8, 23, 59), today)).toBe(false)
    expect(isPastMtmCalendarDay(new Date(2026, 8, 8), new Date(2026, 8, 8, 23, 59))).toBe(false)
  })

  it("leaves the future alone", () => {
    expect(isPastMtmCalendarDay(new Date(2026, 8, 9), today)).toBe(false)
    expect(isPastMtmCalendarDay(new Date(2026, 11, 31), today)).toBe(false)
  })

  it("compares local calendar days, not instants", () => {
    // The same key for any hour of the day is what keeps a Baku tenant from
    // seeing "past" arrive at 04:00 local.
    expect(mtmCalendarDayKey(new Date(2026, 8, 8, 0, 0))).toBe("2026-09-08")
    expect(mtmCalendarDayKey(new Date(2026, 8, 8, 23, 59))).toBe("2026-09-08")
  })
})
