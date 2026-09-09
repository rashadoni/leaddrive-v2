import { createHash } from "node:crypto"
import { normalizeMtmCoordinates } from "@/lib/mtm/geo-coordinates"
import { Prisma, type MtmCustomerCategory, type MtmCustomerObjectType, type MtmCustomerStatus, type MtmExternalDocumentStatus } from "@prisma/client"
import type { prisma as appPrisma } from "@/lib/prisma"
import { buildMtmRouteDedupeKey, detectMtmRouteConflicts } from "@/lib/mtm/route-planning"
import { rankMtmCustomerDuplicates } from "@/lib/mtm/customer-request"
import type { MtmRouteActor } from "@/lib/mtm/route-permissions"
import type { MtmExcelRowError, MtmExcelImportType, ParsedMtmWorkbook } from "@/lib/mtm/excel-contract"

type AppPrisma = typeof appPrisma
type DbClient = AppPrisma | Prisma.TransactionClient
type RowOperation = "CREATE" | "UPDATE" | "UNCHANGED"

export interface MtmExcelSummary {
  totalRows: number
  createRows: number
  updateRows: number
  unchangedRows: number
  skippedRows: number
  errorRows: number
  warningRows: number
  requiresConflictOverride: boolean
}

interface SnapshotRow {
  rowNumber: number
  sourceRows?: number[]
  operation: RowOperation
  existingId?: string
  warnings?: Array<{ code: string; message: string }>
  data: Record<string, unknown>
}

interface ExistingCustomerRow {
  id: string
  code: string | null
  objectType: MtmCustomerObjectType
  name: string
  status: MtmCustomerStatus
  category: MtmCustomerCategory
  address: string | null
  city: string | null
  district: string | null
  territoryCode: string | null
  latitude: number | null
  longitude: number | null
  contactPerson: string | null
  phone: string | null
}

interface ExistingRouteRow {
  id: string
  externalId: string | null
  dedupeKey: string | null
  status: string
  agentId: string
  assignments: Array<{ agentId: string; removedAt: Date | null }>
  points: Array<{ customerId: string; deletedAt: Date | null }>
}

interface ExistingSalesDocumentRow {
  id: string
  externalDocumentNo: string
  documentDate: Date
  customerId: string
  agentId: string | null
  status: MtmExternalDocumentStatus
  currency: string
  lines: Array<{
    id: string
    lineNumber: number
    productCode: string
    productName: string
    quantity: Prisma.Decimal
    unit: string | null
    amount: Prisma.Decimal | null
  }>
}

interface ExistingPlanRow {
  id: string
  dedupeKey: string
  plannedQuantity: Prisma.Decimal | null
  plannedAmount: Prisma.Decimal | null
  currency: string
}

export interface MtmValidatedExcelSnapshot {
  snapshotVersion: 1
  templateVersion: string
  type: MtmExcelImportType
  checksum: string
  validatedAt: string
  summary: MtmExcelSummary
  rows: SnapshotRow[]
}

export interface MtmExcelValidationResult {
  snapshot: MtmValidatedExcelSnapshot
  errors: MtmExcelRowError[]
  preview: Array<Record<string, unknown>>
}

function text(value: unknown): string {
  return value == null ? "" : String(value).trim()
}

function requiredText(
  parsed: ParsedMtmWorkbook,
  rowNumber: number,
  values: Record<string, unknown>,
  column: string,
  errors: MtmExcelRowError[],
  max = 200,
): string {
  const value = text(values[column])
  if (!value) {
    errors.push({ sheetName: parsed.sheetName, rowNumber, columnName: column, errorCode: "REQUIRED", message: `'${column}' is required` })
  } else if (value.length > max) {
    errors.push({ sheetName: parsed.sheetName, rowNumber, columnName: column, errorCode: "TOO_LONG", message: `'${column}' exceeds ${max} characters`, rawValue: value })
  }
  return value
}

function optionalText(value: unknown, max = 500): string | null {
  const normalized = text(value)
  return normalized ? normalized.slice(0, max) : null
}

function isoDate(value: unknown): string | null {
  const normalized = value instanceof Date ? value.toISOString().slice(0, 10) : text(value)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return null
  const parsed = new Date(`${normalized}T00:00:00.000Z`)
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== normalized ? null : normalized
}

function decimal(value: unknown): number | null {
  if (value === null || value === undefined || text(value) === "") return null
  const parsed = typeof value === "number" ? value : Number(text(value).replace(",", "."))
  return Number.isFinite(parsed) ? parsed : null
}

function positiveInt(value: unknown): number | null {
  const parsed = decimal(value)
  return parsed != null && Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  const normalized = text(value).toUpperCase()
  return allowed.includes(normalized as T) ? normalized as T : null
}

function pushInvalid(
  parsed: ParsedMtmWorkbook,
  rowNumber: number,
  columnName: string,
  errors: MtmExcelRowError[],
  rawValue: unknown,
  message: string,
): void {
  errors.push({ sheetName: parsed.sheetName, rowNumber, columnName, errorCode: "INVALID_VALUE", message, rawValue })
}

function stableEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function summaryFor(parsed: ParsedMtmWorkbook, rows: SnapshotRow[], errors: MtmExcelRowError[]): MtmExcelSummary {
  const errorRowNumbers = new Set(errors.filter((error) => error.rowNumber > 1).map((error) => error.rowNumber))
  return {
    totalRows: parsed.rows.length,
    createRows: rows.filter((row) => row.operation === "CREATE").length,
    updateRows: rows.filter((row) => row.operation === "UPDATE").length,
    unchangedRows: rows.filter((row) => row.operation === "UNCHANGED").length,
    skippedRows: errorRowNumbers.size,
    errorRows: errorRowNumbers.size + errors.filter((error) => error.rowNumber === 1).length,
    warningRows: rows.filter((row) => (row.warnings?.length ?? 0) > 0).length,
    requiresConflictOverride: rows.some((row) => row.warnings?.some((warning) => warning.code.startsWith("ROUTE_CONFLICT"))),
  }
}

