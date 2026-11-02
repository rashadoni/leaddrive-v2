import { describe, expect, it } from "vitest"
import {
  agentsWorkingOn,
  attentionItemHref,
  buildAttentionItems,
  buildNextWorkday,
  nextWorkdayHref,
  nextWorkingDateKey,
  summarizeByAgent,
  weekStartKey,
  weekWorkingDays,
} from "@/lib/mtm/panel-attention"
import type { WorkCalendarOverride } from "@/lib/mtm/work-calendar"

/**
 * «Ждёт решения» on the Panel. The dates are the ones the owner looked at:
 * Sunday 11 October 2026, a team whose next working day is Monday the 12th.
 */

function override(input: Partial<WorkCalendarOverride> & { date: string; kind: WorkCalendarOverride["kind"] }): WorkCalendarOverride {
  return { id: `o-${input.date}-${input.agentId ?? input.teamId ?? "org"}`, name: null, teamId: null, agentId: null, movedToDate: null, routePlanningAllowed: null, ...input }
}

describe("the next working day", () => {
  it("is Monday on a Sunday evening and on a Friday", () => {
    expect(nextWorkingDateKey("2026-10-11", [])).toBe("2026-10-12")
    expect(nextWorkingDateKey("2026-10-09", [])).toBe("2026-10-12")
    expect(nextWorkingDateKey("2026-10-12", [])).toBe("2026-10-13")
  })

  it("skips a holiday the organization declared and takes a Saturday it declared working", () => {
    expect(nextWorkingDateKey("2026-10-11", [override({ date: "2026-10-12", kind: "PUBLIC_HOLIDAY" })])).toBe("2026-10-13")
    expect(nextWorkingDateKey("2026-10-09", [override({ date: "2026-10-10", kind: "EXCEPTION_WORKDAY" })])).toBe("2026-10-10")
  })

  it("does not read one team's or one agent's day off as the organization's", () => {
    const overrides = [
      override({ date: "2026-10-12", kind: "COMPANY_HOLIDAY", teamId: "team-north" }),
      override({ date: "2026-10-12", kind: "MOVED_DAY_OFF", agentId: "agent-1" }),
    ]
    expect(nextWorkingDateKey("2026-10-11", overrides)).toBe("2026-10-12")
  })

  it("gives up after two weeks of days off instead of walking the calendar", () => {
    const holidays = Array.from({ length: 20 }, (_unused, index) => {
      const date = new Date(Date.UTC(2026, 9, 12 + index)).toISOString().slice(0, 10)
      return override({ date, kind: "COMPANY_HOLIDAY" })
    })
    expect(nextWorkingDateKey("2026-10-11", holidays)).toBeNull()
  })
})

describe("who is expected to hold a route that day", () => {
  const agents = [
    { id: "agent-1", name: "Aysel", teamId: "team-north" },
    { id: "agent-2", name: "Leyla", teamId: "team-south" },
    { id: "agent-3", name: "Rauf", teamId: null },
  ]

  it("leaves out an agent on a personal day off and a team on its own holiday", () => {
    const overrides = [
      override({ date: "2026-10-12", kind: "MOVED_DAY_OFF", agentId: "agent-3" }),
      override({ date: "2026-10-12", kind: "COMPANY_HOLIDAY", teamId: "team-south" }),
    ]
    expect(agentsWorkingOn(agents, "2026-10-12", overrides).map((agent) => agent.id)).toEqual(["agent-1"])
  })

  it("counts the agents without a published route and names the first of them for the planner", () => {
    const next = buildNextWorkday({ date: "2026-10-12", agents, agentIdsWithRoute: new Set(["agent-1"]) })
    expect(next).toEqual({ date: "2026-10-12", agents: 3, withoutRoute: 2, agentId: "agent-2", people: ["Leyla", "Rauf"] })
    expect(nextWorkdayHref(next!)).toBe("/mtm/routes?planAgentId=agent-2&planDate=2026-10-12")
  })

  it("says nothing when there is no working day ahead or nobody to plan for", () => {
    expect(buildNextWorkday({ date: null, agents, agentIdsWithRoute: new Set() })).toBeNull()
    expect(buildNextWorkday({ date: "2026-10-12", agents: [], agentIdsWithRoute: new Set() })).toBeNull()
  })

  it("reports zero missing when everyone has a route — the Panel then draws no row", () => {
    const next = buildNextWorkday({ date: "2026-10-12", agents, agentIdsWithRoute: new Set(["agent-1", "agent-2", "agent-3"]) })
    expect(next).toMatchObject({ withoutRoute: 0, agentId: null, people: [] })
  })

  it("names at most two of those without a route", () => {
    const many = Array.from({ length: 5 }, (_unused, index) => ({ id: `a${index}`, name: `Agent ${index}`, teamId: null }))
    expect(buildNextWorkday({ date: "2026-10-12", agents: many, agentIdsWithRoute: new Set() })).toMatchObject({ withoutRoute: 5, people: ["Agent 0", "Agent 1"] })
  })
})

