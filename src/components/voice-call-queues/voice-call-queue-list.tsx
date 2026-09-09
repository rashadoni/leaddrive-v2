"use client"

import Link from "next/link"
import { useCallback, useEffect, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Bot,
  Check,
  ListOrdered,
  Loader2,
  MousePointerClick,
  Plus,
  RefreshCw,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { queueStatusTranslationKey } from "@/components/voice-call-queues/voice-call-queue-workspace"

interface QueueSummary {
  id: string
  ownerUserId: string | null
  status: string
  totalItems: number
  pendingCount: number
  activeCount: number
  finishedCount: number
  createdAt: string | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function finiteInteger(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.floor(value))
    : fallback
}

export function normalizeQueueListPayload(payload: unknown): QueueSummary[] | null {
  if (!isRecord(payload) || payload.success !== true || !isRecord(payload.data)) return null
  const rawQueues = Array.isArray(payload.data.queues)
    ? payload.data.queues
    : Array.isArray(payload.data.items)
      ? payload.data.items
      : null
  if (!rawQueues) return null

  return rawQueues.flatMap((value): QueueSummary[] => {
    if (!isRecord(value) || typeof value.id !== "string" || typeof value.status !== "string") return []
    const totalItems = finiteInteger(value.totalItems ?? value.totalCount)
    const counts = isRecord(value.counts) ? value.counts : {}
    const pendingCount = finiteInteger(value.pendingCount ?? value.queuedCount ?? counts.pending)
    const activeCount = finiteInteger(
      value.activeCount,
      finiteInteger(counts.claimed)
        + finiteInteger(counts.dispatching)
        + finiteInteger(counts.waiting_terminal)
        + finiteInteger(counts.dispatch_uncertain),
    )
    const terminalCount = finiteInteger(counts.completed)
      + finiteInteger(counts.no_answer)
      + finiteInteger(counts.busy)
      + finiteInteger(counts.failed)
      + finiteInteger(counts.cancelled)
      + finiteInteger(counts.blocked)
      + finiteInteger(counts.skipped)
    const explicitFinished = value.finishedCount ?? value.completedCount ?? terminalCount
    const finishedCount = finiteInteger(
      explicitFinished,
      Math.max(0, totalItems - pendingCount - activeCount),
    )
    return [{
      id: value.id,
      ownerUserId: typeof value.ownerUserId === "string" ? value.ownerUserId : null,
      status: value.status.trim().toLowerCase().replace(/[\s-]+/g, "_"),
      totalItems,
      pendingCount,
      activeCount,
      finishedCount,
      createdAt: typeof value.createdAt === "string" ? value.createdAt : null,
    }]
  })
}

function requestHeaders(organizationId?: string): Record<string, string> {
  return organizationId ? { "x-organization-id": organizationId } : {}
}

function statusVariant(status: string): "success" | "warning" | "info" | "destructive" | "outline" {
  if (status === "running") return "success"
  if (status === "paused" || status === "prepared") return "info"
  if (status === "attention_required") return "warning"
  if (status === "cancelled") return "destructive"
  return "outline"
}

export function VoiceCallQueueList({
  ownerUserId,
  organizationId,
}: {
  ownerUserId?: string
  organizationId?: string
}) {
  const t = useTranslations("voiceCallQueue")
  const locale = useLocale()
  const [queues, setQueues] = useState<QueueSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const semiAutomaticSteps = [
    { id: "select", label: t("semiAutomaticStep1") },
    { id: "review", label: t("semiAutomaticStep2") },
    { id: "start", label: t("semiAutomaticStep3") },
  ]

  const loadQueues = useCallback(async () => {
    setLoading(true)
    try {
      const query = ownerUserId ? `?ownerUserId=${encodeURIComponent(ownerUserId)}` : ""
      const response = await fetch(`/api/v1/voice-call-queues${query}`, {
        headers: requestHeaders(organizationId),
        cache: "no-store",
      })
      const payload: unknown = await response.json().catch(() => ({}))
      const normalized = normalizeQueueListPayload(payload)
      if (!response.ok || !normalized) throw new Error("invalid_queue_list")
      setQueues(normalized)
      setError(false)
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [organizationId, ownerUserId])

  useEffect(() => {
    void loadQueues()
  }, [loadQueues])

  const formatDate = (value: string | null): string => {
    if (!value) return "—"
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return "—"
    return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(date)
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Link
            href="/leads"
            className="mb-2 inline-flex min-h-9 items-center gap-1.5 rounded-lg text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
          >
            <ArrowLeft aria-hidden="true" className="h-4 w-4" />
            {t("backToLeads")}
          </Link>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <ListOrdered aria-hidden="true" className="h-6 w-6 text-primary" />
            {t("listTitle")}
          </h1>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">
            {t("sequencePromise")}
          </p>
        </div>
        <Button asChild>
          <Link href="/leads">
            <Plus aria-hidden="true" className="h-4 w-4" />
            {t("prepareFromLeads")}
          </Link>
        </Button>
      </header>

      <section
        aria-labelledby="voice-call-queue-modes-title"
        className="grid gap-3 lg:grid-cols-2"
      >
        <h2 id="voice-call-queue-modes-title" className="sr-only">
          {t("modesTitle")}
        </h2>
        <div className="rounded-xl border border-zinc-200 bg-card p-5 dark:border-zinc-700">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <MousePointerClick aria-hidden="true" className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-semibold">{t("semiAutomaticTitle")}</h3>
                <Badge variant="info">{t("modeCurrent")}</Badge>
              </div>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                {t("semiAutomaticDescription")}
              </p>
            </div>
          </div>
          <ol className="mt-4 grid gap-2 text-sm">
            {semiAutomaticSteps.map((step, index) => (
              <li key={step.id} className="flex items-start gap-2.5">
                <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-muted text-xs font-semibold tabular-nums text-muted-foreground">
                  {index + 1}
                </span>
                <span className="leading-5">{step.label}</span>
              </li>
            ))}
          </ol>
        </div>

        <div className="rounded-xl border border-dashed border-zinc-300 bg-muted/20 p-5 dark:border-zinc-700">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
              <Bot aria-hidden="true" className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-semibold">{t("automaticTitle")}</h3>
                <Badge variant="outline">{t("modeUnavailable")}</Badge>
              </div>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                {t("automaticDescription")}
              </p>
            </div>
          </div>
          <div className="mt-4 flex items-start gap-2.5 rounded-lg border border-zinc-200 bg-background/60 px-3 py-2.5 text-sm dark:border-zinc-700">
            <Check aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <p className="leading-5 text-muted-foreground">{t("automaticSafety")}</p>
          </div>
        </div>
      </section>

      {loading ? (
        <div role="status" aria-live="polite" aria-busy="true" className="space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin motion-reduce:animate-none" />
            {t("listLoading")}
          </div>
          {[0, 1, 2].map((item) => (
            <div key={item} className="h-24 animate-pulse rounded-xl bg-muted motion-reduce:animate-none" aria-hidden="true" />
          ))}
        </div>
      ) : null}

      {!loading && error ? (
        <div role="alert" className="flex flex-col gap-4 rounded-xl border border-destructive/30 bg-destructive/5 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <AlertCircle aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
            <div>
              <p className="text-sm font-semibold">{t("listErrorTitle")}</p>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">{t("listErrorDescription")}</p>
            </div>
          </div>
          <Button type="button" variant="outline" onClick={() => void loadQueues()}>
            <RefreshCw aria-hidden="true" className="h-4 w-4" />
            {t("retry")}
          </Button>
        </div>
      ) : null}

      {!loading && !error && queues.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-300 px-5 py-12 text-center dark:border-zinc-700">
          <ListOrdered aria-hidden="true" className="mx-auto h-8 w-8 text-muted-foreground" />
          <h2 className="mt-3 text-base font-semibold">{t("listEmptyTitle")}</h2>
          <p className="mx-auto mt-1 max-w-xl text-sm leading-6 text-muted-foreground">{t("listEmptyDescription")}</p>
          <Button asChild className="mt-4">
            <Link href="/leads">{t("prepareFromLeads")}</Link>
          </Button>
        </div>
      ) : null}

      {!loading && !error && queues.length > 0 ? (
        <ol className="divide-y divide-zinc-200 overflow-hidden rounded-xl border border-zinc-200 bg-card dark:divide-zinc-700 dark:border-zinc-700">
          {queues.map((queue) => {
            const queryOwner = queue.ownerUserId ?? ownerUserId
            const href = `/voip/call-queues/${encodeURIComponent(queue.id)}${queryOwner ? `?ownerUserId=${encodeURIComponent(queryOwner)}` : ""}`
            return (
              <li key={queue.id}>
                <Link
                  href={href}
                  className="group block px-4 py-4 transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/30 sm:px-5"
                >
                  <div className="flex items-start gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold">{t("queueCreated", { date: formatDate(queue.createdAt) })}</p>
                        <Badge variant={statusVariant(queue.status)}>{t(queueStatusTranslationKey(queue.status))}</Badge>
                      </div>
                      <div className="mt-3 flex items-center gap-3">
                        <Progress value={queue.finishedCount} max={Math.max(1, queue.totalItems)} className="max-w-md" />
                        <span className="shrink-0 text-xs font-medium tabular-nums text-muted-foreground">
                          {t("progressCount", { completed: queue.finishedCount, total: queue.totalItems })}
                        </span>
                      </div>
                      <p className="mt-2 text-xs text-muted-foreground">
                        {t("queueCounts", { active: queue.activeCount, remaining: queue.pendingCount })}
                      </p>
                    </div>
                    <ArrowRight aria-hidden="true" className="mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 motion-reduce:transform-none" />
                  </div>
                </Link>
              </li>
            )
          })}
        </ol>
      ) : null}
    </div>
  )
}
