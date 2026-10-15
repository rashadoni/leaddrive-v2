"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { MtmAttendanceExportButtons } from "@/components/mtm/attendance-export-buttons"
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
const isDayKey = (key: string) => /^\d{4}-\d{2}-\d{2}$/.test(key)
/**
 * A month grid on screen (owner, 2026-10-15: «Forma N-1t» ran off the page).
 * Excel and PDF keep every column as built; the screen only regroups them:
 * position and department go under the name, a day shows its code with the
 * hours beneath (hours only from 85rem — below that the code alone fits, the
 * hours stay in the cell's tooltip), and an empty notes column is not drawn.
 */
function screenColumns(table: NonNullable<ReturnType<typeof buildAttendanceTable>>) {
  const index = (key: string) => table.columns.findIndex(column => column.key === key)
  const monthGrid = table.columns.some(column => isDayKey(column.key)) && index("employee") >= 0
  const folded = monthGrid ? ["position", "team"].map(index).filter(at => at >= 0) : []
  const notes = index("notes"), emptyNotes = monthGrid && notes >= 0 && table.rows.every(row => !String(row.cells[notes] ?? "").trim())
  return { monthGrid, employee: index("employee"), folded, shown: table.columns.map((column, at) => ({ column, at })).filter(({ at }) => !folded.includes(at) && !(emptyNotes && at === notes)) }
}
/** Every day the same shape — code on one line, hours (or nothing) beneath — so codes line up across the row. */
function DayCell({ text }: { text: string }) {
  const parts = text.includes(" / ") ? [text] : text.split(" · ")
  const [code, ...rest] = parts
  return <span className="block text-center leading-tight" title={text}><span className={`block pt-0.5 text-[11px] font-medium min-[85rem]:pt-0 min-[85rem]:text-[13px] ${code === "·" || code === "—" ? "text-muted-foreground" : ""}`}>{code}</span>
    <span className="hidden min-h-3 text-[9px] font-normal text-muted-foreground min-[85rem]:block">{rest.join(" · ")}</span></span>
}
/** Equal day columns: narrower while the hours are hidden (below 85rem). */
const DAY_WIDTH = "w-5 min-w-5 min-[85rem]:w-6 min-[85rem]:min-w-6"
const totalColumn = (key: string) => ["workedDays", "hours", "worked", "late", "absent", "days"].includes(key)
const SELECT = "min-h-10 min-w-44 rounded-lg border border-zinc-200 bg-card px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 dark:border-zinc-700"

