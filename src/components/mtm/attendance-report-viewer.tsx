"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { MtmAttendanceExportButtons } from "@/components/mtm/attendance-export-buttons"
import { AttendanceReportTable, AttendanceReportTotals } from "@/components/mtm/attendance-report-table"
import { AttendanceClosedMonth } from "@/components/mtm/attendance-closed-month"
import { AttendanceN1tClosePanel, AttendanceN1tMessages, AttendanceN1tNotes, useAttendanceN1tMonth } from "@/components/mtm/attendance-n1t-month"
import { buildAttendanceTable } from "@/lib/mtm/attendance-table"
import { formatDate } from "@/lib/format-date"
import { addDateKeyDays, isDateKey } from "@/lib/mtm/mobile-week"
import { ATTENDANCE_REPORTS, type AttendanceReportKey } from "@/lib/mtm/attendance-reports-catalog"
import type { MtmAttendanceReport } from "@/lib/mtm/attendance-report"
import type { AttendanceReportSnapshot } from "@/lib/mtm/attendance-query"
import type { AttendanceViewConfig } from "@/lib/mtm/attendance-view-contract"

type Range = { from: string; to: string }
type Data = MtmAttendanceReport & { snapshot?: AttendanceReportSnapshot }
const monthOf = (date: string): Range => {
  const [year, month] = date.slice(0, 7).split("-").map(Number)
  return { from: `${date.slice(0, 7)}-01`, to: new Date(Date.UTC(year, month, 0, 12)).toISOString().slice(0, 10) }
}
const shiftMonth = (range: Range, step: number) => {
  const [year, month] = range.from.slice(0, 7).split("-").map(Number)
  return monthOf(new Date(Date.UTC(year, month - 1 + step, 1, 12)).toISOString().slice(0, 10))
}
const SELECT = "min-h-10 min-w-44 rounded-lg border border-zinc-200 bg-card px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 dark:border-zinc-700"

/**
 * One Personnel report: its period, team, the table and Excel/PDF of the same snapshot.
 *
 * N-1t of a finished month is also where the month is closed (owner, 2026-10-20:
 * production behaves like the «Kadr uçotu» clip): a closed month shows its
 * frozen N-1t with «Bağlanıb», who and when, its own Excel/PDF and the
 * corrections approved later; an open one shows the N-1t a press of
 * «Bu tabeli bağla» will freeze, or the days that block it.
 */
