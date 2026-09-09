"use client"

/**
 * D8 Loyalty — slice-2 UI.
 *
 * Loyalty program health overview: tier distribution, top accounts by
 * lifetime points, 30-day earn/redeem/expire totals, recent transaction
 * stream. Marketing-ops sees program engagement in one screen.
 */
import { useEffect, useState } from "react"
import Link from "next/link"
import { useTranslations, useLocale } from "next-intl"
import { MotionPage, MotionCard } from "@/components/ui/motion"
import { useAutoTour } from "@/components/tour/tour-provider"
import { TourReplayButton } from "@/components/tour/tour-replay-button"
import { HelpButton } from "@/components/help/help-button"
import { DidYouKnow } from "@/components/did-you-know"
import {
  Activity,
  AlertCircle,
  ArrowRight,
  Award,
  CheckCircle2,
  Crown,
  Loader2,
  Star,
  TrendingDown,
  TrendingUp,
  User,
} from "lucide-react"
import { buildLoyaltyInsights, type LoyaltyInsightsResult } from "@/lib/loyalty/ux"

interface TierBucket {
  tier: string
  accountCount: number
  totalPoints: number
  totalLifetimePoints: number
}

interface TopAccount {
  id: string
  contactId: string
  contactName: string | null
  contactEmail: string | null
  points: number
  lifetimePoints: number
  tier: string | null
  tierUpgradedAt: string | null
}

interface Txn {
  id: string
  loyaltyAccountId: string
  type: string
  delta: number
  createdAt: string
}

interface OverviewResponse {
  totalAccounts: number
  tierDistribution: TierBucket[]
  topAccounts: TopAccount[]
  thirtyDayTotals: {
    earn: number
    redeem: number
    expire: number
    adjustmentNet: number
    totalTransactions: number
  }
  recentTransactions: Txn[]
  txnsTruncated: boolean
  fetchCap: number
}

interface DashboardSetupState {
  earnRulesCount: number
  rewardsCount: number
  memberPortalEnabled: boolean
  autoEarnEnabled: boolean
}

const TIER_COLORS: Record<string, string> = {
  bronze: "bg-amber-700 text-white",
  silver: "bg-slate-400 text-white",
  gold: "bg-yellow-500 text-white",
  platinum: "bg-purple-500 text-white",
  diamond: "bg-cyan-500 text-white",
  unassigned: "bg-muted text-muted-foreground",
}

const TXN_TYPE_COLORS: Record<string, string> = {
  earn: "text-green-600",
  redeem: "text-blue-600",
  expire: "text-slate-500",
  adjustment_credit: "text-green-600",
  adjustment_debit: "text-red-600",
}

function tierColor(tier: string | null): string {
  return TIER_COLORS[tier ?? "unassigned"] ?? TIER_COLORS.unassigned
}

function formatPoints(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toLocaleString()
}

function formatRelative(iso: string | null, locale: string): string {
  if (!iso) return "—"
  const ms = Date.now() - new Date(iso).getTime()
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" })
  const mins = Math.round(ms / 60_000)
  if (Math.abs(mins) < 60) return rtf.format(-mins, "minute")
  const hours = Math.round(ms / 3_600_000)
  if (Math.abs(hours) < 24) return rtf.format(-hours, "hour")
  const days = Math.round(ms / 86_400_000)
  if (Math.abs(days) < 30) return rtf.format(-days, "day")
  return rtf.format(-Math.round(days / 30), "month")
}

