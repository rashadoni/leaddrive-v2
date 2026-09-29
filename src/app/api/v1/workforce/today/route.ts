import { NextRequest, NextResponse } from "next/server"
import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { getMtmSettings } from "@/lib/mtm-settings"
import { currentDateKey } from "@/lib/mtm/mobile-week"
import { isValidTimezone } from "@/lib/timezone"
import { withWorkforceSessionAuth } from "@/lib/with-workforce-rls-auth"
import { resolveWorkforceActor } from "@/lib/workforce/actor"
import { decideWorkforceAccess } from "@/lib/workforce/access-control"
import { resolveWorkforceCalendarDay } from "@/lib/workforce/calendar"
import { loadWorkforceEmployeeToday } from "@/lib/workforce/employee-today"
import { authorizeWorkforceExceptionReadCandidates } from "@/lib/workforce/exception-read-access"
import { resolveWorkforceExceptionCaseReadScopes } from "@/lib/workforce/exception-case-read-scope"
import { workforceGranularAccessEnabled } from "@/lib/workforce/granular-access-rollout"
import {
  buildWorkforceManagerTodayRow,
  resolveWorkforceManagerTodayPlanContexts,
  summarizeWorkforceManagerTodayRows,
  workforceManagerTodayCalendarFromSnapshot,
  workforceManagerTodayPlanFromSnapshot,
  WorkforceManagerTodayBoundsError,
  WORKFORCE_MANAGER_TODAY_LIMITS,
  type WorkforceManagerTodayException,
  type WorkforceManagerTodayPlan,
} from "@/lib/workforce/manager-today"
import { workforceSensitiveResponseHeaders } from "@/lib/workforce/sensitive-response"
import {
  authorizeWorkforceTodayReadCandidates,
  resolveWorkforceTodayReadScope,
  type WorkforceTodayReadScope,
} from "@/lib/workforce/today-read-access"
import { projectWorkforceTimesheetExceptions } from "@/lib/workforce/timesheet-read-model"

type WorkdayStatus = "STARTED" | "PAUSED" | "COMPLETED"

const todayWorkdaySelect = {
  id: true,
  agentId: true,
  status: true,
  workDate: true,
  startedAt: true,
  pausedAt: true,
  completedAt: true,
  workforcePolicySnapshot: {
    select: {
      id: true,
      definitionHash: true,
    },
  },
  workforceShiftSnapshot: {
    select: {
      id: true,
      workDate: true,
      timezone: true,
      definition: true,
      definitionHash: true,
      plannedStartAt: true,
      plannedEndAt: true,
      template: { select: { name: true } },
    },
  },
  workforceWorkdayScheduleSnapshot: {
    select: {
      id: true,
      workdayId: true,
      agentId: true,
      workDate: true,
      policySnapshotId: true,
      shiftSnapshotId: true,
      schemaVersion: true,
      calendarState: true,
      calendarSnapshot: true,
      segments: true,
      sites: true,
      snapshotHash: true,
    },
  },
} satisfies Prisma.MtmAgentWorkdaySelect

const exceptionCandidateSelect = {
  id: true,
  agentId: true,
  segmentId: true,
  expectedWorkDate: true,
  workdayEvent: { select: { occurredAt: true } },
  workday: { select: { startedAt: true } },
} satisfies Prisma.WorkforceExceptionCaseSelect

const exceptionDetailSelect = {
  id: true,
  agentId: true,
  kind: true,
  decisions: {
    orderBy: { caseRevision: "asc" },
    take: WORKFORCE_MANAGER_TODAY_LIMITS.decisionsPerCase + 1,
    select: { decisionCode: true, caseRevision: true },
  },
} satisfies Prisma.WorkforceExceptionCaseSelect

function denied(code = "WORKFORCE_SCOPE_DENIED", error = "Forbidden", status = 403) {
  return NextResponse.json({ error, code }, { status, headers: workforceSensitiveResponseHeaders })
}

function unavailable() {
  return denied(
    "WORKFORCE_TODAY_UNAVAILABLE",
    "Unable to load a safe bounded Workforce Today view.",
    503,
  )
}

