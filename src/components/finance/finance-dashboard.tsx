"use client"

import { useState } from "react"
import { useTranslations, useLocale } from "next-intl"
import { formatDate } from "@/lib/format-date"
import { useFinanceDashboard } from "@/lib/finance/hooks"
import { FinanceKpiCard } from "./finance-kpi-card"
import { FinanceAlerts } from "./finance-alerts"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  TrendingUp, TrendingDown, DollarSign, Wallet, FileText,
  CreditCard,
} from "lucide-react"
import {
  ResponsiveContainer, ComposedChart, Line, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, PieChart, Pie, Cell, BarChart,
} from "recharts"
import { getCurrencySymbol } from "@/lib/constants"

function fmt(n: number): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 })
}

// Maps the API's English aging-bucket labels to stable i18n slugs.
const AGING_LABEL_KEYS: Record<string, string> = {
  "Current": "aging.current",
  "1-30 days": "aging.d1_30",
  "31-60 days": "aging.d31_60",
  "61-90 days": "aging.d61_90",
  "90+": "aging.d90plus",
}

export function FinanceDashboard() {
  const t = useTranslations("finance.dash")
  const locale = useLocale()
  const [year, setYear] = useState(new Date().getFullYear())
  const [dateFrom, setDateFrom] = useState("")
  const [dateTo, setDateTo] = useState("")
  const hasCustomRange = !!dateFrom && !!dateTo

  const { data, isLoading, error } = useFinanceDashboard(
    year,
    hasCustomRange ? { dateFrom, dateTo } : undefined,
  )

  const clearRange = () => { setDateFrom(""); setDateTo("") }

  if (isLoading) return <DashboardSkeleton />
  if (error) return <div className="p-8 text-center text-red-500">{t("error")}: {(error as Error).message}</div>
  if (!data) return <div className="p-8 text-center text-muted-foreground">{t("noData")}</div>

  const { kpis, revenueTrend, expenseBreakdown, arAging, alerts } = data
  const displayYear = data.year ?? year
  // Localise the server-provided aging-bucket labels (e.g. "1-30 days") for the chart.
  const arAgingData = arAging.map((b) => ({
    ...b,
    label: AGING_LABEL_KEYS[b.label] ? t(AGING_LABEL_KEYS[b.label]) : b.label,
  }))
  // Localise the X-axis month labels from the server-provided month index (1-12);
  // the API's English `label` (e.g. "Jan") stays as a fallback for invalid dates.
  const revenueTrendData = revenueTrend.map((m) => ({
    ...m,
    label: formatDate(new Date(Date.UTC(m.year, m.month - 1, 1)), locale, { month: "short", timeZone: "UTC" }) || m.label,
  }))
  // Localise the generic "Other" overflow bucket; real category names are left untouched.
  const expenseBreakdownData = expenseBreakdown.map((e) => ({
    ...e,
    category: e.isOther ? t("expenseOther") : e.category,
  }))

  return (
    <div className="space-y-6">
      {/* Year selector + date range */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-bold">{t("title")}</h2>
          <p className="text-sm text-muted-foreground">
            {hasCustomRange
              ? `${dateFrom} – ${dateTo}`
              : t("subtitle", { year: displayYear })}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={year}
            onChange={(e) => { setYear(Number(e.target.value)); clearRange() }}
            disabled={hasCustomRange}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm disabled:opacity-50"
          >
            {[year - 1, year, year + 1].map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
          <span className="text-xs text-muted-foreground">{t("dateRangeOr")}</span>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          />
          <span className="text-xs text-muted-foreground">–</span>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            min={dateFrom || undefined}
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          />
          {hasCustomRange && (
            <button
              onClick={clearRange}
              className="h-9 px-3 rounded-md border border-input text-sm hover:bg-muted transition-colors"
            >
              {t("clearRange")}
            </button>
          )}
          <a
            href={`/api/finance/dashboard/export?${hasCustomRange ? `dateFrom=${dateFrom}&dateTo=${dateTo}` : `year=${displayYear}`}`}
            download
            className="h-9 px-3 rounded-md border border-input text-sm hover:bg-muted transition-colors flex items-center gap-1.5"
            title={t("exportExcel")}
          >
            ↓ {t("exportExcel")}
          </a>
        </div>
      </div>

      {/* Alerts */}
      <FinanceAlerts alerts={alerts} />

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <FinanceKpiCard
          title={t("revenue")}
          value={kpis.revenue.fact}
          plan={kpis.revenue.plan}
          planLabel={t("plan")}
          variancePct={kpis.revenue.variancePct}
          icon={<TrendingUp className="w-5 h-5" />}
          color="#22c55e"
        />
        <FinanceKpiCard
          title={t("expenses")}
          value={kpis.expenses.fact}
          plan={kpis.expenses.plan}
          planLabel={t("plan")}
          variancePct={kpis.expenses.variancePct}
          icon={<TrendingDown className="w-5 h-5" />}
          color="#ef4444"
          invertVariance
        />
        <FinanceKpiCard
          title={t("netProfit")}
          value={kpis.netProfit.fact}
          icon={<DollarSign className="w-5 h-5" />}
          color={kpis.netProfit.fact >= 0 ? "#22c55e" : "#ef4444"}
        />
        <FinanceKpiCard
          title={t("cashBalance")}
          value={kpis.cashBalance.current}
          icon={<Wallet className="w-5 h-5" />}
          color={kpis.cashBalance.current >= 0 ? "#3b82f6" : "#ef4444"}
        />
        <FinanceKpiCard
          title={t("arTotal")}
          value={kpis.arTotal.amount}
          sub={kpis.arTotal.overdueCount > 0 ? `${kpis.arTotal.overdueCount} ${t("overdue")}` : undefined}
          icon={<FileText className="w-5 h-5" />}
          color="#f59e0b"
        />
        <FinanceKpiCard
          title={t("apTotal")}
          value={kpis.apTotal.amount}
          sub={kpis.apTotal.overdueCount > 0 ? `${kpis.apTotal.overdueCount} ${t("overdue")}` : undefined}
          icon={<CreditCard className="w-5 h-5" />}
          color="#8b5cf6"
        />
      </div>

      {/* Charts Row 1: Revenue Trend + Expense Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Revenue & Expense Trend */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">{t("trendTitle")}</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <ComposedChart data={revenueTrendData}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(0)}K` : v} />
                <Tooltip
                  formatter={((value: number, name: string) => [fmt(value) + ` ${getCurrencySymbol()}`, name === "revenue" ? t("revenue") : name === "expenses" ? t("expenses") : t("netProfit")]) as any}
                  labelFormatter={(label) => hasCustomRange ? `${label} (${dateFrom?.slice(0, 7)} – ${dateTo?.slice(0, 7)})` : `${label} ${displayYear}`}
                />
                <Bar dataKey="revenue" fill="#22c55e" opacity={0.8} radius={[4, 4, 0, 0]} name="revenue" />
                <Bar dataKey="expenses" fill="#ef4444" opacity={0.8} radius={[4, 4, 0, 0]} name="expenses" />
                <Line type="monotone" dataKey="net" stroke="#3b82f6" strokeWidth={2} dot={false} name="net" />
              </ComposedChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Expense Breakdown Pie */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">{t("expenseTitle")}</CardTitle>
          </CardHeader>
          <CardContent>
            {expenseBreakdownData.length > 0 ? (
              <>
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie
                      data={expenseBreakdownData}
                      cx="50%"
                      cy="50%"
                      innerRadius={50}
                      outerRadius={80}
                      paddingAngle={2}
                      dataKey="amount"
                    >
                      {expenseBreakdownData.map((entry, i) => (
                        <Cell key={i} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip formatter={((value: number) => fmt(value) + ` ${getCurrencySymbol()}`) as any} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="space-y-1 mt-2">
                  {expenseBreakdownData.map((item) => (
                    <div key={item.category} className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-1.5">
                        <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: item.color }} />
                        <span className="truncate max-w-[120px]">{item.category}</span>
                      </div>
                      <span className="font-medium tabular-nums">{item.pct}%</span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="h-[200px] flex items-center justify-center text-sm text-muted-foreground">{t("noExpenseData")}</div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Charts Row 2: A/R Aging */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">{t("agingTitle")}</CardTitle>
          </CardHeader>
          <CardContent>
            {arAgingData.some((b) => b.amount > 0) ? (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={arAgingData} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(v) => fmt(v)} />
                  <YAxis type="category" dataKey="label" tick={{ fontSize: 11 }} width={50} />
                  <Tooltip formatter={((value: number) => fmt(value) + ` ${getCurrencySymbol()}`) as any} />
                  <Bar dataKey="amount" radius={[0, 4, 4, 0]}>
                    {arAgingData.map((_, i) => (
                      <Cell key={i} fill={["#3b82f6", "#22c55e", "#f59e0b", "#f97316", "#ef4444"][i % 5]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[220px] flex items-center justify-center text-sm text-muted-foreground">{t("noAgingData")}</div>
            )}
          </CardContent>
        </Card>

        {/* Quick Stats Card */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">{t("summaryTitle")}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <SummaryRow label={t("revenuePlan")} value={kpis.revenue.plan} color="#22c55e" />
              <SummaryRow label={t("revenueFact")} value={kpis.revenue.fact} color="#16a34a" />
              <SummaryRow label={t("expensesPlan")} value={kpis.expenses.plan} color="#f59e0b" />
              <SummaryRow label={t("expensesFact")} value={kpis.expenses.fact} color="#ef4444" />
              <div className="border-t pt-2" />
              <SummaryRow label={t("netProfitLabel")} value={kpis.netProfit.fact} color={kpis.netProfit.fact >= 0 ? "#22c55e" : "#ef4444"} bold />
              <SummaryRow label={t("cashBalanceLabel")} value={kpis.cashBalance.current} color="#3b82f6" bold />
              <div className="border-t pt-2" />
              <SummaryRow label={t("arLabel")} value={kpis.arTotal.amount} color="#f59e0b" />
              <SummaryRow label={t("apLabel")} value={kpis.apTotal.amount} color="#8b5cf6" />
              <SummaryRow label={t("netPosition")} value={kpis.arTotal.amount - kpis.apTotal.amount} color="#3b82f6" bold />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function SummaryRow({ label, value, color, bold }: { label: string; value: number; color: string; bold?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className={`text-xs ${bold ? "font-semibold" : "text-muted-foreground"}`}>{label}</span>
      <span className={`text-sm tabular-nums ${bold ? "font-bold" : "font-medium"}`} style={{ color }}>
        {fmt(value)} {getCurrencySymbol()}
      </span>
    </div>
  )
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex justify-between">
        <div className="h-8 w-48" />
        <div className="h-8 w-24" />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-[100px] rounded-xl" />
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="h-[340px] lg:col-span-2 rounded-xl" />
        <div className="h-[340px] rounded-xl" />
      </div>
    </div>
  )
}