async function validateCustomers(
  db: DbClient,
  organizationId: string,
  parsed: ParsedMtmWorkbook,
): Promise<{ rows: SnapshotRow[]; errors: MtmExcelRowError[] }> {
  const errors = [...parsed.errors]
  const existing = await db.mtmCustomer.findMany({
    where: { organizationId, deletedAt: null },
    select: { id: true, code: true, objectType: true, name: true, status: true, category: true, address: true, city: true, district: true, territoryCode: true, latitude: true, longitude: true, contactPerson: true, phone: true },
  })
  const territories = await db.mtmRegion.findMany({ where: { organizationId, code: { not: null } }, select: { code: true } })
  const territoryCodes = new Set(territories.map((territory: { code: string | null }) => territory.code).filter(Boolean))
  const customerRows = existing as unknown as ExistingCustomerRow[]
  const byCode = new Map<string, ExistingCustomerRow>(customerRows.filter((customer) => customer.code).map((customer) => [customer.code!, customer]))
  const seen = new Map<string, number>()
  const rows: SnapshotRow[] = []

  for (const row of parsed.rows) {
    const before = errors.length
    const code = requiredText(parsed, row.rowNumber, row.values, "external_code", errors, 128)
    const objectType = enumValue<MtmCustomerObjectType>(row.values.object_type, ["PHARMACY", "CLINIC", "DOCTOR", "STORE", "OTHER"])
    const name = requiredText(parsed, row.rowNumber, row.values, "name", errors)
    const status = text(row.values.status) ? enumValue<MtmCustomerStatus>(row.values.status, ["ACTIVE", "PROSPECT", "INACTIVE"]) : "ACTIVE"
    const category = text(row.values.category) ? enumValue<MtmCustomerCategory>(row.values.category, ["A", "B", "C", "D"]) : "B"
    if (!objectType) pushInvalid(parsed, row.rowNumber, "object_type", errors, row.values.object_type, "Use pharmacy, clinic, doctor, store, or other")
    if (!status) pushInvalid(parsed, row.rowNumber, "status", errors, row.values.status, "Use active, prospect, or inactive")
    if (!category) pushInvalid(parsed, row.rowNumber, "category", errors, row.values.category, "Use A, B, C, or D")
    const latitude = decimal(row.values.latitude)
    const longitude = decimal(row.values.longitude)
    const latitudeInvalid = Boolean(text(row.values.latitude)) && (latitude == null || latitude < -90 || latitude > 90)
    const longitudeInvalid = Boolean(text(row.values.longitude)) && (longitude == null || longitude < -180 || longitude > 180)
    if (latitudeInvalid) pushInvalid(parsed, row.rowNumber, "latitude", errors, row.values.latitude, "Latitude must be between -90 and 90")
    if (longitudeInvalid) pushInvalid(parsed, row.rowNumber, "longitude", errors, row.values.longitude, "Longitude must be between -180 and 180")
    if (!latitudeInvalid && !longitudeInvalid && (latitude == null) !== (longitude == null)) {
      pushInvalid(parsed, row.rowNumber, latitude == null ? "latitude" : "longitude", errors, latitude == null ? row.values.latitude : row.values.longitude, "Latitude and longitude must be provided together")
    }
    // A 0,0 pair in a spreadsheet means "unknown", never Null Island.
    const coordinates = normalizeMtmCoordinates({ latitude, longitude })
    const territoryCode = optionalText(row.values.territory_code, 128)
    if (territoryCode && !territoryCodes.has(territoryCode)) pushInvalid(parsed, row.rowNumber, "territory_code", errors, territoryCode, "Territory code does not exist")
    if (code) {
      const duplicateRow = seen.get(code)
      if (duplicateRow) errors.push({ sheetName: parsed.sheetName, rowNumber: row.rowNumber, columnName: "external_code", errorCode: "DUPLICATE_IN_FILE", message: `External code also appears on row ${duplicateRow}`, rawValue: code })
      else seen.set(code, row.rowNumber)
    }
    if (errors.length > before) continue

    const data = {
      code,
      objectType,
      name,
      status,
      category,
      address: optionalText(row.values.address),
      city: optionalText(row.values.city),
      district: optionalText(row.values.district),
      latitude: coordinates.latitude,
      longitude: coordinates.longitude,
      contactPerson: optionalText(row.values.contact_person),
      phone: optionalText(row.values.phone, 128),
      territoryCode,
    }
    const match = byCode.get(code)
    const comparable = match ? {
      code: match.code,
      objectType: match.objectType,
      name: match.name,
      status: match.status,
      category: match.category,
      address: match.address,
      city: match.city,
      district: match.district,
      latitude: match.latitude,
      longitude: match.longitude,
      contactPerson: match.contactPerson,
      phone: match.phone,
      territoryCode: match.territoryCode,
    } : null
    const duplicateCandidates = match ? [] : rankMtmCustomerDuplicates({ externalCode: code, name, phone: data.phone, latitude: coordinates.latitude, longitude: coordinates.longitude }, customerRows)
    rows.push({
      rowNumber: row.rowNumber,
      operation: match ? (stableEqual(data, comparable) ? "UNCHANGED" : "UPDATE") : "CREATE",
      existingId: match?.id,
      warnings: duplicateCandidates.length > 0 ? [{ code: "POSSIBLE_DUPLICATE", message: `Possible matches: ${duplicateCandidates.slice(0, 3).map((candidate) => candidate.name).join(", ")}` }] : undefined,
      data,
    })
  }
  return { rows, errors }
}

