import { prisma } from "@/lib/prisma"

interface FieldDef {
  name: string
  label: string
  type: "string" | "number" | "date" | "boolean"
}

interface EntityConfig {
  model: string
  fields: FieldDef[]
  relations?: { name: string; model: string; fields: string[] }[]
}

const ENTITY_CONFIGS: Record<string, EntityConfig> = {
  deals: {
    model: "deal",
    fields: [
      { name: "name", label: "Deal Name", type: "string" },
      { name: "valueAmount", label: "Value", type: "number" },
      { name: "currency", label: "Currency", type: "string" },
      { name: "status", label: "Status", type: "string" },
      { name: "stage", label: "Stage", type: "string" },
      { name: "probability", label: "Probability", type: "number" },
      { name: "expectedClose", label: "Expected Close", type: "date" },
      { name: "assignedTo", label: "Assigned To", type: "string" },
      { name: "createdAt", label: "Created", type: "date" },
    ],
    relations: [
      { name: "company", model: "company", fields: ["name", "industry"] },
    ],
  },
  contacts: {
    model: "contact",
    fields: [
      { name: "fullName", label: "Full Name", type: "string" },
      { name: "email", label: "Email", type: "string" },
      { name: "phone", label: "Phone", type: "string" },
      { name: "position", label: "Position", type: "string" },
      { name: "department", label: "Department", type: "string" },
      { name: "source", label: "Source", type: "string" },
      { name: "brand", label: "Brand", type: "string" },
      { name: "category", label: "Category", type: "string" },
      { name: "lastSmsAt", label: "Last SMS", type: "date" },
      { name: "engagementScore", label: "Engagement", type: "number" },
      { name: "isActive", label: "Active", type: "boolean" },
      { name: "createdAt", label: "Created", type: "date" },
    ],
    relations: [
      { name: "company", model: "company", fields: ["name", "industry"] },
    ],
  },
  companies: {
    model: "company",
    fields: [
      { name: "name", label: "Company Name", type: "string" },
      { name: "industry", label: "Industry", type: "string" },
      { name: "status", label: "Status", type: "string" },
      { name: "category", label: "Category", type: "string" },
      { name: "annualRevenue", label: "Revenue", type: "number" },
      { name: "employeeCount", label: "Employees", type: "number" },
      { name: "city", label: "City", type: "string" },
      { name: "country", label: "Country", type: "string" },
      { name: "createdAt", label: "Created", type: "date" },
    ],
  },
  leads: {
    model: "lead",
    fields: [
      { name: "contactName", label: "Lead Name", type: "string" },
      { name: "companyName", label: "Company", type: "string" },
      { name: "email", label: "Email", type: "string" },
      { name: "phone", label: "Phone", type: "string" },
      { name: "source", label: "Source", type: "string" },
      { name: "brand", label: "Brand", type: "string" },
      { name: "category", label: "Category", type: "string" },
      { name: "status", label: "Status", type: "string" },
      { name: "priority", label: "Priority", type: "string" },
      { name: "score", label: "Score", type: "number" },
      { name: "estimatedValue", label: "Est. Value", type: "number" },
      { name: "assignedTo", label: "Assigned To", type: "string" },
      { name: "createdAt", label: "Created", type: "date" },
    ],
  },
  tickets: {
    model: "ticket",
    fields: [
      { name: "ticketNumber", label: "Ticket #", type: "string" },
      { name: "subject", label: "Subject", type: "string" },
      { name: "priority", label: "Priority", type: "string" },
      { name: "status", label: "Status", type: "string" },
      { name: "category", label: "Category", type: "string" },
      { name: "assignedTo", label: "Assigned To", type: "string" },
      { name: "satisfactionRating", label: "CSAT", type: "number" },
      { name: "createdAt", label: "Created", type: "date" },
      { name: "resolvedAt", label: "Resolved", type: "date" },
    ],
    relations: [
      { name: "contact", model: "contact", fields: ["fullName", "email"] },
    ],
  },
  tasks: {
    model: "task",
    fields: [
      { name: "title", label: "Title", type: "string" },
      { name: "status", label: "Status", type: "string" },
      { name: "priority", label: "Priority", type: "string" },
      { name: "assignedTo", label: "Assigned To", type: "string" },
      { name: "dueDate", label: "Due Date", type: "date" },
      { name: "createdAt", label: "Created", type: "date" },
      { name: "completedAt", label: "Completed", type: "date" },
    ],
  },
  activities: {
    model: "activity",
    fields: [
      { name: "type", label: "Type", type: "string" },
      { name: "subject", label: "Subject", type: "string" },
      { name: "description", label: "Description", type: "string" },
      { name: "createdBy", label: "Created By", type: "string" },
      { name: "createdAt", label: "Created", type: "date" },
      { name: "completedAt", label: "Completed", type: "date" },
    ],
    relations: [
      { name: "contact", model: "contact", fields: ["fullName"] },
      { name: "company", model: "company", fields: ["name"] },
    ],
  },
}

