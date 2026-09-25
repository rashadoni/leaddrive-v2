import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { AGENT_PERIOD_MAX_DAYS, agentPeriodRange } from "@/components/mtm/agent-period-view"

/**
 * Owner 2026-09-25: «a manager wants to see what one field agent did over a
 * period — here there is only a week». One agent, any period up to a month.
 */
describe("one agent over a period", () => {
  it("keeps the period the reader chose, up to a month, never reversed", () => {
    expect(agentPeriodRange("2026-09-19", "2026-09-25")).toEqual({ from: "2026-09-19", to: "2026-09-25" })
    // Longer than a month: the last 31 days up to the chosen end.
    expect(AGENT_PERIOD_MAX_DAYS).toBe(31)
    expect(agentPeriodRange("2026-06-01", "2026-09-25")).toEqual({ from: "2026-08-26", to: "2026-09-25" })
    // An end before the start collapses to the start day.
    expect(agentPeriodRange("2026-09-25", "2026-09-20")).toEqual({ from: "2026-09-25", to: "2026-09-25" })
  })

  it("is its own tab beside the others and reads the existing routes and visits APIs", () => {
    const page = readFileSync("src/app/(dashboard)/mtm/routes/page.tsx", "utf8")
    expect(page).toContain('data-testid="mtm-routes-view-agent"')
    expect(page).toContain('<MtmAgentPeriodView timezone={timezone}')
    const view = readFileSync("src/components/mtm/agent-period-view.tsx", "utf8")
    expect(view).toContain("/api/v1/mtm/routes?")
    expect(view).toContain("endExclusive: addDays(range.to, 1)")
    expect(view).toContain("/api/v1/mtm/visits?")
    // Visit times are cut at the tenant's midnight, not UTC's.
    expect(view).toContain("localDateTimeToUtc(`${range.from}T00:00`, timezone)")
    expect(view).toContain("/mtm/map?mode=history&agentId=")
  })
})
