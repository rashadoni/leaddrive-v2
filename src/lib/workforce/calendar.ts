import type { PrismaClient } from "@prisma/client"
import { isDateKey } from "@/lib/mtm/mobile-week"
import {
  resolveWorkCalendarDay,
  type WorkCalendarOverride,
} from "@/lib/mtm/work-calendar"

export type WorkforceCalendarDayState =
  | "SCHEDULED"
  | "NON_WORKING"
  | "PUBLIC_HOLIDAY"
  | "TENANT_CLOSURE"
  | "APPROVED_LEAVE"
  | "APPROVED_ABSENCE"
  | "PERSONAL_EXCEPTION"

export type WorkforceCalendarOverride = WorkCalendarOverride & {
  /**
   * `mtm_work_calendar_days` is the retained, tenant-scoped calendar ledger.
   * Source is only an attendance semantic when the exact Workforce request
   * writer set it; arbitrary legacy source text must not become a leave claim.
   */
  source?: string | null
}

export type ResolvedWorkforceCalendarDay = {
  date: string
  calendarKind: WorkCalendarOverride["kind"]
  state: WorkforceCalendarDayState
  attendanceExpected: boolean
  /** A later C6 no-show calculation can use this without treating leave or a holiday as absence. */
  noShowEligible: boolean
  excused: boolean
  source: string | null
  overrideId: string | null
}

export class WorkforceCalendarResolutionError extends Error {
  constructor(
    readonly code: "WORKFORCE_CALENDAR_DATE_INVALID" | "WORKFORCE_CALENDAR_AGENT_NOT_FOUND",
    message: string = code,
  ) {
    super(message)
  }
}

function matchingOverride(
  resolved: { overrideId: string | null },
  overrides: readonly WorkforceCalendarOverride[],
): WorkforceCalendarOverride | null {
  return resolved.overrideId
    ? overrides.find((override) => override.id === resolved.overrideId) ?? null
    : null
}

/**
 * Attendance semantics are independent of Route planning. The old calendar
 * table remains the canonical tenant calendar, but this adapter deliberately
 * ignores `routePlanningAllowed` and exposes only safe HRM expectations.
 */
export function resolveWorkforceCalendarDay(input: {
  date: string
  overrides: readonly WorkforceCalendarOverride[]
  teamId?: string | null
  agentId?: string | null
}): ResolvedWorkforceCalendarDay {
  if (!isDateKey(input.date)) {
    throw new WorkforceCalendarResolutionError(
      "WORKFORCE_CALENDAR_DATE_INVALID",
      "Workforce calendar date must be a real YYYY-MM-DD date",
    )
  }

  const resolved = resolveWorkCalendarDay(input)
  const override = matchingOverride(resolved, input.overrides)
  const source = override?.source ?? null
  const personalOverride = override?.agentId === input.agentId && Boolean(input.agentId)

  if (personalOverride && source === "WORKFORCE_LEAVE") {
    return {
      date: input.date,
      calendarKind: resolved.kind,
      state: "APPROVED_LEAVE",
      attendanceExpected: false,
      noShowEligible: false,
      excused: true,
      source,
      overrideId: resolved.overrideId,
    }
  }
  if (personalOverride && source === "WORKFORCE_ABSENCE") {
    return {
      date: input.date,
      calendarKind: resolved.kind,
      state: "APPROVED_ABSENCE",
      attendanceExpected: false,
      noShowEligible: false,
      excused: true,
      source,
      overrideId: resolved.overrideId,
    }
  }
  if (resolved.isWorkingDay) {
    return {
      date: input.date,
      calendarKind: resolved.kind,
      state: "SCHEDULED",
      attendanceExpected: true,
      noShowEligible: true,
      excused: false,
      source,
      overrideId: resolved.overrideId,
    }
  }

  const state: WorkforceCalendarDayState = resolved.kind === "PUBLIC_HOLIDAY"
    ? "PUBLIC_HOLIDAY"
    : personalOverride
      ? "PERSONAL_EXCEPTION"
      : resolved.kind === "COMPANY_HOLIDAY"
        ? "TENANT_CLOSURE"
        : "NON_WORKING"
  return {
    date: input.date,
    calendarKind: resolved.kind,
    state,
    attendanceExpected: false,
    noShowEligible: false,
    excused: state === "PERSONAL_EXCEPTION",
    source,
    overrideId: resolved.overrideId,
  }
}

type WorkforceCalendarDb = Pick<PrismaClient, "mtmAgent" | "mtmWorkCalendarDay">

/**
 * Loads only the exact agent/team/organization candidates for a date. RLS is
 * supplied by the caller's Workforce route boundary; there is no Route read
 * or capability dependency in this adapter.
 */
export async function resolvePersistedWorkforceCalendarDay(
  db: WorkforceCalendarDb,
  input: { organizationId: string; agentId: string; date: string },
): Promise<ResolvedWorkforceCalendarDay> {
  if (!isDateKey(input.date)) {
    throw new WorkforceCalendarResolutionError(
      "WORKFORCE_CALENDAR_DATE_INVALID",
      "Workforce calendar date must be a real YYYY-MM-DD date",
    )
  }
  const agent = await db.mtmAgent.findFirst({
    where: { id: input.agentId, organizationId: input.organizationId },
    select: { id: true, teamId: true },
  })
  if (!agent) {
    throw new WorkforceCalendarResolutionError(
      "WORKFORCE_CALENDAR_AGENT_NOT_FOUND",
      "Workforce employee is unavailable",
    )
  }

  const date = new Date(`${input.date}T00:00:00.000Z`)
  const overrides = await db.mtmWorkCalendarDay.findMany({
    where: {
      organizationId: input.organizationId,
      date,
      deletedAt: null,
      OR: [
        { agentId: input.agentId, teamId: null },
        ...(agent.teamId ? [{ agentId: null, teamId: agent.teamId }] : []),
        { agentId: null, teamId: null },
      ],
    },
    orderBy: [{ agentId: "asc" }, { teamId: "asc" }, { id: "asc" }],
    select: {
      id: true,
      date: true,
      kind: true,
      name: true,
      teamId: true,
      agentId: true,
      movedToDate: true,
      routePlanningAllowed: true,
      source: true,
    },
  })
  return resolveWorkforceCalendarDay({
    date: input.date,
    overrides,
    teamId: agent.teamId,
    agentId: agent.id,
  })
}
