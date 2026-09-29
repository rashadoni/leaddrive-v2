import type { Prisma, PrismaClient } from "@prisma/client"
import { isDateKey } from "@/lib/mtm/mobile-week"
import { isValidTimezone } from "@/lib/timezone"
import { resolveWorkforceCalendarDay, type ResolvedWorkforceCalendarDay } from "@/lib/workforce/calendar"
import {
  parseWorkforceShiftDefinition,
  resolveWorkforceShiftDay,
  workforceShiftDefinitionHash,
} from "@/lib/workforce/shift-definition"
import {
  resolveWorkforceShiftTemplate,
  type WorkforceShiftTemplateCandidate,
} from "@/lib/workforce/shift-resolution"
import { resolveWorkforceHistoricalTeamMemberships } from "@/lib/workforce/team-membership"
import { workforceCalendarFromVerifiedScheduleSnapshot } from "@/lib/workforce/timesheet-schedule-snapshot"
import type {
  WorkforceTimesheetExceptionStatus,
} from "@/lib/workforce/timesheet-read-model"
import type { WorkforceExceptionDraftType } from "@/lib/workforce/exception-policy-draft"

export const WORKFORCE_MANAGER_TODAY_LIMITS = {
  page: 25,
  previousOpenRows: 50,
  exceptionCases: 100,
  decisionsPerCase: 64,
} as const

export type WorkforceManagerTodayPlan = {
  state: "ASSIGNED" | "NON_WORKING_DAY" | "UNAVAILABLE"
  source: "IMMUTABLE_WORKDAY_SNAPSHOT" | "EFFECTIVE_PUBLISHED_SCHEDULE" | "CALENDAR" | "UNAVAILABLE"
  templateName: string | null
  timezone: string | null
  plannedStartAt: string | null
  plannedEndAt: string | null
}

export type WorkforceManagerTodayException = {
  type: WorkforceExceptionDraftType
  status: WorkforceTimesheetExceptionStatus
}

export type WorkforceManagerTodayCalendar = Pick<
  ResolvedWorkforceCalendarDay,
  "attendanceExpected" | "noShowEligible" | "excused"
> & {
  state: ResolvedWorkforceCalendarDay["state"] | "UNAVAILABLE"
}

export type WorkforceManagerTodayPlanContext = {
  plan: WorkforceManagerTodayPlan
  /** Historical team at the stable planned-start instant; null fails closed. */
  calendarTeamId: string | null
}

export type WorkforceManagerTodayAttendanceState =
  | "STARTED"
  | "PAUSED"
  | "COMPLETED"
  | "NO_SHOW"
  | "SCHEDULED_NOT_STARTED"
  | "NOT_EXPECTED"
  | "SCHEDULE_UNAVAILABLE"

export type WorkforceManagerTodayRow = {
  plan: WorkforceManagerTodayPlan
  calendar: WorkforceManagerTodayCalendar
  attendance: {
    state: WorkforceManagerTodayAttendanceState
    acceptedStartRecorded: boolean
  }
  exceptions: WorkforceManagerTodayException[] | null
  boundaries: {
    rawEvidence: "EXCLUDED"
    location: "EXCLUDED"
    reasons: "EXCLUDED"
    actors: "EXCLUDED"
    caseIdentifiers: "EXCLUDED"
    presenceConclusion: "NOT_INFERRED"
  }
}

type ManagerTodayShiftDb = Pick<
  PrismaClient,
  | "$queryRaw"
  | "workforceShiftAssignment"
  | "workforceShiftDefaultAssignment"
  | "workforceShiftTeamDefaultAssignment"
  | "workforceShiftTemplate"
>

const templateSelect = {
  id: true,
  name: true,
  teamId: true,
  isDefault: true,
  version: true,
  status: true,
  timezone: true,
  activatedAt: true,
  retiredAt: true,
  definition: true,
  definitionHash: true,
} satisfies Prisma.WorkforceShiftTemplateSelect

const personalAssignmentSelect = {
  id: true,
  agentId: true,
  template: { select: templateSelect },
} satisfies Prisma.WorkforceShiftAssignmentSelect

