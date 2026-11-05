"use client"

import { useRef, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { Download, FileSpreadsheet, Upload, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { MtmWord } from "@/components/mtm/button-word"
import type { AttendanceImportPreview, AttendanceImportResult, AttendanceImportRow } from "@/lib/mtm/attendance-employee-import-contract"

const ENDPOINT = "/api/v1/mtm/attendance/employees/import"
/** Rows one write request carries — the server's own limit. */
const CHUNK = 25
/** Rows a tab draws; the rest are counted, and the error rows are in the downloadable file. */
const SHOWN = 100
type Tab = "NEW" | "UPDATE" | "ERROR"
/** Write failures the screen can name; anything else is «не удалось записать». */
const FAILURES = new Set(["MTM_ATTENDANCE_EMPLOYEE_PHONE_TAKEN", "IDENTITY_CANONICAL_PHONE_RESERVED", "MTM_ATTENDANCE_EMPLOYEE_USER_LIMIT",
  "MTM_ATTENDANCE_EMPLOYEE_SECTION_ELSEWHERE", "MTM_ATTENDANCE_EMPLOYEE_MANAGER_INVALID", "MTM_ATTENDANCE_BRANCH_CHANGED", "MTM_ATTENDANCE_BRANCH_UNAVAILABLE"])
type Written = { created: number; updated: number; unchanged: number; missed: Array<AttendanceImportResult & { name: string }>; interrupted: { done: number; total: number } | null }

const downloadBlob = (blob: Blob, name: string) => {
  const url = URL.createObjectURL(blob), link = document.createElement("a")
  link.href = url; link.download = name; document.body.append(link); link.click(); link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/**
 * Personnel → Employees → «Загрузить сотрудников» (owner, 2026-11-05: Zeytun's
 * thousand people; mockup approved with «Давай»). The file is checked first
 * and nothing is written until HR presses «Загрузить N»; then the rows go in
 * chunks with a progress line, so a thousand people do not hang on one request.
 */
export function MtmAttendanceEmployeeImport({ disabled, onLoaded }: { disabled: boolean; onLoaded: () => void }) {
  const p = useTranslations("personnel"), locale = useLocale()
  const lang = locale === "ru" || locale === "en" ? locale : "az"
  const [open, setOpen] = useState(false), [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<AttendanceImportPreview | null>(null), [tab, setTab] = useState<Tab>("NEW")
  const [busy, setBusy] = useState<"checking" | "writing" | "errors" | null>(null), [progress, setProgress] = useState({ done: 0, total: 0 })
  const [written, setWritten] = useState<Written | null>(null), [error, setError] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)

  function reset() { setFile(null); setPreview(null); setWritten(null); setError(null); setProgress({ done: 0, total: 0 }); if (input.current) input.current.value = "" }
  function close() { reset(); setOpen(false) }
  const form = (action: string, extra: Record<string, string> = {}) => {
    const body = new FormData(); body.set("file", file!); body.set("action", action)
    for (const [key, value] of Object.entries(extra)) body.set(key, value)
    return body
  }

  async function check(chosen: File) {
    setFile(chosen); setPreview(null); setWritten(null); setError(null); setBusy("checking")
    try {
      const body = new FormData(); body.set("file", chosen); body.set("action", "preview")
      const response = await fetch(ENDPOINT, { method: "POST", body })
      const json = await response.json().catch(() => null)
      if (!response.ok || json?.success !== true) { setError(response.status === 413 ? "importTooLarge" : response.status === 415 ? "importNotXlsx" : "importRequestError"); return }
      const next = json.data as AttendanceImportPreview
      setPreview(next); setTab(next.summary.new ? "NEW" : next.summary.update ? "UPDATE" : "ERROR")
    } catch { setError("importRequestError") }
    finally { setBusy(null) }
  }

  async function write() {
    if (!preview || !file) return
    const rows = preview.rows.filter(row => row.status === "NEW" || row.status === "UPDATE")
    const names = new Map(preview.rows.map(row => [row.row, row.name]))
    const result: Written = { created: 0, updated: 0, unchanged: 0, missed: [], interrupted: null }
    setBusy("writing"); setProgress({ done: 0, total: rows.length }); setError(null)
    for (let start = 0; start < rows.length; start += CHUNK) {
      const chunk = rows.slice(start, start + CHUNK).map(row => ({ row: row.row, key: row.key }))
      try {
        const response = await fetch(ENDPOINT, { method: "POST", body: form("apply", { rows: JSON.stringify(chunk) }) })
        const json = await response.json().catch(() => null)
        if (!response.ok || json?.success !== true || !Array.isArray(json.data?.results)) throw new Error("write")
        for (const item of json.data.results as AttendanceImportResult[]) {
          if (item.outcome === "CREATED") result.created += 1
          else if (item.outcome === "UPDATED") result.updated += 1
          else if (item.outcome === "UNCHANGED") result.unchanged += 1
          else result.missed.push({ ...item, name: names.get(item.row) ?? "" })
        }
      } catch {
        result.interrupted = { done: start, total: rows.length }
        break
      }
      setProgress({ done: Math.min(start + CHUNK, rows.length), total: rows.length })
    }
    setWritten(result); setBusy(null); onLoaded()
  }

  async function downloadErrors() {
    if (!file) return
    setBusy("errors")
    try {
      const response = await fetch(ENDPOINT, { method: "POST", body: form("errors", { locale: lang }) })
      if (!response.ok) { setError("importRequestError"); return }
      downloadBlob(await response.blob(), "employees-errors.xlsx")
    } catch { setError("importRequestError") }
    finally { setBusy(null) }
  }

  function reason(row: AttendanceImportRow) {
    return row.errors.map(item => p(`importError_${item.code}`, { row: item.otherRow ?? "" })).join("; ")
  }
  function changes(row: AttendanceImportRow) {
    const parts = row.changes.map(change => p("importChange", { field: p(`importField_${change.field}`), from: change.from ?? "—", to: change.to }))
    return [...parts, ...row.warnings.map(code => p(`importWarning_${code}`))].join(" · ")
  }

  if (!open) return <Button type="button" variant="outline" className="min-h-11 rounded-full" disabled={disabled} onClick={() => setOpen(true)} data-testid="attendance-import-open">
    <Upload className="mr-2 h-4 w-4" aria-hidden="true" />{p("importOpen")}</Button>

  const summary = preview?.summary, toWrite = (summary?.new ?? 0) + (summary?.update ?? 0)
  const shown = preview ? preview.rows.filter(row => row.status === tab) : []
  return <section className="w-full space-y-4 rounded-2xl border bg-card p-5" aria-label={p("importTitle")} data-testid="attendance-import">
    <div className="flex items-start justify-between gap-3"><div><h2 className="text-base font-semibold">{p("importTitle")}</h2>
      <p className="mt-1 max-w-prose text-sm text-muted-foreground">{p("importHint")}</p></div>
      <Button type="button" variant="ghost" size="sm" className="h-9 gap-1.5" aria-label={p("close")} disabled={busy === "writing"} onClick={close}><X className="h-4 w-4" aria-hidden="true" /><MtmWord word="close" /></Button></div>

    {!preview && !written && <div className="space-y-3 rounded-xl border p-4" data-testid="attendance-import-excel">
      <h3 className="flex items-center gap-2 font-medium"><FileSpreadsheet className="h-4 w-4" aria-hidden="true" />{p("importExcelTitle")}</h3>
      <p className="max-w-prose text-sm text-muted-foreground">{p("importExcelHint")}</p>
      <div className="flex flex-wrap gap-2">
        <Button asChild variant="outline" className="min-h-11"><a href={`${ENDPOINT}?file=template&locale=${lang}`} download data-testid="attendance-import-template"><Download className="mr-2 h-4 w-4" aria-hidden="true" />{p("importTemplate")}</a></Button>
        <Button asChild variant="outline" className="min-h-11"><a href={`${ENDPOINT}?file=current&locale=${lang}`} download data-testid="attendance-import-current"><Download className="mr-2 h-4 w-4" aria-hidden="true" />{p("importCurrent")}</a></Button>
      </div>
      <label className="block cursor-pointer rounded-xl border-2 border-dashed p-5 text-center text-sm text-muted-foreground">
        <span className="font-medium text-primary">{p("importChoose")}</span><span className="block text-xs">{p("importChooseHint")}</span>
        <input ref={input} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="sr-only" disabled={busy !== null}
          onChange={event => { const chosen = event.target.files?.[0]; if (chosen) void check(chosen) }} data-testid="attendance-import-file" /></label>
      <p className="max-w-prose rounded-xl border border-l-4 border-border border-l-amber-500 p-3 text-sm">{p("importColumnsNote")}</p>
      {busy === "checking" && <p role="status" className="text-sm text-muted-foreground">{p("importChecking")}</p>}
    </div>}

    {preview && preview.fileErrors.length > 0 && <div role="alert" className="space-y-2 text-sm text-destructive" data-testid="attendance-import-file-errors">
      {preview.fileErrors.map(item => <p key={`${item.code}:${item.column ?? ""}`}>{p(`importFileError_${item.code}`, { column: item.column ? p(`importColumn_${item.column}`) : "" })}</p>)}
      <Button type="button" variant="outline" onClick={reset}>{p("importAnotherFile")}</Button></div>}

    {preview && summary && !preview.fileErrors.length && !written && <div className="space-y-4" data-testid="attendance-import-preview">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-medium">{p("importCheckTitle", { file: preview.fileName })}</h3>
        <p className="text-sm text-muted-foreground">{p("importCheckSub", { count: summary.total })}</p></div>
        <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" className="min-h-11" disabled={busy !== null} onClick={reset}>{p("importAnotherFile")}</Button>
          <Button type="button" className="min-h-11" disabled={busy !== null || toWrite === 0} onClick={() => void write()} data-testid="attendance-import-apply">{p("importApply", { count: toWrite })}</Button></div></div>
      <div className="grid gap-3 sm:grid-cols-4">
        {([["NEW", summary.new, "text-emerald-700 dark:text-emerald-400"], ["UPDATE", summary.update, "text-amber-700 dark:text-amber-400"], ["UNCHANGED", summary.unchanged, ""], ["ERROR", summary.error, "text-destructive"]] as const).map(([status, count, tone]) =>
          <div key={status} className="rounded-xl border p-3" data-testid={`attendance-import-tile-${status}`}><span className="text-xs text-muted-foreground">{p(`importTile_${status}`)}</span>
            <strong className={`block text-2xl ${tone}`}>{count}</strong></div>)}
      </div>
      {busy === "writing" && <div role="status" className="space-y-1" data-testid="attendance-import-progress"><p className="text-sm">{p("importWriting", progress)}</p>
        <div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary transition-all" style={{ width: `${progress.total ? (100 * progress.done) / progress.total : 0}%` }} /></div></div>}
      {toWrite === 0 && <p className="text-sm text-muted-foreground">{p("importNothing")}</p>}
      <div className="flex flex-wrap items-center gap-2 border-b" role="tablist">
        {(["NEW", "UPDATE", "ERROR"] as const).map(status => <button key={status} type="button" role="tab" aria-selected={tab === status}
          className={`min-h-11 px-2 text-sm ${tab === status ? "border-b-2 border-primary font-semibold" : "text-muted-foreground"}`} onClick={() => setTab(status)}
          data-testid={`attendance-import-tab-${status}`}>{p(`importTab_${status}`, { count: preview.rows.filter(row => row.status === status).length })}</button>)}
        {summary.error > 0 && <Button type="button" variant="link" className="ml-auto" disabled={busy !== null} onClick={() => void downloadErrors()} data-testid="attendance-import-errors-file">{p("importDownloadErrors")}</Button>}
      </div>
      {shown.length ? <div className="overflow-x-auto"><table className="w-full text-left text-sm">
        <thead><tr className="border-b text-xs text-muted-foreground"><th className="w-16 px-2 py-2 font-medium">{p("importColRow")}</th><th className="px-2 py-2 font-medium">{p("importColName")}</th>
          <th className="px-2 py-2 font-medium">{p("importColPhone")}</th><th className="px-2 py-2 font-medium">{p(tab === "ERROR" ? "importColWrong" : "importColWhat")}</th></tr></thead>
        <tbody>{shown.slice(0, SHOWN).map(row => <tr key={row.row} className="border-b last:border-0" data-testid="attendance-import-row">
          <td className="px-2 py-2 text-muted-foreground">{row.row}</td><td className="px-2 py-2">{row.name || "—"}</td><td className="px-2 py-2 tabular-nums">{row.phone ?? "—"}</td>
          <td className={`px-2 py-2 ${tab === "ERROR" ? "font-medium text-destructive" : "text-muted-foreground"}`}>{tab === "ERROR" ? reason(row) : tab === "UPDATE" ? changes(row) : row.warnings.length ? changes(row) : p("importWillAdd")}</td></tr>)}</tbody></table>
        {shown.length > SHOWN && <p className="mt-2 text-xs text-muted-foreground">{p("importMoreRows", { count: shown.length - SHOWN })}</p>}</div>
        : <p className="text-sm text-muted-foreground">{p("importTabEmpty")}</p>}
      <p className="max-w-prose text-xs text-muted-foreground">{p("importKeepNote")}</p>
    </div>}

    {written && <div className="space-y-3" role="status" data-testid="attendance-import-result">
      <p className="rounded-xl border border-l-4 border-border border-l-emerald-500 p-3 text-sm">{p("importDone", { created: written.created, updated: written.updated })}</p>
      {written.interrupted && <p role="alert" className="text-sm text-destructive">{p("importInterrupted", written.interrupted)}</p>}
      {written.missed.length > 0 && <div className="space-y-1 text-sm"><p className="font-medium">{p("importMissed", { count: written.missed.length })}</p>
        <ul className="list-disc space-y-1 pl-5">{written.missed.slice(0, SHOWN).map(item => <li key={item.row}>{p("importMissedRow", { row: item.row, name: item.name || "—" })}{" "}
          {item.outcome === "CHANGED" ? p("importOutcomeChanged") : FAILURES.has(item.code ?? "") ? p(`importFailure_${item.code}`) : p("importFailureOther")}</li>)}</ul></div>}
      <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" className="min-h-11" onClick={reset}>{p("importAnotherFile")}</Button>
        <Button type="button" className="min-h-11" onClick={close}>{p("importFinish")}</Button></div>
    </div>}

    {error && <p role="alert" className="text-sm text-destructive">{p(error)}</p>}
  </section>
}
