import { addDateKeyDays } from "@/lib/mtm/mobile-week"
import { ATTENDANCE_LOCATION_STATE_MESSAGES, attendanceDayLocationText, attendanceEndpointBranch, summarizeAttendanceBranches } from "@/lib/mtm/attendance-location-report"
import { filterMtmAttendanceRows, summarizeMtmAttendanceRows, type MtmAttendanceReport, type MtmAttendanceReportRow } from "@/lib/mtm/attendance-report"
import { attendanceStatusText, attendanceMonthCellGroup, attendanceCatalogueLegend, attendanceCorrectionLines, attendanceApprovedLines, attendanceJournalEntries, formatAttendanceDuration } from "@/lib/mtm/attendance-presentation"
import { AttendanceViewConfigSchema, type AttendanceViewConfig, type AttendanceViewColumn } from "@/lib/mtm/attendance-view-contract"

export type AttendanceText = (key: string, values?: Record<string, string | number>) => string
export type AttendanceTable = {
  title: string
  columns: { key: string; label: string }[]
  rows: { key: string; cells: (string | number)[]; kind?: MtmAttendanceReportRow["kind"] }[]
  details: string[]
  totals: string[]
}
const REASON: Record<string, string> = { DUPLICATE_WORKDAY: "reportReasonDuplicate", SCHEDULE_INVALID: "reportReasonSchedule", TIMESTAMP_INVALID: "reportReasonTimestamp", EVENT_TYPE_INVALID: "reportReasonEvent", JOURNAL_INCOMPLETE: "reportReasonJournal", PAUSE_TOTAL_MISMATCH: "reportReasonPause", WORKDAY_INCONSISTENT: "reportReasonFacts" }
const COLUMN: Record<AttendanceViewColumn, string> = { employee: "reportEmployee", team: "reportTeam", date: "reportDate", status: "reportStatus", startedAt: "reportStarted", completedAt: "reportFinished", worked: "reportWorked", paused: "reportPaused", late: "reportLate", early: "reportEarly", event: "reportEvent", phoneAt: "reportPhoneTime", serverAt: "reportServerTime", days: "reportMonth", absent: "reportAbsentCount", notes: "reportNotes",
  arrivalBranch: "reportArrivalBranch", departureBranch: "reportDepartureBranch", markLocation: "reportMarkLocation", branch: "branchReportBranch", arrivals: "branchReportArrivals", departures: "branchReportDepartures", employees: "branchReportEmployees", outside: "branchReportOutside", uncertain: "branchReportUncertain", noLocation: "branchReportNoLocation", noConsent: "branchReportNoConsent" }

