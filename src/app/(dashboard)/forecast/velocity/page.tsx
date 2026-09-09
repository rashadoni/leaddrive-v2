"use client"

/**
 * A12 Deal Velocity — slice-2 UI.
 *
 * Per-stage avg/p50/p90 duration cards + bottleneck flags. Bottlenecks
 * (p90 > 30 days) bubble to the top so sales managers see them first.
 */
import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { useTranslations } from "next-intl"
import { useStageLabel } from "@/lib/status-labels"
import { MotionPage, MotionCard } from "@/components/ui/motion"
import { HelpButton } from "@/components/help/help-button"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import {
  AlertCircle,
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  CheckCircle2,
  ChevronRight,
  Clock,
  ExternalLink,
  Gauge,
  Info,
  Loader2,
  XCircle,
} from "lucide-react"

interface VelocityStage {
  pipelineId: string
  stage: string
  periodKey: string
  dealsEntered: number
  dealsExited: number
  dealsAdvanced: number
  dealsRegressed: number
  dealsLost: number
  dealsWon: number
  avgDurationSeconds: number | null
  p50DurationSeconds: number | null
  p90DurationSeconds: number | null
  conversionRate: number | null
  isBottleneck: boolean
  detailDeals: Array<{
    id: string
    name: string
    ownerName: string | null
    valueAmount: number
    currency: string
    currentStage: string
    durationSeconds: number
    transitionType: string
    transitionedAt: string
  }>
}

interface VelocityResponse {
  periodKey: string
  periodStart: string
  periodEnd: string
  pipelineId: string | null
  stages: VelocityStage[]
  totalStages: number
  bottleneckCount: number
}

function formatDuration(
  seconds: number | null,
  units: { days: string; hours: string; minutes: string },
): string {
  if (seconds === null) return "—"
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  if (days >= 1) return hours > 0
    ? `${days} ${units.days} ${hours} ${units.hours}`
    : `${days} ${units.days}`
  if (hours >= 1) {
    const mins = Math.floor((seconds % 3600) / 60)
    return mins > 0
      ? `${hours} ${units.hours} ${mins} ${units.minutes}`
      : `${hours} ${units.hours}`
  }
  const mins = Math.floor(seconds / 60)
  return `${mins} ${units.minutes}`
}

function formatPct(rate: number | null): string {
  if (rate === null) return "—"
  return `${Math.round(rate * 100)}%`
}

