"use client"

import { useCallback, useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { AlertTriangle, ArrowDown, Building2, CheckCircle2, ClipboardCheck } from "lucide-react"

type NeedsAttention = {
  total: number
  categories: {
    routeChanges: { count: number }
    customerRequests: { count: number }
  }
}

interface RouteNeedsAttentionProps {
  active: boolean
  orgId?: string
  refreshVersion: number
}

const EMPTY_NEEDS_ATTENTION: NeedsAttention = {
  total: 0,
  categories: {
    routeChanges: { count: 0 },
    customerRequests: { count: 0 },
  },
}

/** Additive, keyboard-safe summary. The queues below remain the source of truth. */
export function MtmRouteNeedsAttention({ active, orgId, refreshVersion }: RouteNeedsAttentionProps) {
  const t = useTranslations("mtmRoutesPage")
  const [data, setData] = useState<NeedsAttention>(EMPTY_NEEDS_ATTENTION)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)

  const load = useCallback(async (signal: AbortSignal) => {
    if (!active) return
    setLoading(true)
    setFailed(false)
    try {
      const response = await fetch("/api/v1/mtm/routes/needs-attention", {
        headers: orgId ? { "x-organization-id": orgId } : {},
        signal,
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error ?? "needs-attention-load-failed")
      const next = result.data as NeedsAttention | undefined
      if (!next || !Number.isFinite(next.total)) throw new Error("needs-attention-invalid-response")
      setData(next)
    } catch (error) {
      if ((error as { name?: string })?.name !== "AbortError") setFailed(true)
    } finally {
      if (!signal.aborted) setLoading(false)
    }
  }, [active, orgId])

  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [load, refreshVersion])

  if (!active) return null

  return (
    <section className="overflow-hidden rounded-xl border border-zinc-200 bg-card dark:border-zinc-700" aria-labelledby="mtm-needs-attention-heading">
      <div className="flex flex-col gap-3 border-b border-zinc-200 px-4 py-4 dark:border-zinc-700 sm:flex-row sm:items-start sm:justify-between sm:px-5">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
              <AlertTriangle className="h-4 w-4" aria-hidden="true" />
            </span>
            <h2 id="mtm-needs-attention-heading" className="text-base font-semibold">{t("needsAttentionTitle")}</h2>
          </div>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{t("needsAttentionDescription")}</p>
        </div>
        {!loading && !failed ? (
          <p className="shrink-0 text-sm font-medium" aria-live="polite">
            {data.total > 0 ? t("needsAttentionTotal", { count: data.total }) : t("needsAttentionClearTitle")}
          </p>
        ) : null}
      </div>

      <div className="p-4 sm:p-5" aria-live="polite">
        {loading ? <div className="h-20 animate-pulse rounded-lg bg-muted/60 motion-reduce:animate-none" aria-label={t("needsAttentionLoading")} /> : null}
        {!loading && failed ? <p role="status" className="text-sm text-muted-foreground">{t("needsAttentionLoadFailed")}</p> : null}
        {!loading && !failed && data.total === 0 ? (
          <div className="flex items-start gap-3 text-sm text-muted-foreground">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
            <p>{t("needsAttentionClearDescription")}</p>
          </div>
        ) : null}
        {!loading && !failed && data.total > 0 ? (
          <div className="grid gap-3 md:grid-cols-2">
            <a href="#mtm-route-approval-queue" className="group flex min-h-11 items-center gap-3 rounded-lg border border-zinc-200 px-3 py-3 text-left outline-none transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-primary dark:border-zinc-700">
              <ClipboardCheck className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold">{t("needsAttentionRouteChanges", { count: data.categories.routeChanges.count })}</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">{t("needsAttentionRouteChangesHint")}</span>
              </span>
              <ArrowDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-y-0.5" aria-hidden="true" />
            </a>
            <a href="#mtm-customer-approval-queue" className="group flex min-h-11 items-center gap-3 rounded-lg border border-zinc-200 px-3 py-3 text-left outline-none transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-primary dark:border-zinc-700">
              <Building2 className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold">{t("needsAttentionCustomerRequests", { count: data.categories.customerRequests.count })}</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">{t("needsAttentionCustomerRequestsHint")}</span>
              </span>
              <ArrowDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-y-0.5" aria-hidden="true" />
            </a>
          </div>
        ) : null}
      </div>
    </section>
  )
}
