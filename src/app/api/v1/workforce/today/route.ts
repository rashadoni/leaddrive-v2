import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getMtmSettings } from "@/lib/mtm-settings"
import { currentDateKey } from "@/lib/mtm/mobile-week"
import { isValidTimezone } from "@/lib/timezone"
import { withWorkforceRlsAuth } from "@/lib/with-workforce-rls-auth"
import { resolveWorkforceActor } from "@/lib/workforce/actor"
import { resolveWorkforceCalendarDay, type WorkforceCalendarOverride } from "@/lib/workforce/calendar"

type WorkdayStatus = "STARTED" | "PAUSED" | "COMPLETED"

type WorkforceTodayAgent = {
  id: string
  name: string
  role: string
  teamId: string | null
}

type WorkforceTodayWorkday = {
  id: string
  agentId: string
  status: WorkdayStatus
  startedAt: Date
  pausedAt: Date | null
  completedAt: Date | null
}

type WorkforcePreviousOpenWorkday = Omit<WorkforceTodayWorkday, "completedAt"> & {
  workDate: Date
}

function workforceScopeDenied() {
  return NextResponse.json({ error: "Forbidden", code: "WORKFORCE_SCOPE_DENIED" }, { status: 403 })
}

/** GET /api/v1/workforce/today — manager exception-first daily read model. */
export const GET = withWorkforceRlsAuth("read", async (_req, auth) => {
  const actor = await resolveWorkforceActor(prisma, {
    organizationId: auth.orgId,
    userId: auth.userId,
    webRole: auth.role,
  })
  if (!actor) return workforceScopeDenied()

  try {
    const settings = await getMtmSettings(auth.orgId)
    const timezone = isValidTimezone(settings.timezone) ? settings.timezone : "UTC"
    const date = currentDateKey(new Date(), timezone)
    // `workDate` is a PostgreSQL DATE written from a canonical UTC date key;
    // converting organization midnight to an instant would shift the key for
    // every positive-offset timezone.
    const workDate = new Date(`${date}T00:00:00.000Z`)
    const agents: WorkforceTodayAgent[] = await prisma.mtmAgent.findMany({
      where: {
        organizationId: auth.orgId,
        status: "ACTIVE",
        ...(actor.scopedAgentIds === null ? {} : { id: { in: [...actor.scopedAgentIds] } }),
      },
      orderBy: { name: "asc" },
      select: { id: true, name: true, role: true, teamId: true },
    })
    const agentIds = agents.map((agent) => agent.id)
    const teamIds = [...new Set(agents.flatMap((agent) => agent.teamId ? [agent.teamId] : []))]
    const [todayWorkdays, openPreviousWorkdays, calendarOverrides]: [
      WorkforceTodayWorkday[],
      WorkforcePreviousOpenWorkday[],
      WorkforceCalendarOverride[],
    ] = agentIds.length > 0
      ? await Promise.all([
          prisma.mtmAgentWorkday.findMany({
            where: { organizationId: auth.orgId, agentId: { in: agentIds }, workDate },
            select: { id: true, agentId: true, status: true, startedAt: true, pausedAt: true, completedAt: true },
          }),
          prisma.mtmAgentWorkday.findMany({
            where: {
              organizationId: auth.orgId,
              agentId: { in: agentIds },
              workDate: { lt: workDate },
              status: { in: ["STARTED", "PAUSED"] },
            },
            orderBy: [{ workDate: "desc" }, { startedAt: "desc" }, { id: "asc" }],
            select: { id: true, agentId: true, workDate: true, status: true, startedAt: true, pausedAt: true },
          }),
          prisma.mtmWorkCalendarDay.findMany({
            where: {
              organizationId: auth.orgId,
              date: workDate,
              deletedAt: null,
              OR: [
                { agentId: { in: agentIds }, teamId: null },
                ...(teamIds.length > 0 ? [{ agentId: null, teamId: { in: teamIds } }] : []),
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
          }),
        ])
      : [[], [], []]
    const todayByAgent = new Map(todayWorkdays.map((workday) => [workday.agentId, workday]))
    const previousByAgent = new Map<string, (typeof openPreviousWorkdays)[number]>()
    for (const workday of openPreviousWorkdays) {
      if (!previousByAgent.has(workday.agentId)) previousByAgent.set(workday.agentId, workday)
    }
    const people = agents.map((agent) => {
      const workday = todayByAgent.get(agent.id)
      const previousOpenWorkday = previousByAgent.get(agent.id)
      const calendar = resolveWorkforceCalendarDay({
        date,
        overrides: calendarOverrides,
        teamId: agent.teamId,
        agentId: agent.id,
      })
      return {
        ...agent,
        status: (workday?.status ?? "NOT_STARTED") as WorkdayStatus | "NOT_STARTED",
        workday: workday ?? null,
        previousOpenWorkday: previousOpenWorkday ?? null,
        // `NOT_STARTED` is a raw workday state, not a no-show. Calendar makes
        // the distinction explicit until C6 introduces a reviewable no-show.
        calendar,
      }
    })
    const summary = people.reduce((counts, person) => {
      if (person.status === "STARTED") counts.started += 1
      else if (person.status === "PAUSED") counts.paused += 1
      else if (person.status === "COMPLETED") counts.completed += 1
      else counts.notStarted += 1
      if (person.previousOpenWorkday) counts.previousOpen += 1
      return counts
    }, { started: 0, paused: 0, completed: 0, notStarted: 0, previousOpen: 0 })

    return NextResponse.json({
      success: true,
      data: {
        date,
        timezone,
        scope: actor.scopedAgentIds === null ? "ORGANIZATION" : actor.role === "AGENT" ? "SELF" : "TEAM_OR_REGION",
        summary,
        people,
      },
    })
  } catch (error) {
    console.error("[workforce/today GET]", error)
    return NextResponse.json({ error: "Failed to load today's workforce status" }, { status: 500 })
  }
})
