"use client"

import Link from "next/link"
import { useCallback, useEffect, useRef, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  CircleDashed,
  ExternalLink,
  ListOrdered,
  Loader2,
  Pause,
  PhoneCall,
  Play,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  SkipForward,
  Square,
  XCircle,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { cn } from "@/lib/utils"
import { isVoiceQueueDisabledCode } from "@/components/voice-call-queues/voice-call-queue-preview"

export interface VoiceCallQueueItemView {
  id: string
  leadId: string
  leadLabel: string | null
  position: number
  status: string
  outcome: string | null
  blockReason: string | null
  createdAt: string | null
  startedAt: string | null
  endedAt: string | null
}

export interface VoiceCallQueueView {
  id: string
  ownerUserId: string | null
  status: string
  totalItems: number
  createdAt: string | null
  startedAt: string | null
  pausedAt: string | null
  completedAt: string | null
  cancelledAt: string | null
}

export interface VoiceCallQueueDetailView {
  queue: VoiceCallQueueView
  items: VoiceCallQueueItemView[]
  blockers: string[]
}

const ACTIVE_ITEM_STATUSES = new Set([
  "claimed",
  "dispatching",
  "waiting_terminal",
  "dispatch_uncertain",
])
const TERMINAL_ITEM_STATUSES = new Set([
  "completed",
  "no_answer",
  "busy",
  "failed",
  "cancelled",
  "blocked",
  "skipped",
])
const TERMINAL_QUEUE_STATUSES = new Set(["completed", "cancelled"])

const ITEM_STATUS_TRANSLATION = {
  pending: "itemPending",
  claimed: "itemChecking",
  dispatching: "itemCalling",
  waiting_terminal: "itemInProgress",
  dispatch_uncertain: "itemCheckingOutcome",
  completed: "itemCompleted",
  no_answer: "itemNoAnswer",
  busy: "itemBusy",
  failed: "itemFailed",
  cancelled: "itemCancelled",
  blocked: "itemBlocked",
  skipped: "itemSkipped",
} as const

type ItemStatusTranslationKey =
  | (typeof ITEM_STATUS_TRANSLATION)[keyof typeof ITEM_STATUS_TRANSLATION]
  | "itemUnknown"

const QUEUE_STATUS_TRANSLATION = {
  prepared: "statusPrepared",
  running: "statusRunning",
  paused: "statusPaused",
  completed: "statusCompleted",
  cancelled: "statusCancelled",
  attention_required: "statusAttentionRequired",
} as const

type QueueStatusTranslationKey =
  | (typeof QUEUE_STATUS_TRANSLATION)[keyof typeof QUEUE_STATUS_TRANSLATION]
  | "statusUnknown"

function normalizeStatus(value: string): string {
  return value.trim().toLowerCase().replace(/[\s-]+/g, "_")
}

export function queueItemStatusTranslationKey(status: string): ItemStatusTranslationKey {
  const normalized = normalizeStatus(status)
  return ITEM_STATUS_TRANSLATION[normalized as keyof typeof ITEM_STATUS_TRANSLATION] ?? "itemUnknown"
}

export function queueStatusTranslationKey(status: string): QueueStatusTranslationKey {
  const normalized = normalizeStatus(status)
  return QUEUE_STATUS_TRANSLATION[normalized as keyof typeof QUEUE_STATUS_TRANSLATION] ?? "statusUnknown"
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null
}

function firstString(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = nullableString(record[key])
    if (value) return value
  }
  return null
}

function finiteInteger(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.floor(value))
    : fallback
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : []
}

