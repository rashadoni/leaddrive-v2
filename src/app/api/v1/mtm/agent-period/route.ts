import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRouteFieldRlsAuth } from "@/lib/with-mtm-rls-auth"
import { resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import { getMtmSettings } from "@/lib/mtm-settings"
import { isDateKey } from "@/lib/mtm/mobile-week"
import { isValidTimezone, localDateTimeToUtc } from "@/lib/timezone"
import { AGENT_PERIOD_MAX_DAYS, buildAgentPeriod, periodDays } from "@/lib/mtm/agent-period"

/**
 * GET /api/v1/mtm/agent-period?agentId=&from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * One agent over up to a month, every day with a verdict (see
 * src/lib/mtm/agent-period.ts). Same scope rule as the GPS history: a manager
 * sees the agents of their territory, an agent sees themself.
 */
const MAX_POINTS = 60_000

function refuse(code: string, status: number) {
  return NextResponse.json({ error: status === 403 ? "Forbidden" : "Invalid request", code }, { status })
}

export const GET = withRouteFieldRlsAuth("read", async (req, auth) => {
  const actor = await resolveMtmRouteActor(prisma, {
    organizationId: auth.orgId,
    userId: auth.userId,
    webRole: auth.role,
    agentId: auth.agentId,
  })
  if (!actor) return refuse("MTM_AGENT_PERIOD_ACTOR_NOT_FOUND", 403)

  const { searchParams } = new URL(req.url)
  const agentId = searchParams.get("agentId")?.trim() ?? ""
  const from = searchParams.get("from") ?? ""
  const to = searchParams.get("to") ?? ""
  if (!agentId || !isDateKey(from) || !isDateKey(to) || to < from || periodDays(from, to).at(-1) !== to) {
    return refuse("MTM_AGENT_PERIOD_INVALID", 400)
  }
  if (actor.scopedAgentIds !== null && !actor.scopedAgentIds.includes(agentId)) {
    return refuse("MTM_AGENT_PERIOD_OUT_OF_SCOPE", 403)
  }

  const agent = await prisma.mtmAgent.findFirst({
    where: { id: agentId, organizationId: auth.orgId },
    select: { id: true, name: true },
  })
  if (!agent) return refuse("MTM_AGENT_PERIOD_AGENT_NOT_FOUND", 404)

  const settings = await getMtmSettings(auth.orgId)
  const timezone = isValidTimezone(settings.timezone) ? settings.timezone : "UTC"
  const next = new Date(`${to}T00:00:00.000Z`)
  next.setUTCDate(next.getUTCDate() + 1)
  const rangeStart = localDateTimeToUtc(`${from}T00:00`, timezone)
  const rangeEnd = localDateTimeToUtc(`${next.toISOString().slice(0, 10)}T00:00`, timezone)

  const [workdays, visits, routes, points] = await Promise.all([
    prisma.mtmAgentWorkday.findMany({
      where: {
        organizationId: auth.orgId,
        agentId,
        // The period's own shifts, plus one opened earlier and still open then.
        OR: [
          { workDate: { gte: new Date(`${from}T00:00:00.000Z`), lte: new Date(`${to}T00:00:00.000Z`) } },
          { workDate: { lt: new Date(`${from}T00:00:00.000Z`) }, OR: [{ completedAt: null }, { completedAt: { gte: rangeStart } }] },
        ],
      },
      orderBy: { workDate: "asc" },
      select: { workDate: true, startedAt: true, completedAt: true, totalPausedSeconds: true },
    }),
    prisma.mtmVisit.findMany({
      where: { organizationId: auth.orgId, agentId, deletedAt: null, checkInAt: { gte: rangeStart, lt: rangeEnd } },
      select: { checkInAt: true, status: true },
    }),
    prisma.mtmRoute.findMany({
      where: {
        organizationId: auth.orgId,
        deletedAt: null,
        date: { gte: new Date(`${from}T00:00:00.000Z`), lte: new Date(`${to}T00:00:00.000Z`) },
        OR: [{ agentId }, { assignments: { some: { agentId, removedAt: null } } }],
      },
      select: { date: true, status: true, totalPoints: true, visitedPoints: true },
    }),
    prisma.mtmAgentLocation.findMany({
      where: { organizationId: auth.orgId, agentId, recordedAt: { gte: rangeStart, lt: rangeEnd } },
      orderBy: [{ recordedAt: "asc" }, { id: "asc" }],
      take: MAX_POINTS,
      select: { id: true, latitude: true, longitude: true, accuracy: true, speed: true, heading: true, battery: true, isMoving: true, recordedAt: true },
    }),
  ])

  const period = buildAgentPeriod({
    from,
    to,
    timezone,
    now: new Date(),
    maxAccuracyMeters: settings.historyMaxAccuracyMeters,
    workdays,
    visits,
    routes,
    points: points.map((point) => ({ ...point, workdayId: null })),
  })

  return NextResponse.json({
    success: true,
    data: {
      agent,
      from,
      to,
      timezone,
      maxDays: AGENT_PERIOD_MAX_DAYS,
      // Distances are withheld when the read hit its cap, as on the history page.
      distanceComplete: points.length < MAX_POINTS,
      ...period,
    },
  })
})
