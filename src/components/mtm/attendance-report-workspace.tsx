"use client"

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react"
import { useFormatter, useLocale, useTranslations } from "next-intl"
import { CalendarDays, Clock3, ListChecks, LogIn, LogOut, UserRoundX } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { HomeCard, HomeKpi, HomePill, type HomeTone } from "@/components/mtm/home-parts"
import { addDateKeyDays, isDateKey } from "@/lib/mtm/mobile-week"
import { filterMtmAttendanceRows, summarizeMtmAttendanceRows, type MtmAttendanceReport, type MtmAttendanceReportRow } from "@/lib/mtm/attendance-report"
import { formatAttendanceDuration, attendanceStatusText, attendanceMonthCellGroup, attendanceCatalogueLegend, attendanceCorrectionLines, attendanceApprovedLines, attendanceJournalEntries } from "@/lib/mtm/attendance-presentation"
import { DEFAULT_ATTENDANCE_VIEW_COLUMNS, type AttendanceViewConfig } from "@/lib/mtm/attendance-view-contract"
import { buildAttendanceTable } from "@/lib/mtm/attendance-table"
import { attendanceOvertimeRows } from "@/lib/mtm/attendance-overtime"
import { MtmAttendanceHelp } from "@/components/mtm/attendance-help"
import { MtmAttendancePersonalViews } from "@/components/mtm/attendance-personal-views"
import { MtmAttendanceExportButtons } from "@/components/mtm/attendance-export-buttons"
import { MtmAttendanceDeliveries } from "@/components/mtm/attendance-deliveries"
import { MtmAttendanceHrAccess } from "@/components/mtm/attendance-hr-access"
import { MtmAttendanceDayKinds } from "@/components/mtm/attendance-day-kinds"
import { MtmAttendanceRequestLimits } from "@/components/mtm/attendance-request-limits"
import type { AttendanceReportSnapshot } from "@/lib/mtm/attendance-query"

type Form = "DAY" | "MONTH" | "LATE_EARLY" | "ABSENCES" | "JOURNAL" | "BRANCH" | "OVERTIME"
type Range = { from: string; to: string }
type ReportData = MtmAttendanceReport & { snapshot?: AttendanceReportSnapshot }
const FORMS: Form[] = ["DAY", "MONTH", "LATE_EARLY", "ABSENCES", "OVERTIME", "JOURNAL"]
const FORM_MESSAGES: Record<Form, string> = { DAY: "reportDay", MONTH: "reportMonth", LATE_EARLY: "reportLateEarly", ABSENCES: "reportAbsences", JOURNAL: "reportJournal", BRANCH: "branchReportTitle", OVERTIME: "overtimeTitle" }
const REASON_MESSAGES: Record<string, string> = { DUPLICATE_WORKDAY: "reportReasonDuplicate", SCHEDULE_INVALID: "reportReasonSchedule", TIMESTAMP_INVALID: "reportReasonTimestamp",
  EVENT_TYPE_INVALID: "reportReasonEvent", JOURNAL_INCOMPLETE: "reportReasonJournal", PAUSE_TOTAL_MISMATCH: "reportReasonPause", WORKDAY_INCONSISTENT: "reportReasonFacts" }
const SELECT_CLASS = "min-h-11 w-full rounded-lg border border-zinc-200 bg-card px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 dark:border-zinc-700"
const CELL = "border-b border-zinc-100 px-3 py-3 align-top dark:border-zinc-800"
const HEADER = "px-3 py-3 text-left text-xs font-medium text-muted-foreground"
const PAGE_SIZE = 50

function monthRange(month: string): Range {
  const [year, number] = month.split("-").map(Number)
  return { from: `${month}-01`, to: new Date(Date.UTC(year, number, 0, 12)).toISOString().slice(0, 10) }
}
function rowTone(row: MtmAttendanceReportRow): HomeTone {
  if (row.kind === "INVALID_FACTS" || row.kind === "ABSENT") return "red"
  if (row.kind === "MISSING_FINISH" || (row.lateSeconds ?? 0) > 0 || (row.earlyLeaveSeconds ?? 0) > 0) return "amber"
  if (row.kind === "OPEN" || row.kind === "HOLIDAY") return "blue"
  return row.kind === "WORKED" ? "green" : "zinc"
}

