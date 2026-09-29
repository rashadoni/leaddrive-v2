import { NextRequest, NextResponse } from "next/server"
import { getMtmSettings } from "@/lib/mtm-settings"
import { addDateKeyDays, currentDateKey, isDateKey } from "@/lib/mtm/mobile-week"
import { isValidTimezone } from "@/lib/timezone"
import { withWorkforceSessionScheduleConfigurationAuth } from "@/lib/with-workforce-rls-auth"
import {
  WorkforceCalendarConfigurationError,
  createWorkforceCalendarMovedDay,
  createWorkforceCalendarOverride,
  listWorkforceCalendarOverrides,
  searchWorkforceCalendarAgents,
  searchWorkforceCalendarTeams,
} from "@/lib/workforce/calendar-configuration"
import {
  WORKFORCE_CALENDAR_AGENT_SEARCH_LIMIT,
  WORKFORCE_CALENDAR_TEAM_SEARCH_LIMIT,
  WorkforceCalendarConfigurationCreateSchema,
  WorkforceCalendarScopeSelectionSchema,
  type WorkforceCalendarMovedDayDraft,
  type WorkforceCalendarOverrideDraft,
} from "@/lib/workforce/calendar-configuration-contract"
import { workforceConfigurationRequestAuditContext } from "@/lib/workforce/configuration-route"

function organizationCalendarClock(timezone: string): { timezone: string; currentDate: string } {
  const safeTimezone = isValidTimezone(timezone) ? timezone : "UTC"
  return { timezone: safeTimezone, currentDate: currentDateKey(new Date(), safeTimezone) }
}

function configurationError(error: WorkforceCalendarConfigurationError): Response {
  const status = error.code === "WORKFORCE_CALENDAR_CONFIGURATION_OVERRIDE_EXISTS"
    || error.code === "WORKFORCE_CALENDAR_CONFIGURATION_MOVE_SOURCE_NOT_WORKING"
    || error.code === "WORKFORCE_CALENDAR_CONFIGURATION_MOVE_DESTINATION_NOT_NON_WORKING"
    ? 409
    : error.code === "WORKFORCE_CALENDAR_CONFIGURATION_TEAM_UNAVAILABLE"
      || error.code === "WORKFORCE_CALENDAR_CONFIGURATION_AGENT_UNAVAILABLE"
      ? 404
      : 400
  return NextResponse.json({ error: error.message, code: error.code }, { status })
}

function isMovedDayDraft(
  draft: WorkforceCalendarMovedDayDraft | WorkforceCalendarOverrideDraft,
): draft is WorkforceCalendarMovedDayDraft {
  return "operation" in draft && draft.operation === "MOVE_WORKDAY"
}