export default function VelocityPage() {
  const t = useTranslations("slice2.dealVelocity")
  const tc = useTranslations("slice2.common")
  const stageLabel = useStageLabel()
  const durationUnits = {
    days: t("durationDaysShort"),
    hours: t("durationHoursShort"),
    minutes: t("durationMinutesShort"),
  }
  const PERIOD_OPTIONS = [
    { key: "last_30d", label: tc("last30d") },
    { key: "last_90d", label: tc("last90d") },
    { key: "last_180d", label: tc("last180d") },
    { key: "last_365d", label: tc("last365d") },
  ]
  const [data, setData] = useState<VelocityResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [periodKey, setPeriodKey] = useState("last_30d")
  const [selectedStage, setSelectedStage] = useState<VelocityStage | null>(null)

  const loadData = useCallback(async (period: string) => {
    try {
      setLoading(true)
      const res = await fetch(`/api/v1/deal-velocity?periodKey=${period}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      setData(json)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : tc("errorFetchFailed"))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadData(periodKey)
  }, [periodKey, loadData])

  return (
    <MotionPage className="p-6">
      <div className="max-w-7xl mx-auto">
        <header className="mb-6 flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-2">
              <Gauge className="w-8 h-8 text-primary" />
              {t("title")}
              <HelpButton slug="forecast-velocity" variant="label" />
            </h1>
            <p className="text-muted-foreground mt-2 max-w-2xl">
              {t("subtitle")}
            </p>
          </div>
          <div className="flex gap-2 flex-wrap">
            {PERIOD_OPTIONS.map((opt) => (
              <button
                key={opt.key}
                onClick={() => setPeriodKey(opt.key)}
                className={`px-3 py-1.5 rounded-lg text-sm border ${
                  periodKey === opt.key
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-card hover:bg-muted border-zinc-200 dark:border-zinc-700"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </header>

        {error && (
          <MotionCard className="mb-4 p-4 border border-destructive bg-destructive/10 rounded-lg flex items-start gap-2">
            <AlertCircle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
            <p className="text-sm">{error}</p>
          </MotionCard>
        )}

        {loading && (
          <MotionCard className="p-12 text-center text-muted-foreground">
            <Loader2 className="w-6 h-6 animate-spin inline mr-2" />
            {tc("loading")}
          </MotionCard>
        )}

        {!loading && data && (
          <>
            {data.bottleneckCount > 0 && (
              <MotionCard className="mb-6 p-5 border border-amber-300 bg-amber-50/80 dark:border-amber-800 dark:bg-amber-950/30 rounded-xl flex items-start gap-4">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/60 dark:text-amber-300">
                  <AlertTriangle className="w-5 h-5" />
                </span>
                <div className="space-y-1">
                  <p className="font-semibold text-amber-900 dark:text-amber-200">
                    {t("bottleneckBannerTitle", { count: data.bottleneckCount })}
                  </p>
                  <p className="text-sm text-amber-800 dark:text-amber-300">
                    {t("bottleneckBannerDesc", {
                      stage: stageLabel(data.stages[0]?.stage || ""),
                      duration: formatDuration(data.stages[0]?.p90DurationSeconds ?? null, durationUnits),
                    })}
                  </p>
                </div>
              </MotionCard>
            )}

            {data.stages.length === 0 ? (
              <MotionCard className="p-12 text-center text-muted-foreground">
                <Clock className="w-12 h-12 mx-auto mb-3 opacity-50" />
                <p className="font-medium">{t("emptyTitle")}</p>
                <p className="text-sm mt-1">{t("emptyDesc")}</p>
              </MotionCard>
            ) : (
              <>
                <div className="mb-5 grid gap-3 rounded-xl border border-zinc-200 bg-card p-4 dark:border-zinc-700 md:grid-cols-[auto_1fr] md:items-center">
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <Info className="h-4 w-4" />
                  </span>
                  <div>
                    <p className="text-sm font-semibold">{t("howToReadTitle")}</p>
                    <p className="mt-0.5 max-w-4xl text-sm text-muted-foreground">
                      {t("howToReadDesc")}
                    </p>
                  </div>
                </div>

                <div className="mb-4">
                  <h2 className="text-xl font-semibold">{t("stageSectionTitle")}</h2>
                  <p className="mt-1 text-sm text-muted-foreground">{t("stageSectionDesc")}</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                  {data.stages.map((s, idx) => (
                    <MotionCard
                      key={`${s.pipelineId}-${s.stage}-${idx}`}
                      className={`overflow-hidden border rounded-xl ${
                        s.isBottleneck
                          ? "border-amber-300 bg-amber-50/40 dark:border-amber-800 dark:bg-amber-950/20"
                          : "border-zinc-200 dark:border-zinc-700"
                      }`}
                    >
                      <div className="p-5">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <h3 className="text-lg font-semibold">{stageLabel(s.stage)}</h3>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {t("dealsMovement", { entered: s.dealsEntered, exited: s.dealsExited })}
                            </p>
                          </div>
                          {s.isBottleneck && (
                            <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-800 dark:bg-amber-900/60 dark:text-amber-200">
                              {t("needsAttention")}
                            </span>
                          )}
                        </div>

                        <div className="mt-5 grid grid-cols-2 gap-3">
                          <div className="rounded-lg bg-muted/60 p-3">
                            <p className="text-xs text-muted-foreground">{t("typicalTime")}</p>
                            <p className="mt-1 text-base font-semibold">
                              {formatDuration(s.p50DurationSeconds, durationUnits)}
                            </p>
                            <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
                              {t("typicalTimeHint")}
                            </p>
                          </div>
                          <div className={`rounded-lg p-3 ${
                            s.isBottleneck
                              ? "bg-amber-100/80 dark:bg-amber-900/40"
                              : "bg-muted/60"
                          }`}>
                            <p className="text-xs text-muted-foreground">{t("slowDealsTime")}</p>
                            <p className={`mt-1 text-base font-semibold ${
                              s.isBottleneck ? "text-amber-800 dark:text-amber-200" : ""
                            }`}>
                              {formatDuration(s.p90DurationSeconds, durationUnits)}
                            </p>
                            <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
                              {t("slowDealsTimeHint")}
                            </p>
                          </div>
                        </div>

                        <div className="mt-5">
                          <div className="flex items-end justify-between gap-3">
                            <div>
                              <p className="text-xs text-muted-foreground">{t("advancedFurther")}</p>
                              <p className="mt-1 text-2xl font-semibold">{formatPct(s.conversionRate)}</p>
                            </div>
                            <p className="max-w-40 text-right text-xs text-muted-foreground">
                              {t("advancedFurtherHint", {
                                advanced: s.dealsAdvanced,
                                exited: s.dealsExited,
                              })}
                            </p>
                          </div>
                          <div
                            className="mt-3 h-2 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700"
                            role="progressbar"
                            aria-label={t("advancedFurther")}
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-valuenow={Math.round((s.conversionRate ?? 0) * 100)}
                          >
                            <div
                              className={`h-full rounded-full ${
                                (s.conversionRate ?? 0) >= 0.5
                                  ? "bg-emerald-500"
                                  : (s.conversionRate ?? 0) >= 0.25
                                    ? "bg-amber-500"
                                    : "bg-red-500"
                              }`}
                              style={{ width: `${Math.max(0, Math.min(100, (s.conversionRate ?? 0) * 100))}%` }}
                            />
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 border-t border-zinc-200 bg-muted/20 dark:border-zinc-700">
                        <span className="flex items-center gap-2 border-b border-r border-zinc-200 px-4 py-2.5 text-xs dark:border-zinc-700">
                          <ArrowUpRight className="h-3.5 w-3.5 text-emerald-600" />
                          {t("advancedCount", { count: s.dealsAdvanced })}
                        </span>
                        <span className="flex items-center gap-2 border-b border-zinc-200 px-4 py-2.5 text-xs dark:border-zinc-700">
                          <ArrowDownLeft className="h-3.5 w-3.5 text-slate-500" />
                          {t("regressedCount", { count: s.dealsRegressed })}
                        </span>
                        <span className="flex items-center gap-2 border-r border-zinc-200 px-4 py-2.5 text-xs dark:border-zinc-700">
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                          {t("wonCount", { count: s.dealsWon })}
                        </span>
                        <span className="flex items-center gap-2 px-4 py-2.5 text-xs">
                          <XCircle className="h-3.5 w-3.5 text-red-500" />
                          {t("lostCount", { count: s.dealsLost })}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setSelectedStage(s)}
                        className="flex w-full items-center justify-between border-t border-zinc-200 px-5 py-3 text-sm font-medium text-primary transition-colors hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset dark:border-zinc-700"
                      >
                        {t("showDetails")}
                        <ChevronRight className="h-4 w-4" />
                      </button>
                    </MotionCard>
                  ))}
                </div>
              </>
            )}
          </>
        )}

        <p className="mt-6 max-w-4xl text-xs leading-5 text-muted-foreground">
          {t("dataNote")}
        </p>
      </div>

      <Sheet open={Boolean(selectedStage)} onOpenChange={(open) => { if (!open) setSelectedStage(null) }}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
          {selectedStage && (
            <>
              <SheetHeader className="pr-8">
                <div className="flex items-center gap-2">
                  <SheetTitle>{stageLabel(selectedStage.stage)}</SheetTitle>
                  {selectedStage.isBottleneck && (
                    <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-800 dark:bg-amber-900/60 dark:text-amber-200">
                      {t("needsAttention")}
                    </span>
                  )}
                </div>
                <SheetDescription>{t("detailsDescription")}</SheetDescription>
              </SheetHeader>

              <div className="mt-6 grid grid-cols-2 gap-3">
                <div className="rounded-xl bg-muted/60 p-4">
                  <p className="text-xs text-muted-foreground">{t("typicalTime")}</p>
                  <p className="mt-1 text-xl font-semibold">
                    {formatDuration(selectedStage.p50DurationSeconds, durationUnits)}
                  </p>
                </div>
                <div className="rounded-xl bg-amber-50 p-4 dark:bg-amber-950/30">
                  <p className="text-xs text-muted-foreground">{t("slowDealsTime")}</p>
                  <p className="mt-1 text-xl font-semibold text-amber-800 dark:text-amber-200">
                    {formatDuration(selectedStage.p90DurationSeconds, durationUnits)}
                  </p>
                </div>
              </div>

              <div className="mt-7">
                <h3 className="font-semibold">{t("dealsBehindMetric")}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{t("dealsBehindMetricHint")}</p>
              </div>

              {selectedStage.detailDeals.length === 0 ? (
                <div className="mt-4 rounded-xl border border-dashed border-zinc-300 p-6 text-center dark:border-zinc-700">
                  <p className="text-sm font-medium">{t("noVisibleDealDetails")}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{t("noVisibleDealDetailsHint")}</p>
                </div>
              ) : (
                <div className="mt-4 divide-y divide-zinc-200 overflow-hidden rounded-xl border border-zinc-200 dark:divide-zinc-700 dark:border-zinc-700">
                  {selectedStage.detailDeals.map((deal) => (
                    <div key={deal.id} className="p-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <p className="truncate font-medium">{deal.name}</p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {deal.ownerName || t("unassigned")} · {deal.valueAmount.toLocaleString()} {deal.currency}
                          </p>
                        </div>
                        <span className="shrink-0 rounded-lg bg-amber-100 px-2.5 py-1.5 text-sm font-semibold text-amber-800 dark:bg-amber-900/50 dark:text-amber-200">
                          {formatDuration(deal.durationSeconds, durationUnits)}
                        </span>
                      </div>
                      <div className="mt-3 flex items-center justify-between gap-3">
                        <p className="text-xs text-muted-foreground">
                          {t("leftStageOn", {
                            date: new Intl.DateTimeFormat(undefined, {
                              day: "2-digit",
                              month: "short",
                              year: "numeric",
                            }).format(new Date(deal.transitionedAt)),
                          })}
                        </p>
                        <Link
                          href={`/deals/${deal.id}`}
                          className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
                        >
                          {t("openDeal")}
                          <ExternalLink className="h-3.5 w-3.5" />
                        </Link>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </SheetContent>
      </Sheet>
    </MotionPage>
  )
}
