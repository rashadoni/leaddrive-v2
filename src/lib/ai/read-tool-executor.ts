/**
 * Smart AI Search — read-only tool executor.
 *
 * Validates the LLM-proposed filter with the tool's Zod `.strict()` schema
 * (closed whitelist → no hallucinated fields reach Prisma), runs an org-scoped
 * query inside the caller's RLS tenant context, and returns a typed
 * `ReadResultData` the UI renders as a table.
 *
 * Safety invariants:
 *  - every WHERE pins `organizationId` (defense-in-depth atop fail-closed RLS);
 *  - results are bounded by HARD_LIMIT;
 *  - no create/update/delete — read-only by construction;
 *  - audit logs the entity + row count only, never the free-text search value.
 */
import { prisma, logAudit } from "@/lib/prisma"
import { decimalToNumber } from "@/lib/prisma-decimal"
import { isManagerOrAbove } from "@/lib/constants"
import { canRead, type Role } from "@/lib/permissions"
import { localDateTimeToUtc } from "@/lib/timezone"
import type { ToolResult } from "./tool-executor"
import {
  READ_TOOL_SCHEMAS,
  READ_COLUMNS,
  DEFAULT_LIMIT,
  HARD_LIMIT,
  READ_TOOL_PERMISSION,
  type ReadResultData,
  type ReadResultRow,
  type ReadEntityType,
} from "./read-tools"

interface ReadCtx {
  orgId: string
  userId: string
  timezone: string
}

/** Defense-in-depth cap — the Zod schema has no max, so this is the live limit. */
function clampLimit(limit?: number): number {
  if (!limit || limit < 1) return DEFAULT_LIMIT
  return Math.min(Math.floor(limit), HARD_LIMIT)
}

/** Resolve an assignee filter — "me" maps to the caller. */
function resolveAssignee(value: string | undefined, userId: string): string | undefined {
  if (!value) return undefined
  return value === "me" ? userId : value
}

function isoOrNull(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null
}

function nextDateKey(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) throw new Error("Invalid date filter")
  const shifted = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + 1))
  return `${shifted.getUTCFullYear().toString().padStart(4, "0")}-${(shifted.getUTCMonth() + 1).toString().padStart(2, "0")}-${shifted.getUTCDate().toString().padStart(2, "0")}`
}

function dateRange(
  from: string | undefined,
  to: string | undefined,
  timezone: string,
): { gte?: Date; lt?: Date } | undefined {
  if (!from && !to) return undefined
  const range: { gte?: Date; lt?: Date } = {}
  if (from) range.gte = localDateTimeToUtc(`${from}T00:00`, timezone)
  // dateTo is an inclusive user-local calendar date. Prisma receives the next
  // local midnight as an exclusive bound so the entire day is included.
  if (to) range.lt = localDateTimeToUtc(`${nextDateKey(to)}T00:00`, timezone)
  return range
}

function numberRange(min?: number, max?: number): { gte?: number; lte?: number } | undefined {
  if (min == null && max == null) return undefined
  const range: { gte?: number; lte?: number } = {}
  if (min != null) range.gte = min
  if (max != null) range.lte = max
  return range
}

function buildResult(
  entityType: ReadEntityType,
  rows: ReadResultRow[],
  total: number,
  listHref: string,
): ReadResultData {
  return {
    entityType,
    columns: READ_COLUMNS[entityType],
    rows,
    total,
    returned: rows.length,
    truncated: total > rows.length,
    listHref,
  }
}

/* ─── Per-entity builders ─────────────────────────────────────────────────── */

