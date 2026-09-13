"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { useSession } from "next-auth/react"
import { useLocale, useTranslations } from "next-intl"
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Loader2,
  RefreshCw,
  Upload,
  XCircle,
} from "lucide-react"

import { ConfirmDialog } from "@/components/delete-confirm-dialog"
import { HelpButton } from "@/components/help/help-button"
import { SupportPageShell } from "@/components/support/support-page-shell"
import { Button } from "@/components/ui/button"
import { safeComplaintReturnTo } from "@/lib/complaints/workspace-state"
import { formatFileSize } from "@/lib/format-file-size"

type PreviewRow = {
  row: number
  externalRegistryNumber: number | null
  customerName: string | null
  requestDate: string | null
  brand: string | null
  riskLevel: string | null
  status: string | null
}

type ImportError = { row: number; error: string }
type PreviewResult = {
  dryRun?: boolean
  totalParsed: number
  sourceTotal?: number
  imported?: number
  errors: ImportError[]
  preview?: PreviewRow[]
  mapping?: Array<{ field: string; column: string; index: number }>
  headers?: string[]
  retriedRows?: number[] | null
}

const localeMap: Record<string, string> = { ru: "ru-RU", en: "en-US", az: "az-AZ" }
const MAX_FILE_SIZE = 15 * 1024 * 1024