/** All forms, filters, cards and totals select from one server-scoped day-row snapshot. */
export function MtmAttendanceReportWorkspace() {
  const t = useTranslations("mtmAttendance")
  const format = useFormatter()
  const locale = useLocale() as "az" | "ru" | "en"
  const [today, setToday] = useState<string | null>(null)
  const [range, setRange] = useState<Range>({ from: "", to: "" })
  const [report, setReport] = useState<ReportData | null>(null)
  const [form, setForm] = useState<Form>("DAY")
  const [teamId, setTeamId] = useState("")
  const [employeeId, setEmployeeId] = useState("")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [rangeError, setRangeError] = useState<string | null>(null)
  const [page, setPage] = useState(0)
  const [customView, setCustomView] = useState<{ name: string; config: AttendanceViewConfig } | null>(null)
  const [accessUnavailable, setAccessUnavailable] = useState(false)
  const [canManageAccess, setCanManageAccess] = useState(false)
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
      const selected = requestedRange ?? { from: settingsBody.data.today, to: settingsBody.data.today }
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
  }, [t])

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
    return form === "OVERTIME" ? attendanceOvertimeRows(filtered).map(item => item.row) : filtered
  }, [report, teamId, employeeId, form, customView])
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
  const count = customTable ? customTable.rows.length : form === "MONTH" ? monthEmployees.length : form === "JOURNAL" ? journal.length : rows.length
  const lastPage = Math.max(0, Math.ceil(count / PAGE_SIZE) - 1)
  const currentPage = Math.min(page, lastPage)
  const pageStart = currentPage * PAGE_SIZE
  const dateLabel = (date: string) => format.dateTime(new Date(`${date}T12:00:00.000Z`), { dateStyle: "medium", timeZone: "UTC" })
  const timeLabel = (at: string | null, timezone: string, full = false) => at ? format.dateTime(new Date(at), { timeZone: timezone,
    ...(full ? { dateStyle: "short" as const, timeStyle: "medium" as const } : { hour: "2-digit" as const, minute: "2-digit" as const, second: "2-digit" as const }) }) : "—"
  const baseRowNotes = (row: MtmAttendanceReportRow) => row.factsState === "INVALID"
    ? row.invalidReasons.map((reason) => t(REASON_MESSAGES[reason] ?? "reportReasonFacts")).join(" · ")
    : row.kind === "OPEN" ? t("reportProvisional") : row.kind === "MISSING_FINISH" ? t("reportUnknownTime")
      : row.kind === "ABSENT" ? t("reportAbsenceReasonPending") : row.flags.includes("WORKED_OUTSIDE_EMPLOYMENT") ? t("reportWorkOutsideEmployment") : row.flags.includes("WORKED_ON_APPROVED_ABSENCE") ? t("reportWorkOnLeave") : row.flags.includes("WORKED_ON_DAY_OFF") ? t("reportWorkOnDayOff") : row.calendarName ?? "—"

  const rowNotes = (row: MtmAttendanceReportRow) => [baseRowNotes(row), ...attendanceApprovedLines(row, locale, t), ...attendanceCorrectionLines(row, locale, t)].filter((line) => line !== "—").join(" · ") || "—"

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
    setForm(config.mode === "DAY" ? config.filters.form === "JOURNAL" ? "DAY" : config.filters.form === "ALL" ? "DAY" : config.filters.form : config.mode)
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

  return <section aria-label={t("reportTitle")} className="space-y-5" data-testid="attendance-report-workspace">
    {!accessUnavailable && <MtmAttendanceHelp />}
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{cards.map((card) => <HomeKpi key={card.id} testId={`attendance-${card.id}`} label={t(card.label)}
      icon={card.icon} tone={card.tone} value={report ? format.number(card.value) : null} unit={t(multiDay ? "reportDayRecords" : "reportPeople", { count: card.value })} sub={t(card.hint)}
      progress={report && totals.rowCount ? card.value / totals.rowCount * 100 : 0} />)}</div>
    <HomeCard testId="attendance-report-filters" titleId="attendance-report-filters-title" icon={<ListChecks className="h-4 w-4" aria-hidden="true" />} tone="orange" title={t("reportForm")}>
      <div className="space-y-5 py-4">
        <MtmAttendanceExportButtons config={currentConfig} snapshot={report?.snapshot ?? null}
          onRefresh={() => void load(report ? { from: report.from, to: report.to } : range, customView?.config)} onAccessLost={clearPrivateReport} />
        <div className="flex flex-wrap gap-2" role="group" aria-label={t("reportForm")}>{FORMS.map((value) => <Button key={value} type="button" className="min-h-11 rounded-full"
          variant={!customView && form === value ? "default" : "outline"} aria-pressed={!customView && form === value} disabled={value === "MONTH" && !today} onClick={() => chooseForm(value)}>{t(FORM_MESSAGES[value])}</Button>)}</div>
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
    </HomeCard>
    <MtmAttendanceDeliveries currentConfig={currentConfig} onAccessLost={clearPrivateReport} accessUnavailable={accessUnavailable} />
    <MtmAttendancePersonalViews currentConfig={currentConfig} onApply={applyPersonal} onAccessLost={clearPrivateReport} accessUnavailable={accessUnavailable} />
    <MtmAttendanceDayKinds canManage={canManageAccess} onAccessLost={clearPrivateReport} onSaved={() => void load(report ? { from: report.from, to: report.to } : range, customView?.config)} accessUnavailable={accessUnavailable} />
    <MtmAttendanceHrAccess canManage={canManageAccess} onAccessLost={clearPrivateReport} accessUnavailable={accessUnavailable} />
    <MtmAttendanceRequestLimits canManage={canManageAccess} onAccessLost={clearPrivateReport} accessUnavailable={accessUnavailable} />
  </section>
}
