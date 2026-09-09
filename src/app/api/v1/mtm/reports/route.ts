import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { withRouteFieldWebRlsAuth } from "@/lib/with-mtm-rls-auth"

type ReportAgentRow = Prisma.MtmAgentGetPayload<{ select: { id: true; name: true; role: true } }>

const PAGE_SIZE = 50
const MAX_LIMIT = 100

/** Local-midnight start for the period. */
function periodStart(period: string, now: Date): Date {
  if (period === "today") return new Date(now.getFullYear(), now.getMonth(), now.getDate())
  if (period === "month") return new Date(now.getFullYear(), now.getMonth(), 1)
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  d.setDate(d.getDate() - 6) // week = last 7 days incl today
  return d
}

const dayKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`

/** Bucket a list of dates into continuous daily counts from start..now (fills 0s). */
function dailySeries(dates: Date[], start: Date, now: Date): { date: string; count: number }[] {
  const counts = new Map<string, number>()
  for (const d of dates) counts.set(dayKey(d), (counts.get(dayKey(d)) || 0) + 1)
  const out: { date: string; count: number }[] = []
  const cur = new Date(start)
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  let guard = 0
  while (cur <= end && guard++ < 400) {
    out.push({ date: dayKey(cur), count: counts.get(dayKey(cur)) || 0 })
    cur.setDate(cur.getDate() + 1)
  }
  return out
}

const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : 0)

export const GET = withRouteFieldWebRlsAuth("read", async (req, { orgId }) => {

  const { searchParams } = new URL(req.url)
  const type = searchParams.get("type") || "" // agent, route, visit, photo
  const period = searchParams.get("period") || "week"
  const page = Math.max(1, parseInt(searchParams.get("page") || "1"))
  const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(searchParams.get("limit") || String(PAGE_SIZE))))

  try {
    const now = new Date()
    const startDate = periodStart(period, now)
    const where = { organizationId: orgId, createdAt: { gte: startDate } }

    // Overview counts for the 4 report-type cards.
    const [agentCount, routeCount, visitCount, photoCount] = await Promise.all([
      prisma.mtmAgent.count({ where: { organizationId: orgId, status: "ACTIVE" } }),
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
      const agents = await prisma.mtmAgent.findMany({
        where: { organizationId: orgId, status: "ACTIVE" },
        select: { id: true, name: true, role: true },
        orderBy: { name: "asc" },
        skip: (page - 1) * limit,
        take: limit,
      })
      rows = await Promise.all(
        agents.map(async (a: ReportAgentRow) => {
          const [visits, tasks, photos] = await Promise.all([
            prisma.mtmVisit.count({ where: { ...where, agentId: a.id, deletedAt: null } }),
            prisma.mtmTask.count({ where: { ...where, agentId: a.id, status: "COMPLETED", deletedAt: null } }),
            prisma.mtmPhoto.count({ where: { ...where, agentId: a.id, status: "APPROVED" } }),
          ])
          return { id: a.id, name: a.name, role: a.role, visits, tasks, photos }
        }),
      )
      const top = [...rows].sort((x, y) => y.visits - x.visits)[0]
      const totalVisits = rows.reduce((s, r) => s + r.visits, 0)
      summary = [
        { labelKey: "sum.activeAgents", value: agentCount, kind: "number" },
        { labelKey: "sum.avgPerAgent", value: agentCount ? Math.round((totalVisits / agentCount) * 10) / 10 : 0, kind: "number" },
        { labelKey: "sum.topPerformer", value: top?.name || "—", kind: "text" },
      ]
      const vd = await prisma.mtmVisit.findMany({ where: { ...where, deletedAt: null }, select: { createdAt: true } })
      series = dailySeries(vd.map((v: any) => v.createdAt), startDate, now)

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
      series = dailySeries(dates.map((d: any) => d.createdAt), startDate, now)
      rows = pageRows.map((v: any) => ({
        id: v.id, date: v.createdAt, agent: v.agent?.name || "—", customer: v.customer?.name || "—",
        status: v.status, duration: v.duration ?? null,
      }))

    } else if (type === "route") {
      const [byStatus, dates, completedRoutes, pageRows] = await Promise.all([
        prisma.mtmRoute.groupBy({ by: ["status"], where: { ...where, deletedAt: null }, _count: { _all: true } }),
        prisma.mtmRoute.findMany({ where: { ...where, deletedAt: null }, select: { createdAt: true } }),
        prisma.mtmRoute.findMany({ where: { ...where, deletedAt: null, status: "COMPLETED", startedAt: { not: null }, completedAt: { not: null } }, select: { startedAt: true, completedAt: true } }),
        prisma.mtmRoute.findMany({
          where: { ...where, deletedAt: null }, orderBy: { createdAt: "desc" },
          skip: (page - 1) * limit, take: limit,
          include: { agent: { select: { name: true } }, _count: { select: { points: true } } },
        }),
      ])
      total = byStatus.reduce((s: number, g: any) => s + g._count._all, 0)
      const completed = byStatus.find((g: any) => g.status === "COMPLETED")?._count._all || 0
      const avgMin = completedRoutes.length
        ? Math.round(completedRoutes.reduce((s: number, r: any) => s + ((r.completedAt!.getTime() - r.startedAt!.getTime()) / 60000), 0) / completedRoutes.length)
        : 0
      summary = [
        { labelKey: "sum.total", value: total, kind: "number" },
        { labelKey: "sum.completed", value: completed, kind: "number" },
        { labelKey: "sum.completionRate", value: pct(completed, total), kind: "percent" },
        { labelKey: "sum.avgDuration", value: avgMin, kind: "minutes" },
      ]
      series = dailySeries(dates.map((d: any) => d.createdAt), startDate, now)
      rows = pageRows.map((r: any) => ({
        id: r.id, date: r.createdAt, agent: r.agent?.name || "—", status: r.status,
        points: r._count?.points ?? 0,
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
      series = dailySeries(dates.map((d: any) => d.createdAt), startDate, now)
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
