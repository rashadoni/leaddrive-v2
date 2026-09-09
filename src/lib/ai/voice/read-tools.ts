/**
 * The voice tool surface: what the agent may ask for, and how the answer is
 * shaped before it is spoken.
 *
 * Everything here is READ-ONLY. Nothing from src/lib/ai/tools.ts (create_deal,
 * send_email, update_contact, create_ticket …) is reachable from voice in this
 * phase — see the module comment on the dispatch route for why.
 */
import { z } from "zod"
import type { ModuleId } from "@/lib/modules"
import { RECORD_TYPE_NAMES, VOICE_READABLE_TYPES } from "./record-types"

/** Reusable list tools, delegated to the existing read executor. */
export const VOICE_LIST_TOOLS = [
  "list_deals",
  "list_invoices",
  "list_tasks",
  "list_tickets",
  "list_contacts",
] as const

/** Voice-only summaries — aggregates, never rows. */
export const VOICE_SUMMARY_TOOLS = [
  "get_daily_briefing",
  "get_pipeline_by_stage",
  "get_sales_by_manager",
  "get_overdue",
  "find_record",
  "get_leads_summary",
  "get_marketing_summary",
  "get_forecast_summary",
  "get_boards_summary",
  "get_workload_by_person",
  "describe_section",
  "explain_section",
  "get_quotes_summary",
  "get_inbox_summary",
  "get_field_summary",
  "get_sales_in_period",
  "get_lead_coverage",
  "read_record",
] as const

export type VoiceToolName = (typeof VOICE_LIST_TOOLS)[number] | (typeof VOICE_SUMMARY_TOOLS)[number]

export const VOICE_TOOL_NAMES: readonly VoiceToolName[] = [
  ...VOICE_LIST_TOOLS,
  ...VOICE_SUMMARY_TOOLS,
]

/**
 * Which tenant module each tool belongs to. A tool with no entry would be
 * allowed for everyone by `filterToolsByTenantModules`'s short-circuit, so the
 * accompanying test asserts this map covers EVERY name above — a forgotten row
 * here is a paid module leaking into a tenant that never bought it.
 */
export const VOICE_TOOL_MODULE: Record<VoiceToolName, ModuleId> = {
  list_deals: "sales",
  list_invoices: "finance",
  list_tasks: "crm",
  list_tickets: "support",
  list_contacts: "crm",
  get_daily_briefing: "analytics",
  get_pipeline_by_stage: "sales",
  get_sales_by_manager: "sales",
  get_overdue: "crm",
  // Target-scoped shells: `ai` is only the outer voice entitlement. The route
  // re-checks the selected record/section/focus against its real module+RBAC;
  // pinning the shell to CRM would falsely deny Finance-only invoice lookups.
  find_record: "ai",
  get_leads_summary: "sales",
  get_marketing_summary: "marketing",
  get_forecast_summary: "sales",
  get_boards_summary: "crm",
  get_workload_by_person: "ai",
  describe_section: "ai",
  explain_section: "ai",
  get_quotes_summary: "sales",
  get_inbox_summary: "omnichannel",
  get_field_summary: "mtm",
  get_sales_in_period: "sales",
  get_lead_coverage: "sales",
  // Same target-scoped shell as find_record: the route re-checks the selected
  // record type against its real module and RBAC before reading anything.
  read_record: "ai",
}

/**
 * Input schemas. `.strict()` on purpose: an unknown key is rejected rather than
 * ignored, so a model that invents `organizationId` gets an error instead of a
 * silently dropped field that a later refactor might start honouring.
 */
