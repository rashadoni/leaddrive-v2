"use client"

/**
 * G3 Calculated Insights — slice-2 UI.
 *
 * Customer 360 list with pre-computed insights: LTV, churn risk,
 * engagement score, days since last purchase. Stale-priority (high LTV
 * + high churn risk) bubbles to the top — those are the highest-value
 * accounts most at risk, the ones worth a save call.
 *
 * The list is actionable: each row links to the contact profile, phone /
 * email are tel:/mailto: affordances, and stale-priority rows expose a
 * one-click "save call" task. Client-side search / sort / risk-filter let
 * a marketer triage hundreds of profiles without a round-trip (the list is
 * already fully loaded, capped at the API `limit`).
 */
import { useEffect, useMemo, useState } from "react"
import { useTranslations } from "next-intl"
import Link from "next/link"
import { MotionPage, MotionCard } from "@/components/ui/motion"
import { Sparkline } from "@/components/ui/sparkline"
import { HelpButton } from "@/components/help/help-button"
import {
  AlertCircle,
  AlertTriangle,
  Brain,
  Check,
  Clock,
  DollarSign,
  ExternalLink,
  Flame,
  Loader2,
  PhoneCall,
  RotateCw,
  Search,
  Sparkles,
  User,
} from "lucide-react"

interface InsightValue {
  value: number
  confidence: number
}

interface Profile {
  id: string
  displayName: string
  displayEmail: string | null
  displayPhone: string | null
  primaryContactId: string | null
  primaryCompanyId: string | null
  totalSpent: number
  lifetimeOrderCount: number
  primaryCurrency: string | null
  lastSeenAt: string | null
  firstSeenAt: string | null
  channelsActive: string[]
  lastRefreshedAt: string | null
  insights: {
    ltv: InsightValue
    churnRisk: InsightValue
    engagement: InsightValue
    daysSinceLastPurchase: InsightValue
  }
  isStalePriority: boolean
}

interface CurrencyTotal {
  currency: string
  total: number
}

interface KpiTrend {
  series: number[]
  delta: number | null
  deltaPct: number | null
}

interface InsightsTrends {
  points: number
  totalProfiles: KpiTrend
  dominantLtv: KpiTrend
  highRiskCount: KpiTrend
  avgEngagement: KpiTrend
}

interface InsightsResponse {
  items: Profile[]
  totalItems: number
  totalProfiles: number
  highRiskCount: number
  avgEngagement: number
  ltvCurrencyTotals: CurrencyTotal[]
  dominantLtv: CurrencyTotal
  trends: InsightsTrends
  truncated: boolean
  fetchCap: number
  limit: number
  stalePriorityLtvFloor: number
  stalePriorityChurnFloor: number
}

type SortKey = "priority" | "ltv" | "churn" | "engagement"
type RiskFilter = "all" | "churnHigh" | "churnMedium" | "churnLow"
type SaveState = "idle" | "saving" | "done" | "error"

// LTV below this confidence is shown de-emphasised ("~" + dimmed) so a
// 33%-confidence number doesn't read as a hard figure. Trust > false precision.
const LTV_CONFIDENCE_FLOOR = 0.5

function formatMoney(n: number, currency: string | null): string {
  if (!Number.isFinite(n) || n <= 0) return "—"
  const c = currency ?? "USD"
  if (n >= 1_000_000) return `${c} ${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${c} ${(n / 1_000).toFixed(1)}K`
  return `${c} ${n.toFixed(0)}`
}

// Churn risk saturates at 1.0 (customer is past 3× their normal cadence —
// see churn-risk-calculator). Rendering an exact "100%" overstates certainty,
// so a saturated score reads as ">99%". Below that, plain rounded percent.
function formatChurnPct(value: number): string {
  const pct = value * 100
  if (pct >= 99) return ">99%"
  return `${Math.round(pct)}%`
}

interface RelativeLabels {
  today: string
  dayAgo: string
  daysAgo: (n: number) => string
  monthsAgo: (n: number) => string
  yearsAgo: (n: number) => string
}