async function validateRoutes(
  db: DbClient,
  organizationId: string,
  parsed: ParsedMtmWorkbook,
  actor: MtmRouteActor,
): Promise<{ rows: SnapshotRow[]; errors: MtmExcelRowError[] }> {
  const errors = [...parsed.errors]
  const [agents, customers, existingRoutes] = await Promise.all([
    db.mtmAgent.findMany({ where: { organizationId, status: "ACTIVE", externalCode: { not: null } }, select: { id: true, externalCode: true } }),
    db.mtmCustomer.findMany({ where: { organizationId, deletedAt: null, code: { not: null } }, select: { id: true, code: true } }),
    db.mtmRoute.findMany({
      where: { organizationId, deletedAt: null },
      select: { id: true, externalId: true, dedupeKey: true, status: true, agentId: true, assignments: { select: { agentId: true, removedAt: true } }, points: { select: { customerId: true, deletedAt: true } } },
    }),
  ])
  const routeRows = existingRoutes as unknown as ExistingRouteRow[]
  const agentByCode = new Map<string, string>(agents.map((agent: { id: string; externalCode: string | null }) => [agent.externalCode!, agent.id]))
  const customerByCode = new Map<string, string>(customers.map((customer: { id: string; code: string | null }) => [customer.code!, customer.id]))
  const byExternalId = new Map<string, ExistingRouteRow>(routeRows.filter((route) => route.externalId).map((route) => [route.externalId!, route]))
  const grouped = new Map<string, typeof parsed.rows>()
  for (const row of parsed.rows) {
    const externalId = requiredText(parsed, row.rowNumber, row.values, "route_external_id", errors, 128)
    if (externalId) grouped.set(externalId, [...(grouped.get(externalId) ?? []), row])
  }
  const snapshotRows: SnapshotRow[] = []

  for (const [externalId, sourceRows] of grouped) {
    const first = sourceRows[0]
    const before = errors.length
    const routeDate = isoDate(first.values.route_date)
    if (!routeDate) pushInvalid(parsed, first.rowNumber, "route_date", errors, first.values.route_date, "Use ISO date YYYY-MM-DD")
    const primaryCode = requiredText(parsed, first.rowNumber, first.values, "primary_agent_code", errors, 128)
    const agentCodes = requiredText(parsed, first.rowNumber, first.values, "agent_codes", errors, 1000).split(",").map((code) => code.trim()).filter(Boolean)
    if (!agentCodes.includes(primaryCode)) pushInvalid(parsed, first.rowNumber, "primary_agent_code", errors, primaryCode, "Primary agent must be listed in agent_codes")
    if (new Set(agentCodes).size !== agentCodes.length) pushInvalid(parsed, first.rowNumber, "agent_codes", errors, first.values.agent_codes, "Agent codes must be unique")
    const missingAgentCodes = agentCodes.filter((code) => !agentByCode.has(code))
    if (missingAgentCodes.length > 0) pushInvalid(parsed, first.rowNumber, "agent_codes", errors, missingAgentCodes.join(","), "One or more agent codes do not exist")
    const agentIds = agentCodes.map((code) => agentByCode.get(code)).filter((id): id is string => Boolean(id))
    const primaryAgentId = agentByCode.get(primaryCode) ?? ""
    if (actor.scopedAgentIds !== null && agentIds.some((id) => !actor.scopedAgentIds!.includes(id))) {
      errors.push({ sheetName: parsed.sheetName, rowNumber: first.rowNumber, columnName: "agent_codes", errorCode: "OUTSIDE_SCOPE", message: "Route includes an agent outside your management scope" })
    }
    const points: Array<{ customerId: string; orderIndex: number; plannedTime: string | null; notes: string | null }> = []
    const orders = new Set<number>()
    const customerIds = new Set<string>()
    for (const source of sourceRows) {
      if (text(source.values.route_date) !== text(first.values.route_date) || text(source.values.primary_agent_code) !== primaryCode || text(source.values.agent_codes) !== text(first.values.agent_codes)) {
        errors.push({ sheetName: parsed.sheetName, rowNumber: source.rowNumber, columnName: null, errorCode: "ROUTE_GROUP_MISMATCH", message: "Rows with the same route_external_id must have identical route metadata" })
      }
      const orderIndex = positiveInt(source.values.stop_order)
      if (!orderIndex) pushInvalid(parsed, source.rowNumber, "stop_order", errors, source.values.stop_order, "Stop order must be a positive integer")
      else if (orders.has(orderIndex)) errors.push({ sheetName: parsed.sheetName, rowNumber: source.rowNumber, columnName: "stop_order", errorCode: "DUPLICATE_STOP_ORDER", message: `Stop order ${orderIndex} is repeated` })
      else orders.add(orderIndex)
      const customerCode = requiredText(parsed, source.rowNumber, source.values, "customer_code", errors, 128)
      const customerId = customerByCode.get(customerCode)
      if (!customerId) errors.push({ sheetName: parsed.sheetName, rowNumber: source.rowNumber, columnName: "customer_code", errorCode: "REFERENCE_NOT_FOUND", message: `Customer '${customerCode}' does not exist`, rawValue: customerCode })
      else if (customerIds.has(customerId)) errors.push({ sheetName: parsed.sheetName, rowNumber: source.rowNumber, columnName: "customer_code", errorCode: "DUPLICATE_STOP", message: "A customer may appear only once in a route", rawValue: customerCode })
      else customerIds.add(customerId)
      const plannedTime = optionalText(source.values.planned_time, 5)
      if (plannedTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(plannedTime)) pushInvalid(parsed, source.rowNumber, "planned_time", errors, plannedTime, "Use 24-hour time HH:mm")
      if (customerId && orderIndex) points.push({ customerId, orderIndex, plannedTime, notes: optionalText(source.values.notes, 2000) })
    }
    if (errors.length > before || !routeDate || !primaryAgentId) continue
    points.sort((left, right) => left.orderIndex - right.orderIndex)
    const assignments = agentIds.map((agentId) => ({ agentId, role: agentId === primaryAgentId ? "PRIMARY" as const : "PARTICIPANT" as const }))
    const fingerprintPoints = points.map((point) => ({ customerId: point.customerId, plannedTime: point.plannedTime ? `${routeDate}T${point.plannedTime}:00.000Z` : null }))
    const dedupeKey = buildMtmRouteDedupeKey({ date: routeDate, primaryAgentId, assignments, points: fingerprintPoints })
    const existing = byExternalId.get(externalId)
    const duplicate = routeRows.find((route) => route.dedupeKey === dedupeKey && route.id !== existing?.id)
    if (duplicate) {
      errors.push({ sheetName: parsed.sheetName, rowNumber: first.rowNumber, columnName: "route_external_id", errorCode: "ROUTE_DUPLICATE", message: "An identical active route already exists" })
      continue
    }
    if (existing && existing.status !== "DRAFT" && existing.dedupeKey !== dedupeKey) {
      errors.push({ sheetName: parsed.sheetName, rowNumber: first.rowNumber, columnName: "route_external_id", errorCode: "ROUTE_LOCKED", message: "Only draft routes can be changed by Excel import" })
      continue
    }
    const conflicts = detectMtmRouteConflicts({ primaryAgentId, assignments, points: fingerprintPoints }, routeRows.filter((route) => route.id !== existing?.id))
    snapshotRows.push({
      rowNumber: first.rowNumber,
      sourceRows: sourceRows.map((row) => row.rowNumber),
      operation: existing ? (existing.dedupeKey === dedupeKey ? "UNCHANGED" : "UPDATE") : "CREATE",
      existingId: existing?.id,
      warnings: conflicts.map((conflict) => ({ code: `ROUTE_CONFLICT_${conflict.code}`, message: `Conflicts with route ${conflict.routeId}` })),
      data: { externalId, routeDate, routeName: optionalText(first.values.route_name), primaryAgentId, assignments, points, dedupeKey },
    })
  }
  return { rows: snapshotRows, errors }
}