/** One text projection for personal forms, spreadsheet cells and PDF cells. */
export function buildAttendanceTable(report: MtmAttendanceReport, value: AttendanceViewConfig, locale: "az" | "ru" | "en", t: AttendanceText): AttendanceTable {
  const config = AttendanceViewConfigSchema.parse(value)
  const rows = filterMtmAttendanceRows(config.mode === "MONTH" ? report.accountingRows ?? report.rows : report.rows, config.filters)
  const totals = summarizeMtmAttendanceRows(rows)
  const date = (key: string) => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${key}T12:00:00Z`))
  const time = (value: string | null, timezone: string, full = false) => value ? new Intl.DateTimeFormat(locale, {
    timeZone: timezone, ...(full ? { dateStyle: "short", timeStyle: "medium" } : { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
  }).format(new Date(value)) : "—"
  const title = t(config.mode === "BRANCH" ? "branchReportTitle" : config.mode === "MONTH" ? "reportMonth" : config.mode === "JOURNAL" ? "reportJournal" : config.filters.form === "LATE_EARLY" ? "reportLateEarly" : config.filters.form === "ABSENCES" ? "reportAbsences" : "reportDay")
  const baseNotes = (row: MtmAttendanceReportRow) => row.factsState === "INVALID" ? row.invalidReasons.map((reason) => t(REASON[reason] ?? "reportReasonFacts")).join(" · ")
    : row.kind === "OPEN" ? t("reportProvisional") : row.kind === "MISSING_FINISH" ? t("reportUnknownTime") : row.kind === "ABSENT" ? t("reportAbsenceReasonPending") : row.flags.includes("WORKED_OUTSIDE_EMPLOYMENT") ? t("reportWorkOutsideEmployment") : row.flags.includes("WORKED_ON_APPROVED_ABSENCE") ? t("reportWorkOnLeave") : row.flags.includes("WORKED_ON_DAY_OFF") ? t("reportWorkOnDayOff") : row.calendarName ?? "—"
  const dayNotes = (row: MtmAttendanceReportRow) => [baseNotes(row), ...attendanceApprovedLines(row, locale, t), ...attendanceCorrectionLines(row, locale, t)].filter((line) => line !== "—").join(" · ") || "—"
  const duration = (row: MtmAttendanceReportRow) => `${formatAttendanceDuration(row.workedSeconds)}${row.kind === "OPEN" ? ` · ${t("reportProvisionalShort")}` : ""}`
  const columns: AttendanceTable["columns"] = config.columns.flatMap((column) => column === "days"
    ? Array.from({ length: Number(config.filters.to.slice(-2)) }, (_, index) => { const key = addDateKeyDays(config.filters.from, index); return { key, label: date(key) } })
    : [{ key: column, label: t(config.mode === "MONTH" && column === "late" ? "reportLateCount" : COLUMN[column]) }])
  let tableRows: AttendanceTable["rows"]
  if (config.mode === "BRANCH") {
    tableRows = summarizeAttendanceBranches(rows).rows.map(row => {
      const data: Record<string, string | number | null> = { ...row, branch: row.branch?.name ?? t(ATTENDANCE_LOCATION_STATE_MESSAGES[row.state ?? "NOT_RECORDED"]) }
      return { key: row.key, cells: columns.map(column => data[column.key] ?? "—") }
    })
  } else if (config.mode === "MONTH") {
    const people = new Map<string, MtmAttendanceReportRow[]>()
    for (const row of rows) people.set(row.employeeId, [...(people.get(row.employeeId) ?? []), row])
    tableRows = [...people].map(([id, days]) => {
      const summary = summarizeMtmAttendanceRows(days)
      const byDate = new Map<string, MtmAttendanceReportRow[]>()
      for (const row of days) byDate.set(row.date, [...(byDate.get(row.date) ?? []), row])
      const data: Record<string, string | number> = { employee: days[0].employeeName, team: days[0].teamName ?? t("reportNoTeam"),
        worked: `${formatAttendanceDuration(summary.workedSeconds)}${!summary.isComplete ? ` · ${t("reportPartial")}` : ""}`, late: summary.lateCount, absent: summary.absentCount }
      return { key: id, cells: columns.map((column) => column.key in data ? data[column.key] : attendanceMonthCellGroup(byDate.get(column.key), locale, t)) }
    })
  } else if (config.mode === "JOURNAL") {
    tableRows = rows.flatMap((row) => attendanceJournalEntries(row, locale, t).map((entry) => {
      const data: Record<string, string> = { employee: row.employeeName, team: row.teamName ?? t("reportNoTeam"), date: date(row.date), status: attendanceStatusText(row, locale, t), event: entry.description,
        phoneAt: time(entry.phoneAt, row.timezone, true), serverAt: time(entry.serverAt, row.timezone, true) }
      return { key: `${row.employeeId}:${row.date}:${entry.id}`, kind: row.kind, cells: columns.map((column) => data[column.key]) }
    }))
  } else {
    tableRows = rows.map((row) => {
      const data: Record<string, string> = { employee: row.employeeName, team: row.teamName ?? t("reportNoTeam"), date: date(row.date), status: attendanceStatusText(row, locale, t), notes: dayNotes(row),
        startedAt: time(row.startedAt, row.timezone), completedAt: time(row.completedAt, row.timezone), worked: duration(row), paused: formatAttendanceDuration(row.pausedSeconds),
        late: formatAttendanceDuration(row.lateSeconds), early: formatAttendanceDuration(row.earlyLeaveSeconds),
        arrivalBranch: attendanceEndpointBranch(row, "START"), departureBranch: attendanceEndpointBranch(row, "FINISH"), markLocation: attendanceDayLocationText(row, t) }
      return { key: `${row.employeeId}:${row.date}`, kind: row.kind, cells: columns.map((column) => data[column.key]) }
    })
  }
  const zones = [...new Set(rows.map((row) => row.timezone))]
  const details = [t("reportPeriod", { from: date(config.filters.from), to: date(config.filters.to) }),
    t("reportSnapshot", { time: time(report.asOf, zones[0] ?? "Asia/Baku", true), timezone: zones[0] ?? "Asia/Baku" }),
    t("reportTimezones", { zones: zones.join(", ") || "—" }), ...(config.mode === "BRANCH" ? [] : [t("reportDurationFormat")])]
  if (config.mode === "BRANCH") {
    const summary = summarizeAttendanceBranches(rows)
    const known = summary.totals.arrivals + summary.totals.departures
    const displayTotals = known === 0 && summary.totals.unknown > 0
      ? Object.fromEntries(Object.keys(summary.totals).map(key => [key, "—"])) : summary.totals
    details.push(t("branchReportExplanation"), t("branchReportUnknown"))
    return { title, columns, rows: tableRows, details,
      totals: config.showTotals ? [t("reportTotalsTitle"), t("branchReportTotal", displayTotals)] : [] }
  }
  if (config.columns.some(column => ["arrivalBranch", "departureBranch", "markLocation"].includes(column))) details.push(t("branchReportExplanation"), t("branchReportUnknown"))
  const catalogueLegend = attendanceCatalogueLegend(rows, locale)
  if (config.mode === "MONTH") details.push(catalogueLegend.length ? catalogueLegend.join(" · ") : [
    [t("reportCodeWeekend"), "reportWeekend"], [t("reportCodeHoliday"), "reportHoliday"], [t("reportCodeAbsent"), "reportAbsentDay"],
    ["·", "reportUpcoming"], ["?", "reportMissingFinish"], ["!", "reportInvalidFacts"], ["~", "reportProvisionalShort"],
  ].map(([code, key]) => `${code} — ${t(key)}`).join(" · "))
  if (rows.some((row) => row.kind === "OPEN")) details.push(t("reportProvisional"))
  if (rows.some((row) => row.corrections?.length)) {
    details.push(t("reportCorrectionLegend"))
    // History is retained even when a personal form hides its notes/event column.
    if (config.mode === "MONTH" || (config.mode === "DAY" && !config.columns.includes("notes"))
      || (config.mode === "JOURNAL" && !config.columns.includes("event"))) {
      for (const row of rows) for (const line of attendanceCorrectionLines(row, locale, t)) details.push(`${row.employeeName} · ${date(row.date)} · ${line}`)
    }
  }
  if (config.mode !== "DAY" || !config.columns.includes("notes")) {
    for (const row of rows) for (const line of attendanceApprovedLines(row, locale, t)) details.push(`${row.employeeName} · ${date(row.date)} · ${line}`)
  }
  const totalLines = config.showTotals ? [t("reportTotalsTitle"),
    t("reportTotals", { worked: formatAttendanceDuration(totals.workedSeconds), paused: formatAttendanceDuration(totals.pausedSeconds), late: formatAttendanceDuration(totals.lateSeconds), early: formatAttendanceDuration(totals.earlyLeaveSeconds) }),
    t("reportTotalsRows", { rows: totals.rowCount, employees: totals.employeeCount })] : []
  if (config.showTotals && totals.annualLeaveDays > 0) totalLines.push(t("reportAnnualLeaveDays", { days: totals.annualLeaveDays }))
  if (config.showTotals && !totals.isComplete) totalLines.push(t("reportIncompleteTotals", { worked: totals.unknownWorkedCount, paused: totals.unknownPausedCount }))
  return { title, columns, rows: tableRows, details, totals: totalLines }
}
