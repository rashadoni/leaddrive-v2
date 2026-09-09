"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { Download, FileText, RefreshCw, Trash2, Upload, WifiOff } from "lucide-react"

import { type MtmTaskDocument } from "@/components/mtm/task-workspace"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { formatInTimezone } from "@/lib/timezone"
import {
  enqueueTaskDocument,
  listTaskDocuments,
  markTaskDocumentFailed,
  markTaskDocumentUploading,
  removeQueuedTaskDocument,
  retryTaskDocumentNow,
  taskDocumentsReadyForUpload,
  updateQueuedTaskDocument,
  type QueuedTaskDocument,
} from "@/lib/mtm/task-document-outbox"

const MAX_FILE_BYTES = 25 * 1024 * 1024
const SAFE_FILE_TYPES: Record<string, readonly string[]> = {
  "application/pdf": [".pdf"],
  "application/msword": [".doc"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
  "application/vnd.ms-excel": [".xls"],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
  "application/vnd.ms-powerpoint": [".ppt"],
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": [".pptx"],
  "text/plain": [".txt"],
  "text/csv": [".csv"],
  "image/jpeg": [".jpg", ".jpeg"],
  "image/png": [".png"],
  "image/webp": [".webp"],
  "application/zip": [".zip"],
}

function formatBytes(value?: number | null): string {
  if (!value || value < 1) return "—"
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

export function MtmTaskFilesPanel({
  taskId,
  documents,
  timezone,
  canUpload,
  onChanged,
}: {
  taskId: string
  documents: MtmTaskDocument[]
  timezone: string
  canUpload: boolean
  onChanged: () => Promise<void> | void
}) {
  const t = useTranslations("mtmTaskWorkspace")
  const locale = useLocale()
  const inputRef = useRef<HTMLInputElement | null>(null)
  const flushingRef = useRef(false)
  const [queued, setQueued] = useState<QueuedTaskDocument[]>([])
  const [online, setOnline] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [message, setMessage] = useState("")

  const refreshQueue = useCallback(async () => {
    setQueued(await listTaskDocuments(taskId))
  }, [taskId])

  const flush = useCallback(async () => {
    if (flushingRef.current || (typeof navigator !== "undefined" && !navigator.onLine)) return
    flushingRef.current = true
    setSyncing(true)
    let uploaded = 0
    try {
      const entries = taskDocumentsReadyForUpload(await listTaskDocuments(taskId))
      for (const entry of entries) {
        const uploading = markTaskDocumentUploading(entry)
        if (!await updateQueuedTaskDocument(uploading)) {
          setMessage(t("fileQueueStateFailed"))
          break
        }
        setQueued(await listTaskDocuments(taskId))
        try {
          const formData = new FormData()
          formData.append("file", uploading.blob, uploading.fileName)
          formData.append("clientDocumentId", uploading.clientDocumentId)
          if (uploading.title) formData.append("title", uploading.title)
          const response = await fetch(`/api/v1/mtm/tasks/${encodeURIComponent(taskId)}/documents`, {
            method: "POST",
            body: formData,
          })
          const body = await response.json().catch(() => null)
          if (!response.ok || !body?.success) throw new Error(t("uploadFailed"))
          if (await removeQueuedTaskDocument(uploading.clientDocumentId)) uploaded += 1
          else setMessage(t("fileQueueStateFailed"))
        } catch {
          const failed = markTaskDocumentFailed(
            uploading,
            t("uploadFailed"),
          )
          if (!await updateQueuedTaskDocument(failed)) setMessage(t("fileQueueStateFailed"))
        }
      }
      await refreshQueue()
      if (uploaded) {
        setMessage(t("uploadSuccess", { count: uploaded }))
        await onChanged()
      }
    } finally {
      flushingRef.current = false
      setSyncing(false)
    }
  }, [onChanged, refreshQueue, t, taskId])

  useEffect(() => {
    setOnline(navigator.onLine)
    void refreshQueue().then(() => flush())
    const onOnline = () => {
      setOnline(true)
      void flush()
    }
    const onOffline = () => setOnline(false)
    window.addEventListener("online", onOnline)
    window.addEventListener("offline", onOffline)
    const interval = window.setInterval(() => void flush(), 30_000)
    return () => {
      window.removeEventListener("online", onOnline)
      window.removeEventListener("offline", onOffline)
      window.clearInterval(interval)
    }
  }, [flush, refreshQueue])

  const chooseFiles = async (files: FileList | null) => {
    if (!files?.length) return
    setMessage("")
    let queuedCount = 0
    let queueFailed = false
    for (const file of Array.from(files)) {
      if (file.size > MAX_FILE_BYTES) {
        queueFailed = true
        setMessage(t("fileTooLarge", { name: file.name }))
        continue
      }
      const extension = file.name.includes(".") ? `.${file.name.split(".").pop()!.toLowerCase()}` : ""
      const allowedExtensions = SAFE_FILE_TYPES[file.type.toLowerCase()]
      if (file.size < 1 || !allowedExtensions?.includes(extension)) {
        queueFailed = true
        setMessage(t("fileTypeUnsupported", { name: file.name }))
        continue
      }
      try {
        await enqueueTaskDocument({
          taskId,
          title: file.name,
          file,
          fileName: file.name,
          mimeType: file.type,
        })
        queuedCount += 1
      } catch {
        queueFailed = true
        setMessage(t("fileQueueFailed", { name: file.name }))
      }
    }
    if (inputRef.current) inputRef.current.value = ""
    await refreshQueue()
    if (navigator.onLine && queuedCount) void flush()
    else if (queuedCount && !queueFailed) setMessage(t("fileQueuedOffline"))
  }

  const retry = async (entry: QueuedTaskDocument) => {
    if (!await updateQueuedTaskDocument(retryTaskDocumentNow(entry))) {
      setMessage(t("fileQueueStateFailed"))
      return
    }
    await refreshQueue()
    void flush()
  }

  const remove = async (entry: QueuedTaskDocument) => {
    if (!await removeQueuedTaskDocument(entry.clientDocumentId)) {
      setMessage(t("fileQueueStateFailed"))
      return
    }
    await refreshQueue()
  }

  const formatDate = (value: string) => formatInTimezone(value, timezone, { dateStyle: "medium", timeStyle: "short" }, locale)

  return (
    <section id="files" className="scroll-mt-24 space-y-5 border-t border-zinc-200 pt-8 dark:border-zinc-700">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div><h2 className="flex items-center gap-2 text-base font-semibold tracking-tight"><FileText className="h-4 w-4 text-muted-foreground" />{t("files")}</h2><p className="mt-1 text-sm text-muted-foreground">{t("filesHint")}</p></div>
        {canUpload ? (
          <>
            <input ref={inputRef} type="file" className="sr-only" tabIndex={-1} aria-label={t("addFiles")} multiple accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.jpg,.jpeg,.png,.webp,.zip" onChange={(event) => void chooseFiles(event.target.files)} />
            <Button type="button" className="min-h-11 print:hidden" onClick={() => inputRef.current?.click()}><Upload className="h-4 w-4" />{t("addFiles")}</Button>
          </>
        ) : null}
      </div>

      {!online ? <div className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50/60 p-4 text-sm text-amber-950 print:hidden dark:border-amber-800 dark:bg-amber-950/25 dark:text-amber-100" role="status"><WifiOff className="mt-0.5 h-4 w-4 shrink-0" /><span>{t("filesOfflineHint")}</span></div> : null}
      {message ? <p className="text-sm text-muted-foreground print:hidden" role="status">{message}</p> : null}

      {queued.length ? (
        <div className="space-y-3 print:hidden">
          <h3 className="text-sm font-semibold">{t("pendingUploads", { count: queued.length })}</h3>
          <ul className="divide-y divide-zinc-200 border-y border-zinc-200 dark:divide-zinc-700 dark:border-zinc-700">
            {queued.map((entry) => (
              <li key={entry.clientDocumentId} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center">
                <FileText className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{entry.fileName}</p><p className="mt-1 text-xs text-muted-foreground">{formatBytes(entry.sizeBytes)} · {t(`uploadStatuses.${entry.status}` as never)}{entry.status === "failed" ? ` · ${t("uploadFailed")}` : ""}</p></div>
                <div className="flex gap-2">
                  {entry.status === "failed" ? <Button type="button" variant="outline" className="min-h-11" onClick={() => void retry(entry)} disabled={syncing}><RefreshCw className="h-4 w-4" />{t("retryUpload")}</Button> : null}
                  <Button type="button" variant="ghost" size="icon" className="min-h-11 min-w-11" onClick={() => void remove(entry)} aria-label={t("removeQueuedFile", { name: entry.fileName })}><Trash2 className="h-4 w-4" /></Button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {documents.length ? (
        <ul className="divide-y divide-zinc-200 border-y border-zinc-200 dark:divide-zinc-700 dark:border-zinc-700">
          {documents.map((document) => (
            <li key={document.id} className="flex items-center gap-3 py-4">
              <FileText className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
              <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{document.title || document.fileName}</p><p className="mt-1 text-xs text-muted-foreground">{formatBytes(document.sizeBytes)} · {formatDate(document.createdAt)}</p></div>
              {document.downloadUrl ? <Button asChild variant="outline" size="icon" className="min-h-11 min-w-11" aria-label={t("downloadFile", { name: document.fileName })}><a href={document.downloadUrl}><Download className="h-4 w-4" /></a></Button> : <Badge variant="outline">{t("downloadUnavailable")}</Badge>}
            </li>
          ))}
        </ul>
      ) : <div className="flex min-h-32 flex-col items-center justify-center gap-2 border-y border-zinc-200 px-4 text-center dark:border-zinc-700"><FileText className="h-6 w-6 text-muted-foreground" /><p className="text-sm font-medium">{t("filesEmpty")}</p><p className="text-xs text-muted-foreground">{t("filesEmptyHint")}</p></div>}
    </section>
  )
}
