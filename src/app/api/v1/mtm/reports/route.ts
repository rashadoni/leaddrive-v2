import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { withRouteFieldWebRlsAuth } from "@/lib/with-mtm-rls-auth"
import { getMtmSettings } from "@/lib/mtm-settings"
import { currentDateKey } from "@/lib/mtm/mobile-week"
import { isValidTimezone } from "@/lib/timezone"
import { mtmFieldScopeRequiredResponse, resolveMtmFieldScope } from "@/lib/mtm/field-access"
import { reportDailySeries, resolveReportRange, type ReportRange } from "@/lib/mtm/report-period"
import { readReportFilters, reportAgentIds } from "@/lib/mtm/report-filters"
import { buildXlsxWorkbook, contentDispositionAttachment } from "@/lib/export/tabular"
import { protectMtmExcelText } from "@/lib/mtm/excel-contract"
import { reportExportSheets } from "@/lib/mtm/report-export"

type ReportAgentRow = Prisma.MtmAgentGetPayload<{ select: { id: true; name: true; role: true } }>

const PAGE_SIZE = 50
const MAX_LIMIT = 100

/** Daily counts over the whole range, organization-local, with the empty days as 0. */
function dailySeries(dates: Date[], range: ReportRange, timezone: string): { date: string; count: number }[] {
  return reportDailySeries(dates.map((at) => ({ at })), range, timezone)
}

/** One sheet can hold what a manager exports; past this the export is cut and says so in its name. */
const EXPORT_LIMIT = 5000

const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : 0)

function countsByAgent(groups: ReadonlyArray<{ agentId: string | null; _count?: unknown }>): Map<string, number> {
  const counts = new Map<string, number>()
  for (const group of groups) {
    const all = (group._count as { _all?: number } | undefined)?._all
    if (group.agentId && typeof all === "number") counts.set(group.agentId, all)
  }
  return counts
}

