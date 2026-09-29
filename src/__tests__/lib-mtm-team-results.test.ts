import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { mtmPlanTone, mtmTeamResultsByAgent } from "@/lib/mtm/team-results"
import { REPORT_TYPES } from "@/lib/mtm/report-config"

/**
 * Owner 2026-09-26: «аналитика нужна для менеджеров». The manager's rows are
 * the formula registry's own facts grouped by agent — one calculation, shown
 * two ways — with who is behind first.
 */
const plan = (agentId: string, agentName: string, completed: boolean) => ({ agentId, agentName, completed })
const visit = (agentId: string, agentName: string, gpsConfirmed: boolean) => ({ agentId, agentName, gpsConfirmed })

describe("team results by agent", () => {
  // Like prod on 22.09: every route closed at 3 of 5, one agent visiting without a plan.
  const rows = mtmTeamResultsByAgent({
    planDenominator: [
      ...Array.from({ length: 5 }, (_, i) => plan("kamran", "Kamran Abbasov", i < 3)),
      ...Array.from({ length: 5 }, () => plan("nigar", "Nigar Əlizadə", true)),
      ...Array.from({ length: 4 }, (_, i) => plan("tural", "Tural Hüseynov", i < 3)),
    ],
    gpsDenominator: [
      visit("kamran", "Kamran Abbasov", true), visit("kamran", "Kamran Abbasov", true), visit("kamran", "Kamran Abbasov", false),
      ...Array.from({ length: 5 }, () => visit("nigar", "Nigar Əlizadə", true)),
      visit("anar", "Anar Məmmədov", true),
    ],
  })

  it("puts who is behind first and agents without a plan last", () => {
    expect(rows.map((row) => [row.agentName, row.planPercent])).toEqual([
      ["Kamran Abbasov", 60],
      ["Tural Hüseynov", 75],
      ["Nigar Əlizadə", 100],
      ["Anar Məmmədov", null],
    ])
  })

  it("counts stops, visits and visits with GPS per agent, adding up to the registry's totals", () => {
    expect(rows.find((row) => row.agentId === "kamran")).toMatchObject({ planned: 5, done: 3, visits: 3, withGps: 2 })
    expect(rows.reduce((sum, row) => sum + row.planned, 0)).toBe(14)
    expect(rows.reduce((sum, row) => sum + row.visits, 0)).toBe(9)
  })

  it("colours plan by the same bands everywhere", () => {
    expect([mtmPlanTone(96), mtmPlanTone(80), mtmPlanTone(79), mtmPlanTone(null)]).toEqual(["good", "warn", "bad", "none"])
  })
})

describe("the manager's analytics screen", () => {
  const view = readFileSync("src/components/mtm/team-results.tsx", "utf8")

  it("reads the registry's endpoint, not a second formula", () => {
    expect(view).toContain("fetch(`/api/v1/mtm/kpi?${params.toString()}`")
    expect(view).toContain("mtmTeamResultsByAgent(report.drilldown)")
    expect(view).not.toContain("/api/v1/mtm/analytics")
  })

  it("links each agent to what they did over a period", () => {
    expect(view).toContain("href={`/mtm/calendar?view=agent&agentId=${encodeURIComponent(row.agentId)}`}")
    const routes = readFileSync("src/app/(dashboard)/mtm/routes/page.tsx", "utf8")
    expect(routes).toContain('initialAgentId={capabilities.canReview ? searchParams.get("agentId") : capabilities.actorAgentId}')
  })

  it("wraps its table so a narrow screen scrolls the table, not the page", () => {
    expect(view).toContain('<div className="overflow-x-auto">\n                <table data-testid="mtm-team-results-agents"')
  })
})

describe("reports without duplicates (owner 2026-09-26)", () => {
  it("offers one route report — plan and execution by the route's date", () => {
    expect(REPORT_TYPES).not.toContain("route")
    expect(REPORT_TYPES).toContain("route_execution")
  })
})
