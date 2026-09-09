import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const dashboard = readFileSync("src/app/(dashboard)/mtm/page.tsx", "utf8")
const analytics = readFileSync("src/app/(dashboard)/mtm/analytics/page.tsx", "utf8")

describe("MTM legacy dashboard progressive disclosure", () => {
  it("keeps the established dashboard closed after the operational week and loads it on demand", () => {
    expect(dashboard.indexOf("<OperationalWeekHome")).toBeLessThan(dashboard.indexOf("<details"))
    expect(dashboard).toContain("if (!legacyOpen) return")
    expect(dashboard).toContain("onToggle={(event) => setLegacyOpen(event.currentTarget.open)}")
    expect(dashboard).not.toMatch(/<details[^>]*\sopen(?:=|\s|>)/)
    expect(dashboard.indexOf("<details")).toBeLessThan(dashboard.indexOf("kpiPlannedRoutes"))
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
