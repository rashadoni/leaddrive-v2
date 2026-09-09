"use client"

import { useEffect, useMemo, useState } from "react"
import { useTranslations, useLocale } from "next-intl"
import { MotionPage, MotionCard } from "@/components/ui/motion"
import { TrendingUp, Target, DollarSign, BarChart3 } from "lucide-react"
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, BarChart, Bar, Cell } from "recharts"
import { fmtCurrencyCompact } from "@/lib/utils"
import { formatDate } from "@/lib/format-date"
import { HelpButton } from "@/components/help/help-button"
import { canonicalDealStage } from "@/lib/deal-stage-normalization"

interface QuotaRow {
  id: string
  userId: string
  user: { id: string; name: string; email: string }
  year: number
  quarter: number
  amount: number
  actual: number
  attainment: number
}

// API returns `month` pre-formatted as an English short name
// (`toLocaleDateString("en", { month: "short" })`). Map it back to a month
// index so the chart can render the name in the active locale instead of raw
// English. The 12 English short names are a fixed ASCII set, so this lookup is
// deterministic.
const EN_SHORT_MONTH_INDEX: Record<string, number> = Object.fromEntries(
  Array.from({ length: 12 }, (_, i) => [
    new Date(2000, i, 1).toLocaleDateString("en", { month: "short" }),
    i,
  ]),
)

