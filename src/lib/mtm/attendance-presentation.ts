import type { MtmAttendanceReportRow } from "@/lib/mtm/attendance-report"
import { attendanceDayKindLabel } from "@/lib/mtm/attendance-day-kinds"

/** Exact, locale-neutral duration shared by screens and exported attendance forms. */
export function formatAttendanceDuration(seconds: number | null): string {
  if (seconds === null || !Number.isSafeInteger(seconds) || seconds < 0) return "—"
  const hours = Math.floor(seconds / 3600)
  const minutes = String(Math.floor(seconds % 3600 / 60)).padStart(2, "0")
  const remainder = seconds % 60
  return `${hours}:${minutes}${remainder ? `:${String(remainder).padStart(2, "0")}` : ""}`
}

export const DEFAULT_ATTENDANCE_DAY_COLUMNS = ["employee", "team", "date", "status", "startedAt", "completedAt", "worked", "paused", "late", "early", "notes"] as const
export const DEFAULT_ATTENDANCE_JOURNAL_COLUMNS = ["employee", "team", "date", "status", "event", "phoneAt", "serverAt"] as const

const STATUS_KEYS: Record<MtmAttendanceReportRow["kind"], string> = { WORKED: "reportWorkedDay", OPEN: "reportOpenDay", MISSING_FINISH: "reportMissingFinish", ABSENT: "reportAbsentDay", WEEKEND: "reportWeekend", HOLIDAY: "reportHoliday", UPCOMING: "reportUpcoming", INVALID_FACTS: "reportInvalidFacts" }
export function attendanceStatusText(row: MtmAttendanceReportRow, locale: string, t: (key: string) => string) {
  return row.dayKind ? `${row.dayKind.code} · ${attendanceDayKindLabel(row.dayKind, locale)}` : t(STATUS_KEYS[row.kind])
}
export function attendanceMonthCell(row: MtmAttendanceReportRow | undefined, t: (key: string) => string) {
  if (!row) return "—"
  if (row.dayKind) return row.kind === "WORKED" || row.kind === "OPEN"
    ? `${row.dayKind.code} · ${formatAttendanceDuration(row.workedSeconds)}` : row.dayKind.code
  if (row.kind === "WEEKEND") return t("reportCodeWeekend")
  if (row.kind === "HOLIDAY") return t("reportCodeHoliday")
  if (row.kind === "ABSENT") return t("reportCodeAbsent")
  if (row.kind === "UPCOMING") return "·"
  if (row.kind === "MISSING_FINISH") return "?"
  if (row.kind === "INVALID_FACTS") return "!"
  return `${row.kind === "OPEN" ? "~" : ""}${formatAttendanceDuration(row.workedSeconds)}`
}
export function attendanceCatalogueLegend(rows: readonly MtmAttendanceReportRow[], locale: string): string[] {
  const kinds = new Map(rows.flatMap((row) => row.dayKind ? [[row.dayKind.key, row.dayKind] as const] : []))
  return [...kinds.values()].map((kind) => `${kind.code} — ${attendanceDayKindLabel(kind, locale)}`)
}
