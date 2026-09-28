"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { useParams, useRouter } from "next/navigation"
import {
  ArrowLeft,
  CircleAlert,
  FileText,
  Loader2,
  Paperclip,
  RefreshCw,
  Send,
  Star,
  Trash2,
  Upload,
  WifiOff,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { formatDateTime } from "@/lib/format-date"
import {
  parsePortalReplyDraft,
  portalReplyDraftKey,
  serializePortalReplyDraft,
} from "@/lib/ticketing/portal-ticket-draft"
import { isPublicTicketStatus, isTerminalTicketStatus, publicSlaPhase } from "@/lib/ticketing/portal-ticket-presentation"

interface Attachment {
  id: string
  commentId?: string | null
  originalName: string
  fileSize: number
  mimeType: string
}

interface CommentItem {
  id: string
  comment: string
  isAgent: boolean
  authorName: string
  createdAt: string
  attachments: Attachment[]
}

interface TicketDetail {
  id: string
  ticketNumber: string
  subject: string
  description: string | null
  status: string
  category: string
  categoryRef?: { name: string; slug: string } | null
  satisfactionRating: number | null
  satisfactionComment: string | null
  createdAt: string
  updatedAt: string
  resolvedAt: string | null
  closedAt: string | null
  slaDueAt: string | null
  slaFirstResponseDueAt: string | null
  firstResponseAt: string | null
  comments: CommentItem[]
}

function newRequestId(): string {
  return globalThis.crypto.randomUUID()
}

function formatFileSize(bytes: number, locale: string) {
  const value = bytes < 1024 ? bytes : bytes < 1024 * 1024 ? bytes / 1024 : bytes / (1024 * 1024)
  const unit = bytes < 1024 ? "byte" : bytes < 1024 * 1024 ? "kilobyte" : "megabyte"
  return new Intl.NumberFormat(locale, {
    style: "unit",
    unit,
    unitDisplay: "short",
    maximumFractionDigits: unit === "megabyte" ? 1 : 0,
  }).format(value)
}

function uploadPortalAttachment(
  ticketId: string,
  file: File,
  onProgress: (value: number) => void,
): Promise<Attachment> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest()
    request.open("POST", `/api/v1/public/portal-tickets/${encodeURIComponent(ticketId)}/files`)
    request.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100))
    })
    request.addEventListener("load", () => {
      let body: { success?: boolean; data?: Attachment; error?: string } = {}
      try {
        body = JSON.parse(request.responseText) as typeof body
      } catch {
        body = {}
      }
      if (request.status >= 200 && request.status < 300 && body.success && body.data) {
        onProgress(100)
        resolve(body.data)
      } else {
        reject(new Error(body.error || "upload_failed"))
      }
    })
    request.addEventListener("error", () => reject(new Error("upload_failed")))
    request.addEventListener("abort", () => reject(new DOMException("Upload aborted", "AbortError")))
    const formData = new FormData()
    formData.set("file", file)
    request.send(formData)
  })
}