async function validateSalesFacts(
  db: DbClient,
  organizationId: string,
  parsed: ParsedMtmWorkbook,
): Promise<{ rows: SnapshotRow[]; errors: MtmExcelRowError[] }> {
  const errors = [...parsed.errors]
  const [customers, agents, existingDocuments] = await Promise.all([
    db.mtmCustomer.findMany({ where: { organizationId, deletedAt: null, code: { not: null } }, select: { id: true, code: true } }),
    db.mtmAgent.findMany({ where: { organizationId, externalCode: { not: null } }, select: { id: true, externalCode: true } }),
    db.mtmExternalSalesDocument.findMany({
      where: { organizationId },
      select: { id: true, externalDocumentNo: true, documentDate: true, customerId: true, agentId: true, status: true, currency: true, lines: { select: { id: true, lineNumber: true, productCode: true, productName: true, quantity: true, unit: true, amount: true } } },
    }),
  ])
  const salesDocuments = existingDocuments as unknown as ExistingSalesDocumentRow[]
  const customerByCode = new Map<string, string>(customers.map((customer: { id: string; code: string | null }) => [customer.code!, customer.id]))
  const agentByCode = new Map<string, string>(agents.map((agent: { id: string; externalCode: string | null }) => [agent.externalCode!, agent.id]))
  const documentByKey = new Map<string, ExistingSalesDocumentRow>(salesDocuments.map((document) => [`${document.externalDocumentNo}|${document.documentDate.toISOString().slice(0, 10)}`, document]))
  const seenKeys = new Map<string, number>()
  const rows: SnapshotRow[] = []

  for (const row of parsed.rows) {
    const before = errors.length
    const documentNo = requiredText(parsed, row.rowNumber, row.values, "document_no", errors, 128)
    const documentDate = isoDate(row.values.document_date)
    if (!documentDate) pushInvalid(parsed, row.rowNumber, "document_date", errors, row.values.document_date, "Use ISO date YYYY-MM-DD")
    const lineNumber = positiveInt(row.values.line_number)
    if (!lineNumber) pushInvalid(parsed, row.rowNumber, "line_number", errors, row.values.line_number, "Line number must be a positive integer")
    const customerCode = requiredText(parsed, row.rowNumber, row.values, "customer_code", errors, 128)
    const customerId = customerByCode.get(customerCode)
    if (!customerId) errors.push({ sheetName: parsed.sheetName, rowNumber: row.rowNumber, columnName: "customer_code", errorCode: "REFERENCE_NOT_FOUND", message: `Customer '${customerCode}' does not exist`, rawValue: customerCode })
    const agentCode = optionalText(row.values.agent_code, 128)
    const agentId = agentCode ? agentByCode.get(agentCode) : null
    if (agentCode && !agentId) errors.push({ sheetName: parsed.sheetName, rowNumber: row.rowNumber, columnName: "agent_code", errorCode: "REFERENCE_NOT_FOUND", message: `Agent '${agentCode}' does not exist`, rawValue: agentCode })
    const productCode = requiredText(parsed, row.rowNumber, row.values, "product_code", errors, 128)
    const productName = requiredText(parsed, row.rowNumber, row.values, "product_name", errors)
    const quantity = decimal(row.values.quantity)
    const amount = decimal(row.values.amount)
    if (quantity == null || quantity < 0) pushInvalid(parsed, row.rowNumber, "quantity", errors, row.values.quantity, "Quantity must be a number greater than or equal to zero")
    if (text(row.values.amount) && (amount == null || amount < 0)) pushInvalid(parsed, row.rowNumber, "amount", errors, row.values.amount, "Amount must be a number greater than or equal to zero")
    const currency = optionalText(row.values.currency, 3)?.toUpperCase() ?? "AZN"
    if (!/^[A-Z]{3}$/.test(currency)) pushInvalid(parsed, row.rowNumber, "currency", errors, row.values.currency, "Currency must be a three-letter ISO code")
    const status = text(row.values.document_status)
      ? enumValue<MtmExternalDocumentStatus>(row.values.document_status, ["IMPORTED", "CONFIRMED", "CANCELLED"])
      : "IMPORTED"
    if (!status) pushInvalid(parsed, row.rowNumber, "document_status", errors, row.values.document_status, "Use imported, confirmed, or cancelled")
    const key = `${documentNo}|${documentDate}|${lineNumber}`
    const duplicateRow = seenKeys.get(key)
    if (duplicateRow) errors.push({ sheetName: parsed.sheetName, rowNumber: row.rowNumber, columnName: "line_number", errorCode: "DUPLICATE_IN_FILE", message: `Document line also appears on row ${duplicateRow}` })
    else seenKeys.set(key, row.rowNumber)
    if (errors.length > before || !documentDate || !lineNumber || !customerId || quantity == null || !status) continue

    const existingDocument = documentByKey.get(`${documentNo}|${documentDate}`)
    const existingLine = existingDocument?.lines.find((line: { lineNumber: number }) => line.lineNumber === lineNumber)
    const data = { documentNo, documentDate, lineNumber, customerId, agentId, productCode, productName, quantity, unit: optionalText(row.values.unit, 64), amount, currency, status }
    const comparable = existingLine && existingDocument ? {
      documentNo: existingDocument.externalDocumentNo,
      documentDate: existingDocument.documentDate.toISOString().slice(0, 10),
      lineNumber: existingLine.lineNumber,
      customerId: existingDocument.customerId,
      agentId: existingDocument.agentId,
      productCode: existingLine.productCode,
      productName: existingLine.productName,
      quantity: Number(existingLine.quantity),
      unit: existingLine.unit,
      amount: existingLine.amount == null ? null : Number(existingLine.amount),
      currency: existingDocument.currency,
      status: existingDocument.status,
    } : null
    rows.push({
      rowNumber: row.rowNumber,
      operation: existingLine ? (stableEqual(data, comparable) ? "UNCHANGED" : "UPDATE") : "CREATE",
      existingId: existingLine?.id,
      data,
    })
  }
  return { rows, errors }
}

