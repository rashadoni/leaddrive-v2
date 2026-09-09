"use client"

import { useEffect, useState, type FormEvent } from "react"
import { useLocale, useTranslations } from "next-intl"
import { CheckCircle2, FileText, History, MessageSquareText, Send } from "lucide-react"

import { type MtmTaskTimelineEvent } from "@/components/mtm/task-workspace"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { formatInTimezone } from "@/lib/timezone"

function clientEventId(): string {
  return globalThis.crypto?.randomUUID?.()
    ?? `task-event-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

const EVENT_ICONS: Record<string, typeof CheckCircle2> = {
  COMMENTED: MessageSquareText,
  EVIDENCE_ADDED: FileText,
}

export function MtmTaskTimelinePanel({
  taskId,
  timeline,
  timezone,
  canComment,
  onChanged,
}: {
  taskId: string
  timeline: MtmTaskTimelineEvent[]
  timezone: string
  canComment: boolean
  onChanged: () => Promise<void> | void
}) {
  const t = useTranslations("mtmTaskWorkspace")
  const locale = useLocale()
  const [comment, setComment] = useState("")
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [pendingValue, setPendingValue] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const pendingStorageKey = `mtm-task-comment-pending:${taskId}`

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(pendingStorageKey)
      if (!raw) return
      const saved = JSON.parse(raw) as { clientEventId?: unknown; comment?: unknown }
      if (typeof saved.clientEventId === "string" && typeof saved.comment === "string") {
        setPendingId(saved.clientEventId)
        setPendingValue(saved.comment)
        setComment(saved.comment)
        setError("")
      }
    } catch {
      // A new comment can still be sent with a fresh operation id.
    }
  }, [pendingStorageKey, t])

  const eventLabel = (type: string) => {
    const known = ["CREATED", "ACCEPTED", "STARTED", "COMPLETED", "RESCHEDULED", "COMMENTED", "EVIDENCE_ADDED", "COPIED", "CANCELLED", "EDITED", "RETURNED", "REVIEW_ACCEPTED", "PROGRESS_UPDATED", "REASSIGNED"]
    return known.includes(type) ? t(`eventTypes.${type}` as never) : t("eventTypes.OTHER")
  }

  const statusLabel = (status?: string | null) => status ? t(`statuses.${status}` as never) : ""

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const value = pendingValue ?? comment.trim()
    if (!value || saving) return
    if (!navigator.onLine) {
      setError(t("commentOffline"))
      return
    }
    const operationId = pendingId || clientEventId()
    try {
      window.localStorage.setItem(pendingStorageKey, JSON.stringify({ clientEventId: operationId, comment: value }))
    } catch {
      setError(t("offlineStorageFailed"))
      return
    }
    setPendingId(operationId)
    setPendingValue(value)
    setSaving(true)
    setError("")
    try {
      const response = await fetch(`/api/v1/mtm/tasks/${encodeURIComponent(taskId)}/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientEventId: operationId, comment: value }),
      })
      const body = await response.json().catch(() => null)
      if (!response.ok || !body?.success) throw new Error(t("commentFailed"))
      setComment("")
      setPendingId(null)
      setPendingValue(null)
      try { window.localStorage.removeItem(pendingStorageKey) } catch { /* An exact replay remains harmless. */ }
      await onChanged()
    } catch {
      setError(t("commentFailed"))
    } finally {
      setSaving(false)
    }
  }

  const startNewComment = () => {
    try { window.localStorage.removeItem(pendingStorageKey) } catch { /* The in-memory choice still applies until reload. */ }
    setPendingId(null)
    setPendingValue(null)
    setError("")
  }

  return (
    <section id="timeline" className="scroll-mt-24 space-y-5 border-t border-zinc-200 pt-8 dark:border-zinc-700">
      <div className="flex items-start justify-between gap-3"><div><h2 className="flex items-center gap-2 text-base font-semibold tracking-tight"><History className="h-4 w-4 text-muted-foreground" />{t("timeline")}</h2><p className="mt-1 text-sm text-muted-foreground">{t("timelineHint")}</p></div><Badge variant="outline">{timeline.length}</Badge></div>

      {canComment ? (
        <form onSubmit={submit} className="space-y-3 border-y border-zinc-200 py-4 print:hidden dark:border-zinc-700">
          <Label htmlFor="task-comment">{t("addComment")}</Label>
          <Textarea id="task-comment" value={comment} onChange={(event) => { setComment(event.target.value); setError("") }} rows={3} maxLength={2000} placeholder={t("commentPlaceholder")} disabled={pendingId !== null} />
          {pendingId ? <p className="text-xs leading-5 text-amber-800 dark:text-amber-200" role="status">{t("commentUncertainHint")}</p> : null}
          {error ? <p className="text-sm text-red-700 dark:text-red-300" role="alert">{error}</p> : null}
          <div className="flex flex-wrap justify-end gap-2">
            {pendingId ? <Button type="button" variant="ghost" className="min-h-11" disabled={saving} onClick={startNewComment}>{t("startNewComment")}</Button> : null}
            <Button type="submit" className="min-h-11" disabled={!comment.trim() || saving}><Send className="h-4 w-4" />{saving ? t("sendingComment") : pendingId ? t("retryCommentExact") : t("sendComment")}</Button>
          </div>
        </form>
      ) : null}

      {timeline.length ? (
        <ol className="relative space-y-0">
          {timeline.map((event, index) => {
            const semanticType = event.semanticType || event.type
            const Icon = EVENT_ICONS[semanticType] || CheckCircle2
            const actor = event.actor?.role === "SYSTEM" ? t("systemActor") : event.actor?.name || t("systemActor")
            return (
              <li key={event.id} className="grid grid-cols-[2.25rem_minmax(0,1fr)] gap-3 pb-6 last:pb-0">
                <div className="relative flex justify-center"><span className="relative z-10 inline-flex h-8 w-8 items-center justify-center rounded-full border border-zinc-200 bg-background text-muted-foreground dark:border-zinc-700"><Icon className="h-4 w-4" aria-hidden="true" /></span>{index < timeline.length - 1 ? <span className="absolute bottom-[-1.5rem] top-8 w-px bg-zinc-200 dark:bg-zinc-700" aria-hidden="true" /> : null}</div>
                <div className="min-w-0 pt-1">
                  <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4"><h3 className="text-sm font-semibold">{eventLabel(semanticType)}</h3><time className="shrink-0 text-xs text-muted-foreground" dateTime={event.occurredAt}>{formatInTimezone(event.occurredAt, timezone, { dateStyle: "medium", timeStyle: "short" }, locale)}</time></div>
                  {event.fromStatus || event.toStatus ? <p className="mt-1 text-xs text-muted-foreground">{event.fromStatus ? statusLabel(event.fromStatus) : "—"} → {event.toStatus ? statusLabel(event.toStatus) : "—"}</p> : null}
                  {event.comment ? <p className="mt-2 max-w-[72ch] whitespace-pre-wrap text-sm leading-6 text-foreground">{event.comment}</p> : null}
                  {event.document ? <p className="mt-2 flex items-center gap-1 text-xs text-muted-foreground"><FileText className="h-3.5 w-3.5" />{event.document.fileName}</p> : null}
                  <p className="mt-2 text-xs text-muted-foreground">{t("timelineActor", { name: actor })}</p>
                  {event.agent?.name ? <p className="mt-0.5 text-xs text-muted-foreground">{t("timelineAssignee", { name: event.agent.name })}</p> : null}
                </div>
              </li>
            )
          })}
        </ol>
      ) : <div className="flex min-h-32 flex-col items-center justify-center gap-2 border-y border-zinc-200 px-4 text-center dark:border-zinc-700"><History className="h-6 w-6 text-muted-foreground" /><p className="text-sm font-medium">{t("timelineEmpty")}</p><p className="text-xs text-muted-foreground">{t("timelineEmptyHint")}</p></div>}
    </section>
  )
}