async function listInvoices(input: any, ctx: ReadCtx): Promise<ReadResultData> {
  const where: Record<string, any> = { organizationId: ctx.orgId }
  if (input.status) where.status = input.status
  if (input.companyId) where.companyId = input.companyId
  if (input.contactId) where.contactId = input.contactId
  const issue = dateRange(input.dateFrom, input.dateTo, ctx.timezone)
  if (issue) where.issueDate = issue
  const amount = numberRange(input.minAmount, input.maxAmount)
  if (amount) where.totalAmount = amount

  const take = clampLimit(input.limit)
  const [records, total] = await Promise.all([
    prisma.invoice.findMany({
      where,
      orderBy: { issueDate: "desc" },
      take,
      select: { id: true, invoiceNumber: true, status: true, totalAmount: true, currency: true, issueDate: true },
    }),
    prisma.invoice.count({ where }),
  ])

  const rows: ReadResultRow[] = records.map((r: any) => ({
    id: r.id,
    href: `/invoices/${r.id}`,
    cells: {
      invoiceNumber: r.invoiceNumber,
      status: r.status,
      totalAmount: decimalToNumber(r.totalAmount),
      currency: r.currency,
      issueDate: isoOrNull(r.issueDate),
    },
  }))
  return buildResult("invoice", rows, total, "/invoices")
}

async function listDeals(input: any, ctx: ReadCtx): Promise<ReadResultData> {
  const where: Record<string, any> = { organizationId: ctx.orgId }
  if (input.stage) where.stage = input.stage
  if (input.pipelineId) where.pipelineId = input.pipelineId
  if (input.companyId) where.companyId = input.companyId
  const assignee = resolveAssignee(input.assignedTo, ctx.userId)
  if (assignee) where.assignedTo = assignee
  const value = numberRange(input.minValue, input.maxValue)
  if (value) where.valueAmount = value
  const created = dateRange(input.dateFrom, input.dateTo, ctx.timezone)
  if (created) where.createdAt = created

  const take = clampLimit(input.limit)
  const [records, total] = await Promise.all([
    prisma.deal.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take,
      select: { id: true, name: true, stage: true, valueAmount: true, currency: true, expectedClose: true },
    }),
    prisma.deal.count({ where }),
  ])

  const rows: ReadResultRow[] = records.map((r: any) => ({
    id: r.id,
    href: `/deals/${r.id}`,
    cells: {
      name: r.name,
      stage: r.stage,
      valueAmount: decimalToNumber(r.valueAmount),
      currency: r.currency,
      expectedClose: isoOrNull(r.expectedClose),
    },
  }))
  return buildResult("deal", rows, total, "/deals")
}

async function listTasks(input: any, ctx: ReadCtx): Promise<ReadResultData> {
  // Task is the only one of the five with soft-delete. The prisma `task`
  // extension already injects `deletedAt: null` on findMany/count, but we set it
  // explicitly for parity with the canonical builder (src/lib/tasks/list-query.ts)
  // and so the unit test (which mocks prisma, bypassing the extension) can assert it.
  const where: Record<string, any> = { organizationId: ctx.orgId, deletedAt: null }
  if (input.status) where.status = input.status
  if (input.priority) where.priority = input.priority
  if (input.relatedType) where.relatedType = input.relatedType
  const assignee = resolveAssignee(input.assignedTo, ctx.userId)
  if (assignee) where.assignedTo = assignee
  const due = dateRange(input.dueAfter, input.dueBefore, ctx.timezone)
  if (due) where.dueDate = due

  const take = clampLimit(input.limit)
  const [records, total] = await Promise.all([
    prisma.task.findMany({
      where,
      orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
      take,
      select: { id: true, title: true, status: true, priority: true, dueDate: true },
    }),
    prisma.task.count({ where }),
  ])

  const rows: ReadResultRow[] = records.map((r: any) => ({
    id: r.id,
    href: `/tasks/${r.id}`,
    cells: {
      title: r.title,
      status: r.status,
      priority: r.priority,
      dueDate: isoOrNull(r.dueDate),
    },
  }))
  return buildResult("task", rows, total, "/tasks")
}

