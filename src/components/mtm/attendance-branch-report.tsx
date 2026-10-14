"use client"

import Link from "next/link"
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react"
import { useFormatter, useLocale, useTranslations } from "next-intl"
import { Building2, ListFilter } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { HomeCard } from "@/components/mtm/home-parts"
import { MtmAttendanceExportButtons } from "@/components/mtm/attendance-export-buttons"
import { addDateKeyDays, isDateKey } from "@/lib/mtm/mobile-week"
import { filterMtmAttendanceRows, type MtmAttendanceReport } from "@/lib/mtm/attendance-report"
import { summarizeAttendanceBranches } from "@/lib/mtm/attendance-location-report"
import { DEFAULT_ATTENDANCE_VIEW_COLUMNS, type AttendanceViewConfig } from "@/lib/mtm/attendance-view-contract"
import { buildAttendanceTable } from "@/lib/mtm/attendance-table"
import type { AttendanceReportSnapshot } from "@/lib/mtm/attendance-query"

type Range = { from: string; to: string }
type Report = MtmAttendanceReport & { snapshot?: AttendanceReportSnapshot }
const SELECT_CLASS = "min-h-11 w-full min-w-0 rounded-lg border border-zinc-200 bg-card px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 dark:border-zinc-700"
const LINK_CLASS = "inline-flex min-h-11 items-center justify-center rounded-full border border-zinc-200 px-4 py-2 text-center text-sm font-medium hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:border-zinc-700"

