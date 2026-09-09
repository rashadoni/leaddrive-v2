import type ExcelJS from "exceljs"
import type { Prisma } from "@prisma/client"
import type { prisma as appPrisma } from "@/lib/prisma"
import { buildXlsxWorkbook } from "@/lib/export/tabular"
import { protectMtmExcelText } from "@/lib/mtm/excel-contract"
import type { MtmRouteActor } from "@/lib/mtm/route-permissions"

type AppPrisma = typeof appPrisma

export type MtmExcelExportType = "CUSTOMERS" | "ROUTES" | "SALES_FACTS" | "VISIT_RESULTS" | "PLAN_FACT" | "CUSTOMER_REQUESTS"

export function isMtmExcelExportType(value: string): value is MtmExcelExportType {
  return ["CUSTOMERS", "ROUTES", "SALES_FACTS", "VISIT_RESULTS", "PLAN_FACT", "CUSTOMER_REQUESTS"].includes(value)
}

function safeRows(rows: unknown[][]): unknown[][] {
  return rows.map((row) => row.map(protectMtmExcelText))
}

function summarySheet(type: MtmExcelExportType, filters: Record<string, string>, timezone: string, count: number) {
  return {
    name: "Summary",
    headers: ["key", "value"],
    rows: safeRows([
      ["export_type", type],
      ["generated_at", new Date().toISOString()],
      ["organization_timezone", timezone],
      ["record_count", count],
      ...Object.entries(filters).map(([key, value]) => [`filter_${key}`, value]),
    ]),
  }
}

function dateOnly(value: Date | string | null | undefined): string {
  if (!value) return ""
  return (value instanceof Date ? value : new Date(value)).toISOString().slice(0, 10)
}

function dateTime(value: Date | string | null | undefined): string {
  if (!value) return ""
  return (value instanceof Date ? value : new Date(value)).toISOString()
}

function dateFilter(from: string, to: string): Prisma.DateTimeFilter | undefined {
  if (!from && !to) return undefined
  return {
    ...(from ? { gte: new Date(`${from}T00:00:00.000Z`) } : {}),
    ...(to ? { lte: new Date(`${to}T23:59:59.999Z`) } : {}),
  }
}