const teamDefaultSelect = {
  id: true,
  teamId: true,
  template: { select: templateSelect },
} satisfies Prisma.WorkforceShiftTeamDefaultAssignmentSelect

const organizationDefaultSelect = {
  id: true,
  template: { select: templateSelect },
} satisfies Prisma.WorkforceShiftDefaultAssignmentSelect

type PersonalAssignment = Prisma.WorkforceShiftAssignmentGetPayload<{
  select: typeof personalAssignmentSelect
}>
type TeamDefault = Prisma.WorkforceShiftTeamDefaultAssignmentGetPayload<{
  select: typeof teamDefaultSelect
}>
type OrganizationDefault = Prisma.WorkforceShiftDefaultAssignmentGetPayload<{
  select: typeof organizationDefaultSelect
}>
type Template = Prisma.WorkforceShiftTemplateGetPayload<{ select: typeof templateSelect }>

export class WorkforceManagerTodayBoundsError extends Error {
  readonly code = "WORKFORCE_MANAGER_TODAY_BOUNDS_EXCEEDED"
}

function unavailablePlan(): WorkforceManagerTodayPlan {
  return {
    state: "UNAVAILABLE",
    source: "UNAVAILABLE",
    templateName: null,
    timezone: null,
    plannedStartAt: null,
    plannedEndAt: null,
  }
}

export function workforceManagerTodayUnavailableCalendar(): WorkforceManagerTodayCalendar {
  return {
    state: "UNAVAILABLE",
    attendanceExpected: false,
    noShowEligible: false,
    excused: false,
  }
}

function nonWorkingPlan(source: WorkforceManagerTodayPlan["source"]): WorkforceManagerTodayPlan {
  return {
    state: "NON_WORKING_DAY",
    source,
    templateName: null,
    timezone: null,
    plannedStartAt: null,
    plannedEndAt: null,
  }
}

function assignedPlan(input: {
  source: WorkforceManagerTodayPlan["source"]
  templateName: string | null
  timezone: string
  plannedStartAt: string
  plannedEndAt: string
}): WorkforceManagerTodayPlan {
  return { state: "ASSIGNED", ...input }
}

function canonicalDate(value: Date): string | null {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) return null
  const serialized = value.toISOString()
  const date = serialized.slice(0, 10)
  return serialized === `${date}T00:00:00.000Z` && isDateKey(date) ? date : null
}

export function workforceManagerTodayPlanFromSnapshot(input: {
  workDate: string
  snapshot: {
    workDate: Date
    timezone: string
    definition: unknown
    definitionHash: string
    plannedStartAt: Date
    plannedEndAt: Date
    template: { name: string }
  } | null
}): WorkforceManagerTodayPlan {
  const snapshot = input.snapshot
  if (!snapshot || !isDateKey(input.workDate) || canonicalDate(snapshot.workDate) !== input.workDate) {
    return unavailablePlan()
  }
  try {
    parseWorkforceShiftDefinition(snapshot.definition)
    if (
      !isValidTimezone(snapshot.timezone)
      || !/^[a-f0-9]{64}$/i.test(snapshot.definitionHash)
      || workforceShiftDefinitionHash(snapshot.definition) !== snapshot.definitionHash.toLowerCase()
    ) return unavailablePlan()
    const resolved = resolveWorkforceShiftDay({
      workDate: input.workDate,
      definition: snapshot.definition,
      templateTimezone: snapshot.timezone,
    })
    if (
      !resolved
      || resolved.plannedStartAt !== snapshot.plannedStartAt.toISOString()
      || resolved.plannedEndAt !== snapshot.plannedEndAt.toISOString()
    ) return unavailablePlan()
    return assignedPlan({
      source: "IMMUTABLE_WORKDAY_SNAPSHOT",
      templateName: snapshot.template.name,
      timezone: snapshot.timezone,
      plannedStartAt: resolved.plannedStartAt,
      plannedEndAt: resolved.plannedEndAt,
    })
  } catch {
    return unavailablePlan()
  }
}

