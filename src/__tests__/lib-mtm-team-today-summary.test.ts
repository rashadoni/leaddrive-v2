import { describe, expect, it } from "vitest"
import { classifyTeamRow, summarizeTeamToday, teamTodayForScope, teamTodayScopeKey, type TeamTodayRowInput } from "@/lib/mtm/team-today-summary"
import type { MtmManagerWorkdayState } from "@/lib/mtm/workday-open-anomaly"

/**
 * Behaviour of the Panel summary line on rows shaped like prod 2026-09-21:
 * 17 agents, three shifts nobody closed (19 days, 2 days, 17 hours), no
 * plans, no GPS, no visits. Assertions are on the structure, never on text.
 */

const OPTIONS = { workdayEnabled: true, partial: false, visitsTruncated: false }

function row(overrides: Partial<TeamTodayRowInput> & { agentId: string }): TeamTodayRowInput {
  return {
    name: overrides.agentId,
    teamName: null,
    lastGpsAt: null,
    route: null,
    visits: [],
    visitCount: 0,
    openAlerts: 0,
    workday: { kind: "not-started" },
    ...overrides,
  }
}

function leftOpen(hours: number, days: number): MtmManagerWorkdayState {
  return { kind: "left-open", since: "2026-09-02T01:22:00.000Z", workDate: "2026-09-02", status: "STARTED", hours, days }
}

function prodFixture(): TeamTodayRowInput[] {
  const rows: TeamTodayRowInput[] = []
  rows.push(row({ agentId: "shift-17h", name: "Mars Overseas Baku", workday: leftOpen(17, 0) }))
  for (let index = 1; index <= 7; index += 1) rows.push(row({ agentId: `idle-${index}`, name: `Agent ${index}` }))
  rows.push(row({ agentId: "shift-19d", name: "Anar Mammadov", workday: leftOpen(456, 19) }))
  for (let index = 8; index <= 12; index += 1) rows.push(row({ agentId: `idle-${index}`, name: `Agent ${index}` }))
  rows.push(row({ agentId: "shift-2d", name: "[QA-SWISSMED] Tester", workday: leftOpen(40, 2) }))
  rows.push(row({ agentId: "idle-13", name: "Agent 13" }))
  rows.push(row({ agentId: "idle-14", name: "Agent 14" }))
  return rows
}

describe("summarizeTeamToday on the 2026-09-21 prod shape", () => {
  it("counts nobody in the field, three open shifts with the oldest at 19 days, and no plans", () => {
    const rows = prodFixture()
    expect(rows).toHaveLength(17)
    const summary = summarizeTeamToday(rows, OPTIONS)
    expect(summary.total).toBe(17)
    expect(summary.inField).toBe(0)
    expect(summary.inFieldBasis).toBe("workday")
    expect(summary.openShifts).toEqual({ count: 3, oldest: { days: 19, hours: 456 } })
    expect(summary.planned).toBe(0)
    expect(summary.withoutPlan).toBe(17)
    expect(summary.problems.map((entry) => entry.row.agentId)).toEqual(["shift-19d", "shift-2d", "shift-17h"])
    expect(summary.active).toEqual([])
    expect(summary.idle).toHaveLength(14)
    for (const entry of summary.problems) {
      expect(entry.flags).toEqual(["shift-left-open"])
      expect(entry.severity).toBe(4)
      expect(entry.inField).toBe(false)
    }
  })

  it("without workforce-hrm measures the field by open visits and shows no shifts at all", () => {
    const summary = summarizeTeamToday(prodFixture(), { ...OPTIONS, workdayEnabled: false })
    expect(summary.inFieldBasis).toBe("visit")
    expect(summary.openShifts).toEqual({ count: 0, oldest: null })
    expect(summary.problems).toEqual([])
    expect(summary.idle).toHaveLength(17)
  })

  it("passes partial and visitsTruncated through unchanged", () => {
    const summary = summarizeTeamToday(prodFixture(), { workdayEnabled: true, partial: true, visitsTruncated: true })
    expect(summary.partial).toBe(true)
    expect(summary.visitsTruncated).toBe(true)
  })

  it("counts a QA account like any other agent — the client does not filter", () => {
    const summary = summarizeTeamToday(prodFixture(), OPTIONS)
    expect(summary.problems.some((entry) => entry.row.name.startsWith("[QA-SWISSMED]"))).toBe(true)
  })
})