/** Safe, historical branch projection of the same scoped snapshot used by downloads. */
export function MtmAttendanceBranchReport() {
  const t = useTranslations("mtmAttendance")
  const format = useFormatter()
  const locale = useLocale() as "az" | "ru" | "en"
  const [range, setRange] = useState<Range>({ from: "", to: "" })
  const [today, setToday] = useState<string | null>(null)
  const [report, setReport] = useState<Report | null>(null)
  const [teamId, setTeamId] = useState("")
  const [employeeId, setEmployeeId] = useState("")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [rangeError, setRangeError] = useState<string | null>(null)
  const [accessUnavailable, setAccessUnavailable] = useState(false)
  const request = useRef<AbortController | null>(null)
  const lastRange = useRef<Range | undefined>(undefined)

  const load = useCallback(async (selectedRange?: Range) => {
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    setLoading(true)
    setReport(null)
    setError(null)
    setRangeError(null)
    setAccessUnavailable(false)
    try {
      const settingsResponse = await fetch("/api/v1/mtm/attendance/rules", { cache: "no-store", signal: controller.signal })
      const settings = await settingsResponse.json().catch(() => null)
      if (controller.signal.aborted) return
      if (!settingsResponse.ok || settings?.success !== true || !isDateKey(settings.data?.today)) {
        const denied = [401, 403, 404].includes(settingsResponse.status)
        setAccessUnavailable(denied)
        setError(t(denied ? "reportAccessUnavailable" : "reportLoadError"))
        return
      }
      setToday(settings.data.today)
      const selected = selectedRange ?? { from: settings.data.today, to: settings.data.today }
      setRange(selected)
      lastRange.current = selected
      const query = new URLSearchParams({ ...selected, form: "ALL" })
      const response = await fetch(`/api/v1/mtm/attendance/report?${query}`, { cache: "no-store", signal: controller.signal })
      const body = await response.json().catch(() => null)
      if (controller.signal.aborted) return
      if (!response.ok || body?.success !== true || !Array.isArray(body.data?.rows)
        || !isDateKey(body.data?.from) || !isDateKey(body.data?.to) || !Number.isFinite(Date.parse(body.data?.asOf))) {
        const denied = [401, 403, 404].includes(response.status)
        setAccessUnavailable(denied)
        setError(t(denied ? "reportAccessUnavailable" : body?.code === "MTM_ATTENDANCE_REPORT_TOO_LARGE" ? "reportTooLarge" : "reportLoadError"))
        return
      }
      setReport(body.data as Report)
    } catch {
      if (!controller.signal.aborted) setError(t("reportLoadError"))
    } finally {
      if (!controller.signal.aborted) setLoading(false)
    }
  }, [t])
  useEffect(() => { void load(lastRange.current); return () => request.current?.abort() }, [load])

  const directory = useMemo(() => {
    const employees = new Map<string, { id: string; name: string; teamId: string | null }>()
    const teams = new Map<string, string>()
    for (const row of report?.rows ?? []) {
      employees.set(row.employeeId, { id: row.employeeId, name: row.employeeName, teamId: row.teamId })
      if (row.teamId) teams.set(row.teamId, row.teamName ?? t("reportUnnamedTeam"))
    }
    return { employees: [...employees.values()], teams: [...teams].map(([id, name]) => ({ id, name })) }
  }, [report, t])
  const rows = useMemo(() => filterMtmAttendanceRows(report?.rows ?? [], { teamId: teamId || undefined, employeeId: employeeId || undefined, form: "ALL" }), [report, teamId, employeeId])
  const summary = useMemo(() => summarizeAttendanceBranches(rows), [rows])
  const config = useMemo<AttendanceViewConfig | null>(() => report ? { version: 1, mode: "BRANCH", columns: [...DEFAULT_ATTENDANCE_VIEW_COLUMNS.BRANCH], showTotals: true,
    filters: { from: report.from, to: report.to, form: "ALL", ...(teamId ? { teamId } : {}), ...(employeeId ? { employeeId } : {}) } } : null, [report, teamId, employeeId])
  const table = useMemo(() => report && config ? buildAttendanceTable(report, config, locale, t) : null, [report, config, locale, t])
  const scopeUnavailable = Boolean(report && (teamId || employeeId) && !rows.length)
  const hasKnownMarks = summary.totals.arrivals + summary.totals.departures > 0
  const dateLabel = (date: string) => format.dateTime(new Date(`${date}T12:00:00Z`), { dateStyle: "medium", timeZone: "UTC" })
  const timezones = [...new Set(rows.map(row => row.timezone))]
  const metrics = [
    { key: "marks", title: "branchReportMarks", value: summary.totals.arrivals + summary.totals.departures, hint: hasKnownMarks ? t("branchReportMarkCounts", { arrivals: summary.totals.arrivals, departures: summary.totals.departures }) : t("locationReportNotRecorded") },
    { key: "employees", title: "branchReportEmployees", value: summary.totals.employees, hint: t("branchReportUniqueEmployees") },
    { key: "outside", title: "branchReportOutside", value: summary.totals.outside, hint: t("branchReportOutsideHint") },
    { key: "uncertain", title: "branchReportUncertain", value: summary.totals.uncertain, hint: t("branchReportUncertainHint") },
  ]
  function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!isDateKey(range.from) || !isDateKey(range.to) || range.to < range.from || range.to >= addDateKeyDays(range.from, 366)) {
      setRangeError(t("reportRangeInvalid")); return
    }
    void load(range)
  }
  function clearPrivate() {
    request.current?.abort()
    setReport(null)
    setLoading(false)
    setAccessUnavailable(true)
    setError(t("reportAccessUnavailable"))
  }

  return <main className="space-y-5" data-testid="attendance-branch-report">
    <header>
      <div className="space-y-2"><h1 className="text-2xl font-semibold tracking-tight">{t("branchReportTitle")}</h1><p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">{t("branchReportIntro")}</p></div>
    </header>
    <HomeCard testId="attendance-branch-filters" titleId="attendance-branch-filters-title" icon={<ListFilter className="h-4 w-4" aria-hidden="true" />} tone="orange" title={t("reportFilters")}>
      <form onSubmit={apply} className="grid grid-cols-2 items-end gap-4 py-4 xl:grid-cols-[1fr_1fr_1.15fr_1.3fr_auto]">
        <div className="min-w-0 space-y-2"><label htmlFor="attendance-branch-from" className="text-xs font-medium">{t("reportFrom")}</label><Input id="attendance-branch-from" type="date" required className="min-h-11 min-w-0" value={range.from} onChange={event => { setRange({ ...range, from: event.target.value }); setRangeError(null) }} /></div>
        <div className="min-w-0 space-y-2"><label htmlFor="attendance-branch-to" className="text-xs font-medium">{t("reportTo")}</label><Input id="attendance-branch-to" type="date" required className="min-h-11 min-w-0" value={range.to} onChange={event => { setRange({ ...range, to: event.target.value }); setRangeError(null) }} /></div>
        <div className="col-span-2 min-w-0 space-y-2 xl:col-span-1"><label htmlFor="attendance-branch-team" className="text-xs font-medium">{t("reportTeam")}</label><select id="attendance-branch-team" className={SELECT_CLASS} value={teamId} disabled={!report} onChange={event => { setTeamId(event.target.value); setEmployeeId("") }}>
          <option value="">{t("reportAllTeams")}</option>{teamId && !directory.teams.some(team => team.id === teamId) ? <option value={teamId}>{t("viewsUnavailableTeam")}</option> : null}{directory.teams.map(team => <option key={team.id} value={team.id}>{team.name}</option>)}
        </select></div>
        <div className="col-span-2 min-w-0 space-y-2 xl:col-span-1"><label htmlFor="attendance-branch-employee" className="text-xs font-medium">{t("reportEmployee")}</label><select id="attendance-branch-employee" className={SELECT_CLASS} value={employeeId} disabled={!report} onChange={event => setEmployeeId(event.target.value)}>
          <option value="">{t("reportAllEmployees")}</option>{employeeId && !directory.employees.some(employee => employee.id === employeeId) ? <option value={employeeId}>{t("viewsUnavailableEmployee")}</option> : null}{directory.employees.filter(employee => !teamId || employee.teamId === teamId).map(employee => <option key={employee.id} value={employee.id}>{employee.name}</option>)}
        </select></div>
        <Button type="submit" className="col-span-2 min-h-11 rounded-full xl:col-span-1" disabled={!today || loading || accessUnavailable}>{t("reportApply")}</Button>
        {rangeError ? <p role="alert" className="col-span-full text-sm text-destructive">{rangeError}</p> : null}
        {report ? <p className="col-span-full text-xs leading-relaxed text-muted-foreground">{t("reportPeriod", { from: dateLabel(report.from), to: dateLabel(report.to) })} · {t("reportTimezones", { zones: timezones.length ? format.list(timezones) : "—" })}</p> : null}
      </form>
    </HomeCard>
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">{metrics.map(metric => <div key={metric.key} className="min-w-0 rounded-2xl border border-zinc-200 bg-card p-4 dark:border-zinc-700">
      <p className="text-xs text-muted-foreground">{t(metric.title)}</p><p className="my-1 text-3xl font-semibold tabular-nums" data-testid={`attendance-branch-${metric.key}-value`}>{report && hasKnownMarks ? format.number(metric.value) : "—"}</p><p className="text-xs leading-relaxed text-muted-foreground">{metric.hint}</p>
    </div>)}</div>
    <HomeCard testId="attendance-branch-results" titleId="attendance-branch-results-title" icon={<Building2 className="h-4 w-4" aria-hidden="true" />} tone="orange" title={t("branchReportTableTitle")}>
      <div className="space-y-4 py-4">
        <MtmAttendanceExportButtons config={config} snapshot={report?.snapshot ?? null} onRefresh={() => void load(lastRange.current)} onAccessLost={clearPrivate} />
        {loading ? <p role="status" className="text-sm text-muted-foreground">{t("reportLoading")}</p> : null}
        {error ? <div className="space-y-3"><p role="alert" className="text-sm text-destructive">{error}</p>{!accessUnavailable ? <Button variant="outline" className="min-h-11" onClick={() => void load(lastRange.current)}>{t("reportReload")}</Button> : null}</div> : null}
        {scopeUnavailable ? <p role="alert" className="text-sm text-amber-800 dark:text-amber-300">{t("viewsScopeUnavailable")}</p> : null}
        {table ? <>{!table.rows.length ? <p className="rounded-xl bg-muted/50 px-4 py-5 text-sm text-muted-foreground">{t("branchReportEmpty")}</p> : <div className="overflow-x-auto"><table className="block w-full text-sm tabular-nums sm:table" data-testid="attendance-branch-table">
          <thead className="sr-only sm:not-sr-only sm:table-header-group"><tr>{table.columns.map((column, index) => <th key={column.key} scope="col" className={`border-b border-zinc-200 px-3 py-3 text-xs font-medium text-muted-foreground dark:border-zinc-700 ${index ? "text-right" : "text-left"}`}>{column.label}</th>)}</tr></thead>
          <tbody className="block sm:table-row-group">{table.rows.map(row => <tr key={row.key} data-testid="attendance-branch-row" className="grid grid-cols-2 gap-x-5 gap-y-3 border-b border-zinc-100 py-4 dark:border-zinc-800 sm:table-row sm:border-0 sm:py-0">
            {row.cells.map((cell, index) => index === 0 ? <th key={table.columns[index].key} scope="row" className="col-span-2 min-w-0 break-words text-left font-semibold sm:w-[36%] sm:border-b sm:border-zinc-100 sm:px-3 sm:py-4 dark:sm:border-zinc-800">{cell}</th> : <td key={table.columns[index].key} className="min-w-0 sm:border-b sm:border-zinc-100 sm:px-3 sm:py-4 sm:text-right dark:sm:border-zinc-800"><span className="mb-1 block text-xs text-muted-foreground sm:hidden" aria-hidden="true">{table.columns[index].label}</span>{cell}</td>)}
          </tr>)}</tbody>
        </table></div>}
          <div className="space-y-2 text-xs leading-relaxed text-muted-foreground" data-testid="attendance-branch-details">{table.details.slice(1).map((line, index) => <p key={index}>{line}</p>)}</div>
          {table.totals.length ? <div className="space-y-2 rounded-xl bg-muted/50 p-4 text-sm" data-testid="attendance-branch-totals">{table.totals.map((line, index) => <p key={index} className={index === 0 ? "font-semibold" : "tabular-nums"}>{line}</p>)}</div> : null}
        </> : null}
      </div>
    </HomeCard>
    <div className="grid gap-5 rounded-2xl border border-zinc-200 bg-card p-5 sm:grid-cols-2 dark:border-zinc-700">
      <div className="space-y-2"><h2 className="text-sm font-semibold">{t("branchReportReadTitle")}</h2><p className="text-sm leading-relaxed text-muted-foreground">{t("branchReportReadHint")}</p><p className="text-sm leading-relaxed text-muted-foreground">{t("branchReportEvidenceHint")}</p></div>
      <div className="space-y-2"><h2 className="text-sm font-semibold">{t("branchReportMissingTitle")}</h2><p className="text-sm leading-relaxed text-muted-foreground">{t("branchReportMissingHint")}</p><p className="text-sm leading-relaxed text-muted-foreground">{t("branchReportBreakPrivacy")}</p></div>
    </div>
    <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl bg-muted/50 p-4"><div className="space-y-1"><h2 className="text-sm font-semibold">{t("branchReportDaysTitle")}</h2><p className="text-xs leading-relaxed text-muted-foreground">{t("branchReportDaysHint")}</p></div><Link href="/mtm/attendance/timesheet?tab=days" className={LINK_CLASS}>{t("branchReportOpenDays")}</Link></div>
  </main>
}