describe("the days of the week", () => {
  it("starts the week on Monday whatever the day", () => {
    expect(weekStartKey("2026-10-11")).toBe("2026-10-05")
    expect(weekStartKey("2026-10-05")).toBe("2026-10-05")
    expect(weekStartKey("2026-10-13")).toBe("2026-10-12")
  })

  it("gives Monday to Sunday with the organization's verdict on each", () => {
    const week = weekWorkingDays("2026-10-11", [
      override({ date: "2026-10-10", kind: "EXCEPTION_WORKDAY" }),
      override({ date: "2026-10-07", kind: "PUBLIC_HOLIDAY" }),
      // One agent's day off is not the organization's.
      override({ date: "2026-10-06", kind: "MOVED_DAY_OFF", agentId: "agent-1" }),
    ])
    expect(week.map((day) => day.date)).toEqual(["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10", "2026-10-11"])
    expect(week.map((day) => day.isWorkingDay)).toEqual([true, true, false, true, true, true, false])
  })
})

describe("whose rows they are", () => {
  it("adds the groups up, keeps the extreme day, and puts the busiest agent first", () => {
    const groups = [
      { agentId: "b", count: 1, date: new Date("2026-10-09T08:00:00.000Z") },
      { agentId: "a", count: 3, date: new Date("2026-10-07T22:01:00.000Z") },
      { agentId: "c", count: 3, date: null },
      { agentId: "d", count: 0, date: new Date("2026-10-01T00:00:00.000Z") },
    ]
    expect(summarizeByAgent(groups, "earliest")).toEqual({ count: 7, date: new Date("2026-10-01T00:00:00.000Z"), agentIds: ["a", "c", "b"] })
    expect(summarizeByAgent(groups, "latest").date).toEqual(new Date("2026-10-09T08:00:00.000Z"))
    expect(summarizeByAgent([], "earliest")).toEqual({ count: 0, date: null, agentIds: [] })
  })
})

describe("the rows of the block", () => {
  it("keeps only what is waiting, in a fixed order, with names and alert types", () => {
    const items = buildAttentionItems([
      { kind: "photosPendingReview", count: 2, date: "2026-10-07" },
      { kind: "olderAlerts", count: 6, date: "2026-10-08", types: [{ type: "LONG_BREAK", count: 1 }, { type: "OUT_OF_ZONE", count: 5 }, { type: "LOW_BATTERY", count: 0 }] },
      { kind: "routeChangeRequests", count: 0, date: null },
      { kind: "contactCreateRequests", count: 4, date: "2026-10-08", agentIds: ["a1", "a2", "a3"] },
      { kind: "routesAwaitingPublish", count: 2, date: "2026-10-12", agentIds: ["gone"] },
      { kind: "customerCreateRequests", count: 0, date: null },
    ], new Map([["a1", "Seymur"], ["a2", "Leyla"], ["a3", "Rauf"]]))
    expect(items).toEqual([
      // Three agents asked; the row spells out two and counts all three.
      { kind: "contactCreateRequests", count: 4, date: "2026-10-08", people: ["Seymur", "Leyla"], peopleCount: 3, types: [] },
      // An agent whose name could not be read is counted, not invented.
      { kind: "routesAwaitingPublish", count: 2, date: "2026-10-12", people: [], peopleCount: 1, types: [] },
      { kind: "olderAlerts", count: 6, date: "2026-10-08", people: [], peopleCount: 0, types: [{ type: "OUT_OF_ZONE", count: 5 }, { type: "LONG_BREAK", count: 1 }] },
      { kind: "photosPendingReview", count: 2, date: "2026-10-07", people: [], peopleCount: 0, types: [] },
    ])
  })

  it("leads each row to the list of exactly those rows", () => {
    // The queue above the Clients list, unfolded (owner, 2026-10-20): the bare
    // list showed existing clients and the request folded to one line. What
    // the address opens is checked on the page in mtm-panel-contact-request-link-ui.
    expect(attentionItemHref({ kind: "contactCreateRequests", date: "2026-10-08" })).toBe("/mtm/contacts?requests=open")
    expect(attentionItemHref({ kind: "customerCreateRequests", date: null })).toBe("/mtm/routes?view=approvals")
    expect(attentionItemHref({ kind: "routeChangeRequests", date: null })).toBe("/mtm/routes?view=approvals")
    expect(attentionItemHref({ kind: "routesAwaitingPublish", date: "2026-10-12" })).toBe("/mtm/routes")
    // /mtm/alerts opens on every open alert, whatever its day (2026-10-15). A
    // link to one day showed one of the seven the row counted.
    expect(attentionItemHref({ kind: "olderAlerts", date: "2026-10-08" })).toBe("/mtm/alerts")
    expect(attentionItemHref({ kind: "olderAlerts", date: null })).toBe("/mtm/alerts")
    // The gallery opens on this week and every status: the link names both.
    expect(attentionItemHref({ kind: "photosPendingReview", date: "2026-10-07" })).toBe("/mtm/photos?status=PENDING&period=all")
  })
})
