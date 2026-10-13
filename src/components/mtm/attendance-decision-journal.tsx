"use client"

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react"
import { useLocale, useTranslations } from "next-intl"
import { Download } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { HomePill } from "@/components/mtm/home-parts"
import { AttendanceDecisionJournalQuerySchema, AttendanceDecisionJournalSnapshotSchema, ATTENDANCE_DECISION_JOURNAL_LIMIT,
  type AttendanceDecisionJournal, type AttendanceDecisionJournalQuery } from "@/lib/mtm/attendance-decision-journal-contract"
import { buildAttendanceDecisionJournalTable } from "@/lib/mtm/attendance-decision-journal-table"

const STATUS = { ALL: "requestsAll", PENDING: "requestsPending", APPROVED: "requestsApproved", REJECTED: "requestsRejected", CANCELLED: "requestsCancelled" } as const
const PAGE_SIZE = 50
const ENDPOINT = "/api/v1/mtm/attendance/decisions"

export function MtmAttendanceDecisionJournal() {
  const t = useTranslations("mtmAttendance")
  const rawLocale = useLocale()
  const locale = rawLocale === "az" || rawLocale === "ru" ? rawLocale : "en"
  const [draft, setDraft] = useState<AttendanceDecisionJournalQuery>({ from: "", to: "", status: "ALL" })
  const [journal, setJournal] = useState<AttendanceDecisionJournal | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [accessUnavailable, setAccessUnavailable] = useState(false)
  const [page, setPage] = useState(0)
  const [exporting, setExporting] = useState<"xlsx" | "pdf" | null>(null)
  const [mustRefresh, setMustRefresh] = useState(false)
  const [downloadReady, setDownloadReady] = useState(false)
  const readRequest = useRef<AbortController | null>(null)
  const exportRequest = useRef<AbortController | null>(null)
  const lastQuery = useRef<AttendanceDecisionJournalQuery | undefined>(undefined)

  function cancelExport() {
    exportRequest.current?.abort(); exportRequest.current = null
    setExporting(null); setDownloadReady(false)
  }
  const clearPrivate = useCallback(() => {
    readRequest.current?.abort(); exportRequest.current?.abort()
    readRequest.current = null; exportRequest.current = null
    setJournal(null); setPage(0); setLoading(false); setExporting(null); setDownloadReady(false)
    setAccessUnavailable(true); setError("reportAccessUnavailable")
  }, [])
  const load = useCallback(async (query?: AttendanceDecisionJournalQuery) => {
    readRequest.current?.abort(); exportRequest.current?.abort(); exportRequest.current = null
    const controller = new AbortController(); readRequest.current = controller
    setLoading(true); setExporting(null); setDownloadReady(false); setError(null); setJournal(null); setPage(0)
    try {
      const response = await fetch(query ? `${ENDPOINT}?${new URLSearchParams(query)}` : ENDPOINT, { cache: "no-store", signal: controller.signal })
      const body = await response.json().catch(() => null)
      if (controller.signal.aborted) return
      if ([401, 403, 404].includes(response.status)) { clearPrivate(); return }
      const data = body?.data
      if (!response.ok || body?.success !== true || !Array.isArray(data?.items) || data.items.length > ATTENDANCE_DECISION_JOURNAL_LIMIT || !AttendanceDecisionJournalSnapshotSchema.safeParse(data?.snapshot).success) {
        setError(body?.code === "MTM_ATTENDANCE_JOURNAL_TOO_LARGE" ? "journalTooLarge" : "journalLoadError"); return
      }
      setJournal(data); setDraft(data.snapshot.query); lastQuery.current = data.snapshot.query
      setMustRefresh(false); setAccessUnavailable(false)
    } catch { if (!controller.signal.aborted) setError("journalLoadError") }
    finally { if (!controller.signal.aborted) { readRequest.current = null; setLoading(false) } }
  }, [clearPrivate])
  useEffect(() => {
    void load()
    return () => { readRequest.current?.abort(); exportRequest.current?.abort() }
  }, [load])
  useEffect(() => {
    exportRequest.current?.abort(); exportRequest.current = null
    setExporting(null); setDownloadReady(false)
  }, [locale])

  const table = useMemo(() => journal ? buildAttendanceDecisionJournalTable(journal, locale, t) : null, [journal, locale, t])
  const dirty = !journal || draft.from !== journal.snapshot.query.from || draft.to !== journal.snapshot.query.to || draft.status !== journal.snapshot.query.status
  const pageCount = Math.max(1, Math.ceil((table?.rows.length ?? 0) / PAGE_SIZE))
  const visible = table?.rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE) ?? []
  const exportDisabled = dirty || loading || Boolean(exporting) || mustRefresh || accessUnavailable
  function changeDraft(next: AttendanceDecisionJournalQuery) { cancelExport(); setDraft(next); setError(mustRefresh ? "journalChanged" : null) }
  function apply(event: FormEvent) {
    event.preventDefault()
    if (loading) return
    const parsed = AttendanceDecisionJournalQuerySchema.safeParse(draft)
    if (!parsed.success) { setError("journalInvalidPeriod"); return }
    void load(parsed.data)
  }
  async function download(format: "xlsx" | "pdf") {
    if (!journal || exportDisabled || exportRequest.current) return
    const controller = new AbortController(); exportRequest.current = controller
    setExporting(format); setError(null); setDownloadReady(false)
    let objectUrl: string | null = null, link: HTMLAnchorElement | null = null
    try {
      const response = await fetch(ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ snapshot: journal.snapshot, format, locale }), signal: controller.signal })
      if (controller.signal.aborted) return
      if ([401, 403, 404].includes(response.status)) { clearPrivate(); return }
      if (!response.ok) {
        const body = await response.json().catch(() => null)
        if (controller.signal.aborted) return
        if (response.status === 409) { setMustRefresh(true); setError("journalChanged") }
        else setError(body?.code === "MTM_ATTENDANCE_JOURNAL_TOO_LARGE" ? "journalTooLarge" : "exportFailed")
        return
      }
      const mime = format === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      if (!response.headers.get("content-type")?.includes(mime)) { setError("exportFailed"); return }
      const blob = await response.blob()
      if (controller.signal.aborted) return
      if (!blob.size) { setError("exportFailed"); return }
      objectUrl = URL.createObjectURL(blob); link = document.createElement("a"); link.href = objectUrl
      link.download = `attendance-decisions-${journal.snapshot.query.from}-${journal.snapshot.query.to}.${format}`
      link.hidden = true; document.body.append(link); link.click(); setDownloadReady(true)
    } catch { if (!controller.signal.aborted) setError("exportFailed") }
    finally {
      link?.remove(); if (objectUrl) URL.revokeObjectURL(objectUrl)
      if (exportRequest.current === controller) exportRequest.current = null
      if (!controller.signal.aborted) setExporting(null)
    }
  }

  return <section className="space-y-5" data-testid="attendance-decision-journal" aria-label={t("journalTitle")} aria-busy={loading}>
    <header className="space-y-2"><h1 id="attendance-decision-journal-title" className="text-2xl font-semibold tracking-tight">{t("journalTitle")}</h1><p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">{t("journalDescription")}</p></header>
    <Card data-testid="attendance-decision-journal-card" aria-labelledby="attendance-decision-journal-title" className="rounded-2xl px-5 py-1">
      <div className="space-y-4 py-4">
        {!accessUnavailable && <><form className="grid items-end gap-4 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1.2fr_auto]" onSubmit={apply} aria-label={t("journalFilters")}>
          <div className="space-y-2"><label htmlFor="attendance-journal-from" className="text-sm font-medium">{t("reportFrom")}</label><Input id="attendance-journal-from" type="date" required className="min-h-11" value={draft.from} disabled={loading} onChange={event => changeDraft({ ...draft, from: event.target.value })} /></div>
          <div className="space-y-2"><label htmlFor="attendance-journal-to" className="text-sm font-medium">{t("reportTo")}</label><Input id="attendance-journal-to" type="date" required className="min-h-11" value={draft.to} disabled={loading} onChange={event => changeDraft({ ...draft, to: event.target.value })} /></div>
          <div className="space-y-2"><label htmlFor="attendance-journal-status" className="text-sm font-medium">{t("journalStatus")}</label><select id="attendance-journal-status" className="min-h-11 w-full rounded-lg border bg-background px-3 text-sm" value={draft.status} disabled={loading} onChange={event => changeDraft({ ...draft, status: event.target.value as AttendanceDecisionJournalQuery["status"] })}>{Object.entries(STATUS).map(([status, key]) => <option key={status} value={status}>{t(key)}</option>)}</select></div>
          <Button type="submit" variant="outline" className="min-h-11" disabled={loading}>{t("journalApply")}</Button>
        </form><p className="text-xs text-muted-foreground">{t("journalPeriodHint")}</p></>}
        {loading && <p role="status" className="text-sm text-muted-foreground">{t("journalLoading")}</p>}
        {error && <div className="space-y-2"><p role="alert" className="text-sm text-destructive">{t(error)}</p>{!accessUnavailable && <Button type="button" variant="outline" className="min-h-11" disabled={loading} onClick={() => void load(lastQuery.current)}>{t("reportReload")}</Button>}</div>}
        {journal && table && <>
          <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm font-semibold">{table.totals[0]}</p><div className="flex flex-wrap gap-2">{(["xlsx", "pdf"] as const).map(format => <Button key={format} type="button" variant="outline" className="min-h-11" disabled={exportDisabled} onClick={() => void download(format)}><Download className="mr-2 h-4 w-4" aria-hidden="true" />{t(exporting === format ? "exportPreparing" : format === "xlsx" ? "exportExcel" : "exportPdf")}</Button>)}</div></div>
          {dirty && <p role="status" className="text-sm text-amber-700 dark:text-amber-300">{t("journalDraftHint")}</p>}
          {downloadReady && <p role="status" className="text-xs text-muted-foreground">{t("exportReady")}</p>}
          <div className="space-y-1 text-xs text-muted-foreground">{table.details.map((detail, index) => <p key={index}>{detail}</p>)}</div>
          {table.rows.length === 0 ? <p className="py-6 text-sm text-muted-foreground">{t("journalEmpty")}</p> : <>
            <div className="overflow-x-auto"><table className="block w-full text-sm md:table" data-testid="attendance-journal-table"><caption className="sr-only">{t("journalTitle")}</caption>
              <thead className="hidden md:table-header-group"><tr>{table.columns.map(column => <th key={column.key} scope="col" className="border-b px-4 py-3 text-left text-xs font-semibold text-muted-foreground">{column.label}</th>)}</tr></thead>
              <tbody className="block md:table-row-group">{visible.map((row, index) => <tr key={row.key} className="block border-b py-4 last:border-0 md:table-row md:py-0" data-testid="attendance-journal-row">
                {row.cells.map((cell, columnIndex) => <td key={table.columns[columnIndex].key} className="grid grid-cols-[5rem_1fr] gap-3 px-1 py-2 align-top md:table-cell md:px-4 md:py-4"><span className="text-xs text-muted-foreground md:hidden">{table.columns[columnIndex].label}</span>{columnIndex === 3 ? <div><HomePill tone={journal.items[page * PAGE_SIZE + index].status === "APPROVED" ? "green" : journal.items[page * PAGE_SIZE + index].status === "PENDING" ? "amber" : "zinc"}>{cell}</HomePill></div> : <span className={`min-w-0 whitespace-pre-line break-words ${columnIndex === 0 ? "font-medium" : ""}`}>{cell}</span>}</td>)}
              </tr>)}</tbody></table></div>
            <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-muted-foreground">{t("journalPage", { page: page + 1, pages: pageCount, count: table.rows.length })}</p><div className="flex gap-2"><Button type="button" variant="outline" className="min-h-11" disabled={page === 0} onClick={() => setPage(value => value - 1)}>{t("journalPrevious")}</Button><Button type="button" variant="outline" className="min-h-11" disabled={page + 1 >= pageCount} onClick={() => setPage(value => value + 1)}>{t("journalNext")}</Button></div></div>
          </>}
        </>}
      </div>
    </Card>
  </section>
}