export interface ReportConfig {
  entityType: string
  columns: { field: string; label?: string; aggregate?: "count" | "sum" | "avg" | "min" | "max" }[]
  filters: { field: string; op: string; value: any }[]
  groupBy?: string
  sortBy?: string
  sortOrder?: string
  limit?: number
  /**
   * Optional fiscal-year start month (1-12). Used by `this_fiscal_year` /
   * `last_fiscal_year` date presets. Defaults to 1 (Jan) if not supplied.
   */
  fiscalYearStartMonth?: number
}

/**
 * Date-range preset keys understood by the `date_range` filter operator
 * (and exposed to UI via `getDateRangePresets()`). Resolved at query-time
 * relative to the server clock + optional fiscal-year start month.
 */
export type DateRangePreset =
  | "today"
  | "yesterday"
  | "this_week"
  | "last_week"
  | "last_7_days"
  | "last_14_days"
  | "last_30_days"
  | "last_90_days"
  | "this_month"
  | "last_month"
  | "this_quarter"
  | "last_quarter"
  | "this_year"
  | "last_year"
  | "this_fiscal_year"
  | "last_fiscal_year"

// `satisfies readonly DateRangePreset[]` makes the compiler enforce that every
// member of DateRangePreset appears here (and only those). Drift-proof.
export const DATE_RANGE_PRESETS = [
  "today", "yesterday",
  "this_week", "last_week",
  "last_7_days", "last_14_days", "last_30_days", "last_90_days",
  "this_month", "last_month",
  "this_quarter", "last_quarter",
  "this_year", "last_year",
  "this_fiscal_year", "last_fiscal_year",
] as const satisfies readonly DateRangePreset[]

/** Catalog of presets with human labels, for UI dropdowns. */
export function getDateRangePresets(): { key: DateRangePreset; label: string }[] {
  return [
    { key: "today", label: "Today" },
    { key: "yesterday", label: "Yesterday" },
    { key: "this_week", label: "This week" },
    { key: "last_week", label: "Last week" },
    { key: "last_7_days", label: "Last 7 days" },
    { key: "last_14_days", label: "Last 14 days" },
    { key: "last_30_days", label: "Last 30 days" },
    { key: "last_90_days", label: "Last 90 days" },
    { key: "this_month", label: "This month" },
    { key: "last_month", label: "Last month" },
    { key: "this_quarter", label: "This quarter" },
    { key: "last_quarter", label: "Last quarter" },
    { key: "this_year", label: "This year" },
    { key: "last_year", label: "Last year" },
    { key: "this_fiscal_year", label: "This fiscal year" },
    { key: "last_fiscal_year", label: "Last fiscal year" },
  ]
}

/**
 * Resolve a date-range preset to a concrete `{ from, to }` window relative to
 * the supplied `now` (defaults to current time). Returns inclusive bounds —
 * `from` is start-of-day, `to` is end-of-day (23:59:59.999), so callers can
 * apply `gte from, lte to` directly.
 *
 * Pure function, deterministic given (preset, now, fiscalYearStartMonth).
 */