export const GET = withWorkforceSessionScheduleConfigurationAuth("SCHEDULE_READ", async (req: NextRequest, auth) => {
  try {
    const selection = WorkforceCalendarScopeSelectionSchema.safeParse({
      scope: req.nextUrl.searchParams.get("scope") ?? undefined,
      ...(req.nextUrl.searchParams.has("teamId")
        ? { teamId: req.nextUrl.searchParams.get("teamId") ?? undefined }
        : {}),
      ...(req.nextUrl.searchParams.has("agentId")
        ? { agentId: req.nextUrl.searchParams.get("agentId") ?? undefined }
        : {}),
    })
    if (!selection.success) {
      return NextResponse.json({
        error: selection.error.issues[0]?.message ?? "Invalid Workforce calendar scope",
        code: "WORKFORCE_CALENDAR_CONFIGURATION_SCOPE_INVALID",
      }, { status: 400 })
    }
    const settings = await getMtmSettings(auth.orgId)
    const clock = organizationCalendarClock(settings.timezone)
    const start = req.nextUrl.searchParams.get("start") ?? addDateKeyDays(clock.currentDate, 1)
    const endExclusive = req.nextUrl.searchParams.get("endExclusive") ?? (isDateKey(start) ? addDateKeyDays(start, 367) : "")
    const teamQuery = req.nextUrl.searchParams.get("teamQuery") ?? ""
    const rawTeamLimit = req.nextUrl.searchParams.get("teamLimit")
    const teamLimit = rawTeamLimit === null ? WORKFORCE_CALENDAR_TEAM_SEARCH_LIMIT : Number(rawTeamLimit)
    const agentQuery = req.nextUrl.searchParams.get("agentQuery") ?? ""
    const rawAgentLimit = req.nextUrl.searchParams.get("agentLimit")
    const agentLimit = rawAgentLimit === null ? WORKFORCE_CALENDAR_AGENT_SEARCH_LIMIT : Number(rawAgentLimit)
    const [teamDirectory, agentDirectory] = await Promise.all([
      searchWorkforceCalendarTeams({
        organizationId: auth.orgId,
        query: teamQuery,
        limit: teamLimit,
        selectedTeamId: selection.data.scope === "TEAM" ? selection.data.teamId : undefined,
      }),
      searchWorkforceCalendarAgents({
        organizationId: auth.orgId,
        query: agentQuery,
        limit: agentLimit,
        selectedAgentId: selection.data.scope === "AGENT" ? selection.data.agentId : undefined,
      }),
    ])
    if (selection.data.scope === "TEAM" && !teamDirectory.selectedTeam) {
      throw new WorkforceCalendarConfigurationError(
        "WORKFORCE_CALENDAR_CONFIGURATION_TEAM_UNAVAILABLE",
        "The selected team is unavailable",
      )
    }
    if (selection.data.scope === "AGENT" && !agentDirectory.selectedAgent) {
      throw new WorkforceCalendarConfigurationError(
        "WORKFORCE_CALENDAR_CONFIGURATION_AGENT_UNAVAILABLE",
        "The selected employee is unavailable",
      )
    }
    const days = await listWorkforceCalendarOverrides({
      organizationId: auth.orgId,
      currentDate: clock.currentDate,
      start,
      endExclusive,
      scope: selection.data.scope,
      teamId: selection.data.teamId,
      agentId: selection.data.agentId,
    })
    return NextResponse.json({
      success: true,
      data: {
        ...clock,
        start,
        endExclusive,
        scope: selection.data.scope,
        team: teamDirectory.selectedTeam,
        agent: agentDirectory.selectedAgent,
        teamDirectory: {
          items: teamDirectory.teams,
          query: teamDirectory.query,
          limit: teamDirectory.limit,
          hasMore: teamDirectory.hasMore,
        },
        agentDirectory: {
          items: agentDirectory.agents,
          query: agentDirectory.query,
          limit: agentDirectory.limit,
          hasMore: agentDirectory.hasMore,
        },
        days,
      },
    })
  } catch (error) {
    if (error instanceof WorkforceCalendarConfigurationError) return configurationError(error)
    console.error("[workforce/configuration/calendar GET]", error)
    return NextResponse.json({ error: "Failed to load Workforce calendar configuration" }, { status: 500 })
  }
})

export const POST = withWorkforceSessionScheduleConfigurationAuth("SCHEDULE_WRITE", async (req: NextRequest, auth) => {
  const parsed = WorkforceCalendarConfigurationCreateSchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json({
      error: parsed.error.issues[0]?.message ?? "Invalid Workforce calendar override",
      code: "WORKFORCE_CALENDAR_CONFIGURATION_INVALID",
    }, { status: 400 })
  }
  try {
    const settings = await getMtmSettings(auth.orgId)
    const clock = organizationCalendarClock(settings.timezone)
    if (isMovedDayDraft(parsed.data)) {
      const result = await createWorkforceCalendarMovedDay({
        organizationId: auth.orgId,
        createdByUserId: auth.userId,
        currentDate: clock.currentDate,
        draft: parsed.data,
        audit: workforceConfigurationRequestAuditContext(req, auth.userId),
      })
      return NextResponse.json({
        success: true,
        data: {
          ...clock,
          operation: parsed.data.operation,
          scope: parsed.data.scope,
          team: result.team,
          agent: null,
          days: result.days,
        },
      }, { status: result.created ? 201 : 200 })
    }
    const result = await createWorkforceCalendarOverride({
      organizationId: auth.orgId,
      createdByUserId: auth.userId,
      currentDate: clock.currentDate,
      draft: parsed.data,
      audit: workforceConfigurationRequestAuditContext(req, auth.userId),
    })
    return NextResponse.json({
      success: true,
      data: {
        ...clock,
        scope: parsed.data.scope,
        team: result.team,
        agent: result.agent,
        day: result.day,
      },
    }, { status: result.created ? 201 : 200 })
  } catch (error) {
    if (error instanceof WorkforceCalendarConfigurationError) return configurationError(error)
    console.error("[workforce/configuration/calendar POST]", error)
    return NextResponse.json({ error: "Failed to create Workforce calendar override" }, { status: 500 })
  }
})
