/**
 * Free time on a booking page: which slots a customer is offered.
 */
import { describe, expect, it } from "vitest"
import { computeSlots, defaultWeeklyHours, findSlot, parseWeeklyHours, type BookingRules } from "@/lib/booking/availability"

const baku = (over: Partial<BookingRules> = {}): BookingRules => ({
  timezone: "Asia/Baku",
  durationMinutes: 30,
  bufferMinutes: 0,
  minNoticeMinutes: 0,
  maxDaysAhead: 6,
  weekly: defaultWeeklyHours(),
  ...over,
})

// Friday 23 October 2026, 09:00 in Baku (UTC+4).
const FRIDAY_9 = new Date("2026-10-23T05:00:00Z")

describe("computeSlots", () => {
  it("offers working hours on the organization's clock, in steps of the meeting length", () => {
    const days = computeSlots({ rules: baku(), hostIds: ["a"], busyByHost: new Map(), now: FRIDAY_9 })

    expect(days.map((day) => day.date)).toEqual(["2026-10-23", "2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29"])
    const friday = days[0].slots
    expect(friday).toHaveLength(18) // 09:00 … 17:30
    expect(friday[0]).toMatchObject({ startsAt: "2026-10-23T05:00:00.000Z", endsAt: "2026-10-23T05:30:00.000Z", hostIds: ["a"] })
    expect(friday.at(-1)?.startsAt).toBe("2026-10-23T13:30:00.000Z") // 17:30, ends at 18:00
  })

  it("keeps the notice period", () => {
    const days = computeSlots({ rules: baku({ minNoticeMinutes: 120 }), hostIds: ["a"], busyByHost: new Map(), now: FRIDAY_9 })
    expect(days[0].slots[0].startsAt).toBe("2026-10-23T07:00:00.000Z") // 11:00
  })

  it("skips a host's busy time with the buffer on both sides, and keeps the slot for another host", () => {
    const busy = new Map([["a", [{ start: new Date("2026-10-23T06:00:00Z"), end: new Date("2026-10-23T06:30:00Z") }]]]) // 10:00–10:30
    const one = computeSlots({ rules: baku({ bufferMinutes: 15 }), hostIds: ["a"], busyByHost: busy, now: FRIDAY_9 })
    const times = one[0].slots.map((slot) => slot.startsAt)
    expect(times).not.toContain("2026-10-23T05:30:00.000Z") // 09:30 ends 10:00, inside the buffer
    expect(times).not.toContain("2026-10-23T06:00:00.000Z")
    expect(times).not.toContain("2026-10-23T06:30:00.000Z") // 10:30 starts inside the buffer
    expect(times).toContain("2026-10-23T07:00:00.000Z")

    const two = computeSlots({ rules: baku(), hostIds: ["a", "b"], busyByHost: busy, now: FRIDAY_9 })
    expect(findSlot(two, "2026-10-23T06:00:00.000Z")?.hostIds).toEqual(["b"])
  })

  it("offers nothing when every host is busy all day", () => {
    const busy = new Map([["a", [{ start: new Date("2026-10-01T00:00:00Z"), end: new Date("2026-12-01T00:00:00Z") }]]])
    expect(computeSlots({ rules: baku(), hostIds: ["a"], busyByHost: busy, now: FRIDAY_9 })).toEqual([])
  })

  it("skips a clock time that does not exist on a DST day", () => {
    // Berlin, Sunday 29 March 2026: 02:00–03:00 does not exist.
    const rules = baku({ timezone: "Europe/Berlin", weekly: { ...defaultWeeklyHours(), "0": [{ start: "01:00", end: "04:00" }] }, maxDaysAhead: 0 })
    const days = computeSlots({ rules, hostIds: ["a"], busyByHost: new Map(), now: new Date("2026-03-28T23:00:00Z") })
    const local = days[0].slots.map((slot) => new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit" }).format(new Date(slot.startsAt)))
    expect(local).toEqual(["01:00", "01:30", "03:00", "03:30"])
  })
})

describe("parseWeeklyHours", () => {
  it("accepts and sorts valid hours", () => {
    expect(parseWeeklyHours({ "1": [{ start: "14:00", end: "18:00" }, { start: "09:00", end: "13:00" }] })?.["1"])
      .toEqual([{ start: "09:00", end: "13:00" }, { start: "14:00", end: "18:00" }])
  })

  it("refuses an end before the start, overlapping intervals and nonsense", () => {
    expect(parseWeeklyHours({ "1": [{ start: "18:00", end: "09:00" }] })).toBeNull()
    expect(parseWeeklyHours({ "1": [{ start: "09:00", end: "13:00" }, { start: "12:00", end: "15:00" }] })).toBeNull()
    expect(parseWeeklyHours({ "1": [{ start: "9", end: "13:00" }] })).toBeNull()
    expect(parseWeeklyHours([])).toBeNull()
  })
})