export function workforceManagerTodayCalendarFromSnapshot(input: {
  workDate: string
  workdayId: string
  agentId: string
  policySnapshot: {
    id: string
    definitionHash: string
  } | null
  shiftSnapshot: {
    id: string
    definition: unknown
    definitionHash: string
  } | null
  scheduleSnapshot: {
    id: string
    workdayId: string
    agentId: string
    workDate: Date
    policySnapshotId: string
    shiftSnapshotId: string
    schemaVersion: number
    calendarState: string
    calendarSnapshot: unknown
    segments: unknown
    sites: unknown
    snapshotHash: string
  } | null
}): WorkforceManagerTodayCalendar {
  const { policySnapshot, shiftSnapshot, scheduleSnapshot } = input
  if (
    !isDateKey(input.workDate)
    || !policySnapshot
    || !shiftSnapshot
    || !scheduleSnapshot
    || scheduleSnapshot.workdayId !== input.workdayId
    || scheduleSnapshot.agentId !== input.agentId
    || canonicalDate(scheduleSnapshot.workDate) !== input.workDate
  ) return workforceManagerTodayUnavailableCalendar()
  try {
    const shiftDefinition = parseWorkforceShiftDefinition(shiftSnapshot.definition)
    const calendar = workforceCalendarFromVerifiedScheduleSnapshot({
      snapshot: scheduleSnapshot,
      workDate: input.workDate,
      policySnapshotId: policySnapshot.id,
      policyDefinitionHash: policySnapshot.definitionHash,
      shiftSnapshotId: shiftSnapshot.id,
      shiftDefinitionHash: shiftSnapshot.definitionHash,
      shiftDefinition,
    })
    return {
      state: calendar.state,
      attendanceExpected: calendar.attendanceExpected,
      noShowEligible: calendar.noShowEligible,
      excused: calendar.excused,
    }
  } catch {
    return workforceManagerTodayUnavailableCalendar()
  }
}

function groupBy<T>(values: readonly T[], key: (value: T) => string): Map<string, T[]> {
  const result = new Map<string, T[]>()
  for (const value of values) {
    const id = key(value)
    result.set(id, [...(result.get(id) ?? []), value])
  }
  return result
}

type LoadedDefaults = {
  teamDefaults: Map<string, TeamDefault[]>
  legacyDefaults: Map<string, Template[]>
}

async function loadTeamDefaults(
  db: ManagerTodayShiftDb,
  input: { organizationId: string; workDate: Date; teamIds: readonly string[] },
): Promise<LoadedDefaults> {
  if (input.teamIds.length === 0) return { teamDefaults: new Map(), legacyDefaults: new Map() }
  const maximum = input.teamIds.length * 2
  const [teamDefaults, legacyDefaults] = await Promise.all([
    db.workforceShiftTeamDefaultAssignment.findMany({
      where: {
        organizationId: input.organizationId,
        teamId: { in: [...input.teamIds] },
        effectiveFrom: { lte: input.workDate },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: input.workDate } }],
      },
      orderBy: [{ teamId: "asc" }, { id: "asc" }],
      take: maximum + 1,
      select: teamDefaultSelect,
    }),
    db.workforceShiftTemplate.findMany({
      where: {
        organizationId: input.organizationId,
        teamId: { in: [...input.teamIds] },
        isDefault: true,
        status: { in: ["ACTIVE", "RETIRED"] },
      },
      orderBy: [{ teamId: "asc" }, { id: "asc" }],
      take: maximum + 1,
      select: templateSelect,
    }),
  ])
  if (teamDefaults.length > maximum || legacyDefaults.length > maximum) {
    throw new WorkforceManagerTodayBoundsError()
  }
  return {
    teamDefaults: groupBy(teamDefaults, (row) => row.teamId),
    legacyDefaults: groupBy(legacyDefaults, (row) => row.teamId ?? ""),
  }
}

function mergeGroups<T>(target: Map<string, T[]>, source: ReadonlyMap<string, T[]>): void {
  for (const [key, values] of source) target.set(key, values)
}

