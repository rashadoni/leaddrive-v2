import { Prisma, type PrismaClient } from "@prisma/client"
import { addDateKeyDays, isDateKey } from "@/lib/mtm/mobile-week"
import { resolveWorkCalendarDay } from "@/lib/mtm/work-calendar"
import { prisma } from "@/lib/prisma"
import type { WorkforceConfigurationAuditContext } from "@/lib/workforce/configuration-management"
import {
  WORKFORCE_CALENDAR_AGENT_QUERY_MAX_LENGTH,
  WORKFORCE_CALENDAR_AGENT_SEARCH_LIMIT,
  WORKFORCE_CALENDAR_TEAM_QUERY_MAX_LENGTH,
  WORKFORCE_CALENDAR_TEAM_SEARCH_LIMIT,
  WorkforceCalendarMovedDayReverseSchema,
  type WorkforceCalendarAgentSummary,
  type WorkforceCalendarAgentStatus,
  type WorkforceCalendarConfigurationScope,
  type WorkforceCalendarMovedDayDraft,
  type WorkforceCalendarMovedDayReverseDraft,
  type WorkforceCalendarOverrideDraft,
  type WorkforceCalendarOverrideSummary,
  type WorkforceCalendarTeamSummary,
} from "@/lib/workforce/calendar-configuration-contract"
import {
  calendarPairGeneration,
  calendarPairMatches,
  calendarPairSelect,
  calendarReversalReceiptSchema,
  calendarReversalSelect,
  calendarReversalSnapshot,
  calendarRowFromSnapshot,
  calendarSnapshotEquals,
} from "@/lib/workforce/calendar-moved-day-pair"

const calendarExistingSelect = {
  id: true,
  date: true,
  kind: true,
  name: true,
  teamId: true,
  agentId: true,
  movedToDate: true,
  routePlanningAllowed: true,
  source: true,
} satisfies Prisma.MtmWorkCalendarDaySelect

const calendarTeamSelect = {
  id: true,
  name: true,
  code: true,
  isActive: true,
} satisfies Prisma.MtmTeamSelect

const calendarAgentSelect = {
  id: true,
  name: true,
  externalCode: true,
  status: true,
  team: { select: calendarTeamSelect },
} satisfies Prisma.MtmAgentSelect

export class WorkforceCalendarConfigurationError extends Error {
  constructor(
    readonly code:
      | "WORKFORCE_CALENDAR_CONFIGURATION_DATE_RANGE_INVALID"
      | "WORKFORCE_CALENDAR_CONFIGURATION_DATE_NOT_FUTURE"
      | "WORKFORCE_CALENDAR_CONFIGURATION_OVERRIDE_EXISTS"
      | "WORKFORCE_CALENDAR_CONFIGURATION_MOVE_DATES_INVALID"
      | "WORKFORCE_CALENDAR_CONFIGURATION_MOVE_SOURCE_NOT_WORKING"
      | "WORKFORCE_CALENDAR_CONFIGURATION_MOVE_DESTINATION_NOT_NON_WORKING"
      | "WORKFORCE_CALENDAR_CONFIGURATION_REVERSE_PAIR_CHANGED"
      | "WORKFORCE_CALENDAR_CONFIGURATION_REVERSE_ROUTE_CHANGED"
      | "WORKFORCE_CALENDAR_CONFIGURATION_REVERSE_BUSY"
      | "WORKFORCE_CALENDAR_CONFIGURATION_SCOPE_INVALID"
      | "WORKFORCE_CALENDAR_CONFIGURATION_AGENT_UNAVAILABLE"
      | "WORKFORCE_CALENDAR_CONFIGURATION_AGENT_SEARCH_INVALID"
      | "WORKFORCE_CALENDAR_CONFIGURATION_TEAM_UNAVAILABLE"
      | "WORKFORCE_CALENDAR_CONFIGURATION_TEAM_SEARCH_INVALID",
    message: string = code,
  ) {
    super(message)
  }
}

function asDatabaseDate(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`)
}

function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function calendarSummary(row: {
  date: Date
  kind: string
  name: string | null
  movedToDate?: Date | null
}): WorkforceCalendarOverrideSummary {
  return {
    date: dateKey(row.date),
    kind: row.kind as WorkforceCalendarOverrideSummary["kind"],
    name: row.name,
    pairedDate: row.movedToDate ? dateKey(row.movedToDate) : null,
  }
}

function assertFutureRange(input: {
  currentDate: string
  start: string
  endExclusive: string
}): void {
  if (
    !isDateKey(input.currentDate)
    || !isDateKey(input.start)
    || !isDateKey(input.endExclusive)
    || input.start <= input.currentDate
    || input.endExclusive <= input.start
    || input.endExclusive > addDateKeyDays(input.start, 367)
  ) {
    throw new WorkforceCalendarConfigurationError(
      "WORKFORCE_CALENDAR_CONFIGURATION_DATE_RANGE_INVALID",
      "Choose a future calendar range of 1 to 367 days",
    )
  }
}

function isPrismaCode(error: unknown, code: string): boolean {
  return (error as { code?: unknown } | null)?.code === code
}

export type WorkforceCalendarConfigurationLockDb = Pick<
  Prisma.TransactionClient,
  "$executeRaw"
>

/**
 * Locks calendar dates in one deterministic order across every supported
 * writer. Sorting prevents reversed moved-day requests from deadlocking;
 * de-duplication keeps the primitive safe for callers that already validated
 * their input but happen to supply the same key twice.
 */
export async function lockWorkforceCalendarConfigurationDates(input: {
  db: WorkforceCalendarConfigurationLockDb
  organizationId: string
  dates: readonly string[]
}): Promise<void> {
  const dates = [...new Set(input.dates)].sort()
  for (const date of dates) {
    await input.db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`workforce-calendar-configuration:${input.organizationId}:${date}`}))`
  }
}

