"use client"

/**
 * D4 Subscriptions — slice-2 UI.
 *
 * Subscription dashboard: status KPIs + MRR + trials ending soon +
 * past-due rows + by-plan breakdown. Billing operators see the health
 * of recurring revenue in one screen.
 */
import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { MotionPage, MotionCard } from "@/components/ui/motion"
import { HelpButton } from "@/components/help/help-button"
import {
  AlertCircle,
  AlertTriangle,
  Building2,
  CheckCircle2,
  Clock,
  CreditCard,
  Loader2,
  Pause,
  RefreshCw,
  XCircle,
} from "lucide-react"

interface CurrencyTotal {
  currency: string
  total: number
}

interface Plan {
  planId: string
  planName: string
  activeCount: number
  mrrByCurrency: CurrencyTotal[]
}

interface Sub {
  id: string
  planId: string
  planName: string
  companyName: string | null
  contactName: string | null
  status: string
  trialEndsAt: string | null
  currentPeriodStart: string
  currentPeriodEnd: string
  nextBillingAt: string | null
  cancelAtPeriodEnd: boolean
  currency: string
  unitAmount: number
  billingInterval: string
  billingIntervalCount: number
}

interface OverviewResponse {
  statusCounts: Record<string, number>
  mrrCurrencyTotals: CurrencyTotal[]
  dominantMrr: CurrencyTotal
  planList: Plan[]
  trialsEndingSoon: Sub[]
  pastDue: Sub[]
  trialWindowDays: number
  totalSubscriptions: number
  truncated: boolean
  fetchCap: number
}

function formatMoney(n: number, currency: string): string {
  if (!Number.isFinite(n) || n < 0) return "—"
  if (n >= 1_000_000) return `${currency} ${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${currency} ${(n / 1_000).toFixed(1)}K`
  return `${currency} ${n.toFixed(0)}`
}

const INTERVAL_KEYS: Record<string, string> = {
  day: "intervalDay",
  week: "intervalWeek",
  month: "intervalMonth",
  year: "intervalYear",
}

function formatBillingInterval(
  amount: number,
  currency: string,
  interval: string,
  count: number,
  t: (key: string, values?: Record<string, string | number>) => string,
): string {
  const key = INTERVAL_KEYS[interval] ?? "intervalMonth"
  const human = t(key, { count })
  return `${currency} ${amount.toFixed(0)} / ${human}`
}

function formatRelative(
  iso: string | null,
  tc: (key: string, values?: Record<string, string | number>) => string,
): string {
  if (!iso) return "—"
  const ms = new Date(iso).getTime() - Date.now()
  const days = Math.floor(ms / 86_400_000)
  if (days < 0) return tc("daysAgo", { days: Math.abs(days) })
  if (days === 0) return tc("today")
  if (days === 1) return tc("tomorrow")
  return tc("inDays", { days })
}

const STATUS_COLORS: Record<string, string> = {
  active: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  trial: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  past_due: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  paused: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  cancelled: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-500",
}

