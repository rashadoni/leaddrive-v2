import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withMobileRls } from "@/lib/with-mobile-rls"
import { getMtmSettings } from "@/lib/mtm-settings"
import { addDateKeyDays, currentDateKey, localDateKeyToUtc } from "@/lib/mtm/mobile-week"
import { isValidTimezone } from "@/lib/timezone"

type TodayRoute = {
  totalPoints: number
  visitedPoints: number
  status: "DRAFT" | "PLANNED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED"
}

function actionableRouteStatus(routes: TodayRoute[]): TodayRoute["status"] | "NONE" {
  const priority: TodayRoute["status"][] = ["IN_PROGRESS", "PLANNED", "DRAFT", "COMPLETED", "CANCELLED"]
  return priority.find((status) => routes.some((route) => route.status === status)) ?? "NONE"
}

/**
 * GET /api/v1/mtm/mobile/profile
 * Get agent profile + today's summary.
 */
export const GET = withMobileRls(async (req, auth) => {
  try {
    const routeFieldEnabled = auth.tenantCapabilities?.routeField === true
    const [agent, settings] = await Promise.all([
      prisma.mtmAgent.findUnique({
        where: { id: auth.agentId },
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          role: true,
          status: true,
          avatar: true,
          organizationId: true,
          ...(routeFieldEnabled ? { isOnline: true } : {}),
          organization: { select: { id: true, name: true } },
          manager: { select: { id: true, name: true } },
        },
      }),
      getMtmSettings(auth.orgId),
    ])

    if (!agent) {
      return NextResponse.json({ error: "Agent not found" }, { status: 404 })
    }

    const timezone = isValidTimezone(settings.timezone) ? settings.timezone : "UTC"
    const todayDate = currentDateKey(new Date(), timezone)
    const tomorrowDate = addDateKeyDays(todayDate, 1)
    const today = localDateKeyToUtc(todayDate, timezone)
    const tomorrow = localDateKeyToUtc(tomorrowDate, timezone)
    let todayVisits = 0
    let todayTasks = 0
    let todayRoutes: TodayRoute[] = []
    if (routeFieldEnabled) {
      const [visits, tasks, routes] = await Promise.all([
        prisma.mtmVisit.count({
          where: { organizationId: auth.orgId, agentId: auth.agentId, checkInAt: { gte: today, lt: tomorrow }, deletedAt: null },
        }),
        prisma.mtmTask.count({
          where: { organizationId: auth.orgId, agentId: auth.agentId, status: "COMPLETED", completedAt: { gte: today, lt: tomorrow }, deletedAt: null },
        }),
        prisma.mtmRoute.findMany({
          where: {
            organizationId: auth.orgId,
            OR: [
              { agentId: auth.agentId },
              { assignments: { some: { agentId: auth.agentId, removedAt: null } } },
            ],
            date: { gte: today, lt: tomorrow },
            deletedAt: null,
          },
          orderBy: { createdAt: "asc" },
          select: { id: true, totalPoints: true, visitedPoints: true, status: true },
        }),
      ])
      todayVisits = visits
      todayTasks = tasks
      todayRoutes = routes as TodayRoute[]
    }

    return NextResponse.json({
      success: true,
      data: {
        agent: {
          id: agent.id,
          name: agent.name,
          email: agent.email,
          phone: agent.phone,
          role: agent.role,
          status: agent.status,
          avatar: agent.avatar,
          ...(routeFieldEnabled ? { isOnline: agent.isOnline } : {}),
          organizationId: agent.organizationId,
          organizationName: agent.organization.name,
          manager: agent.manager,
        },
        todaySummary: {
          date: todayDate,
          timezone,
          visits: todayVisits,
          tasksCompleted: todayTasks,
          routes: todayRoutes.length,
          routePoints: todayRoutes.reduce((sum, route) => sum + route.totalPoints, 0),
          routeVisited: todayRoutes.reduce((sum, route) => sum + route.visitedPoints, 0),
          routeStatus: actionableRouteStatus(todayRoutes),
          routeStatuses: [...new Set(todayRoutes.map((route) => route.status))],
        },
      },
    })
  } catch (error) {
    console.error("[MTM/mobile/profile GET]", error)
    return NextResponse.json({ error: "Failed to load profile" }, { status: 500 })
  }
})
