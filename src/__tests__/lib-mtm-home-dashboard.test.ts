import { describe, expect, it } from "vitest"
import {
  buildAgentWeek,
  defaultWeek,
  fieldNow,
  finishedDaysPercent,
  homeAgentState,
  homeTeam,
  percentOf,
  planCard,
  todayPlan,
  weekComparison,
  weekTotals,
  type HomeTeamRow,
  type HomeWeekFacts,
} from "@/lib/mtm/home-dashboard"

/**
 * The MTM home screen as the owner accepted it on 2026-10-11. Two days are
 * used throughout: Sunday 11 October at Zeytun Pharma (one field agent, a
 * week with two visits out of seven planned stops) and a working Tuesday.
 */

const SUNDAY = "2026-10-11"
const WEEK = defaultWeek(SUNDAY)

function row(overrides: Partial<HomeTeamRow> & { agentId: string }): HomeTeamRow {
  return { name: overrides.agentId, teamName: null, lastGpsAt: null, route: null, visits: [], visitCount: 0, openAlerts: 0, workday: null, role: "AGENT", nextStop: null, ...overrides }
}

/** Zeytun's week on prod: Wednesday 1 of 3, Thursday 1 of 4, nothing else published. */
const ZEYTUN: HomeWeekFacts = {
  planPoints: [
    ...[true, false, false].map((completed) => ({ agentId: "seymur", date: "2026-10-07", completed })),
    ...[true, false, false, false].map((completed) => ({ agentId: "seymur", date: "2026-10-08", completed })),
  ],
  visits: [
    { agentId: "seymur", date: "2026-10-07", gpsConfirmed: true },
    { agentId: "seymur", date: "2026-10-08", gpsConfirmed: true },
  ],
}

describe("the week of one agent", () => {
  it("names Monday to Sunday and takes Saturday and Sunday for days off by default", () => {
    expect(WEEK.map((day) => day.date)).toEqual(["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10", "2026-10-11"])
    expect(WEEK.map((day) => day.isWorkingDay)).toEqual([true, true, true, true, true, false, false])
    // A Wednesday belongs to the same week.
    expect(defaultWeek("2026-10-07")[0].date).toBe("2026-10-05")
  })

  it("reads Zeytun's week as two partial days among days without a plan and a weekend", () => {
    const week = buildAgentWeek("seymur", SUNDAY, WEEK, ZEYTUN)
    expect(week.cells.map((cell) => cell.tone)).toEqual(["none", "none", "partial", "partial", "none", "off", "off"])
    expect(week.cells.map((cell) => `${cell.done}/${cell.planned}`)).toEqual(["0/0", "0/0", "1/3", "1/4", "0/0", "0/0", "0/0"])
    expect(week.cells.filter((cell) => cell.isToday).map((cell) => cell.date)).toEqual([SUNDAY])
    expect({ planned: week.planned, done: week.done }).toEqual({ planned: 7, done: 2 })
  })

  it("tells a finished day, a missed one, the running one, the ones ahead and unplanned visits apart", () => {
    const today = "2026-10-13"
    const week = defaultWeek(today)
    const facts: HomeWeekFacts = {
      planPoints: [
        ...Array.from({ length: 6 }, () => ({ agentId: "a", date: "2026-10-12", completed: true })),
        ...[true, true, true, false, false].map((completed) => ({ agentId: "a", date: today, completed })),
        ...Array.from({ length: 7 }, () => ({ agentId: "a", date: "2026-10-14", completed: false })),
        ...Array.from({ length: 5 }, () => ({ agentId: "b", date: "2026-10-12", completed: false })),
        ...Array.from({ length: 4 }, () => ({ agentId: "b", date: today, completed: false })),
      ],
      visits: [{ agentId: "c", date: "2026-10-12", gpsConfirmed: false }, { agentId: "c", date: "2026-10-12", gpsConfirmed: true }],
    }
    const a = buildAgentWeek("a", today, week, facts)
    expect(a.cells.map((cell) => cell.tone)).toEqual(["full", "partial", "upcoming", "none", "none", "off", "off"])
    // «So far» stops at today: Wednesday's seven stops are not behind yet.
    expect({ planned: a.planned, done: a.done }).toEqual({ planned: 11, done: 9 })

    const b = buildAgentWeek("b", today, week, facts)
    // Yesterday without a visit is missed; today without one is only the morning.
    expect(b.cells.slice(0, 2).map((cell) => cell.tone)).toEqual(["missed", "pending"])

    const c = buildAgentWeek("c", today, week, facts)
    expect(c.cells[0]).toMatchObject({ tone: "visited", visits: 2, planned: 0 })
    expect({ planned: c.planned, done: c.done }).toEqual({ planned: 0, done: 0 })
  })

  it("follows the organization's calendar for a working Saturday and a holiday", () => {
    const week = WEEK.map((day) => day.date === "2026-10-10" ? { ...day, isWorkingDay: true } : day.date === "2026-10-06" ? { ...day, isWorkingDay: false } : day)
    const cells = buildAgentWeek("seymur", SUNDAY, week, ZEYTUN).cells
    expect(cells[1].tone).toBe("off")
    expect(cells[5].tone).toBe("none")
  })
})

