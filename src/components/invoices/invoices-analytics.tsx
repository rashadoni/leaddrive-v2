"use client"

import { useEffect, useMemo, useState } from "react"
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
import { formatDate } from "@/lib/format-date"
import { getCurrencySymbol } from "@/lib/currency"
import { formatBucket, formatExtras, type MoneyBucket } from "@/lib/deal-money"
import {
  averageDaysToPay,
  billingByCurrency,
  changeOnPrevious,
  monthlyAverage,
  monthlyBilled,
  paidWithoutRecordedPayment,
  receivablesAging,
  recurringSummary,
  weeklyCollections,
  type CurrencySeries,
  type InvoiceAnalyticsRecord,
  type RecurringRuleRecord,
} from "@/lib/invoices/analytics"

// Every figure on this tab comes from src/lib/invoices/analytics.ts, which may
// not produce a number that no record holds. Where the records cannot answer,
// the tab prints «—» or says why. Money is never added across currencies: each
// chart leads with its largest currency and lists the others beside it.

interface InvoicesAnalyticsProps {
  invoices: InvoiceAnalyticsRecord[]
  /** How many invoices match; `invoices` may be only the latest of them. */
  total?: number
  orgId?: string | null
}

const WEEKS = 8
const MONTHS = 12

// Every status an invoice can hold, so the legend adds up to the count in the middle.
const STATUS_ORDER = ["paid", "sent", "viewed", "overdue", "partially_paid", "draft", "cancelled", "refunded"]
const STATUS_COLORS: Record<string, string> = {
  paid: "#22c55e",
  sent: "#3b82f6",
  viewed: "#06b6d4",
  overdue: "#ef4444",
  partially_paid: "#f59e0b",
  draft: "#6b7280",
  cancelled: "#a855f7",
  refunded: "#64748b",
}

// --- Helpers ---

