/**
 * Free time on a booking page: which slots a customer is offered.
 */
import { describe, expect, it } from "vitest"
import { computeSlots, defaultWeeklyHours, findSlot, offHoursIntervals, parseWeeklyHours, type BookingRules, type WeeklyHours } from "@/lib/booking/availability"

const baku = (over: Partial<BookingRules> = {}): BookingRules => ({
  timezone: "Asia/Baku",
  durationMinutes: 30,
  bufferMinutes: 0,
  minNoticeMinutes: 0,
  maxDaysAhead: 6,
  weekly: defaultWeeklyHours(),
  ...over,
})

const baseRules = () => baku()

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

describe("a host's own working days", () => {
  /** In Baku (UTC+4, no daylight saving) this clock time is that instant. */
  const at = (iso: string) => new Date(`${iso}:00+04:00`).toISOString()
  const everyDay = (start: string, end: string): WeeklyHours =>
    Object.fromEntries(["0", "1", "2", "3", "4", "5", "6"].map((day) => [day, [{ start, end }]])) as WeeklyHours

  it("turns the hours a host does not work into busy time, and nothing else", () => {
    const off = offHoursIntervals(everyDay("10:00", "11:00"), "Asia/Baku",
      new Date(at("2026-10-23T00:00")), new Date(at("2026-10-23T23:59")))
    const friday = off.filter((item) => item.start >= new Date(at("2026-10-23T00:00")) && item.end <= new Date(at("2026-10-24T00:00")))
    expect(friday.map((item) => [item.start.toISOString(), item.end.toISOString()])).toEqual([
      [at("2026-10-23T00:00"), at("2026-10-23T10:00")],
      [at("2026-10-23T11:00"), at("2026-10-24T00:00")],
    ])
    // Every interval says it is absence, not a meeting: a screen must be able
    // to tell them apart, or it draws the whole evening as a grey block.
    expect(off.every((item) => item.kind === "off")).toBe(true)
  })

  it("marks a whole day off, and a host with no hours at all", () => {
    const weekly = { ...everyDay("09:00", "18:00"), "5": [] } as WeeklyHours
    const off = offHoursIntervals(weekly, "Asia/Baku", new Date(at("2026-10-23T08:00")), new Date(at("2026-10-23T20:00")))
    expect(off.some((item) => item.start.toISOString() === at("2026-10-23T00:00") && item.end.toISOString() === at("2026-10-24T00:00"))).toBe(true)
  })

  it("leaves the page's own hours alone when the host has no schedule", () => {
    const rules = baseRules()
    const open = computeSlots({ rules, hostIds: ["leyla"], busyByHost: new Map([["leyla", []]]), now: FRIDAY_9 })
    const withSchedule = computeSlots({
      rules, hostIds: ["leyla"], now: FRIDAY_9,
      busyByHost: new Map([["leyla", offHoursIntervals(everyDay("10:00", "11:00"), "Asia/Baku", FRIDAY_9, new Date(FRIDAY_9.getTime() + 7 * 86400_000))]]),
    })
    const times = (days: ReturnType<typeof computeSlots>) => days.flatMap((day) => day.slots.map((slot) => slot.startsAt))
    expect(times(open).length).toBeGreaterThan(times(withSchedule).length)
    // What is left is only the hour the host actually works.
    for (const startsAt of times(withSchedule)) {
      expect(new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Baku" }).format(new Date(startsAt))).toMatch(/^10:(00|30)$/)
    }
    expect(times(withSchedule).length).toBeGreaterThan(0)
  })
})
