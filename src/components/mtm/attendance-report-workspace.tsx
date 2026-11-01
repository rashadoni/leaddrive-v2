"use client"

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react"
import { Hint, HintValue } from "@/components/hint"
import Link from "next/link"
import { useFormatter, useLocale, useTranslations } from "next-intl"
import { formatDate, formatDateTime, formatTime } from "@/lib/format-date"
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, Clock3, ListChecks, Lock, LogIn, LogOut, Search, UserRoundX, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { HomeCard, HomeKpi, HomePill, type HomeTone } from "@/components/mtm/home-parts"
import { addDateKeyDays, isDateKey } from "@/lib/mtm/mobile-week"
import { attendanceDayKindLabel } from "@/lib/mtm/attendance-day-kinds"
import { filterMtmAttendanceRows, summarizeMtmAttendanceRows, type MtmAttendanceReport, type MtmAttendanceReportRow } from "@/lib/mtm/attendance-report"
import { formatAttendanceDuration, attendanceStatusText, attendanceMonthCell, attendanceMonthCellGroup, attendanceCatalogueLegend, attendanceCorrectionLines, attendanceApprovedLines, attendanceJournalEntries } from "@/lib/mtm/attendance-presentation"
import { DEFAULT_ATTENDANCE_VIEW_COLUMNS, type AttendanceViewConfig } from "@/lib/mtm/attendance-view-contract"
import { buildAttendanceTable } from "@/lib/mtm/attendance-table"
import { attendanceCountedOvertimeSeconds, attendanceOvertimeRows } from "@/lib/mtm/attendance-overtime"
import { TIMESHEET_ISSUES, type TimesheetIssue } from "@/lib/mtm/attendance-timesheet-filters"
import { MtmAttendanceHelp } from "@/components/mtm/attendance-help"
import { MtmAttendancePersonalViews } from "@/components/mtm/attendance-personal-views"
import { MtmAttendanceExportButtons } from "@/components/mtm/attendance-export-buttons"
import { MtmAttendanceDeliveries } from "@/components/mtm/attendance-deliveries"
import { MtmAttendanceHrAccess } from "@/components/mtm/attendance-hr-access"
import { MtmAttendanceDayKinds } from "@/components/mtm/attendance-day-kinds"
import { MtmAttendanceRequestLimits } from "@/components/mtm/attendance-request-limits"
import type { AttendanceReportSnapshot } from "@/lib/mtm/attendance-query"
import { mtmChipClass } from "@/components/mtm/calm-classes"

export type AttendanceReportForm = "DAY" | "MONTH" | "LATE_EARLY" | "ABSENCES" | "JOURNAL" | "BRANCH" | "OVERTIME"
const ISSUE_LABELS: Record<TimesheetIssue, string> = { late: "kpiLate", absent: "kpiAbsent", "missing-finish": "kpiMissing", overtime: "tabs.overtime" }
type Form = AttendanceReportForm
type Range = { from: string; to: string }
type ReportData = MtmAttendanceReport & { snapshot?: AttendanceReportSnapshot }
const FORMS: Form[] = ["DAY", "MONTH", "LATE_EARLY", "ABSENCES", "OVERTIME", "JOURNAL"]
const FORM_MESSAGES: Record<Form, string> = { DAY: "reportDay", MONTH: "reportMonth", LATE_EARLY: "reportLateEarly", ABSENCES: "reportAbsences", JOURNAL: "reportJournal", BRANCH: "branchReportTitle", OVERTIME: "overtimeTitle" }
const REASON_MESSAGES: Record<string, string> = { DUPLICATE_WORKDAY: "reportReasonDuplicate", SCHEDULE_INVALID: "reportReasonSchedule", TIMESTAMP_INVALID: "reportReasonTimestamp",
  EVENT_TYPE_INVALID: "reportReasonEvent", JOURNAL_INCOMPLETE: "reportReasonJournal", PAUSE_TOTAL_MISMATCH: "reportReasonPause", WORKDAY_INCONSISTENT: "reportReasonFacts" }
const SELECT_CLASS = "min-h-11 w-full rounded-lg border border-input bg-card px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
const CELL = "border-b border-border px-3 py-3 align-top"
const HEADER = "px-3 py-3 text-left text-xs font-medium text-muted-foreground"
const PAGE_SIZE = 50

function monthRange(month: string): Range {
  const [year, number] = month.split("-").map(Number)
  return { from: `${month}-01`, to: new Date(Date.UTC(year, number, 0, 12)).toISOString().slice(0, 10) }
}
/** The month «Close month» opens. The shown one once it is over; a running or a
 * future month has no press to close it yet, so the month that just ended, the
 * one there is to close (as the former link to «Closed months» opened). */
function monthToCloseDate(shownFrom: string, today: string): string {
  if (shownFrom.slice(0, 7) < today.slice(0, 7)) return `${shownFrom.slice(0, 7)}-01`
  const [year, number] = today.split("-").map(Number)
  return new Date(Date.UTC(year, number - 2, 1, 12)).toISOString().slice(0, 10)
}
function rowTone(row: MtmAttendanceReportRow): HomeTone {
  if (row.kind === "INVALID_FACTS" || row.kind === "ABSENT") return "red"
  if (row.kind === "MISSING_FINISH" || (row.lateSeconds ?? 0) > 0 || (row.earlyLeaveSeconds ?? 0) > 0) return "amber"
  if (row.kind === "OPEN" || row.kind === "HOLIDAY") return "blue"
  return row.kind === "WORKED" ? "green" : "zinc"
}

/** Opening period of each Timesheet tab: the month grid shows the month, day
 * views a single day (or the linked one), deviation lists the month so far. */
function timesheetRange(form: Form, today: string, date?: string): Range {
  if (form === "MONTH") return monthRange((date && isDateKey(date) ? date : today).slice(0, 7))
  if (form === "DAY" || form === "JOURNAL") return date && isDateKey(date) ? { from: date, to: date } : { from: today, to: today }
  return { from: `${today.slice(0, 7)}-01`, to: today }
}

type WorkspaceProps = {
  /** "timesheet" is Personnel → Timesheet: one month grid with filter buttons
   * and a day card per cell (owner, 2026-10-14: nine tabs were too many). "full"
   * is the former single page, kept until its UI tests move to the timesheet. */
  layout?: "full" | "timesheet"
  initialForm?: Form
  /** Opens that date's month; with `initialEmployeeId` also opens its day card. */
  initialDate?: string
  initialEmployeeId?: string
  initialFilter?: TimesheetIssue
}

