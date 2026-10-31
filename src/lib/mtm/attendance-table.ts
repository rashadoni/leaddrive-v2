import { attendanceCountedOvertimeSeconds, attendanceOvertimeRows } from "@/lib/mtm/attendance-overtime"
import { addDateKeyDays } from "@/lib/mtm/mobile-week"
import { ATTENDANCE_LOCATION_STATE_MESSAGES, attendanceDayLocationText, attendanceEndpointBranch, summarizeAttendanceBranches } from "@/lib/mtm/attendance-location-report"
import { filterMtmAttendanceRows, summarizeMtmAttendanceRows, type MtmAttendanceReport, type MtmAttendanceReportRow, type MtmAttendanceReportTotals } from "@/lib/mtm/attendance-report"
import { attendanceStatusText, attendanceMonthCellGroup, attendanceCatalogueLegend, attendanceCorrectionLines, attendanceApprovedLines, attendanceJournalEntries, formatAttendanceDuration } from "@/lib/mtm/attendance-presentation"
import { AttendanceViewConfigSchema, type AttendanceViewConfig, type AttendanceViewColumn } from "@/lib/mtm/attendance-view-contract"
import { attendanceDayKindLabel, type AttendanceDayKind } from "@/lib/mtm/attendance-day-kinds"
import { formatDate, formatDateTime, formatTime } from "@/lib/format-date"

/**
 * What the screen draws for one row of a day report beside its printed cells
 * (owner, 2026-11-01: rows must not grow): short tags instead of the long
 * note, the note's lines behind «Ətraflı», and whether HR may still ask the
 * day to be explained. Excel and PDF read only the cells.
 */
export type AttendanceDayMeta = {
  employeeId: string
  date: string
  status: string
  statusColor: string | null
  tags: string[]
  lines: string[]
  late: boolean
  explainKind: "LATE" | "ABSENT" | null
  explanation: "REQUESTED" | "ANSWERED" | "ACCEPTED" | "REJECTED" | null
}
export type AttendanceText = (key: string, values?: Record<string, string | number>) => string
export type AttendanceTable = {
  title: string
  columns: { key: string; label: string }[]
  rows: { key: string; cells: (string | number)[]; kind?: MtmAttendanceReportRow["kind"]; day?: AttendanceDayMeta }[]
  details: string[]
  totals: string[]
}
const REASON: Record<string, string> = { DUPLICATE_WORKDAY: "reportReasonDuplicate", SCHEDULE_INVALID: "reportReasonSchedule", TIMESTAMP_INVALID: "reportReasonTimestamp", EVENT_TYPE_INVALID: "reportReasonEvent", JOURNAL_INCOMPLETE: "reportReasonJournal", PAUSE_TOTAL_MISMATCH: "reportReasonPause", WORKDAY_INCONSISTENT: "reportReasonFacts" }
const COLUMN: Record<AttendanceViewColumn, string> = { employee: "reportEmployee", position: "reportPosition", department: "reportDepartment", team: "reportTeam", date: "reportDate", status: "reportStatus", startedAt: "reportStarted", completedAt: "reportFinished", worked: "reportWorked", paused: "reportPaused", late: "reportLate", early: "reportEarly", event: "reportEvent", phoneAt: "reportPhoneTime", serverAt: "reportServerTime", days: "reportMonth", absent: "reportAbsentCount", notes: "reportNotes",
  arrivalBranch: "reportArrivalBranch", departureBranch: "reportDepartureBranch", markLocation: "reportMarkLocation", branch: "branchReportBranch", arrivals: "branchReportArrivals", departures: "branchReportDepartures", employees: "branchReportEmployees", outside: "branchReportOutside", uncertain: "branchReportUncertain", noLocation: "branchReportNoLocation", noConsent: "branchReportNoConsent", planned: "overtimePlanned", excess: "overtimeExcess", threshold: "overtimeThreshold", approvedOvertime: "overtimeApproved", overtimeState: "overtimeState",
  index: "reportIndex", workedDays: "reportWorkedDays", hours: "reportHours", plannedDays: "reportPlannedDays", expected: "reportExpected", lateCount: "reportLateCount", earlyCount: "reportEarlyCount",
  leaveDays: "reportLeaveDays", sickDays: "reportSickDays", overtimeHours: "reportOvertimeHours", attendanceRate: "reportAttendanceRate", balance: "reportBalance", kinds: "reportAbsenceKinds", absenceTotal: "reportAbsenceTotal" }
