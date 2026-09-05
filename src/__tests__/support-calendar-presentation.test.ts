import { describe, expect, it } from "vitest"

import {
  calendarDateParam,
  failedCalendarSources,
  getWeekDates,
  isOutsideBusinessHours,
  itemsForCalendarDay,
  nextCalendarItem,
  type CalendarItem,
} from "@/lib/support-calendar/presentation"

const item = (overrides: Partial<CalendarItem> = {}): CalendarItem => ({ id: "1", type: "event", title: "Meeting", date: "2026-09-07T10:00:00", hour: 10, ...overrides })

describe("support calendar presentation", () => {
  it("builds a Monday-first seven-day week and local API date parameters", () => {
    const week = getWeekDates(new Date(2026, 8, 9, 15))
    expect(week).toHaveLength(7)
    expect(calendarDateParam(week[0])).toBe("2026-09-07")
    expect(calendarDateParam(week[6])).toBe("2026-09-13")
  })

  it("sorts a selected-day agenda with all-day work before timed work", () => {
    const date = new Date(2026, 8, 7)
    const result = itemsForCalendarDay([
      item({ id: "late", date: "2026-09-07T17:00:00", hour: 17 }),
      item({ id: "all", date: "2026-09-07T09:00:00", hour: -1, allDay: true }),
      item({ id: "early", date: "2026-09-07T08:00:00", hour: 8 }),
      item({ id: "other", date: "2026-09-08T08:00:00", hour: 8 }),
    ], date)
    expect(result.map((entry) => entry.id)).toEqual(["all", "early", "late"])
  })

  it("keeps early and late work visible as outside standard hours", () => {
    expect(isOutsideBusinessHours(item({ date: "2026-09-07T06:30:00", hour: 6 }))).toBe(true)
    expect(isOutsideBusinessHours(item({ date: "2026-09-07T19:00:00", hour: 19 }))).toBe(true)
    expect(isOutsideBusinessHours(item({ date: "2026-09-07T18:59:00", hour: 18 }))).toBe(false)
    expect(isOutsideBusinessHours(item({ allDay: true }))).toBe(false)
  })

  it("finds the next timed item without treating all-day backlog as an appointment", () => {
    const next = nextCalendarItem([
      item({ id: "all", allDay: true }),
      item({ id: "past", date: "2026-09-07T09:00:00" }),
      item({ id: "next", date: "2026-09-07T11:00:00" }),
    ], new Date("2026-09-07T10:00:00"))
    expect(next?.id).toBe("next")
  })

  it("identifies failed sources for partial-state copy", () => {
    expect(failedCalendarSources({ tickets: "failed", tasks: "ok", events: "failed", activities: "ok" })).toEqual(["tickets", "events"])
  })
})
