/**
 * Smart AI Search — read-only tool definitions.
 *
 * These tools let the Da Vinci chat loop RETRIEVE records (invoices, deals,
 * tasks, tickets, contacts) and render them as a structured table, as opposed
 * to the write tools in `tools.ts` which mutate CRM data behind an approval
 * gate. Read tools never write, never need approval, and are gated behind the
 * `ai_smart_search` org feature flag.
 *
 * Anti-hallucination contract: each tool's filter object is a CLOSED whitelist
 * enforced by a Zod `.strict()` schema (see READ_TOOL_SCHEMAS). The LLM cannot
 * invent field names — an unknown key makes the parse fail and the tool returns
 * an "Invalid filter" error instead of silently dropping it into a Prisma WHERE.
 *
 * Field/model names below were grepped against prisma/schema.prisma
 * (Invoice@3141, Deal@937, Task@1075, Ticket@1924, Contact@859).
 */
import type { Tool } from "@anthropic-ai/sdk/resources/messages"
import { z } from "zod"
import type { ToolMeta } from "./tools"
import type { ModuleId } from "@/lib/modules"
import type { Module as PermissionModule } from "@/lib/permissions"

export type ReadEntityType = "invoice" | "deal" | "task" | "ticket" | "contact"

export type CellType = "text" | "number" | "currency" | "date" | "datetime" | "status" | "badge"

export interface ReadColumn {
  /** row.cells key this column reads */
  key: string
  /** stable key resolved to a localized header client-side (UI_TEXT.search.columns) */
  labelKey: string
  /** English fallback header if labelKey is missing on the client */
  label: string
  type: CellType
}

export interface ReadResultRow {
  id: string
  href?: string
  cells: Record<string, string | number | null>
}

export interface ReadResultData {
  entityType: ReadEntityType
  columns: ReadColumn[]
  rows: ReadResultRow[]
  /** full count matching the filter (may exceed rows.length) */
  total: number
  /** rows actually returned */
  returned: number
  /** true when the full count exceeds the returned rows */
  truncated?: boolean
  /** link to the real filtered module list page */
  listHref?: string
}

export const DEFAULT_LIMIT = 20
export const HARD_LIMIT = 50

// limit: positive int. The MAX is enforced in the executor (clamp to HARD_LIMIT)
// as defense-in-depth — keeping the cap as live, tested code rather than a Zod
// bound the LLM could trip on a benign "show me all".
const limitField = z.number().int().positive().optional()
const isoDateValue = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD")
  .refine((value) => {
    const [year, month, day] = value.split("-").map(Number)
    const parsed = new Date(Date.UTC(year, month - 1, day))
    return parsed.getUTCFullYear() === year
      && parsed.getUTCMonth() === month - 1
      && parsed.getUTCDate() === day
  }, "Expected a real calendar date")
const isoDate = isoDateValue.optional()
const id = z.string().min(1).optional()

/** Closed filter whitelists — `.strict()` rejects any field the LLM invents. */
export const READ_TOOL_SCHEMAS = {
  list_invoices: z
    .object({
      status: z
        .enum(["draft", "sent", "viewed", "partially_paid", "paid", "overdue", "cancelled", "refunded"])
        .optional(),
      dateFrom: isoDate,
      dateTo: isoDate,
      minAmount: z.number().optional(),
      maxAmount: z.number().optional(),
      companyId: id,
      contactId: id,
      limit: limitField,
    })
    .strict(),
  list_deals: z
    .object({
      stage: z.string().min(1).optional(),
      minValue: z.number().optional(),
      maxValue: z.number().optional(),
      pipelineId: id,
      companyId: id,
      assignedTo: z.string().min(1).optional(), // "me" → caller, else userId
      dateFrom: isoDate,
      dateTo: isoDate,
      limit: limitField,
    })
    .strict(),
  list_tasks: z
    .object({
      // Legacy (pending|completed|cancelled) + Kanban statuses accepted; an
      // unknown value just yields 0 rows (schema comment @ schema.prisma:1081).
      status: z
        .enum(["pending", "completed", "cancelled", "backlog", "todo", "in_progress", "testing", "review", "done"])
        .optional(),
      priority: z.enum(["low", "medium", "high"]).optional(),
      assignedTo: z.string().min(1).optional(),
      dueBefore: isoDate,
      dueAfter: isoDate,
      relatedType: z.enum(["deal", "contact", "company", "lead", "ticket"]).optional(),
      limit: limitField,
    })
    .strict(),
  list_tickets: z
    .object({
      status: z.enum(["new", "open", "in_progress", "waiting", "resolved", "closed"]).optional(),
      priority: z.enum(["low", "medium", "high", "critical"]).optional(),
      category: z.string().min(1).optional(),
      assignedTo: z.string().min(1).optional(),
      companyId: id,
      contactId: id,
      dateFrom: isoDate,
      dateTo: isoDate,
      limit: limitField,
    })
    .strict(),
  list_contacts: z
    .object({
      companyId: id,
      category: z.enum(["vip", "regular", "partner", "prospect", "inactive"]).optional(),
      isActive: z.boolean().optional(),
      tag: z.string().min(1).optional(),
      search: z.string().min(1).optional(),
      limit: limitField,
    })
    .strict(),
} as const

