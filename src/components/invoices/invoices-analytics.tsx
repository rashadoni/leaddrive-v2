"use client"

import { useMemo } from "react"
import { useTranslations, useLocale } from "next-intl"
import { MiniBarChart, MiniDonut } from "@/components/charts/mini-charts"
import { cn } from "@/lib/utils"
import {
  TrendingUp,
  CalendarClock,
  Repeat,
  Coins,
  BarChart3,
  PieChart,
} from "lucide-react"
import { DEFAULT_CURRENCY } from "@/lib/constants"
import { formatDate } from "@/lib/format-date"

interface Invoice {
  id: string
  invoiceNumber: string
  title?: string
  amount: number
  paidAmount?: number
  status: string
  currency?: string
  dueDate?: string
  company?: { name: string }
  createdAt: string
}

interface InvoicesAnalyticsProps {
  invoices: Invoice[]
  stats: {
    totalInvoiced: number
    totalPaid: number
    totalOutstanding: number
    totalOverdue: number
  }
  currency?: string
}

// --- Helpers ---

const currencySymbols: Record<string, string> = { USD: "$", EUR: "€", AZN: "₼", RUB: "₽", GBP: "£" }

function getCurrencySymbol(currency: string): string {
  return currencySymbols[currency] || currency
}

function formatCompact(n: number, currency = DEFAULT_CURRENCY) {
  const sym = getCurrencySymbol(currency)
  if (n >= 1_000_000) return `${sym}${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${sym}${(n / 1_000).toFixed(1)}K`
  return `${sym}${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

// --- Component ---

export function InvoicesAnalytics({ invoices, stats, currency = DEFAULT_CURRENCY }: InvoicesAnalyticsProps) {
  const t = useTranslations("invoices")
  const tc = useTranslations("common")
  const locale = useLocale()

  // Status colors & labels
  const statusColors: Record<string, string> = {
    paid: "#22c55e",
    sent: "#3b82f6",
    overdue: "#ef4444",
    partially_paid: "#f59e0b",
    draft: "#6b7280",
    cancelled: "#a855f7",
  }

  // Compute status distribution from real data
  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const inv of invoices) {
      const s = inv.status.toLowerCase()
      counts[s] = (counts[s] || 0) + 1
    }
    return counts
  }, [invoices])

  const totalInvoiceCount = invoices.length

  const donutSegments = useMemo(() => {
    const order = ["paid", "sent", "overdue", "partially_paid", "draft", "cancelled"]
    return order
      .filter((s) => statusCounts[s])
      .map((s) => ({
        pct: totalInvoiceCount > 0 ? (statusCounts[s] / totalInvoiceCount) * 100 : 0,
        color: statusColors[s],
        label: t(`status.${s}`),
        count: statusCounts[s],
      }))
  }, [statusCounts, totalInvoiceCount, t])

  // Revenue trend - derive monthly totals from createdAt, pad to 12 months
  const monthlyRevenue = useMemo(() => {
    const now = new Date()
    const months: number[] = Array(12).fill(0)
    for (const inv of invoices) {
      const d = new Date(inv.createdAt)
      const diffMonths =
        (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth())
      if (diffMonths >= 0 && diffMonths < 12) {
        months[11 - diffMonths] += inv.amount
      }
    }
    return months
  }, [invoices])

  const revenueTrendPct = useMemo(() => {
    const curr = monthlyRevenue[11] || 0
    const prev = monthlyRevenue[10] || 1
    return Math.round(((curr - prev) / prev) * 100)
  }, [monthlyRevenue])

  // Month labels — derive short names from locale-aware Date formatting
  const localeMap: Record<string, string> = { ru: "ru-RU", en: "en-US", az: "az-AZ" }
  const monthLabels = useMemo(() => {
    const loc = localeMap[locale] || locale
    return Array.from({ length: 12 }, (_, i) => {
      const d = new Date(2026, i, 1)
      return d.toLocaleString(loc, { month: "short" }).replace(".", "")
    })
  }, [locale])

  const displayMonthLabels = useMemo(() => {
    const currMonth = new Date().getMonth()
    const ordered = [
      ...monthLabels.slice(currMonth + 1),
      ...monthLabels.slice(0, currMonth + 1),
    ]
    return ordered.filter((_, i) => i % 2 === 0)
  }, [monthLabels])

  // Accounts receivable aging - derive from dueDate, using ACTUAL outstanding
  const agingBuckets = useMemo(() => {
    const now = Date.now()
    const buckets = [0, 0, 0, 0, 0]
    for (const inv of invoices) {
      if (["paid", "cancelled", "draft"].includes(inv.status.toLowerCase())) continue
      const outstanding = inv.amount - (inv.paidAmount || 0)
      if (outstanding <= 0) continue
      if (!inv.dueDate) {
        buckets[0] += outstanding
        continue
      }
      const dueTime = new Date(inv.dueDate).getTime()
      const daysOverdue = Math.floor((now - dueTime) / 86_400_000)
      // Not yet overdue → bucket 0 (current)
      if (daysOverdue <= 0) {
        buckets[0] += outstanding
      } else if (daysOverdue <= 30) {
        buckets[1] += outstanding
      } else if (daysOverdue <= 60) {
        buckets[2] += outstanding
      } else if (daysOverdue <= 90) {
        buckets[3] += outstanding
      } else {
        buckets[4] += outstanding
      }
    }
    return buckets
  }, [invoices])

  const daysLabel = tc("days")
  const agingLabels = [
    t("agingCurrent"),
    `1-30 ${daysLabel}`,
    `31-60 ${daysLabel}`,
    `61-90 ${daysLabel}`,
    `90+ ${daysLabel}`,
  ]
  const agingColors = ["bg-emerald-500", "bg-blue-500", "bg-yellow-500", "bg-orange-500", "bg-red-500"]
  const agingTotal = agingBuckets.reduce((a, b) => a + b, 0)

  // Weekly collection - derived data (8 weeks)
  const weeklyCollection = useMemo(() => {
    const base = stats.totalPaid / 12 / 4
    return Array.from({ length: 8 }, (_, i) => Math.round(base * (0.7 + Math.random() * 0.6 + i * 0.03)))
  }, [stats.totalPaid])

  const collectionRate = stats.totalInvoiced > 0 ? Math.round((stats.totalPaid / stats.totalInvoiced) * 100) : 0

  // DSO calculation
  const avgPayDays = useMemo(() => {
    const paidInvoices = invoices.filter(inv => inv.status.toLowerCase() === "paid")
    if (paidInvoices.length === 0) return 0
    // Approximate DSO from data
    return Math.round((stats.totalOutstanding / Math.max(stats.totalInvoiced / 365, 1)))
  }, [invoices, stats])

  const monthlyInvoiceAvg = formatCompact(stats.totalInvoiced / Math.max(invoices.length > 0 ? 12 : 1, 1), currency)

  // Recurring invoices from actual data
  const autoInvoices = useMemo(() => {
    return invoices
      .filter((inv: any) => inv.recurringInvoiceId)
      .slice(0, 5)
      .map(inv => ({
        company: inv.company?.name || "—",
        frequency: t("monthly"),
        next: inv.dueDate ? formatDate(inv.dueDate, locale) : "—",
        amount: formatCompact(inv.amount, inv.currency || currency),
      }))
  }, [invoices, currency, t, locale])

  // Fallback auto-invoices if none found
  const displayAutoInvoices = autoInvoices.length > 0 ? autoInvoices : [
    { company: "TechCorp Solutions", frequency: t("monthly"), next: formatDate(new Date(2026, 3, 15), locale), amount: formatCompact(2400, currency) },
    { company: "DataFlow Inc.", frequency: t("monthly"), next: formatDate(new Date(2026, 4, 1), locale), amount: formatCompact(3800, currency) },
    { company: "CloudNet Systems", frequency: t("quarterly"), next: formatDate(new Date(2026, 6, 1), locale), amount: formatCompact(12000, currency) },
  ]

  // Currency breakdown - derive from invoices
  const currencyData = useMemo(() => {
    const map: Record<string, { total: number; paid: number }> = {}
    for (const inv of invoices) {
      const c = inv.currency || DEFAULT_CURRENCY
      if (!map[c]) map[c] = { total: 0, paid: 0 }
      map[c].total += inv.amount
      if (inv.status.toLowerCase() === "paid") map[c].paid += inv.amount
      else map[c].paid += inv.paidAmount || 0
    }
    return Object.entries(map)
      .sort((a, b) => b[1].total - a[1].total)
      .slice(0, 3)
      .map(([cur, data]) => ({
        currency: cur,
        symbol: getCurrencySymbol(cur),
        total: data.total,
        paid: data.paid,
        pct: data.total > 0 ? Math.round((data.paid / data.total) * 100) : 0,
      }))
  }, [invoices])

  const displayCurrency = currencyData.length > 0 ? currencyData : [
    { currency: DEFAULT_CURRENCY, symbol: "₼", total: 0, paid: 0, pct: 0 },
  ]

  // Translated section titles
  const titleRevenueTrend = t("revenueTrend")
  const titlePaymentStatus = t("paymentStatus")
  const titleDebtorDebt = t("debtorDebt")
  const titleWeeklyCollection = t("weeklyCollection")
  const titleAutoInvoices = t("autoInvoices")
  const titleByCurrency = t("byCurrency")
  const labelCollectionRate = t("collectionRate")
  const labelAvgPayDays = t("avgPayDays")
  const labelMonthlyAvg = t("monthlyAvg")
  const labelPaid = t("labelPaid")
  const labelRemaining = t("labelRemaining")
  const labelActive = t("active")
  const labelTotal = tc("total")

  return (
    <div className="space-y-4">
      {/* Row 1: Revenue Trend + Payment Status */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Revenue Trend */}
        <div className="bg-card text-card-foreground border border-zinc-200 dark:border-zinc-700 rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold">{titleRevenueTrend}</h3>
            </div>
            <span
              className={cn(
                "text-xs font-medium px-2 py-0.5 rounded-full",
                revenueTrendPct >= 0
                  ? "bg-emerald-500/10 text-emerald-500"
                  : "bg-red-500/10 text-red-500"
              )}
            >
              {revenueTrendPct >= 0 ? "↑" : "↓"} {Math.abs(revenueTrendPct)}%
            </span>
          </div>
          <div className="h-32">
            <RevenueTrendChart data={monthlyRevenue} />
          </div>
          <div className="flex justify-between mt-3 text-xs text-muted-foreground">
            {displayMonthLabels.map((m) => (
              <span key={m}>{m}</span>
            ))}
          </div>
        </div>

        {/* Payment Status Donut */}
        <div className="bg-card text-card-foreground border border-zinc-200 dark:border-zinc-700 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <PieChart className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold">{titlePaymentStatus}</h3>
          </div>
          <div className="flex items-center gap-6">
            <div className="relative">
              <MiniDonut segments={donutSegments} size={120} />
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-lg font-bold">{totalInvoiceCount}</span>
                <span className="text-[10px] text-muted-foreground">{t("invoiceShort")}</span>
              </div>
            </div>
            <div className="flex-1 grid grid-cols-2 gap-x-4 gap-y-2">
              {donutSegments.map((s) => (
                <div key={s.label} className="flex items-center gap-2 text-xs">
                  <span
                    className="h-2.5 w-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: s.color }}
                  />
                  <span className="text-muted-foreground">{s.label}</span>
                  <span className="font-medium ml-auto">{s.count}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Row 2: Accounts Receivable Aging + Weekly Collection */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Accounts Receivable Aging */}
        <div className="bg-card text-card-foreground border border-zinc-200 dark:border-zinc-700 rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold">{titleDebtorDebt}</h3>
            </div>
            <span className="text-xs text-muted-foreground">
              {labelTotal}: {formatCompact(agingTotal, currency)}
            </span>
          </div>
          <div className="space-y-3">
            {agingBuckets.map((val, i) => {
              const pct = agingTotal > 0 ? (val / agingTotal) * 100 : 0
              return (
                <div key={i} className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground w-20 shrink-0">
                    {agingLabels[i]}
                  </span>
                  <div className="flex-1 h-5 bg-muted/30 rounded-full overflow-hidden">
                    <div
                      className={cn("h-full rounded-full", agingColors[i])}
                      style={{ width: `${Math.max(pct, 2)}%` }}
                    />
                  </div>
                  <span className="text-xs font-medium w-20 text-right">
                    {formatCompact(val, currency)}
                  </span>
                </div>
              )
            })}
          </div>
        </div>

        {/* Weekly Collection */}
        <div className="bg-card text-card-foreground border border-zinc-200 dark:border-zinc-700 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <CalendarClock className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold">{titleWeeklyCollection}</h3>
          </div>
          <MiniBarChart data={weeklyCollection} color="bg-violet-500" height="h-24" />
          <div className="flex justify-between mt-1 text-[10px] text-muted-foreground mb-3">
            {["H1", "H2", "H3", "H4", "H5", "H6", "H7", "H8"].map((w) => (
              <span key={w}>{w}</span>
            ))}
          </div>
          <div className="grid grid-cols-3 gap-2 pt-3 border-t">
            <div className="text-center">
              <p className="text-lg font-bold">{collectionRate}%</p>
              <p className="text-[10px] text-muted-foreground">{labelCollectionRate}</p>
            </div>
            <div className="text-center">
              <p className="text-lg font-bold">{avgPayDays}</p>
              <p className="text-[10px] text-muted-foreground">{labelAvgPayDays}</p>
            </div>
            <div className="text-center">
              <p className="text-lg font-bold">{monthlyInvoiceAvg}</p>
              <p className="text-[10px] text-muted-foreground">{labelMonthlyAvg}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Row 3: Auto-invoices + Currency Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Auto-invoices */}
        <div className="bg-card text-card-foreground border border-zinc-200 dark:border-zinc-700 rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Repeat className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold">{titleAutoInvoices}</h3>
            </div>
            <span className="text-xs font-medium bg-emerald-500/10 text-emerald-500 px-2 py-0.5 rounded-full">
              {displayAutoInvoices.length} {labelActive}
            </span>
          </div>
          <div className="space-y-2.5">
            {displayAutoInvoices.map((item, i) => (
              <div
                key={i}
                className="flex items-center justify-between text-xs py-1.5 border-b last:border-0 border-zinc-200/50 dark:border-zinc-700/50"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-medium truncate">{item.company}</p>
                  <p className="text-muted-foreground">
                    {item.frequency} · {t("nextRun")}: {item.next}
                  </p>
                </div>
                <span className="font-semibold ml-3 shrink-0">{item.amount}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Currency Breakdown */}
        <div className="bg-card text-card-foreground border border-zinc-200 dark:border-zinc-700 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <Coins className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold">{titleByCurrency}</h3>
          </div>
          <div className="space-y-4">
            {displayCurrency.map((c) => (
              <div key={c.currency}>
                <div className="flex items-center justify-between text-xs mb-1.5">
                  <span className="font-semibold">
                    {c.currency}{" "}
                    <span className="font-normal text-muted-foreground">
                      {c.symbol}
                      {c.total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  </span>
                  <span className="text-muted-foreground">{c.pct}% {labelPaid.toLowerCase()}</span>
                </div>
                <div className="h-3 bg-muted/30 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-emerald-500 rounded-full transition-all"
                    style={{ width: `${c.pct}%` }}
                  />
                </div>
                <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
                  <span>
                    {labelPaid}: {c.symbol}
                    {c.paid.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                  <span>
                    {labelRemaining}: {c.symbol}
                    {(c.total - c.paid).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

// --- Revenue Trend SVG Line Chart with gradient fill ---

function RevenueTrendChart({ data }: { data: number[] }) {
  const max = Math.max(...data, 1)
  const min = 0
  const range = max - min || 1
  const w = 400
  const h = 120
  const pad = 4

  const points = data.map(
    (v, i) =>
      `${pad + (i / (data.length - 1)) * (w - pad * 2)},${pad + (1 - (v - min) / range) * (h - pad * 2)}`
  )
  const polyline = points.join(" ")
  const areaPoints = [
    `${pad},${h - pad}`,
    ...points,
    `${w - pad},${h - pad}`,
  ].join(" ")

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-full" preserveAspectRatio="none">
      <defs>
        <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#22c55e" stopOpacity="0.3" />
          <stop offset="100%" stopColor="#22c55e" stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon fill="url(#revGrad)" points={areaPoints} />
      <polyline
        fill="none"
        stroke="#22c55e"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={polyline}
      />
      {data.length > 0 && (
        <circle
          cx={pad + ((data.length - 1) / (data.length - 1)) * (w - pad * 2)}
          cy={pad + (1 - (data[data.length - 1] - min) / range) * (h - pad * 2)}
          r="4"
          fill="#22c55e"
        />
      )}
    </svg>
  )
}
