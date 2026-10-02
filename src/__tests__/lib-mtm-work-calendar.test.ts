import { describe, expect, it } from "vitest"
import {
  isWorkingCalendarKind,
  resolveWorkCalendarDay,
  type WorkCalendarOverride,
} from "@/lib/mtm/work-calendar"

const overrides: WorkCalendarOverride[] = [
  {
    id: "org-holiday",
    date: new Date("2026-07-15T00:00:00.000Z"),
    kind: "PUBLIC_HOLIDAY",
    name: "Public holiday",
    teamId: null,
    agentId: null,
    movedToDate: null,
    routePlanningAllowed: null,
  },
  {
    id: "team-working",
    date: "2026-07-15",
    kind: "EXCEPTION_WORKDAY",
    name: "Team shift",
    teamId: "team-1",
    agentId: null,
    movedToDate: null,
    routePlanningAllowed: null,
  },
  {
    id: "agent-day-off",
    date: "2026-07-15",
    kind: "COMPANY_HOLIDAY",
    name: "Approved day off",
    teamId: null,
    agentId: "agent-1",
    movedToDate: null,
    routePlanningAllowed: true,
  },
]

describe("MTM work calendar", () => {
  it("derives weekday and weekend defaults when no override exists", () => {
    expect(resolveWorkCalendarDay({ date: "2026-07-17", overrides: [] })).toMatchObject({
      kind: "WORKING_DAY",
      isWorkingDay: true,
      routePlanningAllowed: true,
      source: "WEEKDAY_DEFAULT",
    })
    expect(resolveWorkCalendarDay({ date: "2026-07-18", overrides: [] })).toMatchObject({
      kind: "WEEKEND",
      isWorkingDay: false,
      routePlanningAllowed: false,
      source: "WEEKEND_DEFAULT",
    })
  })

  it("applies scope precedence agent, then team, then organization", () => {
    expect(resolveWorkCalendarDay({
      date: "2026-07-15", overrides, teamId: "team-1", agentId: "agent-1",
    })).toMatchObject({
      overrideId: "agent-day-off",
      kind: "COMPANY_HOLIDAY",
      source: "AGENT_OVERRIDE",
      isWorkingDay: false,
      routePlanningAllowed: true,
    })

    expect(resolveWorkCalendarDay({
      date: "2026-07-15", overrides, teamId: "team-1", agentId: "agent-2",
    })).toMatchObject({
      overrideId: "team-working",
      kind: "EXCEPTION_WORKDAY",
      source: "TEAM_OVERRIDE",
      isWorkingDay: true,
    })

    expect(resolveWorkCalendarDay({
      date: "2026-07-15", overrides, teamId: "team-2", agentId: "agent-2",
    })).toMatchObject({
      overrideId: "org-holiday",
      kind: "PUBLIC_HOLIDAY",
      source: "ORGANIZATION_OVERRIDE",
      isWorkingDay: false,
    })
  })

  it("lets an explicit planning flag differ from working-day status", () => {
    const day = resolveWorkCalendarDay({
      date: "2026-07-15", overrides, agentId: "agent-1",
    })
    expect(day.isWorkingDay).toBe(false)
    expect(day.routePlanningAllowed).toBe(true)
  })

  it("resolves reciprocal moved kinds with normal agent-team-organization precedence", () => {
    const movedOverrides: WorkCalendarOverride[] = [
      {
        id: "org-moved-off",
        date: "2026-07-18",
        kind: "MOVED_DAY_OFF",
        name: "Organization move",
        teamId: null,
        agentId: null,
        movedToDate: "2026-07-20",
        routePlanningAllowed: true,
      },
      {
        id: "team-moved-workday",
        date: "2026-07-18",
        kind: "MOVED_WORKDAY",
        name: "Team move",
        teamId: "team-1",
        agentId: null,
        movedToDate: "2026-07-17",
        routePlanningAllowed: false,
      },
      {
        id: "agent-day-off",
        date: "2026-07-18",
        kind: "COMPANY_HOLIDAY",
        name: "Personal exception",
        teamId: null,
        agentId: "agent-1",
        movedToDate: null,
        routePlanningAllowed: true,
      },
    ]

    expect(resolveWorkCalendarDay({
      date: "2026-07-18",
      overrides: movedOverrides,
    })).toMatchObject({
      overrideId: "org-moved-off",
      kind: "MOVED_DAY_OFF",
      isWorkingDay: false,
      routePlanningAllowed: true,
      movedToDate: "2026-07-20",
    })
    expect(resolveWorkCalendarDay({
      date: "2026-07-18",
      overrides: movedOverrides,
      teamId: "team-1",
    })).toMatchObject({
      overrideId: "team-moved-workday",
      kind: "MOVED_WORKDAY",
      source: "TEAM_OVERRIDE",
      isWorkingDay: true,
      routePlanningAllowed: false,
      movedToDate: "2026-07-17",
    })
    expect(resolveWorkCalendarDay({
      date: "2026-07-18",
      overrides: movedOverrides,
      teamId: "team-1",
      agentId: "agent-1",
    })).toMatchObject({
      overrideId: "agent-day-off",
      source: "AGENT_OVERRIDE",
      kind: "COMPANY_HOLIDAY",
    })
  })

  it("classifies every work-producing kind consistently", () => {
    expect(isWorkingCalendarKind("WORKING_DAY")).toBe(true)
    expect(isWorkingCalendarKind("EXCEPTION_WORKDAY")).toBe(true)
    expect(isWorkingCalendarKind("MOVED_WORKDAY")).toBe(true)
    expect(isWorkingCalendarKind("MOVED_DAY_OFF")).toBe(false)
    expect(isWorkingCalendarKind("PUBLIC_HOLIDAY")).toBe(false)
  })
})
