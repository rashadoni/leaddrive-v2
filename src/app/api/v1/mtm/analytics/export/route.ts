/**
 * GET /api/v1/mtm/analytics/export (M2-3)
 *
 * Generates an Excel (.xlsx) workbook with two sheets:
 *   1. "KPI Overview" — route-execution KPI metrics for the requested period
 *   2. "Agent Breakdown" — per-agent table (visits, plan %, avg time)
 *
 * Query params:
 *   period: weekly | monthly | yearly  (default: monthly)
 */
import { NextResponse } from "next/server"
import ExcelJS from "exceljs"
import { prisma } from "@/lib/prisma"
import { withRouteFieldWebRlsAuth } from "@/lib/with-mtm-rls-auth"
import { buildAgentKpis, type AgentVisitRow, type AgentRouteRow } from "@/lib/mtm-analytics"
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
  const rawPeriod = searchParams.get("period") ?? ""
  const period = new Set(["weekly", "monthly", "yearly"]).has(rawPeriod) ? rawPeriod : "monthly"

  try {
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
    const routeWhere = { organizationId: orgId, date: { gte: startDate }, deletedAt: null, ...agentScope }

    const [
      totalVisits,
      agentVisitStats,
      agentRouteStats,
      routeAggregate,
      routesWithTime,
      visitDurationAgg,
    ] = await Promise.all([
      prisma.mtmVisit.count({ where: { ...where, deletedAt: null } }),
      prisma.mtmVisit.groupBy({
        by: ["agentId"],
        where: { ...where, deletedAt: null },
        _count: true,
        _avg: { duration: true },
        orderBy: { _count: { agentId: "desc" } },
        take: 50,
      }),
      prisma.mtmRoute.groupBy({
        by: ["agentId"],
        where: { ...routeWhere, totalPoints: { gt: 0 } },
        _sum: { totalPoints: true, visitedPoints: true },
      }),
      prisma.mtmRoute.aggregate({
        where: { ...routeWhere, totalPoints: { gt: 0 } },
        _sum: { totalPoints: true, visitedPoints: true },
      }),
      prisma.mtmRoute.findMany({
        where: { ...routeWhere, startedAt: { not: null }, completedAt: { not: null } },
        select: { startedAt: true, completedAt: true },
      }),
      prisma.mtmVisit.aggregate({
        where: { ...where, deletedAt: null, duration: { not: null } },
        _avg: { duration: true },
      }),
    ])

    const agentIds = (agentVisitStats as AgentVisitRow[]).map((a) => a.agentId)
    const agents = await prisma.mtmAgent.findMany({
      where: { organizationId: orgId, id: { in: agentIds } },
      select: { id: true, name: true },
    })
    const agentMap = Object.fromEntries(
      agents.map((a: { id: string; name: string }) => [a.id, a.name])
    )

    // Compute org-level KPIs
    const tp = routeAggregate._sum.totalPoints ?? 0
    const vp = routeAggregate._sum.visitedPoints ?? 0
    const visitPlanFulfillment  = tp > 0 ? Math.round((vp / tp) * 100) : 0
    const routeMinutes = (routesWithTime as Array<{ startedAt: Date | null; completedAt: Date | null }>)
      .filter((r) => r.startedAt && r.completedAt)
      .map((r) => (r.completedAt!.getTime() - r.startedAt!.getTime()) / 60_000)
    const avgTimeOnRoute = routeMinutes.length > 0
      ? Math.round(routeMinutes.reduce((s, m) => s + m, 0) / routeMinutes.length) : 0
    const avgTimeInStore = visitDurationAgg._avg.duration != null
      ? Math.round(visitDurationAgg._avg.duration) : 0

    // Build per-agent rows. buildAgentKpis() returns AgentKpiRow[] which
    // includes an agentId field not declared in sheet2.columns — ExcelJS
    // silently ignores unmapped keys, so no Excel regression.
    const agentRows = buildAgentKpis(
      agentVisitStats as AgentVisitRow[],
      agentRouteStats as AgentRouteRow[],
      agentMap,
    )

    // Build workbook
    const wb = new ExcelJS.Workbook()
    wb.creator  = "LeadDrive MTM"
    wb.created  = now
    wb.modified = now

    // ── Sheet 1: KPI Overview ─────────────────────────────────────────────
    const sheet1 = wb.addWorksheet("KPI Overview")
    sheet1.columns = [
      { header: "Metric",    key: "metric",  width: 38 },
      { header: "Value",     key: "value",   width: 14 },
      { header: "Unit",      key: "unit",    width: 12 },
    ]
    sheet1.getRow(1).font = { bold: true }

    sheet1.addRows([
      { metric: "Visit Plan Fulfillment",    value: visitPlanFulfillment,  unit: "%" },
      { metric: "Avg Time on Route",         value: avgTimeOnRoute,        unit: "min" },
      { metric: "Avg Time in Store",         value: avgTimeInStore,        unit: "min" },
      { metric: "Total Visits",              value: totalVisits,           unit: "" },
    ])

    // ── Sheet 2: Agent Breakdown ──────────────────────────────────────────
    const sheet2 = wb.addWorksheet("Agent Breakdown")
    sheet2.columns = [
      { header: "Agent",                key: "name",                 width: 28 },
      { header: "Total Visits",         key: "totalVisits",          width: 14 },
      { header: "Plan Fulfillment %",   key: "visitPlanFulfillment", width: 20 },
      { header: "Avg Time in Store (min)", key: "avgTimeInStore",    width: 22 },
    ]
    sheet2.getRow(1).font = { bold: true }
    sheet2.addRows(agentRows)

    // Zebra-stripe agent rows
    sheet2.eachRow((row, rowNumber) => {
      if (rowNumber > 1 && rowNumber % 2 === 0) {
        row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF5F5F5" } }
      }
    })

    const buf = await wb.xlsx.writeBuffer()
    const periodLabel = period.charAt(0).toUpperCase() + period.slice(1)
    const filename = `mtm-analytics-${periodLabel}-${now.toISOString().slice(0, 10)}.xlsx`

    return new NextResponse(buf as unknown as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
        "X-MTM-Scope": scopedAgentIds === null ? "tenant-admin" : "current-primary-owner",
      },
    })
  } catch (e: unknown) {
    console.error("[mtm/analytics/export]", e)
    return NextResponse.json({ error: "Export failed" }, { status: 500 })
  }
})
