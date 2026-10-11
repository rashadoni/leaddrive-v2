import { describe, expect, it } from "vitest"
import {
  agentsWorkingOn,
  attentionItemHref,
  buildAttentionItems,
  buildNextWorkday,
  nextWorkdayHref,
  nextWorkingDateKey,
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
    { id: "agent-1", teamId: "team-north" },
    { id: "agent-2", teamId: "team-south" },
    { id: "agent-3", teamId: null },
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
    expect(next).toEqual({ date: "2026-10-12", agents: 3, withoutRoute: 2, agentId: "agent-2" })
    expect(nextWorkdayHref(next!)).toBe("/mtm/routes?planAgentId=agent-2&planDate=2026-10-12")
  })

  it("says nothing when there is no working day ahead or nobody to plan for", () => {
    expect(buildNextWorkday({ date: null, agents, agentIdsWithRoute: new Set() })).toBeNull()
    expect(buildNextWorkday({ date: "2026-10-12", agents: [], agentIdsWithRoute: new Set() })).toBeNull()
  })

  it("reports zero missing when everyone has a route — the Panel then draws no row", () => {
    const next = buildNextWorkday({ date: "2026-10-12", agents, agentIdsWithRoute: new Set(["agent-1", "agent-2", "agent-3"]) })
    expect(next).toMatchObject({ withoutRoute: 0, agentId: null })
  })
})

describe("the rows of the block", () => {
  it("keeps only what is waiting, in a fixed order", () => {
    const items = buildAttentionItems([
      { kind: "olderAlerts", count: 6, date: "2026-10-08" },
      { kind: "routeChangeRequests", count: 0, date: null },
      { kind: "contactCreateRequests", count: 1, date: "2026-10-08" },
      { kind: "routesAwaitingPublish", count: 2, date: "2026-10-12" },
      { kind: "customerCreateRequests", count: 0, date: null },
    ])
    expect(items).toEqual([
      { kind: "contactCreateRequests", count: 1, date: "2026-10-08" },
      { kind: "routesAwaitingPublish", count: 2, date: "2026-10-12" },
      { kind: "olderAlerts", count: 6, date: "2026-10-08" },
    ])
  })

  it("leads each row to the list of exactly those rows", () => {
    expect(attentionItemHref({ kind: "contactCreateRequests", count: 1, date: "2026-10-08" })).toBe("/mtm/contacts")
    expect(attentionItemHref({ kind: "customerCreateRequests", count: 1, date: null })).toBe("/mtm/routes?view=approvals")
    expect(attentionItemHref({ kind: "routeChangeRequests", count: 1, date: null })).toBe("/mtm/routes?view=approvals")
    expect(attentionItemHref({ kind: "routesAwaitingPublish", count: 1, date: "2026-10-12" })).toBe("/mtm/routes")
    // /mtm/alerts opens on today: without the day the alerts of 8 October stay off screen.
    expect(attentionItemHref({ kind: "olderAlerts", count: 6, date: "2026-10-08" })).toBe("/mtm/alerts?date=2026-10-08")
    expect(attentionItemHref({ kind: "olderAlerts", count: 6, date: null })).toBe("/mtm/alerts")
  })
})
