import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { teamRowWhereabouts } from "@/lib/mtm/team-today-summary"
import { buildMtmTeamTodayRows } from "@/lib/mtm/week-team-today"

/**
 * Owner 2026-09-22 on the Panel: «here it should be the other way round —
 * who is going where, who is where». Each row now starts with that.
 */
const visit = (status: string, checkInAt: string, checkOutAt: string | null, customerName = "Aptek 12") =>
  ({ customerName, status, checkInAt, checkOutAt })

describe("where a team row says the agent is", () => {
  it("is at a customer during an open visit", () => {
    expect(teamRowWhereabouts({ visits: [visit("CHECKED_OUT", "2026-09-22T06:00:00Z", "2026-09-22T06:30:00Z", "A"), visit("CHECKED_IN", "2026-09-22T10:10:00Z", null, "B")], nextStop: { customerName: "C", plannedAt: null } }))
      .toEqual({ kind: "at-customer", customerName: "B", since: "2026-09-22T10:10:00Z" })
  })

  it("is heading to the next planned stop between visits", () => {
    expect(teamRowWhereabouts({ visits: [visit("CHECKED_OUT", "2026-09-22T06:00:00Z", "2026-09-22T06:30:00Z")], nextStop: { customerName: "Zeytun Market", plannedAt: "2026-09-22T11:15:00Z" } }))
      .toEqual({ kind: "heading", customerName: "Zeytun Market", plannedAt: "2026-09-22T11:15:00Z" })
  })

  it("has closed the day, or was last seen at a customer, or says nothing", () => {
    expect(teamRowWhereabouts({ visits: [], nextStop: { customerName: "X", plannedAt: null }, workday: { kind: "finished", at: "2026-09-22T13:40:00Z" }, route: { visited: 5, total: 5 } }))
      .toEqual({ kind: "day-done", at: "2026-09-22T13:40:00Z", visited: 5, total: 5 })
    expect(teamRowWhereabouts({ visits: [visit("CHECKED_OUT", "2026-09-22T06:00:00Z", "2026-09-22T06:30:00Z")], nextStop: null }))
      .toEqual({ kind: "last-visit", customerName: "Aptek 12", until: "2026-09-22T06:30:00Z" })
    expect(teamRowWhereabouts({ visits: [], nextStop: null })).toBeNull()
  })
})

describe("the team rows carry the next stop", () => {
  it("takes the earliest pending stop across today's routes", () => {
    const [row] = buildMtmTeamTodayRows({
      now: new Date("2026-09-22T08:00:00Z"),
      todayKey: "2026-09-22",
      workforceEnabled: false,
      agents: [{ id: "a1", name: "Günel" }],
      latestLocations: [],
      routes: [{
        agentId: "a1", status: "IN_PROGRESS", totalPoints: 5, visitedPoints: 2,
        points: [{ orderIndex: 3, plannedTime: new Date("2026-09-22T11:15:00Z"), customer: { name: "Zeytun Market" } }],
      }],
      visits: [],
      openAlertCounts: [],
      workdays: [],
    })
    expect(row.nextStop).toEqual({ customerName: "Zeytun Market", plannedAt: "2026-09-22T11:15:00.000Z" })
  })

  it("reads only the first pending stop of each route, and the Panel shows who is where before problems", () => {
    const route = readFileSync("src/app/api/v1/mtm/week/team/route.ts", "utf8")
    expect(route).toContain('where: { deletedAt: null, status: "PENDING" }')
    expect(route).toContain("take: 1,")
    const ui = readFileSync("src/components/mtm/operational-week-home.tsx", "utf8")
    expect(ui).toContain('data-testid="mtm-week-team-row-where"')
    expect(ui.indexOf('summary.active.map((entry) => renderTeamRow(entry, "active"))'))
      .toBeLessThan(ui.indexOf('summary.problems.map((entry) => renderTeamRow(entry, "problem"))'))
    expect(ui).toContain("href={`/mtm/map?agentId=${encodeURIComponent(row.agentId)}`}")
  })
})
