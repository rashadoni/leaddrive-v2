import { describe, it, expect } from "vitest"
import {
  parseRecurrenceRule,
  addRecurrence,
  nextDueDate,
  describeRecurrence,
} from "@/lib/recurrence/parse"

describe("parseRecurrenceRule", () => {
  it("parses bare presets", () => {
    expect(parseRecurrenceRule("daily")).toEqual({ unit: "day", interval: 1 })
    expect(parseRecurrenceRule("weekly")).toEqual({ unit: "week", interval: 1 })
    expect(parseRecurrenceRule("monthly")).toEqual({ unit: "month", interval: 1 })
    expect(parseRecurrenceRule("yearly")).toEqual({ unit: "year", interval: 1 })
  })

  it("parses every:N:unit", () => {
    expect(parseRecurrenceRule("every:3:day")).toEqual({ unit: "day", interval: 3 })
    expect(parseRecurrenceRule("every:2:week")).toEqual({ unit: "week", interval: 2 })
    expect(parseRecurrenceRule("every:6:month")).toEqual({ unit: "month", interval: 6 })
  })

  it("accepts uppercase + whitespace", () => {
    expect(parseRecurrenceRule("  DAILY  ")).toEqual({ unit: "day", interval: 1 })
    expect(parseRecurrenceRule("Every:2:WEEK")).toEqual({ unit: "week", interval: 2 })
  })

  it("rejects N < 1", () => {
    expect(parseRecurrenceRule("every:0:day")).toBeNull()
  })

  it("rejects N > 365 (sanity cap)", () => {
    expect(parseRecurrenceRule("every:500:day")).toBeNull()
  })

  it("rejects unknown unit", () => {
    expect(parseRecurrenceRule("every:1:fortnight")).toBeNull()
  })

  it("rejects garbage", () => {
    expect(parseRecurrenceRule("")).toBeNull()
    expect(parseRecurrenceRule("once")).toBeNull()
    expect(parseRecurrenceRule("RRULE:FREQ=DAILY")).toBeNull()
    expect(parseRecurrenceRule(null as unknown as string)).toBeNull()
  })
})

describe("addRecurrence — day/week", () => {
  it("advances daily", () => {
    const from = new Date(Date.UTC(2026, 5, 1, 12, 0, 0)) // Jun 1
    const next = addRecurrence(from, { unit: "day", interval: 1 })
    expect(next.toISOString()).toBe("2026-06-02T12:00:00.000Z")
  })

  it("advances weekly", () => {
    const from = new Date(Date.UTC(2026, 5, 1, 12, 0, 0))
    const next = addRecurrence(from, { unit: "week", interval: 1 })
    expect(next.toISOString()).toBe("2026-06-08T12:00:00.000Z")
  })

  it("advances every:3:day", () => {
    const from = new Date(Date.UTC(2026, 5, 1, 12, 0, 0))
    const next = addRecurrence(from, { unit: "day", interval: 3 })
    expect(next.toISOString()).toBe("2026-06-04T12:00:00.000Z")
  })
})

describe("addRecurrence — month (clamping)", () => {
  it("advances same-day when target month has enough days", () => {
    const from = new Date(Date.UTC(2026, 5, 15, 12, 0, 0)) // Jun 15
    const next = addRecurrence(from, { unit: "month", interval: 1 })
    expect(next.toISOString()).toBe("2026-07-15T12:00:00.000Z")
  })

  it("clamps Jan 31 → Feb 28 (non-leap year)", () => {
    const from = new Date(Date.UTC(2026, 0, 31, 12, 0, 0))
    const next = addRecurrence(from, { unit: "month", interval: 1 })
    expect(next.toISOString()).toBe("2026-02-28T12:00:00.000Z")
  })

  it("clamps Jan 31 → Feb 29 (leap year 2028)", () => {
    const from = new Date(Date.UTC(2028, 0, 31, 12, 0, 0))
    const next = addRecurrence(from, { unit: "month", interval: 1 })
    expect(next.toISOString()).toBe("2028-02-29T12:00:00.000Z")
  })

  it("rolls over year boundary", () => {
    const from = new Date(Date.UTC(2026, 11, 15, 12, 0, 0)) // Dec 15
    const next = addRecurrence(from, { unit: "month", interval: 1 })
    expect(next.toISOString()).toBe("2027-01-15T12:00:00.000Z")
  })

  it("handles every:6:month → half-yearly rollover", () => {
    const from = new Date(Date.UTC(2026, 7, 15, 12, 0, 0)) // Aug 15
    const next = addRecurrence(from, { unit: "month", interval: 6 })
    expect(next.toISOString()).toBe("2027-02-15T12:00:00.000Z")
  })
})