export async function buildMtmExcelExport(params: {
  db: AppPrisma
  organizationId: string
  actor: MtmRouteActor
  type: MtmExcelExportType
  from: string
  to: string
  timezone: string
}): Promise<ExcelJS.Workbook> {
  const filters = { from: params.from || "all", to: params.to || "all" }
  const scopedAgentIds = params.actor.scopedAgentIds
  let headers: string[] = []
  let rows: unknown[][] = []
  let sheetName = params.type.toLowerCase()

  if (params.type === "CUSTOMERS") {
    const customers = await params.db.mtmCustomer.findMany({
      where: {
        organizationId: params.organizationId,
        deletedAt: null,
        ...(scopedAgentIds === null ? {} : {
          OR: [
            { routePoints: { some: { route: { OR: [{ agentId: { in: [...scopedAgentIds] } }, { assignments: { some: { agentId: { in: [...scopedAgentIds] }, removedAt: null } } }] } } } },
            { visits: { some: { agentId: { in: [...scopedAgentIds] } } } },
          ],
        }),
      },
      orderBy: { name: "asc" },
    })
    headers = ["external_code", "object_type", "name", "status", "category", "address", "city", "district", "latitude", "longitude", "contact_person", "phone", "territory_code"]
    rows = customers.map((customer: typeof customers[number]) => [customer.code, customer.objectType.toLowerCase(), customer.name, customer.status.toLowerCase(), customer.category, customer.address, customer.city, customer.district, customer.latitude, customer.longitude, customer.contactPerson, customer.phone, customer.territoryCode])
    sheetName = "customers"
  } else if (params.type === "ROUTES") {
    const routes = await params.db.mtmRoute.findMany({
      where: {
        organizationId: params.organizationId,
        deletedAt: null,
        date: dateFilter(params.from, params.to),
        ...(scopedAgentIds === null ? {} : { OR: [{ agentId: { in: [...scopedAgentIds] } }, { assignments: { some: { agentId: { in: [...scopedAgentIds] }, removedAt: null } } }] }),
      },
      include: {
        agent: { select: { externalCode: true, name: true } },
        assignments: { where: { removedAt: null }, include: { agent: { select: { externalCode: true, name: true } } }, orderBy: { assignedAt: "asc" } },
        points: { where: { deletedAt: null }, include: { customer: { select: { code: true, name: true } } }, orderBy: { orderIndex: "asc" } },
      },
      orderBy: [{ date: "asc" }, { createdAt: "asc" }],
    })
    headers = ["route_external_id", "route_date", "route_name", "route_status", "agent_codes", "primary_agent_code", "stop_order", "customer_code", "customer_name", "planned_time", "stop_status", "visited_at", "notes"]
    rows = routes.flatMap((route: typeof routes[number]) => {
      const agentCodes = route.assignments.map((assignment: { agent: { externalCode: string | null; name: string } }) => assignment.agent.externalCode || assignment.agent.name).join(",")
      const primaryCode = route.agent.externalCode || route.agent.name
      return route.points.map((point: { orderIndex: number; customer: { code: string | null; name: string }; plannedTime: Date | null; status: string; visitedAt: Date | null; notes: string | null }) => [route.externalId || route.id, dateOnly(route.date), route.name, route.status, agentCodes || primaryCode, primaryCode, point.orderIndex, point.customer.code, point.customer.name, point.plannedTime ? point.plannedTime.toISOString().slice(11, 16) : "", point.status, dateTime(point.visitedAt), point.notes])
    })
    sheetName = "routes"
  } else if (params.type === "SALES_FACTS") {
    const documents = await params.db.mtmExternalSalesDocument.findMany({
      where: {
        organizationId: params.organizationId,
        documentDate: dateFilter(params.from, params.to),
        ...(scopedAgentIds === null ? {} : { agentId: { in: [...scopedAgentIds] } }),
      },
      include: { customer: { select: { code: true, name: true } }, agent: { select: { externalCode: true, name: true } }, lines: { orderBy: { lineNumber: "asc" } } },
      orderBy: [{ documentDate: "asc" }, { externalDocumentNo: "asc" }],
    })
    headers = ["document_no", "document_date", "line_number", "customer_code", "customer_name", "agent_code", "product_code", "product_name", "quantity", "unit", "amount", "currency", "document_status"]
    rows = documents.flatMap((document: typeof documents[number]) => document.lines.map((line: { lineNumber: number; productCode: string; productName: string; quantity: unknown; unit: string | null; amount: unknown }) => [document.externalDocumentNo, dateOnly(document.documentDate), line.lineNumber, document.customer.code, document.customer.name, document.agent?.externalCode || document.agent?.name || "", line.productCode, line.productName, Number(line.quantity), line.unit, line.amount == null ? null : Number(line.amount), document.currency, document.status.toLowerCase()]))
    sheetName = "sales_facts"
  } else if (params.type === "PLAN_FACT") {
    const plans = await params.db.mtmSalesPlanLine.findMany({
      where: {
        organizationId: params.organizationId,
        periodStart: dateFilter(params.from, params.to),
        ...(scopedAgentIds === null ? {} : { agentId: { in: [...scopedAgentIds] } }),
      },
      include: { customer: { select: { code: true, name: true } }, agent: { select: { externalCode: true, name: true } } },
      orderBy: { periodStart: "asc" },
    })
    headers = ["period_start", "customer_code", "customer_name", "agent_code", "territory_code", "product_code", "planned_quantity", "planned_amount", "currency"]
    rows = plans.map((plan: typeof plans[number]) => [dateOnly(plan.periodStart), plan.customer?.code, plan.customer?.name, plan.agent?.externalCode || plan.agent?.name || "", plan.territoryCode, plan.productCode, plan.plannedQuantity == null ? null : Number(plan.plannedQuantity), plan.plannedAmount == null ? null : Number(plan.plannedAmount), plan.currency])
    sheetName = "sales_plan"
  } else if (params.type === "CUSTOMER_REQUESTS") {
    const requests = await params.db.mtmCustomerCreateRequest.findMany({
      where: {
        organizationId: params.organizationId,
        createdAt: dateFilter(params.from, params.to),
        ...(scopedAgentIds === null ? {} : { requestedByAgentId: { in: [...scopedAgentIds] } }),
      },
      include: { requestedByAgent: { select: { externalCode: true, name: true } }, approvedCustomer: { select: { code: true } } },
      orderBy: { createdAt: "desc" },
    })
    headers = ["request_id", "created_at", "agent_code", "object_type", "external_code", "name", "status", "reason", "reviewed_by", "decision_comment", "approved_customer_code"]
    rows = requests.map((request: typeof requests[number]) => [request.id, dateTime(request.createdAt), request.requestedByAgent.externalCode || request.requestedByAgent.name, request.objectType.toLowerCase(), request.externalCode, request.name, request.status, request.reason, request.reviewedBy, request.decisionComment, request.approvedCustomer?.code])
    sheetName = "customer_requests"
  } else {
    const visits = await params.db.mtmVisit.findMany({
      where: {
        organizationId: params.organizationId,
        deletedAt: null,
        checkInAt: dateFilter(params.from, params.to),
        ...(scopedAgentIds === null ? {} : { agentId: { in: [...scopedAgentIds] } }),
      },
      include: {
        agent: { select: { externalCode: true, name: true } },
        customer: { select: { code: true, name: true } },
        requirementSnapshot: { include: { requirements: { include: { actionResults: true } } } },
      },
      orderBy: { checkInAt: "desc" },
    })
    headers = ["visit_id", "route_id", "agent_code", "customer_code", "customer_name", "check_in_at", "check_out_at", "outcome", "potential", "result_notes", "action_key", "requirement_mode", "required_count", "completed_count", "compliant"]
    rows = visits.flatMap((visit: typeof visits[number]) => {
      const requirements = visit.requirementSnapshot?.requirements ?? []
      if (requirements.length === 0) return [[visit.id, visit.routeId, visit.agent.externalCode || visit.agent.name, visit.customer.code, visit.customer.name, dateTime(visit.checkInAt), dateTime(visit.checkOutAt), visit.outcome, visit.potential, visit.resultNotes, "", "", 0, 0, true]]
      return requirements.map((requirement: { actionKey: string; mode: string; minCount: number; actionResults: Array<{ status: string }> }) => {
        const completed = requirement.actionResults.filter((result: { status: string }) => result.status === "COMPLETED" || result.status === "WAIVED").length
        return [visit.id, visit.routeId, visit.agent.externalCode || visit.agent.name, visit.customer.code, visit.customer.name, dateTime(visit.checkInAt), dateTime(visit.checkOutAt), visit.outcome, visit.potential, visit.resultNotes, requirement.actionKey, requirement.mode, requirement.minCount, completed, requirement.mode !== "REQUIRED" || completed >= requirement.minCount]
      })
    })
    sheetName = "visit_results"
  }

  const protectedRows = safeRows(rows)
  return buildXlsxWorkbook([
    summarySheet(params.type, filters, params.timezone, protectedRows.length),
    { name: sheetName, headers, rows: protectedRows },
  ])
}
