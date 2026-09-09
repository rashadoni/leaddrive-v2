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

  it("classifies every work-producing kind consistently", () => {
    expect(isWorkingCalendarKind("WORKING_DAY")).toBe(true)
    expect(isWorkingCalendarKind("EXCEPTION_WORKDAY")).toBe(true)
    expect(isWorkingCalendarKind("MOVED_WORKDAY")).toBe(true)
    expect(isWorkingCalendarKind("MOVED_DAY_OFF")).toBe(false)
    expect(isWorkingCalendarKind("PUBLIC_HOLIDAY")).toBe(false)
  })
})