describe("addRecurrence — year", () => {
  it("advances by one year", () => {
    const from = new Date(Date.UTC(2026, 5, 1, 12, 0, 0))
    const next = addRecurrence(from, { unit: "year", interval: 1 })
    expect(next.toISOString()).toBe("2027-06-01T12:00:00.000Z")
  })

  it("clamps Feb 29 to Feb 28 on non-leap year", () => {
    const from = new Date(Date.UTC(2028, 1, 29, 12, 0, 0)) // 2028 leap, Feb 29
    const next = addRecurrence(from, { unit: "year", interval: 1 })
    expect(next.toISOString()).toBe("2029-02-28T12:00:00.000Z")
  })
})

describe("nextDueDate (convenience)", () => {
  it("returns null on invalid rule", () => {
    expect(nextDueDate("2026-06-01", "garbage")).toBeNull()
  })

  it("returns null on invalid date string", () => {
    expect(nextDueDate("not-a-date", "daily")).toBeNull()
  })

  it("accepts ISO string", () => {
    const next = nextDueDate("2026-06-01T00:00:00.000Z", "daily")
    expect(next?.toISOString()).toBe("2026-06-02T00:00:00.000Z")
  })
})

describe("describeRecurrence", () => {
  it("describes presets", () => {
    expect(describeRecurrence("daily")).toBe("Daily")
    expect(describeRecurrence("weekly")).toBe("Weekly")
    expect(describeRecurrence("monthly")).toBe("Monthly")
    expect(describeRecurrence("yearly")).toBe("Yearly")
  })

  it("describes intervals", () => {
    expect(describeRecurrence("every:3:day")).toBe("Every 3 days")
    expect(describeRecurrence("every:1:week")).toBe("Weekly") // collapsed to preset
    expect(describeRecurrence("every:2:month")).toBe("Every 2 months")
  })

  it("returns raw rule on parse failure (no silent fallback)", () => {
    expect(describeRecurrence("garbage")).toBe("garbage")
  })

  it("uses translator for N>1 rules with localized unit (architect P2 regression fix)", () => {
    // The N>1 path previously interpolated raw English "week"/"month" into
    // the RU/AZ template, producing "Каждые 3 week". Translator now
    // resolves the unit key (e.g. recurrenceUnitWeek → "недели") then
    // feeds it into `recurrenceEvery`. This test stubs the translator and
    // asserts the unit key is requested with `count` so the consumer's
    // ICU plural picks the right form.
    const calls: Array<{ key: string; vars?: Record<string, unknown> }> = []
    const stubT = ((key: string, vars?: Record<string, unknown>) => {
      calls.push({ key, vars })
      if (key === "recurrenceUnitWeek") return "недели"
      if (key === "recurrenceEvery") return `Каждые ${vars?.count} ${vars?.unit}`
      return key
    }) as any
    const result = describeRecurrence("every:3:week", stubT)
    expect(result).toBe("Каждые 3 недели")
    expect(calls).toEqual([
      { key: "recurrenceUnitWeek", vars: { count: 3 } },
      { key: "recurrenceEvery", vars: { count: 3, unit: "недели" } },
    ])
  })

  it("uses preset key for interval=1 (no double translation needed)", () => {
    const calls: string[] = []
    const stubT = ((key: string) => {
      calls.push(key)
      return key
    }) as any
    expect(describeRecurrence("daily", stubT)).toBe("recurrenceDaily")
    expect(calls).toEqual(["recurrenceDaily"])
  })
})