const SICK_KINDS = new Set(["SICK_LEAVE", "UNPAID_SICK"])
/** Day kinds that are an absence from work: leave of either kind and violations. */
const isAbsenceKind = (kind: AttendanceDayKind | undefined): kind is AttendanceDayKind => !!kind && ["PAID_LEAVE", "UNPAID_LEAVE", "VIOLATION"].includes(kind.group)
const TITLES = { SUMMARY: "reportSummaryTitle", BALANCE: "reportBalanceTitle", ABSENCE_KINDS: "reportAbsenceKindsTitle", TEAM: "reportTeamTitle" } as const

/** One person's (or one team's) period in the figures HR reads. */
function periodFigures(rows: readonly MtmAttendanceReportRow[], overtime: ReadonlyMap<MtmAttendanceReportRow, number>) {
  const summary = summarizeMtmAttendanceRows(rows)
  const plannedDays = rows.filter(row => row.expectedWorkSeconds > 0).length
  const workedDays = rows.filter(row => row.startedAt !== null && row.factsState === "VALID").length
  return { summary, plannedDays, workedDays,
    expectedSeconds: rows.reduce((total, row) => total + (row.factsState === "INVALID" ? 0 : row.expectedWorkSeconds), 0),
    leaveDays: rows.filter(row => isAbsenceKind(row.dayKind) && row.dayKind.group !== "VIOLATION" && !SICK_KINDS.has(row.dayKind.key)).length,
    sickDays: rows.filter(row => row.dayKind && SICK_KINDS.has(row.dayKind.key)).length,
    overtimeSeconds: rows.reduce((total, row) => total + (overtime.get(row) ?? 0), 0),
    rate: plannedDays ? `${Math.round(Math.min(workedDays, plannedDays) / plannedDays * 100)}%` : "—" }
}
const signedDuration = (seconds: number) => `${seconds > 0 ? "+" : seconds < 0 ? "−" : ""}${formatAttendanceDuration(Math.abs(seconds))}`