describe("the week of the team", () => {
  it("counts the week so far the way «Результаты» does, and narrows it to the people on screen", () => {
    expect(weekTotals(ZEYTUN, { from: "2026-10-05", to: SUNDAY })).toEqual({ planned: 7, done: 2, visits: 2, gpsConfirmed: 2 })
    // Up to Wednesday only.
    expect(weekTotals(ZEYTUN, { from: "2026-10-05", to: "2026-10-07" })).toEqual({ planned: 3, done: 1, visits: 1, gpsConfirmed: 1 })
    expect(weekTotals(ZEYTUN, { from: "2026-10-05", to: SUNDAY }, new Set(["someone-else"]))).toEqual({ planned: 0, done: 0, visits: 0, gpsConfirmed: 0 })
    expect(percentOf(2, 7)).toBe(29)
    expect(percentOf(0, 0)).toBeNull()
  })

  it("judges the week by the days already over, never by today's unfinished plan", () => {
    const tuesday = "2026-10-13"
    const facts: HomeWeekFacts = {
      planPoints: [
        ...Array.from({ length: 26 }, (_unused, index) => ({ agentId: index < 13 ? "a" : "b", date: "2026-10-12", completed: index < 22 })),
        // Noon on Tuesday: nine of twenty-six. That is the day, not a failure.
        ...Array.from({ length: 26 }, (_unused, index) => ({ agentId: "a", date: tuesday, completed: index < 9 })),
      ],
      visits: [],
    }
    // The figure counts today as «Результаты» does: 31 of 52.
    expect(weekTotals(facts, { from: "2026-10-12", to: tuesday })).toMatchObject({ planned: 52, done: 31 })
    expect(finishedDaysPercent(facts, { from: "2026-10-12", today: tuesday })).toBe(85)
    // On a Monday there is no finished day to judge by.
    expect(finishedDaysPercent(facts, { from: "2026-10-12", today: "2026-10-12" })).toBeNull()
    // Zeytun on Sunday: the whole week is over, two of seven.
    expect(finishedDaysPercent(ZEYTUN, { from: "2026-10-05", today: SUNDAY })).toBe(29)
    expect(finishedDaysPercent(facts, { from: "2026-10-12", today: tuesday }, new Set(["b"]))).toBe(69)
  })

  it("compares with last week only when there is something to compare", () => {
    expect(weekComparison({ planned: 7, done: 2 }, null)).toEqual({ kind: "unknown" })
    // Zeytun had no plan the week before.
    expect(weekComparison({ planned: 7, done: 2 }, { planned: 0, done: 0 })).toEqual({ kind: "no-plan" })
    expect(weekComparison({ planned: 52, done: 31 }, { planned: 50, done: 26 })).toEqual({ kind: "delta", previousPercent: 52, delta: 8 })
    expect(weekComparison({ planned: 10, done: 4 }, { planned: 10, done: 6 })).toEqual({ kind: "delta", previousPercent: 60, delta: -20 })
    expect(weekComparison({ planned: 0, done: 0 }, { planned: 10, done: 6 })).toEqual({ kind: "unknown" })
  })
})

describe("where an agent stands", () => {
  const open = { customerName: "Mərkəzi Klinika", status: "CHECKED_IN", checkInAt: "2026-10-13T07:31:00.000Z", checkOutAt: null }
  const closed = { customerName: "Aptek 12", status: "CHECKED_OUT", checkInAt: "2026-10-13T06:10:00.000Z", checkOutAt: "2026-10-13T06:35:00.000Z" }
  const next = { customerName: "Hospital 2", plannedAt: "2026-10-13T08:00:00.000Z" }

  it("is at a customer while the newest visit is open", () => {
    expect(homeAgentState(row({ agentId: "a", route: { visited: 3, total: 8 }, visits: [closed, open], visitCount: 2, nextStop: next })))
      .toEqual({ kind: "at-customer", customerName: "Mərkəzi Klinika", since: "2026-10-13T07:31:00.000Z" })
  })

  it("is on the way once out, and «not started» while the phone has not reported today", () => {
    expect(homeAgentState(row({ agentId: "a", route: { visited: 1, total: 6 }, visits: [closed], visitCount: 1, nextStop: next })))
      .toEqual({ kind: "heading", customerName: "Hospital 2", plannedAt: "2026-10-13T08:00:00.000Z" })
    // On the road to the first stop: nothing visited, but the phone is moving.
    expect(homeAgentState(row({ agentId: "a", route: { visited: 0, total: 6 }, lastGpsAt: "2026-10-13T05:50:00.000Z", nextStop: next })).kind).toBe("heading")
    // A plan and a silent phone at 09:00 is the normal morning, not a fault.
    expect(homeAgentState(row({ agentId: "a", route: { visited: 0, total: 5 }, nextStop: next }))).toEqual({ kind: "not-started" })
  })

  it("closes the plan, flags visits without one, and remembers the last customer", () => {
    expect(homeAgentState(row({ agentId: "a", route: { visited: 7, total: 7 }, visits: [closed], visitCount: 7 }))).toEqual({ kind: "plan-done" })
    expect(homeAgentState(row({ agentId: "a", visits: [closed], visitCount: 1 }))).toEqual({ kind: "unplanned" })
    expect(homeAgentState(row({ agentId: "a", route: { visited: 1, total: 4 }, visits: [closed], visitCount: 1 })))
      .toEqual({ kind: "last-visit", customerName: "Aptek 12", until: "2026-10-13T06:35:00.000Z" })
  })

  it("says nothing happened when nothing did — a phone alone is not activity", () => {
    expect(homeAgentState(row({ agentId: "seymur" }))).toEqual({ kind: "no-activity" })
    expect(homeAgentState(row({ agentId: "seymur", lastGpsAt: "2026-10-11T05:00:00.000Z" }))).toEqual({ kind: "no-activity" })
  })
})

