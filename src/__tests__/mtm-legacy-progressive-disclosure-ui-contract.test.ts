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

  // Owner 2026-09-26: «аналитика нужна для менеджеров», «убери дублирования».
  it("opens on the team's results; the formula registry is folded and loads only when opened; the old overview is gone", () => {
    expect(analytics.indexOf("<MtmTeamResults")).toBeLessThan(analytics.indexOf("<details"))
    expect(analytics.indexOf("<details")).toBeLessThan(analytics.indexOf("<ExplainableKpiDashboard"))
    expect(analytics).toContain("{formulasOpen ? <div")
    expect(analytics).toContain("onToggle={(event) => setFormulasOpen(event.currentTarget.open)}")
    expect(analytics).not.toMatch(/<details[^>]*\sopen(?:=|\s|>)/)
    // The second formula on the server's clock, and a client's name as a heading.
    expect(analytics).not.toContain("/api/v1/mtm/analytics")
    expect(analytics).not.toContain("marsKpi")
    expect(analytics).not.toContain("kpiTotalVisits")
  })
})