function single<T>(values: readonly T[] | undefined): T | null | "AMBIGUOUS" {
  if (!values || values.length === 0) return null
  return values.length === 1 ? values[0] : "AMBIGUOUS"
}

function resolveLoadedShift(input: {
  agentId: string
  teamId: string | null
  workDate: string
  scopeInstant: Date
  resolutionAt: Date
  personalByAgent: ReadonlyMap<string, PersonalAssignment[]>
  teamDefaults: ReadonlyMap<string, TeamDefault[]>
  organizationDefaults: readonly OrganizationDefault[]
  teamLegacyDefaults: ReadonlyMap<string, Template[]>
  organizationLegacyDefaults: readonly Template[]
}) {
  const personal = single(input.personalByAgent.get(input.agentId))
  if (personal === "AMBIGUOUS") return null
  let template: WorkforceShiftTemplateCandidate | null = personal?.template ?? null
  let defaultAssignmentId: string | null = null
  let teamDefaultAssignmentId: string | null = null

  if (!template) {
    const teamDefault = input.teamId == null ? null : single(input.teamDefaults.get(input.teamId))
    if (teamDefault === "AMBIGUOUS") return null
    if (teamDefault) {
      template = teamDefault.template
      teamDefaultAssignmentId = teamDefault.id
    }
  }
  if (!template) {
    const organizationDefault = single(input.organizationDefaults)
    if (organizationDefault === "AMBIGUOUS") return null
    if (organizationDefault) {
      template = organizationDefault.template
      defaultAssignmentId = organizationDefault.id
    }
  }
  if (!template) {
    const teamLegacy = input.teamId == null ? null : single(input.teamLegacyDefaults.get(input.teamId))
    if (teamLegacy === "AMBIGUOUS") return null
    template = teamLegacy
  }
  if (!template) {
    const organizationLegacy = single(input.organizationLegacyDefaults)
    if (organizationLegacy === "AMBIGUOUS") return null
    template = organizationLegacy
  }
  if (!template) return null
  try {
    return resolveWorkforceShiftTemplate({
      workDate: input.workDate,
      workdayStartedAt: input.scopeInstant,
      resolutionAt: input.resolutionAt,
      teamMembershipId: null,
      teamIdAtWorkday: input.teamId,
      template,
      assignmentId: personal?.id ?? null,
      defaultAssignmentId,
      teamDefaultAssignmentId,
    })
  } catch {
    return null
  }
}

/**
 * Resolves a whole visible roster page with a constant number of bounded
 * queries. It mirrors personal/team/org/legacy precedence and re-evaluates
 * historical team membership at the resolved planned start without issuing
 * one query sequence per employee.
 */
type WorkforceManagerTodayPlanInput = {
  organizationId: string
  agentIds: readonly string[]
  workDate: string
  resolutionAt: Date
}

