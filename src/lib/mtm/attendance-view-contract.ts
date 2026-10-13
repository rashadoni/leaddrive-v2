import { z } from "zod"
import { AttendanceReportQuerySchema } from "@/lib/mtm/attendance-query"
import { addDateKeyDays, isDateKey } from "@/lib/mtm/mobile-week"
import { DEFAULT_ATTENDANCE_DAY_COLUMNS, DEFAULT_ATTENDANCE_JOURNAL_COLUMNS } from "@/lib/mtm/attendance-presentation"

export const DEFAULT_ATTENDANCE_MONTH_COLUMNS = ["employee", "team", "days", "worked", "late", "absent"] as const
export const DEFAULT_ATTENDANCE_BRANCH_COLUMNS = ["branch", "arrivals", "departures", "employees", "outside", "uncertain"] as const
export const DEFAULT_ATTENDANCE_VIEW_COLUMNS = {
  DAY: DEFAULT_ATTENDANCE_DAY_COLUMNS,
  MONTH: DEFAULT_ATTENDANCE_MONTH_COLUMNS,
  JOURNAL: DEFAULT_ATTENDANCE_JOURNAL_COLUMNS,
  BRANCH: DEFAULT_ATTENDANCE_BRANCH_COLUMNS,
} as const
export const ATTENDANCE_VIEW_COLUMNS = {
  ...DEFAULT_ATTENDANCE_VIEW_COLUMNS,
  DAY: [...DEFAULT_ATTENDANCE_DAY_COLUMNS, "arrivalBranch", "departureBranch", "markLocation"],
  BRANCH: [...DEFAULT_ATTENDANCE_BRANCH_COLUMNS, "noLocation", "noConsent"],
} as const
export const AttendanceViewConfigSchema = z.object({
  version: z.literal(1),
  mode: z.enum(["DAY", "MONTH", "JOURNAL", "BRANCH"]),
  columns: z.array(z.enum(["employee", "team", "date", "status", "startedAt", "completedAt", "worked", "paused", "late", "early", "event", "phoneAt", "serverAt", "days", "absent", "notes", "arrivalBranch", "departureBranch", "markLocation", "branch", "arrivals", "departures", "employees", "outside", "uncertain", "noLocation", "noConsent"])).min(1).max(15),
  showTotals: z.boolean(),
  filters: AttendanceReportQuerySchema,
}).strict().superRefine((config, ctx) => {
  if (new Set(config.columns).size !== config.columns.length || config.columns.some((column) => !(ATTENDANCE_VIEW_COLUMNS[config.mode] as readonly string[]).includes(column))) {
    ctx.addIssue({ code: "custom", path: ["columns"], message: "Choose distinct columns for the selected row type" })
  }
  if ((config.mode === "JOURNAL") !== (config.filters.form === "JOURNAL")) {
    ctx.addIssue({ code: "custom", path: ["filters", "form"], message: "Journal rows require the journal form" })
  }
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
