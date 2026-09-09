"use client"

/**
 * CLM Slice 5c — Contract Analytics Dashboard.
 *
 * /contracts/analytics
 *
 * Server-computed analytics (no client-side aggregation):
 *   - Summary cards: live contracts, total value, MRR, avg cycle time,
 *     renewal rate, open deviations
 *   - By-type breakdown (bar chart + table)
 *   - Expiry-cohort chart (bar: value by quarter for next 12mo)
 *   - Approval funnel (counts by status)
 *   - Deviation risk summary (critical / warning / info)
 *   - Date-range filter for time-bounded metrics
 *
 * Nav item (Contracts > Analytics) wired in Slice 5d.
 */
import { useEffect, useState, useCallback } from "react"
import { useTranslations, useLocale } from "next-intl"
import { MotionPage, MotionCard } from "@/components/ui/motion"
import { ColorStatCard } from "@/components/color-stat-card"
import { HelpButton } from "@/components/help/help-button"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { fmtCurrencyCompact } from "@/lib/utils"
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts"
import {
  FileText,
  DollarSign,
  TrendingUp,
  Clock,
  RefreshCw,
  AlertTriangle,
  Activity,
  Loader2,
  BarChart3,
  CheckCircle2,
  Download,
} from "lucide-react"

// ─── Types ────────────────────────────────────────────────────────────────────

interface AnalyticsSummary {
  liveCount: number
  totalValue: string
  mrr: number
  avgCycleTimeDays: number | null
  renewalRate: number | null
  expiringSoon: number
  openDeviations: number
  renewedCount: number
  expiredCount: number
}

interface ByTypeRow {
  type: string
  count: number
  totalValue: string
}

interface CohortRow {
  period: string
  count: number
  value: number
}

interface ApprovalFlowRow {
  status: string
  count: number
}

interface DeviationRiskRow {
  severity: string
  count: number
}

interface AnalyticsData {
  summary: AnalyticsSummary
  byType: ByTypeRow[]
  cohorts: CohortRow[]
  approvalFlow: ApprovalFlowRow[]
  deviationRisk: DeviationRiskRow[]
  generatedAt: string
}

// ─── Constants ────────────────────────────────────────────────────────────────

const TYPE_COLORS = [
  "#6366f1", "#22c55e", "#f59e0b", "#3b82f6", "#ec4899",
  "#14b8a6", "#f97316", "#8b5cf6", "#0ea5e9", "#a3e635",
]

const STATUS_COLOR: Record<string, string> = {
  draft: "#94a3b8",
  pending_approval: "#f59e0b",
  approved: "#22c55e",
  active: "#10b981",
  renewing: "#6366f1",
  renewed: "#06b6d4",
  expired: "#ef4444",
  terminated: "#64748b",
  rejected: "#f43f5e",
  cancelled: "#94a3b8",
}