function formatRelative(iso: string | null, labels: RelativeLabels): string {
  if (!iso) return "—"
  const ms = Date.now() - new Date(iso).getTime()
  const days = Math.floor(ms / 86_400_000)
  if (days < 1) return labels.today
  if (days === 1) return labels.dayAgo
  if (days < 30) return labels.daysAgo(days)
  if (days < 365) return labels.monthsAgo(Math.floor(days / 30))
  return labels.yearsAgo(Math.floor(days / 365))
}

type ChurnKey = "churnHigh" | "churnMedium" | "churnLow"

type ChurnMeta = {
  key: ChurnKey
  color: string
  fill: string
}

function churnMeta(risk: number): ChurnMeta {
  if (risk >= 0.7) {
    return {
      key: "churnHigh",
      color: "text-red-700 dark:text-red-300",
      fill: "bg-red-500",
    }
  }
  if (risk >= 0.4) {
    return {
      key: "churnMedium",
      color: "text-amber-700 dark:text-amber-300",
      fill: "bg-amber-500",
    }
  }
  return {
    key: "churnLow",
    color: "text-green-700 dark:text-green-300",
    fill: "bg-green-500",
  }
}

function engagementColor(score: number): string {
  if (score >= 70) return "bg-green-500"
  if (score >= 40) return "bg-amber-500"
  return "bg-slate-400"
}

// KPI trend: sparkline of the recent daily snapshots + day-over-day delta.
// `goodWhen` flips the colour semantics — for churn-risk count, up is BAD.
// Renders nothing until ≥2 snapshots exist (honest cold-start, no fake trend).
function KpiSpark({
  trend,
  goodWhen,
  format,
  title,
}: {
  trend: KpiTrend
  goodWhen: "up" | "down"
  format: (n: number) => string
  title: string
}) {
  if (trend.delta === null || trend.series.length < 2) return null
  const flat = trend.delta === 0
  const up = trend.delta > 0
  const isGood = flat ? null : up === (goodWhen === "up")
  const color = flat
    ? "text-muted-foreground"
    : isGood
      ? "text-green-600 dark:text-green-400"
      : "text-red-600 dark:text-red-400"
  const arrow = flat ? "→" : up ? "↑" : "↓"
  const pct = trend.deltaPct !== null ? ` ${Math.abs(trend.deltaPct).toFixed(0)}%` : ""
  return (
    <div className={`flex items-center gap-1.5 mt-1.5 ${color}`} title={title}>
      <Sparkline values={trend.series} width={52} height={16} />
      <span className="text-[11px] font-medium tabular-nums">
        {arrow}
        {flat ? "" : ` ${format(Math.abs(trend.delta))}${pct}`}
      </span>
    </div>
  )
}

