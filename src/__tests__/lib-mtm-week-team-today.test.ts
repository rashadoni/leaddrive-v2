import { describe, expect, it } from "vitest"
import { buildMtmTeamTodayRows, MTM_TEAM_TODAY_VISITS_PER_ROW } from "@/lib/mtm/week-team-today"

const NOW = new Date("2026-09-14T11:00:00.000Z")

describe("team today rows", () => {
  it("combines GPS, routes, visits, alerts and the manager workday per agent", () => {
    const rows = buildMtmTeamTodayRows({
      now: NOW,
      todayKey: "2026-09-14",
      workforceEnabled: true,
      agents: [
        { id: "anar", name: "Anar Mammadov", team: { id: "t1", name: "Baku" } },
        { id: "leyla", name: "Leyla", team: null },
      ],
      latestLocations: [
        { agentId: "anar", recordedAt: new Date("2026-09-14T10:40:00.000Z") },
        { agentId: "anar", recordedAt: new Date("2026-09-14T10:55:00.000Z") },
      ],
      routes: [{ agentId: "anar", status: "COMPLETED", totalPoints: 2, visitedPoints: 2 }],
      visits: [
        { id: "v2", agentId: "anar", status: "CHECKED_OUT", checkInAt: new Date("2026-09-14T12:46:00.000Z"), checkOutAt: new Date("2026-09-14T13:09:00.000Z"), customer: { name: "Aptek 2" } },
        { id: "v1", agentId: "anar", status: "CHECKED_OUT", checkInAt: new Date("2026-09-14T08:00:00.000Z"), checkOutAt: new Date("2026-09-14T08:20:00.000Z"), customer: { name: "Aptek 1" } },
      ],
      openAlertCounts: [{ agentId: "anar", count: 18 }],
      workdays: [
        { agentId: "anar", status: "STARTED", workDate: new Date("2026-09-11T00:00:00.000Z"), startedAt: new Date("2026-09-11T16:57:00.000Z"), pausedAt: null, completedAt: null },
      ],
    })
    expect(rows[0]).toMatchObject({
      agent: { id: "anar", name: "Anar Mammadov", teamName: "Baku" },
      lastGpsAt: "2026-09-14T10:55:00.000Z",
      route: { visited: 2, total: 2, state: "FINISHED" },
      openAlerts: 18,
      workday: { kind: "left-open", days: 3 },
    })
    expect(rows[0].visits.map((visit) => visit.id)).toEqual(["v1", "v2"])
    expect(rows[0].visitCount).toBe(2)
    expect(rows[1]).toMatchObject({ lastGpsAt: null, route: null, visits: [], openAlerts: 0, workday: { kind: "not-started" } })
  })

  it("omits workday facts when Workforce is not enabled and caps visits per row", () => {
    const visits = Array.from({ length: MTM_TEAM_TODAY_VISITS_PER_ROW + 3 }, (_, index) => ({
      id: `v${index}`,
      agentId: "a",
      status: "CHECKED_OUT",
      checkInAt: new Date(NOW.getTime() - (20 - index) * 60_000),
      checkOutAt: null,
    }))
    const [row] = buildMtmTeamTodayRows({
      now: NOW,
      todayKey: "2026-09-14",
      workforceEnabled: false,
      agents: [{ id: "a", name: "A" }],
      latestLocations: [],
      routes: [],
      visits,
      openAlertCounts: [],
      workdays: [{ agentId: "a", status: "STARTED", workDate: new Date("2026-09-11T00:00:00.000Z"), startedAt: new Date("2026-09-11T10:00:00.000Z"), pausedAt: null, completedAt: null }],
    })
    expect(row.workday).toBeNull()
    expect(row.visits).toHaveLength(MTM_TEAM_TODAY_VISITS_PER_ROW)
    // Review of #210: the newest six, in time order — not the morning.
    expect(row.visits.map((visit) => visit.id)).toEqual(["v3", "v4", "v5", "v6", "v7", "v8"])
    expect(row.visitCount).toBe(MTM_TEAM_TODAY_VISITS_PER_ROW + 3)
  })
})
