import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const dashboard = readFileSync("src/app/(dashboard)/mtm/page.tsx", "utf8")
const analytics = readFileSync("src/app/(dashboard)/mtm/analytics/page.tsx", "utf8")

describe("MTM legacy dashboard progressive disclosure", () => {
  it("no longer carries the legacy dashboard block on the Panel", () => {
    // Prod audit 2026-09-14: the collapsed «Əvvəlki əməliyyat icmalı» showed
    // avg visit time as route time, «0 saat» work time and all-time warnings
    // as off-route. It is gone, together with its fetch.
    expect(dashboard).toContain("<OperationalWeekHome")
    expect(dashboard).not.toContain("<details")
    expect(dashboard).not.toContain("/api/v1/mtm/dashboard")
    expect(dashboard).not.toContain("kpiPlannedRoutes")
    expect(dashboard).not.toContain("avgRouteTime")
    expect(dashboard).toContain("operational?.timezone")
  })

  it("keeps legacy analytics closed after the explainable dashboard and fetches only on demand", () => {
    expect(analytics.indexOf("<ExplainableKpiDashboard")).toBeLessThan(analytics.indexOf("<details"))
    expect(analytics).toContain("if (!legacyOpen) return")
    expect(analytics).toContain("void fetchAnalytics(controller.signal)")
    expect(analytics).toContain("onToggle={(event) => setLegacyOpen(event.currentTarget.open)}")
    expect(analytics).not.toMatch(/<details[^>]*\sopen(?:=|\s|>)/)
    expect(analytics.indexOf("<details")).toBeLessThan(analytics.indexOf("kpiTotalVisits"))
  })
})