export const VOICE_TOOL_SCHEMAS: Record<VoiceToolName, z.ZodTypeAny> = {
  list_deals: z.object({ stage: z.string().max(64).optional(), assignedTo: z.string().max(64).optional(), limit: z.number().int().optional() }).strict(),
  list_invoices: z.object({ status: z.string().max(64).optional(), limit: z.number().int().optional() }).strict(),
  list_tasks: z.object({ status: z.string().max(64).optional(), assignedTo: z.string().max(64).optional(), limit: z.number().int().optional() }).strict(),
  list_tickets: z.object({ status: z.string().max(64).optional(), assignedTo: z.string().max(64).optional(), limit: z.number().int().optional() }).strict(),
  list_contacts: z.object({ search: z.string().max(120).optional(), limit: z.number().int().optional() }).strict(),
  get_daily_briefing: z.object({}).strict(),
  get_pipeline_by_stage: z.object({}).strict(),
  get_sales_by_manager: z.object({}).strict(),
  get_overdue: z.object({}).strict(),
  get_lead_coverage: z.object({}).strict(),
  find_record: z.object({
    type: z.enum(RECORD_TYPE_NAMES),
    query: z.string().min(2).max(80),
  }).strict(),
  // The enum lists exactly the readable types, so the model cannot ask for a
  // card that is not built (boards stay on get_boards_summary).
  read_record: z.object({
    type: z.enum(VOICE_READABLE_TYPES),
    id: z.string().min(6).max(64),
  }).strict(),
  // Both are state snapshots. Advertising a period made the model send one,
  // while the builders silently ignored it and returned a different answer.
  get_inbox_summary: z.object({}).strict(),
  get_field_summary: z.object({}).strict(),
  get_leads_summary: z.object({}).strict(),
  get_marketing_summary: z.object({}).strict(),
  get_forecast_summary: z.object({}).strict(),
  get_boards_summary: z.object({}).strict(),
  explain_section: z.object({ section: z.string().min(2).max(64) }).strict(),
  describe_section: z
    .object({
      section: z.string().min(2).max(64),
      facet: z.enum(["all", "status", "people", "overdue", "money"]).optional(),
      period: z.enum(["today", "yesterday", "week", "month", "quarter", "year"]).optional(),
    })
    .strict(),
  get_workload_by_person: z
    .object({ focus: z.enum(["all", "tasks", "leads", "deals", "tickets"]).optional() })
    .strict(),
  get_quotes_summary: z.object({}).strict(),
  /*
   * Named month OR relative window, never both mandatory.
   *
   * "Сколько продали в июле" is the question that started this: a relative
   * enum cannot express it, and forcing the model to translate "июль" into
   * "3 months ago" is asking it to do arithmetic it gets wrong. So the month
   * is passed as a number and the year is optional — a month later than the
   * current one is read as last year, which is what a person means in January
   * when they say "in December".
   */
  get_sales_in_period: z
    .object({
      period: z
        .enum(["this_month", "last_month", "this_quarter", "this_year", "last_year"])
        .describe("Use this relative period by itself; omit month and year.")
        .optional(),
      month: z
        .number()
        .int()
        .min(1)
        .max(12)
        .describe("Calendar month 1-12; omit period. May be paired with year.")
        .optional(),
      year: z
        .number()
        .int()
        .min(2000)
        .max(2100)
        .describe("Allowed only together with month; omit period.")
        .optional(),
    })
    .strict()
    .superRefine((value, ctx) => {
      const hasPeriod = value.period !== undefined
      const hasMonth = value.month !== undefined
      const hasYear = value.year !== undefined

      if (hasPeriod && (hasMonth || hasYear)) {
        ctx.addIssue({
          code: "custom",
          path: ["period"],
          message: "period cannot be combined with month or year",
        })
      }
      if (hasYear && !hasMonth) {
        ctx.addIssue({
          code: "custom",
          path: ["year"],
          message: "year requires month",
        })
      }
    }),
}

/** How many rows the agent may read aloud before it must defer to the screen. */
export const SPOKEN_ROW_LIMIT = 5

/** Free-text cell cap — a long note read aloud is both useless and a cost. */
const SPOKEN_CELL_LIMIT = 60

/**
 * Turn a ReadResultData into something worth hearing.
 *
 * Three rules, all of them about speech rather than data:
 *  - ids are never spoken (nobody can act on a cuid by ear), and dropping them
 *    also means the model cannot repeat one back as a tool argument;
 *  - at most five rows, then the count of what was left on screen;
 *  - free text is truncated, because an injected instruction sitting in a
 *    customer-supplied field has fewer places to hide in 60 characters.
 */
export function shapeRowsForSpeech(data: {
  entityType: string
  columns: Array<string | { key: string }>
  rows: Array<Record<string, unknown>>
  total: number
  returned: number
}): { entityType: string; total: number; spoken: Array<Record<string, string>>; remaining: number } {
  const rows = Array.isArray(data.rows) ? data.rows : []
  const spoken = rows.slice(0, SPOKEN_ROW_LIMIT).map((row) => {
    const out: Record<string, string> = {}
    for (const col of data.columns) {
      const key = typeof col === "string" ? col : col?.key
      if (!key || key === "id") continue
      const cells = row.cells && typeof row.cells === "object" && !Array.isArray(row.cells)
        ? row.cells as Record<string, unknown>
        : row
      const raw = cells[key]
      if (raw === null || raw === undefined) continue
      if (typeof raw === "number") {
        out[key] = String(Math.round(raw))
        continue
      }
      const text = String(raw).replace(/[\r\n\t]+/g, " ").trim()
      out[key] = text.length > SPOKEN_CELL_LIMIT ? `${text.slice(0, SPOKEN_CELL_LIMIT)}…` : text
    }
    return out
  })
  return {
    entityType: data.entityType,
    total: data.total,
    spoken,
    remaining: Math.max(0, (data.total ?? rows.length) - spoken.length),
  }
}