function targetForScope(input: {
  scope: WorkforceCalendarConfigurationScope
  teamId?: string
  agentId?: string
}): { teamId: string | null; agentId: string | null } {
  if (input.scope === "TEAM") {
    if (input.teamId && input.agentId === undefined) {
      return { teamId: input.teamId, agentId: null }
    }
  } else if (input.scope === "AGENT") {
    if (input.agentId && input.teamId === undefined) {
      return { teamId: null, agentId: input.agentId }
    }
  } else if (input.teamId === undefined && input.agentId === undefined) {
    return { teamId: null, agentId: null }
  }
  throw new WorkforceCalendarConfigurationError(
    "WORKFORCE_CALENDAR_CONFIGURATION_SCOPE_INVALID",
    "Choose one supported calendar scope",
  )
}

function calendarAgentSummary(row: {
  id: string
  name: string
  externalCode: string | null
  status: string
  team: WorkforceCalendarTeamSummary | null
}): WorkforceCalendarAgentSummary {
  return {
    id: row.id,
    name: row.name,
    externalCode: row.externalCode,
    status: row.status as WorkforceCalendarAgentStatus,
    currentTeam: row.team,
  }
}

export async function searchWorkforceCalendarTeams(input: {
  organizationId: string
  query: string
  limit?: number
  selectedTeamId?: string
  db?: PrismaClient
}): Promise<{
  teams: WorkforceCalendarTeamSummary[]
  selectedTeam: WorkforceCalendarTeamSummary | null
  query: string
  limit: number
  hasMore: boolean
}> {
  const query = input.query.trim()
  const limit = input.limit ?? WORKFORCE_CALENDAR_TEAM_SEARCH_LIMIT
  if (
    query.length > WORKFORCE_CALENDAR_TEAM_QUERY_MAX_LENGTH
    || !Number.isSafeInteger(limit)
    || limit < 1
    || limit > WORKFORCE_CALENDAR_TEAM_SEARCH_LIMIT
  ) {
    throw new WorkforceCalendarConfigurationError(
      "WORKFORCE_CALENDAR_CONFIGURATION_TEAM_SEARCH_INVALID",
      "Choose a valid bounded team search",
    )
  }
  const db = input.db ?? prisma
  const [matches, selectedTeam] = await Promise.all([
    db.mtmTeam.findMany({
      where: {
        organizationId: input.organizationId,
        isActive: true,
        ...(query
          ? {
              OR: [
                { name: { contains: query, mode: "insensitive" as const } },
                { code: { contains: query, mode: "insensitive" as const } },
              ],
            }
          : {}),
      },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      take: limit + 1,
      select: calendarTeamSelect,
    }),
    input.selectedTeamId
      ? db.mtmTeam.findFirst({
          where: { organizationId: input.organizationId, id: input.selectedTeamId },
          select: calendarTeamSelect,
        })
      : Promise.resolve(null),
  ])
  return {
    teams: matches.slice(0, limit),
    selectedTeam,
    query,
    limit,
    hasMore: matches.length > limit,
  }
}

export async function searchWorkforceCalendarAgents(input: {
  organizationId: string
  query: string
  limit?: number
  selectedAgentId?: string
  db?: PrismaClient
}): Promise<{
  agents: WorkforceCalendarAgentSummary[]
  selectedAgent: WorkforceCalendarAgentSummary | null
  query: string
  limit: number
  hasMore: boolean
}> {
  const query = input.query.trim()
  const limit = input.limit ?? WORKFORCE_CALENDAR_AGENT_SEARCH_LIMIT
  if (
    query.length > WORKFORCE_CALENDAR_AGENT_QUERY_MAX_LENGTH
    || !Number.isSafeInteger(limit)
    || limit < 1
    || limit > WORKFORCE_CALENDAR_AGENT_SEARCH_LIMIT
  ) {
    throw new WorkforceCalendarConfigurationError(
      "WORKFORCE_CALENDAR_CONFIGURATION_AGENT_SEARCH_INVALID",
      "Choose a valid bounded employee search",
    )
  }
  const db = input.db ?? prisma
  const [matches, selectedAgent] = await Promise.all([
    db.mtmAgent.findMany({
      where: {
        organizationId: input.organizationId,
        status: "ACTIVE",
        ...(query
          ? {
              OR: [
                { name: { contains: query, mode: "insensitive" as const } },
                { externalCode: { contains: query, mode: "insensitive" as const } },
              ],
            }
          : {}),
      },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      take: limit + 1,
      select: calendarAgentSelect,
    }),
    input.selectedAgentId
      ? db.mtmAgent.findFirst({
          where: { organizationId: input.organizationId, id: input.selectedAgentId },
          select: calendarAgentSelect,
        })
      : Promise.resolve(null),
  ])
  return {
    agents: matches.slice(0, limit).map(calendarAgentSummary),
    selectedAgent: selectedAgent ? calendarAgentSummary(selectedAgent) : null,
    query,
    limit,
    hasMore: matches.length > limit,
  }
}

