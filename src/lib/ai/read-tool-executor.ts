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
import { canRead, type Role } from "@/lib/permissions"
import { applyRecordFilter } from "@/lib/sharing-rules"
import { buildTaskListWhere, parseTaskListFilters } from "@/lib/tasks/list-query"
import { canUseVoiceDataFields } from "@/lib/ai/voice/field-access"
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
  role: Role
  timezone: string
}

/**
 * Narrow a list to what this person's own screen shows (owner 2026-11-26:
 * Da Vinci answers every employee "within their rights"). The rules are the
 * screens' own, not a copy:
 *  - deals and tickets: `applyRecordFilter` - own, assigned, the shared
 *    intake queue and sharing-rule grants (managers and above: everything);
 *  - tasks: `buildTaskListWhere`, the builder of the task list and its
 *    export - sharing rules plus board access and department isolation,
 *    which binds managers too;
 *  - contacts: `applyRecordFilter` as well (today tenant-wide, as on screen);
 *  - invoices: tenant-wide for every role that may read them, as on screen.
 * Null means the screen would show nothing.
 */
async function visibleWhere(
  entity: ReadEntityType,
  where: Record<string, any>,
  ctx: ReadCtx,
): Promise<Record<string, any> | null> {
  switch (entity) {
    case "deal":
    case "ticket":
    case "contact":
      return await applyRecordFilter(ctx.orgId, ctx.userId, ctx.role, entity, where) as Record<string, any>
    case "task": {
      const access = await buildTaskListWhere(ctx.orgId, ctx.userId, ctx.role, parseTaskListFilters(new URLSearchParams()))
      if (access.blocked) return null
      // AND-ed beside the list's own filters, which stay where they were.
      return { ...where, AND: [...(Array.isArray(where.AND) ? where.AND : []), access.where] }
    }
    case "invoice":
      return where
  }
}

const READ_TOOL_ENTITY: Record<string, ReadEntityType> = {
  list_invoices: "invoice",
  list_deals: "deal",
  list_tasks: "task",
  list_tickets: "ticket",
  list_contacts: "contact",
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

  const scoped = await visibleWhere("invoice", where, ctx)
  if (!scoped) return buildResult("invoice", [], 0, "/invoices")

  const take = clampLimit(input.limit)
  const [records, total] = await Promise.all([
    prisma.invoice.findMany({
      where: scoped,
      orderBy: { issueDate: "desc" },
      take,
      select: { id: true, invoiceNumber: true, status: true, totalAmount: true, currency: true, issueDate: true },
    }),
    prisma.invoice.count({ where: scoped }),
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

  const scoped = await visibleWhere("deal", where, ctx)
  if (!scoped) return buildResult("deal", [], 0, "/deals")

  const take = clampLimit(input.limit)
  const [records, total] = await Promise.all([
    prisma.deal.findMany({
      where: scoped,
      orderBy: { createdAt: "desc" },
      take,
      select: { id: true, name: true, stage: true, valueAmount: true, currency: true, expectedClose: true },
    }),
    prisma.deal.count({ where: scoped }),
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

  const scoped = await visibleWhere("task", where, ctx)
  if (!scoped) return buildResult("task", [], 0, "/tasks")

  const take = clampLimit(input.limit)
  const [records, total] = await Promise.all([
    prisma.task.findMany({
      where: scoped,
      orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
      take,
      select: { id: true, title: true, status: true, priority: true, dueDate: true },
    }),
    prisma.task.count({ where: scoped }),
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

  const scoped = await visibleWhere("ticket", where, ctx)
  if (!scoped) return buildResult("ticket", [], 0, "/tickets")

  const take = clampLimit(input.limit)
  const [records, total] = await Promise.all([
    prisma.ticket.findMany({
      where: scoped,
      orderBy: { createdAt: "desc" },
      take,
      select: { id: true, ticketNumber: true, subject: true, status: true, priority: true },
    }),
    prisma.ticket.count({ where: scoped }),
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

  const scoped = await visibleWhere("contact", where, ctx)
  if (!scoped) return buildResult("contact", [], 0, "/contacts")

  const take = clampLimit(input.limit)
  const [records, total] = await Promise.all([
    prisma.contact.findMany({
      where: scoped,
      orderBy: { createdAt: "desc" },
      take,
      select: { id: true, fullName: true, email: true, phone: true, category: true },
    }),
    prisma.contact.count({ where: scoped }),
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
  // A field the role must not see cannot be picked out of a row the model
  // has already read, so a role with any hidden field on this entity gets no
  // list at all - the same fail-closed rule as the voice reads.
  const entity = READ_TOOL_ENTITY[toolName]
  try {
    if (!entity || !await canUseVoiceDataFields(orgId, role, [entity])) {
      return { success: false, error: "ACCESS_SCOPE_UNAVAILABLE" }
    }
  } catch {
    return { success: false, error: "ACCESS_SCOPE_UNAVAILABLE" }
  }

  const parsed = schema.safeParse(input ?? {})
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join(".") || "filter"}: ${i.message}`).join("; ")
    return { success: false, error: `Invalid filter: ${msg}` }
  }
  const filter = parsed.data as any
  const ctx: ReadCtx = { orgId, userId, role, timezone }

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
