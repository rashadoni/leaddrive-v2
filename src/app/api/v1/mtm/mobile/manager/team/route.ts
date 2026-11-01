import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withMobileRls } from "@/lib/with-mobile-rls"
import { hasMobilePermission, requireMobileCapability } from "@/lib/mtm/mobile-capabilities"
import { resolveAgentScope } from "@/lib/mtm/territory-scope"
import { getMtmSettings } from "@/lib/mtm-settings"
import { currentDateKey } from "@/lib/mtm/mobile-week"
import { isValidTimezone } from "@/lib/timezone"
import { agentsReachableByPush } from "@/lib/mtm/agent-task-glance"
import { teamRouteDay, type TeamRouteDayPoint, type TeamRouteDayVisit } from "@/lib/mtm/team-route-day"
import { loadDayTimes, type DayTime } from "@/lib/mtm/day-time"

/** Published routes: a draft is nobody's plan yet, a cancelled one nobody's any more. */
const ROUTE_TODAY_STATUSES = ["PLANNED", "IN_PROGRESS", "COMPLETED", "INCOMPLETE"] as const

type WorkdayRow = { id: string; status: string; startedAt: Date; pausedAt: Date | null; completedAt: Date | null }

/**
 * The workday the team card speaks of: the open one if there is one — it may
 * have begun yesterday — else today's, finished. Until 2026-10-17 only open
 * ones were read, and a day finished at six read «İş günü başlamayıb».
 */