export default function ImportComplaintsPage() {
  const t = useTranslations("complaints")
  const locale = useLocale()
  const dateLocale = localeMap[locale] || "en-US"
  const router = useRouter()
  const searchParams = useSearchParams()
  const returnTo = safeComplaintReturnTo(searchParams.get("returnTo"))
  const { data: session } = useSession()
  const orgId = session?.user?.organizationId
  const inputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<PreviewResult | null>(null)
  const [result, setResult] = useState<PreviewResult | null>(null)
  const [phase, setPhase] = useState<"idle" | "preview" | "import" | "retry">("idle")
  const [error, setError] = useState("")
  const [dragOver, setDragOver] = useState(false)
  const [pendingNavigation, setPendingNavigation] = useState<string | null>(null)
  const running = phase !== "idle"
  const headers = orgId ? { "x-organization-id": String(orgId) } : {}

  useEffect(() => {
    if (!file || result) return
    const protect = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = "" }
    window.addEventListener("beforeunload", protect)
    return () => window.removeEventListener("beforeunload", protect)
  }, [file, result])

  function navigateSafely(target: string) {
    if (file && !result) {
      setPendingNavigation(target)
      return
    }
    router.push(target)
  }

  function validateFile(candidate: File): string | null {
    if (!/\.xls(?:x|m)$/i.test(candidate.name)) return t("importFileTypeError")
    if (candidate.size <= 0) return t("importEmptyFileError")
    if (candidate.size > MAX_FILE_SIZE) return t("importFileSizeError")
    return null
  }

  async function runPreview(candidate: File) {
    const validation = validateFile(candidate)
    if (validation) {
      setError(validation)
      return
    }
    setFile(candidate)
    setPreview(null)
    setResult(null)
    setError("")
    setPhase("preview")
    try {
      const formData = new FormData()
      formData.append("file", candidate)
      formData.append("dryRun", "true")
      const res = await fetch("/api/v1/complaints/import-xlsx", { method: "POST", headers, body: formData })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.success) throw new Error(res.status === 403 ? t("permissionError") : t("importPreviewError"))
      setPreview(json.data)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t("importPreviewError"))
    } finally { setPhase("idle") }
  }

  async function runImport(retryRows?: number[]) {
    if (!file || running) return
    setError("")
    setPhase(retryRows ? "retry" : "import")
    try {
      const formData = new FormData()
      formData.append("file", file)
      if (retryRows) formData.append("retryRows", JSON.stringify(retryRows))
      const res = await fetch("/api/v1/complaints/import-xlsx", { method: "POST", headers, body: formData })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.success) throw new Error(res.status === 403 ? t("permissionError") : t("importRunError"))
      setResult(json.data)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t("importRunError"))
    } finally { setPhase("idle") }
  }

  function downloadErrors(errors: ImportError[]) {
    const escape = (value: string | number) => `"${String(value).replaceAll('"', '""')}"`
    const csv = `\uFEFF${escape(t("errorRowHeader"))},${escape(t("errorMessageHeader"))}\n${errors.map(item => `${escape(item.row)},${escape(item.error)}`).join("\n")}`
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }))
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = `complaint-import-errors-${new Date().toISOString().slice(0, 10)}.csv`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  function onDrop(event: React.DragEvent) {
    event.preventDefault()
    setDragOver(false)
    const candidate = event.dataTransfer.files?.[0]
    if (candidate) void runPreview(candidate)
  }

  const mappingLabel = (field: string) => ({
    customerName: t("fieldFullName"),
    phone: t("fieldPhone"),
    requestDate: t("fieldDate"),
    source: t("fieldSource"),
    complaintType: t("fieldType"),
    brand: t("fieldBrand"),
    productionArea: t("fieldProductionArea"),
    productCategory: t("fieldProductCategory"),
    complaintObject: t("fieldComplaintObject"),
    complaintObjectDetail: t("fieldComplaintObjectDetail"),
    content: t("fieldContent"),
    responsibleDepartment: t("fieldResponsibleDepartment"),
    riskLevel: t("fieldRiskLevel"),
    status: t("colStatus"),
    response: t("cardResponse", { count: 0 }),
  } as Record<string, string>)[field] || t("unknownMappingField")

  const riskLabel = (value: string | null) => !value
    ? "—"
    : value === "high"
      ? t("riskHigh")
      : value === "medium"
        ? t("riskMedium")
        : value === "low"
          ? t("riskLow")
          : t("unknownRisk")

  const statusLabel = (value: string | null) => !value
    ? "—"
    : value === "open"
      ? t("statusOpen")
      : value === "in_progress"
        ? t("statusInProgress")
        : value === "resolved"
          ? t("statusResolved")
          : value === "closed"
            ? t("statusClosed")
            : value === "escalated"
              ? t("statusEscalated")
              : t("unknownStatus")

  const visibleErrors = result?.errors || preview?.errors || []

  return (
    <SupportPageShell
      data-testid="complaint-import-workspace"
      className="max-w-5xl"
      title={t("importTitle")}
      description={t("importDescription")}
      leading={<Button data-testid="complaint-import-back" variant="ghost" size="icon" className="h-11 w-11 sm:h-9 sm:w-9" aria-label={t("backToRegistry")} onClick={() => navigateSafely(returnTo)}><ArrowLeft className="h-4 w-4" /></Button>}
      utilities={<HelpButton slug="complaints-import" variant="icon" />}
    >

      <ol className="grid grid-cols-3 gap-2 text-xs" aria-label={t("importSteps")}>
        {[t("importStepFile"), t("importStepMap"), t("importStepRun")].map((label, index) => {
          const active = index === 0 || (index === 1 && Boolean(preview)) || (index === 2 && Boolean(result))
          return <li key={label} className={`rounded-md border px-2 py-2 ${active ? "bg-muted/60 font-medium text-foreground" : "text-muted-foreground"}`}>{index + 1}. {label}</li>
        })}
      </ol>

      <section
        data-testid="complaint-import-dropzone"
        onDragOver={event => { event.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className={`rounded-xl border border-dashed p-5 text-center transition-colors motion-reduce:transition-none sm:p-7 ${dragOver ? "border-foreground bg-muted/60" : "border-muted-foreground/30"}`}
        aria-label={t("selectFile")}
      >
        <FileSpreadsheet className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
        <p className="text-sm font-medium">{t("dropHere")}</p>
        <p className="mb-3 text-xs text-muted-foreground">{t("importFileHint")}</p>
        <input data-testid="complaint-import-file" ref={inputRef} id="complaint-import-file" type="file" accept=".xlsx,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="peer sr-only" disabled={running} onChange={event => { const candidate = event.target.files?.[0]; if (candidate) void runPreview(candidate) }} />
        <label htmlFor="complaint-import-file" aria-disabled={running} className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-md border bg-background px-3 text-sm font-medium hover:bg-muted peer-focus-visible:outline-none peer-focus-visible:ring-2 peer-focus-visible:ring-ring/30 aria-disabled:pointer-events-none aria-disabled:opacity-50 sm:min-h-9"><Upload className="h-4 w-4" />{t("selectFile")}</label>
        {file && <p className="mt-2 break-all text-xs text-muted-foreground">{file.name} · {formatFileSize(file.size, locale)}</p>}
      </section>

      {running && <p role="status" className="flex items-center gap-2 rounded-lg border bg-muted/40 p-3 text-sm"><Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" />{phase === "preview" ? t("previewing") : phase === "retry" ? t("retryingRows") : t("processing")}</p>}
      {error && <div data-testid="complaint-import-error" role="alert" className="flex flex-col gap-2 rounded-lg border border-red-200 bg-red-50/60 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/20 dark:text-red-300 sm:flex-row sm:items-center sm:justify-between"><span>{error}</span>{file && <Button data-testid="complaint-import-retry" variant="outline" size="sm" className="h-11 sm:h-9" disabled={running} onClick={() => preview ? void runImport() : void runPreview(file)}><RefreshCw className="h-4 w-4" />{t("retry")}</Button>}</div>}

      {preview && !result && <section data-testid="complaint-import-preview" className="rounded-xl border bg-card">
        <div className="flex flex-col gap-2 border-b p-4 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="font-medium">{t("mappingPreview")}</h2><p className="text-xs text-muted-foreground">{t("parsedRows", { count: preview.totalParsed })} · {t("mappedColumns", { count: preview.mapping?.length || 0 })}</p></div><Button data-testid="complaint-import-run" className="h-11 sm:h-9" disabled={running || preview.totalParsed === 0} onClick={() => void runImport()}>{t("importRecords", { count: preview.totalParsed })}</Button></div>
        <div className="grid gap-4 p-4 lg:grid-cols-[minmax(15rem,0.7fr)_minmax(0,1.3fr)]">
          <div><h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("columnMapping")}</h3><dl className="space-y-1.5">{preview.mapping?.map(item => <div key={item.field} className="grid grid-cols-[minmax(7rem,1fr)_auto_minmax(7rem,1fr)] items-center gap-2 text-xs"><dt className="truncate" title={item.column}>{item.column}</dt><span aria-hidden="true">→</span><dd className="truncate font-medium" title={mappingLabel(item.field)}>{mappingLabel(item.field)}</dd></div>)}</dl></div>
          <div><h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("rowPreview")}</h3><div className="space-y-2 md:hidden">{preview.preview?.map(row => <article key={row.row} className="rounded-md border p-2 text-xs"><p className="font-medium">{t("rowNumber", { row: row.row })} · {row.customerName || "—"}</p><p className="text-muted-foreground">{row.brand || "—"} · {riskLabel(row.riskLevel)} · {statusLabel(row.status)}</p></article>)}</div><div className="hidden overflow-x-auto rounded-md border md:block"><table className="w-full text-xs"><thead className="bg-muted/50"><tr><th className="p-2 text-left">{t("colOrderNumber")}</th><th className="p-2 text-left">{t("colCustomer")}</th><th className="p-2 text-left">{t("colDate")}</th><th className="p-2 text-left">{t("colBrand")}</th><th className="p-2 text-left">{t("colRisk")}</th><th className="p-2 text-left">{t("colStatus")}</th></tr></thead><tbody>{preview.preview?.map(row => <tr key={row.row} className="border-t"><td className="p-2">{row.row}</td><td className="p-2">{row.customerName || "—"}</td><td className="p-2">{row.requestDate ? new Date(row.requestDate).toLocaleDateString(dateLocale) : "—"}</td><td className="p-2">{row.brand || "—"}</td><td className="p-2">{riskLabel(row.riskLevel)}</td><td className="p-2">{statusLabel(row.status)}</td></tr>)}</tbody></table></div>{preview.preview && preview.totalParsed > preview.preview.length && <p className="mt-2 text-xs text-muted-foreground">{t("moreRecords", { count: preview.totalParsed - preview.preview.length, shown: preview.preview.length })}</p>}</div>
        </div>
      </section>}

      {result && <section data-testid="complaint-import-result" className="rounded-xl border bg-card p-4"><div className="flex items-start gap-3">{(result.imported || 0) === result.totalParsed && result.errors.length === 0 ? <CheckCircle2 className="h-7 w-7 shrink-0 text-emerald-600" /> : (result.imported || 0) > 0 ? <AlertTriangle className="h-7 w-7 shrink-0 text-amber-600" /> : <XCircle className="h-7 w-7 shrink-0 text-red-600" />}<div><h2 className="font-medium">{result.errors.length > 0 && (result.imported || 0) > 0 ? t("importPartial") : t("importDone")}</h2><p className="text-sm text-muted-foreground">{t("importSummary", { imported: result.imported ?? 0, total: result.totalParsed })} · {t("errorsCount", { count: result.errors.length })}</p></div></div><div className="mt-4 flex flex-wrap gap-2"><Button data-testid="complaint-import-open-registry" className="h-11 sm:h-9" onClick={() => router.push(returnTo)}>{t("openRegistry")}</Button>{result.errors.length > 0 && <Button data-testid="complaint-import-retry-rows" variant="outline" className="h-11 sm:h-9" disabled={running} onClick={() => void runImport(result.errors.map(item => item.row))}><RefreshCw className="h-4 w-4" />{t("retryFailedRows", { count: result.errors.length })}</Button>}<Button data-testid="complaint-import-download-errors" variant="outline" className="h-11 sm:h-9" onClick={() => downloadErrors(result.errors)} disabled={result.errors.length === 0}><Download className="h-4 w-4" />{t("downloadErrors")}</Button><Button variant="ghost" className="h-11 sm:h-9" onClick={() => { setResult(null); setPreview(null); setFile(null); setError(""); if (inputRef.current) inputRef.current.value = "" }}>{t("importMore")}</Button></div></section>}

      {visibleErrors.length > 0 && <section className="rounded-xl border border-red-200 bg-red-50/50 p-4 dark:border-red-900 dark:bg-red-950/20"><div className="mb-2 flex flex-wrap items-center justify-between gap-2"><h2 className="text-sm font-medium text-red-800 dark:text-red-300">{t("rowErrors", { count: visibleErrors.length })}</h2><Button variant="outline" size="sm" className="h-11 sm:h-9" onClick={() => downloadErrors(visibleErrors)}><Download className="h-4 w-4" />{t("downloadErrors")}</Button></div><ol className="max-h-64 space-y-1 overflow-y-auto text-xs text-red-800 dark:text-red-300">{visibleErrors.slice(0, 100).map(item => <li key={`${item.row}-${item.error}`}>{t("rowError", { row: item.row, error: item.error })}</li>)}</ol>{visibleErrors.length > 100 && <p className="mt-2 text-xs text-muted-foreground">{t("moreErrors", { count: visibleErrors.length - 100 })}</p>}</section>}

      <ConfirmDialog open={Boolean(pendingNavigation)} onOpenChange={open => { if (!open) setPendingNavigation(null) }} title={t("leaveImportTitle")} description={t("leaveImportHint")} confirmLabel={t("leaveImport")} confirmVariant="default" onConfirm={async () => { const target = pendingNavigation; if (!target) return; setPendingNavigation(null); router.push(target) }} />
    </SupportPageShell>
  )
}
