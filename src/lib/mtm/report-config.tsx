/**
 * Config for the redesigned MTM Reports section (/mtm/reports).
 *
 * Each report type is described declaratively (icon + table columns) so the page
 * renders any of them through ONE generic table + CSV path instead of a
 * hand-written view per type. The API flattens each row to the column `key`s
 * below and returns a `summary` + daily `series` alongside, so this file is the
 * single source of truth for column order, labels, and cell kinds.
 *
 * Statuses + roles get localized, tone-coloured badges (dark-safe tones reused
 * from the Activity Journal registry). Unknown codes fall back safely.
 */
import { Users, MapPin, Route, Camera, ClipboardCheck, CalendarClock, ChartNoAxesCombined, type LucideIcon } from "lucide-react"
import { TONE_CLASSES, type Tone } from "@/lib/mtm/activity-actions"

export type ReportType = "agent" | "visit" | "route" | "photo" | "route_execution" | "action_compliance" | "promises" | "sales"
  | "coverage" | "not_visited" | "suspicious" | "presentations" | "field_day" | "joint_evaluations"
export const MANAGEMENT_REPORT_TYPES: ReportType[] = ["route_execution", "action_compliance", "promises", "sales"]
/** Served by /api/v1/mtm/field-reports (src/lib/mtm/field-reports.ts). */
export const FIELD_REPORT_TYPES: ReportType[] = ["coverage", "not_visited", "suspicious", "presentations", "field_day", "joint_evaluations"]

/** Which API answers a report. */
export function reportEndpoint(type: ReportType): "reports" | "management-reports" | "field-reports" {
  if (MANAGEMENT_REPORT_TYPES.includes(type)) return "management-reports"
  if (FIELD_REPORT_TYPES.includes(type)) return "field-reports"
  return "reports"
}
/**
 * The cards on /mtm/reports. «route» is not one of them any more (owner
 * 2026-09-26: «убери дублирования»): «План и выполнение маршрутов»
 * (route_execution) answers the same question better — by the route's own
 * date, with team and region. The type stays for a tab opened before.
 */
export const REPORT_TYPES: ReportType[] = ["agent", "visit", "photo", ...MANAGEMENT_REPORT_TYPES, ...FIELD_REPORT_TYPES]

/**
 * The reports by what a manager asks of them (owner-approved mockup,
 * 2026-11-01): the team, the clients, control, sales. Every type of
 * REPORT_TYPES is in exactly one group.
 */
export const REPORT_GROUPS: ReadonlyArray<{ id: "team" | "clients" | "control" | "sales"; types: ReportType[] }> = [
  { id: "team", types: ["agent", "route_execution", "field_day", "joint_evaluations"] },
  { id: "clients", types: ["coverage", "not_visited", "visit", "presentations", "promises"] },
  { id: "control", types: ["suspicious", "photo", "action_compliance"] },
  { id: "sales", types: ["sales"] },
]

/** Where a row of a report leads: the visit, the route, the employee — or nowhere. */
export function reportRowHref(type: ReportType, row: Record<string, unknown>): string | null {
  const id = typeof row.id === "string" && row.id ? encodeURIComponent(row.id) : null
  if (!id) return null
  if (type === "visit" || type === "promises" || type === "suspicious") return `/mtm/visits?visitId=${id}`
  if (type === "route" || type === "route_execution") return `/mtm/routes?routeId=${id}`
  if (type === "agent" || type === "coverage" || type === "joint_evaluations") return `/mtm/agents/${id}`
  if (type === "not_visited") return `/mtm/contacts/${id}`
  if (type === "field_day") return typeof row.agentId === "string" && row.agentId ? `/mtm/agents/${encodeURIComponent(row.agentId)}` : null
  return null
}

/** `day` is a calendar day stored as a date; `action` is a visit action's code, said in words. */
export type ColKind = "text" | "status" | "role" | "number" | "percent" | "minutes" | "date" | "day" | "action"
  /** Seconds as m:ss; metres; the reasons a visit is suspicious; a last visit that may be «never»; whole days. */
  | "seconds" | "meters" | "reasons" | "lastVisit" | "days"
export interface ReportColumn { key: string; labelKey: string; kind: ColKind }
export interface ReportDef { icon: LucideIcon; iconClass: string; columns: ReportColumn[] }

