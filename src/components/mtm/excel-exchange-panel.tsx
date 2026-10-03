"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { useLocale, useTranslations } from "next-intl"
import { toast } from "sonner"
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, Loader2, Upload } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Select } from "@/components/ui/select"
import { mtmStatusLabel } from "@/lib/mtm/status-labels"
import { formatDate } from "@/lib/format-date"

export type MtmExcelPanelImportType = "CUSTOMERS" | "CONTACTS" | "ROUTES" | "SALES_FACTS" | "PLAN_FACT"
type ImportType = MtmExcelPanelImportType
type ExportType = "CUSTOMERS" | "ROUTES" | "SALES_FACTS" | "PLAN_FACT" | "VISIT_RESULTS" | "CUSTOMER_REQUESTS"

interface ImportSummary {
  totalRows: number
  createRows: number
  updateRows: number
  unchangedRows: number
  skippedRows: number
  errorRows: number
  warningRows: number
  requiresConflictOverride: boolean
  createInstitutions?: number
  assignRows?: number
}

interface ImportWarning {
  rowNumber: number
  code: string
  message: string
}

interface ImportResult {
  job: { id: string; status: string; originalFileName: string }
  summary: ImportSummary
  preview: Array<Record<string, unknown>>
  errors: Array<{ rowNumber: number; columnName: string | null; errorCode: string; message: string }>
  warnings?: ImportWarning[]
  warningCount?: number
}

interface HistoryJob {
  id: string
  type: ImportType
  status: string
  originalFileName: string
  totalRows: number
  createRows: number
  updateRows: number
  errorRows: number
  createdAt: string
}

interface Props {
  open: boolean
  onClose: () => void
  orgId?: string
  onApplied?: () => void
  /** The type the dialog opens on; the page it is opened from knows what the person came to load. */
  initialType?: ImportType
}

const IMPORT_TYPES: ImportType[] = ["CUSTOMERS", "CONTACTS", "ROUTES", "SALES_FACTS", "PLAN_FACT"]
const WARNINGS_SHOWN = 8
const EXPORT_TYPES: ExportType[] = ["CUSTOMERS", "ROUTES", "SALES_FACTS", "VISIT_RESULTS", "PLAN_FACT", "CUSTOMER_REQUESTS"]