export async function listWorkforceCalendarOverrides(input: {
  organizationId: string
  currentDate: string
  start: string
  endExclusive: string
  scope: WorkforceCalendarConfigurationScope
  teamId?: string
  agentId?: string
  db?: PrismaClient
}): Promise<WorkforceCalendarOverrideSummary[]> {
  assertFutureRange(input)
  const target = targetForScope(input)
  const db: PrismaClient = input.db ?? prisma
  const rows = await db.mtmWorkCalendarDay.findMany({
    where: {
      organizationId: input.organizationId,
      date: {
        gte: asDatabaseDate(input.start),
        lt: asDatabaseDate(input.endExclusive),
      },
      teamId: target.teamId,
      agentId: target.agentId,
      deletedAt: null,
    },
    orderBy: [{ date: "asc" }, { id: "asc" }],
    select: calendarPairSelect,
  })
  const maximumDate = addDateKeyDays(input.currentDate, 367)
  const sources = input.scope === "AGENT" ? [] : rows.filter((row) => (
    row.kind === "MOVED_DAY_OFF" && row.deletedAt === null && row.movedToDate
    && dateKey(row.date) > input.currentDate && dateKey(row.date) <= maximumDate
    && dateKey(row.movedToDate) > input.currentDate && dateKey(row.movedToDate) <= maximumDate
  ))
  // One bounded partner query, including a partner outside the selected read
  // window. Internal IDs/provenance are never returned as calendar summaries.
  const partnerDates = [...new Set(sources.map((row) => dateKey(row.movedToDate as Date)))]
  const partners = partnerDates.length ? await db.mtmWorkCalendarDay.findMany({
    where: {
      organizationId: input.organizationId, teamId: target.teamId, agentId: null,
      deletedAt: null, date: { in: partnerDates.map(asDatabaseDate) },
    },
    select: calendarPairSelect,
  }) : []
  return rows.map((row) => {
    const summary = calendarSummary(row)
    if (!sources.includes(row)) return summary
    const destination = partners.find((partner) => dateKey(partner.date) === dateKey(row.movedToDate as Date))
    if (destination && calendarPairMatches(row, destination, {
      organizationId: input.organizationId, teamId: target.teamId,
      sourceDate: dateKey(row.date), destinationDate: dateKey(destination.date),
    })) summary.pairGenerationId = calendarPairGeneration(row, destination)
    return summary
  })
}

/**
 * Adds one organization/team/employee future exception to the retained
 * calendar ledger. The operation is state-idempotent: an exact existing state
 * is a safe retry; a different state for the same tenant/date/scope is a
 * conflict.
 */