export default function PortalTicketDetailPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const t = useTranslations("portal")
  const locale = useLocale()
  const ticketId = params.id
  const requestRef = useRef<AbortController | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [ticket, setTicket] = useState<TicketDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [loadError, setLoadError] = useState("")
  const [newComment, setNewComment] = useState("")
  const [clientRequestId, setClientRequestId] = useState(newRequestId)
  const [draftAttachmentIds, setDraftAttachmentIds] = useState<string[]>([])
  const [draftAttachments, setDraftAttachments] = useState<Attachment[]>([])
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState("")
  const [sendSuccess, setSendSuccess] = useState("")
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<{ name: string; progress: number } | null>(null)
  const [removingAttachment, setRemovingAttachment] = useState<string | null>(null)
  const [uploadError, setUploadError] = useState("")
  const [online, setOnline] = useState(true)
  const [csatRating, setCsatRating] = useState(0)
  const [csatComment, setCsatComment] = useState("")
  const [csatSending, setCsatSending] = useState(false)
  const [csatSent, setCsatSent] = useState(false)
  const [csatError, setCsatError] = useState("")

  const statusLabel = useCallback((status: string) => {
    if (status === "open") return t("statusOpen")
    if (!isPublicTicketStatus(status)) return t("statusUnknown")
    const labels = {
      new: t("statusNew"),
      in_progress: t("statusInProgress"),
      waiting: t("statusWaiting"),
      resolved: t("statusResolved"),
      closed: t("statusClosed"),
    }
    return labels[status as keyof typeof labels] || t("statusUnknown")
  }, [t])

  const categoryLabel = useCallback((ticketValue: TicketDetail) => {
    const slug = ticketValue.categoryRef?.slug || ticketValue.category
    if (slug === "general") return t("categoryGeneral")
    if (slug === "technical") return t("categoryTechnical")
    if (slug === "billing") return t("categoryBilling")
    if (slug === "feature_request") return t("categoryFeature")
    return ticketValue.categoryRef?.name || ticketValue.category || t("categoryGeneral")
  }, [t])

  const fetchTicket = useCallback(async (initial = false) => {
    requestRef.current?.abort()
    const controller = new AbortController()
    requestRef.current = controller
    if (initial) setLoading(true)
    else setRefreshing(true)
    setLoadError("")
    try {
      const response = await fetch(`/api/v1/public/portal-tickets/${encodeURIComponent(ticketId)}`, {
        cache: "no-store",
        signal: controller.signal,
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok || !body.success) throw new Error(t("ticketLoadError"))
      setTicket(body.data)
      if (body.data.satisfactionRating) {
        setCsatRating(body.data.satisfactionRating)
        setCsatSent(true)
      }
    } catch (error) {
      if ((error as { name?: string }).name !== "AbortError") {
        setLoadError(error instanceof Error ? error.message : t("ticketLoadError"))
      }
    } finally {
      if (requestRef.current === controller) {
        setLoading(false)
        setRefreshing(false)
      }
    }
  }, [t, ticketId])

  const loadDraftAttachments = useCallback(async (ids: string[]) => {
    if (ids.length === 0) return
    try {
      const response = await fetch(`/api/v1/public/portal-tickets/${encodeURIComponent(ticketId)}/files`, { cache: "no-store" })
      const body = await response.json().catch(() => ({}))
      if (!response.ok || !body.success) return
      const idSet = new Set(ids)
      setDraftAttachments((Array.isArray(body.data) ? body.data : []).filter((file: Attachment) => !file.commentId && idSet.has(file.id)))
    } catch {
      // The text draft remains usable even when attachment reconciliation is unavailable.
    }
  }, [ticketId])

  useEffect(() => {
    const draft = parsePortalReplyDraft(localStorage.getItem(portalReplyDraftKey(ticketId)))
    if (draft) {
      setNewComment(draft.text)
      setClientRequestId(draft.clientRequestId)
      setDraftAttachmentIds(draft.attachmentIds)
      void loadDraftAttachments(draft.attachmentIds)
    }
    setOnline(navigator.onLine)
    const onOnline = () => setOnline(true)
    const onOffline = () => setOnline(false)
    window.addEventListener("online", onOnline)
    window.addEventListener("offline", onOffline)
    void fetchTicket(true)
    return () => {
      requestRef.current?.abort()
      window.removeEventListener("online", onOnline)
      window.removeEventListener("offline", onOffline)
    }
  }, [fetchTicket, loadDraftAttachments, ticketId])

  useEffect(() => {
    const key = portalReplyDraftKey(ticketId)
    if (!newComment.trim() && draftAttachmentIds.length === 0) {
      localStorage.removeItem(key)
      return
    }
    localStorage.setItem(key, serializePortalReplyDraft(newComment, draftAttachmentIds, clientRequestId))
  }, [clientRequestId, draftAttachmentIds, newComment, ticketId])

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (!document.hidden && navigator.onLine && !sending) void fetchTicket(false)
    }, 10_000)
    return () => window.clearInterval(interval)
  }, [fetchTicket, sending])

  const handleUpload = async (files: FileList | null) => {
    if (!files?.length || uploading) return
    if (!navigator.onLine) {
      setOnline(false)
      setUploadError(t("offlineAttachment"))
      return
    }
    setUploading(true)
    setUploadError("")
    try {
      for (const file of Array.from(files).slice(0, 10 - draftAttachmentIds.length)) {
        setUploadProgress({ name: file.name, progress: 0 })
        const attachment = await uploadPortalAttachment(ticketId, file, (progress) => {
          setUploadProgress({ name: file.name, progress })
        })
        setDraftAttachments((current) => [...current, attachment])
        setDraftAttachmentIds((current) => [...current, attachment.id])
      }
    } catch {
      setUploadError(t("attachmentUploadFailed"))
    } finally {
      setUploading(false)
      setUploadProgress(null)
      if (fileInputRef.current) fileInputRef.current.value = ""
    }
  }

  const removeAttachment = async (attachment: Attachment) => {
    if (removingAttachment) return
    setRemovingAttachment(attachment.id)
    setUploadError("")
    try {
      const response = await fetch(`/api/v1/public/portal-tickets/${encodeURIComponent(ticketId)}/files/${encodeURIComponent(attachment.id)}`, { method: "DELETE" })
      const body = await response.json().catch(() => ({}))
      if (!response.ok || !body.success) throw new Error(t("attachmentRemoveFailed"))
      setDraftAttachments((current) => current.filter((file) => file.id !== attachment.id))
      setDraftAttachmentIds((current) => current.filter((id) => id !== attachment.id))
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : t("attachmentRemoveFailed"))
    } finally {
      setRemovingAttachment(null)
    }
  }

  const handleSendComment = async () => {
    if (!newComment.trim() || sending || uploading) return
    if (!navigator.onLine) {
      setOnline(false)
      setSendError(t("offlineDraftSaved"))
      return
    }
    setSending(true)
    setSendError("")
    setSendSuccess("")
    try {
      const response = await fetch(`/api/v1/public/portal-tickets/${encodeURIComponent(ticketId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          comment: newComment,
          attachmentIds: draftAttachmentIds,
          clientRequestId,
        }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok || !body.success) throw new Error(t("replySendFailed"))
      setNewComment("")
      setDraftAttachments([])
      setDraftAttachmentIds([])
      setClientRequestId(newRequestId())
      localStorage.removeItem(portalReplyDraftKey(ticketId))
      setSendSuccess(isTerminalTicketStatus(ticket?.status || "") ? t("replySentReopened") : t("replySent"))
      await fetchTicket(false)
    } catch (error) {
      setSendError(error instanceof Error ? error.message : t("replySendFailed"))
    } finally {
      setSending(false)
    }
  }

  const handleSubmitCsat = async () => {
    if (csatRating === 0 || csatSending) return
    setCsatSending(true)
    setCsatError("")
    try {
      const response = await fetch(`/api/v1/public/portal-tickets/${encodeURIComponent(ticketId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ satisfactionRating: csatRating, satisfactionComment: csatComment }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok || !body.success) throw new Error(t("ratingSendFailed"))
      setCsatSent(true)
      await fetchTicket(false)
    } catch (error) {
      setCsatError(error instanceof Error ? error.message : t("ratingSendFailed"))
    } finally {
      setCsatSending(false)
    }
  }

  if (loading) {
    return <div data-testid="portal-ticket-workspace" data-state="loading" className="min-h-64 animate-pulse rounded-lg border bg-muted/40 motion-reduce:animate-none" aria-busy="true" aria-label={t("ticketLoading")} />
  }

  if (loadError || !ticket) {
    return (
      <section data-testid="portal-ticket-workspace" data-state="error" className="flex min-h-64 flex-col items-center justify-center rounded-lg border p-5 text-center" role="alert">
        <CircleAlert className="h-7 w-7 text-destructive" aria-hidden="true" />
        <h1 className="mt-3 text-lg font-semibold">{t("ticketNotFound")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{loadError || t("ticketLoadError")}</p>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <Button data-testid="portal-ticket-retry" variant="outline" className="min-h-11" onClick={() => void fetchTicket(true)}><RefreshCw aria-hidden="true" />{t("tryAgain")}</Button>
          <Button variant="ghost" className="min-h-11" onClick={() => router.push("/portal/tickets")}><ArrowLeft aria-hidden="true" />{t("myTickets")}</Button>
        </div>
      </section>
    )
  }

  const terminal = isTerminalTicketStatus(ticket.status)
  const sla = publicSlaPhase(ticket)
  const canRate = terminal && !csatSent
  const ratingLabels = [t("csatTerrible"), t("csatBad"), t("csatOk"), t("csatGood"), t("csatGreat")]

  return (
    <div data-testid="portal-ticket-workspace" data-state={refreshing ? "refreshing" : "ready"} data-status={ticket.status} data-terminal={terminal} data-online={online} className="space-y-4">
      <Button variant="ghost" className="min-h-11 px-3" onClick={() => router.push("/portal/tickets")}><ArrowLeft aria-hidden="true" />{t("backToTickets")}</Button>

      {!online && <div data-testid="portal-ticket-offline" className="flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm" role="status"><WifiOff className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />{t("offlineDraftSaved")}</div>}

      <header className="rounded-lg border bg-background p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="bg-muted/30">{statusLabel(ticket.status)}</Badge>
          <span className="font-mono text-xs text-muted-foreground">{ticket.ticketNumber}</span>
        </div>
        <h1 className="mt-2 text-xl font-semibold leading-7 tracking-tight">{ticket.subject}</h1>
        <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
          <div><dt className="text-muted-foreground">{t("createdLabel")}</dt><dd className="mt-0.5">{formatDateTime(ticket.createdAt, locale, { dateStyle: "medium", timeStyle: "short" })}</dd></div>
          <div><dt className="text-muted-foreground">{t("categoryLabel")}</dt><dd className="mt-0.5">{categoryLabel(ticket)}</dd></div>
          {sla.kind !== "none" && <div className="sm:col-span-2"><dt className="text-muted-foreground">{t("serviceTarget")}</dt><dd className="mt-0.5">{sla.kind === "complete" ? t("slaComplete") : t(sla.kind === "firstResponse" ? "firstResponseTarget" : "resolutionTarget", { date: formatDateTime(sla.dueAt, locale, { dateStyle: "medium", timeStyle: "short" }) })}</dd></div>}
        </dl>
        {ticket.description && <p className="mt-4 whitespace-pre-wrap border-t pt-4 text-sm leading-6">{ticket.description}</p>}
      </header>

      <section data-testid="portal-ticket-conversation" className="rounded-lg border bg-background" aria-labelledby="portal-conversation-title">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 id="portal-conversation-title" className="text-sm font-semibold">{t("conversationTitle", { count: ticket.comments.length })}</h2>
          {refreshing && <span className="text-xs text-muted-foreground" role="status">{t("updating")}</span>}
        </div>
        <div className="space-y-4 p-4">
          {ticket.comments.length === 0 && <p className="py-4 text-center text-sm text-muted-foreground">{t("noMessages")}</p>}
          {ticket.comments.map((comment) => (
            <article key={comment.id} className={`flex ${comment.isAgent ? "justify-start" : "justify-end"}`}>
              <div className="max-w-[92%] sm:max-w-[78%]">
                <div className={`rounded-lg border px-3 py-2.5 text-sm ${comment.isAgent ? "bg-muted/30" : "bg-background"}`}>
                  <p className="whitespace-pre-wrap leading-6">{comment.comment}</p>
                  {comment.attachments?.length > 0 && (
                    <div className="mt-2 space-y-1.5 border-t pt-2">
                      {comment.attachments.map((file) => (
                        <a key={file.id} href={`/api/v1/public/portal-tickets/${encodeURIComponent(ticketId)}/files/${encodeURIComponent(file.id)}`} className="flex min-h-11 items-center gap-2 rounded-md border px-3 py-2 text-xs hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" download>
                          <FileText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                          <span className="min-w-0 flex-1 truncate">{file.originalName}</span>
                          <span className="text-muted-foreground">{formatFileSize(file.fileSize, locale)}</span>
                        </a>
                      ))}
                    </div>
                  )}
                </div>
                <p className={`mt-1 flex flex-wrap gap-x-2 text-xs text-muted-foreground ${comment.isAgent ? "justify-start" : "justify-end"}`}><span>{comment.authorName}</span><time dateTime={comment.createdAt}>{formatDateTime(comment.createdAt, locale, { dateStyle: "medium", timeStyle: "short" })}</time></p>
              </div>
            </article>
          ))}

          <div className="border-t pt-4">
            <h3 id="portal-ticket-reply-title" className="text-sm font-medium">{terminal ? t("reopenWithReply") : t("writeReply")}</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">{terminal ? t("reopenHelp") : t("replyDraftHelp")}</p>
            {(sendError || uploadError) && <p data-testid="portal-ticket-mutation-error" className="mt-3 rounded-md border px-3 py-2 text-sm text-destructive" role="alert">{sendError || uploadError}</p>}
            {sendSuccess && <p data-testid="portal-ticket-send-success" className="mt-3 rounded-md border px-3 py-2 text-sm" role="status">{sendSuccess}</p>}
            <Textarea
              data-testid="portal-ticket-reply"
              aria-labelledby="portal-ticket-reply-title"
              value={newComment}
              onChange={(event) => setNewComment(event.target.value)}
              onKeyDown={(event) => {
                if ((event.ctrlKey || event.metaKey) && event.key === "Enter" && !event.nativeEvent.isComposing) {
                  event.preventDefault()
                  void handleSendComment()
                }
              }}
              placeholder={terminal ? t("reopenPlaceholder") : t("replyPlaceholder")}
              rows={3}
              maxLength={5000}
              disabled={sending}
              className="mt-3 min-h-24 resize-y"
            />
            {draftAttachments.length > 0 && (
              <ul className="mt-2 space-y-1.5" aria-label={t("draftAttachments")}>
                {draftAttachments.map((file) => (
                  <li key={file.id} className="flex min-h-11 items-center gap-2 rounded-md border px-3 py-2 text-xs">
                    <Paperclip className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate">{file.originalName}</span>
                    <span className="text-muted-foreground">{formatFileSize(file.fileSize, locale)}</span>
                    <button type="button" className="grid h-11 w-11 shrink-0 place-items-center rounded-md hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => void removeAttachment(file)} disabled={Boolean(removingAttachment)} aria-label={t("removeAttachment", { name: file.originalName })}>
                      {removingAttachment === file.id ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Trash2 className="h-4 w-4" aria-hidden="true" />}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {draftAttachmentIds.length > draftAttachments.length && (
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-xs" role="status">
                <span>{t("attachmentRecoveryPending", { count: draftAttachmentIds.length - draftAttachments.length })}</span>
                <Button type="button" variant="ghost" size="sm" onClick={() => void loadDraftAttachments(draftAttachmentIds)}>{t("tryAgain")}</Button>
              </div>
            )}
            <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <input ref={fileInputRef} id="portal-ticket-file" data-testid="portal-ticket-file" type="file" multiple className="sr-only" aria-label={t("addAttachment")} onChange={(event) => void handleUpload(event.target.files)} disabled={uploading || draftAttachmentIds.length >= 10 || !online} accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.png,.jpg,.jpeg,.gif,.webp,.txt,.csv" />
                <Button type="button" variant="outline" className="min-h-11 w-full sm:w-auto" onClick={() => fileInputRef.current?.click()} disabled={uploading || draftAttachmentIds.length >= 10 || !online}>
                  {uploading ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Upload aria-hidden="true" />}
                  {uploading ? t("uploadingShort") : t("addAttachment")}
                </Button>
                {uploadProgress && <p data-testid="portal-ticket-upload-progress" className="mt-1 max-w-xs truncate text-[11px] text-muted-foreground" role="status" aria-live="polite">{t("uploadingAttachment", uploadProgress)}</p>}
                <p className="mt-1 text-[11px] text-muted-foreground">{t("attachmentHelp")}</p>
              </div>
              <Button data-testid="portal-ticket-send" className="min-h-11 w-full sm:w-auto" onClick={() => void handleSendComment()} disabled={sending || uploading || !newComment.trim() || !online}>
                {sending ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Send aria-hidden="true" />}
                {sending ? t("sendingReply") : terminal ? t("sendAndReopen") : t("sendReply")}
              </Button>
            </div>
            <p className="mt-2 hidden text-right text-[11px] text-muted-foreground sm:block">{t("sendShortcut")}</p>
          </div>
        </div>
      </section>

      {canRate && (
        <section className="rounded-lg border bg-background p-4" aria-labelledby="portal-rating-title">
          <h2 id="portal-rating-title" className="text-sm font-semibold">{t("rateSupport")}</h2>
          <p className="mt-1 text-xs text-muted-foreground">{t("rateSupportHelp")}</p>
          {csatError && <p className="mt-3 text-sm text-destructive" role="alert">{csatError}</p>}
          <fieldset className="mt-3 flex flex-wrap gap-1">
            <legend className="sr-only">{t("rateSupport")}</legend>
            {[1, 2, 3, 4, 5].map((rating) => (
              <label key={rating} className="cursor-pointer">
                <input type="radio" name="portal-csat" value={rating} checked={csatRating === rating} onChange={() => setCsatRating(rating)} className="peer sr-only" aria-label={`${rating} — ${ratingLabels[rating - 1]}`} />
                <span className="grid h-11 w-11 place-items-center rounded-md outline-none hover:bg-muted peer-focus-visible:ring-2 peer-focus-visible:ring-ring motion-reduce:transition-none">
                  <Star className={`h-6 w-6 ${rating <= csatRating ? "fill-current" : "text-muted-foreground"}`} aria-hidden="true" />
                </span>
              </label>
            ))}
            {csatRating > 0 && <span className="self-center px-2 text-sm text-muted-foreground">{ratingLabels[csatRating - 1]}</span>}
          </fieldset>
          <Textarea aria-label={t("ratingCommentPlaceholder")} value={csatComment} onChange={(event) => setCsatComment(event.target.value)} placeholder={t("ratingCommentPlaceholder")} rows={2} className="mt-3 min-h-20 resize-y" maxLength={2000} />
          <Button className="mt-3 min-h-11" onClick={() => void handleSubmitCsat()} disabled={csatRating === 0 || csatSending}>{csatSending ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Star aria-hidden="true" />}{csatSending ? t("chatSubmitting") : t("chatSubmitRating")}</Button>
        </section>
      )}

      {csatSent && ticket.satisfactionRating && (
        <section className="rounded-lg border bg-background p-4" aria-label={t("yourRating")}>
          <p className="text-sm"><span className="text-muted-foreground">{t("yourRating")}:</span> <span className="font-medium">{ticket.satisfactionRating}/5 — {ratingLabels[ticket.satisfactionRating - 1]}</span></p>
          {ticket.satisfactionComment && <p className="mt-1 text-sm text-muted-foreground">{ticket.satisfactionComment}</p>}
        </section>
      )}
    </div>
  )
}