export default function SubscriptionsOverviewPage() {
  const t = useTranslations("slice2.subscriptionsOverview")
  const tc = useTranslations("slice2.common")
  const [data, setData] = useState<OverviewResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch("/api/v1/subscriptions-overview")
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
          setError(e instanceof Error ? e.message : tc("errorFetchFailed"))
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <MotionPage className="p-6">
      <div className="max-w-7xl mx-auto">
        <header className="mb-6">
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <RefreshCw className="w-8 h-8 text-primary" />
            {t("title")}
            <HelpButton slug="subscriptions" variant="label" />
          </h1>
          <p className="text-muted-foreground mt-2 max-w-2xl">
            {t("subtitle")}
          </p>
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

        {!loading && data && data.truncated && (
          <MotionCard className="mb-4 p-3 border border-amber-500 bg-amber-500/10 rounded-lg flex items-start gap-2 text-sm">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            {t("truncatedBanner", { count: data.fetchCap })}
          </MotionCard>
        )}

        {!loading && data && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
              <MotionCard className="p-3 border border-zinc-200 dark:border-zinc-700 rounded-lg">
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3 text-green-600" /> {t("kpiActive")}
                </p>
                <p className="text-2xl font-bold mt-0.5">
                  {data.statusCounts.active ?? 0}
                </p>
              </MotionCard>
              <MotionCard className="p-3 border border-zinc-200 dark:border-zinc-700 rounded-lg">
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <Clock className="w-3 h-3 text-blue-600" /> {t("kpiTrial")}
                </p>
                <p className="text-2xl font-bold mt-0.5">
                  {data.statusCounts.trial ?? 0}
                </p>
              </MotionCard>
              <MotionCard className="p-3 border border-zinc-200 dark:border-zinc-700 rounded-lg">
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3 text-red-600" /> {t("kpiPastDue")}
                </p>
                <p
                  className={`text-2xl font-bold mt-0.5 ${
                    (data.statusCounts.past_due ?? 0) > 0 ? "text-red-600" : ""
                  }`}
                >
                  {data.statusCounts.past_due ?? 0}
                </p>
              </MotionCard>
              <MotionCard className="p-3 border border-zinc-200 dark:border-zinc-700 rounded-lg">
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <Pause className="w-3 h-3 text-slate-500" /> {t("kpiPaused")}
                </p>
                <p className="text-2xl font-bold mt-0.5">
                  {data.statusCounts.paused ?? 0}
                </p>
              </MotionCard>
              <MotionCard className="p-3 border border-zinc-200 dark:border-zinc-700 rounded-lg">
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <XCircle className="w-3 h-3 text-muted-foreground" />{" "}
                  {t("kpiCancelled")}
                </p>
                <p className="text-2xl font-bold mt-0.5">
                  {data.statusCounts.cancelled ?? 0}
                </p>
              </MotionCard>
              <MotionCard className="p-3 border border-zinc-200 dark:border-zinc-700 rounded-lg">
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <CreditCard className="w-3 h-3" /> {t("kpiMrr")}
                </p>
                <p className="text-xl font-bold mt-0.5">
                  {formatMoney(data.dominantMrr.total, data.dominantMrr.currency)}
                </p>
                {data.mrrCurrencyTotals.length > 1 && (
                  <p
                    className="text-xs text-muted-foreground"
                    title={data.mrrCurrencyTotals
                      .map((ct) => `${ct.currency} ${Math.round(ct.total)}`)
                      .join(", ")}
                  >
                    {t("moreCurrencies", { count: data.mrrCurrencyTotals.length - 1 })}
                  </p>
                )}
              </MotionCard>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
              <section>
                <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
                  <Clock className="w-5 h-5 text-blue-600" />
                  {t("trialsEnding", { days: data.trialWindowDays })}
                </h2>
                {data.trialsEndingSoon.length === 0 ? (
                  <MotionCard className="p-8 text-center text-muted-foreground">
                    <CheckCircle2 className="w-8 h-8 mx-auto mb-2 text-green-600 opacity-70" />
                    <p className="text-sm">{t("noTrials")}</p>
                  </MotionCard>
                ) : (
                  <div className="space-y-2">
                    {data.trialsEndingSoon.slice(0, 10).map((s) => (
                      <MotionCard
                        key={s.id}
                        className="p-3 border border-blue-500/30 bg-blue-500/5 rounded-lg"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="font-medium truncate">
                              {s.companyName ?? s.contactName ?? t("unknownSubject")}
                            </p>
                            <p className="text-xs text-muted-foreground truncate">
                              {s.planName} · {formatBillingInterval(
                                s.unitAmount,
                                s.currency,
                                s.billingInterval,
                                s.billingIntervalCount,
                                t,
                              )}
                            </p>
                          </div>
                          <div className="text-right shrink-0">
                            <p className="text-sm font-semibold text-blue-700 dark:text-blue-300">
                              {formatRelative(s.trialEndsAt, tc)}
                            </p>
                          </div>
                        </div>
                      </MotionCard>
                    ))}
                    {data.trialsEndingSoon.length > 10 && (
                      <p className="text-xs text-muted-foreground text-center pt-1">
                        +{data.trialsEndingSoon.length - 10}
                      </p>
                    )}
                  </div>
                )}
              </section>

              <section>
                <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5 text-red-600" />
                  {t("pastDue")}
                </h2>
                {data.pastDue.length === 0 ? (
                  <MotionCard className="p-8 text-center text-muted-foreground">
                    <CheckCircle2 className="w-8 h-8 mx-auto mb-2 text-green-600 opacity-70" />
                    <p className="text-sm">{t("noPastDue")}</p>
                  </MotionCard>
                ) : (
                  <div className="space-y-2">
                    {data.pastDue.slice(0, 10).map((s) => (
                      <MotionCard
                        key={s.id}
                        className="p-3 border border-red-500/30 bg-red-500/5 rounded-lg"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="font-medium truncate">
                              {s.companyName ?? s.contactName ?? t("unknownSubject")}
                            </p>
                            <p className="text-xs text-muted-foreground truncate">
                              {s.planName} · {formatBillingInterval(
                                s.unitAmount,
                                s.currency,
                                s.billingInterval,
                                s.billingIntervalCount,
                                t,
                              )}
                            </p>
                          </div>
                          <div className="text-right shrink-0">
                            <p className="text-sm font-semibold text-red-700 dark:text-red-300">
                              {formatRelative(s.nextBillingAt, tc)}
                            </p>
                          </div>
                        </div>
                      </MotionCard>
                    ))}
                    {data.pastDue.length > 10 && (
                      <p className="text-xs text-muted-foreground text-center pt-1">
                        {t("andMore", { count: data.pastDue.length - 10 })}
                      </p>
                    )}
                  </div>
                )}
              </section>
            </div>

            <section>
              <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
                <Building2 className="w-5 h-5 text-muted-foreground" />
                {t("byPlan")}
              </h2>
              {data.planList.length === 0 ? (
                <MotionCard className="p-8 text-center text-muted-foreground">
                  <p className="text-sm">{t("noActivePlans")}</p>
                </MotionCard>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {data.planList.map((p) => (
                    <MotionCard key={p.planId} className="p-4 border border-zinc-200 dark:border-zinc-700 rounded-lg">
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <h3 className="font-semibold truncate">{p.planName}</h3>
                        <span
                          className={`px-2 py-0.5 rounded text-xs ${STATUS_COLORS.active}`}
                        >
                          {p.activeCount}
                        </span>
                      </div>
                      <div className="text-sm space-y-0.5">
                        {p.mrrByCurrency.map((m) => (
                          <p key={m.currency} className="font-mono">
                            {t("perMo", { amount: formatMoney(m.total, m.currency) })}
                          </p>
                        ))}
                      </div>
                    </MotionCard>
                  ))}
                </div>
              )}
            </section>
          </>
        )}

        <div className="mt-6 text-xs text-muted-foreground space-y-1">
          <p>{t("footerMrr")}</p>
          <p>{t("footerPastDue")}</p>
        </div>
      </div>
    </MotionPage>
  )
}