export async function createWorkforceCalendarOverride(input: {
  organizationId: string
  createdByUserId: string
  currentDate: string
  draft: WorkforceCalendarOverrideDraft
  audit: WorkforceConfigurationAuditContext
  db?: PrismaClient
}): Promise<{
  day: WorkforceCalendarOverrideSummary
  team: WorkforceCalendarTeamSummary | null
  agent: WorkforceCalendarAgentSummary | null
  created: boolean
}> {
  if (!isDateKey(input.currentDate) || input.draft.date <= input.currentDate) {
    throw new WorkforceCalendarConfigurationError(
      "WORKFORCE_CALENDAR_CONFIGURATION_DATE_NOT_FUTURE",
      "Calendar overrides must start after the organization's current date",
    )
  }
  const target = targetForScope(input.draft)
  const db = input.db ?? prisma

  try {
    return await db.$transaction(async (tx) => {
      await lockWorkforceCalendarConfigurationDates({
        db: tx,
        organizationId: input.organizationId,
        dates: [input.draft.date],
      })
      const team = input.draft.scope === "TEAM"
        ? await tx.mtmTeam.findFirst({
            where: {
              organizationId: input.organizationId,
              id: target.teamId as string,
              isActive: true,
            },
            select: calendarTeamSelect,
          })
        : null
      if (input.draft.scope === "TEAM" && !team) {
        throw new WorkforceCalendarConfigurationError(
          "WORKFORCE_CALENDAR_CONFIGURATION_TEAM_UNAVAILABLE",
          "The selected active team is unavailable",
        )
      }

      let agent: WorkforceCalendarAgentSummary | null = null
      let currentAgentTeamId: string | null = null
      if (input.draft.scope === "AGENT") {
        const [lockedAgent] = await tx.$queryRaw<Array<{
          id: string
          name: string
          externalCode: string | null
          status: string
          teamId: string | null
          teamRecordId: string | null
          teamName: string | null
          teamCode: string | null
          teamIsActive: boolean | null
        }>>(Prisma.sql`
          SELECT
            agent."id",
            agent."name",
            agent."externalCode",
            agent."status"::text AS "status",
            agent."teamId",
            team."id" AS "teamRecordId",
            team."name" AS "teamName",
            team."code" AS "teamCode",
            team."isActive" AS "teamIsActive"
          FROM "mtm_agents" AS agent
          LEFT JOIN "mtm_teams" AS team
            ON team."organizationId" = agent."organizationId"
           AND team."id" = agent."teamId"
          WHERE agent."organizationId" = ${input.organizationId}
            AND agent."id" = ${target.agentId as string}
            AND agent."status" = 'ACTIVE'
          FOR SHARE OF agent
        `)
        if (!lockedAgent) {
          throw new WorkforceCalendarConfigurationError(
            "WORKFORCE_CALENDAR_CONFIGURATION_AGENT_UNAVAILABLE",
            "The selected active employee is unavailable",
          )
        }
        currentAgentTeamId = lockedAgent.teamId
        agent = {
          id: lockedAgent.id,
          name: lockedAgent.name,
          externalCode: lockedAgent.externalCode,
          status: "ACTIVE",
          currentTeam: lockedAgent.teamRecordId && lockedAgent.teamName
            ? {
                id: lockedAgent.teamRecordId,
                name: lockedAgent.teamName,
                code: lockedAgent.teamCode,
                isActive: lockedAgent.teamIsActive === true,
              }
            : null,
        }
      }

      const candidateScopes: Prisma.MtmWorkCalendarDayWhereInput[] = input.draft.scope === "AGENT"
        ? [
            { teamId: null, agentId: target.agentId },
            { teamId: null, agentId: null },
            ...(currentAgentTeamId ? [{ teamId: currentAgentTeamId, agentId: null }] : []),
          ]
        : input.draft.scope === "TEAM"
          ? [{ teamId: target.teamId, agentId: null }, { teamId: null, agentId: null }]
          : [{ teamId: null, agentId: null }]

      const candidates = await tx.mtmWorkCalendarDay.findMany({
        where: {
          organizationId: input.organizationId,
          date: asDatabaseDate(input.draft.date),
          deletedAt: null,
          OR: candidateScopes,
        },
        orderBy: [{ agentId: "asc" }, { teamId: "asc" }, { id: "asc" }],
        select: calendarExistingSelect,
      })
      const existing = candidates.find((candidate) => (
        candidate.teamId === target.teamId && candidate.agentId === target.agentId
      ))
      const baselineOverrides = input.draft.scope === "AGENT"
        ? candidates.filter((candidate) => candidate.agentId === null)
        : input.draft.scope === "TEAM"
          ? candidates.filter((candidate) => candidate.teamId === null && candidate.agentId === null)
          : []
      const routePlanningAllowed = resolveWorkCalendarDay({
        date: input.draft.date,
        // The target row is the state being validated, never its own baseline.
        // Team scope inherits organization state; employee scope inherits the
        // locked current team's effective organization/team state.
        overrides: baselineOverrides,
        teamId: input.draft.scope === "AGENT" ? currentAgentTeamId : target.teamId,
        agentId: target.agentId,
      }).routePlanningAllowed
      if (existing) {
        const exactState = existing.kind === input.draft.kind
          && existing.name === input.draft.name
          && existing.teamId === target.teamId
          && existing.agentId === target.agentId
          && existing.movedToDate == null
          && existing.routePlanningAllowed === routePlanningAllowed
          && existing.source === "ADMIN"
        if (exactState) {
          return { day: calendarSummary(existing), team, agent, created: false }
        }
        throw new WorkforceCalendarConfigurationError(
          "WORKFORCE_CALENDAR_CONFIGURATION_OVERRIDE_EXISTS",
          "A different calendar override already exists for this date and scope",
        )
      }

      const created = await tx.mtmWorkCalendarDay.create({
        data: {
          organizationId: input.organizationId,
          date: asDatabaseDate(input.draft.date),
          kind: input.draft.kind,
          name: input.draft.name,
          teamId: target.teamId,
          agentId: target.agentId,
          movedToDate: null,
          routePlanningAllowed,
          source: "ADMIN",
          createdBy: input.createdByUserId,
          updatedBy: input.createdByUserId,
        },
        select: calendarExistingSelect,
      })
      await tx.mtmAuditLog.create({
        data: {
          organizationId: input.organizationId,
          agentId: target.agentId,
          actorUserId: input.audit.actorUserId,
          action: "WORKFORCE_CALENDAR_OVERRIDE_CREATED",
          entity: "work_calendar_day",
          entityId: created.id,
          metadataKind: "workforce_calendar_configuration",
          newData: {
            actorUserId: input.audit.actorUserId,
            date: input.draft.date,
            kind: input.draft.kind,
            name: input.draft.name,
            scope: input.draft.scope,
            teamId: team?.id ?? null,
            teamName: team?.name ?? null,
            teamCode: team?.code ?? null,
            agentId: agent?.id ?? null,
            agentName: agent?.name ?? null,
            agentExternalCode: agent?.externalCode ?? null,
            agentStatus: agent?.status ?? null,
            currentTeamId: agent?.currentTeam?.id ?? null,
            currentTeamName: agent?.currentTeam?.name ?? null,
            currentTeamCode: agent?.currentTeam?.code ?? null,
            currentTeamIsActive: agent?.currentTeam?.isActive ?? null,
            source: "ADMIN",
            routePlanningBaseline: routePlanningAllowed,
          },
          ipAddress: input.audit.ipAddress ?? null,
          userAgent: input.audit.userAgent ?? null,
        },
      })
      return { day: calendarSummary(created), team, agent, created: true }
    })
  } catch (error) {
    if (error instanceof WorkforceCalendarConfigurationError) throw error
    if (isPrismaCode(error, "P2002")) {
      throw new WorkforceCalendarConfigurationError(
        "WORKFORCE_CALENDAR_CONFIGURATION_OVERRIDE_EXISTS",
        "A concurrent calendar override already exists for this date and scope",
      )
    }
    throw error
  }
}

