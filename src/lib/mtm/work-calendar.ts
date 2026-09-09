import { isWeekendDateKey } from "@/lib/mtm/mobile-week"

export type WorkCalendarDayKind =
  | "WORKING_DAY"
  | "WEEKEND"
  | "PUBLIC_HOLIDAY"
  | "COMPANY_HOLIDAY"
  | "EXCEPTION_WORKDAY"
  | "MOVED_WORKDAY"
  | "MOVED_DAY_OFF"

export type WorkCalendarSource =
  | "WEEKDAY_DEFAULT"
  | "WEEKEND_DEFAULT"
  | "ORGANIZATION_OVERRIDE"
  | "TEAM_OVERRIDE"
  | "AGENT_OVERRIDE"

export interface WorkCalendarOverride {
  id: string
  date: Date | string
  kind: WorkCalendarDayKind
  name: string | null
  teamId: string | null
  agentId: string | null
  movedToDate: Date | string | null
  routePlanningAllowed: boolean | null
}

export interface EffectiveWorkCalendarDay {
  date: string
  kind: WorkCalendarDayKind
  isWorkingDay: boolean
  routePlanningAllowed: boolean
  name: string | null
  movedToDate: string | null
  source: WorkCalendarSource
  overrideId: string | null
}

export function workCalendarDateKey(value: Date | string): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : value.slice(0, 10)
}

export function isWorkingCalendarKind(kind: WorkCalendarDayKind): boolean {
  return kind === "WORKING_DAY" || kind === "EXCEPTION_WORKDAY" || kind === "MOVED_WORKDAY"
}

export function resolveWorkCalendarDay(input: {
  date: string
  overrides: readonly WorkCalendarOverride[]
  teamId?: string | null
  agentId?: string | null
}): EffectiveWorkCalendarDay {
  const candidates = input.overrides.filter((entry) => workCalendarDateKey(entry.date) === input.date)
  const agentOverride = input.agentId
    ? candidates.find((entry) => entry.agentId === input.agentId && entry.teamId === null)
    : undefined
  const teamOverride = input.teamId
    ? candidates.find((entry) => entry.teamId === input.teamId && entry.agentId === null)
    : undefined
  const organizationOverride = candidates.find((entry) => entry.teamId === null && entry.agentId === null)
  const override = agentOverride ?? teamOverride ?? organizationOverride

  if (override) {
    const isWorkingDay = isWorkingCalendarKind(override.kind)
    return {
      date: input.date,
      kind: override.kind,
      isWorkingDay,
      routePlanningAllowed: override.routePlanningAllowed ?? isWorkingDay,
      name: override.name,
      movedToDate: override.movedToDate ? workCalendarDateKey(override.movedToDate) : null,
      source: agentOverride
        ? "AGENT_OVERRIDE"
        : teamOverride
          ? "TEAM_OVERRIDE"
          : "ORGANIZATION_OVERRIDE",
      overrideId: override.id,
    }
  }

  const weekend = isWeekendDateKey(input.date)
  return {
    date: input.date,
    kind: weekend ? "WEEKEND" : "WORKING_DAY",
    isWorkingDay: !weekend,
    routePlanningAllowed: !weekend,
    name: null,
    movedToDate: null,
    source: weekend ? "WEEKEND_DEFAULT" : "WEEKDAY_DEFAULT",
    overrideId: null,
  }
}
