import { describe, expect, it } from "vitest"
import { addSlaWorkingMilliseconds, readSlaBusinessCalendar, type SlaBusinessCalendar } from "@/lib/ticketing/sla-business-calendar"

import { calculateMilestoneDue } from "@/lib/entitlement-process/milestone-due-calculator"

const hour = 3600000
const workday = { enabled: true, intervals: [{ start: "09:00", end: "18:00" }] }
export const calendar: SlaBusinessCalendar = {
  version: 1, sourceId: "calendar-synthetic", capturedAt: "2026-10-04T00:00:00.000Z",
  sourceUpdatedAt: "2026-10-03T00:00:00.000Z", timezone: "Asia/Baku",
  boundaryPolicy: "reject_ambiguous_or_missing",
  schedule: { mon: workday, tue: workday, wed: workday, thu: workday, fri: workday },
  holidays: [],
}
const add = (anchor: string, hours: number, value: SlaBusinessCalendar = calendar) =>
  addSlaWorkingMilliseconds(new Date(anchor), hours * hour, readSlaBusinessCalendar(value)).toISOString()

describe("versioned SLA work calendar", () => {
  it("uses the same frozen calendar for new entitlement milestone deadlines", () => {
    const result = calculateMilestoneDue({
      definition: { type: "resolution", dueWithinSeconds: 4 * 3600, isRequired: true },
      ticketCreatedAt: new Date("2026-10-02T12:00:00Z"), ticketSeverity: "normal",
      multiplierOverride: 1, businessCalendar: calendar,
    })
    expect(result.dueAt.toISOString()).toBe("2026-10-05T07:00:00.000Z")
    expect(result.effectiveDueWithinSeconds).toBe(14400)
  })

  it("turns Friday 16:00 + 4 working hours into Monday 11:00 in the pinned timezone", () => {
    expect(add("2026-10-02T12:00:00Z", 4)).toBe("2026-10-05T07:00:00.000Z")
  })
  it("skips a Monday holiday and uses Tuesday 11:00", () => {
    expect(add("2026-10-02T12:00:00Z", 4, { ...calendar, holidays: [{ date: "2026-10-05", closed: true }] })).toBe("2026-10-06T07:00:00.000Z")
  })
  it("excludes lunch breaks and preserves fractional hours", () => {
    const split = { ...calendar, schedule: { mon: { enabled: true, intervals: [{ start: "09:00", end: "12:00" }, { start: "13:00", end: "18:00" }] } } }
    expect(add("2026-10-05T07:30:00Z", 1, split)).toBe("2026-10-05T09:30:00.000Z")
    expect(add("2026-10-05T07:30:00Z", 0.5, split)).toBe("2026-10-05T08:00:00.000Z")
  })
  it("starts after a weekend and treats a work interval's end as exclusive", () => {
    expect(add("2026-10-02T14:00:00Z", 1)).toBe("2026-10-05T06:00:00.000Z")
    expect(add("2026-10-03T08:00:00Z", 1)).toBe("2026-10-05T06:00:00.000Z")
  })
  it("uses explicit holiday opening intervals instead of the normal weekly hours", () => {
    expect(add("2026-10-02T12:00:00Z", 4, { ...calendar, holidays: [{ date: "2026-10-05", intervals: [{ start: "12:00", end: "15:00" }] }] })).toBe("2026-10-05T10:00:00.000Z")
  })
  it("preserves seconds within a working interval and does not mutate the snapshot", () => {
    const before = JSON.stringify(calendar)
    expect(add("2026-10-05T05:00:13.250Z", 1)).toBe("2026-10-05T06:00:13.250Z")
    expect(JSON.stringify(calendar)).toBe(before)
  })
  it.each([
    ["2026-03-06T21:00:00Z", "2026-03-09T15:00:00.000Z"],
    ["2026-10-30T20:00:00Z", "2026-11-02T16:00:00.000Z"],
  ])("uses the correct UTC offset across DST from %s", (anchor, due) => {
    expect(add(anchor, 4, { ...calendar, timezone: "America/New_York" })).toBe(due)
  })
  it("counts real elapsed time inside a shift spanning a DST transition", () => {
    const sunday = { ...calendar, timezone: "America/New_York", schedule: { sun: { enabled: true, intervals: [{ start: "00:00", end: "04:00" }] } } }
    expect(add("2026-03-08T05:00:00Z", 3, sunday)).toBe("2026-03-08T08:00:00.000Z")
    expect(add("2026-11-01T04:00:00Z", 4, sunday)).toBe("2026-11-01T08:00:00.000Z")
  })
  it.each([
    ["2026-03-08T05:00:00Z", "02:30", "04:00"],
    ["2026-11-01T04:00:00Z", "01:00", "04:00"],
  ])("rejects missing or ambiguous interval boundaries instead of silently shifting %s", (anchor, start, end) => {
    const value = { ...calendar, timezone: "America/New_York", schedule: { sun: { enabled: true, intervals: [{ start, end }] } } }
    expect(() => add(anchor, 1, value)).toThrow("SLA_CALENDAR_BOUNDARY_INVALID")
  })
  it("excludes only working time intersecting explicit completed pauses", () => {
    const due = addSlaWorkingMilliseconds(new Date("2026-10-02T12:00:00Z"), 4 * hour, calendar, [
      { from: new Date("2026-10-02T13:00:00Z"), to: new Date("2026-10-05T06:00:00Z") },
    ])
    expect(due.toISOString()).toBe("2026-10-05T09:00:00.000Z")
  })
  it("rejects malformed, overlapping, empty and unknown-zone calendars", () => {
    for (const value of [
      { ...calendar, timezone: "Wrong/Zone" },
      { ...calendar, schedule: {} },
      { ...calendar, schedule: { mon: { enabled: true, intervals: [{ start: "09:00", end: "12:00" }, { start: "11:00", end: "13:00" }] } } },
      { ...calendar, holidays: [{ date: "2026-02-31" }] },
      { ...calendar, holidays: [{ date: "2026-10-05" }, { date: "2026-10-05" }] },
    ]) expect(() => readSlaBusinessCalendar(value)).toThrow("SLA_CALENDAR_INVALID")
  })
  it("handles the maximum 8760-hour policy target over multiple years", () => {
    const result = add("2026-10-05T05:00:00Z", 8760)
    expect(result).toBe("2030-06-27T08:00:00.000Z")
  })

  it("bounds pathological targets instead of hanging", () => {
    expect(() => add("2026-10-02T12:00:00Z", Number.POSITIVE_INFINITY)).toThrow("SLA_CALENDAR_INVALID")
    expect(add("2026-10-02T12:00:00Z", 0)).toBe("2026-10-02T12:00:00.000Z")
  })
})