/**
 * Atomically records one reciprocal organization/team workday move. The HR
 * calendar changes on both dates while each date keeps its independently
 * resolved Route-planning baseline. Existing state is never repaired or
 * overwritten: only an exact reciprocal ADMIN pair is replay-safe.
 */
export async function createWorkforceCalendarMovedDay(input: {
  organizationId: string
  createdByUserId: string
  currentDate: string
  draft: WorkforceCalendarMovedDayDraft
  audit: WorkforceConfigurationAuditContext
  db?: PrismaClient
}): Promise<{
  days: [WorkforceCalendarOverrideSummary, WorkforceCalendarOverrideSummary]
  team: WorkforceCalendarTeamSummary | null
  created: boolean
}> {
  const maximumDate = isDateKey(input.currentDate)
    ? addDateKeyDays(input.currentDate, 367)
    : ""
  if (
    !isDateKey(input.currentDate)
    || !isDateKey(input.draft.sourceDate)
    || !isDateKey(input.draft.destinationDate)
    || input.draft.sourceDate <= input.currentDate
    || input.draft.destinationDate <= input.currentDate
    || input.draft.sourceDate > maximumDate
    || input.draft.destinationDate > maximumDate
    || input.draft.sourceDate === input.draft.destinationDate
  ) {
    throw new WorkforceCalendarConfigurationError(
      "WORKFORCE_CALENDAR_CONFIGURATION_MOVE_DATES_INVALID",
      "Choose two different future dates inside the 367-day calendar window",
    )
  }
  if (input.draft.scope !== "ORGANIZATION" && input.draft.scope !== "TEAM") {
    throw new WorkforceCalendarConfigurationError(
      "WORKFORCE_CALENDAR_CONFIGURATION_SCOPE_INVALID",
      "Moved workdays support only organization or team scope",
    )
  }
  const target = targetForScope(input.draft)
  const db = input.db ?? prisma

  try {
    return await db.$transaction(async (tx) => {
      await lockWorkforceCalendarConfigurationDates({
        db: tx,
        organizationId: input.organizationId,
        dates: [input.draft.sourceDate, input.draft.destinationDate],
      })

      let team: WorkforceCalendarTeamSummary | null = null
      if (input.draft.scope === "TEAM") {
        const [lockedTeam] = await tx.$queryRaw<Array<WorkforceCalendarTeamSummary>>(Prisma.sql`
          SELECT team."id", team."name", team."code", team."isActive"
          FROM "mtm_teams" AS team
          WHERE team."organizationId" = ${input.organizationId}
            AND team."id" = ${target.teamId as string}
            AND team."isActive" = TRUE
          FOR SHARE OF team
        `)
        if (!lockedTeam) {
          throw new WorkforceCalendarConfigurationError(
            "WORKFORCE_CALENDAR_CONFIGURATION_TEAM_UNAVAILABLE",
            "The selected active team is unavailable",
          )
        }
        team = lockedTeam
      }

      const candidates = await tx.mtmWorkCalendarDay.findMany({
        where: {
          organizationId: input.organizationId,
          date: {
            in: [asDatabaseDate(input.draft.sourceDate), asDatabaseDate(input.draft.destinationDate)],
          },
          deletedAt: null,
          OR: input.draft.scope === "TEAM"
            ? [
                { teamId: target.teamId, agentId: null },
                { teamId: null, agentId: null },
              ]
            : [{ teamId: null, agentId: null }],
        },
        orderBy: [{ date: "asc" }, { teamId: "asc" }, { id: "asc" }],
        select: calendarExistingSelect,
      })
      const targetRow = (date: string) => candidates.find((candidate) => (
        dateKey(candidate.date) === date
        && candidate.teamId === target.teamId
        && candidate.agentId === null
      ))
      const sourceExisting = targetRow(input.draft.sourceDate)
      const destinationExisting = targetRow(input.draft.destinationDate)
      if (sourceExisting || destinationExisting) {
        const exactPair = sourceExisting
          && destinationExisting
          && sourceExisting.kind === "MOVED_DAY_OFF"
          && destinationExisting.kind === "MOVED_WORKDAY"
          && sourceExisting.name === input.draft.name
          && destinationExisting.name === input.draft.name
          && sourceExisting.movedToDate != null
          && destinationExisting.movedToDate != null
          && dateKey(sourceExisting.movedToDate) === input.draft.destinationDate
          && dateKey(destinationExisting.movedToDate) === input.draft.sourceDate
          && sourceExisting.source === "ADMIN"
          && destinationExisting.source === "ADMIN"
          // These frozen Route baselines are independently resolved at the
          // original write. They may legitimately differ from current parent
          // state on retry, but a nullable legacy row is not a writer-owned
          // exact pair and must not be accepted as one.
          && typeof sourceExisting.routePlanningAllowed === "boolean"
          && typeof destinationExisting.routePlanningAllowed === "boolean"
        if (exactPair) {
          return {
            days: [calendarSummary(sourceExisting), calendarSummary(destinationExisting)],
            team,
            created: false,
          }
        }
        throw new WorkforceCalendarConfigurationError(
          "WORKFORCE_CALENDAR_CONFIGURATION_OVERRIDE_EXISTS",
          "A calendar override already occupies one or both moved-day dates",
        )
      }

      const baselineOverrides = (date: string) => input.draft.scope === "TEAM"
        ? candidates.filter((candidate) => (
            dateKey(candidate.date) === date
            && candidate.teamId === null
            && candidate.agentId === null
          ))
        : []
      const sourceBaseline = resolveWorkCalendarDay({
        date: input.draft.sourceDate,
        overrides: baselineOverrides(input.draft.sourceDate),
        teamId: target.teamId,
      })
      const destinationBaseline = resolveWorkCalendarDay({
        date: input.draft.destinationDate,
        overrides: baselineOverrides(input.draft.destinationDate),
        teamId: target.teamId,
      })
      if (!sourceBaseline.isWorkingDay) {
        throw new WorkforceCalendarConfigurationError(
          "WORKFORCE_CALENDAR_CONFIGURATION_MOVE_SOURCE_NOT_WORKING",
          "The source date is not an effective working day",
        )
      }
      if (destinationBaseline.isWorkingDay) {
        throw new WorkforceCalendarConfigurationError(
          "WORKFORCE_CALENDAR_CONFIGURATION_MOVE_DESTINATION_NOT_NON_WORKING",
          "The destination date is not an effective non-working day",
        )
      }

      const sourceCreated = await tx.mtmWorkCalendarDay.create({
        data: {
          organizationId: input.organizationId,
          date: asDatabaseDate(input.draft.sourceDate),
          kind: "MOVED_DAY_OFF",
          name: input.draft.name,
          teamId: target.teamId,
          agentId: null,
          movedToDate: asDatabaseDate(input.draft.destinationDate),
          routePlanningAllowed: sourceBaseline.routePlanningAllowed,
          source: "ADMIN",
          createdBy: input.createdByUserId,
          updatedBy: input.createdByUserId,
        },
        select: calendarExistingSelect,
      })
      const destinationCreated = await tx.mtmWorkCalendarDay.create({
        data: {
          organizationId: input.organizationId,
          date: asDatabaseDate(input.draft.destinationDate),
          kind: "MOVED_WORKDAY",
          name: input.draft.name,
          teamId: target.teamId,
          agentId: null,
          movedToDate: asDatabaseDate(input.draft.sourceDate),
          routePlanningAllowed: destinationBaseline.routePlanningAllowed,
          source: "ADMIN",
          createdBy: input.createdByUserId,
          updatedBy: input.createdByUserId,
        },
        select: calendarExistingSelect,
      })
      await tx.mtmAuditLog.create({
        data: {
          organizationId: input.organizationId,
          agentId: null,
          actorUserId: input.audit.actorUserId,
          action: "WORKFORCE_CALENDAR_MOVED_DAY_CREATED",
          entity: "work_calendar_pair",
          entityId: sourceCreated.id,
          metadataKind: "workforce_calendar_configuration",
          newData: {
            actorUserId: input.audit.actorUserId,
            operation: "MOVE_WORKDAY",
            scope: input.draft.scope,
            teamId: team?.id ?? null,
            teamName: team?.name ?? null,
            teamCode: team?.code ?? null,
            name: input.draft.name,
            sourceDate: input.draft.sourceDate,
            sourceKind: "MOVED_DAY_OFF",
            sourceRoutePlanningBaseline: sourceBaseline.routePlanningAllowed,
            destinationDate: input.draft.destinationDate,
            destinationKind: "MOVED_WORKDAY",
            destinationRoutePlanningBaseline: destinationBaseline.routePlanningAllowed,
            source: "ADMIN",
          },
          ipAddress: input.audit.ipAddress ?? null,
          userAgent: input.audit.userAgent ?? null,
        },
      })
      return {
        days: [calendarSummary(sourceCreated), calendarSummary(destinationCreated)],
        team,
        created: true,
      }
    })
  } catch (error) {
    if (error instanceof WorkforceCalendarConfigurationError) throw error
    if (isPrismaCode(error, "P2002")) {
      throw new WorkforceCalendarConfigurationError(
        "WORKFORCE_CALENDAR_CONFIGURATION_OVERRIDE_EXISTS",
        "A concurrent calendar override already occupies one moved-day date",
      )
    }
    throw error
  }
}