async function validatePlanFact(
  db: DbClient,
  organizationId: string,
  parsed: ParsedMtmWorkbook,
): Promise<{ rows: SnapshotRow[]; errors: MtmExcelRowError[] }> {
  const errors = [...parsed.errors]
  const [customers, agents, existingPlans] = await Promise.all([
    db.mtmCustomer.findMany({ where: { organizationId, deletedAt: null, code: { not: null } }, select: { id: true, code: true } }),
    db.mtmAgent.findMany({ where: { organizationId, externalCode: { not: null } }, select: { id: true, externalCode: true } }),
    db.mtmSalesPlanLine.findMany({ where: { organizationId }, select: { id: true, dedupeKey: true, plannedQuantity: true, plannedAmount: true, currency: true } }),
  ])
  const planRows = existingPlans as unknown as ExistingPlanRow[]
  const customerByCode = new Map<string, string>(customers.map((customer: { id: string; code: string | null }) => [customer.code!, customer.id]))
  const agentByCode = new Map<string, string>(agents.map((agent: { id: string; externalCode: string | null }) => [agent.externalCode!, agent.id]))
  const existingByKey = new Map<string, ExistingPlanRow>(planRows.map((plan) => [plan.dedupeKey, plan]))
  const seen = new Map<string, number>()
  const rows: SnapshotRow[] = []

  for (const row of parsed.rows) {
    const before = errors.length
    const periodStart = isoDate(row.values.period_start)
    if (!periodStart) pushInvalid(parsed, row.rowNumber, "period_start", errors, row.values.period_start, "Use ISO date YYYY-MM-DD")
    const customerCode = optionalText(row.values.customer_code, 128)
    const customerId = customerCode ? customerByCode.get(customerCode) : null
    if (customerCode && !customerId) errors.push({ sheetName: parsed.sheetName, rowNumber: row.rowNumber, columnName: "customer_code", errorCode: "REFERENCE_NOT_FOUND", message: `Customer '${customerCode}' does not exist`, rawValue: customerCode })
    const agentCode = optionalText(row.values.agent_code, 128)
    const agentId = agentCode ? agentByCode.get(agentCode) : null
    if (agentCode && !agentId) errors.push({ sheetName: parsed.sheetName, rowNumber: row.rowNumber, columnName: "agent_code", errorCode: "REFERENCE_NOT_FOUND", message: `Agent '${agentCode}' does not exist`, rawValue: agentCode })
    const territoryCode = optionalText(row.values.territory_code, 128)
    const productCode = optionalText(row.values.product_code, 128)
    const plannedQuantity = decimal(row.values.planned_quantity)
    const plannedAmount = decimal(row.values.planned_amount)
    if (plannedQuantity == null && plannedAmount == null) errors.push({ sheetName: parsed.sheetName, rowNumber: row.rowNumber, columnName: null, errorCode: "PLAN_VALUE_REQUIRED", message: "Provide planned_quantity or planned_amount" })
    if (plannedQuantity != null && plannedQuantity < 0) pushInvalid(parsed, row.rowNumber, "planned_quantity", errors, row.values.planned_quantity, "Planned quantity cannot be negative")
    if (plannedAmount != null && plannedAmount < 0) pushInvalid(parsed, row.rowNumber, "planned_amount", errors, row.values.planned_amount, "Planned amount cannot be negative")
    const currency = optionalText(row.values.currency, 3)?.toUpperCase() ?? "AZN"
    if (!/^[A-Z]{3}$/.test(currency)) pushInvalid(parsed, row.rowNumber, "currency", errors, row.values.currency, "Currency must be a three-letter ISO code")
    if (!periodStart) continue
    const dedupeKey = createHash("sha256").update(JSON.stringify({ periodStart, customerId, agentId, territoryCode, productCode, currency })).digest("hex")
    const duplicateRow = seen.get(dedupeKey)
    if (duplicateRow) errors.push({ sheetName: parsed.sheetName, rowNumber: row.rowNumber, columnName: null, errorCode: "DUPLICATE_IN_FILE", message: `The same plan dimension appears on row ${duplicateRow}` })
    else seen.set(dedupeKey, row.rowNumber)
    if (errors.length > before) continue
    const existing = existingByKey.get(dedupeKey)
    const data = { dedupeKey, periodStart, customerId, agentId, territoryCode, productCode, plannedQuantity, plannedAmount, currency }
    const unchanged = existing && Number(existing.plannedQuantity ?? 0) === Number(plannedQuantity ?? 0) && Number(existing.plannedAmount ?? 0) === Number(plannedAmount ?? 0) && existing.currency === currency
    rows.push({ rowNumber: row.rowNumber, operation: existing ? (unchanged ? "UNCHANGED" : "UPDATE") : "CREATE", existingId: existing?.id, data })
  }
  return { rows, errors }
}