export default function ForecastPage() {
  const t = useTranslations("forecast")
  const locale = useLocale()
  const [forecast, setForecast] = useState<any[]>([])
  const [quotas, setQuotas] = useState<QuotaRow[]>([])
  const [pipelineData, setPipelineData] = useState<{ name: string; total: number; weighted: number; count: number }[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedQuarter, setSelectedQuarter] = useState(() => Math.ceil((new Date().getMonth() + 1) / 3))
  const year = new Date().getFullYear()

  useEffect(() => {
    Promise.all([
      fetch("/api/v1/analytics/forecast?months=6").then(r => r.json()),
      fetch(`/api/v1/sales-quotas?year=${year}`).then(r => r.json()),
      fetch("/api/v1/pipelines").then(r => r.json()),
      fetch("/api/v1/deals?limit=200").then(r => r.json()),
    ])
      .then(([f, q, p, d]) => {
        if (f.success) setForecast(f.data)
        if (q.success) setQuotas(q.data)
        // Compute per-pipeline weighted values
        if (p.success && d.success) {
          const pipelines = p.data || []
          const deals = (d.data?.deals || []).filter(
            (deal: any) => !["WON", "LOST"].includes(canonicalDealStage(deal.stage)),
          )
          const result = pipelines.map((pl: any) => {
            const plDeals = deals.filter((deal: any) => deal.pipelineId === pl.id)
            return {
              name: pl.name,
              count: plDeals.length,
              total: plDeals.reduce((s: number, d: any) => s + (d.valueAmount || 0), 0),
              weighted: Math.round(plDeals.reduce((s: number, d: any) => s + (d.valueAmount || 0) * ((d.probability || 0) / 100), 0)),
            }
          }).filter((pl: any) => pl.count > 0)
          setPipelineData(result)
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [year])

  // Calculate totals from future forecast data
  const futureForecast = forecast.filter(f => f.actual === 0 || f.committed > 0)
  const totalCommitted = futureForecast.reduce((s, f) => s + (f.committed || 0), 0)
  const totalBestCase = futureForecast.reduce((s, f) => s + (f.bestCase || 0), 0)
  const totalPipeline = futureForecast.reduce((s, f) => s + (f.pipeline || 0), 0)

  // Localize the chart's month axis: the API ships English short month names,
  // so re-render each in the active locale via the shared formatDate helper.
  const localizedForecast = useMemo(
    () =>
      forecast.map(f => {
        const idx = EN_SHORT_MONTH_INDEX[f.month as string]
        return idx === undefined
          ? f
          : { ...f, month: formatDate(new Date(2000, idx, 1), locale, { month: "short" }) }
      }),
    [forecast, locale],
  )

  // Quota data for selected quarter
  const quarterQuotas = quotas.filter(q => q.quarter === selectedQuarter)
  const totalQuota = quarterQuotas.reduce((s, q) => s + q.amount, 0)
  const totalActual = quarterQuotas.reduce((s, q) => s + q.actual, 0)
  const overallAttainment = totalQuota > 0 ? Math.round((totalActual / totalQuota) * 100) : 0

  if (loading) {
    return (
      <MotionPage className="p-6">
        <div className="flex items-center justify-center h-64 text-muted-foreground">{t("loading")}</div>
      </MotionPage>
    )
  }

  return (
    <MotionPage className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">{t("title")}<HelpButton slug="forecast" variant="label" /></h1>
          <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        <div className="flex gap-2">
          {[1, 2, 3, 4].map(q => (
            <button
              key={q}
              onClick={() => setSelectedQuarter(q)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                selectedQuarter === q
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted hover:bg-muted/80"
              }`}
            >
              Q{q} {year}
            </button>
          ))}
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MotionCard className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-card">
          <div className="flex items-center gap-2 mb-2">
            <DollarSign className="h-4 w-4 text-emerald-500" />
            <span className="text-xs text-muted-foreground">{t("committed")}</span>
          </div>
          <p className="text-lg font-bold text-emerald-600">{fmtCurrencyCompact(totalCommitted)}</p>
        </MotionCard>
        <MotionCard className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-card">
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp className="h-4 w-4 text-purple-500" />
            <span className="text-xs text-muted-foreground">{t("bestCase")}</span>
          </div>
          <p className="text-lg font-bold text-purple-600">{fmtCurrencyCompact(totalBestCase)}</p>
        </MotionCard>
        <MotionCard className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-card">
          <div className="flex items-center gap-2 mb-2">
            <BarChart3 className="h-4 w-4 text-slate-500" />
            <span className="text-xs text-muted-foreground">{t("pipelineWeighted")}</span>
          </div>
          <p className="text-lg font-bold">{fmtCurrencyCompact(totalPipeline)}</p>
        </MotionCard>
        <MotionCard className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-card">
          <div className="flex items-center gap-2 mb-2">
            <Target className="h-4 w-4 text-amber-500" />
            <span className="text-xs text-muted-foreground">{t("quota", { quarter: selectedQuarter })}</span>
          </div>
          <p className="text-lg font-bold">{overallAttainment}%</p>
          <p className="text-[10px] text-muted-foreground">{fmtCurrencyCompact(totalActual)} / {fmtCurrencyCompact(totalQuota)}</p>
        </MotionCard>
      </div>

      {/* Forecast Chart */}
      <MotionCard className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-card">
        <h3 className="text-sm font-semibold mb-3">{t("revenueChart")}</h3>
        <ResponsiveContainer width="100%" height={280}>
          <AreaChart data={localizedForecast} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
            <defs>
              <linearGradient id="fgActual" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="fgCommitted" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.15} />
                <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis dataKey="month" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
            <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={(v: number) => fmtCurrencyCompact(v)} width={60} />
            <Tooltip
              formatter={((v: number, name: string) => {
                const labels: Record<string, string> = { actual: t("chartActual"), committed: t("chartCommitted"), bestCase: t("chartBestCase"), pipeline: t("chartPipeline") }
                return [fmtCurrencyCompact(v), labels[name] || name]
              }) as any}
            />
            <Area type="monotone" dataKey="actual" stroke="#10b981" fill="url(#fgActual)" strokeWidth={2} />
            <Area type="monotone" dataKey="committed" stroke="#3b82f6" fill="url(#fgCommitted)" strokeWidth={1.5} />
            <Area type="monotone" dataKey="bestCase" stroke="#8b5cf6" fill="none" strokeWidth={1.5} strokeDasharray="4 4" />
            <Area type="monotone" dataKey="pipeline" stroke="#94a3b8" fill="none" strokeWidth={1} strokeDasharray="2 2" />
          </AreaChart>
        </ResponsiveContainer>
      </MotionCard>

      {/* By Rep: Quota vs Actual */}
      {quarterQuotas.length > 0 && (
        <MotionCard className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-card">
          <h3 className="text-sm font-semibold mb-3">{t("byManagers")} — Q{selectedQuarter} {year}</h3>
          <div className="space-y-3">
            {quarterQuotas.map(q => {
              const pct = q.amount > 0 ? Math.min(Math.round((q.actual / q.amount) * 100), 150) : 0
              return (
                <div key={q.id} className="flex items-center gap-3">
                  <div className="w-28 shrink-0">
                    <p className="text-xs font-medium truncate">{q.user.name || q.user.email}</p>
                  </div>
                  <div className="flex-1 h-5 bg-muted rounded-full overflow-hidden relative">
                    <div
                      className={`h-full rounded-full transition-all ${
                        pct >= 100 ? "bg-emerald-500" : pct >= 70 ? "bg-blue-500" : pct >= 40 ? "bg-amber-500" : "bg-red-500"
                      }`}
                      style={{ width: `${Math.min(pct, 100)}%` }}
                    />
                    {pct > 100 && (
                      <div
                        className="absolute top-0 h-full bg-emerald-300/50 rounded-r-full"
                        style={{ left: "100%", width: `${Math.min(pct - 100, 50)}%` }}
                      />
                    )}
                  </div>
                  <div className="w-20 text-right shrink-0">
                    <span className={`text-xs font-bold ${
                      pct >= 100 ? "text-emerald-600" : pct >= 70 ? "text-blue-600" : "text-muted-foreground"
                    }`}>
                      {pct}%
                    </span>
                  </div>
                  <div className="w-32 text-right shrink-0">
                    <span className="text-[10px] text-muted-foreground">
                      {fmtCurrencyCompact(q.actual)} / {fmtCurrencyCompact(q.amount)}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        </MotionCard>
      )}

      {/* By Pipeline */}
      {pipelineData.length > 0 && (
        <MotionCard className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-card">
          <h3 className="text-sm font-semibold mb-3">{t("byPipelines")}</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {pipelineData.map(pl => (
              <div key={pl.name} className="rounded-lg border border-zinc-200 dark:border-zinc-700 p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold">{pl.name}</span>
                  <span className="text-[10px] text-muted-foreground">{pl.count} {t("deals")}</span>
                </div>
                <div>
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="text-[10px] text-muted-foreground">{t("total")}</span>
                    <span className="text-xs font-medium">{fmtCurrencyCompact(pl.total)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-muted-foreground">{t("weighted")}</span>
                    <span className="text-xs font-bold text-primary">{fmtCurrencyCompact(pl.weighted)}</span>
                  </div>
                </div>
                <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full rounded-full bg-primary/60"
                    style={{ width: `${pl.total > 0 ? Math.round((pl.weighted / pl.total) * 100) : 0}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </MotionCard>
      )}
    </MotionPage>
  )
}