/** All forms, filters, cards and totals select from one server-scoped day-row snapshot. */
export function MtmAttendanceReportWorkspace({ layout = "full", initialForm, initialDate, initialEmployeeId, initialFilter }: WorkspaceProps = {}) {
  const t = useTranslations("mtmAttendance")
  const p = useTranslations("personnel")
  const format = useFormatter()
  const locale = useLocale() as "az" | "ru" | "en"
  const [today, setToday] = useState<string | null>(null)
  const [range, setRange] = useState<Range>({ from: "", to: "" })
  const [report, setReport] = useState<ReportData | null>(null)
  const [form, setForm] = useState<Form>(initialForm ?? "DAY")
  const [teamId, setTeamId] = useState("")
  const [employeeId, setEmployeeId] = useState(initialEmployeeId ?? "")
  const [search, setSearch] = useState("")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [rangeError, setRangeError] = useState<string | null>(null)
  const [page, setPage] = useState(0)
  const [customView, setCustomView] = useState<{ name: string; config: AttendanceViewConfig } | null>(null)
  const [accessUnavailable, setAccessUnavailable] = useState(false)
  const [canManageAccess, setCanManageAccess] = useState(false)
  const [issue, setIssue] = useState<TimesheetIssue | null>(initialFilter ?? null)
  const [openCell, setOpenCell] = useState<string | null>(initialEmployeeId && initialDate && isDateKey(initialDate) ? `${initialEmployeeId}:${initialDate}` : null)
  const [showExtras, setShowExtras] = useState(false)
  const request = useRef<AbortController | null>(null)
  const lastRequest = useRef<{ range?: Range; config?: AttendanceViewConfig }>({})

  const load = useCallback(async (requestedRange?: Range, savedConfig?: AttendanceViewConfig) => {
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    setLoading(true)
    setError(null)
    setRangeError(null)
    setReport(null)
    setPage(0)
    setAccessUnavailable(false)
    try {
      // Refresh management rights with the report; a demoted administrator
      // must not retain a previously opened HR user list.
      const settingsResponse = await fetch("/api/v1/mtm/attendance/rules", { cache: "no-store", signal: controller.signal })
      const settingsBody = await settingsResponse.json().catch(() => null)
      if (controller.signal.aborted) return
      if (!settingsResponse.ok || settingsBody?.success !== true || !isDateKey(settingsBody.data?.today)) {
        setCanManageAccess(false)
        setError(t([401, 403, 404].includes(settingsResponse.status) ? "reportAccessUnavailable" : "reportLoadError"))
        if ([401, 403, 404].includes(settingsResponse.status)) setAccessUnavailable(true)
        return
      }
      setToday(settingsBody.data.today)
      setCanManageAccess(settingsBody.data.canManageRules === true)
      const selected = requestedRange ?? (layout === "timesheet" ? timesheetRange(initialForm ?? "DAY", settingsBody.data.today, initialDate) : { from: settingsBody.data.today, to: settingsBody.data.today })
      setRange(selected)
      lastRequest.current = { range: selected, config: savedConfig }
      const query = new URLSearchParams({ from: selected.from, to: selected.to, form: "ALL" })
      if (savedConfig?.filters.employeeId) query.set("employeeId", savedConfig.filters.employeeId)
      if (savedConfig?.filters.teamId) query.set("teamId", savedConfig.filters.teamId)
      const response = await fetch(`/api/v1/mtm/attendance/report?${query}`, { cache: "no-store", signal: controller.signal })
      const body = await response.json().catch(() => null)
      if (controller.signal.aborted) return
      if (!response.ok || body?.success !== true || !Array.isArray(body.data?.rows)) {
        setError(t([401, 403, 404].includes(response.status) ? "reportAccessUnavailable"
          : body?.code === "MTM_ATTENDANCE_REPORT_TOO_LARGE" ? "reportTooLarge" : "reportLoadError"))
        if ([401, 403, 404].includes(response.status)) { setAccessUnavailable(true); setCanManageAccess(false); setCustomView((previous) => previous ? { ...previous, name: "" } : null) }
        return
      }
      const loaded = body.data as ReportData
      setReport(loaded)
      // A saved employee/team that left the current scope stays selected.
      // An empty result must never silently turn into an all-employee report.
    } catch {
      if (!controller.signal.aborted) { setCanManageAccess(false); setError(t("reportLoadError")) }
    } finally {
      if (!controller.signal.aborted) setLoading(false)
    }
  }, [t, layout, initialForm, initialDate])

  useEffect(() => {
    // Changing language refreshes the same period and saved scope; it must
    // not bootstrap a monthly form with a single-day report.
    void load(lastRequest.current.range, lastRequest.current.config)
    return () => request.current?.abort()
  }, [load])

  const currentConfig = useMemo<AttendanceViewConfig | null>(() => {
    if (!report) return null
    const mode = customView?.config.mode ?? (form === "MONTH" ? "MONTH" : form === "JOURNAL" ? "JOURNAL" : form === "BRANCH" ? "BRANCH" : form === "OVERTIME" ? "OVERTIME" : "DAY")
    return { version: 1, mode, columns: customView?.config.columns ?? [...DEFAULT_ATTENDANCE_VIEW_COLUMNS[mode]], showTotals: customView?.config.showTotals ?? true,
      filters: { from: report.from, to: report.to, form: customView?.config.filters.form ?? (form === "DAY" || form === "MONTH" || form === "BRANCH" || form === "OVERTIME" ? "ALL" : form),
        ...(teamId ? { teamId } : {}), ...(employeeId ? { employeeId } : {}) } }
  }, [report, customView, form, teamId, employeeId])

  const directory = useMemo(() => {
    const employees = new Map<string, { id: string; name: string; teamId: string | null }>()
    const teams = new Map<string, string>()
    for (const row of report?.rows ?? []) {
      employees.set(row.employeeId, { id: row.employeeId, name: row.employeeName, teamId: row.teamId })
      if (row.teamId) teams.set(row.teamId, row.teamName ?? t("reportUnnamedTeam"))
    }
    return { employees: [...employees.values()], teams: [...teams].map(([id, name]) => ({ id, name })) }
  }, [report, t])
  const rows = useMemo(() => {
    const filtered = filterMtmAttendanceRows((form === "MONTH" ? report?.accountingRows ?? report?.rows : report?.rows) ?? [], { teamId: teamId || undefined, employeeId: employeeId || undefined,
      form: customView?.config.filters.form ?? (form === "DAY" || form === "MONTH" || form === "BRANCH" || form === "OVERTIME" ? "ALL" : form) })
    const needle = layout === "timesheet" ? search.trim().toLocaleLowerCase(locale) : ""
    const found = needle ? filtered.filter(row => row.employeeName.toLocaleLowerCase(locale).includes(needle)) : filtered
    return form === "OVERTIME" ? attendanceOvertimeRows(found).map(item => item.row) : found
  }, [report, teamId, employeeId, form, customView, layout, search, locale])
  const totals = useMemo(() => summarizeMtmAttendanceRows(rows), [rows])
  const customTable = useMemo(() => report && (customView || form === "OVERTIME") && currentConfig ? buildAttendanceTable(report, currentConfig, locale, t) : null, [report, customView, form, currentConfig, locale, t])
  const scopeUnavailable = Boolean(report && (teamId || employeeId) && !report.rows.some((row) => (!teamId || row.teamId === teamId) && (!employeeId || row.employeeId === employeeId)))
  const journal = useMemo(() => form === "JOURNAL" ? rows.flatMap((row) => attendanceJournalEntries(row, locale, t).map((entry) => ({ row, entry }))) : [], [rows, form, locale, t])
  const monthEmployees = useMemo(() => {
    if (form !== "MONTH") return []
    const people = new Map<string, { name: string; team: string | null; rows: MtmAttendanceReportRow[]; dates: Map<string, MtmAttendanceReportRow[]> }>()
    for (const row of rows) {
      if (!people.has(row.employeeId)) people.set(row.employeeId, { name: row.employeeName, team: row.teamName, rows: [], dates: new Map() })
      const employee = people.get(row.employeeId)!
      employee.rows.push(row)
      employee.dates.set(row.date, [...(employee.dates.get(row.date) ?? []), row])
    }
    return [...people].map(([id, person]) => ({ id, ...person, totals: summarizeMtmAttendanceRows(person.rows) }))
  }, [rows, form])
  const monthDates = useMemo(() => {
    if (form !== "MONTH" || !report) return []
    const count = Math.round((Date.parse(report.to) - Date.parse(report.from)) / 86_400_000) + 1
    return Array.from({ length: Math.min(count, 31) }, (_, index) => addDateKeyDays(report.from, index))
  }, [report, form])
  // Overtime is the report's own rule: past the expected day by more than the
  // company's threshold. Without a threshold nothing is flagged — nine hours
  // against eight would otherwise mark every full day.
  const overtimeRows = useMemo(() => new Set(layout === "timesheet" && form === "MONTH" ? attendanceOvertimeRows(rows).filter(item => attendanceCountedOvertimeSeconds(item) > 0).map(item => item.row) : []), [rows, form, layout])
  const hasIssue = (row: MtmAttendanceReportRow, kind: TimesheetIssue) => kind === "late" ? (row.lateSeconds ?? 0) > 0 : kind === "absent" ? row.kind === "ABSENT"
    : kind === "missing-finish" ? row.kind === "MISSING_FINISH" : overtimeRows.has(row)
  const count = customTable ? customTable.rows.length : form === "MONTH" ? monthEmployees.length : form === "JOURNAL" ? journal.length : rows.length
  const lastPage = Math.max(0, Math.ceil(count / PAGE_SIZE) - 1)
  const currentPage = Math.min(page, lastPage)
  const pageStart = currentPage * PAGE_SIZE
  // Shared helper, not Intl: ICU without Azerbaijani data prints "2026 M10 14".
  const dateLabel = (date: string) => formatDate(`${date}T12:00:00.000Z`, locale, { dateStyle: "medium", timeZone: "UTC" })
  const timeLabel = (at: string | null, timezone: string, full = false) => !at ? "—" : full
    ? formatDateTime(at, locale, { timeZone: timezone, dateStyle: "short", timeStyle: "medium" })
    : formatTime(at, locale, { timeZone: timezone, hour: "2-digit", minute: "2-digit", second: "2-digit" })
  const baseRowNotes = (row: MtmAttendanceReportRow) => row.factsState === "INVALID"
    ? row.invalidReasons.map((reason) => t(REASON_MESSAGES[reason] ?? "reportReasonFacts")).join(" · ")
    : row.kind === "OPEN" ? t("reportProvisional") : row.kind === "MISSING_FINISH" ? t("reportUnknownTime")
      : row.kind === "ABSENT" ? t("reportAbsenceReasonPending") : row.flags.includes("WORKED_OUTSIDE_EMPLOYMENT") ? t("reportWorkOutsideEmployment") : row.flags.includes("WORKED_ON_APPROVED_ABSENCE") ? t("reportWorkOnLeave") : row.flags.includes("WORKED_ON_DAY_OFF") ? t("reportWorkOnDayOff") : row.calendarName ?? "—"

  // The same note as the exported table (attendance-table.ts): the screen and the file say one thing.
  const rowNotes = (row: MtmAttendanceReportRow) => [baseRowNotes(row), ...(row.lunchAutoSeconds ? [t("reportLunchAuto", { time: formatAttendanceDuration(row.lunchAutoSeconds) })] : []),
    ...(row.explanations ?? []).map(item => t(`reportExplanation${item.status}`, { answer: item.answer ?? "" })), ...attendanceApprovedLines(row, locale, t), ...attendanceCorrectionLines(row, locale, t)].filter((line) => line !== "—").join(" · ") || "—"

  function chooseForm(next: Form) {
    const wasCustom = customView !== null
    setCustomView(null)
    setForm(next)
    setPage(0)
    if (next === "MONTH" && form !== "MONTH" && today) void load(monthRange(today.slice(0, 7)))
    else if (wasCustom) void load(range)
  }
  function applyRange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!isDateKey(range.from) || !isDateKey(range.to) || range.to < range.from || range.to >= addDateKeyDays(range.from, 366)) {
      setRangeError(t("reportRangeInvalid"))
      return
    }
    if (customView) {
      const config = { ...customView.config, filters: { ...customView.config.filters, ...range } }
      setCustomView({ ...customView, config })
      void load(range, config)
    } else void load(range)
  }
  function applyPersonal(config: AttendanceViewConfig, name: string) {
    setCustomView({ name, config })
    // Report-only row types (summary, balance, absence kinds, team) have no
    // workspace form of their own; their table is built from the saved form.
    setForm(config.mode === "DAY" ? config.filters.form === "JOURNAL" ? "DAY" : config.filters.form === "ALL" ? "DAY" : config.filters.form
      : config.mode === "SUMMARY" || config.mode === "BALANCE" || config.mode === "ABSENCE_KINDS" || config.mode === "TEAM" ? "DAY" : config.mode)
    setTeamId(config.filters.teamId ?? "")
    setEmployeeId(config.filters.employeeId ?? "")
    void load({ from: config.filters.from, to: config.filters.to }, config)
  }
  function changeScope(team: string, employee: string) {
    setTeamId(team)
    setEmployeeId(employee)
    setPage(0)
    if (customView && report) {
      const config = { ...customView.config, filters: { ...customView.config.filters, teamId: team || undefined, employeeId: employee || undefined } }
      setCustomView({ ...customView, config })
      void load({ from: report.from, to: report.to }, config)
    }
  }
  function clearPrivateReport() {
    request.current?.abort()
    setReport(null)
    setLoading(false)
    setAccessUnavailable(true)
    setCanManageAccess(false)
    setCustomView((previous) => previous ? { ...previous, name: "" } : null)
    setError(t("reportAccessUnavailable"))
  }

  const catalogueLegend = attendanceCatalogueLegend(rows, locale)
  const multiDay = report ? report.from !== report.to : range.from !== range.to
  const timezones = [...new Set(rows.map((row) => row.timezone))]
  const cards = [
    { id: "arrived", label: "reportArrived", value: totals.arrivedCount, tone: "green" as const, icon: <LogIn className="h-4 w-4" />, hint: "reportArrivedHint" },
    { id: "late", label: "reportLateCount", value: totals.lateCount, tone: "amber" as const, icon: <Clock3 className="h-4 w-4" />, hint: "reportLateHint" },
    { id: "absent", label: "reportAbsentCount", value: totals.absentCount, tone: "zinc" as const, icon: <UserRoundX className="h-4 w-4" />, hint: "reportAbsenceReasonPending" },
    { id: "missing-finish", label: "reportMissingFinish", value: totals.missingFinishCount, tone: "red" as const, icon: <LogOut className="h-4 w-4" />, hint: "reportMissingFinishHint" },
  ]

  const results = (
      <div className="space-y-4 py-4">
        {loading ? <p role="status" className="text-sm text-muted-foreground">{t("reportLoading")}</p> : null}
        {error ? <div className="space-y-3"><p role="alert" className="text-sm text-destructive">{error}</p><Button type="button" variant="outline" className="min-h-11" onClick={() => void load(today ? range : undefined, customView?.config)}>{t("reportReload")}</Button></div> : null}
        {report ? <>
          <div className="flex flex-wrap justify-between gap-2 text-xs text-muted-foreground"><p>{t("reportPeriod", { from: dateLabel(report.from), to: dateLabel(report.to) })}</p>
            <p>{t("reportSnapshot", { time: timeLabel(report.asOf, timezones[0] ?? "Asia/Baku", true), timezone: timezones[0] ?? "Asia/Baku" })}</p></div>
          {scopeUnavailable ? <p role="alert" className="text-sm text-amber-800 dark:text-amber-300">{t("viewsScopeUnavailable")}</p> : null}
          {!count ? <p className="rounded-xl bg-muted/50 px-4 py-5 text-sm text-muted-foreground">{t("reportEmpty")}</p> : customTable ? <div className="min-w-0 overflow-x-auto" role="region" aria-label={customView?.name || t(FORM_MESSAGES[form])} tabIndex={0}>
            <table className={`w-full text-sm ${form === "OVERTIME" ? "hidden md:table" : ""}`} data-testid="attendance-custom-table"><thead><tr>{customTable.columns.map((column) => <th key={column.key} scope="col" className={`${HEADER} ${form === "OVERTIME" ? "" : "min-w-28"}`} data-column={column.key}>{column.label}</th>)}</tr></thead>
              <tbody>{customTable.rows.slice(pageStart, pageStart + PAGE_SIZE).map((row) => <tr key={row.key} data-testid="attendance-custom-row">{row.cells.map((cell, index) => <td key={customTable.columns[index].key} className={`${CELL} tabular-nums`}>{cell}</td>)}</tr>)}</tbody>
            </table>
            {form === "OVERTIME" && <div className="space-y-3 md:hidden" data-testid="attendance-overtime-cards">{customTable.rows.slice(pageStart, pageStart + PAGE_SIZE).map(row => <dl key={row.key} className="grid grid-cols-2 gap-3 rounded-xl border p-4">{row.cells.map((cell, index) => <div key={customTable.columns[index].key} className={index === 0 ? "col-span-2" : "min-w-0"}><dt className="text-xs text-muted-foreground">{customTable.columns[index].label}</dt><dd className="break-words text-sm tabular-nums">{cell}</dd></div>)}</dl>)}</div>}
          </div> : form === "MONTH" ? <>
            <div className="overflow-x-auto" role="region" aria-label={t("reportMonth")} tabIndex={0}><table className="w-full border-collapse text-sm" data-testid="attendance-month-grid">
              <thead><tr><th scope="col" className={`${HEADER} sticky left-0 z-10 min-w-40 bg-card`}>{t("reportEmployee")}</th>
                {monthDates.map((date) => <th key={date} scope="col" className={`${HEADER} min-w-14 text-center`}><time dateTime={date} title={dateLabel(date)}>{Number(date.slice(-2))}</time></th>)}
                <th scope="col" className={`${HEADER} min-w-24`}>{t("reportWorked")}</th><th scope="col" className={HEADER}>{t("reportLateCount")}</th><th scope="col" className={HEADER}>{t("reportAbsentCount")}</th></tr></thead>
              <tbody>{monthEmployees.slice(pageStart, pageStart + PAGE_SIZE).map((person) => <tr key={person.id} data-testid="attendance-month-person"><th scope="row" className={`${CELL} sticky left-0 z-10 bg-card text-left font-semibold`}>
                {person.name}<span className="mt-1 block text-xs font-normal text-muted-foreground">{person.team ?? t("reportNoTeam")}</span></th>
                {monthDates.map((date) => { const entries = person.dates.get(date); return <td key={date} className={`${CELL} text-center`}><div className="flex flex-col items-center gap-2">
                  {entries?.length ? entries.map(row => <span key={row.sourceDate ?? row.date} title={`${dateLabel(row.sourceDate ?? date)} · ${attendanceStatusText(row, locale, t)} · ${rowNotes(row)}`}>
                    <HomePill tone={rowTone(row)} className="min-w-10 justify-center rounded-md px-1.5 py-1 tabular-nums">{row.dayKind ? <span aria-hidden="true" data-testid="attendance-kind-color" className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: row.dayKind.color }} /> : null}{attendanceMonthCellGroup([row], locale, t)}</HomePill></span>) : "—"}</div></td> })}
                <td className={`${CELL} whitespace-nowrap tabular-nums`}>{formatAttendanceDuration(person.totals.workedSeconds)}{!person.totals.isComplete ? <span className="block text-xs text-amber-700 dark:text-amber-300">{t("reportPartial")}</span> : null}</td>
                <td className={`${CELL} tabular-nums`}>{person.totals.lateCount}</td><td className={`${CELL} tabular-nums`}>{person.totals.absentCount}</td></tr>)}</tbody>
            </table></div>
            <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted-foreground" aria-label={t("reportLegend")}>{catalogueLegend.length ? catalogueLegend.map(label => <span key={label}>{label}</span>) : [
              ["8:00", "reportWorkedDay", "green"], ["8:00", "reportLateOrEarly", "amber"], [t("reportCodeAbsent"), "reportAbsentDay", "red"],
              [t("reportCodeWeekend"), "reportWeekend", "zinc"], [t("reportCodeHoliday"), "reportHoliday", "blue"], ["·", "reportUpcoming", "zinc"],
              ["~", "reportProvisional", "blue"], ["?", "reportMissingFinish", "amber"], ["!", "reportInvalidFacts", "red"],
            ].map(([code, key, tone]) => <span key={key} className="inline-flex items-center gap-1.5"><HomePill tone={tone as HomeTone} className="rounded-md">{code}</HomePill>{t(key)}</span>)}</div>
          </> : form === "JOURNAL" ? <div className="overflow-x-auto" role="region" aria-label={t("reportJournal")} tabIndex={0}><table className="w-full min-w-[780px] text-sm" data-testid="attendance-journal-table">
            <thead><tr>{["reportEmployee", "reportDate", "reportStatus", "reportEvent", "reportPhoneTime", "reportServerTime"].map((key) => <th key={key} scope="col" className={HEADER}>{t(key)}</th>)}</tr></thead>
            <tbody>{journal.slice(pageStart, pageStart + PAGE_SIZE).map(({ row, entry }) => <tr key={`${row.employeeId}:${row.date}:${entry.id}`} data-testid="attendance-journal-event">
              <th scope="row" className={`${CELL} text-left font-semibold`}>{row.employeeName}<span className="mt-1 block text-xs font-normal text-muted-foreground">{row.teamName ?? t("reportNoTeam")}</span></th>
              <td className={`${CELL} whitespace-nowrap`}>{dateLabel(row.date)}<span className="block text-xs text-muted-foreground">{row.timezone}</span></td>
              <td className={CELL}><span className="inline-flex items-center gap-1.5">{row.dayKind ? <span aria-hidden="true" data-testid="attendance-kind-color" className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: row.dayKind.color }} /> : null}{attendanceStatusText(row, locale, t)}</span></td><td className={CELL}>{entry.description}</td><td className={`${CELL} whitespace-nowrap tabular-nums`}>{timeLabel(entry.phoneAt, row.timezone, true)}</td>
              <td className={`${CELL} whitespace-nowrap tabular-nums`}>{timeLabel(entry.serverAt, row.timezone, true)}</td></tr>)}</tbody>
          </table></div> : <div className="overflow-x-auto" role="region" aria-label={t(FORM_MESSAGES[form])} tabIndex={0}><table className="w-full min-w-[1180px] text-sm" data-testid="attendance-day-table">
            <thead><tr>{["reportEmployee", "reportDate", "reportStatus", "reportStarted", "reportFinished", "reportWorked", "reportPaused", "reportLate", "reportEarly", "reportNotes"].map((key) => <th key={key} scope="col" className={HEADER}>{t(key)}</th>)}</tr></thead>
            <tbody>{rows.slice(pageStart, pageStart + PAGE_SIZE).map((row) => <tr key={`${row.employeeId}:${row.date}`} data-testid="attendance-day-row">
              <th scope="row" className={`${CELL} min-w-40 text-left font-semibold`}>{row.employeeName}<span className="mt-1 block text-xs font-normal text-muted-foreground">{row.teamName ?? t("reportNoTeam")}</span></th>
              <td className={`${CELL} whitespace-nowrap`}>{dateLabel(row.date)}</td><td className={CELL}><HomePill tone={rowTone(row)}>{row.dayKind ? <span aria-hidden="true" data-testid="attendance-kind-color" className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: row.dayKind.color }} /> : null}{attendanceStatusText(row, locale, t)}</HomePill></td>
              <td className={`${CELL} whitespace-nowrap tabular-nums`} title={row.timezone}>{timeLabel(row.startedAt, row.timezone)}</td><td className={`${CELL} whitespace-nowrap tabular-nums`} title={row.timezone}>{timeLabel(row.completedAt, row.timezone)}</td>
              <td className={`${CELL} tabular-nums`}>{formatAttendanceDuration(row.workedSeconds)}{row.kind === "OPEN" ? <span className="block text-xs text-blue-700 dark:text-blue-300">{t("reportProvisionalShort")}</span> : null}</td>
              <td className={`${CELL} tabular-nums`}>{formatAttendanceDuration(row.pausedSeconds)}</td><td className={`${CELL} tabular-nums`}>{(row.lateSeconds ?? 0) > 0 ? <HomePill tone="amber">{formatAttendanceDuration(row.lateSeconds)}</HomePill> : formatAttendanceDuration(row.lateSeconds)}</td>
              <td className={`${CELL} tabular-nums`}>{(row.earlyLeaveSeconds ?? 0) > 0 ? <HomePill tone="amber">{formatAttendanceDuration(row.earlyLeaveSeconds)}</HomePill> : formatAttendanceDuration(row.earlyLeaveSeconds)}</td>
              <td className={`${CELL} min-w-48 text-xs leading-relaxed text-muted-foreground`}>{rowNotes(row)}</td></tr>)}</tbody>
          </table></div>}
          {!customTable && rows.some((row) => row.corrections?.length) ? <div className="space-y-2 text-xs leading-relaxed text-muted-foreground" data-testid="attendance-correction-history"><p>{t("reportCorrectionLegend")}</p>
            {form === "MONTH" ? rows.flatMap((row) => attendanceCorrectionLines(row, locale, t).map((line, index) => <p key={`${row.employeeId}:${row.sourceDate ?? row.date}:${index}`}>{row.employeeName} · {dateLabel(row.date)} · {line}</p>)) : null}</div> : null}
          <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground"><p>{t("reportShown", { from: count ? pageStart + 1 : 0, to: Math.min(pageStart + PAGE_SIZE, count), total: count })}</p>
            {count > PAGE_SIZE ? <div className="flex items-center gap-2"><Button type="button" variant="outline" className="min-h-11" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>{t("reportPrevious")}</Button>
              <span>{t("reportPage", { current: currentPage + 1, total: lastPage + 1 })}</span><Button type="button" variant="outline" className="min-h-11" disabled={currentPage === lastPage} onClick={() => setPage(currentPage + 1)}>{t("reportNext")}</Button></div> : null}</div>
          {customTable ? <><div className="space-y-2 text-xs text-muted-foreground">{customTable.details.slice(2).map((line, index) => <p key={index}>{line}</p>)}</div>
            {customTable.totals.length ? <div data-testid="attendance-report-totals" className="space-y-2 rounded-xl bg-muted/50 px-4 py-3 text-sm">{customTable.totals.map((line, index) => <p key={index} className={index === 0 ? "font-semibold" : "tabular-nums"}>{line}</p>)}</div> : null}</> : <>
          <div data-testid="attendance-report-totals" className="space-y-2 rounded-xl bg-muted/50 px-4 py-3 text-sm"><p className="font-semibold">{t("reportTotalsTitle")}</p>
            <p className="tabular-nums">{t("reportTotals", { worked: formatAttendanceDuration(totals.workedSeconds), paused: formatAttendanceDuration(totals.pausedSeconds), late: formatAttendanceDuration(totals.lateSeconds), early: formatAttendanceDuration(totals.earlyLeaveSeconds) })}</p>
            <p className="text-xs text-muted-foreground">{t("reportTotalsRows", { rows: totals.rowCount, employees: totals.employeeCount })}</p>
            {totals.annualLeaveDays > 0 && <p className="text-xs text-muted-foreground">{t("reportAnnualLeaveDays", { days: totals.annualLeaveDays })}</p>}
            {!totals.isComplete ? <p className="text-xs font-medium text-amber-800 dark:text-amber-300">{t("reportIncompleteTotals", { worked: totals.unknownWorkedCount, paused: totals.unknownPausedCount })}</p> : null}
            {rows.some((row) => row.kind === "OPEN") ? <p className="text-xs text-blue-700 dark:text-blue-300">{t("reportProvisional")}</p> : null}
          </div>
          <p className="text-xs text-muted-foreground">{t("reportTimezones", { zones: timezones.length ? format.list(timezones) : "—" })} {t("reportDurationFormat")}</p>
          </>}
        </> : null}
      </div>
  )

  if (layout === "timesheet") return timesheetView()

  // The letter alone: a corrected day's «*» is drawn beside it in its own colour (see the cell).
  function cellCode(row: MtmAttendanceReportRow) {
    if (row.dayKind) return row.dayKind.code
    return attendanceMonthCell({ ...row, corrections: undefined }, t)
  }
  function shiftMonth(step: number) {
    const [year, month] = range.from.slice(0, 7).split("-").map(Number)
    const next = new Date(Date.UTC(year, month - 1 + step, 1, 12)).toISOString().slice(0, 7)
    void load(monthRange(next))
  }
  function changeDate(next: Range) {
    setRange(next); setRangeError(null)
    if (!isDateKey(next.from) || !isDateKey(next.to)) return
    if (next.to >= next.from && next.to < addDateKeyDays(next.from, 366)) void load(next)
    else setRangeError(t("reportRangeInvalid"))
  }

  function timesheetView() {
    const counts = Object.fromEntries(TIMESHEET_ISSUES.map(kind => [kind, monthEmployees.filter(person => person.rows.some(row => hasIssue(row, kind))).length])) as Record<TimesheetIssue, number>
    const people = issue ? monthEmployees.filter(person => person.rows.some(row => hasIssue(row, issue))) : monthEmployees
    const monthLabel = range.from ? formatDate(`${range.from.slice(0, 7)}-15T12:00:00.000Z`, locale, { month: "long", year: "numeric", timeZone: "UTC" }) : ""
    const pinned = employeeId ? directory.employees.find(employee => employee.id === employeeId) : null
    const dateKinds = new Map(monthDates.map(date => [date, monthEmployees[0]?.dates.get(date)?.[0]?.isWorkingDay ?? true]))
    const legend = [...new Map(rows.flatMap(row => row.dayKind ? [[row.dayKind.key, row.dayKind] as const] : [])).values()]
    // Two signs, two meanings, each explained in the legend when it is on screen: «*» on a day
    // corrected through a request (as the «Kadr uçotu» clip says), «≥» on an hours total that
    // leaves out days whose hours are unknown — before 2026-10-20 that total wore a «*» too.
    const anyCorrected = rows.some(row => row.corrections?.length)
    const anyPartial = monthEmployees.some(person => person.totals.unknownWorkedCount > 0)
    const chip = (active: boolean) => `inline-flex min-h-10 items-center gap-1.5 rounded-full border px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${active ? "border-foreground bg-card font-semibold text-foreground" : "border-border bg-card text-muted-foreground hover:bg-muted"}`
    const chooseIssue = (next: TimesheetIssue | null) => { setIssue(next); setPage(0) }
    // A saved form replaces the month grid until it is closed.
    const closeCustomView = () => { setCustomView(null); setForm("MONTH"); setPage(0); void load(monthRange((range.from || today || "").slice(0, 7))) }
    const shortTime = (at: string | null, timezone: string) => at ? formatTime(at, locale, { timeZone: timezone, hour: "2-digit", minute: "2-digit" }) : "—"
    return <section aria-label={t("reportTitle")} className="space-y-5" data-testid="attendance-timesheet">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight">{p("timesheetTitle")}</h1>
          <div className="inline-flex items-center gap-1 rounded-xl border bg-card p-1" data-testid="attendance-month-switcher">
            <Button type="button" variant="ghost" size="icon" className="h-9 w-9" aria-label={p("previousMonth")} disabled={!range.from || loading} onClick={() => shiftMonth(-1)}><ChevronLeft className="h-4 w-4" aria-hidden="true" /></Button>
            <span className="min-w-36 px-2 text-center text-sm font-semibold capitalize">{monthLabel}</span>
            <Button type="button" variant="ghost" size="icon" className="h-9 w-9" aria-label={p("nextMonth")} disabled={!range.from || loading} onClick={() => shiftMonth(1)}><ChevronRight className="h-4 w-4" aria-hidden="true" /></Button>
          </div>
        </div>
        <div className="flex flex-wrap items-start gap-2">
          <MtmAttendanceExportButtons config={currentConfig} snapshot={report?.snapshot ?? null}
            onRefresh={() => void load(report ? { from: report.from, to: report.to } : range, customView?.config)} onAccessLost={clearPrivateReport} />
          {/* The month closes on its N-1t in one press (owner, 2026-10-20, the «Kadr uçotu» clip): the shown month once it is over, otherwise the one that just ended; history stays under «Daha çox». */}
          <Hint text={t("monthCloseOpenN1tHint")}><Button asChild variant="outline" className="min-h-11 rounded-full"><Link href={range.from && today ? `/mtm/attendance/reports?report=n1t&date=${monthToCloseDate(range.from, today)}` : "/mtm/attendance/reports?report=n1t"} prefetch={false} data-testid="attendance-timesheet-close-month"><Lock className="mr-2 h-4 w-4" aria-hidden="true" />{p("closeMonth")}</Link></Button></Hint>
          <DropdownMenu><DropdownMenuTrigger asChild><Button type="button" variant="outline" className="min-h-11 rounded-full" data-testid="attendance-timesheet-more">{p("more")}<ChevronDown className="ml-2 h-4 w-4" aria-hidden="true" /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60">
              {(["branches", "decisions", "months"] as const).map(view => <DropdownMenuItem key={view} asChild><Link href={`/mtm/attendance/timesheet?view=${view}`} prefetch={false}>{p(`tabs.${view}`)}</Link></DropdownMenuItem>)}
              <DropdownMenuItem onSelect={() => setShowExtras(true)}>{p("customFormAndDelivery")}</DropdownMenuItem>
            </DropdownMenuContent></DropdownMenu>
        </div>
      </header>
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label={p("filterLabel")} data-testid="attendance-timesheet-filters">
        {customView ? <span className="inline-flex min-h-10 items-center gap-2 rounded-full border border-foreground px-4 text-sm font-semibold text-foreground" data-testid="attendance-timesheet-custom-chip">{t("viewsActive", { name: customView.name })}
          <button type="button" className="rounded-full p-0.5 hover:bg-muted" aria-label={p("backToMonth")} onClick={closeCustomView}><X className="h-3.5 w-3.5" aria-hidden="true" /></button></span> : <>
        <button type="button" className={chip(issue === null)} aria-pressed={issue === null} onClick={() => chooseIssue(null)}>{p("filterAll")} <span className="tabular-nums">· {monthEmployees.length}</span></button>
        {TIMESHEET_ISSUES.map(kind => <button key={kind} type="button" data-testid={`attendance-filter-${kind}`} className={chip(issue === kind)} aria-pressed={issue === kind} disabled={!report}
          onClick={() => chooseIssue(issue === kind ? null : kind)}>{p(ISSUE_LABELS[kind])} <span className="tabular-nums">· {counts[kind]}</span></button>)}</>}
        <span className="flex-1" />
        <label className="relative"><span className="sr-only">{p("searchEmployee")}</span><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input type="search" className="min-h-10 w-56 pl-9" placeholder={p("searchEmployee")} value={search} onChange={event => { setSearch(event.target.value); setPage(0) }} /></label>
        <select aria-label={t("reportTeam")} className="min-h-10 min-w-44 rounded-lg border border-input bg-card px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50" value={teamId} disabled={!report} onChange={event => changeScope(event.target.value, "")}>
          <option value="">{t("reportAllTeams")}</option>{directory.teams.map(team => <option key={team.id} value={team.id}>{team.name}</option>)}</select>
        {employeeId ? <span className="inline-flex min-h-10 items-center gap-2 rounded-full border border-foreground px-3 text-sm font-semibold text-foreground">{p("onlyEmployee", { name: pinned?.name ?? t("viewsUnavailableEmployee") })}
          <button type="button" className="rounded-full p-0.5 hover:bg-muted" aria-label={p("showEveryone")} onClick={() => changeScope(teamId, "")}><X className="h-3.5 w-3.5" aria-hidden="true" /></button></span> : null}
      </div>
      {customView ? <div className="rounded-2xl border bg-card px-5" data-testid="attendance-timesheet-custom">{results}</div> : <div className="space-y-4 rounded-2xl border bg-card p-3" data-testid="attendance-timesheet-month">
        {loading ? <p role="status" className="p-2 text-sm text-muted-foreground">{t("reportLoading")}</p> : null}
        {error ? <div className="space-y-3 p-2"><p role="alert" className="text-sm text-destructive">{error}</p><Button type="button" variant="outline" className="min-h-11" onClick={() => void load(today ? range : undefined)}>{t("reportReload")}</Button></div> : null}
        {report && !people.length ? <p className="rounded-xl bg-muted/50 px-4 py-5 text-sm text-muted-foreground">{issue ? p("filterEmpty") : t("reportEmpty")}</p> : null}
        {report && people.length ? <div className="overflow-x-auto" role="region" aria-label={t("reportMonth")} tabIndex={0}><table className="w-full border-collapse text-xs" data-testid="attendance-month-grid">
          <thead><tr><th scope="col" className="sticky left-0 z-10 w-40 min-w-40 bg-card px-2 py-2 text-left text-xs font-medium text-muted-foreground">{t("reportEmployee")}</th>
            {monthDates.map(date => <th key={date} scope="col" className={`px-px py-1.5 text-center font-semibold ${date === today ? "font-bold text-primary" : dateKinds.get(date) === false ? "text-muted-foreground/60" : ""}`}>
              <time dateTime={date} title={dateLabel(date)} className="block text-xs">{Number(date.slice(-2))}</time>
              <span className="block text-xs font-medium opacity-70">{formatDate(`${date}T12:00:00.000Z`, locale, { weekday: "short", timeZone: "UTC" })}</span></th>)}
            {(["colDays", "colHours", "colLeave", "colSick", "colMissed"] as const).map(key => <th key={key} scope="col" className="w-11 px-1 py-2 text-center text-xs font-semibold text-muted-foreground"><HintValue text={p(`${key}Hint`)}>{p(key)}</HintValue></th>)}</tr></thead>
          <tbody>{people.slice(pageStart, pageStart + PAGE_SIZE).map(person => {
            const worked = person.rows.filter(row => row.startedAt !== null).length
            const sick = person.rows.filter(row => row.dayKind?.key === "SICK_LEAVE" || row.dayKind?.key === "UNPAID_SICK").length
            const missed = person.totals.absentCount + person.totals.missingFinishCount
            return <tr key={person.id} data-testid="attendance-month-person" className="border-t border-border">
              <th scope="row" className="sticky left-0 z-10 bg-card px-2 py-1.5 text-left"><span className="block truncate text-[13px] font-semibold">{person.name}</span><span className="block text-xs font-normal text-muted-foreground">{person.team ?? t("reportNoTeam")}</span></th>
              {monthDates.map(date => {
                const entries = person.dates.get(date) ?? []
                const row = entries[0]
                const cellKey = `${person.id}:${date}`
                const dimmed = issue !== null && !entries.some(entry => hasIssue(entry, issue))
                const corrected = entries.some(entry => entry.corrections?.length)
                return <td key={date} className="px-px py-1 text-center">
                  {row ? <Popover open={openCell === cellKey} onOpenChange={open => setOpenCell(open ? cellKey : null)}><PopoverTrigger asChild><button type="button" data-testid="attendance-month-cell" data-dimmed={dimmed || undefined} aria-label={`${person.name} · ${dateLabel(date)} · ${attendanceStatusText(row, locale, t)}${corrected ? ` · ${p("legendCorrected")}` : ""}`}
                    className={`flex h-7 w-full min-w-[22px] items-center justify-center rounded-md text-xs font-bold outline-none ring-offset-1 focus-visible:ring-2 focus-visible:ring-primary data-[state=open]:ring-2 data-[state=open]:ring-primary ${dimmed ? "opacity-25" : ""} ${row.kind === "NOT_EMPLOYED" && !row.dayKind ? "opacity-40" : ""}`}
                    style={row.dayKind && row.kind !== "UPCOMING" ? { color: row.dayKind.color } : { color: "var(--muted-foreground, #8a94a3)" }}>{cellCode(row)}{corrected ? <span aria-hidden="true" data-testid="attendance-corrected-mark" className="ml-px text-[13px] leading-none text-primary">*</span> : null}{entries.length > 1 ? "+" : ""}</button></PopoverTrigger>
                    <PopoverContent align="center" className="w-80 space-y-3 p-4" data-testid="attendance-day-popover">
                      {entries.map(entry => {
                        const marks = attendanceJournalEntries(entry, locale, t)
                        return <div key={entry.sourceDate ?? entry.date} className="space-y-3">
                          <div><p className="text-sm font-bold">{person.name} · {dateLabel(entry.sourceDate ?? date)}</p><p className="text-xs text-muted-foreground">{attendanceStatusText(entry, locale, t)}</p></div>
                          <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-sm">
                            <dt className="text-muted-foreground">{p("dayStarted")}</dt><dd className="font-semibold tabular-nums">{shortTime(entry.startedAt, entry.timezone)}{(entry.lateSeconds ?? 0) > 0 ? <span className="ml-1 text-amber-700 dark:text-amber-300">(+{formatAttendanceDuration(entry.lateSeconds)})</span> : null}</dd>
                            <dt className="text-muted-foreground">{p("dayFinished")}</dt><dd className="font-semibold tabular-nums">{shortTime(entry.completedAt, entry.timezone)}</dd>
                            <dt className="text-muted-foreground">{p("dayWorked")}</dt><dd className="font-semibold tabular-nums">{formatAttendanceDuration(entry.workedSeconds)}</dd>
                            <dt className="text-muted-foreground">{p("dayPause")}</dt><dd className="font-semibold tabular-nums">{formatAttendanceDuration(entry.pausedSeconds)}</dd>
                          </dl>
                          {rowNotes(entry) !== "—" ? <p className="text-xs leading-relaxed text-muted-foreground">{rowNotes(entry)}</p> : null}
                          {marks.length ? <div className="space-y-1" data-testid="attendance-day-marks"><p className="text-xs font-semibold text-muted-foreground">{p("dayMarks")}</p>
                            <ul className="space-y-1 text-xs">{marks.map(mark => <li key={mark.id} className="flex gap-2"><span className="w-11 shrink-0 font-semibold tabular-nums">{shortTime(mark.phoneAt ?? mark.serverAt, entry.timezone)}</span><span className={mark.correction ? "text-primary" : ""}>{mark.description}</span></li>)}</ul></div> : null}
                        </div>
                      })}
                      <Button asChild size="sm" className="min-h-9 w-full"><Link prefetch={false} href={`/mtm/attendance/recordings?date=${date}&employeeId=${encodeURIComponent(person.id)}`}>{entries.some(entry => entry.kind === "ABSENT") ? p("addReason") : p("fixDay")}</Link></Button>
                    </PopoverContent></Popover> : <span className="text-muted-foreground">—</span>}
                </td>
              })}
              <td className="px-1 text-center text-[13px] font-bold tabular-nums">{worked}</td>
              <td className="whitespace-nowrap px-1 text-center text-[13px] font-bold tabular-nums">{person.totals.unknownWorkedCount > 0
                ? <HintValue text={p("partialTotalHint", { count: person.totals.unknownWorkedCount })}><span data-testid="attendance-partial-total">≥{formatAttendanceDuration(person.totals.workedSeconds)}</span></HintValue>
                : formatAttendanceDuration(person.totals.workedSeconds)}</td>
              <td className="px-1 text-center text-[13px] font-bold tabular-nums">{person.totals.annualLeaveDays || "—"}</td>
              <td className="px-1 text-center text-[13px] font-bold tabular-nums">{sick || "—"}</td>
              <td className={`px-1 text-center text-[13px] font-bold tabular-nums ${missed ? "text-rose-700 dark:text-rose-300" : ""}`}>{missed || "—"}</td>
            </tr>
          })}</tbody>
        </table></div> : null}
        {report && people.length > PAGE_SIZE ? <div className="flex items-center justify-end gap-2 text-xs text-muted-foreground"><Button type="button" variant="outline" className="min-h-10" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>{t("reportPrevious")}</Button>
          <span>{t("reportPage", { current: currentPage + 1, total: Math.ceil(people.length / PAGE_SIZE) })}</span><Button type="button" variant="outline" className="min-h-10" disabled={pageStart + PAGE_SIZE >= people.length} onClick={() => setPage(currentPage + 1)}>{t("reportNext")}</Button></div> : null}
      </div>}
      {!customView && (legend.length || anyCorrected || anyPartial) ? <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground" aria-label={t("reportLegend")} data-testid="attendance-timesheet-legend">
        {legend.map(kind => <span key={kind.key} className="inline-flex items-center gap-1.5"><span className="inline-flex h-5 min-w-6 items-center justify-center rounded px-1 text-xs font-bold" style={{ color: kind.color, backgroundColor: `${kind.color}1a` }}>{kind.code}</span>{attendanceDayKindLabel(kind, locale)}</span>)}
        {anyCorrected ? <span className="inline-flex items-center gap-1.5" data-testid="attendance-legend-corrected"><span className="inline-flex h-5 min-w-6 items-center justify-center text-[13px] font-bold text-primary">*</span>{p("legendCorrected")}</span> : null}
        {anyPartial ? <span className="inline-flex items-center gap-1.5" data-testid="attendance-legend-partial"><span className="inline-flex h-5 min-w-6 items-center justify-center text-[13px] font-bold text-foreground">≥</span>{p("legendPartialTotal")}</span> : null}
        <span className="ml-auto">{p("cellHint")}</span>
      </div> : null}
      {showExtras ? <section className="space-y-5 rounded-2xl border bg-card p-5" data-testid="attendance-timesheet-extras" aria-label={p("customFormAndDelivery")}>
        <div className="flex items-center justify-between gap-3"><h2 className="text-base font-semibold">{p("customFormAndDelivery")}</h2>
          <Button type="button" variant="ghost" size="icon" className="h-9 w-9" aria-label={p("close")} onClick={() => setShowExtras(false)}><X className="h-4 w-4" aria-hidden="true" /></Button></div>
        <MtmAttendancePersonalViews currentConfig={currentConfig} onApply={applyPersonal} onAccessLost={clearPrivateReport} accessUnavailable={accessUnavailable} />
        <MtmAttendanceDeliveries currentConfig={currentConfig} onAccessLost={clearPrivateReport} accessUnavailable={accessUnavailable} />
      </section> : null}
    </section>
  }

  return <section aria-label={t("reportTitle")} className="space-y-5" data-testid="attendance-report-workspace">
    {!accessUnavailable && <MtmAttendanceHelp />}
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{cards.map((card) => <HomeKpi key={card.id} testId={`attendance-${card.id}`} label={t(card.label)}
      icon={card.icon} tone={card.tone} value={report ? format.number(card.value) : null} unit={t(multiDay ? "reportDayRecords" : "reportPeople", { count: card.value })} sub={t(card.hint)}
      progress={report && totals.rowCount ? card.value / totals.rowCount * 100 : 0} />)}</div>
    <HomeCard testId="attendance-report-filters" titleId="attendance-report-filters-title" icon={<ListChecks className="h-4 w-4" aria-hidden="true" />} tone="orange" title={t("reportForm")}>
      <div className="space-y-5 py-4">
        <MtmAttendanceExportButtons config={currentConfig} snapshot={report?.snapshot ?? null}
          onRefresh={() => void load(report ? { from: report.from, to: report.to } : range, customView?.config)} onAccessLost={clearPrivateReport} />
        <div className="flex flex-wrap gap-2" role="group" aria-label={t("reportForm")}>{FORMS.map((value) => <Button key={value} type="button" className={`min-h-11 rounded-full ${mtmChipClass(!customView && form === value)}`}
          variant="outline" aria-pressed={!customView && form === value} disabled={value === "MONTH" && !today} onClick={() => chooseForm(value)}>{t(FORM_MESSAGES[value])}</Button>)}</div>
        {customView?.name && !accessUnavailable ? <p className="text-sm font-medium text-primary">{t("viewsActive", { name: customView.name })}</p> : null}
        <form onSubmit={applyRange} className="grid items-end gap-4 sm:grid-cols-2 xl:grid-cols-[1fr_1fr_1.2fr_1.3fr_auto]" aria-label={t("reportFilters")}>
          {form === "MONTH" ? <div className="space-y-2 sm:col-span-2 xl:col-span-2"><label htmlFor="attendance-report-month" className="text-sm font-medium">{t("reportMonthSelect")}</label>
            <Input id="attendance-report-month" type="month" required value={range.from.slice(0, 7)} className="min-h-11" onChange={(event) => { if (/^\d{4}-\d{2}$/.test(event.target.value)) { setRange(monthRange(event.target.value)); setRangeError(null) } }} />
            {range.from && range.to ? <p className="text-xs text-muted-foreground">{t("reportPeriod", { from: dateLabel(range.from), to: dateLabel(range.to) })}</p> : null}</div> : <>
            <div className="space-y-2"><label htmlFor="attendance-report-from" className="text-sm font-medium">{t("reportFrom")}</label><Input id="attendance-report-from" type="date" required className="min-h-11" value={range.from} onChange={(event) => { setRange({ ...range, from: event.target.value }); setRangeError(null) }} /></div>
            <div className="space-y-2"><label htmlFor="attendance-report-to" className="text-sm font-medium">{t("reportTo")}</label><Input id="attendance-report-to" type="date" required className="min-h-11" value={range.to} onChange={(event) => { setRange({ ...range, to: event.target.value }); setRangeError(null) }} /></div></>}
          <div className="space-y-2"><label htmlFor="attendance-report-team" className="text-sm font-medium">{t("reportTeam")}</label><select id="attendance-report-team" className={SELECT_CLASS} value={teamId} disabled={!report}
            onChange={(event) => changeScope(event.target.value, "")}><option value="">{t("reportAllTeams")}</option>{teamId && !directory.teams.some((team) => team.id === teamId) ? <option value={teamId}>{t("viewsUnavailableTeam")}</option> : null}{directory.teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select></div>
          <div className="space-y-2"><label htmlFor="attendance-report-employee" className="text-sm font-medium">{t("reportEmployee")}</label><select id="attendance-report-employee" className={SELECT_CLASS} value={employeeId} disabled={!report}
            onChange={(event) => changeScope(teamId, event.target.value)}><option value="">{t("reportAllEmployees")}</option>{employeeId && !directory.employees.some((employee) => employee.id === employeeId) ? <option value={employeeId}>{t("viewsUnavailableEmployee")}</option> : null}{directory.employees.filter((employee) => !teamId || employee.teamId === teamId).map((employee) => <option key={employee.id} value={employee.id}>{employee.name}</option>)}</select></div>
          <Button type="submit" variant="outline" className="min-h-11" disabled={!today}>{t("reportApply")}</Button>
        </form>
        {rangeError ? <p role="alert" className="text-sm text-destructive">{rangeError}</p> : null}
      </div>
    </HomeCard>
    <HomeCard testId="attendance-report-results" titleId="attendance-report-results-title" icon={<CalendarDays className="h-4 w-4" aria-hidden="true" />} tone="orange" title={customView?.name || t(FORM_MESSAGES[form])}>
      {results}
    </HomeCard>
    <MtmAttendanceDeliveries currentConfig={currentConfig} onAccessLost={clearPrivateReport} accessUnavailable={accessUnavailable} />
    <MtmAttendancePersonalViews currentConfig={currentConfig} onApply={applyPersonal} onAccessLost={clearPrivateReport} accessUnavailable={accessUnavailable} />
    <MtmAttendanceDayKinds canManage={canManageAccess} onAccessLost={clearPrivateReport} onSaved={() => void load(report ? { from: report.from, to: report.to } : range, customView?.config)} accessUnavailable={accessUnavailable} />
    <MtmAttendanceHrAccess canManage={canManageAccess} onAccessLost={clearPrivateReport} accessUnavailable={accessUnavailable} />
    <MtmAttendanceRequestLimits canManage={canManageAccess} onAccessLost={clearPrivateReport} accessUnavailable={accessUnavailable} />
  </section>
}