const SEVERITY_COLOR: Record<string, string> = {
  critical: "#ef4444",
  warning: "#f59e0b",
  info: "#3b82f6",
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function ContractAnalyticsPage() {
  const t = useTranslations("contractAnalytics")
  const locale = useLocale()

  const [data, setData] = useState<AnalyticsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Date filter
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")

  const load = useCallback(async (fromVal: string, toVal: string) => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (fromVal) params.set("from", fromVal)
      if (toVal) params.set("to", toVal)
      const url = `/api/v1/contract-analytics${params.toString() ? `?${params}` : ""}`
      const res = await fetch(url)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json: AnalyticsData = await res.json()
      setData(json)
    } catch (e) {
      setError(t("loadError"))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    load("", "")
  }, [load])

  const handleFilter = () => load(from, to)
  const handleReset = () => {
    setFrom("")
    setTo("")
    load("", "")
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  function fmtVal(strVal: string): string {
    const n = parseFloat(strVal)
    return isNaN(n) ? "—" : fmtCurrencyCompact(n)
  }

  function fmtRate(r: number | null): string {
    if (r === null) return "—"
    return `${r}%`
  }

  function fmtDays(d: number | null): string {
    if (d === null) return "—"
    return `${d}d`
  }

  function statusLabel(s: string): string {
    return t(`status.${s}`, { fallback: s })
  }

  function typeLabel(s: string): string {
    return s.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase())
  }

  // ─── Render ──────────────────────────────────────────────────────────────

  return (
    <MotionPage className="flex flex-col gap-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <BarChart3 className="h-6 w-6 text-indigo-500" />
            {t("title")}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">{t("subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <HelpButton slug="contracts-analytics" />
        </div>
      </div>

      {/* Date filter */}
      <MotionCard className="flex flex-wrap items-end gap-4 p-4">
        <div className="flex flex-col gap-1">
          <Label className="text-xs">{t("filterFrom")}</Label>
          <Input
            type="date"
            className="w-40 h-8 text-sm"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-xs">{t("filterTo")}</Label>
          <Input
            type="date"
            className="w-40 h-8 text-sm"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={handleFilter} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : t("filterApply")}
          </Button>
          <Button size="sm" variant="ghost" onClick={handleReset} disabled={loading}>
            <RefreshCw className="h-4 w-4 mr-1" />
            {t("filterReset")}
          </Button>
          <a
            href={`/api/v1/contract-analytics/export${(() => {
              const p = new URLSearchParams()
              if (from) p.set("from", from)
              if (to) p.set("to", to)
              return p.toString() ? `?${p.toString()}` : ""
            })()}`}
            download
            className="inline-flex items-center gap-1.5 text-xs h-8 px-3 rounded-md border border-input bg-background hover:bg-accent hover:text-accent-foreground transition-colors"
          >
            <Download className="h-3.5 w-3.5" />
            {t("exportXlsx")}
          </a>
        </div>
        {data?.generatedAt && (
          <span className="text-xs text-muted-foreground ml-auto">
            {t("generatedAt")}: {new Date(data.generatedAt).toLocaleTimeString(locale)}
          </span>
        )}
      </MotionCard>

      {/* Error state */}
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Loading skeleton */}
      {loading && !data && (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-indigo-500" />
        </div>
      )}

      {data && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            <ColorStatCard
              label={t("kpiLive")}
              value={data.summary.liveCount}
              icon={<FileText className="h-4 w-4 text-indigo-500" />}
              animate
            />
            <ColorStatCard
              label={t("kpiTotalValue")}
              value={fmtVal(data.summary.totalValue)}
              icon={<DollarSign className="h-4 w-4 text-emerald-500" />}
            />
            <ColorStatCard
              label={t("kpiMrr")}
              value={fmtCurrencyCompact(data.summary.mrr)}
              icon={<TrendingUp className="h-4 w-4 text-blue-500" />}
              subValue={t("kpiMrrSub")}
            />
            <ColorStatCard
              label={t("kpiCycleTime")}
              value={fmtDays(data.summary.avgCycleTimeDays)}
              icon={<Clock className="h-4 w-4 text-orange-500" />}
              subValue={t("kpiCycleTimeSub")}
            />
            <ColorStatCard
              label={t("kpiRenewalRate")}
              value={fmtRate(data.summary.renewalRate)}
              icon={<CheckCircle2 className="h-4 w-4 text-teal-500" />}
              subValue={
                data.summary.renewalRate === null
                  ? t("kpiRenewalRateNoData")
                  : `${data.summary.renewedCount}/${data.summary.renewedCount + data.summary.expiredCount}`
              }
            />
            <ColorStatCard
              label={t("kpiOpenDeviations")}
              value={data.summary.openDeviations}
              icon={<AlertTriangle className="h-4 w-4 text-red-500" />}
              subValue={`${data.summary.expiringSoon} ${t("expiringSoon")}`}
              animate
            />
          </div>

          {/* Main grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Expiry cohorts chart */}
            <MotionCard className="p-5">
              <h2 className="text-sm font-semibold mb-4 flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-indigo-400" />
                {t("cohortsTitle")}
              </h2>
              {data.cohorts.length === 0 ? (
                <div className="flex items-center justify-center h-40 text-sm text-muted-foreground">
                  {t("cohortsEmpty")}
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={data.cohorts} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                    <XAxis dataKey="period" tick={{ fontSize: 11 }} />
                    <YAxis
                      tick={{ fontSize: 11 }}
                      tickFormatter={(v) => fmtCurrencyCompact(v)}
                    />
                    <Tooltip
                      formatter={(v: unknown) => [fmtCurrencyCompact(Number(v)), t("cohortsTooltipValue")]}
                      labelFormatter={(label) => `${label}`}
                    />
                    <Bar dataKey="value" radius={[4, 4, 0, 0]} fill="#6366f1">
                      {data.cohorts.map((_, i) => (
                        <Cell key={i} fill={TYPE_COLORS[i % TYPE_COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </MotionCard>

            {/* By-type breakdown */}
            <MotionCard className="p-5">
              <h2 className="text-sm font-semibold mb-4 flex items-center gap-2">
                <Activity className="h-4 w-4 text-emerald-400" />
                {t("byTypeTitle")}
              </h2>
              {data.byType.length === 0 ? (
                <div className="flex items-center justify-center h-40 text-sm text-muted-foreground">
                  {t("byTypeEmpty")}
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {/* Mini bar chart */}
                  <ResponsiveContainer width="100%" height={140}>
                    <BarChart
                      data={data.byType}
                      layout="vertical"
                      margin={{ top: 0, right: 20, left: 0, bottom: 0 }}
                    >
                      <XAxis type="number" tick={{ fontSize: 10 }} />
                      <YAxis
                        dataKey="type"
                        type="category"
                        tick={{ fontSize: 10 }}
                        width={110}
                        tickFormatter={(v) => typeLabel(v)}
                      />
                      <Tooltip formatter={(v: unknown) => [Number(v), t("byTypeCount")]} />
                      <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                        {data.byType.map((_, i) => (
                          <Cell key={i} fill={TYPE_COLORS[i % TYPE_COLORS.length]} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                  {/* Table */}
                  <table className="w-full text-xs mt-2">
                    <thead>
                      <tr className="text-muted-foreground border-b">
                        <th className="text-left pb-1">{t("byTypeColType")}</th>
                        <th className="text-right pb-1">{t("byTypeColCount")}</th>
                        <th className="text-right pb-1">{t("byTypeColValue")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.byType.map((row, i) => (
                        <tr key={i} className="border-b border-zinc-100 dark:border-zinc-800">
                          <td className="py-1 flex items-center gap-1">
                            <span
                              className="inline-block w-2 h-2 rounded-full"
                              style={{ background: TYPE_COLORS[i % TYPE_COLORS.length] }}
                            />
                            {typeLabel(row.type)}
                          </td>
                          <td className="text-right py-1">{row.count}</td>
                          <td className="text-right py-1">{fmtVal(row.totalValue)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </MotionCard>

            {/* Approval funnel */}
            <MotionCard className="p-5">
              <h2 className="text-sm font-semibold mb-4 flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-blue-400" />
                {t("funnelTitle")}
              </h2>
              {data.approvalFlow.length === 0 ? (
                <div className="flex items-center justify-center h-40 text-sm text-muted-foreground">
                  {t("funnelEmpty")}
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {data.approvalFlow.map((row) => {
                    const pct = Math.min(
                      100,
                      Math.round(
                        (row.count /
                          Math.max(
                            1,
                            data.approvalFlow.reduce((s, r) => s + r.count, 0),
                          )) *
                          100,
                      ),
                    )
                    return (
                      <div key={row.status} className="flex items-center gap-3">
                        <Badge
                          className="w-28 justify-center text-xs shrink-0"
                          style={{
                            background: STATUS_COLOR[row.status] + "20",
                            color: STATUS_COLOR[row.status],
                            borderColor: STATUS_COLOR[row.status] + "40",
                          }}
                        >
                          {statusLabel(row.status)}
                        </Badge>
                        <div className="flex-1 bg-zinc-100 dark:bg-zinc-800 rounded-full h-2">
                          <div
                            className="h-2 rounded-full"
                            style={{
                              width: `${pct}%`,
                              background: STATUS_COLOR[row.status] ?? "#6366f1",
                            }}
                          />
                        </div>
                        <span className="text-xs font-medium w-8 text-right">{row.count}</span>
                      </div>
                    )
                  })}
                </div>
              )}
            </MotionCard>

            {/* Deviation risk */}
            <MotionCard className="p-5">
              <h2 className="text-sm font-semibold mb-4 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-red-400" />
                {t("deviationTitle")}
              </h2>
              {data.deviationRisk.every((r) => r.count === 0) ? (
                <div className="flex flex-col items-center justify-center h-40 gap-2 text-sm text-muted-foreground">
                  <CheckCircle2 className="h-8 w-8 text-emerald-400" />
                  {t("deviationEmpty")}
                </div>
              ) : (
                <div className="flex flex-col gap-4">
                  {data.deviationRisk.map((row) => (
                    <div key={row.severity} className="flex items-center gap-4">
                      <div
                        className="w-3 h-3 rounded-full shrink-0"
                        style={{ background: SEVERITY_COLOR[row.severity] ?? "#94a3b8" }}
                      />
                      <span className="text-sm capitalize w-20">{t(`severity.${row.severity}`)}</span>
                      <div className="flex-1 bg-zinc-100 dark:bg-zinc-800 rounded-full h-3">
                        <div
                          className="h-3 rounded-full"
                          style={{
                            width:
                              data.summary.openDeviations > 0
                                ? `${Math.round((row.count / data.summary.openDeviations) * 100)}%`
                                : "0%",
                            background: SEVERITY_COLOR[row.severity] ?? "#94a3b8",
                          }}
                        />
                      </div>
                      <span className="text-sm font-semibold w-8 text-right">{row.count}</span>
                    </div>
                  ))}
                  <p className="text-xs text-muted-foreground mt-2">
                    {t("deviationFooter", { total: data.summary.openDeviations })}
                  </p>
                </div>
              )}
            </MotionCard>
          </div>
        </>
      )}
    </MotionPage>
  )
}