export const REPORTS: Record<ReportType, ReportDef> = {
  agent: {
    icon: Users,
    iconClass: "text-blue-500",
    columns: [
      { key: "name", labelKey: "colAgent", kind: "text" },
      { key: "role", labelKey: "colRole", kind: "role" },
      { key: "visits", labelKey: "colVisits", kind: "number" },
      { key: "tasks", labelKey: "colTasks", kind: "number" },
      { key: "photos", labelKey: "colPhotos", kind: "number" },
    ],
  },
  visit: {
    icon: MapPin,
    iconClass: "text-red-500",
    columns: [
      { key: "date", labelKey: "colDate", kind: "date" },
      { key: "agent", labelKey: "colAgent", kind: "text" },
      { key: "customer", labelKey: "colCustomer", kind: "text" },
      { key: "status", labelKey: "colStatus", kind: "status" },
      { key: "duration", labelKey: "colDuration", kind: "minutes" },
    ],
  },
  route: {
    icon: Route,
    iconClass: "text-purple-500",
    columns: [
      { key: "date", labelKey: "colDate", kind: "date" },
      { key: "agent", labelKey: "colAgent", kind: "text" },
      { key: "status", labelKey: "colStatus", kind: "status" },
      { key: "points", labelKey: "colPoints", kind: "text" },
      { key: "duration", labelKey: "colDuration", kind: "minutes" },
    ],
  },
  photo: {
    icon: Camera,
    iconClass: "text-green-500",
    columns: [
      { key: "date", labelKey: "colUploaded", kind: "date" },
      { key: "agent", labelKey: "colAgent", kind: "text" },
      { key: "customer", labelKey: "colCustomer", kind: "text" },
      { key: "status", labelKey: "colStatus", kind: "status" },
    ],
  },
  route_execution: {
    icon: ChartNoAxesCombined,
    iconClass: "text-cyan-700",
    columns: [
      { key: "date", labelKey: "colDate", kind: "day" },
      { key: "agent", labelKey: "colAgent", kind: "text" },
      { key: "team", labelKey: "colTeam", kind: "text" },
      { key: "region", labelKey: "colRegion", kind: "text" },
      { key: "planned", labelKey: "colPlanned", kind: "number" },
      { key: "actual", labelKey: "colActual", kind: "number" },
      { key: "compliance", labelKey: "colCompliance", kind: "percent" },
      { key: "status", labelKey: "colStatus", kind: "status" },
    ],
  },
  action_compliance: {
    icon: ClipboardCheck,
    iconClass: "text-emerald-700",
    columns: [
      { key: "team", labelKey: "colTeam", kind: "text" },
      { key: "action", labelKey: "colAction", kind: "action" },
      { key: "required", labelKey: "colRequired", kind: "number" },
      { key: "compliant", labelKey: "colCompliant", kind: "number" },
      { key: "compliance", labelKey: "colCompliance", kind: "percent" },
    ],
  },
  promises: {
    icon: CalendarClock,
    iconClass: "text-amber-700",
    columns: [
      { key: "dueAt", labelKey: "colDueAt", kind: "date" },
      { key: "agent", labelKey: "colAgent", kind: "text" },
      { key: "customer", labelKey: "colCustomer", kind: "text" },
      { key: "outcome", labelKey: "colOutcome", kind: "text" },
      { key: "status", labelKey: "colStatus", kind: "status" },
      { key: "notes", labelKey: "colDetails", kind: "text" },
    ],
  },
  sales: {
    icon: ChartNoAxesCombined,
    iconClass: "text-indigo-700",
    columns: [
      { key: "customer", labelKey: "colCustomer", kind: "text" },
      { key: "agent", labelKey: "colAgent", kind: "text" },
      { key: "territory", labelKey: "colTerritory", kind: "text" },
      { key: "planAmount", labelKey: "colPlan", kind: "number" },
      { key: "actualAmount", labelKey: "colFact", kind: "number" },
      { key: "amountVariance", labelKey: "colVariance", kind: "number" },
      { key: "attainment", labelKey: "colAttainment", kind: "percent" },
    ],
  },
  coverage: {
    icon: Users,
    iconClass: "text-sky-700",
    columns: [
      { key: "agent", labelKey: "colAgent", kind: "text" },
      { key: "contacts", labelKey: "colContacts", kind: "number" },
      { key: "visited", labelKey: "colVisitedContacts", kind: "number" },
      { key: "coverage", labelKey: "colCoverage", kind: "percent" },
      { key: "coverageA", labelKey: "colCoverageA", kind: "percent" },
      { key: "coverageB", labelKey: "colCoverageB", kind: "percent" },
      { key: "coverageC", labelKey: "colCoverageC", kind: "percent" },
    ],
  },
  not_visited: {
    icon: Users,
    iconClass: "text-amber-700",
    columns: [
      { key: "contact", labelKey: "colContact", kind: "text" },
      { key: "category", labelKey: "colCategory", kind: "text" },
      { key: "agent", labelKey: "colResponsible", kind: "text" },
      { key: "lastVisit", labelKey: "colLastVisit", kind: "lastVisit" },
      { key: "daysSince", labelKey: "colDaysSince", kind: "days" },
    ],
  },
  suspicious: {
    icon: MapPin,
    iconClass: "text-red-700",
    columns: [
      { key: "date", labelKey: "colDate", kind: "date" },
      { key: "agent", labelKey: "colAgent", kind: "text" },
      { key: "customer", labelKey: "colCustomer", kind: "text" },
      { key: "duration", labelKey: "colDuration", kind: "minutes" },
      { key: "distance", labelKey: "colDistance", kind: "meters" },
      { key: "reasons", labelKey: "colReasons", kind: "reasons" },
    ],
  },
  presentations: {
    icon: ChartNoAxesCombined,
    iconClass: "text-purple-700",
    columns: [
      { key: "product", labelKey: "colProduct", kind: "text" },
      { key: "shows", labelKey: "colShows", kind: "number" },
      { key: "clients", labelKey: "colClientsShown", kind: "number" },
      { key: "avgSeconds", labelKey: "colAvgShow", kind: "seconds" },
      { key: "avgPages", labelKey: "colAvgPages", kind: "number" },
    ],
  },
  field_day: {
    icon: CalendarClock,
    iconClass: "text-teal-700",
    columns: [
      { key: "date", labelKey: "colDate", kind: "day" },
      { key: "agent", labelKey: "colAgent", kind: "text" },
      { key: "start", labelKey: "colDayStart", kind: "text" },
      { key: "firstVisit", labelKey: "colFirstVisit", kind: "text" },
      { key: "lastVisit", labelKey: "colLastVisitTime", kind: "text" },
      { key: "end", labelKey: "colDayEnd", kind: "text" },
      { key: "hours", labelKey: "colHours", kind: "number" },
      { key: "visits", labelKey: "colVisits", kind: "number" },
      { key: "atClients", labelKey: "colAtClients", kind: "minutes" },
    ],
  },
  joint_evaluations: {
    icon: Users,
    iconClass: "text-violet-700",
    columns: [
      { key: "agent", labelKey: "colAgent", kind: "text" },
      { key: "evaluations", labelKey: "colEvaluations", kind: "number" },
      { key: "average", labelKey: "colAvgScore", kind: "number" },
      { key: "weakest", labelKey: "colWeakest", kind: "text" },
      { key: "lastEvaluation", labelKey: "colLastEvaluation", kind: "date" },
    ],
  },
}

// Status → tone (dark-safe classes come from the shared TONE_CLASSES).
const STATUS_TONE: Record<string, Tone> = {
  CHECKED_IN: "sky", CHECKED_OUT: "green", COMPLETED: "green", APPROVED: "green", ACTIVE: "green",
  PENDING: "amber", IN_PROGRESS: "sky", PLANNED: "slate",
  MISSED: "red", NO_SHOW: "red", CANCELLED: "red", REJECTED: "red", OVERDUE: "red",
  // The day ended with the route open. Amber, not red: nothing was rejected or
  // missed on purpose, and part of the plan may well have been done.
  INCOMPLETE: "amber",
  OPEN: "amber",
  // A promise somebody came back for (management-reports «promises»).
  DONE: "green",
}

export function statusClass(status: string): string {
  return TONE_CLASSES[STATUS_TONE[status] ?? "slate"]
}
export function statusLabelKey(status: string): string {
  return `status.${status in STATUS_TONE ? status : "unknown"}`
}

const ROLES = new Set(["ADMIN", "MANAGER", "SUPERVISOR", "AGENT"])
export function roleLabelKey(role: string): string {
  return ROLES.has(role) ? `role.${role}` : "status.unknown"
}
