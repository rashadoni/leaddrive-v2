/**
 * Tests for I1 Report Builder slice 1 — date-range preset resolver.
 *
 * Pure-functional test of resolveDatePreset(preset, fixedNow, fiscalYearStartMonth).
 * No DB, no Prisma — only the date-math kernel that the report engine relies on.
 */
import { describe, it, expect } from "vitest"
import {
  resolveDatePreset,
  getDateRangePresets,
  DATE_RANGE_PRESETS,
} from "@/lib/report-engine"

/** Fixed reference: Wednesday, 14 May 2026 at 13:45 local time. */
const NOW = new Date(2026, 4, 14, 13, 45, 0) // months 0-indexed (4 = May)

function ymd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

describe("I1 Report — resolveDatePreset", () => {
  describe("day-based presets", () => {
    it("today: from start-of-today, to end-of-today", () => {
      const { from, to } = resolveDatePreset("today", NOW)
      expect(ymd(from)).toBe("2026-05-14")
      expect(from.getHours()).toBe(0)
      expect(ymd(to)).toBe("2026-05-14")
      expect(to.getHours()).toBe(23)
      expect(to.getMinutes()).toBe(59)
    })

    it("yesterday: full day before NOW", () => {
      const { from, to } = resolveDatePreset("yesterday", NOW)
      expect(ymd(from)).toBe("2026-05-13")
      expect(ymd(to)).toBe("2026-05-13")
      expect(to.getHours()).toBe(23)
    })

    it("last_7_days: inclusive 7-day window ending today", () => {
      const { from, to } = resolveDatePreset("last_7_days", NOW)
      expect(ymd(from)).toBe("2026-05-08") // 14 - 6 = 8 (inclusive of today)
      expect(ymd(to)).toBe("2026-05-14")
    })

    it("last_30_days: 30-day window", () => {
      const { from, to } = resolveDatePreset("last_30_days", NOW)
      expect(ymd(from)).toBe("2026-04-15")
      expect(ymd(to)).toBe("2026-05-14")
    })

    it("last_14_days", () => {
      const { from } = resolveDatePreset("last_14_days", NOW)
      expect(ymd(from)).toBe("2026-05-01")
    })

    it("last_90_days", () => {
      const { from } = resolveDatePreset("last_90_days", NOW)
      // 14 May - 89 days = 14 Feb 2026
      expect(ymd(from)).toBe("2026-02-14")
    })
  })

  describe("week presets (ISO Monday-start)", () => {
    it("this_week: from Monday of NOW's week to today", () => {
      // 14 May 2026 is a Thursday (verify): May 1 2026 = Friday, so May 14 = Thursday.
      const { from, to } = resolveDatePreset("this_week", NOW)
      expect(ymd(from)).toBe("2026-05-11") // Monday
      expect(ymd(to)).toBe("2026-05-14")
    })

    it("last_week: full Mon-Sun before this Monday", () => {
      const { from, to } = resolveDatePreset("last_week", NOW)
      expect(ymd(from)).toBe("2026-05-04") // Monday previous week
      expect(ymd(to)).toBe("2026-05-10") // Sunday previous week
    })

    it("this_week on Sunday still uses prior Monday", () => {
      // 17 May 2026 = Sunday
      const sunday = new Date(2026, 4, 17, 10, 0, 0)
      const { from } = resolveDatePreset("this_week", sunday)
      expect(ymd(from)).toBe("2026-05-11") // Monday before
    })

    it("this_week on Monday returns Monday itself", () => {
      const monday = new Date(2026, 4, 11, 10, 0, 0)
      const { from, to } = resolveDatePreset("this_week", monday)
      expect(ymd(from)).toBe("2026-05-11")
      expect(ymd(to)).toBe("2026-05-11")
    })

    it("last_week on Monday: prior Mon-Sun (not double-counting today)", () => {
      // Today = Monday 11 May 2026. Last week should be 4-10 May (Mon-Sun).
      const monday = new Date(2026, 4, 11, 10, 0, 0)
      const { from, to } = resolveDatePreset("last_week", monday)
      expect(ymd(from)).toBe("2026-05-04")
      expect(ymd(to)).toBe("2026-05-10")
    })
  })

  describe("month presets", () => {
    it("this_month: from day-1 to today", () => {
      const { from, to } = resolveDatePreset("this_month", NOW)
      expect(ymd(from)).toBe("2026-05-01")
      expect(ymd(to)).toBe("2026-05-14")
    })

    it("last_month: April 2026 in full", () => {
      const { from, to } = resolveDatePreset("last_month", NOW)
      expect(ymd(from)).toBe("2026-04-01")
      expect(ymd(to)).toBe("2026-04-30")
      expect(to.getHours()).toBe(23)
    })

    it("last_month from January rolls back to December", () => {
      const jan = new Date(2026, 0, 15)
      const { from, to } = resolveDatePreset("last_month", jan)
      expect(ymd(from)).toBe("2025-12-01")
      expect(ymd(to)).toBe("2025-12-31")
    })

    it("last_month handles Feb→Jan boundary (31 days)", () => {
      const feb = new Date(2026, 1, 5) // 5 Feb 2026
      const { from, to } = resolveDatePreset("last_month", feb)
      expect(ymd(from)).toBe("2026-01-01")
      expect(ymd(to)).toBe("2026-01-31")
    })

    it("last_month: March in leap year → Feb 1-29", () => {
      // March 2024 is in a leap year; last_month should be Feb 1-29 2024.
      const mar2024 = new Date(2024, 2, 10)
      const { from, to } = resolveDatePreset("last_month", mar2024)
      expect(ymd(from)).toBe("2024-02-01")
      expect(ymd(to)).toBe("2024-02-29")
    })

    it("last_month: March in non-leap year → Feb 1-28", () => {
      const mar2025 = new Date(2025, 2, 10)
      const { from, to } = resolveDatePreset("last_month", mar2025)
      expect(ymd(from)).toBe("2025-02-01")
      expect(ymd(to)).toBe("2025-02-28")
    })
  })

  describe("quarter presets", () => {
    it("this_quarter: Q2 2026 starts April", () => {
      const { from, to } = resolveDatePreset("this_quarter", NOW)
      expect(ymd(from)).toBe("2026-04-01")
      expect(ymd(to)).toBe("2026-05-14")
    })

    it("last_quarter: Q1 (Jan-Mar) when NOW in Q2", () => {
      const { from, to } = resolveDatePreset("last_quarter", NOW)
      expect(ymd(from)).toBe("2026-01-01")
      expect(ymd(to)).toBe("2026-03-31")
    })

    it("last_quarter wraps from Q1 → previous year Q4", () => {
      const feb = new Date(2026, 1, 5)
      const { from, to } = resolveDatePreset("last_quarter", feb)
      expect(ymd(from)).toBe("2025-10-01")
      expect(ymd(to)).toBe("2025-12-31")
    })

    it("this_quarter Q3 starts July", () => {
      const aug = new Date(2026, 7, 15)
      const { from } = resolveDatePreset("this_quarter", aug)
      expect(ymd(from)).toBe("2026-07-01")
    })

    it("this_quarter Q4 starts October", () => {
      const nov = new Date(2026, 10, 5)
      const { from } = resolveDatePreset("this_quarter", nov)
      expect(ymd(from)).toBe("2026-10-01")
    })
  })

  describe("year presets", () => {
    it("this_year: from Jan 1 to today", () => {
      const { from, to } = resolveDatePreset("this_year", NOW)
      expect(ymd(from)).toBe("2026-01-01")
      expect(ymd(to)).toBe("2026-05-14")
    })

    it("last_year: full year 2025", () => {
      const { from, to } = resolveDatePreset("last_year", NOW)
      expect(ymd(from)).toBe("2025-01-01")
      expect(ymd(to)).toBe("2025-12-31")
    })
  })

  describe("fiscal year (configurable start month)", () => {
    it("calendar year (default fiscalYearStartMonth=1) matches this_year", () => {
      const fy = resolveDatePreset("this_fiscal_year", NOW)
      const cy = resolveDatePreset("this_year", NOW)
      expect(ymd(fy.from)).toBe(ymd(cy.from))
      expect(ymd(fy.to)).toBe(ymd(cy.to))
    })

    it("fiscal year starting April: NOW (May 14) is in FY26 which started Apr 1, 2026", () => {
      const { from, to } = resolveDatePreset("this_fiscal_year", NOW, 4)
      expect(ymd(from)).toBe("2026-04-01")
      expect(ymd(to)).toBe("2026-05-14")
    })

    it("fiscal year starting April: NOW (March 2026) is still in FY25 starting Apr 2025", () => {
      const march = new Date(2026, 2, 20)
      const { from } = resolveDatePreset("this_fiscal_year", march, 4)
      expect(ymd(from)).toBe("2025-04-01")
    })

    it("last_fiscal_year: when in FY26 (Apr-start), last FY is Apr 2025 — Mar 2026", () => {
      const { from, to } = resolveDatePreset("last_fiscal_year", NOW, 4)
      expect(ymd(from)).toBe("2025-04-01")
      expect(ymd(to)).toBe("2026-03-31")
    })

    it("clamps invalid fiscalYearStartMonth to 1", () => {
      const fyInvalid = resolveDatePreset("this_fiscal_year", NOW, -5)
      const cy = resolveDatePreset("this_year", NOW)
      expect(ymd(fyInvalid.from)).toBe(ymd(cy.from))
    })

    it("clamps fiscalYearStartMonth > 12 to 12", () => {
      const fy = resolveDatePreset("this_fiscal_year", NOW, 99)
      // FY starts December → NOW (May) is in FY that started Dec 2025
      expect(ymd(fy.from)).toBe("2025-12-01")
    })
  })

  describe("contracts", () => {
    it("from is always <= to for every preset", () => {
      for (const preset of DATE_RANGE_PRESETS) {
        const { from, to } = resolveDatePreset(preset, NOW)
        expect(from.getTime()).toBeLessThanOrEqual(to.getTime())
      }
    })

    it("to is end-of-day (23:59:59.999) for closed-window presets", () => {
      // Closed = doesn't include "today" as upper bound
      const closed: typeof DATE_RANGE_PRESETS[number][] = ["yesterday", "last_week", "last_month", "last_quarter", "last_year", "last_fiscal_year"]
      for (const preset of closed) {
        const { to } = resolveDatePreset(preset, NOW)
        expect(to.getHours()).toBe(23)
        expect(to.getMinutes()).toBe(59)
        expect(to.getSeconds()).toBe(59)
      }
    })
  })

  describe("getDateRangePresets catalog", () => {
    it("returns all preset keys with labels", () => {
      const list = getDateRangePresets()
      expect(list).toHaveLength(DATE_RANGE_PRESETS.length)
      const keys = list.map(p => p.key).sort()
      const expected = [...DATE_RANGE_PRESETS].sort()
      expect(keys).toEqual(expected as any)
      expect(list.every(p => typeof p.label === "string" && p.label.length > 0)).toBe(true)
    })

    it("DATE_RANGE_PRESETS is a `readonly` tuple — caller can iterate but not mutate", () => {
      // Compile-time: DATE_RANGE_PRESETS is `readonly` so .push() would type-error.
      // Runtime sanity: still array-iterable.
      const arr: readonly string[] = DATE_RANGE_PRESETS
      expect(arr.length).toBeGreaterThan(0)
      expect(arr.includes("today")).toBe(true)
    })
  })
})
