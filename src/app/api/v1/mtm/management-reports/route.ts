import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRouteFieldWebRlsAuth } from "@/lib/with-mtm-rls-auth"
import { resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import { buildXlsxWorkbook, contentDispositionAttachment } from "@/lib/export/tabular"
import { protectMtmExcelText } from "@/lib/mtm/excel-contract"
import { getMtmSettings } from "@/lib/mtm-settings"
import { currentDateKey } from "@/lib/mtm/mobile-week"
import { isValidTimezone } from "@/lib/timezone"
import { planShareInRange, reportDailySeries, resolveReportRange } from "@/lib/mtm/report-period"
import { readReportFilters, reportAgentIds } from "@/lib/mtm/report-filters"
import { reportExportSheets } from "@/lib/mtm/report-export"

const TYPES = ["route_execution", "action_compliance", "promises", "sales"] as const
type ManagementReportType = typeof TYPES[number]

interface RouteSource {
  id: string
  date: Date
  totalPoints: number
  visitedPoints: number
  status: string
  agent: { name: string; team: { name: string; region: { name: string } | null } | null }
}

interface RequirementSource {
  actionKey: string
  minCount: number
  actionResults: Array<{ status: string }>
  snapshot: { visit: { checkInAt: Date; agent: { team: { name: string } | null } } }
}

interface PromiseSource {
  id: string
  customerId: string
  checkInAt: Date
  nextActionDueAt: Date | null
  outcome: string | null
  resultNotes: string | null
  notes: string | null
  agent: { name: string }
  customer: { name: string }
}

interface SalesDocumentSource {
  customerId: string
  agentId: string | null
  documentDate: Date
  totalAmount: unknown
  customer: { name: string; territoryCode: string | null }
  agent: { name: string } | null
  lines: Array<{ amount: unknown; quantity: unknown }>
}

interface SalesPlanSource {
  customerId: string | null
  agentId: string | null
  territoryCode: string | null
  periodStart: Date
  plannedAmount: unknown
  plannedQuantity: unknown
  customer?: { name: string } | null
  agent?: { name: string } | null
}

/** A promise made before the period and still not kept is shown with the period's: it did not stop being late. */
const OVERDUE_LOOKBACK_DAYS = 90

function pct(value: number, total: number): number {
  return total > 0 ? Math.round(value / total * 100) : 0
}

/** A calendar day stored as a date (`@db.Date`), as the UTC midnight Prisma reads it as. */
function dateOnly(key: string): Date {
  return new Date(`${key}T00:00:00.000Z`)
}

export const GET = withRouteFieldWebRlsAuth("read", async (req, auth) => {
  const actor = await resolveMtmRouteActor(prisma, { organizationId: auth.orgId, userId: auth.userId, webRole: auth.role })
  if (!actor) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  const search = new URL(req.url).searchParams
  const type = search.get("type") as ManagementReportType | null
  const period = search.get("period") ?? "week"
  const format = search.get("format")
  const now = new Date()
  // Audit 2026-11-01: these four reports counted from the server's own
  // midnight (UTC) while the other three used the organization's — in Baku a
  // morning visit fell into yesterday here and into today there.
  const settings = await getMtmSettings(auth.orgId)
  const timezone = isValidTimezone(settings.timezone) ? settings.timezone : "UTC"
  const range = resolveReportRange(search, currentDateKey(now, timezone), timezone)
  if ("error" in range) return NextResponse.json({ success: false, error: range.error }, { status: 400 })
  const window = { gte: range.start, lt: range.end }
  const days = { gte: dateOnly(range.fromKey), lte: dateOnly(range.toKey) }
  const scopedAgentIds = await reportAgentIds(auth.orgId, actor.scopedAgentIds === null ? null : [...actor.scopedAgentIds], readReportFilters(search))
  const agentWhere = scopedAgentIds === null ? {} : { agentId: { in: scopedAgentIds } }
  const routeScope = scopedAgentIds === null ? {} : { OR: [{ agentId: { in: scopedAgentIds } }, { assignments: { some: { agentId: { in: scopedAgentIds }, removedAt: null } } }] }
  const promiseWhere = {
    organizationId: auth.orgId,
    deletedAt: null,
    ...agentWhere,
    OR: [
      { nextActionDueAt: window },
      { nextActionDueAt: { gte: new Date(range.start.getTime() - OVERDUE_LOOKBACK_DAYS * 86_400_000), lt: range.start } },
    ],
  }

  if (!type) {
    const [routes, requirements, promises, sales] = await Promise.all([
      prisma.mtmRoute.count({ where: { organizationId: auth.orgId, date: days, deletedAt: null, ...routeScope } }),
      prisma.mtmVisitRequirement.count({ where: { organizationId: auth.orgId, mode: "REQUIRED", snapshot: { visit: { checkInAt: window, ...agentWhere } } } }),
      prisma.mtmVisit.count({ where: { organizationId: auth.orgId, nextActionDueAt: window, deletedAt: null, ...agentWhere } }),
      prisma.mtmExternalSalesLine.count({ where: { organizationId: auth.orgId, document: { documentDate: days, ...agentWhere } } }),
    ])
    return NextResponse.json({ success: true, data: { counts: { route_execution: routes, action_compliance: requirements, promises, sales } } })
  }
  if (!TYPES.includes(type)) return NextResponse.json({ error: "Unsupported management report" }, { status: 404 })

  let rows: Record<string, unknown>[] = []
  let summary: Array<{ labelKey: string; value: number | string; kind: string }> = []
  let series: Array<{ date: string; count: number }> = []

  if (type === "route_execution") {
    const routes = await prisma.mtmRoute.findMany({
      where: { organizationId: auth.orgId, date: days, deletedAt: null, ...routeScope },
      include: { agent: { include: { team: { include: { region: true } } } } },
      orderBy: { date: "desc" },
    })
    const routeRecords = routes as unknown as RouteSource[]
    rows = routeRecords.map((route) => ({ id: route.id, date: route.date, agent: route.agent.name, team: route.agent.team?.name ?? "", region: route.agent.team?.region?.name ?? "", planned: route.totalPoints, actual: route.visitedPoints, compliance: pct(route.visitedPoints, route.totalPoints), status: route.status }))
    const planned = routeRecords.reduce((sum, route) => sum + route.totalPoints, 0)
    const actual = routeRecords.reduce((sum, route) => sum + route.visitedPoints, 0)
    summary = [{ labelKey: "sum.total", value: routeRecords.length, kind: "number" }, { labelKey: "sum.plannedStops", value: planned, kind: "number" }, { labelKey: "sum.completedStops", value: actual, kind: "number" }, { labelKey: "sum.compliance", value: pct(actual, planned), kind: "percent" }]
    // A route's date is a calendar day already: read in UTC, never shifted.
    series = reportDailySeries(routeRecords.map((route) => ({ at: route.date, value: route.visitedPoints })), range, "UTC")
  } else if (type === "action_compliance") {
    const requirements = await prisma.mtmVisitRequirement.findMany({
      where: { organizationId: auth.orgId, mode: "REQUIRED", snapshot: { visit: { checkInAt: window, ...agentWhere } } },
      include: { actionResults: true, snapshot: { include: { visit: { include: { agent: { include: { team: true } } } } } } },
    })
    const groups = new Map<string, { team: string; action: string; required: number; compliant: number }>()
    const requirementRecords = requirements as unknown as RequirementSource[]
    const compliantAt: Array<{ at: Date }> = []
    for (const requirement of requirementRecords) {
      const team = requirement.snapshot.visit.agent.team?.name ?? "—"
      const key = `${team}|${requirement.actionKey}`
      const group = groups.get(key) ?? { team, action: requirement.actionKey, required: 0, compliant: 0 }
      group.required += 1
      const completed = requirement.actionResults.filter((result) => result.status === "COMPLETED" || result.status === "WAIVED").length
      if (completed >= requirement.minCount) {
        group.compliant += 1
        compliantAt.push({ at: requirement.snapshot.visit.checkInAt })
      }
      groups.set(key, group)
    }
    rows = [...groups.values()].map((group, index) => ({ id: index, ...group, compliance: pct(group.compliant, group.required) }))
    const compliant = [...groups.values()].reduce((sum, group) => sum + group.compliant, 0)
    summary = [{ labelKey: "sum.requiredActions", value: requirementRecords.length, kind: "number" }, { labelKey: "sum.compliantActions", value: compliant, kind: "number" }, { labelKey: "sum.compliance", value: pct(compliant, requirementRecords.length), kind: "percent" }]
    // Was one point «today» whatever the period: now the done actions day by day.
    series = reportDailySeries(compliantAt, range, timezone)
  } else if (type === "promises") {
    const visits = await prisma.mtmVisit.findMany({
      where: promiseWhere,
      include: { agent: true, customer: true },
      orderBy: { nextActionDueAt: "asc" },
    })
    const promiseRecords = visits as unknown as PromiseSource[]
    // A promise is kept when somebody came back to the client after it was made.
    // Before, nothing was ever «done»: every promise stayed open or overdue.
    const lastVisits = promiseRecords.length > 0 ? await prisma.mtmVisit.groupBy({
      by: ["customerId"],
      where: { organizationId: auth.orgId, deletedAt: null, customerId: { in: [...new Set(promiseRecords.map((visit) => visit.customerId))] } },
      _max: { checkInAt: true },
    }) : []
    const lastVisitOf = new Map((lastVisits as Array<{ customerId: string; _max: { checkInAt: Date | null } }>).map((item) => [item.customerId, item._max.checkInAt]))
    const statusOf = (visit: PromiseSource) => {
      const last = lastVisitOf.get(visit.customerId)
      if (last && last.getTime() > visit.checkInAt.getTime()) return "DONE"
      return visit.nextActionDueAt! < now ? "OVERDUE" : "OPEN"
    }
    // The period's promises, and the earlier ones that are still late.
    const shown = promiseRecords
      .map((visit) => ({ visit, status: statusOf(visit) }))
      .filter(({ visit, status }) => visit.nextActionDueAt! >= range.start || status === "OVERDUE")
    rows = shown.map(({ visit, status }) => ({ id: visit.id, dueAt: visit.nextActionDueAt, agent: visit.agent.name, customer: visit.customer.name, outcome: visit.outcome ?? "", status, notes: visit.resultNotes ?? visit.notes ?? "" }))
    const overdue = shown.filter(({ status }) => status === "OVERDUE").length
    const done = shown.filter(({ status }) => status === "DONE").length
    summary = [
      { labelKey: "sum.openPromises", value: shown.length - done, kind: "number" },
      { labelKey: "sum.keptPromises", value: done, kind: "number" },
      { labelKey: "sum.overduePromises", value: overdue, kind: "number" },
      { labelKey: "sum.overdueRate", value: pct(overdue, shown.length), kind: "percent" },
    ]
    series = reportDailySeries(shown.filter(({ visit }) => visit.nextActionDueAt! >= range.start).map(({ visit }) => ({ at: visit.nextActionDueAt! })), range, timezone)
  } else {
    const [documents, plans] = await Promise.all([
      prisma.mtmExternalSalesDocument.findMany({ where: { organizationId: auth.orgId, documentDate: days, ...agentWhere }, include: { customer: true, agent: true, lines: true } }),
      // A monthly plan that began before the range still covers part of it.
      prisma.mtmSalesPlanLine.findMany({
        where: { organizationId: auth.orgId, periodStart: { gte: dateOnly(`${range.fromKey.slice(0, 7)}-01`), lte: dateOnly(range.toKey) }, ...agentWhere },
        include: { customer: { select: { name: true } }, agent: { select: { name: true } } },
      }),
    ])
    const groups = new Map<string, { customerId: string; customer: string; agentId: string | null; agent: string; territory: string; actualAmount: number; actualQuantity: number; planAmount: number; planQuantity: number }>()
    const salesDocuments = documents as unknown as SalesDocumentSource[]
    const salesPlans = plans as unknown as SalesPlanSource[]
    for (const document of salesDocuments) {
      const key = `${document.customerId}|${document.agentId ?? ""}`
      const group = groups.get(key) ?? { customerId: document.customerId, customer: document.customer.name, agentId: document.agentId, agent: document.agent?.name ?? "", territory: document.customer.territoryCode ?? "", actualAmount: 0, actualQuantity: 0, planAmount: 0, planQuantity: 0 }
      group.actualAmount += document.lines.reduce((sum, line) => sum + Number(line.amount ?? 0), 0)
      group.actualQuantity += document.lines.reduce((sum, line) => sum + Number(line.quantity), 0)
      groups.set(key, group)
    }
    for (const plan of salesPlans) {
      const share = planShareInRange(plan.periodStart, range)
      if (share <= 0) continue
      const key = `${plan.customerId ?? ""}|${plan.agentId ?? ""}`
      const group = groups.get(key) ?? { customerId: plan.customerId ?? "", customer: plan.customer?.name ?? "", agentId: plan.agentId, agent: plan.agent?.name ?? "", territory: plan.territoryCode ?? "", actualAmount: 0, actualQuantity: 0, planAmount: 0, planQuantity: 0 }
      group.planAmount += Number(plan.plannedAmount ?? 0) * share
      group.planQuantity += Number(plan.plannedQuantity ?? 0) * share
      groups.set(key, group)
    }
    const round = (value: number) => Math.round(value * 100) / 100
    rows = [...groups.values()].map((group, index) => ({
      id: index,
      customer: group.customer,
      agent: group.agent,
      territory: group.territory,
      planAmount: round(group.planAmount),
      actualAmount: round(group.actualAmount),
      amountVariance: round(group.actualAmount - group.planAmount),
      attainment: pct(group.actualAmount, group.planAmount),
    }))
    const actual = [...groups.values()].reduce((sum, group) => sum + group.actualAmount, 0)
    const plan = [...groups.values()].reduce((sum, group) => sum + group.planAmount, 0)
    summary = [{ labelKey: "sum.actualSales", value: round(actual), kind: "number" }, { labelKey: "sum.planSales", value: round(plan), kind: "number" }, { labelKey: "sum.attainment", value: pct(actual, plan), kind: "percent" }]
    series = reportDailySeries(salesDocuments.map((document) => ({ at: document.documentDate, value: Number(document.totalAmount ?? 0) })), range, "UTC")
  }

  if (format === "xlsx") {
    const workbook = buildXlsxWorkbook(await reportExportSheets(type, summary, rows, search.get("lang"), protectMtmExcelText))
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer())
    return new NextResponse(buffer as unknown as BodyInit, { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": contentDispositionAttachment(`mtm-${type}-${range.fromKey}-${range.toKey}.xlsx`), "Cache-Control": "no-store" } })
  }

  return NextResponse.json({ success: true, data: { summary, series, reportData: rows, total: rows.length, page: 1, limit: rows.length, period: range.preset === "custom" ? period : range.preset, from: range.fromKey, to: range.toKey, type } })
})