describe("the figures on top", () => {
  const open = { customerName: "Klinika", status: "CHECKED_IN", checkInAt: "2026-10-13T07:31:00.000Z", checkOutAt: null }
  const closed = { customerName: "Aptek", status: "CHECKED_OUT", checkInAt: "2026-10-13T06:10:00.000Z", checkOutAt: "2026-10-13T06:35:00.000Z" }
  const next = { customerName: "Hospital", plannedAt: null }

  it("counts one field agent at Zeytun, not the director's and the office manager's cards", () => {
    const team = homeTeam([row({ agentId: "director", role: "ADMIN" }), row({ agentId: "office", role: "MANAGER" }), row({ agentId: "seymur" })], false)
    expect(team.map((entry) => entry.row.agentId)).toEqual(["seymur"])
    expect(fieldNow(team)).toEqual({ total: 1, inField: 0, atCustomer: 0, heading: 0, planDone: 0, notStarted: 0, idle: 1 })
    expect(todayPlan(team)).toEqual({ planned: 0, done: 0, visits: 0 })
  })

  it("puts those busy now first and adds up a working day", () => {
    const team = homeTeam([
      row({ agentId: "rauf", name: "Rauf", route: { visited: 0, total: 5 }, nextStop: next }),
      row({ agentId: "togrul", name: "Togrul", role: "ADMIN" }),
      row({ agentId: "leyla", name: "Leyla", route: { visited: 1, total: 6 }, visits: [closed], visitCount: 1, nextStop: next }),
      row({ agentId: "aysel", name: "Aysel", route: { visited: 5, total: 7 }, visits: [closed, open], visitCount: 5, nextStop: next }),
      row({ agentId: "seymur", name: "Seymur", route: { visited: 3, total: 8 }, visits: [open], visitCount: 3, nextStop: next }),
      row({ agentId: "nigar", name: "Nigar" }),
    ], false)
    expect(team.map((entry) => `${entry.row.name}:${entry.state.kind}`)).toEqual([
      "Aysel:at-customer", "Seymur:at-customer", "Leyla:heading", "Rauf:not-started", "Nigar:no-activity",
    ])
    expect(fieldNow(team)).toEqual({ total: 5, inField: 3, atCustomer: 2, heading: 1, planDone: 0, notStarted: 1, idle: 1 })
    expect(todayPlan(team)).toEqual({ planned: 26, done: 9, visits: 9 })
  })

  it("shows today's plan when there is one, and otherwise whether the next working day is ready", () => {
    expect(planCard({ today: "2026-10-13", plan: { planned: 26, done: 9, visits: 9 }, nextWorkday: { date: "2026-10-14", agents: 5, withoutRoute: 0 } }))
      .toEqual({ kind: "today", planned: 26, done: 9, visits: 9 })
    // Zeytun on Sunday: nothing today, nobody has a route for Monday.
    expect(planCard({ today: SUNDAY, plan: { planned: 0, done: 0, visits: 0 }, nextWorkday: { date: "2026-10-12", agents: 1, withoutRoute: 1 } }))
      .toEqual({ kind: "next", date: "2026-10-12", isTomorrow: true, agents: 1, withRoute: 0 })
    // A Friday evening: the next working day is Monday, not tomorrow.
    expect(planCard({ today: "2026-10-09", plan: { planned: 0, done: 0, visits: 0 }, nextWorkday: { date: "2026-10-12", agents: 4, withoutRoute: 1 } }))
      .toEqual({ kind: "next", date: "2026-10-12", isTomorrow: false, agents: 4, withRoute: 3 })
    expect(planCard({ today: SUNDAY, plan: { planned: 0, done: 0, visits: 0 }, nextWorkday: null })).toEqual({ kind: "none" })
  })
})
