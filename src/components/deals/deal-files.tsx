"use client"

/**
 * Files of a deal (docs/sales-procurement/README.md, task 4.1): the customer's
 * layout, a PDF, a photo, a confirmation. Opened through the uploads gate, which
 * checks the organization and the right to read deals.
 */
import { useCallback, useEffect, useRef, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { formatDate } from "@/lib/format-date"
import { FileText, Loader2, Paperclip, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"

interface DealFileRow { id: string; originalName: string; fileSize: number; mimeType: string; note: string | null; createdAt: string; url: string }

const size = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`)

export function DealFiles({ dealId, canWrite }: { dealId: string; canWrite: boolean }) {
  const t = useTranslations("dealFiles")
  const locale = useLocale()
  const [files, setFiles] = useState<DealFileRow[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/deals/${dealId}/files`)
      const body = await res.json().catch(() => null)
      setFiles(res.ok ? body?.data ?? [] : [])
    } finally {
      setLoading(false)
    }
  }, [dealId])

  useEffect(() => { void load() }, [load])

  const upload = async (list: FileList | null) => {
    if (!list || list.length === 0) return
    setUploading(true)
    try {
      for (const file of Array.from(list)) {
        if (file.size > 10 * 1024 * 1024) { toast.error(`${file.name}: ${t("tooBig")}`); continue }
        const form = new FormData()
        form.append("file", file)
        const res = await fetch(`/api/v1/deals/${dealId}/files`, { method: "POST", body: form })
        const body = await res.json().catch(() => ({}))
        if (!res.ok) toast.error(`${file.name}: ${body?.refusal === "too_big" ? t("tooBig") : body?.refusal === "type" ? t("type") : t("failed")}`)
        else toast.success(t("uploaded"))
      }
    } finally {
      setUploading(false)
      if (input.current) input.current.value = ""
      void load()
    }
  }

  const remove = async (fileId: string) => {
    if (!window.confirm(t("confirmRemove"))) return
    const res = await fetch(`/api/v1/deals/${dealId}/files?fileId=${encodeURIComponent(fileId)}`, { method: "DELETE" })
    if (!res.ok) toast.error(t("failed"))
    void load()
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">{t("hint")}</p>
        {canWrite && (
          <>
            <input ref={input} type="file" multiple className="hidden" onChange={(e) => void upload(e.target.files)} />
            <Button size="sm" variant="outline" disabled={uploading} onClick={() => input.current?.click()}>
              {uploading ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Paperclip className="mr-1 h-4 w-4" />}{t("add")}
            </Button>
          </>
        )}
      </div>
      {loading ? (
        <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : files.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <ul className="divide-y rounded-xl border">
          {files.map((file) => (
            <li key={file.id} className="flex items-center gap-3 px-3 py-2 text-sm">
              {file.mimeType.startsWith("image/")
                ? <img src={`${file.url}?w=160`} alt="" className="h-10 w-10 rounded object-cover" />
                : <FileText className="h-6 w-6 shrink-0 text-muted-foreground" />}
              <div className="min-w-0 flex-1">
                <a href={file.url} target="_blank" rel="noreferrer" className="block truncate font-medium text-primary hover:underline">{file.originalName}</a>
                <div className="text-xs text-muted-foreground">{size(file.fileSize)} · {formatDate(file.createdAt, locale)}</div>
              </div>
              {canWrite && (
                <Button size="icon" variant="ghost" aria-label={t("remove")} onClick={() => void remove(file.id)}><Trash2 className="h-4 w-4" /></Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
