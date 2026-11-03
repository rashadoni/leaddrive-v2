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

describe("free time by the service, not by one number of the day", () => {
  /** In Baku (UTC+4, no daylight saving) this clock time is that instant. */
  const at = (iso: string) => new Date(`${iso}:00+04:00`)
  // Wednesday 4 November 2026, 04:00 in Baku — before the salon opens.
  const DAWN = new Date("2026-11-04T00:00:00Z")
  const DAY = "2026-11-04"
  /** A salon service: its own length and its own cleanup time after it. */
  const service = (durationMinutes: number, bufferMinutes: number): BookingRules =>
    baku({ durationMinutes, bufferMinutes, maxDaysAhead: 0, weekly: { ...defaultWeeklyHours(), "3": [{ start: "09:00", end: "18:00" }] } })
  const booked = (from: string, minutes: number, bufferMinutes: number) => ({
    start: at(from), end: new Date(at(from).getTime() + minutes * 60_000),
    bufferBeforeMinutes: bufferMinutes, bufferAfterMinutes: bufferMinutes,
  })
  const offered = (rules: BookingRules, busy: ReturnType<typeof booked>[] | { start: Date; end: Date; kind: "off" }[]) =>
    (computeSlots({ rules, hostIds: ["leyla"], busyByHost: new Map([["leyla", busy]]), now: DAWN })
      .find((day) => day.date === DAY)?.slots ?? [])
      .map((slot) => new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Baku", hour: "2-digit", minute: "2-digit" }).format(new Date(slot.startsAt)))

  it("gives a 40-minute service and a 90-minute one different windows on the same day", () => {
    const manicure = offered(service(40, 15), [])
    const colouring = offered(service(90, 15), [])
    expect(manicure).not.toEqual(colouring)
    expect(manicure.length).toBeGreaterThan(colouring.length)
    expect(colouring).toEqual(["09:00", "10:30", "12:00", "13:30", "15:00", "16:30"])
    expect(manicure.slice(0, 3)).toEqual(["09:00", "09:40", "10:20"])
    // The last window of each has to end inside the working day.
    expect(colouring.at(-1)).toBe("16:30") // 16:30 + 90 = 18:00
    expect(manicure.at(-1)).toBe("17:00") // 17:00 + 40 = 17:40
  })

  it("offers the gap a long service leaves behind, which the ladder cannot reach", () => {
    // 09:00 colouring runs to 10:30 and wants 15 minutes after it. The next
    // rung of the 90-minute ladder is 12:00, so 10:45–12:15 used to be ninety
    // free minutes nobody could book: an empty chair.
    const after = offered(service(90, 15), [booked("2026-11-04T09:00", 90, 15)])
    expect(after).toContain("10:45")
    expect(after).not.toContain("10:30") // inside the cleanup time
    expect(after).not.toContain("09:00")
    expect(after).toEqual(["10:45", "12:00", "13:30", "15:00", "16:30"])
    // And the slot offered is bookable: the submit path validates against this
    // very computation, so an offered gap cannot be refused at the door.
    expect(findSlot(computeSlots({ rules: service(90, 15), hostIds: ["leyla"], now: DAWN,
      busyByHost: new Map([["leyla", [booked("2026-11-04T09:00", 90, 15)]]]) }), at("2026-11-04T10:45").toISOString())?.hostIds).toEqual(["leyla"])
  })

  it("fits a short service into the same gap, right after the cleanup time", () => {
    const manicure = offered(service(40, 15), [booked("2026-11-04T09:00", 90, 15)])
    expect(manicure.slice(0, 2)).toEqual(["10:45", "11:00"])
    // A second booking later in the day leaves its own usable start.
    const twice = offered(service(40, 15), [booked("2026-11-04T09:00", 90, 15), booked("2026-11-04T13:00", 40, 15)])
    expect(twice).toContain("13:55")
    expect(twice).not.toContain("13:00")
    expect(twice).not.toContain("13:40")
  })

  it("changes nothing on a day with nothing booked", () => {
    // The extra starts come from busy blocks, so a page that never had one
    // shows exactly the windows it always did.
    expect(offered(service(30, 0), [])).toEqual(offered(baku({ durationMinutes: 30, maxDaysAhead: 0,
      weekly: { ...defaultWeeklyHours(), "3": [{ start: "09:00", end: "18:00" }] } }), []))
    expect(offered(service(30, 0), []).length).toBe(18)
  })

  it("offers the end of a lunch break, and never a start that runs past closing", () => {
    const lunch = [{ start: at("2026-11-04T13:00"), end: at("2026-11-04T14:00"), kind: "off" as const }]
    expect(offered(service(40, 0), lunch)).toContain("14:00")
    // The 16:50 booking ends 17:30 and wants 15 minutes after it: a start at
    // 17:45 would run past closing, so the day simply ends earlier.
    const late = offered(service(40, 15), [booked("2026-11-04T16:50", 40, 15)])
    expect(late).not.toContain("17:45")
    expect(late).not.toContain("17:00")
    expect(late).not.toContain("16:20") // 16:20–17:00 runs into the booking's cleanup
    expect(late.at(-1)).toBe("15:40")
  })

  it("keeps another day's busy block out of this day's windows", () => {
    // A meeting that ends at 23:50 the day before must not seed a 00:05 start.
    const night = [booked("2026-11-03T23:10", 40, 15)]
    expect(offered(service(40, 15), night)).toEqual(offered(service(40, 15), []))
  })
})
