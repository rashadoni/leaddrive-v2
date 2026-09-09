"use client"

/**
 * A12 Pipeline Waterfall — slice-2 UI.
 *
 * Shows colored bars per transition type (created / advanced /
 * regressed / won / lost / reopened / reassigned) for the chosen
 * period. Each bar = count + total $ delta. Net delta summarizes the
 * pipeline movement.
 */
import { useCallback, useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import { MotionPage, MotionCard } from "@/components/ui/motion"
import {
  Activity,
  AlertCircle,
  ArrowDownRight,
  ArrowUpRight,
  Info,
  Loader2,
  TrendingDown,
  TrendingUp,
  Workflow,
} from "lucide-react"
import { fmtCurrencyCompact } from "@/lib/utils"
import { HelpButton } from "@/components/help/help-button"
// `Tooltip` above is recharts'; alias the UI tooltip to avoid the name clash.
import {
  Tooltip as UITooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

interface Bucket {
  transitionType: string
  count: number
  totalAmountDelta: number
  dealIds: string[]
}

interface WaterfallData {
  periodStart: string
  periodEnd: string
  days: number | "all"
  pipelineId: string | null
  analysis: {
    buckets: Bucket[]
    netAmountDelta: number
    totalTransitions: number
  }
  topMovers: Bucket[]
}

const TYPE_COLORS: Record<string, string> = {
  created: "#3b82f6", // blue — new deals
  advanced: "#10b981", // green — moving forward
  regressed: "#f59e0b", // amber — stepping back
  won: "#059669", // dark green — closed-won
  lost: "#ef4444", // red — closed-lost
  reopened: "#8b5cf6", // purple — re-entered
  reassigned: "#6b7280", // gray — owner-change only
}

/**
 * Tiny inline "?" affordance — a muted Info glyph that reveals a one-line
 * definition on hover/focus. Additive only; never replaces the label it
 * sits next to. Uses the global TooltipProvider (dashboard layout).
 */
function Hint({ text }: { text: string }) {
  return (
    <UITooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={text}
          className="inline-flex items-center text-muted-foreground/50 hover:text-foreground focus-visible:text-foreground transition-colors cursor-help align-middle"
        >
          <Info className="w-3.5 h-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs text-left leading-snug font-normal normal-case">
        {text}
      </TooltipContent>
    </UITooltip>
  )
}

export default function WaterfallPage() {
  const t = useTranslations("slice2.pipelineWaterfall")
  const tc = useTranslations("slice2.common")
  const TYPE_LABELS: Record<string, string> = {
    created: t("barCreated"),
    advanced: t("barAdvanced"),
    regressed: t("barRegressed"),
    won: t("barWon"),
    lost: t("barLost"),
    reopened: t("barReopened"),
    reassigned: t("barReassigned"),
  }
  const TYPE_HINTS: Record<string, string> = {
    created: t("hintCreated"),
    advanced: t("hintAdvanced"),
    regressed: t("hintRegressed"),
    won: t("hintWon"),
    lost: t("hintLost"),
    reopened: t("hintReopened"),
    reassigned: t("hintReassigned"),
  }
  const PERIOD_OPTIONS: { days: number | "all"; label: string }[] = [
    { days: 7, label: tc("last7d") },
    { days: 30, label: tc("last30d") },
    { days: 90, label: tc("last90d") },
    { days: 180, label: tc("last180d") },
    { days: "all", label: tc("allTime") },
  ]
  const [data, setData] = useState<WaterfallData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [days, setDays] = useState<number | "all">(30)

  const loadData = useCallback(async (days: number | "all") => {
    try {
      setLoading(true)
      const res = await fetch(`/api/v1/pipeline-waterfall?days=${days}`)
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
    loadData(days)
  }, [days, loadData])

  const chartData =
    data?.analysis.buckets
      .filter((b) => b.count > 0)
      .map((b) => ({
        name: TYPE_LABELS[b.transitionType] || b.transitionType,
        count: b.count,
        delta: b.totalAmountDelta,
        deltaAbs: Math.abs(b.totalAmountDelta),
        type: b.transitionType,
      })) ?? []

  return (
    <MotionPage className="p-6">
      <div className="max-w-7xl mx-auto">
        <header className="mb-6 flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-2">
              <Workflow className="w-8 h-8 text-primary" />
              {t("title")}
              <HelpButton slug="forecast-waterfall" variant="label" />
            </h1>
            <p className="text-muted-foreground mt-2 max-w-2xl">
              {t("subtitle")}
            </p>
          </div>
          <div className="flex gap-2">
            {PERIOD_OPTIONS.map((opt) => (
              <button
                key={opt.days}
                onClick={() => setDays(opt.days)}
                className={`px-3 py-1.5 rounded-lg text-sm border ${
                  days === opt.days
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
            {/* Net delta + total transitions summary */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
              <MotionCard className="p-5 border border-zinc-200 dark:border-zinc-700 rounded-lg">
                <div className="text-sm text-muted-foreground mb-1 flex items-center gap-1">
                  <Activity className="w-4 h-4" />
                  {t("totalTransitions")}
                  <Hint text={t("hintTotalTransitions")} />
                </div>
                <div className="text-3xl font-bold">
                  {data.analysis.totalTransitions}
                </div>
              </MotionCard>
              <MotionCard className="p-5 border border-zinc-200 dark:border-zinc-700 rounded-lg">
                <div className="text-sm text-muted-foreground mb-1 flex items-center gap-1">
                  {data.analysis.netAmountDelta >= 0 ? (
                    <TrendingUp className="w-4 h-4 text-green-600" />
                  ) : (
                    <TrendingDown className="w-4 h-4 text-red-600" />
                  )}
                  {t("netDelta")}
                  <Hint text={t("hintNetDelta")} />
                </div>
                <div
                  className={`text-3xl font-bold ${
                    data.analysis.netAmountDelta >= 0
                      ? "text-green-600"
                      : "text-red-600"
                  }`}
                >
                  {data.analysis.netAmountDelta >= 0 ? "+" : ""}
                  {fmtCurrencyCompact(data.analysis.netAmountDelta)}
                </div>
              </MotionCard>
              <MotionCard className="p-5 border border-zinc-200 dark:border-zinc-700 rounded-lg">
                <div className="text-sm text-muted-foreground mb-1 flex items-center gap-1">
                  {t("topMover")}
                  <Hint text={t("hintTopMover")} />
                </div>
                <div className="text-2xl font-bold">
                  {data.topMovers[0]
                    ? `${TYPE_LABELS[data.topMovers[0].transitionType]} (${
                        data.topMovers[0].count
                      })`
                    : "—"}
                </div>
                {data.topMovers[0] && (
                  <div
                    className={`text-sm font-mono ${
                      data.topMovers[0].totalAmountDelta >= 0
                        ? "text-green-600"
                        : "text-red-600"
                    }`}
                  >
                    {data.topMovers[0].totalAmountDelta >= 0 ? "+" : ""}
                    {fmtCurrencyCompact(data.topMovers[0].totalAmountDelta)}
                  </div>
                )}
              </MotionCard>
            </div>

            {/* Main waterfall chart */}
            <MotionCard className="p-6 border border-zinc-200 dark:border-zinc-700 rounded-lg mb-4">
              {chartData.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <p>{t("emptyTitle")}</p>
                  <p className="text-sm mt-1">{t("emptyDesc")}</p>
                </div>
              ) : (
                <>
                  <h2 className="text-base font-semibold mb-1">{t("byTransitionType")}</h2>
                  <p className="text-xs text-muted-foreground mb-5">{t("chartSubtitle")}</p>
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart
                      data={chartData}
                      margin={{ top: 8, right: 8, left: -12, bottom: 0 }}
                      barCategoryGap="32%"
                    >
                      <defs>
                        {chartData.map((entry) => {
                          const c = TYPE_COLORS[entry.type] || "#888"
                          return (
                            <linearGradient
                              key={entry.type}
                              id={`wf-grad-${entry.type}`}
                              x1="0"
                              y1="0"
                              x2="0"
                              y2="1"
                            >
                              <stop offset="0%" stopColor={c} stopOpacity={0.95} />
                              <stop offset="100%" stopColor={c} stopOpacity={0.65} />
                            </linearGradient>
                          )
                        })}
                      </defs>
                      <CartesianGrid
                        vertical={false}
                        stroke="currentColor"
                        strokeOpacity={0.08}
                      />
                      <XAxis
                        dataKey="name"
                        tickLine={false}
                        axisLine={false}
                        fontSize={12}
                        tickMargin={10}
                        tick={{ fill: "currentColor", fillOpacity: 0.7 }}
                      />
                      <YAxis
                        allowDecimals={false}
                        domain={[0, "dataMax + 1"]}
                        tickLine={false}
                        axisLine={false}
                        width={28}
                        fontSize={12}
                        tick={{ fill: "currentColor", fillOpacity: 0.5 }}
                      />
                      <Tooltip
                        cursor={{ fill: "currentColor", fillOpacity: 0.05 }}
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        formatter={((value: any, name: any) => {
                          if (name === "count") return [value, t("colDeals")]
                          return [fmtCurrencyCompact(Number(value)), t("tooltipDelta")]
                        }) as never}
                        contentStyle={{
                          background: "rgba(24,24,32,0.95)",
                          border: "1px solid rgba(255,255,255,0.12)",
                          borderRadius: 10,
                          padding: "8px 12px",
                          boxShadow: "0 8px 28px rgba(0,0,0,0.22)",
                        }}
                        labelStyle={{
                          color: "rgba(255,255,255,0.65)",
                          fontSize: 12,
                          marginBottom: 4,
                        }}
                        itemStyle={{ color: "#fff", fontWeight: 600 }}
                      />
                      <Bar dataKey="count" radius={[6, 6, 0, 0]} maxBarSize={64}>
                        {chartData.map((entry, idx) => (
                          <Cell
                            key={idx}
                            fill={`url(#wf-grad-${entry.type})`}
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </>
              )}
            </MotionCard>

            {/* Detailed table */}
            <MotionCard className="overflow-hidden border border-zinc-200 dark:border-zinc-700 rounded-lg">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-muted/50">
                    <tr className="text-sm text-left">
                      <th className="px-4 py-3 font-medium">{t("colTransition")}</th>
                      <th className="px-4 py-3 font-medium text-right">{t("colDeals")}</th>
                      <th className="px-4 py-3 font-medium text-right">
                        <span className="inline-flex items-center justify-end gap-1">
                          {t("colAmountDelta")}
                          <Hint text={t("hintAmountDelta")} />
                        </span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.analysis.buckets.map((b) => (
                      <tr key={b.transitionType} className="border-t">
                        <td className="px-4 py-3 text-sm font-medium flex items-center gap-2">
                          <span
                            className="w-3 h-3 rounded-full"
                            style={{
                              background: TYPE_COLORS[b.transitionType],
                            }}
                          />
                          {TYPE_LABELS[b.transitionType] || b.transitionType}
                          {TYPE_HINTS[b.transitionType] && (
                            <Hint text={TYPE_HINTS[b.transitionType]} />
                          )}
                        </td>
                        <td className="px-4 py-3 text-sm text-right font-mono">
                          {b.count}
                        </td>
                        <td
                          className={`px-4 py-3 text-sm text-right font-mono ${
                            b.totalAmountDelta > 0
                              ? "text-green-600"
                              : b.totalAmountDelta < 0
                                ? "text-red-600"
                                : "text-muted-foreground"
                          }`}
                        >
                          <span className="flex items-center justify-end gap-1">
                            {b.totalAmountDelta > 0 && (
                              <ArrowUpRight className="w-3 h-3" />
                            )}
                            {b.totalAmountDelta < 0 && (
                              <ArrowDownRight className="w-3 h-3" />
                            )}
                            {b.totalAmountDelta >= 0 ? "+" : ""}
                            {fmtCurrencyCompact(b.totalAmountDelta)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </MotionCard>
          </>
        )}

        <div className="mt-6 text-xs text-muted-foreground space-y-1">
          <p>{t("footer")}</p>
        </div>
      </div>
    </MotionPage>
  )
}