export default function CalculatedInsightsPage() {
  const t = useTranslations("slice2.customerInsights")
  const tc = useTranslations("slice2.common")
  const relativeLabels: RelativeLabels = {
    today: t("relToday"),
    dayAgo: t("relDayAgo"),
    daysAgo: (n) => t("relDaysAgo", { count: n }),
    monthsAgo: (n) => t("relMonthsAgo", { count: n }),
    yearsAgo: (n) => t("relYearsAgo", { count: n }),
  }
  const [data, setData] = useState<InsightsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  // Triage controls (client-side — list is already fully loaded).
  const [query, setQuery] = useState("")
  const [sortKey, setSortKey] = useState<SortKey>("priority")
  const [riskFilter, setRiskFilter] = useState<RiskFilter>("all")

  // Per-row save-call task state + the id of the task it created (so the
  // button can flip to an "open task" link — closes the loop and stops a
  // reload-induced second create).
  const [saveState, setSaveState] = useState<Record<string, SaveState>>({})
  const [savedTaskId, setSavedTaskId] = useState<Record<string, string>>({})

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch("/api/v1/calculated-insights")
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const json = await res.json()
        if (!cancelled) {
          setData(json)
          setError(null)
        }
      })
      .catch((e) => {
        if (!cancelled) {
          console.error("[calculated-insights] fetch failed:", e)
          setError(tc("errorFetchFailed"))
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [reloadKey, tc])

  const visibleItems = useMemo(() => {
    if (!data) return []
    const q = query.trim().toLowerCase()
    const filtered = data.items.filter((p) => {
      if (riskFilter !== "all" && churnMeta(p.insights.churnRisk.value).key !== riskFilter) {
        return false
      }
      if (!q) return true
      return (
        p.displayName.toLowerCase().includes(q) ||
        (p.displayEmail?.toLowerCase().includes(q) ?? false) ||
        (p.displayPhone?.toLowerCase().includes(q) ?? false)
      )
    })
    const sorted = [...filtered]
    switch (sortKey) {
      case "ltv":
        sorted.sort((a, b) => b.insights.ltv.value - a.insights.ltv.value)
        break
      case "churn":
        sorted.sort((a, b) => b.insights.churnRisk.value - a.insights.churnRisk.value)
        break
      case "engagement":
        sorted.sort((a, b) => b.insights.engagement.value - a.insights.engagement.value)
        break
      default:
        // "priority" mirrors the server order: stale-priority first, then LTV desc.
        sorted.sort((a, b) => {
          if (a.isStalePriority !== b.isStalePriority) return a.isStalePriority ? -1 : 1
          return b.insights.ltv.value - a.insights.ltv.value
        })
    }
    return sorted
  }, [data, query, sortKey, riskFilter])

  async function handleSaveCall(p: Profile) {
    setSaveState((s) => ({ ...s, [p.id]: "saving" }))
    try {
      const res = await fetch("/api/v1/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: t("saveCallTaskTitle", { name: p.displayName }),
          type: "task",
          priority: "high",
          // A save call is time-sensitive — give it a 2-day due date so it
          // doesn't sink unscheduled in the task list.
          dueDate: new Date(Date.now() + 2 * 86_400_000).toISOString(),
          ...(p.primaryContactId
            ? { relatedType: "contact", relatedId: p.primaryContactId }
            : {}),
        }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json().catch(() => null)
      const newId: string | undefined = json?.data?.id
      setSaveState((s) => ({ ...s, [p.id]: "done" }))
      if (newId) setSavedTaskId((m) => ({ ...m, [p.id]: newId }))
    } catch (e) {
      console.error("[calculated-insights] save-call task failed:", e)
      setSaveState((s) => ({ ...s, [p.id]: "error" }))
    }
  }

  const riskFilters: RiskFilter[] = ["all", "churnHigh", "churnMedium", "churnLow"]

  return (
    <MotionPage className="p-6">
      <div className="max-w-7xl mx-auto">
        <header className="mb-6">
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Sparkles className="w-8 h-8 text-primary" />
            {t("title")}
            <HelpButton slug="cdp-insights" variant="label" />
          </h1>
          <p className="text-muted-foreground mt-2 max-w-2xl">
            {t("subtitle")}
          </p>
        </header>

        {error && (
          <MotionCard className="mb-4 p-4 border border-destructive bg-destructive/10 rounded-lg flex items-start gap-2">
            <AlertCircle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm">{error}</p>
              <button
                type="button"
                onClick={() => setReloadKey((k) => k + 1)}
                className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-destructive hover:underline"
              >
                <RotateCw className="w-3.5 h-3.5" />
                {tc("tryAgain")}
              </button>
            </div>
          </MotionCard>
        )}

        {loading && (
          <MotionCard className="p-12 text-center text-muted-foreground">
            <Loader2 className="w-6 h-6 animate-spin inline mr-2" />
            {tc("loading")}
          </MotionCard>
        )}

        {!loading && data && data.truncated && (
          <MotionCard className="mb-4 p-3 border border-amber-500 bg-amber-500/10 rounded-lg flex items-start gap-2 text-sm">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            {t("truncatedBanner", { count: data.limit })}
          </MotionCard>
        )}

        {!loading && data && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
              <MotionCard className="p-3 border border-zinc-200 dark:border-zinc-700 rounded-lg">
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <User className="w-3 h-3" /> {t("kpiProfiles")}
                </p>
                <p className="text-2xl font-bold mt-0.5">{data.totalProfiles}</p>
                <KpiSpark
                  trend={data.trends.totalProfiles}
                  goodWhen="up"
                  format={(n) => String(Math.round(n))}
                  title={t("trendDeltaTitle")}
                />
              </MotionCard>
              <MotionCard className="p-3 border border-zinc-200 dark:border-zinc-700 rounded-lg">
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <DollarSign className="w-3 h-3" /> {t("kpiProjectedLtv")}
                </p>
                <p className="text-2xl font-bold mt-0.5">
                  {formatMoney(data.dominantLtv.total, data.dominantLtv.currency)}
                </p>
                {data.ltvCurrencyTotals.length > 1 && (
                  <p
                    className="text-xs text-muted-foreground"
                    title={data.ltvCurrencyTotals
                      .map((ct) => `${ct.currency} ${Math.round(ct.total)}`)
                      .join(", ")}
                  >
                    {t("moreCurrencies", { count: data.ltvCurrencyTotals.length - 1 })}
                  </p>
                )}
                <KpiSpark
                  trend={data.trends.dominantLtv}
                  goodWhen="up"
                  format={(n) => formatMoney(n, data.dominantLtv.currency)}
                  title={t("trendDeltaTitle")}
                />
              </MotionCard>
              <MotionCard
                className={`p-3 border rounded-lg ${
                  data.highRiskCount > 0
                    ? "border-red-300 dark:border-red-800 bg-red-50/70 dark:bg-red-500/10"
                    : "border-zinc-200 dark:border-zinc-700"
                }`}
              >
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <Flame className="w-3 h-3" /> {t("kpiHighRisk")}
                </p>
                <p
                  className={`text-2xl font-bold mt-0.5 ${
                    data.highRiskCount > 0 ? "text-red-600" : ""
                  }`}
                >
                  {data.highRiskCount}
                </p>
                <KpiSpark
                  trend={data.trends.highRiskCount}
                  goodWhen="down"
                  format={(n) => String(Math.round(n))}
                  title={t("trendDeltaTitle")}
                />
              </MotionCard>
              <MotionCard className="p-3 border border-zinc-200 dark:border-zinc-700 rounded-lg">
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <Brain className="w-3 h-3" /> {t("kpiAvgEngagement")}
                </p>
                <p className="text-2xl font-bold mt-0.5">
                  {Math.round(data.avgEngagement)}
                  <span className="text-xs text-muted-foreground">
                    /100
                  </span>
                </p>
                <KpiSpark
                  trend={data.trends.avgEngagement}
                  goodWhen="up"
                  format={(n) => String(Math.round(n))}
                  title={t("trendDeltaTitle")}
                />
              </MotionCard>
            </div>

            {data.trends.points < 2 && (
              <p className="text-xs text-muted-foreground -mt-4 mb-6">
                {t("trendCollecting")}
              </p>
            )}

            {data.items.length === 0 ? (
              <MotionCard className="p-12 text-center text-muted-foreground">
                <Sparkles className="w-12 h-12 mx-auto mb-3 opacity-50" />
                <p className="font-medium">{t("emptyTitle")}</p>
                <p className="text-sm mt-1 max-w-md mx-auto">
                  {t("emptyDesc")}
                </p>
              </MotionCard>
            ) : (
              <>
                {/* Triage controls */}
                <div className="flex flex-wrap items-center gap-2 mb-3">
                  <div className="relative flex-1 min-w-[200px]">
                    <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                    <input
                      type="search"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder={t("searchPlaceholder")}
                      aria-label={t("searchPlaceholder")}
                      className="w-full pl-8 pr-3 py-1.5 text-sm border border-zinc-200 dark:border-zinc-700 rounded-lg bg-transparent focus:outline-none focus:ring-2 focus:ring-primary/40"
                    />
                  </div>
                  <div className="flex items-center gap-1" role="group" aria-label={t("filterRisk")}>
                    {riskFilters.map((r) => (
                      <button
                        key={r}
                        type="button"
                        onClick={() => setRiskFilter(r)}
                        aria-pressed={riskFilter === r}
                        className={`px-2.5 py-1 text-xs rounded-full border transition-colors ${
                          riskFilter === r
                            ? "bg-primary text-primary-foreground border-primary"
                            : "border-zinc-200 dark:border-zinc-700 hover:bg-muted"
                        }`}
                      >
                        {r === "all" ? t("filterAll") : t(r)}
                      </button>
                    ))}
                  </div>
                  <select
                    value={sortKey}
                    onChange={(e) => setSortKey(e.target.value as SortKey)}
                    aria-label={t("sortLabel")}
                    className="text-sm border border-zinc-200 dark:border-zinc-700 rounded-lg px-2 py-1.5 bg-transparent focus:outline-none focus:ring-2 focus:ring-primary/40"
                  >
                    <option value="priority">{t("sortPriority")}</option>
                    <option value="ltv">{t("sortLtv")}</option>
                    <option value="churn">{t("sortChurn")}</option>
                    <option value="engagement">{t("sortEngagement")}</option>
                  </select>
                </div>

                <p className="text-xs text-muted-foreground mb-2">
                  {t("showingCount", {
                    shown: visibleItems.length,
                    total: data.items.length,
                  })}
                </p>

                {visibleItems.length === 0 ? (
                  <MotionCard className="p-8 text-center text-muted-foreground text-sm">
                    {t("noMatches")}
                  </MotionCard>
                ) : (
                  <div className="space-y-2">
                    {visibleItems.map((p) => {
                      const churn = churnMeta(p.insights.churnRisk.value)
                      const churnPct = Math.round(p.insights.churnRisk.value * 100)
                      const engPct = Math.round(p.insights.engagement.value)
                      const ltvLowConf =
                        p.insights.ltv.confidence < LTV_CONFIDENCE_FLOOR &&
                        p.insights.ltv.value > 0
                      const st = saveState[p.id] ?? "idle"
                      return (
                        <MotionCard
                          key={p.id}
                          className={`p-4 border rounded-lg transition-colors ${
                            p.isStalePriority
                              ? "border-amber-300 dark:border-amber-700 border-l-4 border-l-amber-500 bg-amber-50/70 dark:bg-amber-500/10"
                              : "border-zinc-200 dark:border-zinc-700"
                          }`}
                        >
                          <div className="flex items-start justify-between gap-3 mb-2 flex-wrap">
                            <div className="min-w-0">
                              <h3 className="font-semibold truncate">
                                {p.primaryContactId ? (
                                  <Link
                                    href={`/contacts/${p.primaryContactId}`}
                                    className="hover:underline focus:underline focus:outline-none"
                                  >
                                    {p.displayName}
                                  </Link>
                                ) : (
                                  p.displayName
                                )}
                              </h3>
                              <div className="text-xs text-muted-foreground flex gap-3 flex-wrap items-center">
                                {p.displayEmail && (
                                  <a
                                    href={`mailto:${p.displayEmail}`}
                                    className="truncate hover:text-foreground hover:underline"
                                  >
                                    {p.displayEmail}
                                  </a>
                                )}
                                {p.displayPhone && (
                                  <a
                                    href={`tel:${p.displayPhone.replace(/\s/g, "")}`}
                                    className="hover:text-foreground hover:underline"
                                  >
                                    {p.displayPhone}
                                  </a>
                                )}
                                <span>
                                  {t("orders", { count: p.lifetimeOrderCount })}
                                </span>
                                <span className="flex items-center gap-1">
                                  <Clock className="w-3 h-3" />
                                  {t("lastSeen", { when: formatRelative(p.lastSeenAt, relativeLabels) })}
                                </span>
                              </div>
                            </div>
                            {p.isStalePriority && (
                              <span className="px-2 py-1 rounded text-xs bg-amber-500 text-white font-medium flex items-center gap-1 shrink-0">
                                <AlertTriangle className="w-3 h-3" />
                                {t("saveCallBadge")}
                              </span>
                            )}
                          </div>

                          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
                            <div>
                              <p className="text-xs text-muted-foreground">
                                {t("projectedLtv")}
                              </p>
                              <p
                                className={`font-mono font-semibold ${
                                  ltvLowConf ? "opacity-60" : ""
                                }`}
                                title={ltvLowConf ? t("lowConfidenceHint") : undefined}
                              >
                                {ltvLowConf ? "~" : ""}
                                {formatMoney(p.insights.ltv.value, p.primaryCurrency)}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {t("confidence", { pct: Math.round(p.insights.ltv.confidence * 100) })}
                              </p>
                            </div>
                            <div>
                              <p className="text-xs text-muted-foreground">
                                {t("churnRisk")}
                              </p>
                              <div className="flex items-center gap-2">
                                <p className={`font-semibold ${churn.color}`}>
                                  {t(churn.key)}
                                </p>
                                <p className="text-xs text-muted-foreground font-mono">
                                  {formatChurnPct(p.insights.churnRisk.value)}
                                </p>
                              </div>
                              <div
                                className="w-full h-1.5 bg-muted rounded mt-1 overflow-hidden"
                                role="progressbar"
                                aria-valuenow={churnPct}
                                aria-valuemin={0}
                                aria-valuemax={100}
                                aria-label={`${t("churnRisk")}: ${t(churn.key)} ${formatChurnPct(p.insights.churnRisk.value)}`}
                              >
                                <div
                                  className={`h-full ${churn.fill}`}
                                  style={{ width: `${churnPct}%` }}
                                />
                              </div>
                            </div>
                            <div>
                              <p className="text-xs text-muted-foreground">
                                {t("engagement")}
                              </p>
                              <p className="font-mono font-semibold">
                                {engPct}
                                <span className="text-xs text-muted-foreground">
                                  /100
                                </span>
                              </p>
                              <div
                                className="w-full h-1.5 bg-muted rounded mt-1 overflow-hidden"
                                role="progressbar"
                                aria-valuenow={engPct}
                                aria-valuemin={0}
                                aria-valuemax={100}
                                aria-label={`${t("engagement")}: ${engPct}/100`}
                              >
                                <div
                                  className={`h-full ${engagementColor(p.insights.engagement.value)}`}
                                  style={{ width: `${engPct}%` }}
                                />
                              </div>
                            </div>
                            <div>
                              <p className="text-xs text-muted-foreground">
                                {t("daysSincePurchase")}
                              </p>
                              <p className="font-mono font-semibold">
                                {p.insights.daysSinceLastPurchase.confidence > 0
                                  ? `${Math.round(p.insights.daysSinceLastPurchase.value)}d`
                                  : "—"}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {t("channels", { count: p.channelsActive.length })}
                              </p>
                            </div>
                          </div>

                          {/* Actions — turn the insight into a next step. */}
                          {(p.isStalePriority || p.primaryContactId) && (
                            <div className="flex items-center gap-2 mt-3 flex-wrap">
                              {p.isStalePriority &&
                                (st === "done" ? (
                                  savedTaskId[p.id] ? (
                                    <Link
                                      href={`/tasks/${savedTaskId[p.id]}`}
                                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-300 hover:bg-green-200 dark:hover:bg-green-500/25 transition-colors"
                                    >
                                      <Check className="w-3.5 h-3.5" />
                                      {t("saveCallOpenTask")}
                                    </Link>
                                  ) : (
                                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-300">
                                      <Check className="w-3.5 h-3.5" />
                                      {t("saveCallCreated")}
                                    </span>
                                  )
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => handleSaveCall(p)}
                                    disabled={st === "saving"}
                                    className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
                                      st === "error"
                                        ? "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300 hover:bg-red-200 dark:hover:bg-red-500/25"
                                        : "bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-60"
                                    }`}
                                  >
                                    {st === "saving" ? (
                                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                    ) : (
                                      <PhoneCall className="w-3.5 h-3.5" />
                                    )}
                                    {st === "error" ? t("saveCallFailed") : t("actionSaveCall")}
                                  </button>
                                ))}
                              {p.primaryContactId && (
                                <Link
                                  href={`/contacts/${p.primaryContactId}`}
                                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium border border-zinc-200 dark:border-zinc-700 hover:bg-muted transition-colors"
                                >
                                  <ExternalLink className="w-3.5 h-3.5" />
                                  {t("actionOpenProfile")}
                                </Link>
                              )}
                            </div>
                          )}
                        </MotionCard>
                      )
                    })}
                  </div>
                )}
              </>
            )}
          </>
        )}

        <div className="mt-6 text-xs text-muted-foreground space-y-1">
          <p>{t("footerCompute")}</p>
          <p>{t("footerSaveCall", {
            ltv: data?.stalePriorityLtvFloor ?? 500,
            churn: Math.round((data?.stalePriorityChurnFloor ?? 0.6) * 100),
          })}</p>
        </div>
      </div>
    </MotionPage>
  )
}