export type ReadToolName = keyof typeof READ_TOOL_SCHEMAS

export const READ_TOOL_NAMES: string[] = Object.keys(READ_TOOL_SCHEMAS)

export const READ_TOOL_META: Record<string, ToolMeta> = Object.fromEntries(
  READ_TOOL_NAMES.map((name) => [name, { riskLevel: "low" as const, category: "read", requiresApproval: false }]),
)

// Each read tool's owning group-module. The chat route drops a read tool when
// the org doesn't have its module enabled — so search only ever spans the
// modules the client actually has (matches the nav-items module mapping).
export const READ_TOOL_MODULE: Record<string, ModuleId> = {
  list_invoices: "finance",
  list_deals: "sales",
  list_tasks: "crm",
  list_tickets: "support",
  list_contacts: "crm",
}

/** RBAC scope paired with each read tool; the executor enforces this again. */
export const READ_TOOL_PERMISSION: Record<string, PermissionModule> = {
  list_invoices: "invoices",
  list_deals: "deals",
  list_tasks: "tasks",
  list_tickets: "tickets",
  list_contacts: "contacts",
}

/* ─── Column definitions (kept tight — the 380px panel shows ~4) ──────────── */

export const READ_COLUMNS: Record<ReadEntityType, ReadColumn[]> = {
  invoice: [
    { key: "invoiceNumber", labelKey: "number", label: "Invoice #", type: "text" },
    { key: "status", labelKey: "status", label: "Status", type: "status" },
    { key: "totalAmount", labelKey: "amount", label: "Amount", type: "currency" },
    { key: "issueDate", labelKey: "date", label: "Date", type: "date" },
  ],
  deal: [
    { key: "name", labelKey: "name", label: "Name", type: "text" },
    { key: "stage", labelKey: "stage", label: "Stage", type: "badge" },
    { key: "valueAmount", labelKey: "amount", label: "Value", type: "currency" },
    { key: "expectedClose", labelKey: "closeDate", label: "Close", type: "date" },
  ],
  task: [
    { key: "title", labelKey: "title", label: "Title", type: "text" },
    { key: "status", labelKey: "status", label: "Status", type: "badge" },
    { key: "priority", labelKey: "priority", label: "Priority", type: "badge" },
    { key: "dueDate", labelKey: "dueDate", label: "Due", type: "date" },
  ],
  ticket: [
    { key: "ticketNumber", labelKey: "number", label: "Ticket #", type: "text" },
    { key: "subject", labelKey: "subject", label: "Subject", type: "text" },
    { key: "status", labelKey: "status", label: "Status", type: "status" },
    { key: "priority", labelKey: "priority", label: "Priority", type: "badge" },
  ],
  contact: [
    { key: "fullName", labelKey: "name", label: "Name", type: "text" },
    { key: "email", labelKey: "email", label: "Email", type: "text" },
    { key: "phone", labelKey: "phone", label: "Phone", type: "text" },
    { key: "category", labelKey: "category", label: "Category", type: "badge" },
  ],
}

/* ─── Anthropic tool schemas (what the LLM sees) ──────────────────────────── */

const limitDesc = "Max rows to return (1-50, default 20)"