export async function validateMtmExcelImport(params: {
  db: DbClient
  organizationId: string
  parsed: ParsedMtmWorkbook
  checksum: string
  actor: MtmRouteActor
}): Promise<MtmExcelValidationResult> {
  const validated = params.parsed.type === "CUSTOMERS"
    ? await validateCustomers(params.db, params.organizationId, params.parsed)
    : params.parsed.type === "ROUTES"
      ? await validateRoutes(params.db, params.organizationId, params.parsed, params.actor)
      : params.parsed.type === "SALES_FACTS"
        ? await validateSalesFacts(params.db, params.organizationId, params.parsed)
        : await validatePlanFact(params.db, params.organizationId, params.parsed)
  const summary = summaryFor(params.parsed, validated.rows, validated.errors)
  const snapshot: MtmValidatedExcelSnapshot = {
    snapshotVersion: 1,
    templateVersion: params.parsed.templateVersion,
    type: params.parsed.type,
    checksum: params.checksum,
    validatedAt: new Date().toISOString(),
    summary,
    rows: validated.rows,
  }
  return {
    snapshot,
    errors: validated.errors,
    preview: validated.rows.slice(0, 20).map((row) => ({ rowNumber: row.rowNumber, operation: row.operation, warnings: row.warnings ?? [], ...row.data })),
  }
}

export function isMtmValidatedExcelSnapshot(value: unknown): value is MtmValidatedExcelSnapshot {
  if (!value || typeof value !== "object") return false
  const snapshot = value as Partial<MtmValidatedExcelSnapshot>
  return snapshot.snapshotVersion === 1 && typeof snapshot.checksum === "string" && Array.isArray(snapshot.rows) && typeof snapshot.type === "string"
}

function asDate(value: unknown): Date {
  return new Date(`${String(value)}T00:00:00.000Z`)
}

function asNullableString(value: unknown): string | null {
  return typeof value === "string" && value ? value : null
}

function asNullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : ""
}

function asObjectArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    : []
}

async function applyCustomerRows(
  tx: Prisma.TransactionClient,
  organizationId: string,
  rows: SnapshotRow[],
): Promise<void> {
  for (const row of rows) {
    if (row.operation === "UNCHANGED") continue
    const data = row.data
    const code = asString(data.code)
    await tx.mtmCustomer.upsert({
      where: { organizationId_code: { organizationId, code } },
      create: {
        organizationId,
        code,
        objectType: asString(data.objectType) as MtmCustomerObjectType,
        name: asString(data.name),
        status: asString(data.status) as MtmCustomerStatus,
        category: asString(data.category) as MtmCustomerCategory,
        address: asNullableString(data.address),
        city: asNullableString(data.city),
        district: asNullableString(data.district),
        territoryCode: asNullableString(data.territoryCode),
        ...normalizeMtmCoordinates({ latitude: asNullableNumber(data.latitude), longitude: asNullableNumber(data.longitude) }),
        contactPerson: asNullableString(data.contactPerson),
        phone: asNullableString(data.phone),
      },
      update: {
        objectType: asString(data.objectType) as MtmCustomerObjectType,
        name: asString(data.name),
        status: asString(data.status) as MtmCustomerStatus,
        category: asString(data.category) as MtmCustomerCategory,
        address: asNullableString(data.address),
        city: asNullableString(data.city),
        district: asNullableString(data.district),
        territoryCode: asNullableString(data.territoryCode),
        ...normalizeMtmCoordinates({ latitude: asNullableNumber(data.latitude), longitude: asNullableNumber(data.longitude) }),
        contactPerson: asNullableString(data.contactPerson),
        phone: asNullableString(data.phone),
      },
    })
  }
}

