import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { planShareInRange, previousReportRange, reportDailySeries, resolveReportRange } from "@/lib/mtm/report-period"
import { previousRangeKeys } from "@/lib/mtm/report-range-keys"
import { REPORT_GROUPS, REPORT_TYPES, reportRowHref } from "@/lib/mtm/report-config"

// Owner, 2026-11-01: «отчётность не доработана… нет от какой даты до какой даты».
const BAKU = "Asia/Baku"
const range = (query: string, today = "2026-11-04") => {
  const resolved = resolveReportRange(new URLSearchParams(query), today, BAKU)
  if ("error" in resolved) throw new Error(resolved.error)
  return resolved
}

describe("the period of an MTM report", () => {
  it("reads the presets as a manager says them, in the organization's days", () => {
    // 2026-11-04 is a Wednesday.
    expect([range("period=today").fromKey, range("period=today").toKey]).toEqual(["2026-11-04", "2026-11-04"])
    expect(range("period=week").fromKey).toBe("2026-11-02")
    expect(range("period=month").fromKey).toBe("2026-11-01")
    expect([range("period=lastMonth").fromKey, range("period=lastMonth").toKey]).toEqual(["2026-10-01", "2026-10-31"])
    expect(range("period=quarter").fromKey).toBe("2026-10-01")
    expect(range("period=quarter", "2026-03-15").fromKey).toBe("2026-01-01")
    // Baku midnight is 20:00 UTC the day before; the end is the next local midnight.
    expect(range("period=today").start.toISOString()).toBe("2026-11-03T20:00:00.000Z")
    expect(range("period=today").end.toISOString()).toBe("2026-11-04T20:00:00.000Z")
  })

  it("takes the manager's own two days, and refuses them turned around or longer than a year", () => {
    expect(range("from=2026-06-01&to=2026-06-30")).toMatchObject({ preset: "custom", fromKey: "2026-06-01", toKey: "2026-06-30", days: 30 })
    expect(resolveReportRange(new URLSearchParams("from=2026-06-30&to=2026-06-01"), "2026-11-04", BAKU)).toEqual({ error: "invalid_range" })
    expect(resolveReportRange(new URLSearchParams("from=2026-06-01"), "2026-11-04", BAKU)).toEqual({ error: "invalid_range" })
    expect(resolveReportRange(new URLSearchParams("from=2025-01-01&to=2026-06-01"), "2026-11-04", BAKU)).toEqual({ error: "range_too_long" })
  })

  it("compares with as many days right before, on the server and on the page alike", () => {
    const previous = previousReportRange(range("from=2026-10-10&to=2026-10-16"), BAKU)
    expect([previous.fromKey, previous.toKey]).toEqual(["2026-10-03", "2026-10-09"])
    expect(previousRangeKeys("2026-10-10", "2026-10-16")).toEqual({ from: "2026-10-03", to: "2026-10-09" })
    expect(previousRangeKeys("2026-03-01", "2026-03-31")).toEqual({ from: "2026-01-29", to: "2026-02-28" })
  })

  it("draws every day of the range, the empty ones as 0, by the organization's day", () => {
    const series = reportDailySeries([
      { at: new Date("2026-11-02T21:30:00Z") }, // 01:30 on the 3rd in Baku
      { at: new Date("2026-11-02T08:00:00Z"), value: 2 },
    ], range("period=week"), BAKU)
    expect(series).toEqual([
      { date: "2026-11-02", count: 2 },
      { date: "2026-11-03", count: 1 },
      { date: "2026-11-04", count: 0 },
    ])
  })

  it("counts the part of a monthly sales plan that falls into the range", () => {
    expect(planShareInRange(new Date("2026-11-01T00:00:00Z"), { fromKey: "2026-11-01", toKey: "2026-11-30" })).toBe(1)
    expect(planShareInRange(new Date("2026-11-01T00:00:00Z"), { fromKey: "2026-11-02", toKey: "2026-11-08" })).toBeCloseTo(7 / 30)
    // A plan that began before the range is not lost any more.
    expect(planShareInRange(new Date("2026-10-01T00:00:00Z"), { fromKey: "2026-10-30", toKey: "2026-11-05" })).toBeCloseTo(2 / 31)
    expect(planShareInRange(new Date("2026-09-01T00:00:00Z"), { fromKey: "2026-11-02", toKey: "2026-11-08" })).toBe(0)
  })
})

describe("the reports page", () => {
  it("puts every report in exactly one group", () => {
    expect(REPORT_GROUPS.flatMap((group) => group.types).sort()).toEqual([...REPORT_TYPES].sort())
  })

  it("opens the visit, the route or the employee from a row", () => {
    expect(reportRowHref("visit", { id: "v1" })).toBe("/mtm/visits?visitId=v1")
    expect(reportRowHref("promises", { id: "v2" })).toBe("/mtm/visits?visitId=v2")
    expect(reportRowHref("route_execution", { id: "r1" })).toBe("/mtm/routes?routeId=r1")
    expect(reportRowHref("agent", { id: "a1" })).toBe("/mtm/agents/a1")
    expect(reportRowHref("action_compliance", { id: 3 })).toBeNull()
  })

  it("asks the API for the chosen period, team, region and agent, and the export in the reader's language", () => {
    const page = readFileSync("src/app/(dashboard)/mtm/reports/page.tsx", "utf8")
    for (const param of ['params.set("from", from)', 'params.set("teamId", teamId)', 'params.set("regionId", regionId)', 'params.set("agentId", agentId)']) expect(page).toContain(param)
    expect(page).toContain("format=xlsx&lang=${locale}")
    expect(page).toContain("const showsChart = series.length > 1")
  })
})
