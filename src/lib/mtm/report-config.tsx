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
export const MANAGEMENT_REPORT_TYPES: ReportType[] = ["route_execution", "action_compliance", "promises", "sales"]
export const REPORT_TYPES: ReportType[] = ["agent", "visit", "route", "photo", ...MANAGEMENT_REPORT_TYPES]

export type ColKind = "text" | "status" | "role" | "number" | "percent" | "minutes" | "date"
export interface ReportColumn { key: string; labelKey: string; kind: ColKind }
export interface ReportDef { icon: LucideIcon; iconClass: string; columns: ReportColumn[] }

export const REPORTS: Record<ReportType, ReportDef> = {
  agent: {
    icon: Users,
    iconClass: "text-blue-500 bg-blue-50 dark:bg-blue-950/30",
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
    iconClass: "text-red-500 bg-red-50 dark:bg-red-950/30",
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
    iconClass: "text-purple-500 bg-purple-50 dark:bg-purple-950/30",
    columns: [
      { key: "date", labelKey: "colDate", kind: "date" },
      { key: "agent", labelKey: "colAgent", kind: "text" },
      { key: "status", labelKey: "colStatus", kind: "status" },
      { key: "points", labelKey: "colPoints", kind: "number" },
      { key: "duration", labelKey: "colDuration", kind: "minutes" },
    ],
  },
  photo: {
    icon: Camera,
    iconClass: "text-green-500 bg-green-50 dark:bg-green-950/30",
    columns: [
      { key: "date", labelKey: "colUploaded", kind: "date" },
      { key: "agent", labelKey: "colAgent", kind: "text" },
      { key: "customer", labelKey: "colCustomer", kind: "text" },
      { key: "status", labelKey: "colStatus", kind: "status" },
    ],
  },
  route_execution: {
    icon: ChartNoAxesCombined,
    iconClass: "text-cyan-700 bg-cyan-50 dark:bg-cyan-950/30",
    columns: [
      { key: "date", labelKey: "colDate", kind: "date" },
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
    iconClass: "text-emerald-700 bg-emerald-50 dark:bg-emerald-950/30",
    columns: [
      { key: "team", labelKey: "colTeam", kind: "text" },
      { key: "action", labelKey: "colAction", kind: "text" },
      { key: "required", labelKey: "colRequired", kind: "number" },
      { key: "compliant", labelKey: "colCompliant", kind: "number" },
      { key: "compliance", labelKey: "colCompliance", kind: "percent" },
    ],
  },
  promises: {
    icon: CalendarClock,
    iconClass: "text-amber-700 bg-amber-50 dark:bg-amber-950/30",
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
    iconClass: "text-indigo-700 bg-indigo-50 dark:bg-indigo-950/30",
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