async function applyRouteRows(
  tx: Prisma.TransactionClient,
  organizationId: string,
  requestedBy: string,
  rows: SnapshotRow[],
): Promise<void> {
  for (const row of rows) {
    if (row.operation === "UNCHANGED") continue
    const data = row.data
    const externalId = asString(data.externalId)
    const routeDate = asString(data.routeDate)
    const primaryAgentId = asString(data.primaryAgentId)
    const assignments = asObjectArray(data.assignments)
    const points = asObjectArray(data.points)
    let routeId = row.existingId

    if (routeId) {
      // Validation can be minutes old when a queued import reaches this
      // transaction. Recheck the live draft before replacing assignments and
      // points, rather than allowing a published route to be reset to DRAFT.
      const priorRoute = await tx.mtmRoute.findFirst({
        where: { id: routeId, organizationId, deletedAt: null },
        select: { status: true },
      })
      if (!priorRoute) throw new Error(`Route ${externalId} is no longer available for import`)
      if (priorRoute.status !== "DRAFT") throw new Error(`Route ${externalId} is no longer a draft`)

      // R6: retain removed import points as revisioned tombstones. A physical
      // delete would make an offline device keep a stop that no longer exists.
      await tx.mtmRoutePoint.updateMany({
        where: { routeId, deletedAt: null },
        data: { deletedAt: new Date(), version: { increment: 1 } },
      })
      await tx.mtmRouteAssignment.deleteMany({ where: { routeId } })
      await tx.mtmRoute.update({
        where: { id: routeId },
        data: {
          agentId: primaryAgentId,
          externalId,
          date: asDate(routeDate),
          name: asNullableString(data.routeName),
          dedupeKey: asString(data.dedupeKey),
          totalPoints: points.length,
          status: "DRAFT",
          version: { increment: 1 },
          assignments: {
            create: assignments.map((assignment) => ({
              organizationId,
              agentId: asString(assignment.agentId),
              role: asString(assignment.role) as "PRIMARY" | "PARTICIPANT" | "OBSERVER",
              assignedBy: requestedBy,
            })),
          },
          points: {
            create: points.map((point) => ({
              organizationId,
              customerId: asString(point.customerId),
              orderIndex: Number(point.orderIndex),
              plannedTime: point.plannedTime ? new Date(`${routeDate}T${asString(point.plannedTime)}:00.000Z`) : null,
              notes: asNullableString(point.notes),
            })),
          },
        },
      })
    } else {
      const created = await tx.mtmRoute.create({
        data: {
          organizationId,
          agentId: primaryAgentId,
          externalId,
          date: asDate(routeDate),
          name: asNullableString(data.routeName),
          dedupeKey: asString(data.dedupeKey),
          totalPoints: points.length,
          status: "DRAFT",
          assignments: {
            create: assignments.map((assignment) => ({
              organizationId,
              agentId: asString(assignment.agentId),
              role: asString(assignment.role) as "PRIMARY" | "PARTICIPANT" | "OBSERVER",
              assignedBy: requestedBy,
            })),
          },
          points: {
            create: points.map((point) => ({
              organizationId,
              customerId: asString(point.customerId),
              orderIndex: Number(point.orderIndex),
              plannedTime: point.plannedTime ? new Date(`${routeDate}T${asString(point.plannedTime)}:00.000Z`) : null,
              notes: asNullableString(point.notes),
            })),
          },
        },
        select: { id: true },
      })
      routeId = created.id
    }
    if (!routeId) throw new Error(`Route ${externalId} was not persisted`)
  }
}

async function applySalesRows(
  tx: Prisma.TransactionClient,
  organizationId: string,
  jobId: string,
  rows: SnapshotRow[],
): Promise<void> {
  for (const row of rows) {
    if (row.operation === "UNCHANGED") continue
    const data = row.data
    const documentNo = asString(data.documentNo)
    const documentDate = asDate(data.documentDate)
    const document = await tx.mtmExternalSalesDocument.upsert({
      where: { organizationId_externalDocumentNo_documentDate: { organizationId, externalDocumentNo: documentNo, documentDate } },
      create: {
        organizationId,
        externalDocumentNo: documentNo,
        documentDate,
        customerId: asString(data.customerId),
        agentId: asNullableString(data.agentId),
        status: asString(data.status) as MtmExternalDocumentStatus,
        currency: asString(data.currency),
        sourceImportJobId: jobId,
      },
      update: {
        customerId: asString(data.customerId),
        agentId: asNullableString(data.agentId),
        status: asString(data.status) as MtmExternalDocumentStatus,
        currency: asString(data.currency),
        sourceImportJobId: jobId,
      },
      select: { id: true },
    })
    const lineNumber = Number(data.lineNumber)
    await tx.mtmExternalSalesLine.upsert({
      where: { documentId_lineNumber: { documentId: document.id, lineNumber } },
      create: {
        organizationId,
        documentId: document.id,
        lineNumber,
        productCode: asString(data.productCode),
        productName: asString(data.productName),
        quantity: new Prisma.Decimal(Number(data.quantity)),
        unit: asNullableString(data.unit),
        amount: asNullableNumber(data.amount) == null ? null : new Prisma.Decimal(asNullableNumber(data.amount)!),
      },
      update: {
        productCode: asString(data.productCode),
        productName: asString(data.productName),
        quantity: new Prisma.Decimal(Number(data.quantity)),
        unit: asNullableString(data.unit),
        amount: asNullableNumber(data.amount) == null ? null : new Prisma.Decimal(asNullableNumber(data.amount)!),
      },
    })
  }

  const documentIds = await tx.mtmExternalSalesDocument.findMany({ where: { organizationId, sourceImportJobId: jobId }, select: { id: true } })
  for (const document of documentIds) {
    const aggregate = await tx.mtmExternalSalesLine.aggregate({ where: { documentId: document.id }, _sum: { amount: true } })
    await tx.mtmExternalSalesDocument.update({ where: { id: document.id }, data: { totalAmount: aggregate._sum.amount } })
  }
}

