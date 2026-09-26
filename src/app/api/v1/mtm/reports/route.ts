import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { withRouteFieldWebRlsAuth } from "@/lib/with-mtm-rls-auth"
import { getMtmSettings } from "@/lib/mtm-settings"
import { addDateKeyDays, currentDateKey, localDateKeyToUtc } from "@/lib/mtm/mobile-week"
import { dateInputValueInTimezone, isValidTimezone } from "@/lib/timezone"
import { fieldScopeAgentIdWhere, mtmFieldScopeRequiredResponse, resolveMtmFieldScope } from "@/lib/mtm/field-access"

type ReportAgentRow = Prisma.MtmAgentGetPayload<{ select: { id: true; name: true; role: true } }>

const PAGE_SIZE = 50
const MAX_LIMIT = 100

/**
 * First day of the period as an organization-local date key — the same
 * arithmetic the MTM dashboard uses. The previous version took the server's
 * local midnight, so on a UTC server "today" in Baku started four hours late
 * and an early-morning visit fell into yesterday.
 */
function periodStartKey(period: string, todayKey: string): string {
  if (period === "today") return todayKey
  if (period === "month") return `${todayKey.slice(0, 7)}-01`
  return addDateKeyDays(todayKey, -6) // week = last 7 days incl today
}

