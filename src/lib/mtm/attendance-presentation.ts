import type { MtmAttendanceCorrection, MtmAttendanceReportRow } from "@/lib/mtm/attendance-report"
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

const STATUS_KEYS: Record<MtmAttendanceReportRow["kind"], string> = { APPROVED_REQUEST: "reportApprovedRequest", WORKED: "reportWorkedDay", OPEN: "reportOpenDay", MISSING_FINISH: "reportMissingFinish", ABSENT: "reportAbsentDay", WEEKEND: "reportWeekend", HOLIDAY: "reportHoliday", UPCOMING: "reportUpcoming", INVALID_FACTS: "reportInvalidFacts" }
export function attendanceStatusText(row: MtmAttendanceReportRow, locale: string, t: (key: string) => string) {
  return row.dayKind ? `${row.dayKind.code} · ${attendanceDayKindLabel(row.dayKind, locale)}` : t(STATUS_KEYS[row.kind])
}
export function attendanceMonthCell(row: MtmAttendanceReportRow | undefined, t: (key: string) => string) {
  if (!row) return "—"
  const corrected = row.corrections?.length ? " *" : ""
  if (row.dayKind) return row.kind === "WORKED" || row.kind === "OPEN"
    ? `${row.dayKind.code} · ${formatAttendanceDuration(row.workedSeconds)}${corrected}` : `${row.dayKind.code}${corrected}`
  if (row.kind === "WEEKEND") return t("reportCodeWeekend")
  if (row.kind === "HOLIDAY") return t("reportCodeHoliday")
  if (row.kind === "ABSENT") return t("reportCodeAbsent")
  if (row.kind === "UPCOMING") return "·"
  if (row.kind === "MISSING_FINISH") return "?"
  if (row.kind === "INVALID_FACTS") return "!"
  return `${row.kind === "OPEN" ? "~" : ""}${formatAttendanceDuration(row.workedSeconds)}${corrected}`
}
export function attendanceCatalogueLegend(rows: readonly MtmAttendanceReportRow[], locale: string): string[] {
  const kinds = new Map(rows.flatMap((row) => row.dayKind ? [[row.dayKind.key, row.dayKind] as const] : []))
  return [...kinds.values()].map((kind) => `${kind.code} — ${attendanceDayKindLabel(kind, locale)}`)
}

type AttendanceHistoryText = (key: string, values?: Record<string, string | number>) => string
/** Human-readable history shared verbatim by the built-in screen and exports. */
export function attendanceCorrectionText(row: MtmAttendanceReportRow, correction: MtmAttendanceCorrection, locale: string, t: AttendanceHistoryText): string {
  const time = (value: string | null) => value ? new Intl.DateTimeFormat(locale, { timeZone: row.timezone, hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(value)) : "—"
  const facts = (value: MtmAttendanceCorrection["after"]) => t("reportCorrectionFacts", { start: time(value.startedAt), end: time(value.completedAt), paused: formatAttendanceDuration(value.totalPausedSeconds) })
  return t("reportCorrectionEntry", { before: correction.before.kind === "MISSING" ? t("reportCorrectionMissing") : facts(correction.before.facts), after: facts(correction.after),
    reviewer: correction.reviewer.name || t("reportCorrectionReviewer"),
    at: new Intl.DateTimeFormat(locale, { timeZone: row.timezone, dateStyle: "short", timeStyle: "medium" }).format(new Date(correction.occurredAt)) })
}
/** Approved periods describe permission; they never manufacture a phone event. */
export function attendanceApprovedLines(row: MtmAttendanceReportRow, locale: string, t: AttendanceHistoryText): string[] {
  const date = (value: string) => new Intl.DateTimeFormat(locale, { timeZone: "UTC", dateStyle: "medium" }).format(new Date(`${value}T12:00:00Z`))
  return (row.approvedRequests ?? []).map(entry => t("reportApprovedPeriod", {
    kind: attendanceDayKindLabel(entry.details.dayKind, locale),
    period: entry.details.unit === "HOURS"
      ? `${date(entry.startDate)} · ${entry.details.startTime}–${entry.details.endTime} (${entry.details.timezone})`
      : `${date(entry.startDate)}${entry.startDate === entry.endDate ? "" : ` — ${date(entry.endDate)}`}`,
  }))
}
export function attendanceCorrectionLines(row: MtmAttendanceReportRow, locale: string, t: AttendanceHistoryText): string[] {
  return (row.corrections ?? []).map((correction) => attendanceCorrectionText(row, correction, locale, t))
}
const EVENT_KEYS = { START: "reportEventStart", PAUSE: "reportEventPause", RESUME: "reportEventResume", FINISH: "reportEventFinish", REOPEN: "reportEventReopen" } as const
/** Corrections are distinct decision entries and never inherit a phone clock. */
export function attendanceJournalEntries(row: MtmAttendanceReportRow, locale: string, t: AttendanceHistoryText) {
  return [
    ...row.events.map((event, index) => ({ id: `event:${event.id ?? index}`, description: t(EVENT_KEYS[event.type]),
      phoneAt: event.claimedAt ?? event.occurredAt, serverAt: event.serverReceivedAt, correction: false })),
    ...(row.corrections ?? []).map((correction) => ({ id: `correction:${correction.id}`, description: attendanceCorrectionText(row, correction, locale, t),
      phoneAt: null, serverAt: correction.occurredAt, correction: true })),
  ]
}