export default function LoyaltyOverviewPage() {
  const t = useTranslations("slice2.loyaltyOverview")
  const locale = useLocale()
  const tc = useTranslations("slice2.common")
  const [data, setData] = useState<OverviewResponse | null>(null)
  const [setup, setSetup] = useState<DashboardSetupState | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  useAutoTour("loyalty")

  useEffect(() => {
    let cancelled = false
    Promise.all([
      fetch("/api/v1/loyalty-overview").then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return (await res.json()) as OverviewResponse
      }),
      fetch("/api/v1/loyalty-earn-rules").then((res) => res.json()).catch(() => ({ rules: [] })),
      fetch("/api/v1/loyalty-rewards").then((res) => res.json()).catch(() => ({ rewards: [] })),
      fetch("/api/v1/loyalty-settings").then((res) => res.json()).catch(() => ({})),
    ])
      .then(([overview, rules, rewards, settings]) => {
        if (!cancelled) {
          setData(overview)
          setSetup({
            earnRulesCount: (rules.rules ?? []).length,
            rewardsCount: (rewards.rewards ?? []).length,
            memberPortalEnabled: !!settings.memberPortalEnabled,
            autoEarnEnabled: !!settings.autoEarnEnabled,
          })
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
  }, [tc])

  const insights: LoyaltyInsightsResult | null =
    data && setup
      ? buildLoyaltyInsights({
          tiersCount: data.tierDistribution.length,
          earnRulesCount: setup.earnRulesCount,
          rewardsCount: setup.rewardsCount,
          settings: {
            memberPortalEnabled: setup.memberPortalEnabled,
            autoEarnEnabled: setup.autoEarnEnabled,
          },
          overview: data,
        })
      : null

  return (
    <MotionPage className="p-6">
      <div className="max-w-7xl mx-auto">
        <header className="mb-6 flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-2">
              <Award className="w-8 h-8 text-primary" />
              {t("title")}
            </h1>
            <p className="text-muted-foreground mt-2 max-w-2xl">
              {t("subtitle")}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <TourReplayButton tourId="loyalty" />
            <HelpButton slug="loyalty-dashboard" variant="label" />
          </div>
        </header>

        <DidYouKnow page="loyalty" className="mb-4" />

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
            <div
              data-tour-id="loyalty-kpis"
              className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6"
            >
              <MotionCard className="p-3 border border-zinc-200 dark:border-zinc-700 rounded-lg">
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <User className="w-3 h-3" /> {t("kpiMembers")}
                </p>
                <p className="text-2xl font-bold mt-0.5">
                  {data.totalAccounts.toLocaleString()}
                </p>
              </MotionCard>
              <MotionCard className="p-3 border border-zinc-200 dark:border-zinc-700 rounded-lg">
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <TrendingUp className="w-3 h-3 text-green-600" /> {t("kpiEarned30d")}
                </p>
                <p className="text-2xl font-bold mt-0.5 text-green-600">
                  +{formatPoints(data.thirtyDayTotals.earn)}
                </p>
              </MotionCard>
              <MotionCard className="p-3 border border-zinc-200 dark:border-zinc-700 rounded-lg">
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <TrendingDown className="w-3 h-3 text-blue-600" /> {t("kpiRedeemed30d")}
                </p>
                <p className="text-2xl font-bold mt-0.5 text-blue-600">
                  −{formatPoints(data.thirtyDayTotals.redeem)}
                </p>
              </MotionCard>
              <MotionCard className="p-3 border border-zinc-200 dark:border-zinc-700 rounded-lg">
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <Activity className="w-3 h-3" /> {t("kpiExpired30d")}
                </p>
                <p className="text-2xl font-bold mt-0.5 text-slate-500">
                  −{formatPoints(data.thirtyDayTotals.expire)}
                </p>
              </MotionCard>
              <MotionCard className="p-3 border border-zinc-200 dark:border-zinc-700 rounded-lg">
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <Activity className="w-3 h-3" /> {t("kpiTransactions")}
                </p>
                <p className="text-2xl font-bold mt-0.5">
                  {data.thirtyDayTotals.totalTransactions.toLocaleString()}
                </p>
              </MotionCard>
            </div>

            {insights && (
              <MotionCard className="mb-6 rounded-lg border border-zinc-200 p-4 dark:border-zinc-700" data-tour-id="loyalty-next-actions">
                <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="flex items-center gap-2 text-lg font-semibold">
                      <CheckCircle2 className="h-5 w-5 text-primary" />
                      {t("nextActionsTitle")}
                    </h2>
                    <p className="mt-1 text-sm text-muted-foreground">{t("nextActionsDesc")}</p>
                  </div>
                  <div className="min-w-28 rounded-lg border bg-muted px-3 py-2 text-right">
                    <p className="text-xs text-muted-foreground">{t("healthScore")}</p>
                    <p className="text-2xl font-bold">{insights.health.total}%</p>
                  </div>
                </div>
                <div className="mb-4 grid grid-cols-2 gap-2 md:grid-cols-4">
                  {(["setup", "activity", "redemption", "memberGrowth"] as const).map((key) => (
                    <div key={key} className="rounded-md bg-muted/70 px-3 py-2">
                      <p className="text-xs text-muted-foreground">{t(`health.${key}`)}</p>
                      <p className="mt-0.5 font-mono text-sm font-semibold">{insights.health[key]}%</p>
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                  {insights.insights.map((item) => (
                    <Link
                      key={item.id}
                      href={item.ctaHref}
                      className="group rounded-lg border px-3 py-3 transition hover:border-primary/40 hover:bg-muted"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold">{t(`insights.${item.id}.title`)}</p>
                          <p className="mt-1 text-xs leading-5 text-muted-foreground">{t(`insights.${item.id}.body`)}</p>
                        </div>
                        <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-foreground" />
                      </div>
                      <p className="mt-2 text-xs font-medium text-primary">{t(`insights.${item.id}.cta`)}</p>
                    </Link>
                  ))}
                </div>
              </MotionCard>
            )}

            {data.totalAccounts === 0 ? (
              <MotionCard className="p-12 text-center text-muted-foreground">
                <Award className="w-12 h-12 mx-auto mb-3 opacity-50" />
                <p className="font-medium">{t("emptyTitle")}</p>
                <p className="text-sm mt-1">{t("emptyDesc")}</p>
                <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
                  <Link
                    href="/loyalty/builder"
                    className="inline-flex items-center justify-center rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
                  >
                    {t("emptyBuilderCta")}
                  </Link>
                  <Link
                    href="/loyalty/pos"
                    className="inline-flex items-center justify-center rounded-md border border-zinc-200 px-3 py-2 text-sm font-medium text-foreground hover:bg-muted dark:border-zinc-700"
                  >
                    {t("emptyPosCta")}
                  </Link>
                </div>
              </MotionCard>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <section data-tour-id="loyalty-tiers">
                  <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
                    <Crown className="w-5 h-5 text-muted-foreground" />
                    {t("tierDistribution")}
                  </h2>
                  <div className="space-y-2">
                    {data.tierDistribution.map((tier) => {
                      const pct =
                        data.totalAccounts > 0
                          ? (tier.accountCount / data.totalAccounts) * 100
                          : 0
                      return (
                        <MotionCard
                          key={tier.tier}
                          className="p-3 border border-zinc-200 dark:border-zinc-700 rounded-lg"
                        >
                          <div className="flex items-center justify-between gap-3 mb-1.5">
                            <div className="flex items-center gap-2 min-w-0">
                              <span
                                className={`px-2 py-0.5 rounded text-xs font-medium ${tierColor(tier.tier)}`}
                              >
                                {t.has(`tierLabels.${tier.tier}`)
                                  ? t(`tierLabels.${tier.tier}`)
                                  : tier.tier}
                              </span>
                              <span className="text-sm font-mono shrink-0">
                                {tier.accountCount.toLocaleString()}
                              </span>
                              <span className="text-xs text-muted-foreground">
                                {pct.toFixed(0)}%
                              </span>
                            </div>
                            <span className="text-xs text-muted-foreground">
                              {t("lifetime", { points: formatPoints(tier.totalLifetimePoints) })}
                            </span>
                          </div>
                          <div className="w-full h-1.5 bg-muted rounded overflow-hidden">
                            <div
                              className={`h-full ${tierColor(tier.tier)}`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </MotionCard>
                      )
                    })}
                  </div>
                </section>

                <section data-tour-id="loyalty-top-members">
                  <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
                    <Star className="w-5 h-5 text-muted-foreground" />
                    {t("topMembers")}
                  </h2>
                  {data.topAccounts.length === 0 ? (
                    <MotionCard className="p-6 text-center text-muted-foreground text-sm">
                      {t("noEarners")}
                    </MotionCard>
                  ) : (
                    <div className="space-y-2">
                      {data.topAccounts.map((a, idx) => (
                        <Link
                          key={a.id}
                          href={`/loyalty/accounts/${a.id}`}
                          className="block"
                        >
                          <MotionCard className="p-3 border border-zinc-200 dark:border-zinc-700 rounded-lg hover:border-primary hover:bg-muted/40 transition-colors">
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-3 min-w-0">
                                <span className="text-muted-foreground font-mono text-xs w-6 text-right">
                                  #{idx + 1}
                                </span>
                                <div className="min-w-0">
                                  <p className="font-medium truncate">
                                    {a.contactName ??
                                      a.contactEmail ??
                                      t("unknownMember")}
                                  </p>
                                  {a.tier && (
                                    <span
                                      className={`inline-block px-1.5 py-0 rounded text-xs ${tierColor(a.tier)}`}
                                    >
                                      {t.has(`tierLabels.${a.tier}`)
                                        ? t(`tierLabels.${a.tier}`)
                                        : a.tier}
                                    </span>
                                  )}
                                </div>
                              </div>
                              <div className="text-right shrink-0">
                                <p className="font-mono text-sm font-semibold">
                                  {formatPoints(a.lifetimePoints)}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  {t("available", { points: formatPoints(a.points) })}
                                </p>
                              </div>
                            </div>
                          </MotionCard>
                        </Link>
                      ))}
                    </div>
                  )}
                </section>
              </div>
            )}

            {data.recentTransactions.length > 0 && (
              <section data-tour-id="loyalty-recent-tx" className="mt-6">
                <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
                  <Activity className="w-5 h-5 text-muted-foreground" />
                  {t("recentTransactions")}
                </h2>
                <MotionCard className="p-2 border border-zinc-200 dark:border-zinc-700 rounded-lg divide-y">
                  {data.recentTransactions.map((tx) => (
                    <div
                      key={tx.id}
                      className="px-2 py-1.5 text-sm flex items-center justify-between gap-2"
                    >
                      <span
                        className={`font-medium ${TXN_TYPE_COLORS[tx.type] ?? ""}`}
                      >
                        {t.has(`txnTypeLabels.${tx.type}`)
                          ? t(`txnTypeLabels.${tx.type}`)
                          : tx.type.replace("_", " ")}
                      </span>
                      <span className="font-mono text-xs text-muted-foreground shrink-0 truncate">
                        {tx.loyaltyAccountId.slice(-8)}
                      </span>
                      <span
                        className={`font-mono font-semibold ml-auto shrink-0 ${
                          tx.delta > 0
                            ? "text-green-600"
                            : tx.delta < 0
                              ? "text-red-600"
                              : ""
                        }`}
                      >
                        {tx.delta > 0 ? "+" : ""}
                        {tx.delta.toLocaleString()}
                      </span>
                      <span className="text-xs text-muted-foreground shrink-0 w-14 text-right">
                        {formatRelative(tx.createdAt, locale)}
                      </span>
                    </div>
                  ))}
                </MotionCard>
                {data.txnsTruncated && (
                  <p className="text-xs text-muted-foreground mt-2">
                    {t("truncatedTxns", { cap: data.fetchCap })}
                  </p>
                )}
              </section>
            )}
          </>
        )}

        <div className="mt-6 text-xs text-muted-foreground space-y-1">
          <p>{t("footerPoints")}</p>
          <p>{t("footerTotals")}</p>
        </div>
      </div>
    </MotionPage>
  )
}