export function resolveDatePreset(
  preset: DateRangePreset,
  now: Date = new Date(),
  fiscalYearStartMonth: number = 1
): { from: Date; to: Date } {
  // TODO I1.2: when Organization.fiscalYearStartMonth is added (schema migration),
  //   thread it through executeReport from org-level setting instead of per-call.
  // NOTE: All Date constructions use local-time `new Date(y, m, d)` form. On a
  //   server running in a DST-observing timezone, the spring-forward day will
  //   shift the start-of-day by +1h once a year. Hetzner production is UTC, so
  //   no impact in prod. Local dev in CET/PST may see 1 flaky hour per year.
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const endOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999)

  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const endOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999)
  const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)

  switch (preset) {
    case "today":
      return { from: today, to: endOfToday }
    case "yesterday": {
      const y = addDays(today, -1)
      return { from: startOfDay(y), to: endOfDay(y) }
    }
    case "last_7_days":
      return { from: startOfDay(addDays(today, -6)), to: endOfToday }
    case "last_14_days":
      return { from: startOfDay(addDays(today, -13)), to: endOfToday }
    case "last_30_days":
      return { from: startOfDay(addDays(today, -29)), to: endOfToday }
    case "last_90_days":
      return { from: startOfDay(addDays(today, -89)), to: endOfToday }
    case "this_week": {
      // ISO week: Monday = 0. JS Date.getDay() returns 0=Sunday, 1=Monday…6=Saturday.
      const dow = (today.getDay() + 6) % 7 // 0=Mon, 6=Sun
      const mon = addDays(today, -dow)
      return { from: startOfDay(mon), to: endOfToday }
    }
    case "last_week": {
      const dow = (today.getDay() + 6) % 7
      const thisMon = addDays(today, -dow)
      const lastMon = addDays(thisMon, -7)
      const lastSun = addDays(thisMon, -1)
      return { from: startOfDay(lastMon), to: endOfDay(lastSun) }
    }
    case "this_month":
      return {
        from: new Date(today.getFullYear(), today.getMonth(), 1),
        to: endOfToday,
      }
    case "last_month": {
      const firstOfThisMonth = new Date(today.getFullYear(), today.getMonth(), 1)
      const firstOfLastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1)
      const lastDayOfLastMonth = new Date(firstOfThisMonth.getTime() - 1)
      return { from: firstOfLastMonth, to: lastDayOfLastMonth }
    }
    case "this_quarter": {
      const qStartMonth = Math.floor(today.getMonth() / 3) * 3
      return {
        from: new Date(today.getFullYear(), qStartMonth, 1),
        to: endOfToday,
      }
    }
    case "last_quarter": {
      const thisQStart = Math.floor(today.getMonth() / 3) * 3
      const lastQStart = thisQStart - 3
      const fromYear = lastQStart < 0 ? today.getFullYear() - 1 : today.getFullYear()
      const fromMonth = lastQStart < 0 ? lastQStart + 12 : lastQStart
      const from = new Date(fromYear, fromMonth, 1)
      const toExclusive = new Date(today.getFullYear(), thisQStart, 1)
      return { from, to: new Date(toExclusive.getTime() - 1) }
    }
    case "this_year":
      return { from: new Date(today.getFullYear(), 0, 1), to: endOfToday }
    case "last_year":
      return {
        from: new Date(today.getFullYear() - 1, 0, 1),
        to: new Date(today.getFullYear() - 1, 11, 31, 23, 59, 59, 999),
      }
    case "this_fiscal_year": {
      const fyMonth = clampFiscalMonth(fiscalYearStartMonth) - 1 // 1-based → 0-based
      const fyStartThisYear = new Date(today.getFullYear(), fyMonth, 1)
      const from = today < fyStartThisYear
        ? new Date(today.getFullYear() - 1, fyMonth, 1)
        : fyStartThisYear
      return { from, to: endOfToday }
    }
    case "last_fiscal_year": {
      const fyMonth = clampFiscalMonth(fiscalYearStartMonth) - 1
      const fyStartThisYear = new Date(today.getFullYear(), fyMonth, 1)
      const fyStartThis = today < fyStartThisYear
        ? new Date(today.getFullYear() - 1, fyMonth, 1)
        : fyStartThisYear
      const fyStartLast = new Date(fyStartThis.getFullYear() - 1, fyMonth, 1)
      const fyEndLast = new Date(fyStartThis.getTime() - 1)
      return { from: fyStartLast, to: fyEndLast }
    }
    default: {
      // Exhaustiveness check — compile error if a preset key is missed above.
      const _exhaustive: never = preset
      void _exhaustive
      return { from: today, to: endOfToday }
    }
  }
}

function clampFiscalMonth(m: number): number {
  if (!Number.isFinite(m) || m < 1) return 1
  if (m > 12) return 12
  return Math.floor(m)
}

