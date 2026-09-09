import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withMobileRls } from "@/lib/with-mobile-rls"
import { requireMobileCapability } from "@/lib/mtm/mobile-capabilities"
import { addDateKeyDays, isDateKey } from "@/lib/mtm/mobile-week"
import { resolveAgentScope } from "@/lib/mtm/territory-scope"

const MAX_RANGE_DAYS = 42
const MAX_ROUTES = 5_000
const DAY_MS = 86_400_000

type PlanningWindow = {
  from: string
  to: string
  days: number
  legacyDate: string | null
}

function inclusiveDayCount(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / DAY_MS,
  ) + 1
}

function planningWindow(searchParams: URLSearchParams, today: string): PlanningWindow | null {
  const date = searchParams.get("date")
  const from = searchParams.get("from")
  const to = searchParams.get("to")

  // `date` is the legacy single-day contract. Do not silently choose one
  // interpretation when old and new parameters are mixed.
  if (date !== null && (from !== null || to !== null)) return null

  if (from !== null || to !== null) {
    if (!from || !to || !isDateKey(from) || !isDateKey(to) || to < from) return null
    const days = inclusiveDayCount(from, to)
    if (days < 1 || days > MAX_RANGE_DAYS) return null
    return { from, to, days, legacyDate: null }
  }

  const requestedDate = date ?? today
  if (!isDateKey(requestedDate)) return null
  return { from: requestedDate, to: requestedDate, days: 1, legacyDate: requestedDate }
}

export const GET = withMobileRls(async (req, auth) => {
  const forbidden = requireMobileCapability(auth, "TEAM_READ")
  if (forbidden) return forbidden

  const window = planningWindow(
    new URL(req.url).searchParams,
    new Date().toISOString().slice(0, 10),
  )
  if (!window) {
    return NextResponse.json({
      error: `Use date=YYYY-MM-DD or an inclusive from/to range of at most ${MAX_RANGE_DAYS} days`,
      code: "MTM_MANAGER_PLANNING_RANGE_INVALID",
    }, { status: 400 })
  }

  try {
    const scope = await resolveAgentScope(prisma, {
      organizationId: auth.orgId,
      agentId: auth.agentId,
      role: auth.role as "ADMIN" | "MANAGER" | "SUPERVISOR" | "AGENT",
    })
    const agentScope = scope.agentIds ? { in: scope.agentIds } : undefined
    const rangeStart = new Date(`${window.from}T00:00:00.000Z`)
    const rangeEndExclusive = new Date(`${addDateKeyDays(window.to, 1)}T00:00:00.000Z`)

    const [agents, routeRows] = await Promise.all([
      prisma.mtmAgent.findMany({
        where: {
          organizationId: auth.orgId,
          status: "ACTIVE",
          ...(agentScope ? { id: agentScope } : {}),
        },
        orderBy: { name: "asc" },
        select: { id: true, name: true, role: true, status: true, teamId: true },
      }),
      prisma.mtmRoute.findMany({
        where: {
          organizationId: auth.orgId,
          date: { gte: rangeStart, lt: rangeEndExclusive },
          deletedAt: null,
          ...(agentScope ? { agentId: agentScope } : {}),
        },
        orderBy: [{ date: "asc" }, { updatedAt: "desc" }],
        take: MAX_ROUTES + 1,
        select: {
          id: true,
          agentId: true,
          date: true,
          name: true,
          status: true,
          totalPoints: true,
          visitedPoints: true,
          startedAt: true,
          completedAt: true,
          agent: { select: { id: true, name: true } },
        },
      }),
    ])

    const truncated = routeRows.length > MAX_ROUTES
    const routes = truncated ? routeRows.slice(0, MAX_ROUTES) : routeRows

    return NextResponse.json({
      success: true,
      data: {
        ...(window.legacyDate ? { date: window.legacyDate } : {}),
        from: window.from,
        to: window.to,
        days: window.days,
        maxRangeDays: MAX_RANGE_DAYS,
        agents,
        routes,
        truncated,
        scope: scope.agentIds ? "TEAM_OR_REGION" : "ORGANIZATION",
      },
    })
  } catch (error) {
    console.error("[MTM/mobile/manager/planning GET]", error)
    return NextResponse.json({ error: "Failed to load manager planning calendar" }, { status: 500 })
  }
})
