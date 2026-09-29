import { NextRequest, NextResponse } from "next/server"
import { getMtmSettings } from "@/lib/mtm-settings"
import { addDateKeyDays, currentDateKey, isDateKey } from "@/lib/mtm/mobile-week"
import { isValidTimezone } from "@/lib/timezone"
import { withWorkforceSessionScheduleConfigurationAuth } from "@/lib/with-workforce-rls-auth"
import {
  WorkforceCalendarConfigurationError,
  createWorkforceCalendarOverride,
  listWorkforceCalendarOverrides,
  searchWorkforceCalendarTeams,
} from "@/lib/workforce/calendar-configuration"
import {
  WORKFORCE_CALENDAR_TEAM_SEARCH_LIMIT,
  WorkforceCalendarOverrideCreateSchema,
  WorkforceCalendarScopeSelectionSchema,
} from "@/lib/workforce/calendar-configuration-contract"
import { workforceConfigurationRequestAuditContext } from "@/lib/workforce/configuration-route"

function organizationCalendarClock(timezone: string): { timezone: string; currentDate: string } {
  const safeTimezone = isValidTimezone(timezone) ? timezone : "UTC"
  return { timezone: safeTimezone, currentDate: currentDateKey(new Date(), safeTimezone) }
}

function configurationError(error: WorkforceCalendarConfigurationError): Response {
  const status = error.code === "WORKFORCE_CALENDAR_CONFIGURATION_OVERRIDE_EXISTS"
    ? 409
    : error.code === "WORKFORCE_CALENDAR_CONFIGURATION_TEAM_UNAVAILABLE"
      ? 404
      : 400
  return NextResponse.json({ error: error.message, code: error.code }, { status })
}

export const GET = withWorkforceSessionScheduleConfigurationAuth("SCHEDULE_READ", async (req: NextRequest, auth) => {
  try {
    const selection = WorkforceCalendarScopeSelectionSchema.safeParse({
      scope: req.nextUrl.searchParams.get("scope") ?? undefined,
      ...(req.nextUrl.searchParams.has("teamId")
        ? { teamId: req.nextUrl.searchParams.get("teamId") ?? undefined }
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
    const directory = await searchWorkforceCalendarTeams({
      organizationId: auth.orgId,
      query: teamQuery,
      limit: teamLimit,
      selectedTeamId: selection.data.scope === "TEAM" ? selection.data.teamId : undefined,
    })
    if (selection.data.scope === "TEAM" && !directory.selectedTeam) {
      throw new WorkforceCalendarConfigurationError(
        "WORKFORCE_CALENDAR_CONFIGURATION_TEAM_UNAVAILABLE",
        "The selected team is unavailable",
      )
    }
    const days = await listWorkforceCalendarOverrides({
      organizationId: auth.orgId,
      currentDate: clock.currentDate,
      start,
      endExclusive,
      scope: selection.data.scope,
      teamId: selection.data.teamId,
    })
    return NextResponse.json({
      success: true,
      data: {
        ...clock,
        start,
        endExclusive,
        scope: selection.data.scope,
        team: directory.selectedTeam,
        teamDirectory: {
          items: directory.teams,
          query: directory.query,
          limit: directory.limit,
          hasMore: directory.hasMore,
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
  const parsed = WorkforceCalendarOverrideCreateSchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json({
      error: parsed.error.issues[0]?.message ?? "Invalid Workforce calendar override",
      code: "WORKFORCE_CALENDAR_CONFIGURATION_INVALID",
    }, { status: 400 })
  }
  try {
    const settings = await getMtmSettings(auth.orgId)
    const clock = organizationCalendarClock(settings.timezone)
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
        day: result.day,
      },
    }, { status: result.created ? 201 : 200 })
  } catch (error) {
    if (error instanceof WorkforceCalendarConfigurationError) return configurationError(error)
    console.error("[workforce/configuration/calendar POST]", error)
    return NextResponse.json({ error: "Failed to create Workforce calendar override" }, { status: 500 })
  }
})
