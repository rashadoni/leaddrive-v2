"use client"

import Link from "next/link"
import { useEffect, useRef, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { Download, FileSpreadsheet, Lock } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Hint } from "@/components/hint"
import { AttendanceReportTable, AttendanceReportTotals } from "@/components/mtm/attendance-report-table"
import { createDateFormatter } from "@/lib/format-date"
import type { AttendanceMonthDetail } from "@/lib/mtm/attendance-month-contract"
import type { AttendanceTable } from "@/lib/mtm/attendance-table"

const endpoint = "/api/v1/mtm/attendance/months"

/** Stored cells are rendered verbatim: never reconstruct a closed month using
 * today's report, translations, employee names or accounting definitions. */
export function AttendanceFrozenMonthTable({ table }: { table: AttendanceTable }) {
  const identity = table.columns.findIndex(c => c.key === "employee"), team = table.columns.findIndex(c => c.key === "team"), worked = table.columns.findIndex(c => c.key === "worked")
  return <div className="space-y-5"><div className="space-y-1 text-sm text-muted-foreground">{table.details.map((line, i) => <p key={i}>{line}</p>)}</div>{table.rows.map(row => <article key={row.key} className="rounded-xl border p-4 sm:p-5"><div className="mb-4 flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-semibold">{row.cells[identity]}</h3>{team >= 0 && <p className="text-sm text-muted-foreground">{row.cells[team]}</p>}</div>{worked >= 0 && <div><p className="text-xs text-muted-foreground">{table.columns[worked].label}</p><p className="text-lg font-semibold">{row.cells[worked]}</p></div>}</div><dl className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">{table.columns.map((column, index) => [identity, team, worked].includes(index) ? null : <div key={column.key} className="min-w-0 rounded-lg bg-muted/40 p-3"><dt className="break-words text-xs text-muted-foreground">{column.label}</dt><dd className="mt-1 break-words text-sm font-medium">{row.cells[index]}</dd></div>)}</dl></article>)}<div className="space-y-1 text-sm">{table.totals.map((line, i) => <p key={i}>{line}</p>)}</div></div>
}

/** A frozen table as its form reads: the N-1t as the N-1t report draws it, an older month grid as it always was. */
export function AttendanceFrozenTable({ table, form }: { table: AttendanceTable; form: AttendanceMonthDetail["form"] }) {
  if (form === "MONTH") return <AttendanceFrozenMonthTable table={table} />
  return <div className="rounded-2xl border bg-card p-4" data-testid="attendance-frozen-n1t">
    <AttendanceReportTable table={table} testId="attendance-frozen-n1t-table" />
    <AttendanceReportTotals period={table.details[0] ?? null} totals={table.totals} />
  </div>
}

/** «sentyabr 2026»: the month in the interface language, as the clip reads it. */
export function attendanceMonthLabel(month: string, locale: string) {
  return createDateFormatter(locale, { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${month}-15T12:00:00Z`))
}

/**
 * A closed month (owner, 2026-10-20: production behaves like the «Kadr uçotu»
 * clip): its frozen N-1t, then «sentyabr 2026 · Bağlanıb», who closed it and
 * when, Excel and PDF of exactly those cells, the note that a closed month does
 * not change, and the corrections approved after the close, listed apart —
 * they changed the live days, never the frozen figures.
 *
 * `tableFirst` keeps the clip's order on the N-1t screen (the table stays where
 * it was, the button's card turns into this one); «Bağlanmış aylar» puts the
 * card first. `primary` marks the screen's one filled button.
 */
export function AttendanceClosedMonth({ detail, tableFirst = false, primary = true, onAccessLost }: {
  detail: AttendanceMonthDetail; tableFirst?: boolean; primary?: boolean; onAccessLost: () => void
}) {
  const t = useTranslations("mtmAttendance")
  const locale = useLocale() as "az" | "ru" | "en"
  const [exporting, setExporting] = useState<"xlsx" | "pdf" | null>(null)
  const [failed, setFailed] = useState(false)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  // The reader's own clock: "UTC" beside every time read as an error (owner, 2026-10-15).
  const at = (value: string) => createDateFormatter(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value))
  const day = (value: string) => createDateFormatter(locale, { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${value}T12:00:00Z`))
  const interval = (value: { startedAt: string; completedAt: string | null } | null) => value ? `${at(value.startedAt)} → ${value.completedAt ? at(value.completedAt) : "—"}` : "—"

  async function download(format: "xlsx" | "pdf") {
    if (exporting) return
    setExporting(format); setFailed(false)
    try {
      const response = await fetch(`${endpoint}/${encodeURIComponent(detail.id)}/export?${new URLSearchParams({ locale, format })}`, { cache: "no-store" })
      if (!mounted.current) return
      if ([401, 403, 404].includes(response.status)) { onAccessLost(); return }
      if (!response.ok) throw new Error("EXPORT_FAILED")
      const blob = await response.blob()
      if (!mounted.current) return
      const url = URL.createObjectURL(blob), link = document.createElement("a")
      link.href = url
      link.download = `${detail.form === "N1T" ? "N-1t" : "attendance-closed"}-${detail.month}.${format}`
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch { if (mounted.current) setFailed(true) } finally { if (mounted.current) setExporting(null) }
  }

  // Excel is the screen's one filled button — unless another button on the screen already is (a second close card, the close button).
  const excelVariant = primary ? "default" : "outline"
  const table = <AttendanceFrozenTable table={detail.table} form={detail.form} />
  const card = <Card className="space-y-4 p-4 sm:p-6" data-testid="attendance-closed-month">
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div className="flex min-w-0 items-start gap-3">
        <Lock className="mt-1 h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
        <div className="min-w-0">
          <h2 className="text-lg font-semibold" data-testid="attendance-closed-month-title">{attendanceMonthLabel(detail.month, locale)} · {t("monthCloseClosed")}</h2>
          <p className="text-sm text-muted-foreground" data-testid="attendance-closed-month-by">{detail.createdByName ?? "—"} · {at(detail.createdAt)}</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-3">
        <Hint text={t("monthCloseExcelHint")}>
          <Button type="button" className="min-h-11" variant={excelVariant} disabled={!!exporting} onClick={() => void download("xlsx")}>
            <FileSpreadsheet className="mr-2 h-4 w-4" aria-hidden="true" />{t("monthCloseExcel")}</Button>
        </Hint>
        <Hint text={t("monthClosePdfHint")}>
          <Button type="button" className="min-h-11" variant="outline" disabled={!!exporting} onClick={() => void download("pdf")}>
            <Download className="mr-2 h-4 w-4" aria-hidden="true" />{t("monthClosePdf")}</Button>
        </Hint>
      </div>
    </div>
    {/* A notice is white with a coloured edge (MTM colours, 2026-10-18). */}
    <p className="rounded-xl border border-l-4 border-zinc-200 border-l-emerald-500 bg-card p-4 text-sm text-foreground dark:border-zinc-700 dark:border-l-emerald-500">{t("monthCloseFrozen")}</p>
    {detail.form === "MONTH" ? <p className="text-sm text-muted-foreground" data-testid="attendance-closed-month-legacy">{t("monthCloseLegacyForm")}</p> : null}
    {failed ? <p role="alert" className="text-sm text-destructive">{t("monthCloseExportError")}</p> : null}
    <section className="space-y-3 border-t pt-4" data-testid="attendance-closed-month-corrections" aria-label={t("monthCloseJournal")}>
      <div><h3 className="font-semibold">{t("monthCloseJournal")}</h3><p className="text-sm text-muted-foreground">{t("monthCloseJournalHint")}</p></div>
      {!detail.corrections.length ? <p className="text-sm text-muted-foreground">{t("monthCloseNoCorrections")}</p> : null}
      {detail.corrections.map(entry => <article key={entry.id} className="space-y-2 rounded-xl border p-4" data-testid="attendance-closed-month-correction">
        <h4 className="font-medium">{entry.employeeName} · {day(entry.date)}</h4>
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          <div><dt className="text-xs text-muted-foreground">{t("monthCloseBefore")}</dt><dd className="break-words">{interval(entry.before)}</dd></div>
          <div><dt className="text-xs text-muted-foreground">{t("monthCloseAfter")}</dt><dd className="break-words">{interval(entry.after)}</dd></div>
        </dl>
        <p className="text-xs text-muted-foreground">{entry.reviewerName ?? "—"} · {at(entry.at)}</p>
        {entry.requestId ? <Hint text={t("monthCloseReasonInRequestHint")}><Link className="inline-flex min-h-11 items-center text-sm font-semibold text-primary hover:underline" href={`/mtm/attendance/requests?requestId=${encodeURIComponent(entry.requestId)}`}>{t("monthCloseReasonInRequest")}</Link></Hint> : null}
      </article>)}
      {detail.moreCorrections ? <p role="alert" className="text-sm">{t("monthCloseMoreCorrections")}</p> : null}
    </section>
  </Card>
  return <div className="space-y-4" data-testid="attendance-closed-month-block">{tableFirst ? <>{table}{card}</> : <>{card}{table}</>}</div>
}