export async function resolveWorkforceManagerTodayPlanContexts(
  db: ManagerTodayShiftDb,
  input: WorkforceManagerTodayPlanInput,
): Promise<ReadonlyMap<string, WorkforceManagerTodayPlanContext>> {
  if (
    !input.organizationId
    || !isDateKey(input.workDate)
    || !(input.resolutionAt instanceof Date)
    || !Number.isFinite(input.resolutionAt.getTime())
    || input.agentIds.length > WORKFORCE_MANAGER_TODAY_LIMITS.page
    || new Set(input.agentIds).size !== input.agentIds.length
  ) throw new WorkforceManagerTodayBoundsError()
  if (input.agentIds.length === 0) return new Map()
  const workDate = new Date(`${input.workDate}T00:00:00.000Z`)
  const maximumPersonal = input.agentIds.length * 2
  const [initialTeams, personalAssignments, organizationDefaults, organizationLegacyDefaults] = await Promise.all([
    resolveWorkforceHistoricalTeamMemberships(db, {
      organizationId: input.organizationId,
      candidates: input.agentIds.map((agentId) => ({
        requestId: agentId,
        agentId,
        workdayStartedAt: input.resolutionAt,
      })),
    }),
    db.workforceShiftAssignment.findMany({
      where: {
        organizationId: input.organizationId,
        agentId: { in: [...input.agentIds] },
        effectiveFrom: { lte: workDate },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: workDate } }],
      },
      orderBy: [{ agentId: "asc" }, { id: "asc" }],
      take: maximumPersonal + 1,
      select: personalAssignmentSelect,
    }),
    db.workforceShiftDefaultAssignment.findMany({
      where: {
        organizationId: input.organizationId,
        effectiveFrom: { lte: workDate },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: workDate } }],
      },
      orderBy: { id: "asc" },
      take: 3,
      select: organizationDefaultSelect,
    }),
    db.workforceShiftTemplate.findMany({
      where: {
        organizationId: input.organizationId,
        teamId: null,
        isDefault: true,
        status: { in: ["ACTIVE", "RETIRED"] },
      },
      orderBy: { id: "asc" },
      take: 3,
      select: templateSelect,
    }),
  ])
  if (personalAssignments.length > maximumPersonal) throw new WorkforceManagerTodayBoundsError()
  const personalByAgent = groupBy(personalAssignments, (row) => row.agentId)
  const teamDefaults = new Map<string, TeamDefault[]>()
  const teamLegacyDefaults = new Map<string, Template[]>()
  const loadedTeamIds = new Set<string>()
  const calendarTeams = new Map(initialTeams)

  const ensureTeams = async (values: Iterable<string | null>) => {
    const missing = [...new Set([...values].filter((value): value is string => Boolean(value)))]
      .filter((value) => !loadedTeamIds.has(value))
    if (missing.length === 0) return
    const loaded = await loadTeamDefaults(db, {
      organizationId: input.organizationId,
      workDate,
      teamIds: missing,
    })
    mergeGroups(teamDefaults, loaded.teamDefaults)
    mergeGroups(teamLegacyDefaults, loaded.legacyDefaults)
    missing.forEach((teamId) => loadedTeamIds.add(teamId))
  }
  await ensureTeams(initialTeams.values())

  const resolved = new Map<string, ReturnType<typeof resolveLoadedShift>>()
  for (const agentId of input.agentIds) {
    resolved.set(agentId, resolveLoadedShift({
      agentId,
      teamId: initialTeams.get(agentId) ?? null,
      workDate: input.workDate,
      scopeInstant: input.resolutionAt,
      resolutionAt: input.resolutionAt,
      personalByAgent,
      teamDefaults,
      organizationDefaults,
      teamLegacyDefaults,
      organizationLegacyDefaults,
    }))
  }

  let pendingAgentIds = [...input.agentIds]
  for (let pass = 0; pass < 2; pass += 1) {
    const candidates = pendingAgentIds.flatMap((agentId) => {
      const schedule = resolved.get(agentId)?.schedule
      if (!schedule) return []
      return [{ requestId: agentId, agentId, workdayStartedAt: new Date(schedule.plannedStartAt) }]
    })
    if (candidates.length === 0) break
    const teams = await resolveWorkforceHistoricalTeamMemberships(db, {
      organizationId: input.organizationId,
      candidates,
    })
    await ensureTeams(teams.values())
    const changedAgentIds: string[] = []
    for (const candidate of candidates) {
      const prior = resolved.get(candidate.agentId)
      const historicalTeamId = teams.get(candidate.agentId) ?? null
      calendarTeams.set(candidate.agentId, historicalTeamId)
      const next = resolveLoadedShift({
        agentId: candidate.agentId,
        teamId: historicalTeamId,
        workDate: input.workDate,
        scopeInstant: candidate.workdayStartedAt,
        resolutionAt: input.resolutionAt,
        personalByAgent,
        teamDefaults,
        organizationDefaults,
        teamLegacyDefaults,
        organizationLegacyDefaults,
      })
      const changed = next?.schedule?.plannedStartAt !== prior?.schedule?.plannedStartAt
      if (changed) changedAgentIds.push(candidate.agentId)
      // A schedule that disappears after moving the membership instant has
      // no second immutable instant against which it can be validated.
      resolved.set(candidate.agentId, changed && next?.schedule == null ? null : next)
    }
    if (changedAgentIds.length === 0) break
    if (pass === 1) {
      for (const agentId of changedAgentIds) {
        resolved.set(agentId, null)
        calendarTeams.set(agentId, null)
      }
    } else {
      pendingAgentIds = changedAgentIds
    }
  }

  const contexts = new Map<string, WorkforceManagerTodayPlanContext>()
  for (const agentId of input.agentIds) {
    const shift = resolved.get(agentId)
    const plan = shift == null
      ? unavailablePlan()
      : shift.schedule == null
        ? nonWorkingPlan("EFFECTIVE_PUBLISHED_SCHEDULE")
        : assignedPlan({
            source: "EFFECTIVE_PUBLISHED_SCHEDULE",
            templateName: shift.name ?? null,
            timezone: shift.timezone,
            plannedStartAt: shift.schedule.plannedStartAt,
            plannedEndAt: shift.schedule.plannedEndAt,
          })
    contexts.set(agentId, {
      plan,
      calendarTeamId: calendarTeams.get(agentId) ?? null,
    })
  }
  return contexts
}