export function MtmAttendanceReportViewer({ report, initialDate }: { report: AttendanceReportKey; initialDate?: string }) {
  const definition = ATTENDANCE_REPORTS[report]
  const t = useTranslations("mtmAttendance"), p = useTranslations("personnel")
  const locale = useLocale() as "az" | "ru" | "en"
  const [range, setRange] = useState<Range | null>(null)
  const [teamId, setTeamId] = useState("")
  const [data, setData] = useState<Data | null>(null)
  const [loading, setLoading] = useState(true), [error, setError] = useState<string | null>(null)
  const [today, setToday] = useState<string | null>(null)
  const request = useRef<AbortController | null>(null)

  const load = useCallback(async (next?: Range) => {
    if (definition.kind !== "table") return
    request.current?.abort()
    const controller = new AbortController(); request.current = controller
    setLoading(true); setError(null); setData(null)
    try {
      let selected = next
      if (!selected) {
        const rules = await fetch("/api/v1/mtm/attendance/rules", { cache: "no-store", signal: controller.signal }).then(response => response.json()).catch(() => null)
        const today: unknown = rules?.data?.today
        if (!isDateKey(today)) throw new Error("NO_TODAY")
        setToday(today)
        // A link for one date opens that date (its month for a month report); otherwise the current period.
        const asked = isDateKey(initialDate) ? initialDate : null
        selected = asked ? definition.period === "month" ? monthOf(asked) : { from: asked, to: asked }
          : definition.period === "day" ? { from: today, to: today } : definition.period === "month" ? monthOf(today) : { from: `${today.slice(0, 7)}-01`, to: today }
      }
      setRange(selected)
      const response = await fetch(`/api/v1/mtm/attendance/report?${new URLSearchParams({ from: selected.from, to: selected.to, form: "ALL" })}`, { cache: "no-store", signal: controller.signal })
      const body = await response.json().catch(() => null)
      if (controller.signal.aborted) return
      if (!response.ok || body?.success !== true) { setError([401, 403, 404].includes(response.status) ? "reportAccessUnavailable" : body?.code === "MTM_ATTENDANCE_REPORT_TOO_LARGE" ? "reportTooLarge" : "reportLoadError"); return }
      setData(body.data as Data)
    } catch { if (!controller.signal.aborted) setError("reportLoadError") }
    finally { if (!controller.signal.aborted) setLoading(false) }
  }, [definition, initialDate])
  useEffect(() => { void load(); return () => request.current?.abort() }, [load])

  const config = useMemo<AttendanceViewConfig | null>(() => definition.kind !== "table" || !data ? null : {
    version: 1, mode: definition.mode, columns: [...definition.columns], showTotals: true,
    filters: { from: data.from, to: data.to, form: definition.form, ...(teamId ? { teamId } : {}) },
  }, [definition, data, teamId])
  // A month is closed only once it is over in the company's own calendar.
  const closingMonth = report === "n1t" && range && today && range.to < today ? range.from.slice(0, 7) : null
  const lostAccess = useCallback(() => { setData(null); setError("reportAccessUnavailable") }, [])
  const month = useAttendanceN1tMonth(closingMonth, lostAccess)
  const closed = useMemo(() => month.state?.closes ?? [], [month.state])
  const frozenIds = useMemo(() => new Set(closed.flatMap(close => close.agentIds)), [closed])
  const allClosed = closed.length > 0 && month.state?.open === 0
  const closable = !!month.state?.candidates.length && !teamId
  // People in a frozen N-1t are not repeated in today's figures below it.
  const live = useMemo(() => !data || !frozenIds.size ? data : { ...data, rows: data.rows.filter(row => !frozenIds.has(row.employeeId)),
    ...(data.accountingRows ? { accountingRows: data.accountingRows.filter(row => !frozenIds.has(row.employeeId)) } : {}) }, [data, frozenIds])
  const table = useMemo(() => live && config ? buildAttendanceTable(live, config, locale, t) : null, [live, config, locale, t])
  const teams = useMemo(() => [...new Map((data?.rows ?? []).flatMap(row => row.teamId ? [[row.teamId, row.teamName ?? t("reportNoTeam")] as const] : [])).entries()], [data, t])
  if (definition.kind !== "table") return null
  // Until the month's state is known, a past N-1t waits: a closed month must not flash today's figures.
  const waiting = !month.settled
  const showLive = !allClosed && !(closable && !waiting)

  const label = (date: string) => formatDate(`${date}T12:00:00.000Z`, locale, { dateStyle: "medium", timeZone: "UTC" })
  const change = (next: Range) => { if (isDateKey(next.from) && isDateKey(next.to) && next.to >= next.from && next.to < addDateKeyDays(next.from, 366)) void load(next); else setRange(next) }
  return <section className="space-y-4" data-testid="attendance-report-viewer">
    <div className="flex flex-wrap items-center gap-2">
      {range && definition.period === "month" ? <div className="inline-flex items-center gap-1 rounded-xl border bg-card p-1">
        <Button type="button" variant="ghost" size="icon" className="h-9 w-9" aria-label={p("previousMonth")} disabled={loading} onClick={() => void load(shiftMonth(range, -1))}><ChevronLeft className="h-4 w-4" aria-hidden="true" /></Button>
        <span className="min-w-36 px-2 text-center text-sm font-semibold capitalize">{formatDate(`${range.from.slice(0, 7)}-15T12:00:00.000Z`, locale, { month: "long", year: "numeric", timeZone: "UTC" })}</span>
        <Button type="button" variant="ghost" size="icon" className="h-9 w-9" aria-label={p("nextMonth")} disabled={loading} onClick={() => void load(shiftMonth(range, 1))}><ChevronRight className="h-4 w-4" aria-hidden="true" /></Button>
      </div> : range ? <>
        <Input aria-label={t(definition.period === "day" ? "reportDate" : "reportFrom")} type="date" className="min-h-10 w-40" value={range.from}
          onChange={event => change(definition.period === "day" ? { from: event.target.value, to: event.target.value } : { ...range, from: event.target.value })} />
        {definition.period === "range" ? <><span className="text-muted-foreground">—</span>
          <Input aria-label={t("reportTo")} type="date" className="min-h-10 w-40" value={range.to} onChange={event => change({ ...range, to: event.target.value })} /></> : null}
      </> : null}
      {allClosed ? null : <select aria-label={t("reportTeam")} className={SELECT} value={teamId} disabled={!data} onChange={event => setTeamId(event.target.value)}>
        <option value="">{t("reportAllTeams")}</option>{teams.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select>}
      <span className="flex-1" />
      {/* Today's file only for today's figures: a closed month downloads its frozen N-1t from its card. */}
      {closingMonth && (closed.length || closable || waiting) ? null
        : <MtmAttendanceExportButtons config={config} snapshot={data?.snapshot ?? null} onRefresh={() => void load(range ?? undefined)} onAccessLost={() => setError("reportAccessUnavailable")} />}
    </div>
    {error ? <p role="alert" className="text-sm text-destructive">{t(error)}</p> : null}
    {!error && month.failed ? <p role="alert" className="text-sm text-destructive">{t("monthCloseLoadError")}</p> : null}
    {!error && closed.map((close, index) => <AttendanceClosedMonth key={close.id} detail={close} tableFirst primary={!closable && index === closed.length - 1} onAccessLost={lostAccess} />)}
    {!error && month.state?.moreCloses ? <p className="text-sm text-muted-foreground">{t("monthCloseMoreCloses")}</p> : null}
    {!error && month.state && month.state.closedElsewhere > 0 ? <p className="text-sm text-muted-foreground" data-testid="attendance-n1t-closed-elsewhere">{t("monthCloseClosedElsewhere", { count: month.state.closedElsewhere })}</p> : null}
    {!error && closable && !waiting ? <AttendanceN1tClosePanel month={month} /> : null}
    {!error && showLive ? <div className="rounded-2xl border bg-card p-4">
      {loading || waiting ? <p role="status" className="text-sm text-muted-foreground">{t("reportLoading")}</p> : null}
      {table && !waiting ? !table.rows.length ? <p className="rounded-xl bg-muted/50 px-4 py-5 text-sm text-muted-foreground">{t("reportEmpty")}</p>
        : <AttendanceReportTable table={table} /> : null}
      {table && range && !waiting ? <AttendanceReportTotals period={t("reportPeriod", { from: label(range.from), to: label(range.to) })} totals={table.totals} /> : null}
      {month.state?.candidates.length && teamId ? <p className="mt-3 text-sm text-muted-foreground">{t("monthCloseN1tTeamSelected", { all: t("reportAllTeams") })}</p> : null}
    </div> : null}
    {!error ? <AttendanceN1tNotes month={month} /> : null}
    {!error && report === "n1t" && range && today && range.from <= today && range.to >= today ? <p className="text-sm text-muted-foreground" data-testid="attendance-n1t-not-yet">{t("monthCloseN1tNotYet")}</p> : null}
    {!error ? <AttendanceN1tMessages month={month} /> : null}
  </section>
}
