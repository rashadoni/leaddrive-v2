import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRouteFieldWebRlsAuth } from "@/lib/with-mtm-rls-auth"
import { resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import { buildXlsxWorkbook, contentDispositionAttachment } from "@/lib/export/tabular"
import { protectMtmExcelText } from "@/lib/mtm/excel-contract"

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
  snapshot: { visit: { agent: { team: { name: string } | null } } }
}

interface PromiseSource {
  id: string
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
  plannedAmount: unknown
  plannedQuantity: unknown
}

function periodStart(period: string, now: Date): Date {
  if (period === "today") return new Date(now.getFullYear(), now.getMonth(), now.getDate())
  if (period === "month") return new Date(now.getFullYear(), now.getMonth(), 1)
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  start.setDate(start.getDate() - 6)
  return start
}

function dayKey(value: Date): string {
  return value.toISOString().slice(0, 10)
}

function pct(value: number, total: number): number {
  return total > 0 ? Math.round(value / total * 100) : 0
}

function safeRows(rows: Record<string, unknown>[], columns: string[]): unknown[][] {
  return rows.map((row) => columns.map((column) => protectMtmExcelText(row[column])))
}

export const GET = withRouteFieldWebRlsAuth("read", async (req, auth) => {
  const actor = await resolveMtmRouteActor(prisma, { organizationId: auth.orgId, userId: auth.userId, webRole: auth.role })
  if (!actor) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  const search = new URL(req.url).searchParams
  const type = search.get("type") as ManagementReportType | null
  const period = search.get("period") ?? "week"
  const format = search.get("format")
  const now = new Date()
  const start = periodStart(period, now)
  const scopedAgentIds = actor.scopedAgentIds
  const agentWhere = scopedAgentIds === null ? {} : { agentId: { in: [...scopedAgentIds] } }

  if (!type) {
    const [routes, requirements, promises, sales] = await Promise.all([
      prisma.mtmRoute.count({ where: { organizationId: auth.orgId, date: { gte: start }, deletedAt: null, ...(scopedAgentIds === null ? {} : { OR: [{ agentId: { in: [...scopedAgentIds] } }, { assignments: { some: { agentId: { in: [...scopedAgentIds] }, removedAt: null } } }] }) } }),
      prisma.mtmVisitRequirement.count({ where: { organizationId: auth.orgId, mode: "REQUIRED", snapshot: { visit: { checkInAt: { gte: start }, ...agentWhere } } } }),
      prisma.mtmVisit.count({ where: { organizationId: auth.orgId, nextActionDueAt: { not: null, gte: start }, deletedAt: null, ...agentWhere } }),
      prisma.mtmExternalSalesLine.count({ where: { organizationId: auth.orgId, document: { documentDate: { gte: start }, ...(scopedAgentIds === null ? {} : { agentId: { in: [...scopedAgentIds] } }) } } }),
    ])
    return NextResponse.json({ success: true, data: { counts: { route_execution: routes, action_compliance: requirements, promises, sales } } })
  }
  if (!TYPES.includes(type)) return NextResponse.json({ error: "Unsupported management report" }, { status: 404 })

  let rows: Record<string, unknown>[] = []
  let summary: Array<{ labelKey: string; value: number | string; kind: string }> = []
  let series: Array<{ date: string; count: number }> = []

  if (type === "route_execution") {
    const routes = await prisma.mtmRoute.findMany({
      where: { organizationId: auth.orgId, date: { gte: start }, deletedAt: null, ...(scopedAgentIds === null ? {} : { OR: [{ agentId: { in: [...scopedAgentIds] } }, { assignments: { some: { agentId: { in: [...scopedAgentIds] }, removedAt: null } } }] }) },
      include: { agent: { include: { team: { include: { region: true } } } } },
      orderBy: { date: "desc" },
    })
    const routeRecords = routes as unknown as RouteSource[]
    rows = routeRecords.map((route) => ({ id: route.id, date: route.date, agent: route.agent.name, team: route.agent.team?.name ?? "", region: route.agent.team?.region?.name ?? "", planned: route.totalPoints, actual: route.visitedPoints, compliance: pct(route.visitedPoints, route.totalPoints), status: route.status }))
    const planned = routeRecords.reduce((sum, route) => sum + route.totalPoints, 0)
    const actual = routeRecords.reduce((sum, route) => sum + route.visitedPoints, 0)
    summary = [{ labelKey: "sum.total", value: routeRecords.length, kind: "number" }, { labelKey: "sum.plannedStops", value: planned, kind: "number" }, { labelKey: "sum.completedStops", value: actual, kind: "number" }, { labelKey: "sum.compliance", value: pct(actual, planned), kind: "percent" }]
    const daily = new Map<string, number>()
    routeRecords.forEach((route) => daily.set(dayKey(route.date), (daily.get(dayKey(route.date)) ?? 0) + route.visitedPoints))
    series = [...daily].map(([date, count]) => ({ date, count })).sort((left, right) => left.date.localeCompare(right.date))
  } else if (type === "action_compliance") {
    const requirements = await prisma.mtmVisitRequirement.findMany({
      where: { organizationId: auth.orgId, mode: "REQUIRED", snapshot: { visit: { checkInAt: { gte: start }, ...agentWhere } } },
      include: { actionResults: true, snapshot: { include: { visit: { include: { agent: { include: { team: true } } } } } } },
    })
    const groups = new Map<string, { team: string; action: string; required: number; compliant: number }>()
    const requirementRecords = requirements as unknown as RequirementSource[]
    for (const requirement of requirementRecords) {
      const team = requirement.snapshot.visit.agent.team?.name ?? "—"
      const key = `${team}|${requirement.actionKey}`
      const group = groups.get(key) ?? { team, action: requirement.actionKey, required: 0, compliant: 0 }
      group.required += 1
      const completed = requirement.actionResults.filter((result) => result.status === "COMPLETED" || result.status === "WAIVED").length
      if (completed >= requirement.minCount) group.compliant += 1
      groups.set(key, group)
    }
    rows = [...groups.values()].map((group, index) => ({ id: index, ...group, compliance: pct(group.compliant, group.required) }))
    const compliant = [...groups.values()].reduce((sum, group) => sum + group.compliant, 0)
    summary = [{ labelKey: "sum.requiredActions", value: requirementRecords.length, kind: "number" }, { labelKey: "sum.compliantActions", value: compliant, kind: "number" }, { labelKey: "sum.compliance", value: pct(compliant, requirementRecords.length), kind: "percent" }]
    series = [{ date: dayKey(now), count: compliant }]
  } else if (type === "promises") {
    const visits = await prisma.mtmVisit.findMany({
      where: { organizationId: auth.orgId, nextActionDueAt: { not: null, gte: start }, deletedAt: null, ...agentWhere },
      include: { agent: true, customer: true },
      orderBy: { nextActionDueAt: "asc" },
    })
    const promiseRecords = visits as unknown as PromiseSource[]
    rows = promiseRecords.map((visit) => ({ id: visit.id, dueAt: visit.nextActionDueAt, agent: visit.agent.name, customer: visit.customer.name, outcome: visit.outcome ?? "", status: visit.nextActionDueAt! < now ? "OVERDUE" : "OPEN", notes: visit.resultNotes ?? visit.notes ?? "" }))
    const overdue = promiseRecords.filter((visit) => visit.nextActionDueAt! < now).length
    summary = [{ labelKey: "sum.openPromises", value: promiseRecords.length, kind: "number" }, { labelKey: "sum.overduePromises", value: overdue, kind: "number" }, { labelKey: "sum.overdueRate", value: pct(overdue, promiseRecords.length), kind: "percent" }]
    const daily = new Map<string, number>()
    promiseRecords.forEach((visit) => daily.set(dayKey(visit.nextActionDueAt!), (daily.get(dayKey(visit.nextActionDueAt!)) ?? 0) + 1))
    series = [...daily].map(([date, count]) => ({ date, count })).sort((left, right) => left.date.localeCompare(right.date))
  } else {
    const [documents, plans] = await Promise.all([
      prisma.mtmExternalSalesDocument.findMany({ where: { organizationId: auth.orgId, documentDate: { gte: start }, ...(scopedAgentIds === null ? {} : { agentId: { in: [...scopedAgentIds] } }) }, include: { customer: true, agent: true, lines: true } }),
      prisma.mtmSalesPlanLine.findMany({ where: { organizationId: auth.orgId, periodStart: { gte: start }, ...(scopedAgentIds === null ? {} : { agentId: { in: [...scopedAgentIds] } }) } }),
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
      const key = `${plan.customerId ?? ""}|${plan.agentId ?? ""}`
      const group = groups.get(key) ?? { customerId: plan.customerId ?? "", customer: "", agentId: plan.agentId, agent: "", territory: plan.territoryCode ?? "", actualAmount: 0, actualQuantity: 0, planAmount: 0, planQuantity: 0 }
      group.planAmount += Number(plan.plannedAmount ?? 0)
      group.planQuantity += Number(plan.plannedQuantity ?? 0)
      groups.set(key, group)
    }
    rows = [...groups.values()].map((group, index) => ({ id: index, ...group, amountVariance: group.actualAmount - group.planAmount, quantityVariance: group.actualQuantity - group.planQuantity, attainment: pct(group.actualAmount, group.planAmount) }))
    const actual = [...groups.values()].reduce((sum, group) => sum + group.actualAmount, 0)
    const plan = [...groups.values()].reduce((sum, group) => sum + group.planAmount, 0)
    summary = [{ labelKey: "sum.actualSales", value: Math.round(actual * 100) / 100, kind: "number" }, { labelKey: "sum.planSales", value: Math.round(plan * 100) / 100, kind: "number" }, { labelKey: "sum.attainment", value: pct(actual, plan), kind: "percent" }]
    const daily = new Map<string, number>()
    salesDocuments.forEach((document) => daily.set(dayKey(document.documentDate), (daily.get(dayKey(document.documentDate)) ?? 0) + Number(document.totalAmount ?? 0)))
    series = [...daily].map(([date, count]) => ({ date, count })).sort((left, right) => left.date.localeCompare(right.date))
  }

  if (format === "xlsx") {
    const columns = rows.length > 0 ? Object.keys(rows[0]).filter((key) => key !== "id") : []
    const workbook = buildXlsxWorkbook([
      { name: "Summary", headers: ["metric", "value"], rows: summary.map((item) => [item.labelKey, item.value]) },
      { name: type, headers: columns, rows: safeRows(rows, columns) },
    ])
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer())
    return new NextResponse(buffer as unknown as BodyInit, { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": contentDispositionAttachment(`mtm-${type}-${period}.xlsx`), "Cache-Control": "no-store" } })
  }

  return NextResponse.json({ success: true, data: { summary, series, reportData: rows, total: rows.length, page: 1, limit: rows.length, period, type } })
})