export const GET = withRouteFieldWebRlsAuth("read", async (req, auth) => {
  const { orgId } = auth
  // Reports follow the caller's field scope: a manager's numbers are their
  // agents' numbers. Before, every report type was company-wide.
  const scope = await resolveMtmFieldScope(prisma, {
    organizationId: orgId,
    userId: auth.userId,
    webRole: auth.role,
  })
  if (scope.kind === "none") return mtmFieldScopeRequiredResponse()

  const { searchParams } = new URL(req.url)
  const type = searchParams.get("type") || "" // agent, route, visit, photo
  const period = searchParams.get("period") || "week"
  const exporting = searchParams.get("format") === "xlsx"
  const page = exporting ? 1 : Math.max(1, parseInt(searchParams.get("page") || "1"))
  const limit = exporting ? EXPORT_LIMIT : Math.min(MAX_LIMIT, Math.max(1, parseInt(searchParams.get("limit") || String(PAGE_SIZE))))

  try {
    const now = new Date()
    const settings = await getMtmSettings(orgId)
    const timezone = isValidTimezone(settings.timezone) ? settings.timezone : "UTC"
    const todayKey = currentDateKey(now, timezone)
    const range = resolveReportRange(searchParams, todayKey, timezone)
    if ("error" in range) return NextResponse.json({ success: false, error: range.error }, { status: 400 })
    const window = { gte: range.start, lt: range.end }
    // The field scope, cut by «Komanda / Rayon / Agent».
    const agentIdsInReport = await reportAgentIds(orgId, scope.kind === "agents" ? scope.agentIds : null, readReportFilters(searchParams))
    const agentScope = agentIdsInReport === null ? {} : { agentId: { in: agentIdsInReport } }
    const where = { organizationId: orgId, createdAt: window, ...agentScope }
    // A visit belongs to the day it happened (check-in), not to the day the
    // phone managed to send it: an offline visit synced at night is still
    // the morning's.
    const visitWhere = { organizationId: orgId, checkInAt: window, ...agentScope }
    // The agent report is about field agents: managers and supervisors have
    // cards too, but they are not the people whose visits are being compared.
    const agentWhere: Prisma.MtmAgentWhereInput = {
      organizationId: orgId,
      status: "ACTIVE",
      role: "AGENT",
      ...(agentIdsInReport === null ? {} : { id: { in: agentIdsInReport } }),
    }

    // Overview counts for the 4 report-type cards.
    const [agentCount, routeCount, visitCount, photoCount] = await Promise.all([
      prisma.mtmAgent.count({ where: agentWhere }),
      prisma.mtmRoute.count({ where: { ...where, deletedAt: null } }),
      prisma.mtmVisit.count({ where: { ...visitWhere, deletedAt: null } }),
      prisma.mtmPhoto.count({ where }),
    ])
    const counts = { agent: agentCount, route: routeCount, visit: visitCount, photo: photoCount }

    let summary: { labelKey: string; value: number | string; kind: string }[] | null = null
    let series: { date: string; count: number }[] | null = null
    let rows: any[] | null = null
    let total = 0

    if (type === "agent") {
      // Every field agent in scope, and the table is a page of them. The
      // tiles and the chart describe all of them: before, the average summed
      // the visits of the page and divided by everyone, so past 50 agents the
      // tile and the table no longer agreed.
      const everyone: ReportAgentRow[] = await prisma.mtmAgent.findMany({
        where: agentWhere,
        select: { id: true, name: true, role: true },
        orderBy: { name: "asc" },
      })
      total = everyone.length
      const agents = everyone.slice((page - 1) * limit, page * limit)
      const agentIds = everyone.map((agent) => agent.id)
      // One grouped query per metric instead of three per agent.
      // Photos count what was uploaded in the period whatever its review
      // status (a pending photo is still work done — the old APPROVED-only
      // filter showed 0 for an agent with four fresh photos), and tasks count
      // what was completed in the period by completedAt, not by when the task
      // happened to be created.
      const [visitGroups, taskGroups, photoGroups] = await Promise.all([
        prisma.mtmVisit.groupBy({
          by: ["agentId"],
          where: { ...visitWhere, deletedAt: null, agentId: { in: agentIds } },
          _count: { _all: true },
        }),
        prisma.mtmTask.groupBy({
          by: ["agentId"],
          where: {
            organizationId: orgId,
            agentId: { in: agentIds },
            status: "COMPLETED",
            deletedAt: null,
            completedAt: window,
          },
          _count: { _all: true },
        }),
        prisma.mtmPhoto.groupBy({
          by: ["agentId"],
          where: { organizationId: orgId, agentId: { in: agentIds }, createdAt: window },
          _count: { _all: true },
        }),
      ])
      const visitsByAgent = countsByAgent(visitGroups)
      const tasksByAgent = countsByAgent(taskGroups)
      const photosByAgent = countsByAgent(photoGroups)
      rows = agents.map((a) => ({
        id: a.id,
        name: a.name,
        role: a.role,
        visits: visitsByAgent.get(a.id) ?? 0,
        tasks: tasksByAgent.get(a.id) ?? 0,
        photos: photosByAgent.get(a.id) ?? 0,
      }))
      const visitsOf = (agent: ReportAgentRow) => visitsByAgent.get(agent.id) ?? 0
      const top = [...everyone].sort((x, y) => visitsOf(y) - visitsOf(x))[0]
      const totalVisits = everyone.reduce((s, agent) => s + visitsOf(agent), 0)
      summary = [
        { labelKey: "sum.activeAgents", value: everyone.length, kind: "number" },
        { labelKey: "sum.avgPerAgent", value: everyone.length ? Math.round((totalVisits / everyone.length) * 10) / 10 : 0, kind: "number" },
        { labelKey: "sum.topPerformer", value: top && visitsOf(top) > 0 ? top.name : "—", kind: "text" },
      ]
      // The same people as the table: a deactivated agent's visits are not
      // in any row, so they are not in the chart either.
      const vd = await prisma.mtmVisit.findMany({
        where: { ...visitWhere, deletedAt: null, agentId: { in: agentIds } },
        select: { checkInAt: true },
      })
      series = dailySeries(vd.map((v: any) => v.checkInAt), range, timezone)

    } else if (type === "visit") {
      const [byStatus, agg, dates, pageRows] = await Promise.all([
        prisma.mtmVisit.groupBy({ by: ["status"], where: { ...visitWhere, deletedAt: null }, _count: { _all: true } }),
        prisma.mtmVisit.aggregate({ where: { ...visitWhere, deletedAt: null, status: "CHECKED_OUT" }, _avg: { duration: true } }),
        prisma.mtmVisit.findMany({ where: { ...visitWhere, deletedAt: null }, select: { checkInAt: true, agentId: true } }),
        prisma.mtmVisit.findMany({
          where: { ...visitWhere, deletedAt: null }, orderBy: { checkInAt: "desc" },
          skip: (page - 1) * limit, take: limit,
          include: { agent: { select: { name: true } }, customer: { select: { name: true } } },
        }),
      ])
      total = byStatus.reduce((s: number, g: any) => s + g._count._all, 0)
      const completed = byStatus.find((g: any) => g.status === "CHECKED_OUT")?._count._all || 0
      // «Bitib» is of the visits that were not cancelled: a cancelled one was
      // never going to be finished, and counting it made the share look worse.
      const cancelled = byStatus.find((g: any) => g.status === "CANCELLED")?._count._all || 0
      const uniqueAgents = new Set(dates.map((d: any) => d.agentId).filter(Boolean)).size
      summary = [
        { labelKey: "sum.total", value: total, kind: "number" },
        { labelKey: "sum.completed", value: completed, kind: "number" },
        { labelKey: "sum.completionRate", value: pct(completed, total - cancelled), kind: "percent" },
        { labelKey: "sum.avgDuration", value: Math.round(agg._avg.duration || 0), kind: "minutes" },
        { labelKey: "sum.uniqueAgents", value: uniqueAgents, kind: "number" },
      ]
      series = dailySeries(dates.map((d: any) => d.checkInAt), range, timezone)
      rows = pageRows.map((v: any) => ({
        id: v.id, date: v.checkInAt, agent: v.agent?.name || "—", customer: v.customer?.name || "—",
        status: v.status, duration: v.duration ?? null,
      }))

    } else if (type === "route") {
      const [byStatus, stops, dates, completedRoutes, pageRows] = await Promise.all([
        prisma.mtmRoute.groupBy({ by: ["status"], where: { ...where, deletedAt: null }, _count: { _all: true } }),
        // Audit 2026-09-26: «Завершённость 100%» counted routes marked
        // «Завершён», including one closed at 3 of 5 stops. Execution is stops.
        prisma.mtmRoute.aggregate({
          where: { ...where, deletedAt: null, status: { notIn: ["DRAFT", "CANCELLED"] } },
          _sum: { totalPoints: true, visitedPoints: true },
        }),
        prisma.mtmRoute.findMany({ where: { ...where, deletedAt: null }, select: { createdAt: true } }),
        prisma.mtmRoute.findMany({ where: { ...where, deletedAt: null, status: "COMPLETED", startedAt: { not: null }, completedAt: { not: null } }, select: { startedAt: true, completedAt: true } }),
        prisma.mtmRoute.findMany({
          where: { ...where, deletedAt: null }, orderBy: { createdAt: "desc" },
          skip: (page - 1) * limit, take: limit,
          include: { agent: { select: { name: true } } },
        }),
      ])
      total = byStatus.reduce((s: number, g: any) => s + g._count._all, 0)
      const completed = byStatus.find((g: any) => g.status === "COMPLETED")?._count._all || 0
      const plannedStops = stops._sum?.totalPoints ?? 0
      const visitedStops = stops._sum?.visitedPoints ?? 0
      const avgMin = completedRoutes.length
        ? Math.round(completedRoutes.reduce((s: number, r: any) => s + ((r.completedAt!.getTime() - r.startedAt!.getTime()) / 60000), 0) / completedRoutes.length)
        : 0
      summary = [
        { labelKey: "sum.total", value: total, kind: "number" },
        { labelKey: "sum.completed", value: completed, kind: "number" },
        { labelKey: "sum.completedStops", value: `${visitedStops} / ${plannedStops}`, kind: "text" },
        { labelKey: "sum.compliance", value: pct(visitedStops, plannedStops), kind: "percent" },
        { labelKey: "sum.avgDuration", value: avgMin, kind: "minutes" },
      ]
      series = dailySeries(dates.map((d: any) => d.createdAt), range, timezone)
      rows = pageRows.map((r: any) => ({
        id: r.id, date: r.createdAt, agent: r.agent?.name || "—", status: r.status,
        // Visited of planned: «5» said nothing about a route closed at 3.
        points: `${r.visitedPoints ?? 0}/${r.totalPoints ?? 0}`,
        duration: r.startedAt && r.completedAt ? Math.round((new Date(r.completedAt).getTime() - new Date(r.startedAt).getTime()) / 60000) : null,
      }))

    } else if (type === "photo") {
      const [byStatus, dates, pageRows] = await Promise.all([
        prisma.mtmPhoto.groupBy({ by: ["status"], where, _count: { _all: true } }),
        prisma.mtmPhoto.findMany({ where, select: { createdAt: true } }),
        prisma.mtmPhoto.findMany({
          where, orderBy: { createdAt: "desc" }, skip: (page - 1) * limit, take: limit,
          include: { agent: { select: { name: true } }, visit: { select: { customer: { select: { name: true } } } } },
        }),
      ])
      total = byStatus.reduce((s: number, g: any) => s + g._count._all, 0)
      const approved = byStatus.find((g: any) => g.status === "APPROVED")?._count._all || 0
      const pending = byStatus.find((g: any) => g.status === "PENDING")?._count._all || 0
      summary = [
        { labelKey: "sum.total", value: total, kind: "number" },
        { labelKey: "sum.approved", value: approved, kind: "number" },
        { labelKey: "sum.approvalRate", value: pct(approved, total), kind: "percent" },
        { labelKey: "sum.pending", value: pending, kind: "number" },
      ]
      series = dailySeries(dates.map((d: any) => d.createdAt), range, timezone)
      rows = pageRows.map((p: any) => ({
        id: p.id, date: p.createdAt, agent: p.agent?.name || "—", customer: p.visit?.customer?.name || "—", status: p.status,
      }))
    }

    if (exporting && summary && rows) {
      const workbook = buildXlsxWorkbook(await reportExportSheets(type, summary, rows, searchParams.get("lang"), protectMtmExcelText))
      const buffer = Buffer.from(await workbook.xlsx.writeBuffer())
      return new NextResponse(buffer as unknown as BodyInit, { headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": contentDispositionAttachment(`mtm-${type}-${range.fromKey}-${range.toKey}.xlsx`),
        "Cache-Control": "no-store",
      } })
    }

    return NextResponse.json({
      success: true,
      data: { counts, summary, series, reportData: rows, total, page, limit, period: range.preset === "custom" ? period : range.preset, from: range.fromKey, to: range.toKey, type },
    })
  } catch (e: any) {
    console.error("[MTM/reports GET]", e)
    return NextResponse.json({ error: "Failed to fetch reports" }, { status: 500 })
  }
})