describe("classifyTeamRow", () => {
  it("flags a working agent on an open visit with no plan and no GPS", () => {
    const entry = classifyTeamRow(row({
      agentId: "a",
      workday: { kind: "working", since: "2026-09-21T05:00:00.000Z" },
      visits: [{ status: "CHECKED_IN", checkInAt: "2026-09-21T06:12:00.000Z", checkOutAt: null }],
      visitCount: 1,
    }), true)
    expect(entry.inField).toBe(true)
    expect(entry.openVisitSince).toBe("2026-09-21T06:12:00.000Z")
    expect(entry.flags).toEqual(["in-field-no-plan", "in-field-no-gps"])
    expect(entry.bucket).toBe("problem")
    expect(entry.severity).toBe(3)
  })

  it("counts a left-open shift with an open visit once in problems, once in the field, once among open shifts", () => {
    const rows = [row({
      agentId: "a",
      workday: leftOpen(20, 0),
      visits: [{ status: "CHECKED_IN", checkInAt: "2026-09-20T10:00:00.000Z", checkOutAt: null }],
      visitCount: 1,
      lastGpsAt: "2026-09-20T10:05:00.000Z",
      route: { visited: 1, total: 3 },
    })]
    const summary = summarizeTeamToday(rows, OPTIONS)
    expect(summary.inField).toBe(1)
    expect(summary.openShifts.count).toBe(1)
    expect(summary.problems).toHaveLength(1)
    expect(summary.active).toEqual([])
    expect(summary.idle).toEqual([])
  })

  it("treats a paused agent with GPS as active but not in the field", () => {
    const entry = classifyTeamRow(row({ agentId: "a", workday: { kind: "paused", since: null }, lastGpsAt: "2026-09-21T08:00:00.000Z" }), true)
    expect(entry.bucket).toBe("active")
    expect(entry.inField).toBe(false)
    expect(entry.flags).toEqual([])
  })

  it("treats a finished shift without visits as active, not idle", () => {
    const entry = classifyTeamRow(row({ agentId: "a", workday: { kind: "finished", at: "2026-09-21T14:00:00.000Z" } }), true)
    expect(entry.bucket).toBe("active")
  })

  it("keeps a not-started agent with an untouched plan idle — the morning is not a state", () => {
    const entry = classifyTeamRow(row({ agentId: "a", route: { visited: 0, total: 8 } }), true)
    expect(entry.bucket).toBe("idle")
  })

  it("counts visited stops as activity even without a shift or GPS", () => {
    const entry = classifyTeamRow(row({ agentId: "a", route: { visited: 2, total: 8 } }), true)
    expect(entry.bucket).toBe("active")
  })

  it("makes open alerts alone a problem of the lowest severity", () => {
    const entry = classifyTeamRow(row({ agentId: "a", openAlerts: 18 }), true)
    expect(entry.bucket).toBe("problem")
    expect(entry.flags).toEqual(["open-alerts"])
    expect(entry.severity).toBe(1)
  })

  it("looks for the open visit from the end of the chronological list", () => {
    const closed = { status: "CHECKED_OUT", checkInAt: "2026-09-21T09:00:00.000Z", checkOutAt: "2026-09-21T09:30:00.000Z" }
    const open = { status: "CHECKED_IN", checkInAt: "2026-09-21T10:00:00.000Z", checkOutAt: null }
    expect(classifyTeamRow(row({ agentId: "a", visits: [open, closed] }), true).openVisitSince).toBeNull()
    expect(classifyTeamRow(row({ agentId: "a", visits: [closed, open] }), true).openVisitSince).toBe(open.checkInAt)
    // An open visit without a check-in time still puts the agent in the field.
    const noTime = classifyTeamRow(row({ agentId: "a", visits: [{ status: "CHECKED_IN", checkInAt: null, checkOutAt: null }] }), false)
    expect(noTime.inField).toBe(true)
    expect(noTime.openVisitSince).toBeNull()
  })

  it("does not read a visit cancelled after its check-in as the agent being in the field", () => {
    // PUT /api/v1/mtm/visits/[id] with status CANCELLED writes only the
    // status and leaves checkOutAt null — the same shape as an open visit.
    const cancelled = { status: "CANCELLED", checkInAt: "2026-09-21T06:12:00.000Z", checkOutAt: null }
    for (const workdayEnabled of [true, false]) {
      const entry = classifyTeamRow(row({ agentId: "a", visits: [cancelled], visitCount: 1 }), workdayEnabled)
      expect(entry.inField).toBe(false)
      expect(entry.openVisitSince).toBeNull()
      expect(entry.flags).toEqual([])
      expect(entry.bucket).not.toBe("problem")
    }
    const summary = summarizeTeamToday([row({ agentId: "a", visits: [cancelled], visitCount: 1 })], { ...OPTIONS, workdayEnabled: false })
    expect(summary.inField).toBe(0)
  })

  it("ignores the workday when the tenant has no workforce-hrm, even if a row carries one", () => {
    const entry = classifyTeamRow(row({ agentId: "a", workday: { kind: "working", since: null } }), false)
    expect(entry.inField).toBe(false)
    expect(entry.bucket).toBe("idle")
  })
})