async function listTickets(input: any, ctx: ReadCtx): Promise<ReadResultData> {
  const where: Record<string, any> = { organizationId: ctx.orgId }
  if (input.status) where.status = input.status
  if (input.priority) where.priority = input.priority
  if (input.category) where.category = input.category
  if (input.companyId) where.companyId = input.companyId
  if (input.contactId) where.contactId = input.contactId
  const assignee = resolveAssignee(input.assignedTo, ctx.userId)
  if (assignee) where.assignedTo = assignee
  const created = dateRange(input.dateFrom, input.dateTo, ctx.timezone)
  if (created) where.createdAt = created

  const take = clampLimit(input.limit)
  const [records, total] = await Promise.all([
    prisma.ticket.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take,
      select: { id: true, ticketNumber: true, subject: true, status: true, priority: true },
    }),
    prisma.ticket.count({ where }),
  ])

  const rows: ReadResultRow[] = records.map((r: any) => ({
    id: r.id,
    href: `/tickets/${r.id}`,
    cells: {
      ticketNumber: r.ticketNumber,
      subject: r.subject,
      status: r.status,
      priority: r.priority,
    },
  }))
  return buildResult("ticket", rows, total, "/tickets")
}

async function listContacts(input: any, ctx: ReadCtx): Promise<ReadResultData> {
  const where: Record<string, any> = { organizationId: ctx.orgId }
  if (input.companyId) where.companyId = input.companyId
  if (input.category) where.category = input.category
  if (typeof input.isActive === "boolean") where.isActive = input.isActive
  if (input.tag) where.tags = { has: input.tag }
  if (input.search) {
    where.OR = [
      { fullName: { contains: input.search, mode: "insensitive" } },
      { email: { contains: input.search, mode: "insensitive" } },
    ]
  }

  const take = clampLimit(input.limit)
  const [records, total] = await Promise.all([
    prisma.contact.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take,
      select: { id: true, fullName: true, email: true, phone: true, category: true },
    }),
    prisma.contact.count({ where }),
  ])

  const rows: ReadResultRow[] = records.map((r: any) => ({
    id: r.id,
    href: `/contacts/${r.id}`,
    cells: {
      fullName: r.fullName,
      email: r.email,
      phone: r.phone,
      category: r.category,
    },
  }))
  return buildResult("contact", rows, total, "/contacts")
}

/* ─── Dispatcher ──────────────────────────────────────────────────────────── */

export async function executeReadTool(
  toolName: string,
  input: Record<string, any>,
  orgId: string,
  userId: string,
  role?: Role,
  timezone = "UTC",
): Promise<ToolResult> {
  const schema = READ_TOOL_SCHEMAS[toolName as keyof typeof READ_TOOL_SCHEMAS]
  if (!schema) return { success: false, error: `Unknown read tool: ${toolName}` }

  const permission = READ_TOOL_PERMISSION[toolName]
  if (!role || !permission || !canRead(role, permission)) {
    return { success: false, error: "This CRM list is not permitted for your role." }
  }
  // These builders currently return tenant-wide rows and totals. Lower roles
  // use entity-specific record-sharing rules in the canonical list APIs; until
  // those filters are applied here exactly, fail closed rather than leak other
  // employees' records through AI search.
  if (!isManagerOrAbove(role)) {
    return { success: false, error: "Organization-wide AI search requires a manager role." }
  }

  const parsed = schema.safeParse(input ?? {})
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join(".") || "filter"}: ${i.message}`).join("; ")
    return { success: false, error: `Invalid filter: ${msg}` }
  }
  const filter = parsed.data as any
  const ctx: ReadCtx = { orgId, userId, timezone }

  try {
    let data: ReadResultData
    switch (toolName) {
      case "list_invoices":
        data = await listInvoices(filter, ctx)
        break
      case "list_deals":
        data = await listDeals(filter, ctx)
        break
      case "list_tasks":
        data = await listTasks(filter, ctx)
        break
      case "list_tickets":
        data = await listTickets(filter, ctx)
        break
      case "list_contacts":
        data = await listContacts(filter, ctx)
        break
      default:
        return { success: false, error: `Unknown read tool: ${toolName}` }
    }
    // Audit: entity + row count only. NEVER log the free-text `search` value (PII).
    logAudit(orgId, "ai_read", toolName, "", `AI read: ${data.entityType} (${data.returned} rows)`)
    return { success: true, data }
  } catch (err: any) {
    console.error(`Read tool error [${toolName}]:`, err)
    return { success: false, error: err.message || "Read failed" }
  }
}
