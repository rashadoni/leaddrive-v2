import { z } from "zod"
import { AttendanceReportQuerySchema } from "@/lib/mtm/attendance-query"
import { addDateKeyDays, isDateKey } from "@/lib/mtm/mobile-week"
import { DEFAULT_ATTENDANCE_DAY_COLUMNS, DEFAULT_ATTENDANCE_JOURNAL_COLUMNS } from "@/lib/mtm/attendance-presentation"

export const DEFAULT_ATTENDANCE_MONTH_COLUMNS = ["employee", "team", "days", "worked", "late", "absent"] as const
export const DEFAULT_ATTENDANCE_OVERTIME_COLUMNS = ["employee", "date", "planned", "worked", "excess", "threshold", "approvedOvertime", "overtimeState"] as const
export const DEFAULT_ATTENDANCE_BRANCH_COLUMNS = ["branch", "arrivals", "departures", "employees", "outside", "uncertain"] as const
/** Personnel → Reports (owner, 2026-10-15): the same day rows, grouped the way HR
 * reads them. SUMMARY and BALANCE are one row per employee over the period,
 * ABSENCE_KINDS one column per day kind found, TEAM one row per team. */
export const DEFAULT_ATTENDANCE_SUMMARY_COLUMNS = ["employee", "team", "plannedDays", "workedDays", "expected", "worked", "lateCount", "earlyCount", "absent", "leaveDays", "sickDays", "overtimeHours", "attendanceRate"] as const
export const DEFAULT_ATTENDANCE_BALANCE_COLUMNS = ["employee", "team", "expected", "worked", "balance"] as const
export const DEFAULT_ATTENDANCE_ABSENCE_KIND_COLUMNS = ["employee", "team", "kinds", "absenceTotal"] as const
export const DEFAULT_ATTENDANCE_TEAM_COLUMNS = ["team", "employees", "workedDays", "worked", "lateCount", "absent", "overtimeHours", "attendanceRate"] as const
/** «Forma N-1t», the timesheet form Azerbaijani accounting uses: number, name, unit, days 1–31, worked days and hours. */
/** The day reports of Personnel → Reports (day, absences, lateness): position and department
 * as their own columns in Excel/PDF; the screen folds them under the name (owner, 2026-11-01). */
export const ATTENDANCE_DAY_REPORT_COLUMNS = ["employee", "position", "department", "team", "date", "status", "startedAt", "completedAt", "worked", "paused", "late", "early", "notes"] as const
export const ATTENDANCE_N1T_COLUMNS = ["index", "employee", "position", "team", "days", "workedDays", "hours", "notes"] as const
export const DEFAULT_ATTENDANCE_VIEW_COLUMNS = {
  DAY: DEFAULT_ATTENDANCE_DAY_COLUMNS,
  MONTH: DEFAULT_ATTENDANCE_MONTH_COLUMNS,
  JOURNAL: DEFAULT_ATTENDANCE_JOURNAL_COLUMNS,
  BRANCH: DEFAULT_ATTENDANCE_BRANCH_COLUMNS,
  OVERTIME: DEFAULT_ATTENDANCE_OVERTIME_COLUMNS,
  SUMMARY: DEFAULT_ATTENDANCE_SUMMARY_COLUMNS,
  BALANCE: DEFAULT_ATTENDANCE_BALANCE_COLUMNS,
  ABSENCE_KINDS: DEFAULT_ATTENDANCE_ABSENCE_KIND_COLUMNS,
  TEAM: DEFAULT_ATTENDANCE_TEAM_COLUMNS,
} as const
export const ATTENDANCE_VIEW_COLUMNS = {
  ...DEFAULT_ATTENDANCE_VIEW_COLUMNS,
  DAY: [...DEFAULT_ATTENDANCE_DAY_COLUMNS, "position", "department", "arrivalBranch", "departureBranch", "markLocation"],
  MONTH: [...DEFAULT_ATTENDANCE_MONTH_COLUMNS, "index", "position", "workedDays", "hours", "notes"],
  SUMMARY: [...DEFAULT_ATTENDANCE_SUMMARY_COLUMNS, "position"],
  BRANCH: [...DEFAULT_ATTENDANCE_BRANCH_COLUMNS, "noLocation", "noConsent"],
} as const
export const AttendanceViewConfigSchema = z.object({
  version: z.literal(1),
  mode: z.enum(["DAY", "MONTH", "JOURNAL", "BRANCH", "OVERTIME", "SUMMARY", "BALANCE", "ABSENCE_KINDS", "TEAM"]),
  columns: z.array(z.enum(["employee", "position", "department", "team", "date", "status", "startedAt", "completedAt", "worked", "paused", "late", "early", "event", "phoneAt", "serverAt", "days", "absent", "notes", "arrivalBranch", "departureBranch", "markLocation", "branch", "arrivals", "departures", "employees", "outside", "uncertain", "noLocation", "noConsent", "planned", "excess", "threshold", "approvedOvertime", "overtimeState",
    "index", "workedDays", "hours", "plannedDays", "expected", "lateCount", "earlyCount", "leaveDays", "sickDays", "overtimeHours", "attendanceRate", "balance", "kinds", "absenceTotal"])).min(1).max(16),
  showTotals: z.boolean(),
  filters: AttendanceReportQuerySchema,
}).strict().superRefine((config, ctx) => {
  if (new Set(config.columns).size !== config.columns.length || config.columns.some((column) => !(ATTENDANCE_VIEW_COLUMNS[config.mode] as readonly string[]).includes(column))) {
    ctx.addIssue({ code: "custom", path: ["columns"], message: "Choose distinct columns for the selected row type" })
  }
  if ((config.mode === "JOURNAL") !== (config.filters.form === "JOURNAL")) {
    ctx.addIssue({ code: "custom", path: ["filters", "form"], message: "Journal rows require the journal form" })
  }
  if (["OVERTIME", "SUMMARY", "BALANCE", "ABSENCE_KINDS", "TEAM"].includes(config.mode) && config.filters.form !== "ALL") ctx.addIssue({ code: "custom", path: ["filters", "form"], message: "Overtime rows require the complete day snapshot" })
  if (config.mode === "MONTH" && isDateKey(config.filters.to) && (config.filters.from.slice(8) !== "01" || config.filters.from.slice(0, 7) !== config.filters.to.slice(0, 7) || addDateKeyDays(config.filters.to, 1).slice(8) !== "01")) {
    ctx.addIssue({ code: "custom", path: ["filters"], message: "A monthly form requires one complete calendar month" })
  }
})
export type AttendanceViewConfig = z.infer<typeof AttendanceViewConfigSchema>
export type AttendanceViewColumn = AttendanceViewConfig["columns"][number]
export type AttendanceView = { id: string; name: string; config: AttendanceViewConfig; version: string }
const fields = { name: z.string().trim().min(1).max(80), config: AttendanceViewConfigSchema }
export const AttendanceViewCreateSchema = z.object({ ...fields, requestId: z.string().uuid() }).strict()
export const AttendanceViewUpdateSchema = z.object({ ...fields, version: z.string().datetime() }).strict()
export const AttendanceViewDeleteSchema = z.object({ version: z.string().datetime() }).strict()