export const READ_TOOLS: Tool[] = [
  {
    name: "list_invoices",
    description:
      "Retrieve a read-only list of invoices, optionally filtered by status, issue-date range, total-amount range, or related company/contact. Returns a results table. Use when the user asks to see, list, find, or filter invoices.",
    input_schema: {
      type: "object" as const,
      properties: {
        status: {
          type: "string",
          enum: ["draft", "sent", "viewed", "partially_paid", "paid", "overdue", "cancelled", "refunded"],
        },
        dateFrom: { type: "string", description: "ISO date — invoices issued on/after this date" },
        dateTo: { type: "string", description: "ISO date — invoices issued on/before this date" },
        minAmount: { type: "number", description: "Minimum total amount" },
        maxAmount: { type: "number", description: "Maximum total amount" },
        companyId: { type: "string" },
        contactId: { type: "string" },
        limit: { type: "number", description: limitDesc },
      },
    },
  },
  {
    name: "list_deals",
    description:
      "Retrieve a read-only list of deals, optionally filtered by pipeline stage, value range, pipeline, company, assignee, or created-date range. Returns a results table. Use when the user asks to see, list, find, or filter deals.",
    input_schema: {
      type: "object" as const,
      properties: {
        stage: { type: "string", description: "Pipeline stage name (org-defined, e.g. LEAD, QUALIFIED, PROPOSAL)" },
        minValue: { type: "number", description: "Minimum deal value" },
        maxValue: { type: "number", description: "Maximum deal value" },
        pipelineId: { type: "string" },
        companyId: { type: "string" },
        assignedTo: { type: "string", description: "User ID, or 'me' for the current user" },
        dateFrom: { type: "string", description: "ISO date — deals created on/after this date" },
        dateTo: { type: "string", description: "ISO date — deals created on/before this date" },
        limit: { type: "number", description: limitDesc },
      },
    },
  },
  {
    name: "list_tasks",
    description:
      "Retrieve a read-only list of tasks, optionally filtered by status, priority, assignee, due-date range, or related record type. Returns a results table. Use when the user asks to see, list, find, or filter tasks.",
    input_schema: {
      type: "object" as const,
      properties: {
        status: {
          type: "string",
          enum: ["pending", "completed", "cancelled", "backlog", "todo", "in_progress", "testing", "review", "done"],
        },
        priority: { type: "string", enum: ["low", "medium", "high"] },
        assignedTo: { type: "string", description: "User ID, or 'me' for the current user" },
        dueBefore: { type: "string", description: "ISO date — tasks due on/before this date" },
        dueAfter: { type: "string", description: "ISO date — tasks due on/after this date" },
        relatedType: { type: "string", enum: ["deal", "contact", "company", "lead", "ticket"] },
        limit: { type: "number", description: limitDesc },
      },
    },
  },
  {
    name: "list_tickets",
    description:
      "Retrieve a read-only list of support tickets, optionally filtered by status, priority, category, assignee, or related company/contact. Returns a results table. Use when the user asks to see, list, find, or filter tickets.",
    input_schema: {
      type: "object" as const,
      properties: {
        status: { type: "string", enum: ["new", "open", "in_progress", "waiting", "resolved", "closed"] },
        priority: { type: "string", enum: ["low", "medium", "high", "critical"] },
        category: { type: "string" },
        assignedTo: { type: "string", description: "User ID, or 'me' for the current user" },
        companyId: { type: "string" },
        contactId: { type: "string" },
        dateFrom: { type: "string", description: "ISO date — tickets created on/after this date" },
        dateTo: { type: "string", description: "ISO date — tickets created on/before this date" },
        limit: { type: "number", description: limitDesc },
      },
    },
  },
  {
    name: "list_contacts",
    description:
      "Retrieve a read-only list of contacts, optionally filtered by company, category, active flag, tag, or a free-text name/email search. Returns a results table. Use when the user asks to see, list, find, or filter contacts.",
    input_schema: {
      type: "object" as const,
      properties: {
        companyId: { type: "string" },
        category: { type: "string", enum: ["vip", "regular", "partner", "prospect", "inactive"] },
        isActive: { type: "boolean" },
        tag: { type: "string", description: "Match a single tag on the contact" },
        search: { type: "string", description: "Case-insensitive match on full name or email" },
        limit: { type: "number", description: limitDesc },
      },
    },
  },
]