/** One Personnel report: its period, team, the table and Excel/PDF of the same snapshot. */
export function MtmAttendanceReportViewer({ report }: { report: AttendanceReportKey }) {
  const definition = ATTENDANCE_REPORTS[report]
  const t = useTranslations("mtmAttendance"), p = useTranslations("personnel")
  const locale = useLocale() as "az" | "ru" | "en"
  const [range, setRange] = useState<Range | null>(null)
  const [teamId, setTeamId] = useState("")
  const [data, setData] = useState<Data | null>(null)
  const [loading, setLoading] = useState(true), [error, setError] = useState<string | null>(null)
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
        selected = definition.period === "day" ? { from: today, to: today } : definition.period === "month" ? monthOf(today) : { from: `${today.slice(0, 7)}-01`, to: today }
      }
      setRange(selected)
      const response = await fetch(`/api/v1/mtm/attendance/report?${new URLSearchParams({ from: selected.from, to: selected.to, form: "ALL" })}`, { cache: "no-store", signal: controller.signal })
      const body = await response.json().catch(() => null)
      if (controller.signal.aborted) return
      if (!response.ok || body?.success !== true) { setError([401, 403, 404].includes(response.status) ? "reportAccessUnavailable" : body?.code === "MTM_ATTENDANCE_REPORT_TOO_LARGE" ? "reportTooLarge" : "reportLoadError"); return }
      setData(body.data as Data)
    } catch { if (!controller.signal.aborted) setError("reportLoadError") }
    finally { if (!controller.signal.aborted) setLoading(false) }
  }, [definition])
  useEffect(() => { void load(); return () => request.current?.abort() }, [load])

  const config = useMemo<AttendanceViewConfig | null>(() => definition.kind !== "table" || !data ? null : {
    version: 1, mode: definition.mode, columns: [...definition.columns], showTotals: true,
    filters: { from: data.from, to: data.to, form: definition.form, ...(teamId ? { teamId } : {}) },
  }, [definition, data, teamId])
  const table = useMemo(() => data && config ? buildAttendanceTable(data, config, locale, t) : null, [data, config, locale, t])
  const layout = useMemo(() => table ? screenColumns(table) : null, [table])
  const teams = useMemo(() => [...new Map((data?.rows ?? []).flatMap(row => row.teamId ? [[row.teamId, row.teamName ?? t("reportNoTeam")] as const] : [])).entries()], [data, t])
  if (definition.kind !== "table") return null

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
      <select aria-label={t("reportTeam")} className={SELECT} value={teamId} disabled={!data} onChange={event => setTeamId(event.target.value)}>
        <option value="">{t("reportAllTeams")}</option>{teams.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select>
      <span className="flex-1" />
      <MtmAttendanceExportButtons config={config} snapshot={data?.snapshot ?? null} onRefresh={() => void load(range ?? undefined)} onAccessLost={() => setError("reportAccessUnavailable")} />
    </div>
    <div className="rounded-2xl border bg-card p-4">
      {loading ? <p role="status" className="text-sm text-muted-foreground">{t("reportLoading")}</p> : null}
      {error ? <p role="alert" className="text-sm text-destructive">{t(error)}</p> : null}
      {table && layout ? !table.rows.length ? <p className="rounded-xl bg-muted/50 px-4 py-5 text-sm text-muted-foreground">{t("reportEmpty")}</p>
        : <div className="overflow-x-auto" role="region" aria-label={table.title} tabIndex={0}><table className="w-full border-collapse text-sm" data-testid="attendance-report-table">
          {/* Headers wrap and cells stay tight: a wide report fits the page instead of scrolling inside the card. */}
          <thead><tr>{layout.shown.map(({ column }) => <th key={column.key} scope="col" className={`border-b py-2 align-bottom text-[11px] font-medium leading-tight text-muted-foreground ${isDayKey(column.key) ? `${DAY_WIDTH} px-0 text-center` : layout.monthGrid && totalColumn(column.key) ? "w-16 px-1 text-right" : "px-2 text-left"}`}>{isDayKey(column.key) ? Number(column.key.slice(8)) : column.label}</th>)}</tr></thead>
          <tbody>{table.rows.map(row => <tr key={row.key} className="border-b last:border-0" data-testid="attendance-report-row">{layout.shown.map(({ column, at }) => {
            const cell = row.cells[at], day = isDayKey(column.key), name = at === layout.employee
            const under = name ? layout.folded.map(index => String(row.cells[index] ?? "")).filter(text => text && text !== "—") : []
            // A month grid reads along the first line: number, name, codes and totals share it.
            return <td key={column.key} className={`py-2 text-[13px] tabular-nums ${layout.monthGrid ? "align-top leading-tight" : ""} ${day ? `${DAY_WIDTH} px-0` : layout.monthGrid && totalColumn(column.key) ? "px-1 text-right" : "px-2"} ${name ? "min-w-28 font-semibold" : ""}`}>
              {day ? <DayCell text={String(cell ?? "")} /> : cell}
              {under.length ? <span className="block text-[11px] font-normal leading-tight text-muted-foreground" data-testid="attendance-report-employee-details">{under.join(" · ")}</span> : null}</td>
          })}</tr>)}</tbody>
        </table></div> : null}
      {table && range ? <div className="mt-4 space-y-1 text-xs text-muted-foreground">
        <p>{t("reportPeriod", { from: label(range.from), to: label(range.to) })}</p>
        {table.totals.slice(1).map((line, index) => <p key={index} className="font-medium text-foreground">{line}</p>)}
      </div> : null}
    </div>
  </section>
}
