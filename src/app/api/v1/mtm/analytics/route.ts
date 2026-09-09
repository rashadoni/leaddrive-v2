/**
 * GET /api/v1/mtm/analytics (M2-3)
 *
 * Returns standard MTM analytics KPIs plus the route-execution KPIs:
 *   1. visitPlanFulfillment %  — visitedPoints / totalPoints across routes
 *   2. avgTimeOnRoute (min)    — average (completedAt - startedAt) per route
 *   3. avgTimeInStore (min)    — average visit.duration across checked-out visits
 *
 * Also returns per-agent breakdown (agentKpis) for the manager drill-down view.
 */
import { NextResponse } from "next/server"
import { createHash } from "node:crypto"
import { prisma } from "@/lib/prisma"
import { buildAgentKpis, type AgentVisitRow, type AgentRouteRow } from "@/lib/mtm-analytics"
import { withAnalyticsCache } from "@/lib/cache/analytics-cache"
import { withRouteFieldWebRlsAuth } from "@/lib/with-mtm-rls-auth"
import { resolveMtmRouteActor } from "@/lib/mtm/route-permissions"

export const GET = withRouteFieldWebRlsAuth("read", async (req, auth) => {
  const orgId = auth.orgId
  const actor = await resolveMtmRouteActor(prisma, {
    organizationId: orgId,
    userId: auth.userId,
    webRole: auth.role,
  })
  if (!actor) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  const scopedAgentIds = actor.scopedAgentIds
  const agentScope = scopedAgentIds ? { agentId: { in: [...scopedAgentIds] } } : {}
  const { searchParams } = new URL(req.url)
  // Validate period against the known enum — unknown values fall back to "monthly"
  // so they produce identical content to the monthly query. Normalizing here
  // prevents unbounded cache-key pollution from arbitrary ?period= strings.
  const VALID_PERIODS = new Set(["weekly", "monthly", "yearly"])
  const rawPeriod = searchParams.get("period") ?? ""
  const period = VALID_PERIODS.has(rawPeriod) ? rawPeriod : "monthly"

  // M4-2: Cache key = orgId + actor scope + period. TTL 300 s — KPI aggregates are heavy and
  // refresh is acceptable at 5-minute granularity on the dashboard.
  const scopeKey = scopedAgentIds === null
    ? "all"
    : createHash("sha256").update([...scopedAgentIds].sort().join("\0")).digest("hex").slice(0, 24)
  const cacheKey = `mtm:analytics:${orgId}:${scopeKey}:${period}`

  try {
    const data = await withAnalyticsCache(cacheKey, 300, async () => {
    const now = new Date()
    let startDate: Date

    if (period === "weekly") {
      startDate = new Date(now)
      startDate.setDate(now.getDate() - 7)
    } else if (period === "yearly") {
      startDate = new Date(now.getFullYear(), 0, 1)
    } else {
      startDate = new Date(now.getFullYear(), now.getMonth(), 1)
    }

    const where = { organizationId: orgId, createdAt: { gte: startDate }, ...agentScope }

    // Weekly-comparison window (batch 1 needs the cutoffs)
    const oneWeekAgo = new Date(now)
    oneWeekAgo.setDate(now.getDate() - 7)
    const twoWeeksAgo = new Date(now)
    twoWeeksAgo.setDate(now.getDate() - 14)

    // ── Batch 1: basic counts + trend data ──────────────────────────────────
    const [totalVisits, totalTasks, completedTasks, totalPhotos, visits, tasks, recentVisits] = await Promise.all([
      prisma.mtmVisit.count({ where: { ...where, deletedAt: null } }),
      prisma.mtmTask.count({ where: { ...where, deletedAt: null } }),
      prisma.mtmTask.count({ where: { ...where, status: "COMPLETED", deletedAt: null } }),
      prisma.mtmPhoto.count({ where }),
      prisma.mtmVisit.findMany({
        where: { ...where, deletedAt: null },
        select: { createdAt: true },
        orderBy: { createdAt: "asc" },
      }),
      prisma.mtmTask.findMany({
        where: { ...where, deletedAt: null },
        select: { createdAt: true },
        orderBy: { createdAt: "asc" },
      }),
      // Weekly comparison source (was a separate serial round-trip)
      prisma.mtmVisit.findMany({
        where: { organizationId: orgId, createdAt: { gte: twoWeeksAgo }, deletedAt: null, ...agentScope },
        select: { createdAt: true },
      }),
    ])

    const completionRate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0

    // Group by month for yearly trend
    const monthlyTrend: Record<string, { visits: number; tasks: number }> = {}
    for (const v of visits) {
      const key = `${v.createdAt.getFullYear()}-${String(v.createdAt.getMonth() + 1).padStart(2, "0")}`
      if (!monthlyTrend[key]) monthlyTrend[key] = { visits: 0, tasks: 0 }
      monthlyTrend[key].visits++
    }
    for (const t of tasks) {
      const key = `${t.createdAt.getFullYear()}-${String(t.createdAt.getMonth() + 1).padStart(2, "0")}`
      if (!monthlyTrend[key]) monthlyTrend[key] = { visits: 0, tasks: 0 }
      monthlyTrend[key].tasks++
    }

    // ── Weekly comparison (data fetched in batch 1) ──────────────────────────
    const weeklyComparison: Record<number, { thisWeek: number; lastWeek: number }> = {}
    for (let d = 0; d < 7; d++) weeklyComparison[d] = { thisWeek: 0, lastWeek: 0 }

    for (const v of recentVisits) {
      const dow = v.createdAt.getDay()
      if (v.createdAt >= oneWeekAgo) weeklyComparison[dow].thisWeek++
      else weeklyComparison[dow].lastWeek++
    }

    // ── Batch 3: agent queries + Mars KPI data ───────────────────────────────
    const routeWhere = { organizationId: orgId, date: { gte: startDate }, deletedAt: null, ...agentScope }

    const [
      agentVisitStats,
      agentRouteStats,
      routeAggregate,
      routesWithTime,
      visitDurationAgg,
    ] = await Promise.all([
      // New (M2-3): per-agent visit count + avg time in store. The first five
      // rows double as the "top agents by visits" list (same filter/order the
      // old dedicated top-5 groupBy used).
      prisma.mtmVisit.groupBy({
        by: ["agentId"],
        where: { ...where, deletedAt: null },
        _count: true,
        _avg: { duration: true },
        orderBy: { _count: { agentId: "desc" } },
        take: 50,
      }),
      // New (M2-3): per-agent route plan fulfillment
      prisma.mtmRoute.groupBy({
        by: ["agentId"],
        where: { ...routeWhere, totalPoints: { gt: 0 } },
        _sum: { totalPoints: true, visitedPoints: true },
      }),
      // New (M2-3): org-level visit plan fulfillment
      prisma.mtmRoute.aggregate({
        where: { ...routeWhere, totalPoints: { gt: 0 } },
        _sum: { totalPoints: true, visitedPoints: true },
      }),
      // New (M2-3): routes with timing for avgTimeOnRoute
      prisma.mtmRoute.findMany({
        where: { ...routeWhere, startedAt: { not: null }, completedAt: { not: null } },
        select: { startedAt: true, completedAt: true, agentId: true },
      }),
      // New (M2-3): avg visit duration
      prisma.mtmVisit.aggregate({
        where: { ...where, deletedAt: null, duration: { not: null } },
        _avg: { duration: true },
      }),
    ])

    // ── Agent names ──────────────────────────────────────────────────────────
    const agentIds = agentVisitStats.map((a: { agentId: string }) => a.agentId)
    const agents = await prisma.mtmAgent.findMany({
      where: { organizationId: orgId, id: { in: agentIds } },
      select: { id: true, name: true },
    })
    const agentMap = Object.fromEntries(
      agents.map((a: { id: string; name: string }) => [a.id, a.name])
    )

    // ── Top agents (first 5 of the per-agent stats, same ordering) ──────────
    const topAgents = agentVisitStats.slice(0, 5).map((a: { agentId: string; _count: number }) => ({
      agentId: a.agentId,
      name: agentMap[a.agentId] || "Unknown",
      visits: a._count,
    }))

    // ── Mars KPI: org-level ──────────────────────────────────────────────────
    const totalRoutePoints   = routeAggregate._sum.totalPoints   ?? 0
    const visitedRoutePoints = routeAggregate._sum.visitedPoints ?? 0
    const visitPlanFulfillment =
      totalRoutePoints > 0 ? Math.round((visitedRoutePoints / totalRoutePoints) * 100) : 0

    // avgTimeOnRoute: mean of (completedAt - startedAt) in minutes
    const routeMinutes = (routesWithTime as Array<{ startedAt: Date | null; completedAt: Date | null }>)
      .filter((r) => r.startedAt && r.completedAt)
      .map((r) => (r.completedAt!.getTime() - r.startedAt!.getTime()) / 60_000)
    const avgTimeOnRoute =
      routeMinutes.length > 0
        ? Math.round(routeMinutes.reduce((s, m) => s + m, 0) / routeMinutes.length)
        : 0

    const avgTimeInStore = visitDurationAgg._avg.duration != null
      ? Math.round(visitDurationAgg._avg.duration)
      : 0

    const marsKpi = {
      visitPlanFulfillment,
      avgTimeOnRoute,
      avgTimeInStore,
    }

    // ── Mars KPI: per-agent ──────────────────────────────────────────────────
    const agentKpis = buildAgentKpis(
      agentVisitStats as AgentVisitRow[],
      agentRouteStats as AgentRouteRow[],
      agentMap,
    )

    return {
        scope: {
          semantics: "current primary-owner agent scope; null scope means tenant administrator",
          bounded: scopedAgentIds !== null,
        },
        kpi: { totalVisits, totalTasks, totalPhotos, completionRate },
        monthlyTrend: Object.entries(monthlyTrend).map(([month, trend]) => ({ month, ...trend })),
        weeklyComparison: Object.entries(weeklyComparison).map(([day, cmp]) => ({
          day: Number(day),
          ...cmp,
        })),
        topAgents,
        marsKpi,
        agentKpis,
      }
    }) // end withAnalyticsCache

    return NextResponse.json({ success: true, data })
  } catch (e: unknown) {
    console.error("[mtm/analytics]", e)
    return NextResponse.json({ error: "Failed to fetch analytics" }, { status: 500 })
  }
})