async function applyPlanRows(
  tx: Prisma.TransactionClient,
  organizationId: string,
  jobId: string,
  rows: SnapshotRow[],
): Promise<void> {
  for (const row of rows) {
    if (row.operation === "UNCHANGED") continue
    const data = row.data
    const dedupeKey = asString(data.dedupeKey)
    const plannedQuantity = asNullableNumber(data.plannedQuantity)
    const plannedAmount = asNullableNumber(data.plannedAmount)
    await tx.mtmSalesPlanLine.upsert({
      where: { organizationId_dedupeKey: { organizationId, dedupeKey } },
      create: {
        organizationId,
        dedupeKey,
        periodStart: asDate(data.periodStart),
        customerId: asNullableString(data.customerId),
        agentId: asNullableString(data.agentId),
        territoryCode: asNullableString(data.territoryCode),
        productCode: asNullableString(data.productCode),
        plannedQuantity: plannedQuantity == null ? null : new Prisma.Decimal(plannedQuantity),
        plannedAmount: plannedAmount == null ? null : new Prisma.Decimal(plannedAmount),
        currency: asString(data.currency),
        sourceImportJobId: jobId,
      },
      update: {
        plannedQuantity: plannedQuantity == null ? null : new Prisma.Decimal(plannedQuantity),
        plannedAmount: plannedAmount == null ? null : new Prisma.Decimal(plannedAmount),
        currency: asString(data.currency),
        sourceImportJobId: jobId,
      },
    })
  }
}

export async function applyMtmExcelImportJob(params: {
  db: AppPrisma
  organizationId: string
  jobId: string
  requestedBy: string
  allowConflictOverride: boolean
}): Promise<{ status: string; replayed: boolean; summary: MtmExcelSummary }> {
  return params.db.$transaction(async (tx: Prisma.TransactionClient) => {
    const job = await tx.mtmImportJob.findFirst({ where: { id: params.jobId, organizationId: params.organizationId } })
    if (!job) throw new Error("Import job not found")
    const snapshot = job.validatedSnapshot
    if (!isMtmValidatedExcelSnapshot(snapshot) || snapshot.checksum !== job.fileChecksum) throw new Error("Validated snapshot is missing or does not match the file checksum")
    if (job.status === "COMPLETED" || job.status === "COMPLETED_WITH_ERRORS") {
      return { status: job.status, replayed: true, summary: snapshot.summary }
    }
    if (job.status !== "READY") throw new Error(`Import job is not ready (status ${job.status})`)
    if (snapshot.summary.errorRows > 0) throw new Error("Import contains validation errors")
    if (snapshot.summary.requiresConflictOverride && !params.allowConflictOverride) throw new Error("Route conflicts require an explicit manager override")

    const claim = await tx.mtmImportJob.updateMany({
      where: { id: job.id, organizationId: params.organizationId, status: "READY" },
      data: { status: "APPLYING", applyMode: params.allowConflictOverride ? "ALLOW_CONFLICTS" : "STRICT" },
    })
    if (claim.count !== 1) throw new Error("Import job was already claimed")

    if (snapshot.type === "CUSTOMERS") await applyCustomerRows(tx, params.organizationId, snapshot.rows)
    else if (snapshot.type === "ROUTES") await applyRouteRows(tx, params.organizationId, params.requestedBy, snapshot.rows)
    else if (snapshot.type === "SALES_FACTS") await applySalesRows(tx, params.organizationId, job.id, snapshot.rows)
    else await applyPlanRows(tx, params.organizationId, job.id, snapshot.rows)

    const finalStatus = snapshot.summary.errorRows > 0 ? "COMPLETED_WITH_ERRORS" : "COMPLETED"
    await tx.mtmImportJob.update({ where: { id: job.id }, data: { status: finalStatus, appliedAt: new Date() } })
    await tx.mtmAuditLog.create({
      data: {
        organizationId: params.organizationId,
        agentId: null,
        action: "IMPORT_APPLY",
        entity: "import_job",
        entityId: job.id,
        metadataKind: "mtm_import_apply",
        newData: {
          type: snapshot.type,
          checksum: snapshot.checksum,
          summary: snapshot.summary,
          requestedBy: params.requestedBy,
          conflictOverride: params.allowConflictOverride,
        } as unknown as Prisma.InputJsonValue,
      },
    })
    return { status: finalStatus, replayed: false, summary: snapshot.summary }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 120_000 })
}