function reversePairChanged(): WorkforceCalendarConfigurationError {
  return new WorkforceCalendarConfigurationError(
    "WORKFORCE_CALENDAR_CONFIGURATION_REVERSE_PAIR_CHANGED",
    "The exact moved-day pair or its reversal receipt is unavailable",
  )
}

/**
 * Reverses only a complete future ADMIN pair. A generation binds both physical
 * rows; replay reads audit originals by ID, never replacement rows by date.
 *
 * The table lock stabilizes inherited state, including an absent parent,
 * against legacy writers that do not participate in the date-lock protocol.
 * SHARE ROW EXCLUSIVE permits this transaction's own CAS without a lock
 * upgrade and briefly serializes all calendar writers across tenants. Keep
 * this rare administrative transaction short, bounded and free of network IO.
 */
export async function reverseWorkforceCalendarMovedDay(input: {
  organizationId: string
  updatedByUserId: string
  currentDate: string
  draft: WorkforceCalendarMovedDayReverseDraft
  audit: WorkforceConfigurationAuditContext
  db?: PrismaClient
}): Promise<{
  pairGenerationId: string
  sourceDate: string
  destinationDate: string
  team: WorkforceCalendarTeamSummary | null
  reversed: boolean
}> {
  const parsed = WorkforceCalendarMovedDayReverseSchema.safeParse(input.draft)
  if (!parsed.success || !isDateKey(input.currentDate)) {
    throw new WorkforceCalendarConfigurationError("WORKFORCE_CALENDAR_CONFIGURATION_MOVE_DATES_INVALID")
  }
  if (!input.updatedByUserId || input.audit.actorUserId !== input.updatedByUserId) {
    throw new WorkforceCalendarConfigurationError("WORKFORCE_CALENDAR_CONFIGURATION_SCOPE_INVALID")
  }
  const draft = parsed.data
  const teamId = draft.scope === "TEAM" ? draft.teamId as string : null
  const target = {
    organizationId: input.organizationId, teamId,
    sourceDate: draft.sourceDate, destinationDate: draft.destinationDate,
  }
  const db: PrismaClient = input.db ?? prisma
  try {
    return await db.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL lock_timeout = '5s'`
      await lockWorkforceCalendarConfigurationDates({
        db: tx, organizationId: input.organizationId, dates: [draft.sourceDate, draft.destinationDate],
      })
      await tx.$executeRaw`LOCK TABLE "mtm_work_calendar_days" IN SHARE ROW EXCLUSIVE MODE`
      let team: WorkforceCalendarTeamSummary | null = null
      if (teamId !== null) {
        const [lockedTeam] = await tx.$queryRaw<Array<WorkforceCalendarTeamSummary>>(Prisma.sql`
          SELECT team."id", team."name", team."code", team."isActive"
          FROM "mtm_teams" AS team
          WHERE team."organizationId" = ${input.organizationId} AND team."id" = ${teamId}
          FOR SHARE OF team
        `)
        if (!lockedTeam) throw new WorkforceCalendarConfigurationError("WORKFORCE_CALENDAR_CONFIGURATION_TEAM_UNAVAILABLE")
        team = lockedTeam
      }
      const receipts = await tx.mtmAuditLog.findMany({
        where: {
          organizationId: input.organizationId, action: "WORKFORCE_CALENDAR_MOVED_DAY_REVERSED",
          entity: "work_calendar_pair", entityId: draft.pairGenerationId,
          metadataKind: "workforce_calendar_configuration", agentId: null,
        },
        take: 2,
        select: { actorUserId: true, oldData: true, newData: true },
      })
      const result = {
        pairGenerationId: draft.pairGenerationId, sourceDate: draft.sourceDate,
        destinationDate: draft.destinationDate, team,
      }
      if (receipts.length) {
        if (receipts.length !== 1) throw reversePairChanged()
        const before = calendarReversalReceiptSchema.safeParse(receipts[0].oldData)
        const after = calendarReversalReceiptSchema.safeParse(receipts[0].newData)
        if (!before.success || !after.success) throw reversePairChanged()
        const old = before.data
        const post = after.data
        if (old.organizationId !== input.organizationId || old.scope !== draft.scope
          || old.teamId !== teamId || old.sourceDate !== draft.sourceDate
          || old.destinationDate !== draft.destinationDate || old.pairGenerationId !== draft.pairGenerationId
          || old.actorUserId !== receipts[0].actorUserId
          || JSON.stringify({ ...old, rows: post.rows }) !== JSON.stringify(post)) throw reversePairChanged()
        const source = calendarRowFromSnapshot(old.rows[0])
        const destination = calendarRowFromSnapshot(old.rows[1])
        if (source.deletedAt !== null || destination.deletedAt !== null
          || !calendarPairMatches(source, destination, target)
          || calendarPairGeneration(source, destination) !== draft.pairGenerationId) throw reversePairChanged()
        const reversedAt = new Date(post.reversedAt)
        for (const [index, original] of [source, destination].entries()) {
          if (!calendarSnapshotEquals({
            ...original, deletedAt: reversedAt, updatedAt: reversedAt, updatedBy: post.actorUserId,
          }, post.rows[index])) throw reversePairChanged()
        }
        // Do not inspect active same-date rows or recompute parents on replay.
        // An exact receipt remains replay-safe after date/team availability changes.
        const originals = await tx.mtmWorkCalendarDay.findMany({
          where: {
            organizationId: input.organizationId, teamId, agentId: null,
            id: { in: [source.id, destination.id] },
          },
          select: calendarReversalSelect,
        })
        if (originals.length !== 2) throw reversePairChanged()
        for (const snapshot of post.rows) {
          const original = originals.find((row) => row.id === snapshot.id)
          if (!original || !calendarSnapshotEquals(original, snapshot)) throw reversePairChanged()
        }
        return { ...result, reversed: false }
      }
      if (team && !team.isActive) throw new WorkforceCalendarConfigurationError("WORKFORCE_CALENDAR_CONFIGURATION_TEAM_UNAVAILABLE")
      const maximumDate = addDateKeyDays(input.currentDate, 367)
      if (draft.sourceDate <= input.currentDate || draft.destinationDate <= input.currentDate
        || draft.sourceDate > maximumDate || draft.destinationDate > maximumDate) {
        throw new WorkforceCalendarConfigurationError("WORKFORCE_CALENDAR_CONFIGURATION_MOVE_DATES_INVALID")
      }
      const candidates = await tx.mtmWorkCalendarDay.findMany({
        where: {
          organizationId: input.organizationId, teamId, agentId: null, deletedAt: null,
          date: { in: [asDatabaseDate(draft.sourceDate), asDatabaseDate(draft.destinationDate)] },
        },
        take: 3, select: calendarReversalSelect,
      })
      const source = candidates.find((row) => dateKey(row.date) === draft.sourceDate)
      const destination = candidates.find((row) => dateKey(row.date) === draft.destinationDate)
      if (candidates.length !== 2 || !source || !destination
        || !calendarPairMatches(source, destination, target)
        || calendarPairGeneration(source, destination) !== draft.pairGenerationId) throw reversePairChanged()
      const inherited = teamId === null ? [] : await tx.mtmWorkCalendarDay.findMany({
        where: {
          organizationId: input.organizationId, teamId: null, agentId: null, deletedAt: null,
          date: { in: [asDatabaseDate(draft.sourceDate), asDatabaseDate(draft.destinationDate)] },
        },
        select: calendarExistingSelect,
      })
      for (const row of [source, destination]) {
        if (resolveWorkCalendarDay({ date: dateKey(row.date), overrides: inherited, teamId }).routePlanningAllowed
          !== row.routePlanningAllowed) {
          throw new WorkforceCalendarConfigurationError(
            "WORKFORCE_CALENDAR_CONFIGURATION_REVERSE_ROUTE_CHANGED",
            "Inherited Route eligibility changed; the calendar pair was retained",
          )
        }
      }
      const reversedAt = new Date()
      const metadata = {
        version: 1, operation: "REVERSE_MOVE_WORKDAY", pairGenerationId: draft.pairGenerationId,
        organizationId: input.organizationId, scope: draft.scope, teamId,
        sourceDate: draft.sourceDate, destinationDate: draft.destinationDate,
        actorUserId: input.updatedByUserId, reversedAt: reversedAt.toISOString(),
      }
      const originals = [source, destination] as const
      const oldData = calendarReversalReceiptSchema.parse({ ...metadata, rows: originals.map(calendarReversalSnapshot) })
      const newData = calendarReversalReceiptSchema.parse({
        ...metadata, rows: originals.map((row) => calendarReversalSnapshot({
          ...row, deletedAt: reversedAt, updatedAt: reversedAt, updatedBy: input.updatedByUserId,
        })),
      })
      for (const row of originals) {
        // Every selected field is bound, including the old timestamps/actor.
        // A zero-row update at either half aborts and rolls back the entire pair.
        const changed = await tx.mtmWorkCalendarDay.updateMany({
          where: { ...row, deletedAt: null },
          data: { deletedAt: reversedAt, updatedAt: reversedAt, updatedBy: input.updatedByUserId },
        })
        if (changed.count !== 1) throw reversePairChanged()
      }
      await tx.mtmAuditLog.create({
        data: {
          organizationId: input.organizationId, agentId: null, actorUserId: input.audit.actorUserId,
          action: "WORKFORCE_CALENDAR_MOVED_DAY_REVERSED", entity: "work_calendar_pair",
          entityId: draft.pairGenerationId, metadataKind: "workforce_calendar_configuration",
          oldData, newData, ipAddress: input.audit.ipAddress ?? null, userAgent: input.audit.userAgent ?? null,
        },
      })
      return { ...result, reversed: true }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 5_000, timeout: 10_000 })
  } catch (error) {
    if (error instanceof WorkforceCalendarConfigurationError) throw error
    const sqlState = (error as { meta?: { code?: string } } | null)?.meta?.code
    if (isPrismaCode(error, "P2034") || (isPrismaCode(error, "P2010") && ["55P03", "40P01"].includes(sqlState ?? ""))) {
      throw new WorkforceCalendarConfigurationError("WORKFORCE_CALENDAR_CONFIGURATION_REVERSE_BUSY")
    }
    // Generic transaction/commit/transport failures have an unknown outcome.
    // Preserve them so the UI retains the exact generation for audit-backed retry.
    throw error
  }
}
