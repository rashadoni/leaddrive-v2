"use client"

import { useEffect, useRef, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { Download } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { AttendanceReportSnapshot } from "@/lib/mtm/attendance-query"
import type { AttendanceViewConfig } from "@/lib/mtm/attendance-view-contract"

type Format = "xlsx" | "pdf"
export interface MtmAttendanceExportButtonsProps {
  config: AttendanceViewConfig | null
  snapshot: AttendanceReportSnapshot | null
  onRefresh: () => void
  onAccessLost: () => void
}

/** Downloads bind the visible configuration to the exact server report snapshot. */
export function MtmAttendanceExportButtons({ config, snapshot, onRefresh, onAccessLost }: MtmAttendanceExportButtonsProps) {
  const t = useTranslations("mtmAttendance")
  const locale = useLocale()
  const [exporting, setExporting] = useState<Format | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [mustRefresh, setMustRefresh] = useState(false)
  const [ready, setReady] = useState(false)
  const request = useRef<AbortController | null>(null)

  useEffect(() => {
    request.current?.abort()
    request.current = null
    setExporting(null)
    setReady(false)
    return () => request.current?.abort()
  }, [config, snapshot])
  useEffect(() => { setError(null); setMustRefresh(false) }, [snapshot])

  async function download(format: Format) {
    if (!config || !snapshot || request.current || exporting || mustRefresh) return
    const controller = new AbortController()
    request.current = controller
    setExporting(format)
    setError(null)
    setReady(false)
    let objectUrl: string | null = null
    let link: HTMLAnchorElement | null = null
    try {
      const response = await fetch("/api/v1/mtm/attendance/export", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ config, format, locale, snapshot }), signal: controller.signal })
      if (controller.signal.aborted) return
      if (!response.ok) {
        const body = await response.json().catch(() => null)
        if (controller.signal.aborted) return
        if ([401, 403, 404].includes(response.status)) { onAccessLost(); return }
        if (response.status === 409 && body?.code === "MTM_ATTENDANCE_EXPORT_CHANGED") {
          setError(t("exportChanged"))
          setMustRefresh(true)
        } else setError(t(body?.code === "MTM_ATTENDANCE_EXPORT_TOO_LARGE" ? "exportTooLarge" : "exportFailed"))
        return
      }
      const expectedType = format === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      if (!response.headers.get("content-type")?.includes(expectedType)) { setError(t("exportFailed")); return }
      const blob = await response.blob()
      if (controller.signal.aborted) return
      if (!blob.size) { setError(t("exportFailed")); return }
      objectUrl = URL.createObjectURL(blob)
      link = document.createElement("a")
      link.href = objectUrl
      link.download = `attendance-${config.filters.from}-${config.filters.to}.${format}`
      link.hidden = true
      document.body.append(link)
      link.click()
      setReady(true)
    } catch {
      if (!controller.signal.aborted) setError(t("exportFailed"))
    } finally {
      link?.remove()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
      if (request.current === controller) request.current = null
      if (!controller.signal.aborted) setExporting(null)
    }
  }

  const disabled = !config || !snapshot || Boolean(exporting) || mustRefresh
  return <div className="space-y-3" data-testid="attendance-export">
    <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" className="min-h-11 rounded-full" disabled={disabled} onClick={() => void download("xlsx")}>
      <Download className="mr-2 h-4 w-4" aria-hidden="true" />{t(exporting === "xlsx" ? "exportPreparing" : "exportExcel")}</Button>
      <Button type="button" variant="outline" className="min-h-11 rounded-full" disabled={disabled} onClick={() => void download("pdf")}>
        <Download className="mr-2 h-4 w-4" aria-hidden="true" />{t(exporting === "pdf" ? "exportPreparing" : "exportPdf")}</Button></div>
    {error ? <div className="space-y-2"><p role="alert" className="text-sm text-destructive">{error}</p>{mustRefresh ? <Button type="button" variant="outline" className="min-h-11" onClick={onRefresh}>{t("reportReload")}</Button> : null}</div> : null}
    {ready ? <p role="status" className="text-xs text-muted-foreground">{t("exportReady")}</p> : null}
  </div>
}