export function normalizeQueueDetailPayload(payload: unknown): VoiceCallQueueDetailView | null {
  if (!isRecord(payload) || payload.success !== true || !isRecord(payload.data)) return null
  const data = payload.data
  if (!isRecord(data.queue)) return null
  const rawQueue = data.queue
  if (typeof rawQueue.id !== "string" || typeof rawQueue.status !== "string") return null

  const rawItems = Array.isArray(data.items)
    ? data.items
    : Array.isArray(rawQueue.items)
      ? rawQueue.items
      : []
  const items = rawItems.flatMap((value): VoiceCallQueueItemView[] => {
    if (!isRecord(value)
      || typeof value.id !== "string"
      || typeof value.leadId !== "string"
      || typeof value.status !== "string") return []
    return [{
      id: value.id,
      leadId: value.leadId,
      leadLabel: firstString(value, ["leadLabel", "leadName"]),
      position: Math.max(1, finiteInteger(value.position, 1)),
      status: normalizeStatus(value.status),
      outcome: nullableString(value.outcome),
      blockReason: firstString(value, ["blockReason", "blocker"]),
      createdAt: nullableString(value.createdAt),
      startedAt: firstString(value, ["startedAt", "claimedAt"]),
      endedAt: nullableString(value.endedAt),
    }]
  }).sort((a, b) => a.position - b.position)

  const totalItems = finiteInteger(
    rawQueue.totalItems ?? rawQueue.totalCount,
    items.length,
  )

  return {
    queue: {
      id: rawQueue.id,
      ownerUserId: nullableString(rawQueue.ownerUserId),
      status: normalizeStatus(rawQueue.status),
      totalItems,
      createdAt: nullableString(rawQueue.createdAt),
      startedAt: nullableString(rawQueue.startedAt),
      pausedAt: nullableString(rawQueue.pausedAt),
      completedAt: nullableString(rawQueue.completedAt),
      cancelledAt: nullableString(rawQueue.cancelledAt),
    },
    items,
    blockers: stringArray(data.blockers),
  }
}

export function getCurrentQueueItem(items: VoiceCallQueueItemView[]): VoiceCallQueueItemView | null {
  return items.find((item) => ACTIVE_ITEM_STATUSES.has(item.status)) ?? null
}

export function getNextQueueItem(items: VoiceCallQueueItemView[]): VoiceCallQueueItemView | null {
  return items.find((item) => item.status === "pending") ?? null
}

function responseCode(payload: unknown): string | null {
  if (!isRecord(payload)) return null
  if (typeof payload.code === "string") return payload.code
  const blockers = stringArray(payload.blockers)
  return blockers[0] ?? null
}

function requestHeaders(organizationId?: string): Record<string, string> {
  return organizationId ? { "x-organization-id": organizationId } : {}
}

function queueStatusBadgeVariant(status: string): "success" | "warning" | "info" | "destructive" | "outline" {
  if (status === "running") return "success"
  if (status === "paused" || status === "prepared") return "info"
  if (status === "attention_required") return "warning"
  if (status === "cancelled") return "destructive"
  return "outline"
}

function ItemStatusIcon({ status }: { status: string }) {
  if (status === "pending") return <CircleDashed aria-hidden="true" className="h-4 w-4" />
  if (status === "claimed") return <RefreshCw aria-hidden="true" className="h-4 w-4" />
  if (status === "dispatching" || status === "waiting_terminal") return <PhoneCall aria-hidden="true" className="h-4 w-4" />
  if (status === "dispatch_uncertain") return <AlertTriangle aria-hidden="true" className="h-4 w-4" />
  if (status === "completed") return <CheckCircle2 aria-hidden="true" className="h-4 w-4" />
  if (status === "skipped") return <SkipForward aria-hidden="true" className="h-4 w-4" />
  if (status === "cancelled") return <Square aria-hidden="true" className="h-4 w-4" />
  return <XCircle aria-hidden="true" className="h-4 w-4" />
}

function queueItemLabel(item: VoiceCallQueueItemView, fallback: string): string {
  return item.leadLabel?.trim() || fallback
}