function formatCompact(n: number, currency: string) {
  const sym = getCurrencySymbol(currency)
  if (n >= 1_000_000) return `${sym}${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${sym}${(n / 1_000).toFixed(1)}K`
  return `${sym}${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function formatFull(n: number, currency: string) {
  return `${getCurrencySymbol(currency)}${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function asBucket(series: CurrencySeries): MoneyBucket {
  return { currency: series.currency, value: series.total, count: series.count }
}

/** The largest currency, spelled out, and the others after it — never one sum. */
function MoneyLine({ label, series }: { label: string; series: CurrencySeries[] }) {
  if (series.length === 0) return null
  const extras = formatExtras(series.slice(1).map(asBucket))
  return (
    <p className="text-[11px] text-muted-foreground">
      {label}: <span className="font-medium text-foreground">{formatBucket(asBucket(series[0]))}</span>
      {extras && <span className="ml-2">{extras}</span>}
    </p>
  )
}

function Muted({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>
}

// --- Recurring rules: GET /api/v1/recurring-invoices ---

type Source<T> = { state: "loading" } | { state: "ready"; data: T } | { state: "failed" }

function useRecurringRules(orgId: string | null | undefined): Source<RecurringRuleRecord[]> {
  const [source, setSource] = useState<Source<RecurringRuleRecord[]>>({ state: "loading" })
  useEffect(() => {
    const controller = new AbortController()
    const headers: Record<string, string> = orgId ? { "x-organization-id": String(orgId) } : {}
    fetch("/api/v1/recurring-invoices", { headers, signal: controller.signal })
      .then(async (res) => {
        const json = res.ok ? await res.json() : null
        const rows = json?.success && Array.isArray(json.data) ? (json.data as RecurringRuleRecord[]) : null
        if (!controller.signal.aborted) setSource(rows ? { state: "ready", data: rows } : { state: "failed" })
      })
      .catch(() => {
        if (!controller.signal.aborted) setSource({ state: "failed" })
      })
    return () => controller.abort()
  }, [orgId])
  return source
}

// --- Component ---

export function InvoicesAnalytics({ invoices, total, orgId }: InvoicesAnalyticsProps) {
  const t = useTranslations("invoices")
  const tc = useTranslations("common")
  const locale = useLocale()
  const recurring = useRecurringRules(orgId)

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
    return STATUS_ORDER
      .filter((s) => statusCounts[s])
      .map((s) => ({
        pct: totalInvoiceCount > 0 ? (statusCounts[s] / totalInvoiceCount) * 100 : 0,
        color: STATUS_COLORS[s],
        label: t(`status.${s}`),
        count: statusCounts[s],
      }))
  }, [statusCounts, totalInvoiceCount, t])

  const billed = useMemo(() => monthlyBilled(invoices, new Date(), MONTHS), [invoices])
  const weekly = useMemo(() => weeklyCollections(invoices, new Date(), WEEKS), [invoices])
  const aging = useMemo(() => receivablesAging(invoices, new Date()), [invoices])
  const standing = useMemo(() => billingByCurrency(invoices), [invoices])
  const daysToPay = useMemo(() => averageDaysToPay(invoices), [invoices])
  const unrecordedPaid = useMemo(() => paidWithoutRecordedPayment(invoices), [invoices])

  const trendLead = billed.byCurrency[0] ?? null
  const trendChange = trendLead ? changeOnPrevious(trendLead.values) : null
  const monthlyAvg = trendLead ? monthlyAverage(trendLead) : null
  const weeklyLead = weekly.byCurrency[0] ?? null
  const agingLead = aging[0] ?? null
  const rateLead = standing[0] ?? null
  const rules = recurring.state === "ready" ? recurringSummary(recurring.data) : null

  const monthLabels = billed.months
    .map((m) => formatDate(new Date(m.year, m.month, 1), locale, { month: "short" }).replace(".", ""))
    .filter((_, i) => i % 2 === 0)
  const weekLabels = weekly.weeks.map((w) => formatDate(w, locale, { day: "2-digit", month: "2-digit" }))
  const weekTitles = weekLeadTitles(weekly.weeks, weeklyLead, locale)

  const daysLabel = tc("days")
  const agingLabels = [
    t("agingCurrent"),
    `1-30 ${daysLabel}`,
    `31-60 ${daysLabel}`,
    `61-90 ${daysLabel}`,
    `90+ ${daysLabel}`,
  ]
  const agingColors = ["bg-emerald-500", "bg-blue-500", "bg-yellow-500", "bg-orange-500", "bg-red-500"]

  const frequencyLabel = (frequency: string, interval: number) => {
    const known = ["daily", "weekly", "monthly", "quarterly", "yearly"].includes(frequency)
    const label = known ? t(frequency) : frequency
    return interval > 1 ? `${interval} × ${label}` : label
  }

  return (
    <div className="space-y-4">
      {total != null && total > invoices.length && (
        <p className="text-xs text-muted-foreground">{t("analyticsBasedOnLatest", { count: invoices.length, total })}</p>
      )}

      {/* Row 1: Revenue Trend + Payment Status */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Revenue Trend — the largest currency; the others are listed, not added */}
        <div
          data-testid="invoices-analytics-trend"
          className="bg-card text-card-foreground border border-zinc-200 dark:border-zinc-700 rounded-xl p-5"
        >
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold">{t("revenueTrend")}</h3>
            </div>
            {trendChange != null && (
              <span
                className={cn(
                  "text-xs font-medium px-2 py-0.5 rounded-full",
                  trendChange >= 0
                    ? "bg-emerald-500/10 text-emerald-500"
                    : "bg-red-500/10 text-red-500"
                )}
              >
                {trendChange >= 0 ? "↑" : "↓"} {Math.abs(Math.round(trendChange))}%
              </span>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground mb-3">{t("revenueTrendBasis")}</p>
          {trendLead ? (
            <>
              <div className="h-32">
                <RevenueTrendChart data={trendLead.values} />
              </div>
              <div className="flex justify-between mt-3 mb-2 text-xs text-muted-foreground">
                {monthLabels.map((m, i) => (
                  <span key={`${m}-${i}`}>{m}</span>
                ))}
              </div>
              <MoneyLine label={t("lastMonths", { count: MONTHS })} series={billed.byCurrency} />
            </>
          ) : (
            <Muted>{t("noBilledInPeriod", { count: MONTHS })}</Muted>
          )}
        </div>

        {/* Payment Status Donut */}
        <div className="bg-card text-card-foreground border border-zinc-200 dark:border-zinc-700 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <PieChart className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold">{t("paymentStatus")}</h3>
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
        {/* Accounts Receivable Aging — the largest currency owed */}
        <div
          data-testid="invoices-analytics-aging"
          className="bg-card text-card-foreground border border-zinc-200 dark:border-zinc-700 rounded-xl p-5"
        >
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold">{t("debtorDebt")}</h3>
            </div>
            {agingLead && (
              <span className="text-xs text-muted-foreground">
                {tc("total")}: {formatCompact(agingLead.total, agingLead.currency)}
              </span>
            )}
          </div>
          {agingLead ? (
            <>
              <div className="space-y-3">
                {agingLead.values.map((val, i) => {
                  const pct = agingLead.total > 0 ? (val / agingLead.total) * 100 : 0
                  return (
                    <div key={i} className="flex items-center gap-3">
                      <span className="text-xs text-muted-foreground w-20 shrink-0">
                        {agingLabels[i]}
                      </span>
                      <div className="flex-1 h-5 bg-muted/30 rounded-full overflow-hidden">
                        <div
                          className={cn("h-full rounded-full", agingColors[i])}
                          style={{ width: `${val > 0 ? Math.max(pct, 2) : 0}%` }}
                        />
                      </div>
                      <span className="text-xs font-medium w-20 text-right">
                        {formatCompact(val, agingLead.currency)}
                      </span>
                    </div>
                  )
                })}
              </div>
              {aging.length > 1 && (
                <p className="mt-3 text-[11px] text-muted-foreground">
                  {t("otherCurrencies")}: {formatExtras(aging.slice(1).map(asBucket))}
                </p>
              )}
            </>
          ) : (
            <Muted>{t("noOutstanding")}</Muted>
          )}
        </div>

        {/* Weekly Collection — recorded payments by payment date */}
        <div
          data-testid="invoices-analytics-weekly"
          className="bg-card text-card-foreground border border-zinc-200 dark:border-zinc-700 rounded-xl p-5"
        >
          <div className="flex items-center gap-2 mb-1">
            <CalendarClock className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold">{t("weeklyCollection")}</h3>
          </div>
          <p className="text-[11px] text-muted-foreground mb-3">{t("weeklyCollectionBasis")}</p>
          {weeklyLead ? (
            <>
              <div data-testid="invoices-analytics-weekly-bars">
                <MiniBarChart data={weeklyLead.values} titles={weekTitles} zeroIsEmpty color="bg-violet-500" height="h-24" />
              </div>
              <div className="flex mt-1 text-[10px] text-muted-foreground mb-2">
                {weekLabels.map((w, i) => (
                  <span key={`${w}-${i}`} className="flex-1 text-center">{w}</span>
                ))}
              </div>
              <MoneyLine label={t("lastWeeks", { count: WEEKS })} series={weekly.byCurrency} />
            </>
          ) : (
            <Muted>{t("noPaymentsInWeeks", { count: WEEKS })}</Muted>
          )}
          {unrecordedPaid > 0 && (
            <p className="mt-1 text-[11px] text-muted-foreground">{t("paidWithoutPayment", { count: unrecordedPaid })}</p>
          )}
          <div className="grid grid-cols-3 gap-2 pt-3 mt-3 border-t">
            <MiniStat
              testId="collection-rate"
              value={rateLead?.percent != null ? `${Math.round(rateLead.percent)}%` : "—"}
              label={standing.length > 1 && rateLead ? `${t("collectionRate")} · ${rateLead.currency}` : t("collectionRate")}
              note={rateLead?.percent != null ? undefined : t("noBilledYet")}
            />
            <MiniStat
              testId="days-to-pay"
              value={daysToPay ? String(daysToPay.days) : "—"}
              label={t("avgPayDays")}
              note={daysToPay ? t("overInvoices", { count: daysToPay.count }) : t("noSettledPayments")}
            />
            <MiniStat
              testId="monthly-avg"
              value={monthlyAvg && trendLead ? formatCompact(monthlyAvg.value, trendLead.currency) : "—"}
              label={t("monthlyAvg")}
              note={monthlyAvg ? t("overMonths", { count: monthlyAvg.months }) : t("noBilledInPeriod", { count: MONTHS })}
            />
          </div>
        </div>
      </div>

      {/* Row 3: Auto-invoices + Currency Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Auto-invoices — active recurring rules, soonest run first */}
        <div
          data-testid="invoices-analytics-recurring"
          className="bg-card text-card-foreground border border-zinc-200 dark:border-zinc-700 rounded-xl p-5"
        >
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Repeat className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold">{t("autoInvoices")}</h3>
            </div>
            {rules && (
              <span className="text-xs font-medium bg-emerald-500/10 text-emerald-500 px-2 py-0.5 rounded-full">
                {t("activeRules", { count: rules.active })}
              </span>
            )}
          </div>
          {recurring.state === "loading" ? (
            <Muted>…</Muted>
          ) : recurring.state === "failed" ? (
            <Muted>{t("dataUnavailable")}</Muted>
          ) : rules && rules.upcoming.length > 0 ? (
            <div className="space-y-2.5">
              {rules.upcoming.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between text-xs py-1.5 border-b last:border-0 border-zinc-200/50 dark:border-zinc-700/50"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-medium truncate">{item.name}</p>
                    <p className="text-muted-foreground">
                      {frequencyLabel(item.frequency, item.intervalCount)} · {t("nextRun")}:{" "}
                      {item.nextRunDate ? formatDate(item.nextRunDate, locale) : "—"}
                    </p>
                  </div>
                  <span className="font-semibold ml-3 shrink-0">{formatCompact(item.amount, item.currency)}</span>
                </div>
              ))}
            </div>
          ) : (
            <Muted>{t("noRecurringRules")}</Muted>
          )}
        </div>

        {/* Currency Breakdown — billed invoices only */}
        <div
          data-testid="invoices-analytics-currency"
          className="bg-card text-card-foreground border border-zinc-200 dark:border-zinc-700 rounded-xl p-5"
        >
          <div className="flex items-center gap-2 mb-4">
            <Coins className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold">{t("byCurrency")}</h3>
          </div>
          {standing.length === 0 ? (
            <Muted>{t("noBilledYet")}</Muted>
          ) : (
            <div className="space-y-4">
              {standing.map((c) => (
                <div key={c.currency}>
                  <div className="flex items-center justify-between text-xs mb-1.5">
                    <span className="font-semibold">
                      {c.currency}{" "}
                      <span className="font-normal text-muted-foreground">{formatFull(c.billed, c.currency)}</span>
                    </span>
                    <span className="text-muted-foreground">
                      {c.percent != null ? `${Math.round(c.percent)}%` : "—"} {t("labelPaid").toLowerCase()}
                    </span>
                  </div>
                  <div className="h-3 bg-muted/30 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-emerald-500 rounded-full transition-all"
                      style={{ width: `${Math.min(100, c.percent ?? 0)}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
                    <span>
                      {t("labelPaid")}: {formatFull(c.paid, c.currency)}
                    </span>
                    <span>
                      {t("labelRemaining")}: {formatFull(c.outstanding, c.currency)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function weekLeadTitles(weeks: Date[], lead: CurrencySeries | null, locale: string): string[] | undefined {
  if (!lead) return undefined
  return weeks.map((start, i) => {
    const end = new Date(start)
    end.setDate(end.getDate() + 6)
    const range = `${formatDate(start, locale, { day: "2-digit", month: "2-digit" })}–${formatDate(end, locale, { day: "2-digit", month: "2-digit" })}`
    return `${range}: ${formatBucket({ currency: lead.currency, value: lead.values[i], count: 0 })}`
  })
}

function MiniStat({ testId, value, label, note }: { testId: string; value: string; label: string; note?: string }) {
  return (
    <div data-testid={`invoices-analytics-${testId}`} className="text-center min-w-0">
      <p className="text-lg font-bold">{value}</p>
      <p className="text-[10px] text-muted-foreground">{label}</p>
      {note && <p className="text-[10px] leading-snug text-muted-foreground/80 break-words">{note}</p>}
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