function workdayOfToday(rows: WorkdayRow[]): WorkdayRow | null {
  return rows.find((row) => row.status === "STARTED" || row.status === "PAUSED") ?? rows[0] ?? null
}
/** GET /api/v1/mtm/mobile/manager/team — scoped Manager/Supervisor read model. */
export const GET = withMobileRls(async (req, auth) => {
  const forbidden = requireMobileCapability(auth, "TEAM_READ")
  if (forbidden) return forbidden
  try {
    // This is a shared manager transport. Route-only managers may still see
    // their team list, but never active workday data; Workforce-only managers
    // get the inverse without acquiring route access.
    const routeFieldEnabled = auth.tenantCapabilities?.routeField === true
    const workforceEnabled = auth.tenantCapabilities?.workforceHrm === true
    const canReadRouteTeam = routeFieldEnabled && hasMobilePermission(auth.role, "ROUTE_TEAM_PLAN")
    const canReadWorkforceTeam = workforceEnabled && hasMobilePermission(auth.role, "WORKTIME_TEAM_READ")
    // Whether the agent's day is on — begun, paused, closed — is the Route &
    // Field day too: it starts the tracking and the route. A route manager of
    // a company without the HRM module (Zeytun) read «İş günü başlamayıb» under
    // every agent and «İşdədir 0 / 2» while two days were running (owner's
    // phone, 2026-11-01: «Да, делай»). The workday's status and times only;
    // nothing of HRM (schedules, requests) comes with it.
    const canReadTeamWorkday = canReadWorkforceTeam || canReadRouteTeam
    if (!canReadRouteTeam && !canReadWorkforceTeam) {
      return NextResponse.json({
        error: "Forbidden",
        code: "MTM_MOBILE_PERMISSION_REQUIRED",
        permission: "WORKTIME_TEAM_READ_OR_ROUTE_TEAM_PLAN",
      }, { status: 403 })
    }
    const scope = await resolveAgentScope(prisma, {
      organizationId: auth.orgId,
      agentId: auth.agentId,
      role: auth.role as "ADMIN" | "MANAGER" | "SUPERVISOR" | "AGENT",
    })
    const includeInactive = new URL(req.url).searchParams.get("includeInactive") === "1"
    const settings = await getMtmSettings(auth.orgId)
    const timezone = isValidTimezone(settings.timezone) ? settings.timezone : "UTC"
    const todayKey = currentDateKey(new Date(), timezone)
    const today = new Date(`${todayKey}T00:00:00.000Z`)
    const agents = await prisma.mtmAgent.findMany({
      where: {
        organizationId: auth.orgId,
        ...(includeInactive ? {} : { status: "ACTIVE" }),
        ...(scope.agentIds ? { id: { in: scope.agentIds } } : {}),
      },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        role: true,
        status: true,
        teamId: true,
        ...(routeFieldEnabled ? { isOnline: true, lastSeenAt: true } : {}),
        ...(canReadTeamWorkday
          ? {
              workdays: {
                where: { OR: [{ status: { in: ["STARTED", "PAUSED"] } }, { workDate: today }] },
                orderBy: { startedAt: "desc" },
                take: 2,
                select: { id: true, status: true, startedAt: true, pausedAt: true, completedAt: true },
              },
            }
          : {}),
      },
    })
    // «Визиты 3 из 8» on each card (owner, 2026-10-17): the points of the
    // routes published for today, by what became of them.
    const routeToday = new Map<string, { planned: number; visited: number; skipped: number }>()
    const routePoints = new Map<string, TeamRouteDayPoint[]>()
    if (canReadRouteTeam && agents.length > 0) {
      const routes = await prisma.mtmRoute.findMany({
        where: {
          organizationId: auth.orgId,
          agentId: { in: agents.map((agent) => agent.id) },
          date: today,
          deletedAt: null,
          status: { in: [...ROUTE_TODAY_STATUSES] },
        },
        select: {
          agentId: true,
          points: {
            where: { deletedAt: null },
            select: {
              id: true,
              orderIndex: true,
              status: true,
              plannedTime: true,
              visitedAt: true,
              customer: { select: { name: true } },
              contact: { select: { displayName: true } },
            },
          },
        },
      })
      for (const route of routes) {
        const counts = routeToday.get(route.agentId) ?? { planned: 0, visited: 0, skipped: 0 }
        routePoints.set(route.agentId, [...(routePoints.get(route.agentId) ?? []), ...route.points])
        for (const point of route.points) {
          counts.planned += 1
          if (point.status === "VISITED") counts.visited += 1
          if (point.status === "SKIPPED") counts.skipped += 1
        }
        routeToday.set(route.agentId, counts)
      }
    }
    // A visit still open from an earlier day of the company (owner,
    // 2026-10-17): one stayed open five days and took the next visit's photo.
    // The manager's «Diqqət» counts it; the agent's app asks to close it.
    const openVisitSince = new Map<string, string>()
    // The visit he is in now, opened today: «на визите 48 мин» on his card.
    const openVisitToday = new Map<string, TeamRouteDayVisit>()
    if (canReadRouteTeam && agents.length > 0) {
      const openVisits = await prisma.mtmVisit.findMany({
        where: {
          organizationId: auth.orgId,
          agentId: { in: agents.map((agent) => agent.id) },
          status: "CHECKED_IN",
          deletedAt: null,
        },
        orderBy: { checkInAt: "asc" },
        select: {
          agentId: true,
          checkInAt: true,
          routePointId: true,
          customer: { select: { name: true } },
          contact: { select: { displayName: true } },
        },
      })
      for (const visit of openVisits) {
        if (currentDateKey(visit.checkInAt, timezone) < todayKey) {
          if (!openVisitSince.has(visit.agentId)) openVisitSince.set(visit.agentId, visit.checkInAt.toISOString())
        } else {
          // Ascending: a second visit opened later today is the one he is in.
          openVisitToday.set(visit.agentId, visit)
        }
      }
    }
    // Where each running or finished day of today went — with clients, on a
    // break, on the way (owner, 2026-11-02: «Кольцо дня» on the card).
    const now = new Date()
    let dayTimes = new Map<string, DayTime>()
    if (canReadRouteTeam && canReadTeamWorkday) {
      const days = agents.flatMap((row) => {
        const day = workdayOfToday(((row as { workdays?: WorkdayRow[] }).workdays) ?? [])
        // Today's day only: a shift left open since yesterday is not «today» in minutes.
        return day && currentDateKey(day.startedAt, timezone) === todayKey
          ? [{ id: day.id, agentId: row.id, startedAt: day.startedAt, completedAt: day.completedAt }]
          : []
      })
      dayTimes = await loadDayTimes(prisma, auth.orgId, days, now)
    }
    // «Дать задачу» says before sending whether the pop-up reaches the phone.
    const reachable = await agentsReachableByPush(prisma, auth.orgId, agents.map((agent) => agent.id))
    return NextResponse.json({
      success: true,
      data: {
        scope: scope.agentIds ? "TEAM_OR_REGION" : "ORGANIZATION",
        date: todayKey,
        agents: agents.map((row) => {
          const { workdays = [], ...agent } = row as { workdays?: WorkdayRow[] } & Record<string, unknown> & { id: string }
          return {
            ...agent,
            workday: canReadTeamWorkday ? workdayOfToday(workdays) : null,
            pushReady: reachable.has(agent.id),
            ...(canReadRouteTeam
              ? {
                  routeToday: routeToday.get(agent.id) ?? null,
                  openVisitSince: openVisitSince.get(agent.id) ?? null,
                  routeDay: teamRouteDay(routePoints.get(agent.id) ?? [], openVisitToday.get(agent.id) ?? null),
                  dayTime: dayTimes.get(agent.id) ?? null,
                }
              : {}),
          }
        }),
      },
    })
  } catch (error) {
    console.error("[MTM/mobile/manager/team GET]", error)
    return NextResponse.json({ error: "Failed to load team" }, { status: 500 })
  }
})