export function VoiceCallQueueWorkspace({
  queueId,
  ownerUserId: initialOwnerUserId,
  organizationId,
  canResolveUncertain = false,
}: {
  queueId: string
  ownerUserId?: string
  organizationId?: string
  canResolveUncertain?: boolean
}) {
  const t = useTranslations("voiceCallQueue")
  const locale = useLocale()
  const [detail, setDetail] = useState<VoiceCallQueueDetailView | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<"generic" | "notFound" | "ownerRequired" | null>(null)
  const [queueDisabled, setQueueDisabled] = useState(false)
  const [pendingAction, setPendingAction] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [showSkip, setShowSkip] = useState(false)
  const [skipReason, setSkipReason] = useState("seller_skipped")
  const [showCancel, setShowCancel] = useState(false)
  const [showUncertainResolution, setShowUncertainResolution] = useState(false)
  const [acknowledgeNoRedial, setAcknowledgeNoRedial] = useState(false)
  const detailAbortRef = useRef<AbortController | null>(null)
  const actionAbortRef = useRef<AbortController | null>(null)

  const ownerUserId = initialOwnerUserId ?? detail?.queue.ownerUserId ?? undefined
  const pollingStatus = detail?.queue.status ?? null

  const loadQueue = useCallback(async (silent = false) => {
    detailAbortRef.current?.abort()
    const controller = new AbortController()
    detailAbortRef.current = controller
    if (!silent) setLoading(true)

    try {
      const query = initialOwnerUserId
        ? `?ownerUserId=${encodeURIComponent(initialOwnerUserId)}`
        : ""
      const response = await fetch(`/api/v1/voice-call-queues/${encodeURIComponent(queueId)}${query}`, {
        headers: requestHeaders(organizationId),
        cache: "no-store",
        signal: controller.signal,
      })
      const payload: unknown = await response.json().catch(() => ({}))
      if (controller.signal.aborted) return

      if (response.status === 404) {
        setLoadError("notFound")
        return
      }
      if (response.status === 400 && normalizeStatus(responseCode(payload) ?? "") === "owner_scope_required") {
        setLoadError("ownerRequired")
        return
      }
      const normalized = normalizeQueueDetailPayload(payload)
      if (!response.ok || !normalized) {
        setLoadError("generic")
        return
      }

      setDetail(normalized)
      setQueueDisabled(normalized.blockers.some(isVoiceQueueDisabledCode))
      setLoadError(null)
    } catch {
      if (!controller.signal.aborted) setLoadError("generic")
    } finally {
      if (!controller.signal.aborted && !silent) setLoading(false)
      if (detailAbortRef.current === controller) detailAbortRef.current = null
    }
  }, [initialOwnerUserId, organizationId, queueId])

  useEffect(() => {
    void loadQueue()
    return () => {
      detailAbortRef.current?.abort()
      actionAbortRef.current?.abort()
    }
  }, [loadQueue])

  useEffect(() => {
    if (!pollingStatus || TERMINAL_QUEUE_STATUSES.has(pollingStatus)) return
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void loadQueue(true)
    }, 5_000)
    return () => window.clearInterval(interval)
  }, [loadQueue, pollingStatus])

  const runQueueAction = async (action: "start" | "pause" | "resume" | "cancel") => {
    if (!detail || pendingAction) return
    actionAbortRef.current?.abort()
    const controller = new AbortController()
    actionAbortRef.current = controller
    setPendingAction(action)
    setActionError(null)

    try {
      const response = await fetch(`/api/v1/voice-call-queues/${encodeURIComponent(queueId)}/${action}`, {
        method: "POST",
        headers: {
          ...requestHeaders(organizationId),
          "Content-Type": "application/json",
        },
        body: JSON.stringify(ownerUserId ? { ownerUserId } : {}),
        signal: controller.signal,
      })
      const payload: unknown = await response.json().catch(() => ({}))
      if (controller.signal.aborted) return

      if (!response.ok) {
        const code = responseCode(payload)
        if (isVoiceQueueDisabledCode(code)) {
          setQueueDisabled(true)
          setActionError("featureDisabled")
        } else if (response.status === 409) {
          setActionError("stale")
          void loadQueue(true)
        } else {
          setActionError("generic")
        }
        return
      }

      setShowCancel(false)
      await loadQueue(true)
    } catch {
      if (!controller.signal.aborted) setActionError("generic")
    } finally {
      if (!controller.signal.aborted) setPendingAction(null)
      if (actionAbortRef.current === controller) actionAbortRef.current = null
    }
  }

  const skipNext = async () => {
    const nextItem = detail ? getNextQueueItem(detail.items) : null
    if (!nextItem || pendingAction) return
    actionAbortRef.current?.abort()
    const controller = new AbortController()
    actionAbortRef.current = controller
    setPendingAction("skip")
    setActionError(null)

    try {
      const response = await fetch(
        `/api/v1/voice-call-queues/${encodeURIComponent(queueId)}/items/${encodeURIComponent(nextItem.id)}/skip`,
        {
          method: "POST",
          headers: {
            ...requestHeaders(organizationId),
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            reason: skipReason,
            ...(ownerUserId ? { ownerUserId } : {}),
          }),
          signal: controller.signal,
        },
      )
      await response.json().catch(() => ({}))
      if (controller.signal.aborted) return

      if (!response.ok) {
        if (response.status === 409) {
          setActionError("stale")
          void loadQueue(true)
        } else {
          setActionError("generic")
        }
        return
      }

      setShowSkip(false)
      await loadQueue(true)
    } catch {
      if (!controller.signal.aborted) setActionError("generic")
    } finally {
      if (!controller.signal.aborted) setPendingAction(null)
      if (actionAbortRef.current === controller) actionAbortRef.current = null
    }
  }

  const resolveUncertain = async () => {
    const item = detail ? getCurrentQueueItem(detail.items) : null
    if (
      !item
      || item.status !== "dispatch_uncertain"
      || !canResolveUncertain
      || !acknowledgeNoRedial
      || pendingAction
    ) return

    actionAbortRef.current?.abort()
    const controller = new AbortController()
    actionAbortRef.current = controller
    setPendingAction("resolve-uncertain")
    setActionError(null)

    try {
      const response = await fetch(
        `/api/v1/voice-call-queues/${encodeURIComponent(queueId)}/resolve-uncertain`,
        {
          method: "POST",
          headers: {
            ...requestHeaders(organizationId),
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            ...(ownerUserId ? { ownerUserId } : {}),
            itemId: item.id,
            resolution: "unknown_no_redial",
            acknowledgeNoRedial: true,
          }),
          signal: controller.signal,
        },
      )
      const payload: unknown = await response.json().catch(() => ({}))
      if (controller.signal.aborted) return

      if (!response.ok) {
        const code = normalizeStatus(responseCode(payload) ?? "")
        if (code === "uncertain_resolution_too_early") setActionError("uncertainTooEarly")
        else if (code === "uncertain_call_still_active") setActionError("uncertainStillActive")
        else if (code === "uncertain_status_unavailable") setActionError("uncertainStatusUnavailable")
        else if (response.status === 409) {
          setActionError("stale")
          void loadQueue(true)
        } else setActionError("generic")
        return
      }

      setShowUncertainResolution(false)
      setAcknowledgeNoRedial(false)
      await loadQueue(true)
    } catch {
      if (!controller.signal.aborted) setActionError("generic")
    } finally {
      if (!controller.signal.aborted) setPendingAction(null)
      if (actionAbortRef.current === controller) actionAbortRef.current = null
    }
  }

  const currentItem = detail ? getCurrentQueueItem(detail.items) : null
  const nextItem = detail ? getNextQueueItem(detail.items) : null
  const remainingItems = detail?.items.filter((item) => item.status === "pending") ?? []
  const historyItems = detail?.items.filter((item) => TERMINAL_ITEM_STATUSES.has(item.status)) ?? []
  const finishedCount = historyItems.length
  const totalItems = detail?.queue.totalItems || detail?.items.length || 0
  const queueStatus = detail?.queue.status ?? ""
  const canStart = queueStatus === "prepared" && !queueDisabled
  const canPause = queueStatus === "running"
  const canResume = queueStatus === "paused" && !queueDisabled
  const canCancel = !TERMINAL_QUEUE_STATUSES.has(queueStatus) && remainingItems.length > 0
  const canResolveCurrentUncertain = canResolveUncertain
    && queueStatus === "attention_required"
    && currentItem?.status === "dispatch_uncertain"

  const formatDateTime = (value: string | null): string => {
    if (!value) return "—"
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return "—"
    return new Intl.DateTimeFormat(locale, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(date)
  }

  if (loading) {
    return (
      <div className="space-y-5" role="status" aria-live="polite" aria-busy="true">
        <div className="h-9 w-64 animate-pulse rounded bg-muted motion-reduce:animate-none" />
        <div className="h-28 animate-pulse rounded-xl bg-muted motion-reduce:animate-none" />
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(18rem,0.65fr)]">
          <div className="h-80 animate-pulse rounded-xl bg-muted motion-reduce:animate-none" />
          <div className="h-80 animate-pulse rounded-xl bg-muted motion-reduce:animate-none" />
        </div>
        <span className="sr-only">{t("workspaceLoading")}</span>
      </div>
    )
  }

  if (loadError || !detail) {
    const description = loadError === "notFound"
      ? t("workspaceNotFoundDescription")
      : loadError === "ownerRequired"
        ? t("ownerScopeRequired")
        : t("workspaceErrorDescription")
    return (
      <div className="mx-auto max-w-2xl py-12">
        <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-5">
          <div className="flex items-start gap-3">
            <AlertCircle aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
            <div>
              <h1 className="text-base font-semibold">{t("workspaceErrorTitle")}</h1>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">{description}</p>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={() => void loadQueue()}>
              <RefreshCw aria-hidden="true" className="h-4 w-4" />
              {t("retry")}
            </Button>
            <Button asChild variant="ghost">
              <Link href="/leads">
                <ArrowLeft aria-hidden="true" className="h-4 w-4" />
                {t("backToLeads")}
              </Link>
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <Link
            href="/leads"
            className="mb-2 inline-flex min-h-9 items-center gap-1.5 rounded-lg text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
          >
            <ArrowLeft aria-hidden="true" className="h-4 w-4" />
            {t("backToLeads")}
          </Link>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight">{t("workspaceTitle")}</h1>
            <Badge variant={queueStatusBadgeVariant(queueStatus)}>
              {t(queueStatusTranslationKey(queueStatus))}
            </Badge>
          </div>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">
            {t("sequencePromise")}
          </p>
        </div>
        <Button type="button" variant="outline" onClick={() => void loadQueue(true)} disabled={pendingAction !== null}>
          <RefreshCw aria-hidden="true" className="h-4 w-4" />
          {t("refresh")}
        </Button>
      </header>

      {queueDisabled ? (
        <div role="status" className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-950 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-100">
          <ShieldAlert aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <p className="text-sm font-semibold">{t("featureDisabledTitle")}</p>
            <p className="mt-1 text-sm leading-6">{t("featureDisabledWorkspaceDescription")}</p>
          </div>
        </div>
      ) : null}

      {queueStatus === "attention_required" ? (
        <div role="alert" className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-950 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-100">
          <AlertTriangle aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">{t("attentionTitle")}</p>
            <p className="mt-1 text-sm leading-6">{t("attentionDescription")}</p>
            {canResolveCurrentUncertain ? (
              <div className="mt-3">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setShowUncertainResolution((value) => !value)
                    setAcknowledgeNoRedial(false)
                    setActionError(null)
                  }}
                  disabled={pendingAction !== null}
                  className="border-amber-400 bg-background/80 text-foreground hover:bg-background"
                >
                  {t("resolveUncertain")}
                </Button>

                {showUncertainResolution ? (
                  <div className="mt-3 rounded-lg border border-amber-300/80 bg-background/80 p-3 text-foreground dark:border-amber-800">
                    <p className="text-sm font-semibold">{t("resolveUncertainTitle")}</p>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      {t("resolveUncertainDescription")}
                    </p>
                    <label className="mt-3 flex min-h-11 cursor-pointer items-start gap-2 rounded-md py-2 text-sm">
                      <input
                        type="checkbox"
                        checked={acknowledgeNoRedial}
                        onChange={(event) => setAcknowledgeNoRedial(event.target.checked)}
                        className="mt-0.5 h-4 w-4 rounded border-zinc-300 accent-primary"
                      />
                      <span>{t("resolveUncertainAcknowledge")}</span>
                    </label>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => {
                          setShowUncertainResolution(false)
                          setAcknowledgeNoRedial(false)
                        }}
                        disabled={pendingAction !== null}
                      >
                        {t("resolveUncertainCancel")}
                      </Button>
                      <Button
                        type="button"
                        onClick={() => void resolveUncertain()}
                        disabled={!acknowledgeNoRedial || pendingAction !== null}
                      >
                        {pendingAction === "resolve-uncertain" ? (
                          <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin motion-reduce:animate-none" />
                        ) : null}
                        {t("resolveUncertainConfirm")}
                      </Button>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      <section aria-labelledby="queue-progress-title" className="rounded-xl border border-zinc-200 bg-card p-4 dark:border-zinc-700 sm:p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 id="queue-progress-title" className="text-sm font-semibold">{t("progressTitle")}</h2>
            <p className="mt-1 text-xs text-muted-foreground">{t("createdAt", { date: formatDateTime(detail.queue.createdAt) })}</p>
          </div>
          <p className="text-sm font-semibold tabular-nums">
            {t("progressCount", { completed: finishedCount, total: totalItems })}
          </p>
        </div>
        <Progress
          value={finishedCount}
          max={Math.max(1, totalItems)}
          className="mt-3 h-2.5"
          aria-label={t("progressCount", { completed: finishedCount, total: totalItems })}
        />
        <dl className="mt-4 grid grid-cols-3 divide-x divide-zinc-200 rounded-lg bg-muted/50 py-3 dark:divide-zinc-700">
          <div className="px-3 text-center">
            <dt className="text-xs text-muted-foreground">{t("currentCount")}</dt>
            <dd className="mt-1 text-lg font-semibold tabular-nums">{currentItem ? 1 : 0}</dd>
          </div>
          <div className="px-3 text-center">
            <dt className="text-xs text-muted-foreground">{t("remainingCount")}</dt>
            <dd className="mt-1 text-lg font-semibold tabular-nums">{remainingItems.length}</dd>
          </div>
          <div className="px-3 text-center">
            <dt className="text-xs text-muted-foreground">{t("finishedCount")}</dt>
            <dd className="mt-1 text-lg font-semibold tabular-nums">{finishedCount}</dd>
          </div>
        </dl>
      </section>

      <section aria-label={t("controlsTitle")} className="rounded-xl border border-zinc-200 bg-card p-4 dark:border-zinc-700">
        <div className="flex flex-wrap items-center gap-2">
          {canStart ? (
            <Button type="button" onClick={() => void runQueueAction("start")} disabled={pendingAction !== null || queueDisabled}>
              {pendingAction === "start"
                ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin motion-reduce:animate-none" />
                : <Play aria-hidden="true" className="h-4 w-4" />}
              {t("startQueue")}
            </Button>
          ) : null}
          {canPause ? (
            <Button type="button" variant="outline" onClick={() => void runQueueAction("pause")} disabled={pendingAction !== null}>
              {pendingAction === "pause"
                ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin motion-reduce:animate-none" />
                : <Pause aria-hidden="true" className="h-4 w-4" />}
              {t("pauseAfterCurrent")}
            </Button>
          ) : null}
          {canResume ? (
            <Button type="button" onClick={() => void runQueueAction("resume")} disabled={pendingAction !== null || queueDisabled}>
              {pendingAction === "resume"
                ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin motion-reduce:animate-none" />
                : <RotateCcw aria-hidden="true" className="h-4 w-4" />}
              {t("resumeQueue")}
            </Button>
          ) : null}
          <Button
            type="button"
            variant="outline"
            onClick={() => { setShowSkip((value) => !value); setShowCancel(false) }}
            disabled={!nextItem || pendingAction !== null}
          >
            <SkipForward aria-hidden="true" className="h-4 w-4" />
            {t("skipNext")}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => { setShowCancel((value) => !value); setShowSkip(false) }}
            disabled={!canCancel || pendingAction !== null}
            className="text-destructive hover:text-destructive"
          >
            <Square aria-hidden="true" className="h-4 w-4" />
            {t("cancelRemaining")}
          </Button>
          <Button asChild variant="ghost" className={cn("sm:ml-auto", !currentItem && "pointer-events-none opacity-50")}>
            <Link
              href={currentItem ? `/leads/${encodeURIComponent(currentItem.leadId)}` : "#"}
              aria-disabled={!currentItem}
              tabIndex={currentItem ? undefined : -1}
            >
              <ExternalLink aria-hidden="true" className="h-4 w-4" />
              {t("openCurrentLead")}
            </Link>
          </Button>
        </div>

        {showSkip && nextItem ? (
          <div className="mt-4 flex flex-col gap-3 rounded-lg bg-muted/60 p-3 sm:flex-row sm:items-end">
            <div className="min-w-0 flex-1">
              <label htmlFor="voice-queue-skip-reason" className="text-xs font-medium">
                {t("skipReasonLabel")}
              </label>
              <select
                id="voice-queue-skip-reason"
                value={skipReason}
                onChange={(event) => setSkipReason(event.target.value)}
                className="mt-1.5 min-h-11 w-full rounded-lg border border-zinc-300 bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 dark:border-zinc-700"
              >
                <option value="seller_skipped">{t("skipReasonManual")}</option>
                <option value="not_relevant">{t("skipReasonNotRelevant")}</option>
                <option value="duplicate_lead">{t("skipReasonDuplicate")}</option>
                <option value="other">{t("skipReasonOther")}</option>
              </select>
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="ghost" onClick={() => setShowSkip(false)}>{t("keepInQueue")}</Button>
              <Button type="button" onClick={() => void skipNext()} disabled={pendingAction !== null}>
                {pendingAction === "skip" ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : null}
                {t("confirmSkip")}
              </Button>
            </div>
          </div>
        ) : null}

        {showCancel ? (
          <div className="mt-4 flex flex-col gap-3 rounded-lg bg-destructive/5 p-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-semibold">{t("cancelConfirmTitle")}</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">{t("cancelConfirmDescription")}</p>
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="ghost" onClick={() => setShowCancel(false)}>{t("keepQueue")}</Button>
              <Button type="button" variant="destructive" onClick={() => void runQueueAction("cancel")} disabled={pendingAction !== null}>
                {pendingAction === "cancel" ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : null}
                {t("confirmCancel")}
              </Button>
            </div>
          </div>
        ) : null}

        {actionError ? (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {actionError === "featureDisabled"
              ? t("featureDisabledDescription")
              : actionError === "stale"
                ? t("actionStale")
                : actionError === "uncertainTooEarly"
                  ? t("resolveUncertainTooEarly")
                  : actionError === "uncertainStillActive"
                    ? t("resolveUncertainStillActive")
                    : actionError === "uncertainStatusUnavailable"
                      ? t("resolveUncertainStatusUnavailable")
                : t("actionFailed")}
          </p>
        ) : null}
      </section>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(18rem,0.65fr)]">
        <div className="space-y-5">
          <section aria-labelledby="current-call-title" className="rounded-xl border border-zinc-200 bg-card dark:border-zinc-700">
            <header className="border-b border-zinc-200 px-4 py-3.5 dark:border-zinc-700">
              <div className="flex items-center justify-between gap-3">
                <h2 id="current-call-title" className="text-sm font-semibold">{t("currentCallTitle")}</h2>
                <span className="text-xs text-muted-foreground">{t("oneAtATime")}</span>
              </div>
            </header>
            {currentItem ? (
              <div className="p-4 sm:p-5" aria-live="polite">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <ItemStatusIcon status={currentItem.status} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-base font-semibold">
                      {queueItemLabel(currentItem, t("leadPosition", { position: currentItem.position }))}
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {t(queueItemStatusTranslationKey(currentItem.status))}
                    </p>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {t("startedAt", { date: formatDateTime(currentItem.startedAt) })}
                    </p>
                  </div>
                  <span className="text-sm font-semibold tabular-nums">#{currentItem.position}</span>
                </div>
              </div>
            ) : (
              <div className="px-4 py-8 text-center sm:px-5">
                <p className="text-sm font-medium">{t("noCurrentCallTitle")}</p>
                <p className="mx-auto mt-1 max-w-xl text-xs leading-5 text-muted-foreground">
                  {queueStatus === "paused" ? t("noCurrentPaused") : t("noCurrentCallDescription")}
                </p>
              </div>
            )}
          </section>

          <section aria-labelledby="remaining-calls-title" className="rounded-xl border border-zinc-200 bg-card dark:border-zinc-700">
            <header className="flex items-center justify-between gap-3 border-b border-zinc-200 px-4 py-3.5 dark:border-zinc-700">
              <h2 id="remaining-calls-title" className="text-sm font-semibold">{t("remainingTitle")}</h2>
              <span className="text-xs font-medium tabular-nums text-muted-foreground">{remainingItems.length}</span>
            </header>
            {remainingItems.length > 0 ? (
              <ol className="divide-y divide-zinc-200 dark:divide-zinc-700">
                {remainingItems.map((item, index) => (
                  <li key={item.id} className="flex min-h-14 items-center gap-3 px-4 py-3">
                    <span className={cn(
                      "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums",
                      index === 0 ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
                    )}>
                      {item.position}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {queueItemLabel(item, t("leadPosition", { position: item.position }))}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {index === 0 ? t("nextCall") : t("waitingInOrder")}
                      </p>
                    </div>
                    <Button asChild variant="ghost" size="icon">
                      <Link href={`/leads/${encodeURIComponent(item.leadId)}`} aria-label={t("openLead")}>
                        <ExternalLink aria-hidden="true" className="h-4 w-4" />
                      </Link>
                    </Button>
                  </li>
                ))}
              </ol>
            ) : (
              <div className="px-4 py-8 text-center">
                <p className="text-sm font-medium">{t("noRemainingTitle")}</p>
                <p className="mt-1 text-xs text-muted-foreground">{t("noRemainingDescription")}</p>
              </div>
            )}
          </section>
        </div>

        <section aria-labelledby="queue-history-title" className="h-fit rounded-xl border border-zinc-200 bg-card dark:border-zinc-700">
          <header className="flex items-center justify-between gap-3 border-b border-zinc-200 px-4 py-3.5 dark:border-zinc-700">
            <h2 id="queue-history-title" className="text-sm font-semibold">{t("historyTitle")}</h2>
            <ListOrdered aria-hidden="true" className="h-4 w-4 text-muted-foreground" />
          </header>
          {historyItems.length > 0 ? (
            <ol className="divide-y divide-zinc-200 dark:divide-zinc-700">
              {[...historyItems].reverse().map((item) => (
                <li key={item.id} className="flex items-start gap-3 px-4 py-3">
                  <span className={cn(
                    "mt-0.5 shrink-0",
                    item.status === "completed" ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground",
                  )}>
                    <ItemStatusIcon status={item.status} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {queueItemLabel(item, t("leadPosition", { position: item.position }))}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {t(queueItemStatusTranslationKey(item.status))}
                    </p>
                  </div>
                  <span className="text-xs tabular-nums text-muted-foreground">#{item.position}</span>
                </li>
              ))}
            </ol>
          ) : (
            <div className="px-4 py-8 text-center">
              <p className="text-sm text-muted-foreground">{t("historyEmpty")}</p>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