export function MtmExcelExchangePanel({ open, onClose, orgId, onApplied, initialType = "CUSTOMERS" }: Props) {
  const t = useTranslations("mtmExcel")
  const statusT = useTranslations("mtmStatus")
  const locale = useLocale()
  const fileRef = useRef<HTMLInputElement>(null)
  const [type, setType] = useState<ImportType>(initialType)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [history, setHistory] = useState<HistoryJob[]>([])
  const [importableTypes, setImportableTypes] = useState<string[]>([])
  const [uploading, setUploading] = useState(false)
  const [applying, setApplying] = useState(false)
  const [allowConflicts, setAllowConflicts] = useState(false)

  const headers = useMemo(() => orgId ? { "x-organization-id": orgId } : undefined, [orgId])
  const loadHistory = useCallback(async () => {
    const response = await fetch("/api/v1/mtm/excel/imports", { headers })
    const payload = await response.json()
    if (!response.ok) throw new Error(payload.error || t("historyFailed"))
    setHistory(payload.data.jobs ?? [])
    // Who may load a file depends on what the file is: a manager who may add
    // clients by hand may load them, without the opt-in the other types need.
    const capabilities = payload.data.capabilities
    setImportableTypes(Array.isArray(capabilities?.importableTypes)
      ? capabilities.importableTypes
      : capabilities?.canImport === true ? IMPORT_TYPES : [])
  }, [headers, t])

  useEffect(() => {
    if (!open) return
    void loadHistory().catch((error) => toast.error(error instanceof Error ? error.message : t("historyFailed")))
  }, [open, loadHistory, t])

  useEffect(() => {
    setResult(null)
    setAllowConflicts(false)
    if (fileRef.current) fileRef.current.value = ""
  }, [type])

  async function upload(file: File) {
    setUploading(true)
    setResult(null)
    try {
      const form = new FormData()
      form.append("type", type)
      form.append("locale", locale)
      form.append("file", file)
      const response = await fetch("/api/v1/mtm/excel/imports", { method: "POST", headers, body: form })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || t("validationFailed"))
      if (payload.data.reused) {
        const detailResponse = await fetch(`/api/v1/mtm/excel/imports/${payload.data.job.id}`, { headers })
        const detail = await detailResponse.json()
        if (!detailResponse.ok) throw new Error(detail.error || t("validationFailed"))
        setResult({
          job: detail.data.job,
          summary: detail.data.job.validationSummary,
          preview: detail.data.job.previewData ?? [],
          errors: detail.data.job.rowErrors ?? [],
          warnings: detail.data.warnings ?? [],
          warningCount: detail.data.warningCount ?? 0,
        })
        toast.info(t("sameFile"))
      } else {
        setResult(payload.data)
      }
      await loadHistory()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("validationFailed"))
    } finally {
      setUploading(false)
    }
  }

  async function applyImport() {
    if (!result) return
    setApplying(true)
    try {
      const response = await fetch(`/api/v1/mtm/excel/imports/${result.job.id}/apply`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(headers ?? {}) },
        body: JSON.stringify({ allowConflictOverride: allowConflicts }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || t("applyFailed"))
      toast.success(payload.data.queued ? t("queued") : t("applied"))
      await loadHistory()
      onApplied?.()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("applyFailed"))
    } finally {
      setApplying(false)
    }
  }

  function download(url: string, filename: string) {
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = filename
    anchor.click()
  }

  const summary = result?.summary
  const canImport = importableTypes.includes(type)
  const canApply = Boolean(summary && summary.errorRows === 0 && canImport)
  // Shown for client files only: their warnings are written for the person
  // fixing the spreadsheet. The other types' warnings are still internal text.
  const warnings = type === "CONTACTS" ? result?.warnings ?? [] : []
  const warningCount = type === "CONTACTS" ? result?.warningCount ?? warnings.length : 0
  const previewKeys = result && result.preview.length > 0 ? Object.keys(result.preview[0]).slice(0, 6) : []
  const previewLabel = (key: string) => t.has(`previewColumns.${key}`) ? t(`previewColumns.${key}`) : key

  if (typeof document === "undefined") return null

  return createPortal(
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2"><FileSpreadsheet className="h-5 w-5" />{t("title")}</DialogTitle>
      </DialogHeader>
      <DialogContent className="max-w-5xl overflow-y-auto">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.45fr)_minmax(260px,0.75fr)]">
          <div className="min-w-0 space-y-5">
            <section className="space-y-3">
              <div className="flex items-center gap-2 text-sm font-semibold"><span className="grid h-6 w-6 place-items-center rounded-full bg-foreground text-xs text-background">1</span>{t("chooseType")}</div>
              <Select value={type} onChange={(event) => setType(event.target.value as ImportType)} aria-label={t("chooseType")}>
                {IMPORT_TYPES.map((item) => <option key={item} value={item}>{t(`types.${item}`)}</option>)}
              </Select>
            </section>

            <section className="space-y-3 border-t pt-5">
              <div className="flex items-center gap-2 text-sm font-semibold"><span className="grid h-6 w-6 place-items-center rounded-full bg-foreground text-xs text-background">2</span>{t("templateOrUpload")}</div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" onClick={() => download(`/api/v1/mtm/excel/templates/${type.toLowerCase()}?locale=${locale}`, `mtm-${type.toLowerCase()}-template.xlsx`)}>
                  <Download className="mr-2 h-4 w-4" />{t("downloadTemplate")}
                </Button>
                <input ref={fileRef} type="file" className="hidden" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file) }} />
                <Button type="button" onClick={() => fileRef.current?.click()} disabled={!canImport || uploading}>
                  {uploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}{uploading ? t("validating") : t("selectFile")}
                </Button>
              </div>
              {!canImport ? <p className="text-sm text-muted-foreground">{t("importRestricted")}</p> : null}
            </section>

            <section className="space-y-3 border-t pt-5">
              <div className="flex items-center gap-2 text-sm font-semibold"><span className="grid h-6 w-6 place-items-center rounded-full bg-foreground text-xs text-background">3</span>{t("previewAndValidate")}</div>
              {!result ? <div className="border border-dashed p-6 text-center text-sm text-muted-foreground">{t("previewEmpty")}</div> : (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-px overflow-hidden border bg-border sm:grid-cols-4">
                    {(["createRows", "updateRows", "unchangedRows", "errorRows"] as const).map((key) => (
                      <div key={key} className="bg-background p-3"><div className="text-xs text-muted-foreground">{t(key)}</div><div className="mt-1 text-xl font-semibold tabular-nums">{summary?.[key] ?? 0}</div></div>
                    ))}
                  </div>
                  {result.errors.length > 0 ? (
                    <div className="border border-red-200 bg-red-50/60 p-3 dark:border-red-900 dark:bg-red-950/20">
                      <div className="mb-2 flex items-center gap-2 text-sm font-medium text-red-700 dark:text-red-300"><AlertTriangle className="h-4 w-4" />{t("fixErrors")}</div>
                      <div className="space-y-1 text-xs">
                        {result.errors.slice(0, 5).map((error, index) => <p key={`${error.rowNumber}-${error.columnName}-${index}`}>{t("errorAt", { row: error.rowNumber, column: error.columnName || "-", message: error.message })}</p>)}
                      </div>
                      <Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => download(`/api/v1/mtm/excel/imports/${result.job.id}/errors?locale=${locale}`, `mtm-import-errors.xlsx`)}><Download className="mr-2 h-4 w-4" />{t("downloadErrors")}</Button>
                    </div>
                  ) : <div className="flex items-center gap-2 text-sm text-emerald-700"><CheckCircle2 className="h-4 w-4" />{t("validationPassed")}</div>}
                  {warnings.length > 0 ? (
                    <div data-testid="mtm-excel-warnings" className="border border-amber-300 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/20">
                      <div className="mb-2 flex items-center gap-2 text-sm font-medium text-amber-800 dark:text-amber-200"><AlertTriangle className="h-4 w-4" />{t("warningsTitle", { count: warningCount })}</div>
                      <div className="space-y-1 text-xs">
                        {warnings.slice(0, WARNINGS_SHOWN).map((warning, index) => <p key={`${warning.rowNumber}-${warning.code}-${index}`}>{t("warningAt", { row: warning.rowNumber, message: warning.message })}</p>)}
                        {warningCount > WARNINGS_SHOWN ? <p className="text-muted-foreground">{t("moreWarnings", { count: warningCount - WARNINGS_SHOWN })}</p> : null}
                      </div>
                    </div>
                  ) : null}
                  {summary && (summary.createInstitutions || summary.assignRows) ? (
                    <p data-testid="mtm-excel-contacts-extras" className="text-sm text-muted-foreground">
                      {t("contactsExtras", { institutions: summary.createInstitutions ?? 0, assigned: summary.assignRows ?? 0 })}
                    </p>
                  ) : null}
                  {result.preview.length > 0 ? (
                    <div className="overflow-x-auto border">
                      <table className="w-full min-w-[640px] text-left text-xs">
                        <thead className="bg-muted"><tr>{previewKeys.map((key) => <th key={key} className="px-3 py-2 font-medium">{previewLabel(key)}</th>)}</tr></thead>
                        <tbody>{result.preview.slice(0, 5).map((row, index) => <tr key={index} className="border-t">{previewKeys.map((key) => <td key={key} className="max-w-48 truncate px-3 py-2">{String(row[key] ?? "")}</td>)}</tr>)}</tbody>
                      </table>
                    </div>
                  ) : null}
                </div>
              )}
            </section>

            <section className="space-y-3 border-t pt-5">
              <div className="flex items-center gap-2 text-sm font-semibold"><span className="grid h-6 w-6 place-items-center rounded-full bg-foreground text-xs text-background">4</span>{t("applyAndReview")}</div>
              {summary?.requiresConflictOverride ? (
                <label className="flex items-start gap-2 border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-900 dark:bg-amber-950/20">
                  <input type="checkbox" className="mt-0.5 h-4 w-4 accent-foreground" checked={allowConflicts} onChange={(event) => setAllowConflicts(event.target.checked)} />
                  <span>{t("confirmConflictOverride")}</span>
                </label>
              ) : null}
              <Button type="button" onClick={() => void applyImport()} disabled={!canApply || applying || Boolean(summary?.requiresConflictOverride && !allowConflicts)}>
                {applying ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                {summary ? t("applyChanges", { creates: summary.createRows, updates: summary.updateRows }) : t("apply")}
              </Button>
            </section>
          </div>

          <aside className="min-w-0 space-y-5 border-t pt-5 lg:border-l lg:border-t-0 lg:pl-5 lg:pt-0">
            <section className="space-y-3">
              <h3 className="text-sm font-semibold">{t("exports")}</h3>
              <div className="grid gap-2">
                {EXPORT_TYPES.map((item) => <Button key={item} type="button" variant="outline" className="justify-start" onClick={() => download(`/api/v1/mtm/excel/exports/${item.toLowerCase()}`, `mtm-${item.toLowerCase()}.xlsx`)}><Download className="mr-2 h-4 w-4" />{t(`types.${item}`)}</Button>)}
              </div>
            </section>
            <section className="space-y-3 border-t pt-5">
              <h3 className="text-sm font-semibold">{t("history")}</h3>
              <div className="divide-y border">
                {history.length === 0 ? <p className="p-3 text-sm text-muted-foreground">{t("historyEmpty")}</p> : history.slice(0, 10).map((job) => (
                  <div key={job.id} className="p-3 text-xs">
                    <div className="flex items-center justify-between gap-2"><span className="truncate font-medium">{job.originalFileName}</span><span className="shrink-0 text-muted-foreground">{mtmStatusLabel(statusT, "importJob", job.status)}</span></div>
                    <div className="mt-1 text-muted-foreground">{t(`types.${job.type}`)} · {job.totalRows} · {formatDate(new Date(job.createdAt), locale)}</div>
                  </div>
                ))}
              </div>
            </section>
          </aside>
        </div>
      </DialogContent>
      <DialogFooter><Button type="button" variant="outline" onClick={onClose}>{t("close")}</Button></DialogFooter>
    </Dialog>,
    document.body,
  )
}