export async function resolveWorkforceManagerTodayPlans(
  db: ManagerTodayShiftDb,
  input: WorkforceManagerTodayPlanInput,
): Promise<ReadonlyMap<string, WorkforceManagerTodayPlan>> {
  const contexts = await resolveWorkforceManagerTodayPlanContexts(db, input)
  const plans = new Map<string, WorkforceManagerTodayPlan>()
  for (const [agentId, context] of contexts) plans.set(agentId, context.plan)
  return plans
}

export function buildWorkforceManagerTodayRow(input: {
  workdayStatus: "STARTED" | "PAUSED" | "COMPLETED" | null
  plan: WorkforceManagerTodayPlan
  calendar: WorkforceManagerTodayCalendar
  exceptions: WorkforceManagerTodayException[] | null
}): WorkforceManagerTodayRow {
  const persistedNoShow = input.workdayStatus == null && input.exceptions?.some((exception) => (
    exception.type === "NO_SHOW" && exception.status !== "RESOLVED"
  )) === true
  const state: WorkforceManagerTodayAttendanceState = input.workdayStatus
    ?? (persistedNoShow
      ? "NO_SHOW"
      : input.calendar.state === "UNAVAILABLE"
        ? "SCHEDULE_UNAVAILABLE"
        : !input.calendar.attendanceExpected || input.plan.state === "NON_WORKING_DAY"
        ? "NOT_EXPECTED"
        : input.plan.state === "ASSIGNED"
          ? "SCHEDULED_NOT_STARTED"
          : "SCHEDULE_UNAVAILABLE")
  return {
    plan: input.plan,
    calendar: {
      state: input.calendar.state,
      attendanceExpected: input.calendar.attendanceExpected,
      noShowEligible: input.calendar.noShowEligible,
      excused: input.calendar.excused,
    },
    attendance: {
      state,
      acceptedStartRecorded: input.workdayStatus != null,
    },
    exceptions: input.exceptions,
    boundaries: {
      rawEvidence: "EXCLUDED",
      location: "EXCLUDED",
      reasons: "EXCLUDED",
      actors: "EXCLUDED",
      caseIdentifiers: "EXCLUDED",
      presenceConclusion: "NOT_INFERRED",
    },
  }
}

export function summarizeWorkforceManagerTodayRows(
  rows: readonly {
    status: "STARTED" | "PAUSED" | "COMPLETED" | "NOT_STARTED"
    previousOpenWorkday: unknown
  }[],
) {
  return rows.reduce((counts, row) => {
    if (row.status === "STARTED") counts.started += 1
    else if (row.status === "PAUSED") counts.paused += 1
    else if (row.status === "COMPLETED") counts.completed += 1
    else counts.notStarted += 1
    if (row.previousOpenWorkday) counts.previousOpen += 1
    return counts
  }, { started: 0, paused: 0, completed: 0, notStarted: 0, previousOpen: 0 })
}

export { resolveWorkforceCalendarDay }
