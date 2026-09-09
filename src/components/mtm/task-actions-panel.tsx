"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCopy,
  Play,
  RefreshCw,
  RotateCcw,
  Save,
  WifiOff,
} from "lucide-react"

import { localRecurrencePreview, TaskScheduleDstNotice } from "@/components/mtm/task-form"
import { type MtmTaskDetail } from "@/components/mtm/task-workspace"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  applyTaskExecutionOutcome,
  loadTaskExecution,
  mergeQueuedTaskExecution,
  removeTaskExecution,
  saveTaskExecution,
  type QueuedTaskExecution,
} from "@/lib/mtm/task-document-outbox"
import { invalidateOperationalWeekSnapshotsAfterTaskMutation } from "@/lib/mtm/operational-week-cache"
import { resolveMtmTaskTenantLocalDateTime } from "@/lib/mtm/task-recurrence"
import { formatInTimezone } from "@/lib/timezone"

type MutationPhase = "idle" | "saving" | "success" | "error" | "conflict"

type DuplicateDraft = {
  targetDueDate: string
  targetScheduledStartAt: string
  idempotencyKey: string
  locked: boolean
}

function uuid(): string {
  return globalThis.crypto?.randomUUID?.()
    ?? "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (character) => {
      const random = (Math.random() * 16) | 0
      return (character === "x" ? random : (random & 0x3) | 0x8).toString(16)
    })
}

function PanelHeading({ title, hint }: { title: string; hint: string }) {
  return <div><h2 className="text-sm font-semibold">{title}</h2><p className="mt-1 text-xs leading-5 text-muted-foreground">{hint}</p></div>
}