/** One text projection for personal forms, spreadsheet cells and PDF cells. */
export function buildAttendanceTable(report: MtmAttendanceReport, value: AttendanceViewConfig, locale: "az" | "ru" | "en", t: AttendanceText): AttendanceTable {
  const config = AttendanceViewConfigSchema.parse(value)
  const rows = filterMtmAttendanceRows(config.mode === "MONTH" ? report.accountingRows ?? report.rows : report.rows, config.filters)
  const totals = summarizeMtmAttendanceRows(rows)
  // Shared helpers, not Intl: a browser without Azerbaijani ICU data prints "2026 M10 14".
  const date = (key: string) => formatDate(`${key}T12:00:00.000Z`, locale, { dateStyle: "medium", timeZone: "UTC" })
  const time = (value: string | null, timezone: string, full = false) => !value ? "—" : full
    ? formatDateTime(value, locale, { timeZone: timezone, dateStyle: "short", timeStyle: "medium" })
    : formatTime(value, locale, { timeZone: timezone, hour: "2-digit", minute: "2-digit", second: "2-digit" })
  const title = t(config.mode in TITLES ? TITLES[config.mode as keyof typeof TITLES] : config.mode === "OVERTIME" ? "overtimeTitle" : config.mode === "BRANCH" ? "branchReportTitle"
    : config.mode === "MONTH" ? config.columns.includes("index") ? "reportN1tTitle" : "reportMonth" : config.mode === "JOURNAL" ? "reportJournal"
    : config.filters.form === "LATE_EARLY" ? "reportLateEarly" : config.filters.form === "ABSENCES" ? "reportAbsences" : "reportDay")
  const baseNotes = (row: MtmAttendanceReportRow) => row.factsState === "INVALID" ? row.invalidReasons.map((reason) => t(REASON[reason] ?? "reportReasonFacts")).join(" · ")
    : row.kind === "OPEN" ? t("reportProvisional") : row.kind === "MISSING_FINISH" ? t("reportUnknownTime") : row.kind === "ABSENT" ? t("reportAbsenceReasonPending") : row.flags.includes("WORKED_OUTSIDE_EMPLOYMENT") ? t("reportWorkOutsideEmployment") : row.flags.includes("WORKED_ON_APPROVED_ABSENCE") ? t("reportWorkOnLeave") : row.flags.includes("WORKED_ON_DAY_OFF") ? t("reportWorkOnDayOff") : row.calendarName ?? "—"
  const dayLines = (row: MtmAttendanceReportRow) => [baseNotes(row), ...(row.lunchAutoSeconds ? [t("reportLunchAuto", { time: formatAttendanceDuration(row.lunchAutoSeconds) })] : []),
    ...(row.explanations ?? []).map(item => t(`reportExplanation${item.status}`, { answer: item.answer ?? "" })), ...attendanceApprovedLines(row, locale, t), ...attendanceCorrectionLines(row, locale, t)].filter((line) => line !== "—")
  const dayNotes = (row: MtmAttendanceReportRow) => dayLines(row).join(" · ") || "—"
  const duration = (row: MtmAttendanceReportRow) => `${formatAttendanceDuration(row.workedSeconds)}${row.kind === "OPEN" ? ` · ${t("reportProvisionalShort")}` : ""}`
  // Absence kinds found in the period, in the company catalogue's order of first appearance.
  const absenceKinds = [...new Map(rows.flatMap(row => isAbsenceKind(row.dayKind) ? [[row.dayKind.key, row.dayKind] as const] : [])).values()]
  const columns: AttendanceTable["columns"] = config.columns.flatMap((column) => column === "days"
    ? Array.from({ length: Number(config.filters.to.slice(-2)) }, (_, index) => { const key = addDateKeyDays(config.filters.from, index); return { key, label: date(key) } })
    : column === "kinds" ? absenceKinds.map(kind => ({ key: `kind:${kind.key}`, label: `${kind.code} · ${attendanceDayKindLabel(kind, locale)}` }))
    : [{ key: column, label: t(config.mode === "MONTH" && column === "late" ? "reportLateCount" : COLUMN[column]) }])
  if (config.mode === "SUMMARY" || config.mode === "BALANCE" || config.mode === "ABSENCE_KINDS" || config.mode === "TEAM") {
    const overtime = new Map(attendanceOvertimeRows(rows).map(item => [item.row, attendanceCountedOvertimeSeconds(item)] as const).filter(([, seconds]) => seconds > 0))
    const groups = new Map<string, MtmAttendanceReportRow[]>()
    for (const row of rows) {
      const key = config.mode === "TEAM" ? row.teamId ?? "" : row.employeeId
      groups.set(key, [...(groups.get(key) ?? []), row])
    }
    const groupRows = [...groups].map(([key, days]) => {
      const figures = periodFigures(days, overtime)
      const data: Record<string, string | number> = {
        employee: days[0].employeeName, position: config.mode === "TEAM" ? "—" : days[0].employeePosition || "—", team: days[0].teamName ?? t("reportNoTeam"), employees: new Set(days.map(row => row.employeeId)).size,
        plannedDays: figures.plannedDays, workedDays: figures.workedDays, expected: formatAttendanceDuration(figures.expectedSeconds),
        worked: `${formatAttendanceDuration(figures.summary.workedSeconds)}${!figures.summary.isComplete ? ` · ${t("reportPartial")}` : ""}`,
        lateCount: figures.summary.lateCount, earlyCount: figures.summary.earlyLeaveCount, absent: figures.summary.absentCount,
        leaveDays: figures.leaveDays, sickDays: figures.sickDays, overtimeHours: formatAttendanceDuration(figures.overtimeSeconds), attendanceRate: figures.rate,
        balance: signedDuration(figures.summary.workedSeconds - figures.expectedSeconds),
        absenceTotal: days.filter(row => isAbsenceKind(row.dayKind)).length,
        ...Object.fromEntries(absenceKinds.map(kind => [`kind:${kind.key}`, days.filter(row => row.dayKind?.key === kind.key).length || "—"])),
      }
      return { key: key || "no-team", cells: columns.map(column => data[column.key] ?? "—") }
    }).sort((a, b) => String(a.cells[0]).localeCompare(String(b.cells[0]), locale))
    const zones = [...new Set(rows.map((row) => row.timezone))]
    return { title, columns, rows: groupRows,
      details: [t("reportPeriod", { from: date(config.filters.from), to: date(config.filters.to) }),
        t("reportSnapshot", { time: time(report.asOf, zones[0] ?? "Asia/Baku", true), timezone: zones[0] ?? "Asia/Baku" }), t(`${TITLES[config.mode]}Hint`), t("reportDurationFormat")],
      totals: config.showTotals ? [t("reportTotalsTitle"),
        t("reportTotals", { worked: formatAttendanceDuration(totals.workedSeconds), paused: formatAttendanceDuration(totals.pausedSeconds), late: formatAttendanceDuration(totals.lateSeconds), early: formatAttendanceDuration(totals.earlyLeaveSeconds) }),
        t("reportTotalsRows", { rows: totals.rowCount, employees: totals.employeeCount })] : [] }
  }
  if (config.mode === "OVERTIME") {
    const overtime = attendanceOvertimeRows(rows)
    const stateMessages = { UNKNOWN: "overtimeUnknown", THRESHOLD_UNSET: "overtimeThresholdUnset", EXCEEDED: "overtimeExceeded", WITHIN: "overtimeWithin" } as const
    const overtimeRows = overtime.map(item => {
      const { row } = item
      const data: Record<string, string> = { employee: row.employeeName, date: date(row.date), planned: formatAttendanceDuration(row.factsState === "INVALID" ? null : row.expectedWorkSeconds),
        worked: formatAttendanceDuration(item.excessSeconds === null ? null : row.workedSeconds), excess: formatAttendanceDuration(item.excessSeconds),
        threshold: formatAttendanceDuration(item.thresholdSeconds), approvedOvertime: formatAttendanceDuration(item.approvedSeconds), overtimeState: t(stateMessages[item.state]) }
      return { key: `${row.employeeId}:${row.date}`, cells: columns.map(column => data[column.key]), kind: row.kind }
    })
    const sum = (key: "excessSeconds" | "approvedSeconds") => overtime.reduce((total, row) => total + (row[key] ?? 0), 0)
    const partial = overtime.some(row => row.excessSeconds === null || row.approvedSeconds === null)
    return { title, columns, rows: overtimeRows,
      details: [t("reportPeriod", { from: date(config.filters.from), to: date(config.filters.to) }), t("reportSnapshot", { time: time(report.asOf, "UTC", true), timezone: "UTC" }), t("overtimeExplanation"), t("overtimeApprovalHint"), t("overtimeThresholdHint"), t("reportDurationFormat"),
        ...rows.flatMap(row => attendanceCorrectionLines(row, locale, t).map(line => `${row.employeeName} · ${date(row.date)} · ${line}`))],
      totals: config.showTotals ? [t("reportTotalsTitle"), t("overtimeTotals", { excess: formatAttendanceDuration(sum("excessSeconds")), approved: formatAttendanceDuration(sum("approvedSeconds")) }), ...(partial ? [t("overtimePartial")] : [])] : [] }
  }
  let tableRows: AttendanceTable["rows"]
  if (config.mode === "BRANCH") {
    tableRows = summarizeAttendanceBranches(rows).rows.map(row => {
      const data: Record<string, string | number | null> = { ...row, branch: row.branch?.name ?? t(ATTENDANCE_LOCATION_STATE_MESSAGES[row.state ?? "NOT_RECORDED"]) }
      return { key: row.key, cells: columns.map(column => data[column.key] ?? "—") }
    })
  } else if (config.mode === "MONTH") {
    const people = new Map<string, MtmAttendanceReportRow[]>()
    for (const row of rows) people.set(row.employeeId, [...(people.get(row.employeeId) ?? []), row])
    tableRows = [...people].map(([id, days], index) => {
      const summary = summarizeMtmAttendanceRows(days)
      const byDate = new Map<string, MtmAttendanceReportRow[]>()
      for (const row of days) byDate.set(row.date, [...(byDate.get(row.date) ?? []), row])
      const data: Record<string, string | number> = { employee: days[0].employeeName, position: days[0].employeePosition || "—", team: days[0].teamName ?? t("reportNoTeam"),
        worked: `${formatAttendanceDuration(summary.workedSeconds)}${!summary.isComplete ? ` · ${t("reportPartial")}` : ""}`, late: summary.lateCount, absent: summary.absentCount,
        index: index + 1, workedDays: days.filter(row => row.startedAt !== null && row.factsState === "VALID").length, hours: formatAttendanceDuration(summary.workedSeconds), notes: "" }
      return { key: id, cells: columns.map((column) => column.key in data ? data[column.key] : attendanceMonthCellGroup(byDate.get(column.key), locale, t)) }
    })
  } else if (config.mode === "JOURNAL") {
    tableRows = rows.flatMap((row) => attendanceJournalEntries(row, locale, t).map((entry) => {
      const data: Record<string, string> = { employee: row.employeeName, position: row.employeePosition || "—", department: row.departmentName || "—", team: row.teamName ?? t("reportNoTeam"), date: date(row.date), status: attendanceStatusText(row, locale, t), event: entry.description,
        phoneAt: time(entry.phoneAt, row.timezone, true), serverAt: time(entry.serverAt, row.timezone, true) }
      return { key: `${row.employeeId}:${row.date}:${entry.id}`, kind: row.kind, cells: columns.map((column) => data[column.key]) }
    }))
  } else {
    tableRows = rows.map((row) => {
      const data: Record<string, string> = { employee: row.employeeName, position: row.employeePosition || "—", department: row.departmentName || "—", team: row.teamName ?? t("reportNoTeam"), date: date(row.date), status: attendanceStatusText(row, locale, t), notes: dayNotes(row),
        startedAt: time(row.startedAt, row.timezone), completedAt: time(row.completedAt, row.timezone), worked: duration(row), paused: formatAttendanceDuration(row.pausedSeconds),
        late: formatAttendanceDuration(row.lateSeconds), early: formatAttendanceDuration(row.earlyLeaveSeconds),
        arrivalBranch: attendanceEndpointBranch(row, "START"), departureBranch: attendanceEndpointBranch(row, "FINISH"), markLocation: attendanceDayLocationText(row, t) }
      const late = (row.lateSeconds ?? 0) > 0 && row.startedAt !== null
      const day: AttendanceDayMeta = { employeeId: row.employeeId, date: row.date, status: data.status, statusColor: row.dayKind?.color ?? null,
        tags: [...(row.corrections?.length ? [t("reportTagCorrection")] : []), ...(row.lunchAutoSeconds ? [t("reportTagLunch", { time: formatAttendanceDuration(row.lunchAutoSeconds) })] : [])],
        lines: dayLines(row), late, explainKind: row.kind === "ABSENT" ? "ABSENT" : late ? "LATE" : null, explanation: row.explanations?.[0]?.status ?? null }
      return { key: `${row.employeeId}:${row.date}`, kind: row.kind, cells: columns.map((column) => data[column.key]), day }
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
  return { title, columns, rows: tableRows, details, totals: config.showTotals ? attendanceTotalLines(totals, t) : [] }
}

/** The figures a day, journal or month table totals: plain numbers, the same in every language. */
export type AttendanceTotalFigures = Pick<MtmAttendanceReportTotals, "workedSeconds" | "pausedSeconds" | "lateSeconds" | "earlyLeaveSeconds" | "rowCount" | "employeeCount" | "annualLeaveDays" | "unknownWorkedCount" | "unknownPausedCount">
/** The totals under a day, journal or month table — one wording for the screen, Excel and PDF. */
export function attendanceTotalLines(totals: AttendanceTotalFigures, t: AttendanceText): string[] {
  const lines = [t("reportTotalsTitle"),
    t("reportTotals", { worked: formatAttendanceDuration(totals.workedSeconds), paused: formatAttendanceDuration(totals.pausedSeconds), late: formatAttendanceDuration(totals.lateSeconds), early: formatAttendanceDuration(totals.earlyLeaveSeconds) }),
    t("reportTotalsRows", { rows: totals.rowCount, employees: totals.employeeCount })]
  if (totals.annualLeaveDays > 0) lines.push(t("reportAnnualLeaveDays", { days: totals.annualLeaveDays }))
  if (totals.unknownWorkedCount > 0 || totals.unknownPausedCount > 0) lines.push(t("reportIncompleteTotals", { worked: totals.unknownWorkedCount, paused: totals.unknownPausedCount }))
  return lines
}