/** Bucket timestamps into continuous organization-local daily counts (fills 0s). */
function dailySeries(dates: Date[], startKey: string, todayKey: string, timezone: string): { date: string; count: number }[] {
  const counts = new Map<string, number>()
  for (const d of dates) {
    const key = dateInputValueInTimezone(d, timezone)
    counts.set(key, (counts.get(key) || 0) + 1)
  }
  const out: { date: string; count: number }[] = []
  let key = startKey
  let guard = 0
  while (key <= todayKey && guard++ < 400) {
    out.push({ date: key, count: counts.get(key) || 0 })
    key = addDateKeyDays(key, 1)
  }
  return out
}

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
  const page = Math.max(1, parseInt(searchParams.get("page") || "1"))
  const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(searchParams.get("limit") || String(PAGE_SIZE))))

  try {
    const now = new Date()
    const settings = await getMtmSettings(orgId)
    const timezone = isValidTimezone(settings.timezone) ? settings.timezone : "UTC"
    const todayKey = currentDateKey(now, timezone)
    const startKey = periodStartKey(period, todayKey)
    const startDate = localDateKeyToUtc(startKey, timezone)
    const agentScope = fieldScopeAgentIdWhere(scope)
    const where = { organizationId: orgId, createdAt: { gte: startDate }, ...agentScope }
    // The agent report is about field agents: managers and supervisors have
    // cards too, but they are not the people whose visits are being compared.
    const agentWhere: Prisma.MtmAgentWhereInput = {
      organizationId: orgId,
      status: "ACTIVE",
      role: "AGENT",
      ...(scope.kind === "agents" ? { id: { in: scope.agentIds } } : {}),
    }

    // Overview counts for the 4 report-type cards.
    const [agentCount, routeCount, visitCount, photoCount] = await Promise.all([
      prisma.mtmAgent.count({ where: agentWhere }),
      prisma.mtmRoute.count({ where: { ...where, deletedAt: null } }),
      prisma.mtmVisit.count({ where: { ...where, deletedAt: null } }),
      prisma.mtmPhoto.count({ where }),
    ])
    const counts = { agent: agentCount, route: routeCount, visit: visitCount, photo: photoCount }

    let summary: { labelKey: string; value: number | string; kind: string }[] | null = null
    let series: { date: string; count: number }[] | null = null
    let rows: any[] | null = null
    let total = 0

    if (type === "agent") {
      total = agentCount
      const agents: ReportAgentRow[] = await prisma.mtmAgent.findMany({
        where: agentWhere,
        select: { id: true, name: true, role: true },
        orderBy: { name: "asc" },
        skip: (page - 1) * limit,
        take: limit,
      })
      const agentIds = agents.map((agent) => agent.id)
      // One grouped query per metric for the page instead of three per agent.
      // Photos count what was uploaded in the period whatever its review
      // status (a pending photo is still work done — the old APPROVED-only
      // filter showed 0 for an agent with four fresh photos), and tasks count
      // what was completed in the period by completedAt, not by when the task
      // happened to be created.
      const [visitGroups, taskGroups, photoGroups] = await Promise.all([
        prisma.mtmVisit.groupBy({
          by: ["agentId"],
          where: { ...where, deletedAt: null, agentId: { in: agentIds } },
          _count: { _all: true },
        }),
        prisma.mtmTask.groupBy({
          by: ["agentId"],
          where: {
            organizationId: orgId,
            agentId: { in: agentIds },
            status: "COMPLETED",
            deletedAt: null,
            completedAt: { gte: startDate },
          },
          _count: { _all: true },
        }),
        prisma.mtmPhoto.groupBy({
          by: ["agentId"],
          where: { organizationId: orgId, agentId: { in: agentIds }, createdAt: { gte: startDate } },
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
      const top = [...rows].sort((x, y) => y.visits - x.visits)[0]
      const totalVisits = rows.reduce((s, r) => s + r.visits, 0)
      summary = [
        { labelKey: "sum.activeAgents", value: agentCount, kind: "number" },
        { labelKey: "sum.avgPerAgent", value: agentCount ? Math.round((totalVisits / agentCount) * 10) / 10 : 0, kind: "number" },
        { labelKey: "sum.topPerformer", value: top?.name || "—", kind: "text" },
      ]
      const vd = await prisma.mtmVisit.findMany({
        where: { ...where, deletedAt: null, agent: { role: "AGENT" } },
        select: { createdAt: true },
      })
      series = dailySeries(vd.map((v: any) => v.createdAt), startKey, todayKey, timezone)

    } else if (type === "visit") {
      const [byStatus, agg, dates, pageRows] = await Promise.all([
        prisma.mtmVisit.groupBy({ by: ["status"], where: { ...where, deletedAt: null }, _count: { _all: true } }),
        prisma.mtmVisit.aggregate({ where: { ...where, deletedAt: null }, _avg: { duration: true } }),
        prisma.mtmVisit.findMany({ where: { ...where, deletedAt: null }, select: { createdAt: true, agentId: true } }),
        prisma.mtmVisit.findMany({
          where: { ...where, deletedAt: null }, orderBy: { createdAt: "desc" },
          skip: (page - 1) * limit, take: limit,
          include: { agent: { select: { name: true } }, customer: { select: { name: true } } },
        }),
      ])
      total = byStatus.reduce((s: number, g: any) => s + g._count._all, 0)
      const completed = byStatus.find((g: any) => g.status === "CHECKED_OUT")?._count._all || 0
      const uniqueAgents = new Set(dates.map((d: any) => d.agentId).filter(Boolean)).size
      summary = [
        { labelKey: "sum.total", value: total, kind: "number" },
        { labelKey: "sum.completed", value: completed, kind: "number" },
        { labelKey: "sum.completionRate", value: pct(completed, total), kind: "percent" },
        { labelKey: "sum.avgDuration", value: Math.round(agg._avg.duration || 0), kind: "minutes" },
        { labelKey: "sum.uniqueAgents", value: uniqueAgents, kind: "number" },
      ]
      series = dailySeries(dates.map((d: any) => d.createdAt), startKey, todayKey, timezone)
      rows = pageRows.map((v: any) => ({
        id: v.id, date: v.createdAt, agent: v.agent?.name || "—", customer: v.customer?.name || "—",
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
      series = dailySeries(dates.map((d: any) => d.createdAt), startKey, todayKey, timezone)
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
      series = dailySeries(dates.map((d: any) => d.createdAt), startKey, todayKey, timezone)
      rows = pageRows.map((p: any) => ({
        id: p.id, date: p.createdAt, agent: p.agent?.name || "—", customer: p.visit?.customer?.name || "—", status: p.status,
      }))
    }

    return NextResponse.json({
      success: true,
      data: { counts, summary, series, reportData: rows, total, page, limit, period, type },
    })
  } catch (e: any) {
    console.error("[MTM/reports GET]", e)
    return NextResponse.json({ error: "Failed to fetch reports" }, { status: 500 })
  }
})