function cursorFromRequest(request: NextRequest): string | null | Response {
  const cursor = request.nextUrl.searchParams.get("cursor")
  if (cursor == null || cursor === "") return null
  return /^[A-Za-z0-9_-]{1,100}$/.test(cursor)
    ? cursor
    : denied("WORKFORCE_TODAY_CURSOR_INVALID", "Invalid Workforce Today cursor.", 400)
}

function calendarNonWorkingPlan(): WorkforceManagerTodayPlan {
  return {
    state: "NON_WORKING_DAY",
    source: "CALENDAR",
    templateName: null,
    timezone: null,
    plannedStartAt: null,
    plannedEndAt: null,
  }
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

function exceptionReadAllowed(input: {
  scope: WorkforceTodayReadScope
  organizationId: string
  principalUserId: string
  agentId: string
  teamId: string | null
}): boolean {
  if (!input.scope.granularAccess) return false
  return decideWorkforceAccess({
    organizationId: input.organizationId,
    principalUserId: input.principalUserId,
    selfAgentId: null,
    permission: "TEAM_EXCEPTION_READ",
    resource: {
      organizationId: input.organizationId,
      agentId: input.agentId,
      teamId: input.teamId,
    },
    grants: input.scope.grants,
    now: input.scope.now,
  }).allowed
}

/**
 * GET /api/v1/workforce/today — bounded manager/self daily read model.
 *
 * Roster metadata is paged and authorized before names or attendance facts
 * are read. Existing workdays use only their immutable shift snapshot; an
 * absent snapshot never falls back to mutable schedule configuration. A
 * no-show is exposed only from a persisted, independently authorized case.
 */
export const GET = withWorkforceSessionAuth("read", async (request: NextRequest, auth) => {
  const cursor = cursorFromRequest(request)
  if (cursor instanceof Response) return cursor
  const actor = await resolveWorkforceActor(prisma, {
    organizationId: auth.orgId,
    userId: auth.userId,
    webRole: auth.role,
  })
  try {
    const settings = await getMtmSettings(auth.orgId)
    const timezone = isValidTimezone(settings.timezone) ? settings.timezone : "UTC"
    const now = new Date()
    const date = currentDateKey(now, timezone)
    const workDate = new Date(`${date}T00:00:00.000Z`)
    const organization = await prisma.organization.findUnique({
      where: { id: auth.orgId },
      select: { features: true },
    })
    if (!organization) return unavailable()
    const granularAccess = workforceGranularAccessEnabled(organization.features)
    if (!granularAccess && !actor) return denied()

    const readScope = await resolveWorkforceTodayReadScope({
      db: prisma,
      organizationId: auth.orgId,
      organizationFeatures: organization.features,
      principalUserId: auth.userId,
      selfAgentId: actor?.agentId ?? null,
      now,
    })
    if (readScope instanceof Response) return readScope

    const rosterScope: Prisma.MtmAgentWhereInput = granularAccess
      ? readScope.organizationWide
        ? {}
        : {
            OR: [
              ...(readScope.teamIds.length > 0 ? [{ teamId: { in: [...readScope.teamIds] } }] : []),
              ...(readScope.agentIds.length > 0 ? [{ id: { in: [...readScope.agentIds] } }] : []),
            ],
          }
      : actor!.scopedAgentIds === null
        ? {}
        : { id: { in: [...actor!.scopedAgentIds] } }
    const rosterCandidates = await prisma.mtmAgent.findMany({
      where: {
        organizationId: auth.orgId,
        status: "ACTIVE",
        AND: [rosterScope, ...(cursor ? [{ id: { gt: cursor } }] : [])],
      },
      orderBy: { id: "asc" },
      take: WORKFORCE_MANAGER_TODAY_LIMITS.page + 1,
      select: { id: true, teamId: true },
    })
    const pageCandidates = rosterCandidates.slice(0, WORKFORCE_MANAGER_TODAY_LIMITS.page)
    const authorizedAgentIds = authorizeWorkforceTodayReadCandidates({
      scope: readScope,
      organizationId: auth.orgId,
      principalUserId: auth.userId,
      selfAgentId: actor?.agentId ?? null,
      candidates: pageCandidates,
    })
    if (authorizedAgentIds.length !== pageCandidates.length) return unavailable()
    const nextCursor = rosterCandidates.length > WORKFORCE_MANAGER_TODAY_LIMITS.page
      ? pageCandidates.at(-1)?.id ?? null
      : null

    const namedAgents = authorizedAgentIds.length === 0 ? [] : await prisma.mtmAgent.findMany({
      where: {
        organizationId: auth.orgId,
        status: "ACTIVE",
        id: { in: [...authorizedAgentIds] },
      },
      select: { id: true, name: true, role: true, teamId: true },
    })
    if (namedAgents.length !== authorizedAgentIds.length) return unavailable()
    const namedById = new Map(namedAgents.map((agent) => [agent.id, agent]))
    const agents = authorizedAgentIds.flatMap((id) => {
      const agent = namedById.get(id)
      return agent ? [agent] : []
    })
    const agentIds = agents.map((agent) => agent.id)
    const legacyExceptionReader = !granularAccess && (auth.role === "admin" || auth.role === "superadmin")

    const [todayWorkdays, previousGroups, exceptionCandidates] = agentIds.length === 0
      ? [[], [], []] as const
      : await Promise.all([
          prisma.mtmAgentWorkday.findMany({
            where: { organizationId: auth.orgId, agentId: { in: agentIds }, workDate },
            take: WORKFORCE_MANAGER_TODAY_LIMITS.page + 1,
            select: todayWorkdaySelect,
          }),
          prisma.mtmAgentWorkday.groupBy({
            by: ["agentId"],
            where: {
              organizationId: auth.orgId,
              agentId: { in: agentIds },
              workDate: { lt: workDate },
              status: { in: ["STARTED", "PAUSED"] },
            },
            _max: { workDate: true },
            orderBy: { agentId: "asc" },
            take: WORKFORCE_MANAGER_TODAY_LIMITS.page + 1,
          }),
          granularAccess || legacyExceptionReader
            ? prisma.workforceExceptionCase.findMany({
                where: {
                  organizationId: auth.orgId,
                  agentId: { in: agentIds },
                  OR: [
                    { expectedWorkDate: workDate },
                    { workday: { is: { workDate } } },
                    { workdayEvent: { is: { workday: { is: { workDate } } } } },
                  ],
                },
                orderBy: [{ createdAt: "asc" }, { id: "asc" }],
                take: WORKFORCE_MANAGER_TODAY_LIMITS.exceptionCases + 1,
                select: exceptionCandidateSelect,
              })
            : Promise.resolve([]),
        ])
    if (
      todayWorkdays.length > WORKFORCE_MANAGER_TODAY_LIMITS.page
      || previousGroups.length > WORKFORCE_MANAGER_TODAY_LIMITS.page
      || exceptionCandidates.length > WORKFORCE_MANAGER_TODAY_LIMITS.exceptionCases
    ) throw new WorkforceManagerTodayBoundsError()

    const todayByAgent = new Map(todayWorkdays.map((workday) => [workday.agentId, workday]))
    const livePlanAgentIds = agents.flatMap((agent) => todayByAgent.has(agent.id) ? [] : [agent.id])
    const livePlanContexts = await resolveWorkforceManagerTodayPlanContexts(prisma, {
      organizationId: auth.orgId,
      agentIds: livePlanAgentIds,
      workDate: date,
      resolutionAt: now,
    })
    const calendarTeamIds = [...new Set(livePlanAgentIds.flatMap((agentId) => {
      const teamId = livePlanContexts.get(agentId)?.calendarTeamId
      return teamId ? [teamId] : []
    }))]
    const calendarMaximum = Math.max(1, (livePlanAgentIds.length + calendarTeamIds.length + 1) * 2)
    const calendarOverrides = livePlanAgentIds.length === 0 ? [] : await prisma.mtmWorkCalendarDay.findMany({
      where: {
        organizationId: auth.orgId,
        date: workDate,
        deletedAt: null,
        OR: [
          { agentId: { in: livePlanAgentIds }, teamId: null },
          ...(calendarTeamIds.length > 0
            ? [{ agentId: null, teamId: { in: calendarTeamIds } }]
            : []),
          { agentId: null, teamId: null },
        ],
      },
      orderBy: [{ agentId: "asc" }, { teamId: "asc" }, { id: "asc" }],
      take: calendarMaximum + 1,
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
    if (calendarOverrides.length > calendarMaximum) throw new WorkforceManagerTodayBoundsError()

    const previousPairs = previousGroups.flatMap((group) => group._max.workDate
      ? [{ agentId: group.agentId, workDate: group._max.workDate }]
      : [])
    const previousOpenWorkdays = previousPairs.length === 0 ? [] : await prisma.mtmAgentWorkday.findMany({
      where: {
        organizationId: auth.orgId,
        status: { in: ["STARTED", "PAUSED"] },
        OR: previousPairs,
      },
      orderBy: [{ agentId: "asc" }, { workDate: "desc" }, { id: "asc" }],
      take: WORKFORCE_MANAGER_TODAY_LIMITS.previousOpenRows + 1,
      select: {
        id: true,
        agentId: true,
        workDate: true,
        status: true,
        startedAt: true,
        pausedAt: true,
      },
    })
    if (previousOpenWorkdays.length > WORKFORCE_MANAGER_TODAY_LIMITS.previousOpenRows) {
      throw new WorkforceManagerTodayBoundsError()
    }

    const exceptionAccessByAgent = new Set<string>()
    let readableExceptionIds: string[] = []
    if (legacyExceptionReader) {
      agentIds.forEach((agentId) => exceptionAccessByAgent.add(agentId))
      readableExceptionIds = exceptionCandidates.map((candidate) => candidate.id)
    } else if (granularAccess) {
      for (const agent of agents) {
        if (exceptionReadAllowed({
          scope: readScope,
          organizationId: auth.orgId,
          principalUserId: auth.userId,
          agentId: agent.id,
          teamId: agent.teamId,
        })) exceptionAccessByAgent.add(agent.id)
      }
      const scopes = await resolveWorkforceExceptionCaseReadScopes(prisma, {
        organizationId: auth.orgId,
        candidates: exceptionCandidates,
        resolutionAt: now,
      })
      const authorization = authorizeWorkforceExceptionReadCandidates({
        organizationId: auth.orgId,
        principalUserId: auth.userId,
        candidates: scopes.candidates,
        historicalTeamByCaseId: scopes.historicalTeamByCaseId,
        grants: readScope.grants,
        now,
      })
      readableExceptionIds = exceptionCandidates.flatMap((candidate) => {
        if (!authorization.get(candidate.id)?.readable) return []
        exceptionAccessByAgent.add(candidate.agentId)
        return [candidate.id]
      })
    }
    const exceptionDetails = readableExceptionIds.length === 0 ? [] : await prisma.workforceExceptionCase.findMany({
      where: { organizationId: auth.orgId, id: { in: readableExceptionIds } },
      orderBy: [{ agentId: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      select: exceptionDetailSelect,
    })
    if (exceptionDetails.length !== readableExceptionIds.length) return unavailable()
    const exceptionDetailsByAgent = new Map<string, typeof exceptionDetails>()
    for (const detail of exceptionDetails) {
      exceptionDetailsByAgent.set(detail.agentId, [
        ...(exceptionDetailsByAgent.get(detail.agentId) ?? []),
        detail,
      ])
    }
    const exceptionsByAgent = new Map<string, WorkforceManagerTodayException[]>()
    for (const agentId of exceptionAccessByAgent) {
      const details = exceptionDetailsByAgent.get(agentId) ?? []
      exceptionsByAgent.set(agentId, projectWorkforceTimesheetExceptions([], details.map((detail) => ({
        kind: detail.kind,
        decisions: detail.decisions,
        decisionHistoryTruncated: detail.decisions.length > WORKFORCE_MANAGER_TODAY_LIMITS.decisionsPerCase,
      }))))
    }

    const previousByAgent = new Map(previousOpenWorkdays.map((workday) => [workday.agentId, workday]))
    const calendars = new Map(agents.map((agent) => {
      const workday = todayByAgent.get(agent.id)
      if (workday) {
        return [agent.id, workforceManagerTodayCalendarFromSnapshot({
          workDate: date,
          workdayId: workday.id,
          agentId: workday.agentId,
          policySnapshot: workday.workforcePolicySnapshot,
          shiftSnapshot: workday.workforceShiftSnapshot,
          scheduleSnapshot: workday.workforceWorkdayScheduleSnapshot,
        })] as const
      }
      return [agent.id, resolveWorkforceCalendarDay({
        date,
        overrides: calendarOverrides,
        teamId: livePlanContexts.get(agent.id)?.calendarTeamId ?? null,
        agentId: agent.id,
      })] as const
    }))

    const people = agents.map((agent) => {
      const workday = todayByAgent.get(agent.id)
      const previousOpenWorkday = previousByAgent.get(agent.id)
      const calendar = calendars.get(agent.id)!
      const exceptions = exceptionAccessByAgent.has(agent.id)
        ? exceptionsByAgent.get(agent.id) ?? []
        : null
      const livePlan = livePlanContexts.get(agent.id)?.plan ?? unavailablePlan()
      const plan = workday
        ? workforceManagerTodayPlanFromSnapshot({
            workDate: date,
            snapshot: workday.workforceShiftSnapshot,
          })
        : !calendar.attendanceExpected
          ? calendarNonWorkingPlan()
          : livePlan
      const status = (workday?.status ?? "NOT_STARTED") as WorkdayStatus | "NOT_STARTED"
      return {
        id: agent.id,
        name: agent.name,
        role: agent.role,
        status,
        workday: workday ? {
          id: workday.id,
          startedAt: workday.startedAt,
          pausedAt: workday.pausedAt,
          completedAt: workday.completedAt,
        } : null,
        previousOpenWorkday: previousOpenWorkday ? {
          id: previousOpenWorkday.id,
          workDate: previousOpenWorkday.workDate,
          status: previousOpenWorkday.status,
        } : null,
        ...buildWorkforceManagerTodayRow({
          workdayStatus: workday?.status ?? null,
          plan,
          calendar,
          exceptions,
        }),
      }
    })
    const summary = summarizeWorkforceManagerTodayRows(people)

    const selfOnlyAuthority = actor?.role === "AGENT"
      && actor.agentId != null
      && (!granularAccess || (
        !readScope.organizationWide
        && readScope.teamIds.length === 0
        && readScope.agentIds.length === 1
        && readScope.agentIds[0] === actor.agentId
      ))
    const selfOnly = selfOnlyAuthority
      && actor.agentId != null
      && people.length <= 1
      && people.every((person) => person.id === actor.agentId)
      && nextCursor == null
    const self = selfOnly ? people[0] ?? null : null
    const selfWorkday = self ? todayByAgent.get(self.id) : null
    const employeeToday = self
      ? await loadWorkforceEmployeeToday(prisma, {
          organizationId: auth.orgId,
          agentId: self.id,
          date,
          timezone,
          status: self.status,
          workday: selfWorkday ?? null,
          previousOpen: self.previousOpenWorkday != null,
          calendar: calendars.get(self.id)!,
        })
      : null

    return NextResponse.json({
      success: true,
      data: {
        date,
        timezone,
        scope: selfOnly
          ? "SELF"
          : granularAccess
            ? readScope.organizationWide ? "ORGANIZATION" : "GRANT"
            : actor!.scopedAgentIds === null ? "ORGANIZATION" : "TEAM_OR_REGION",
        summary,
        summaryScope: "LOADED_PAGE",
        pagination: {
          pageSize: WORKFORCE_MANAGER_TODAY_LIMITS.page,
          nextCursor,
        },
        people,
        employeeToday,
      },
    }, { headers: workforceSensitiveResponseHeaders })
  } catch (error) {
    if (!(error instanceof WorkforceManagerTodayBoundsError)) {
      console.error("[workforce/today GET]", error)
    }
    return unavailable()
  }
})
