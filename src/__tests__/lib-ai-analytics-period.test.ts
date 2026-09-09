import { describe, expect, it } from "vitest"
import { resolveAnalyticsPeriod } from "@/lib/ai/analytics-period"

const NOW = new Date("2026-08-11T12:34:56.000Z") // 16:34 in Asia/Baku (UTC+4)

describe("resolveAnalyticsPeriod", () => {
  it("resolves today from Baku midnight to the captured current instant", () => {
    const period = resolveAnalyticsPeriod({ period: "today" }, NOW, "Asia/Baku")
    expect(period.from.toISOString()).toBe("2026-08-10T20:00:00.000Z")
    expect(period.toExclusive.toISOString()).toBe(NOW.toISOString())
    expect(period.dateFrom).toBe("2026-08-11")
    expect(period.dateTo).toBe("2026-08-11")
    expect(period.timezone).toBe("Asia/Baku")
  })

  it("starts this week on Monday in Asia/Baku", () => {
    const period = resolveAnalyticsPeriod({ period: "this_week" }, NOW, "Asia/Baku")
    expect(period.from.toISOString()).toBe("2026-08-09T20:00:00.000Z")
    expect(period.toExclusive.toISOString()).toBe(NOW.toISOString())
    expect(period.dateFrom).toBe("2026-08-10")
  })

  it("starts this month at local calendar midnight", () => {
    const period = resolveAnalyticsPeriod({ period: "this_month" }, NOW, "Asia/Baku")
    expect(period.from.toISOString()).toBe("2026-07-31T20:00:00.000Z")
    expect(period.toExclusive.toISOString()).toBe(NOW.toISOString())
    expect(period.dateFrom).toBe("2026-08-01")
  })

  it("distinguishes rolling week/month windows from calendar periods", () => {
    const week = resolveAnalyticsPeriod({ period: "last_7_days" }, NOW, "Asia/Baku")
    const month = resolveAnalyticsPeriod({ period: "last_30_days" }, NOW, "Asia/Baku")
    expect(week.from.toISOString()).toBe("2026-08-04T12:34:56.000Z")
    expect(month.from.toISOString()).toBe("2026-07-12T12:34:56.000Z")
    expect(week.toExclusive.toISOString()).toBe(NOW.toISOString())
    expect(month.toExclusive.toISOString()).toBe(NOW.toISOString())
  })

  it("treats custom dateTo as an inclusive local calendar date", () => {
    const period = resolveAnalyticsPeriod({
      period: "custom",
      dateFrom: "2026-08-01",
      dateTo: "2026-08-11",
    }, NOW, "Asia/Baku")
    expect(period.from.toISOString()).toBe("2026-07-31T20:00:00.000Z")
    expect(period.toExclusive.toISOString()).toBe("2026-08-11T20:00:00.000Z")
    expect(period.dateTo).toBe("2026-08-11")
  })

  it("keeps half-open local days correct across a DST transition", () => {
    const period = resolveAnalyticsPeriod({
      period: "custom",
      dateFrom: "2026-03-29",
      dateTo: "2026-03-29",
    }, new Date("2026-04-01T00:00:00.000Z"), "Europe/Warsaw")
    expect(period.from.toISOString()).toBe("2026-03-28T23:00:00.000Z")
    expect(period.toExclusive.toISOString()).toBe("2026-03-29T22:00:00.000Z")
    expect(period.toExclusive.getTime() - period.from.getTime()).toBe(23 * 60 * 60 * 1000)
  })

  it("rejects invalid and reversed custom dates", () => {
    expect(() => resolveAnalyticsPeriod({
      period: "custom",
      dateFrom: "2026-02-30",
      dateTo: "2026-03-01",
    }, NOW, "Asia/Baku")).toThrow("Invalid calendar date")
    expect(() => resolveAnalyticsPeriod({
      period: "custom",
      dateFrom: "2026-08-12",
      dateTo: "2026-08-11",
    }, NOW, "Asia/Baku")).toThrow("dateFrom")
  })
})