describe("row order", () => {
  it("is stable: equal names keep the server order, different names sort by locale", () => {
    const rows = [
      row({ agentId: "second", name: "Zaur", openAlerts: 1 }),
      row({ agentId: "first", name: "Ayan", openAlerts: 1 }),
      row({ agentId: "dup-1", name: "Ayan", openAlerts: 1 }),
      row({ agentId: "dup-2", name: "Ayan", openAlerts: 1 }),
    ]
    const summary = summarizeTeamToday(rows, OPTIONS)
    expect(summary.problems.map((entry) => entry.row.agentId)).toEqual(["first", "dup-1", "dup-2", "second"])
  })

  it("puts more alerts first among rows of one severity, and working before paused before finished among active rows", () => {
    const rows = [
      row({ agentId: "few", openAlerts: 2 }),
      row({ agentId: "many", openAlerts: 9 }),
      row({ agentId: "finished", workday: { kind: "finished", at: null } }),
      row({ agentId: "paused", workday: { kind: "paused", since: null } }),
      row({ agentId: "working", workday: { kind: "working", since: null }, route: { visited: 1, total: 2 }, lastGpsAt: "2026-09-21T08:00:00.000Z" }),
    ]
    const summary = summarizeTeamToday(rows, OPTIONS)
    expect(summary.problems.map((entry) => entry.row.agentId)).toEqual(["many", "few"])
    expect(summary.active.map((entry) => entry.row.agentId)).toEqual(["working", "paused", "finished"])
  })

  it("keeps the oldest open shift on top regardless of the server order", () => {
    const rows = [
      row({ agentId: "short", workday: leftOpen(17, 0) }),
      row({ agentId: "long", workday: leftOpen(1536, 64) }),
    ]
    const summary = summarizeTeamToday(rows, OPTIONS)
    expect(summary.problems.map((entry) => entry.row.agentId)).toEqual(["long", "short"])
    expect(summary.openShifts.oldest).toEqual({ days: 64, hours: 1536 })
  })
})

describe("team payload scope", () => {
  it("hides a payload fetched for one filter under another until the new answer arrives", () => {
    const all = { scopeKey: teamTodayScopeKey({ regionId: "", teamId: "" }), rows: 17 }
    expect(teamTodayForScope(all, teamTodayScopeKey({ regionId: "", teamId: "" }))).toBe(all)
    // The manager picked a team of four: 17 rows of «all teams» are not its summary.
    expect(teamTodayForScope(all, teamTodayScopeKey({ regionId: "", teamId: "baku" }))).toBeNull()
    expect(teamTodayForScope(all, teamTodayScopeKey({ regionId: "north", teamId: "" }))).toBeNull()
    expect(teamTodayForScope(null, teamTodayScopeKey({ regionId: "", teamId: "" }))).toBeNull()
  })

  it("keys the scope so region and team never collide", () => {
    expect(teamTodayScopeKey({ regionId: "a", teamId: "" })).not.toBe(teamTodayScopeKey({ regionId: "", teamId: "a" }))
  })
})
