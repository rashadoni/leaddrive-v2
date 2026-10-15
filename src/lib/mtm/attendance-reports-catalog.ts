import { ATTENDANCE_N1T_COLUMNS, DEFAULT_ATTENDANCE_VIEW_COLUMNS, type AttendanceViewConfig } from "@/lib/mtm/attendance-view-contract"
import { DEFAULT_ATTENDANCE_DAY_COLUMNS } from "@/lib/mtm/attendance-presentation"

/**
 * Personnel → Reports (owner, 2026-10-15: "all the reports HR may need"). The
 * list follows ZKBioTime's attendance reports and the Azerbaijani «Forma N-1t»;
 * every table report is a preset of the one report engine, so Excel and PDF,
 * snapshots and access checks are the ones the timesheet already uses.
 * A plain module: the server page and the client viewer both read it.
 */
export type AttendanceReportPeriod = "day" | "month" | "range"
type TableReport = {
  kind: "table"
  period: AttendanceReportPeriod
  mode: AttendanceViewConfig["mode"]
  form: AttendanceViewConfig["filters"]["form"]
  columns: readonly AttendanceViewConfig["columns"][number][]
}
export type AttendanceReportDefinition = TableReport | { kind: "page"; href: string } | { kind: "component" }

export const ATTENDANCE_REPORTS = {
  day: { kind: "table", period: "day", mode: "DAY", form: "ALL", columns: DEFAULT_ATTENDANCE_DAY_COLUMNS },
  absent: { kind: "table", period: "day", mode: "DAY", form: "ABSENCES", columns: DEFAULT_ATTENDANCE_DAY_COLUMNS },
  timesheet: { kind: "page", href: "/mtm/attendance/timesheet" },
  n1t: { kind: "table", period: "month", mode: "MONTH", form: "ALL", columns: ATTENDANCE_N1T_COLUMNS },
  summary: { kind: "table", period: "range", mode: "SUMMARY", form: "ALL", columns: DEFAULT_ATTENDANCE_VIEW_COLUMNS.SUMMARY },
  balance: { kind: "table", period: "range", mode: "BALANCE", form: "ALL", columns: DEFAULT_ATTENDANCE_VIEW_COLUMNS.BALANCE },
  late: { kind: "table", period: "range", mode: "DAY", form: "LATE_EARLY", columns: DEFAULT_ATTENDANCE_DAY_COLUMNS },
  overtime: { kind: "table", period: "range", mode: "OVERTIME", form: "ALL", columns: DEFAULT_ATTENDANCE_VIEW_COLUMNS.OVERTIME },
  absenceKinds: { kind: "table", period: "range", mode: "ABSENCE_KINDS", form: "ALL", columns: DEFAULT_ATTENDANCE_VIEW_COLUMNS.ABSENCE_KINDS },
  leaveBalances: { kind: "component" },
  teams: { kind: "table", period: "range", mode: "TEAM", form: "ALL", columns: DEFAULT_ATTENDANCE_VIEW_COLUMNS.TEAM },
  journal: { kind: "table", period: "range", mode: "JOURNAL", form: "JOURNAL", columns: DEFAULT_ATTENDANCE_VIEW_COLUMNS.JOURNAL },
  decisions: { kind: "component" },
} as const satisfies Record<string, AttendanceReportDefinition>
export type AttendanceReportKey = keyof typeof ATTENDANCE_REPORTS

export const ATTENDANCE_REPORT_GROUPS: readonly { key: string; reports: readonly AttendanceReportKey[] }[] = [
  { key: "daily", reports: ["day", "absent"] },
  { key: "month", reports: ["timesheet", "n1t", "summary", "balance"] },
  { key: "discipline", reports: ["late", "overtime"] },
  { key: "leave", reports: ["absenceKinds", "leaveBalances"] },
  { key: "control", reports: ["teams", "journal", "decisions"] },
]
/** Reports added on 2026-10-15; the cards mark them "new". */
export const NEW_ATTENDANCE_REPORTS: readonly AttendanceReportKey[] = ["n1t", "summary", "balance", "absenceKinds", "teams", "decisions"]

export function isAttendanceReportKey(value: unknown): value is AttendanceReportKey {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(ATTENDANCE_REPORTS, value)
}