export function MtmTaskActionsPanel({
  task,
  timezone,
  canExecute,
  canReview,
  canDuplicate,
  onChanged,
  onOpenTask,
}: {
  task: MtmTaskDetail
  timezone: string
  canExecute: boolean
  canReview: boolean
  canDuplicate: boolean
  onChanged: () => Promise<void> | void
  onOpenTask: (taskId: string) => void
}) {
  const t = useTranslations("mtmTaskWorkspace")
  const locale = useLocale()
  const flushRef = useRef(false)
  const [online, setOnline] = useState(true)
  const [execution, setExecution] = useState<QueuedTaskExecution | null>(null)
  const [progress, setProgress] = useState(task.progress ?? 0)
  const [result, setResult] = useState(task.result ?? "")
  const [executionMessage, setExecutionMessage] = useState("")
  const [reviewComment, setReviewComment] = useState("")
  const [returnReason, setReturnReason] = useState("")
  const [reviewPhase, setReviewPhase] = useState<MutationPhase>("idle")
  const [reviewMessage, setReviewMessage] = useState("")
  const duplicateStorageKey = `mtm-task-duplicate-draft:${task.id}`
  const [duplicate, setDuplicate] = useState<DuplicateDraft>(() => ({
    targetDueDate: "",
    targetScheduledStartAt: "",
    idempotencyKey: uuid(),
    locked: false,
  }))
  const [duplicateReady, setDuplicateReady] = useState(false)
  const [duplicatePhase, setDuplicatePhase] = useState<MutationPhase>("idle")
  const [duplicateMessage, setDuplicateMessage] = useState("")

  const flushExecution = useCallback(async (entryOverride?: QueuedTaskExecution) => {
    if (flushRef.current || (typeof navigator !== "undefined" && !navigator.onLine)) return
    const entry = entryOverride ?? await loadTaskExecution(task.id)
    if (!entry || entry.status === "conflict") return
    flushRef.current = true
    setExecutionMessage("")
    try {
      const response = await fetch("/api/v1/mtm/sync/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operations: [{
            operationId: entry.operationId,
            entity: "tasks",
            op: "update",
            data: entry.data,
            clientTimestamp: entry.clientTimestamp,
          }],
        }),
      })
      const body = await response.json().catch(() => null)
      if (!response.ok || !body?.success) throw new Error(t("executionSyncFailed"))
      const syncResult = body.data?.results?.[0]
      const status = syncResult?.status === "ok" || syncResult?.status === "conflict"
        ? syncResult.status
        : "error"
      const outcome = applyTaskExecutionOutcome(entry, {
        status,
        error: status === "ok" ? undefined : t(status === "conflict" ? "executionConflictHint" : "executionSyncFailed"),
        serverData: syncResult?.result,
      })
      if (!outcome) {
        await removeTaskExecution(task.id)
        setExecution(null)
        setExecutionMessage(t("executionSynced"))
        invalidateOperationalWeekSnapshotsAfterTaskMutation()
        await onChanged()
      } else {
        await saveTaskExecution(outcome)
        setExecution(outcome)
        setExecutionMessage(t(outcome.status === "conflict" ? "executionConflictHint" : "executionSyncFailed"))
      }
    } catch {
      const failed = applyTaskExecutionOutcome(entry, {
        status: "error",
        error: t("executionSyncFailed"),
      })
      if (failed) {
        try { await saveTaskExecution(failed) } catch { /* In-memory recovery remains available. */ }
        setExecution(failed)
        setExecutionMessage(t("executionSyncFailed"))
      }
    } finally {
      flushRef.current = false
    }
  }, [onChanged, t, task.id])

  useEffect(() => {
    let cancelled = false
    setOnline(navigator.onLine)
    void loadTaskExecution(task.id).then((entry) => {
      if (cancelled) return
      setExecution(entry)
      if (entry?.data.progress !== undefined) setProgress(entry.data.progress)
      if (entry?.data.result !== undefined) setResult(entry.data.result || "")
      if (entry?.status === "pending" || entry?.status === "error") void flushExecution(entry)
    })
    const onlineListener = () => {
      setOnline(true)
      void flushExecution()
    }
    const offlineListener = () => setOnline(false)
    window.addEventListener("online", onlineListener)
    window.addEventListener("offline", offlineListener)
    return () => {
      cancelled = true
      window.removeEventListener("online", onlineListener)
      window.removeEventListener("offline", offlineListener)
    }
  }, [flushExecution, task.id])

  useEffect(() => {
    if (execution) return
    setProgress(task.progress ?? 0)
    setResult(task.result ?? "")
  }, [execution, task.progress, task.result])

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(duplicateStorageKey)
      if (raw) {
        const saved = JSON.parse(raw) as Partial<DuplicateDraft>
        setDuplicate({
          targetDueDate: typeof saved.targetDueDate === "string" ? saved.targetDueDate : "",
          targetScheduledStartAt: typeof saved.targetScheduledStartAt === "string" ? saved.targetScheduledStartAt : "",
          idempotencyKey: typeof saved.idempotencyKey === "string" ? saved.idempotencyKey : uuid(),
          locked: saved.locked === true,
        })
      }
    } catch {
      // A fresh idempotency key is already available.
    }
    setDuplicateReady(true)
  }, [duplicateStorageKey])

  useEffect(() => {
    if (!duplicateReady) return
    try { window.localStorage.setItem(duplicateStorageKey, JSON.stringify(duplicate)) } catch { /* Online duplicate still works. */ }
  }, [duplicate, duplicateReady, duplicateStorageKey])

  const queueExecution = async (change: { status?: string; progress?: number; result?: string | null }) => {
    if (execution?.status === "conflict" || execution?.status === "error") {
      setExecutionMessage(t(execution.status === "conflict" ? "executionConflictHint" : "executionErrorLocked"))
      return
    }
    const current = execution ?? await loadTaskExecution(task.id)
    const next = mergeQueuedTaskExecution(current, { taskId: task.id, expectedVersion: task.version, ...change })
    try {
      await saveTaskExecution(next)
      setExecution(next)
      setExecutionMessage(online ? t("executionSyncing") : t("executionQueuedOffline"))
      if (online) void flushExecution(next)
    } catch {
      setExecutionMessage(t("offlineStorageFailed"))
    }
  }

  const retryExecution = async () => {
    if (!execution || execution.status === "conflict") return
    const pending = { ...execution, status: "pending" as const, lastError: undefined, updatedAt: new Date().toISOString() }
    try { await saveTaskExecution(pending) } catch { setExecutionMessage(t("offlineStorageFailed")); return }
    setExecution(pending)
    void flushExecution(pending)
  }

  const discardExecution = async () => {
    await removeTaskExecution(task.id)
    setExecution(null)
    setExecutionMessage("")
    await onChanged()
  }

  const review = async (action: "ACCEPT" | "RETURN") => {
    if (!online) {
      setReviewPhase("error")
      setReviewMessage(t("reviewOffline"))
      return
    }
    if (action === "RETURN" && !returnReason.trim()) {
      setReviewPhase("error")
      setReviewMessage(t("returnReasonRequired"))
      return
    }
    setReviewPhase("saving")
    setReviewMessage("")
    try {
      const response = await fetch(`/api/v1/mtm/tasks/${encodeURIComponent(task.id)}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          expectedVersion: task.version,
          ...(action === "RETURN" ? { reason: returnReason.trim() } : { comment: reviewComment.trim() || undefined }),
        }),
      })
      const body = await response.json().catch(() => null)
      if (response.status === 409) {
        setReviewPhase("conflict")
        setReviewMessage(t("versionConflictHint"))
        return
      }
      if (!response.ok || !body?.success) throw new Error(t("reviewFailed"))
      setReviewPhase("success")
      setReviewMessage(t(action === "ACCEPT" ? "reviewAccepted" : "reviewReturned"))
      setReviewComment("")
      setReturnReason("")
      invalidateOperationalWeekSnapshotsAfterTaskMutation()
      await onChanged()
    } catch {
      setReviewPhase("error")
      setReviewMessage(t("reviewFailed"))
    }
  }

  const duplicateTask = async () => {
    if (!duplicate.targetDueDate) {
      setDuplicatePhase("error")
      setDuplicateMessage(t("duplicateDueRequired"))
      return
    }
    if (duplicate.targetScheduledStartAt && duplicate.targetScheduledStartAt > duplicate.targetDueDate) {
      setDuplicatePhase("error")
      setDuplicateMessage(t("duplicateRangeInvalid"))
      return
    }
    if (!online) {
      setDuplicatePhase("error")
      setDuplicateMessage(t("duplicateOffline"))
      return
    }
    const submitted = { ...duplicate, locked: true }
    try {
      window.localStorage.setItem(duplicateStorageKey, JSON.stringify(submitted))
    } catch {
      // Do not dispatch a non-idempotent-looking request unless its exact key
      // and facts will survive a response-lost reload.
      setDuplicatePhase("error")
      setDuplicateMessage(t("offlineStorageFailed"))
      return
    }
    setDuplicate(submitted)
    setDuplicatePhase("saving")
    setDuplicateMessage("")
    try {
      const response = await fetch(`/api/v1/mtm/tasks/${encodeURIComponent(task.id)}/duplicate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetDueDate: resolveMtmTaskTenantLocalDateTime(submitted.targetDueDate, timezone).instant.toISOString(),
          targetScheduledStartAt: submitted.targetScheduledStartAt
            ? resolveMtmTaskTenantLocalDateTime(submitted.targetScheduledStartAt, timezone).instant.toISOString()
            : undefined,
          idempotencyKey: submitted.idempotencyKey,
          expectedVersion: task.version,
        }),
      })
      const body = await response.json().catch(() => null)
      if (response.status === 409) {
        setDuplicatePhase("conflict")
        setDuplicateMessage(t("versionConflictHint"))
        return
      }
      if (!response.ok || !body?.success) throw new Error(t("duplicateFailed"))
      const createdId = body.data?.task?.id || body.data?.id
      setDuplicatePhase("success")
      setDuplicateMessage(t("duplicateCreated"))
      try { window.localStorage.removeItem(duplicateStorageKey) } catch { /* An exact replay remains harmless. */ }
      setDuplicate({ targetDueDate: "", targetScheduledStartAt: "", idempotencyKey: uuid(), locked: false })
      invalidateOperationalWeekSnapshotsAfterTaskMutation()
      if (typeof createdId === "string") onOpenTask(createdId)
      else await onChanged()
    } catch {
      setDuplicatePhase("error")
      setDuplicateMessage(t("duplicateFailed"))
    }
  }

  const startNewDuplicate = () => {
    setDuplicate((current) => ({ ...current, idempotencyKey: uuid(), locked: false }))
    setDuplicatePhase("idle")
    setDuplicateMessage("")
  }

  const duplicatePreview = useMemo(() => localRecurrencePreview(
    duplicate.targetScheduledStartAt,
    duplicate.targetDueDate,
    "",
    "1",
    timezone,
    timezone,
  ), [duplicate.targetDueDate, duplicate.targetScheduledStartAt, timezone])

  const effectiveStatus = execution?.data.status || task.status
  const canStart = canExecute && ["PENDING", "OVERDUE"].includes(effectiveStatus)
  const canComplete = canExecute && effectiveStatus === "IN_PROGRESS"
  const busyExecution = execution?.status === "pending" && online
  const executionLocked = execution?.status === "conflict" || execution?.status === "error"
  const mobilePrimary = canStart
    ? () => void queueExecution({ status: "IN_PROGRESS", progress: Math.max(1, progress) })
    : canComplete
      ? () => void queueExecution({ status: "COMPLETED", progress: 100, result: result.trim() || null })
      : null
  const scrollToReview = () => document.getElementById("review-actions")?.scrollIntoView({ behavior: "smooth", block: "start" })

  return (
    <>
      {canExecute || execution ? (
        <section id="execution-actions" className="scroll-mt-24 space-y-4 border-b border-zinc-200 pb-6 dark:border-zinc-700">
          <PanelHeading title={t("executionActions")} hint={t("executionActionsHint")} />
          {!online ? <div className="flex items-start gap-2 text-xs text-amber-800 dark:text-amber-200" role="status"><WifiOff className="mt-0.5 h-4 w-4 shrink-0" />{t("executionOfflineHint")}</div> : null}
          {execution ? (
            <div className="space-y-3 rounded-lg border border-zinc-200 p-3 dark:border-zinc-700" role="status" aria-live="polite">
              <div className="flex items-center justify-between gap-2"><span className="text-xs font-medium">{t("offlineOperation")}</span><Badge variant={execution.status === "conflict" ? "warning" : execution.status === "error" ? "destructive" : "info"}>{t(`executionQueueStatuses.${execution.status}` as never)}</Badge></div>
              <p className="text-xs leading-5 text-muted-foreground">{executionMessage || t(execution.status === "conflict" ? "executionConflictHint" : execution.status === "error" ? "executionSyncFailed" : online ? "executionSyncing" : "executionQueuedOffline")}</p>
              <div className="flex flex-wrap gap-2">
                {execution.status === "error" ? <Button type="button" variant="outline" className="min-h-11" onClick={() => void retryExecution()}><RefreshCw className="h-4 w-4" />{t("retrySync")}</Button> : null}
                {execution.status === "conflict" ? <Button type="button" variant="outline" className="min-h-11" onClick={() => void onChanged()}><RefreshCw className="h-4 w-4" />{t("reloadAndReview")}</Button> : null}
                {(execution.status === "error" || execution.status === "conflict") ? <Button type="button" variant="ghost" className="min-h-11" onClick={() => void discardExecution()}>{t("discardQueuedChange")}</Button> : null}
              </div>
            </div>
          ) : null}
          {canExecute ? <><div className="space-y-2">
            <div className="flex items-center justify-between gap-3"><Label htmlFor="task-progress">{t("progress")}</Label><span className="text-sm font-semibold tabular-nums">{progress}%</span></div>
            <input id="task-progress" type="range" min={0} max={100} step={5} value={progress} onChange={(event) => setProgress(Number(event.target.value))} className="min-h-11 w-full accent-primary" disabled={!canComplete || executionLocked} />
          </div>
          <div className="space-y-1.5"><Label htmlFor="task-result">{t("result")}</Label><Textarea id="task-result" value={result} onChange={(event) => setResult(event.target.value)} rows={4} maxLength={5000} disabled={!canComplete || executionLocked} placeholder={t("resultPlaceholder")} /></div>
          <div className="grid gap-2">
            {canStart ? <Button type="button" className="min-h-11" disabled={busyExecution || executionLocked} onClick={() => void queueExecution({ status: "IN_PROGRESS", progress: Math.max(1, progress) })}><Play className="h-4 w-4" />{t("startTask")}</Button> : null}
            {canComplete ? <><Button type="button" variant="outline" className="min-h-11" disabled={busyExecution || executionLocked} onClick={() => void queueExecution({ progress, result: result.trim() || null })}><Save className="h-4 w-4" />{t("saveProgress")}</Button><Button type="button" className="min-h-11" disabled={busyExecution || executionLocked} onClick={() => void queueExecution({ status: "COMPLETED", progress: 100, result: result.trim() || null })}><CheckCircle2 className="h-4 w-4" />{t("completeTask")}</Button></> : null}
            {!canStart && !canComplete ? <p className="text-xs text-muted-foreground">{t("executionUnavailableForStatus")}</p> : null}
          </div></> : <p className="text-xs text-muted-foreground">{t("executionPermissionUnavailable")}</p>}
        </section>
      ) : null}

      {canReview ? (
        <section id="review-actions" className="scroll-mt-24 space-y-4 border-b border-zinc-200 pb-6 dark:border-zinc-700">
          <PanelHeading title={t("reviewTask")} hint={t("reviewTaskHint")} />
          <div className="space-y-1.5"><Label htmlFor="task-review-comment">{t("reviewComment")}</Label><Textarea id="task-review-comment" value={reviewComment} onChange={(event) => setReviewComment(event.target.value)} rows={3} maxLength={2000} /></div>
          <div className="space-y-1.5"><Label htmlFor="task-return-reason">{t("returnReason")}</Label><Textarea id="task-return-reason" value={returnReason} onChange={(event) => setReturnReason(event.target.value)} rows={3} maxLength={2000} placeholder={t("returnReasonPlaceholder")} /></div>
          {reviewMessage ? <p className={`text-xs leading-5 ${reviewPhase === "error" || reviewPhase === "conflict" ? "text-red-700 dark:text-red-300" : "text-muted-foreground"}`} role="status">{reviewMessage}</p> : null}
          <div className="grid grid-cols-2 gap-2"><Button type="button" variant="outline" className="min-h-11" disabled={reviewPhase === "saving"} onClick={() => void review("RETURN")}><RotateCcw className="h-4 w-4" />{t("returnTask")}</Button><Button type="button" className="min-h-11" disabled={reviewPhase === "saving"} onClick={() => void review("ACCEPT")}><CheckCircle2 className="h-4 w-4" />{t("acceptTask")}</Button></div>
        </section>
      ) : null}

      {canDuplicate ? (
        <section className="space-y-4 border-b border-zinc-200 pb-6 dark:border-zinc-700">
          <PanelHeading title={t("duplicateTask")} hint={t("duplicateTaskHint")} />
          <div className="space-y-1.5"><Label htmlFor="duplicate-due">{t("targetDueDate")} *</Label><Input id="duplicate-due" type="datetime-local" value={duplicate.targetDueDate} onChange={(event) => setDuplicate((current) => ({ ...current, targetDueDate: event.target.value }))} disabled={duplicate.locked} required aria-required="true" /></div>
          <div className="space-y-1.5"><Label htmlFor="duplicate-start">{t("targetScheduledStart")}</Label><Input id="duplicate-start" type="datetime-local" value={duplicate.targetScheduledStartAt} onChange={(event) => setDuplicate((current) => ({ ...current, targetScheduledStartAt: event.target.value }))} disabled={duplicate.locked} /></div>
          <p className="text-xs text-muted-foreground">{t("duplicateTimezone", { timezone })}</p>
          <TaskScheduleDstNotice adjustments={duplicatePreview.authoringDst} />
          {duplicate.locked ? <p className="text-xs leading-5 text-amber-800 dark:text-amber-200" role="status">{t("duplicateUncertainHint")}</p> : null}
          {duplicateMessage ? <p className={`text-xs leading-5 ${duplicatePhase === "error" || duplicatePhase === "conflict" ? "text-red-700 dark:text-red-300" : "text-muted-foreground"}`} role="status">{duplicateMessage}</p> : null}
          <div className="grid gap-2">
            <Button type="button" variant="outline" className="min-h-11 w-full" disabled={duplicatePhase === "saving"} onClick={() => void duplicateTask()}><ClipboardCopy className="h-4 w-4" />{duplicate.locked ? t("retryDuplicateExact") : t("createDuplicate")}</Button>
            {duplicate.locked ? <Button type="button" variant="ghost" className="min-h-11 w-full" disabled={duplicatePhase === "saving"} onClick={startNewDuplicate}>{t("startNewDuplicate")}</Button> : null}
          </div>
        </section>
      ) : null}

      {mobilePrimary || canReview ? (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-zinc-200 bg-background/95 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur-sm print:hidden lg:hidden">
          <div className="mx-auto flex max-w-xl gap-2">
            {canComplete ? <Button type="button" variant="outline" className="min-h-12 flex-1" disabled={busyExecution || executionLocked} onClick={() => void queueExecution({ progress, result: result.trim() || null })}><Save className="h-4 w-4" />{t("saveProgress")}</Button> : null}
            {mobilePrimary ? <Button type="button" className="min-h-12 flex-1" disabled={busyExecution || executionLocked} onClick={mobilePrimary}>{canStart ? <Play className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}{canStart ? t("startTask") : t("completeTask")}</Button> : null}
            {!mobilePrimary && canReview ? <Button type="button" className="min-h-12 flex-1" onClick={scrollToReview}><CheckCircle2 className="h-4 w-4" />{t("reviewTask")}</Button> : null}
          </div>
        </div>
      ) : null}

      {execution?.status === "conflict" ? <div className="sr-only" role="alert"><AlertTriangle />{t("executionConflictHint")}</div> : null}
      {executionMessage && execution?.status === "pending" ? <span className="sr-only" aria-live="polite">{executionMessage} {formatInTimezone(execution.updatedAt, timezone, { timeStyle: "short" }, locale)}</span> : null}
    </>
  )
}