function isDateRangePreset(v: unknown): v is DateRangePreset {
  return typeof v === "string" && (DATE_RANGE_PRESETS as readonly string[]).includes(v)
}

export async function executeReport(orgId: string, config: ReportConfig) {
  const entityConfig = ENTITY_CONFIGS[config.entityType]
  if (!entityConfig) throw new Error("Unknown entity type")

  // Build WHERE
  const where: any = { organizationId: orgId }
  for (const f of config.filters) {
    switch (f.op) {
      case "eq": where[f.field] = f.value; break
      case "neq": where[f.field] = { not: f.value }; break
      case "gt": where[f.field] = { gt: parseNumOrDate(f.value, f.field, entityConfig) }; break
      case "lt": where[f.field] = { lt: parseNumOrDate(f.value, f.field, entityConfig) }; break
      case "gte": where[f.field] = { gte: parseNumOrDate(f.value, f.field, entityConfig) }; break
      case "lte": where[f.field] = { lte: parseNumOrDate(f.value, f.field, entityConfig) }; break
      case "contains": where[f.field] = { contains: f.value, mode: "insensitive" }; break
      case "in": where[f.field] = { in: Array.isArray(f.value) ? f.value : [f.value] }; break
      case "between":
        if (f.value?.from && f.value?.to) {
          where[f.field] = { gte: new Date(f.value.from), lte: new Date(f.value.to) }
        }
        break
      case "date_range": {
        // value can be a preset key ("last_7_days") or { preset: "..." }
        let preset: unknown
        if (typeof f.value === "string") {
          preset = f.value
        } else if (f.value && typeof f.value === "object" && "preset" in f.value) {
          preset = (f.value as { preset?: unknown }).preset
        }
        if (isDateRangePreset(preset)) {
          const { from, to } = resolveDatePreset(preset, new Date(), config.fiscalYearStartMonth)
          where[f.field] = { gte: from, lte: to }
        } else {
          // Unknown/missing preset — force zero results instead of unfiltered query.
          // Security/UX: typo in UI shouldn't return MORE records than intended.
          // Engineer should fix UI validation upstream; we fail closed here.
          console.warn(`[report-engine] date_range filter on ${f.field} got unknown preset:`, f.value)
          where[f.field] = { in: [] }
        }
        break
      }
    }
  }

  // GroupBy aggregation
  if (config.groupBy) {
    const aggregates: any = {}
    for (const col of config.columns) {
      if (col.aggregate && col.aggregate !== "count") {
        if (!aggregates[`_${col.aggregate}`]) aggregates[`_${col.aggregate}`] = {}
        aggregates[`_${col.aggregate}`][col.field] = true
      }
    }

    const result = await (prisma as any)[entityConfig.model].groupBy({
      by: [config.groupBy],
      where,
      ...aggregates,
      _count: { id: true },
      orderBy: config.sortBy
        ? { [config.sortBy]: config.sortOrder ?? "desc" }
        : { _count: { id: "desc" } },
      take: config.limit ?? 100,
    })

    return { type: "grouped" as const, data: result, groupBy: config.groupBy }
  }

  // Flat query
  const select: any = {}
  const include: any = {}

  for (const col of config.columns) {
    if (col.field.includes(".")) {
      const [rel, field] = col.field.split(".")
      if (!include[rel]) include[rel] = { select: {} }
      include[rel].select[field] = true
    } else {
      select[col.field] = true
    }
  }

  const hasSelect = Object.keys(select).length > 0
  const hasInclude = Object.keys(include).length > 0

  const result = await (prisma as any)[entityConfig.model].findMany({
    where,
    ...(hasSelect ? { select: { ...select, id: true, ...(hasInclude ? include : {}) } } : {}),
    ...(hasInclude && !hasSelect ? { include } : {}),
    orderBy: config.sortBy ? { [config.sortBy]: config.sortOrder ?? "desc" } : { createdAt: "desc" },
    take: config.limit ?? 500,
  })

  return { type: "flat" as const, data: result }
}

function parseNumOrDate(value: any, field: string, config: EntityConfig) {
  const fieldDef = config.fields.find(f => f.name === field)
  if (fieldDef?.type === "date") return new Date(value)
  if (fieldDef?.type === "number") return Number(value)
  return value
}

export function getEntityConfigs() {
  return ENTITY_CONFIGS
}
