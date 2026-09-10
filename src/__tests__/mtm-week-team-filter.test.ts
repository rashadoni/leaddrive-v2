import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { visibleWeekPlanAgents } from "@/lib/mtm/week-plan-agents"

/**
 * Field UX audit 2026-09-05, the open tail of task C7: a team filter for the
 * team week (RUX-602).
 *
 * The tail was recorded as "not just threading a field through", and it was
 * right. The grid builds its rows from three sources — the `/mtm/agents`
 * response, `route.agent` and `assignment.agent` — and only the first carried
 * a team. A filter over that merged list would have silently dropped every
 * agent who reached the week through a route, which is exactly the half a
 * manager scrolling this grid is looking for.
 *
 * So the fix is in the API first: the team travels with the name on every
 * route path. Then the filter can be honest.
 */
const ROUTES_API = "src/app/api/v1/mtm/routes/route.ts"
const GRID = "src/components/mtm/route-week-plan.tsx"

describe("C7 tail: filtering the team week by team", () => {
  it("sends the team with the agent on every route path", () => {
    const api = readFileSync(ROUTES_API, "utf8")
    expect(api).toContain("const routeAgentSelect = {")
    expect(api).toContain("teamId: true,")
    expect(api).toContain("team: { select: { id: true, name: true } },")
    // Both paths read the same select, so they cannot drift apart again.
    expect(api).toContain("agent: { select: routeAgentSelect },")
    expect(api).toContain("include: { agent: { select: { ...routeAgentSelect, role: true } } },")
  })

  it("keeps the team on rows merged from the routes, not only from the list", () => {
    const grid = readFileSync(GRID, "utf8")
    expect(grid).toContain("const byId = new Map<string, RouteAgent>()")
    expect(grid).toContain("teamId?: string | null")
    expect(grid).toContain("team?: { id: string; name: string } | null")
  })

  it("offers only the teams that have a row in this week", () => {
    const grid = readFileSync(GRID, "utf8")
    expect(grid).toContain('data-testid="mtm-week-team-filter"')
    expect(grid).toContain("if (agent.team?.id && agent.team.name) byId.set(agent.team.id, agent.team.name)")
    // One team is not a choice; the control appears when there is something
    // to choose between.
    expect(grid).toContain("{teams.length > 1 ? (")
  })

  it("narrows to the chosen team and says nothing when nobody matches", () => {
    const roster = [
      { id: "a", name: "Anar", teamId: "north", team: { id: "north", name: "North" } },
      { id: "b", name: "Bahar", teamId: "south", team: { id: "south", name: "South" } },
      { id: "c", name: "Cavid", teamId: null, team: null },
    ]
    expect(visibleWeekPlanAgents(roster, { teamId: "north" }).map((a) => a.id)).toEqual(["a"])
    expect(visibleWeekPlanAgents(roster, { teamId: "west" })).toEqual([])
    // No team chosen means every row, including the one with no team at all.
    expect(visibleWeekPlanAgents(roster, { teamId: null }).map((a) => a.id)).toEqual(["a", "b", "c"])
  })

  it("combines with the search rather than replacing it", () => {
    const roster = [
      { id: "a", name: "Anar", teamId: "north" },
      { id: "b", name: "Aysel", teamId: "south" },
      { id: "c", name: "[QA-1] Robot", teamId: "north" },
    ]
    expect(visibleWeekPlanAgents(roster, { search: "a", teamId: "north" }).map((a) => a.id)).toEqual(["a"])
  })

  it("has the control's labels in all three languages", () => {
    const missing: string[] = []
    for (const locale of ["en", "ru", "az"]) {
      const messages = JSON.parse(readFileSync(`messages/${locale}.json`, "utf8"))
      const routes = messages.mtmRoutesPage ?? {}
      for (const key of ["weekTeamFilter", "weekTeamAll"]) {
        if (typeof routes[key] !== "string" || !routes[key].trim()) missing.push(`${locale}.${key}`)
      }
    }
    expect(missing).toEqual([])
  })
})
