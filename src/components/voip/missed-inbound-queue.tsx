"use client"

import { useCallback, useEffect, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { useRouter } from "next/navigation"
import { AlertTriangle, ArrowUpRight, Loader2, PhoneMissed, RefreshCw } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { formatDateTime } from "@/lib/format-date"

export type MissedInboundQueueItem = {
  taskId: string
  status: string
  missedAt: string
  leadId: string
}

function record(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0
}

export function normalizeMissedInboundQueuePayload(
  payload: unknown,
): MissedInboundQueueItem[] | null {
  const envelope = record(payload)
  if (envelope?.success !== true || !Array.isArray(envelope.data)) return null

  return envelope.data.flatMap((candidate) => {
    const item = record(candidate)
    if (
      !item
      || !nonEmptyString(item.taskId)
      || !nonEmptyString(item.status)
      || !nonEmptyString(item.missedAt)
      || !nonEmptyString(item.leadId)
      || Number.isNaN(Date.parse(item.missedAt))
    ) {
      return []
    }
    return [{
      taskId: item.taskId,
      status: item.status,
      missedAt: item.missedAt,
      leadId: item.leadId,
    }]
  })
}

export function MissedInboundQueue() {
  const t = useTranslations("voip.missedInboundQueue")
  const locale = useLocale()
  const router = useRouter()
  const [items, setItems] = useState<MissedInboundQueueItem[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [claimingTaskId, setClaimingTaskId] = useState<string | null>(null)

  const loadQueue = useCallback(async () => {
    setLoading(true)
    setLoadError(false)
    try {
      const response = await fetch("/api/v1/calls/missed-inbound-queue", {
        cache: "no-store",
      })
      if (!response.ok) throw new Error("queue_request_failed")
      const normalized = normalizeMissedInboundQueuePayload(await response.json())
      if (!normalized) throw new Error("queue_payload_invalid")
      setItems(normalized)
    } catch {
      setLoadError(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadQueue()
  }, [loadQueue])

  const claimAndOpen = async (item: MissedInboundQueueItem) => {
    if (claimingTaskId) return
    setClaimingTaskId(item.taskId)
    try {
      const response = await fetch(
        `/api/v1/calls/missed-inbound-queue/${encodeURIComponent(item.taskId)}/claim`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        },
      )
      if (response.status === 409) {
        toast.info(t("claimedElsewhere"))
        await loadQueue()
        return
      }
      if (!response.ok) throw new Error("queue_claim_failed")

      const payload = record(await response.json())
      const data = record(payload?.data)
      if (payload?.success !== true || !nonEmptyString(data?.leadId)) {
        throw new Error("queue_claim_payload_invalid")
      }
      router.push(`/leads/${encodeURIComponent(data.leadId)}`)
    } catch {
      toast.error(t("claimFailed"))
    } finally {
      setClaimingTaskId(null)
    }
  }

  return (
    <section
      aria-labelledby="missed-inbound-queue-title"
      className="overflow-hidden rounded-xl border border-orange-200/80 bg-card shadow-[0_1px_3px_rgba(0,0,0,0.05)] dark:border-orange-900/60"
    >
      <div className="flex items-start gap-3 border-b border-orange-100 bg-orange-50/70 px-4 py-4 dark:border-orange-900/50 dark:bg-orange-950/20 sm:px-5">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-orange-100 text-orange-700 dark:bg-orange-900/50 dark:text-orange-300">
          <PhoneMissed className="h-5 w-5" aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <h2 id="missed-inbound-queue-title" className="font-semibold tracking-tight">
            {t("title")}
          </h2>
          <p className="mt-1 text-sm leading-5 text-muted-foreground">
            {t("description")}
          </p>
        </div>
      </div>

      <div className="p-4 sm:p-5" aria-live="polite">
        {loading ? (
          <div className="space-y-3" aria-label={t("loading")}>
            {[0, 1].map((row) => (
              <div key={row} className="h-16 animate-pulse rounded-lg bg-muted motion-reduce:animate-none" />
            ))}
          </div>
        ) : loadError ? (
          <div role="alert" className="flex flex-col gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-red-900 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-100 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-2 text-sm">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{t("loadError")}</span>
            </div>
            <Button type="button" variant="outline" className="min-h-11 shrink-0" onClick={() => void loadQueue()}>
              <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
              {t("retry")}
            </Button>
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-lg border border-dashed px-5 py-8 text-center">
            <PhoneMissed className="mx-auto h-7 w-7 text-muted-foreground" aria-hidden="true" />
            <h3 className="mt-3 text-sm font-semibold">{t("emptyTitle")}</h3>
            <p className="mx-auto mt-1 max-w-xl text-sm leading-5 text-muted-foreground">
              {t("emptyDescription")}
            </p>
          </div>
        ) : (
          <ul className="divide-y rounded-lg border">
            {items.map((item) => {
              const claiming = claimingTaskId === item.taskId
              return (
                <li key={item.taskId} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      {t("missedAt", {
                        time: formatDateTime(item.missedAt, locale, {
                          day: "2-digit",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        }),
                      })}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">{t("statusOpen")}</p>
                  </div>
                  <Button
                    type="button"
                    className="min-h-11 shrink-0"
                    disabled={claimingTaskId !== null}
                    onClick={() => void claimAndOpen(item)}
                  >
                    {claiming ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                    ) : (
                      <ArrowUpRight className="mr-2 h-4 w-4" aria-hidden="true" />
                    )}
                    {t("claimAndOpen")}
                  </Button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </section>
  )
}
