"use client"

/**
 * C5 Account Engagement — slice-2 UI.
 *
 * MarketingAccount list with engagement score, grade, ICP tier, lifecycle
 * stage + 30d intent signal count. Stale-priority accounts (high-fit ICP,
 * low score, no recent signals) bubble to the top — these are best-fit
 * targets that have gone quiet and need re-engagement.
 */
import { useCallback, useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { MotionPage, MotionCard } from "@/components/ui/motion"
import { HelpButton } from "@/components/help/help-button"
import {
  AlertCircle,
  AlertTriangle,
  Activity,
  Building2,
  Loader2,
  Plus,
  Target,
  TrendingUp,
} from "lucide-react"
import { PromoteCompaniesDialog } from "@/components/account-engagement/promote-companies-dialog"
import { AccountDetailDrawer } from "@/components/account-engagement/account-detail-drawer"

interface Account {
  id: string
  accountName: string
  lifecycleStage: string
  icpTier: string
  engagementScore: number
  grade: string
  industrySlug: string | null
  employeeBand: string | null
  annualRevenueUsd: string | null
  lastSignalAt: string | null
  updatedAt: string
  recentSignals30d: number
  isStalePriority: boolean
}

interface EngagementResponse {
  accounts: Account[]
  totalAccounts: number
  stalePriorityCount: number
  stageCounts: Record<string, number>
  filterStage: string | null
}

const STAGE_KEYS = [
  "target",
  "engaged",
  "mql",
  "sql",
  "opportunity",
  "customer",
  "churned",
] as const

const GRADE_COLORS: Record<string, string> = {
  A: "bg-green-500 text-white",
  B: "bg-emerald-500 text-white",
  C: "bg-amber-500 text-white",
  D: "bg-orange-500 text-white",
  F: "bg-red-500 text-white",
  unassigned: "bg-muted text-muted-foreground",
}

const ICP_COLORS: Record<string, string> = {
  tier_1: "border-purple-500 text-purple-700 dark:text-purple-300",
  tier_2: "border-blue-500 text-blue-700 dark:text-blue-300",
  tier_3: "border-sky-500 text-sky-700 dark:text-sky-300",
  tier_4: "border-slate-400 text-slate-600 dark:text-slate-400",
  unscored: "border-zinc-200 dark:border-zinc-700 text-muted-foreground",
}

const STAGE_COLORS: Record<string, string> = {
  target: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  engaged: "bg-sky-100 text-sky-700 dark:bg-sky-900 dark:text-sky-300",
  mql: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
  sql: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900 dark:text-indigo-300",
  opportunity: "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300",
  customer: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
  churned: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
}

function formatRevenue(usd: string | null): string {
  if (!usd) return "—"
  const n = Number(usd)
  if (!Number.isFinite(n) || n <= 0) return "—"
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`
  return `$${n}`
}

function formatRelative(
  iso: string | null,
  t: (key: string, values?: Record<string, string | number>) => string,
): string {
  if (!iso) return "—"
  const ms = Date.now() - new Date(iso).getTime()
  const days = Math.floor(ms / 86_400_000)
  if (days < 1) return t("relToday")
  if (days === 1) return t("relDay", { count: 1 })
  if (days < 30) return t("relDays", { count: days })
  if (days < 365) return t("relMonths", { count: Math.floor(days / 30) })
  return t("relYears", { count: Math.floor(days / 365) })
}

export default function AccountEngagementPage() {
  const t = useTranslations("slice2.accountEngagement")
  const tc = useTranslations("slice2.common")
  const [data, setData] = useState<EngagementResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [stageFilter, setStageFilter] = useState<string | null>(null)
  const [promoteOpen, setPromoteOpen] = useState(false)
  const [selectedAccount, setSelectedAccount] = useState<Account | null>(null)

  const loadData = useCallback(async (stage: string | null) => {
    try {
      setLoading(true)
      const qs = stage ? `?stage=${stage}` : ""
      const res = await fetch(`/api/v1/account-engagement${qs}`)
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
    loadData(stageFilter)
  }, [stageFilter, loadData])

  return (
    <MotionPage className="p-6">
      <div className="max-w-7xl mx-auto">
        <header className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-2">
              <Target className="w-8 h-8 text-primary" />
              {t("title")}
              <HelpButton slug="account-engagement" variant="label" />
            </h1>
            <p className="text-muted-foreground mt-2 max-w-2xl">
              {t("subtitle")}
            </p>
          </div>
          <button
            onClick={() => setPromoteOpen(true)}
            className="shrink-0 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90"
          >
            <Plus className="w-4 h-4" />
            {t("promoteCta")}
          </button>
        </header>

        {error && (
          <MotionCard className="mb-4 p-4 border border-destructive bg-destructive/10 rounded-lg flex items-start gap-2">
            <AlertCircle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
            <p className="text-sm">{error}</p>
          </MotionCard>
        )}

        {!loading && data && (
          <div className="mb-4 flex gap-2 flex-wrap">
            <button
              onClick={() => setStageFilter(null)}
              className={`px-3 py-1.5 rounded-lg text-sm border ${
                stageFilter === null
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-card hover:bg-muted border-zinc-200 dark:border-zinc-700"
              }`}
            >
              {tc("all")} ({data.totalAccounts})
            </button>
            {STAGE_KEYS.map((key) => {
              const count = data.stageCounts[key] ?? 0
              return (
                <button
                  key={key}
                  onClick={() => setStageFilter(key)}
                  className={`px-3 py-1.5 rounded-lg text-sm border ${
                    stageFilter === key
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-card hover:bg-muted border-zinc-200 dark:border-zinc-700"
                  }`}
                >
                  {t(`stageLabels.${key}`)} ({count})
                </button>
              )
            })}
          </div>
        )}

        {loading && (
          <MotionCard className="p-12 text-center text-muted-foreground">
            <Loader2 className="w-6 h-6 animate-spin inline mr-2" />
            {tc("loading")}
          </MotionCard>
        )}

        {!loading && data && (
          <>
            {data.stalePriorityCount > 0 && (
              <MotionCard className="mb-6 p-4 border border-amber-500 bg-amber-500/10 rounded-lg flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold text-amber-900 dark:text-amber-200">
                    {t("stalePriorityTitle", { count: data.stalePriorityCount })}
                  </p>
                  <p className="text-sm text-amber-800 dark:text-amber-300">
                    {t("stalePriorityDesc")}
                  </p>
                </div>
              </MotionCard>
            )}

            {data.accounts.length === 0 ? (
              <MotionCard className="p-12 text-center text-muted-foreground">
                <Building2 className="w-12 h-12 mx-auto mb-3 opacity-50" />
                <p className="font-medium">{t("emptyTitle")}</p>
                <p className="text-sm mt-1">{t("emptyDesc")}</p>
                <button
                  onClick={() => setPromoteOpen(true)}
                  className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90"
                >
                  <Plus className="w-4 h-4" />
                  {t("promoteCta")}
                </button>
              </MotionCard>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {data.accounts.map((a) => (
                  <MotionCard
                    key={a.id}
                    className={`p-5 border border-zinc-200 dark:border-zinc-700 rounded-lg ${
                      a.isStalePriority
                        ? "border-amber-500 bg-amber-500/5"
                        : ""
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2 mb-3">
                      <div className="min-w-0">
                        <h3 className="text-lg font-semibold truncate">
                          {a.accountName}
                        </h3>
                        <div className="flex gap-1 mt-1 flex-wrap">
                          <span
                            className={`px-2 py-0.5 rounded text-xs ${
                              STAGE_COLORS[a.lifecycleStage] ?? STAGE_COLORS.target
                            }`}
                          >
                            {t(`stageLabels.${a.lifecycleStage}`)}
                          </span>
                          <span
                            title={t("detail.tierHint")}
                            className={`px-2 py-0.5 rounded text-xs border cursor-help ${
                              ICP_COLORS[a.icpTier] ?? ICP_COLORS.unscored
                            }`}
                          >
                            {t(`icpTierLabels.${a.icpTier}`)}
                          </span>
                        </div>
                      </div>
                      <span
                        className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-lg shrink-0 cursor-help ${
                          GRADE_COLORS[a.grade] ?? GRADE_COLORS.unassigned
                        }`}
                        title={
                          a.grade === "unassigned"
                            ? t("detail.unassignedHint")
                            : t("detail.gradeHint", { grade: a.grade })
                        }
                      >
                        {a.grade === "unassigned" ? "?" : a.grade}
                      </span>
                    </div>

                    <div className="mb-3">
                      <div className="flex justify-between items-baseline mb-1">
                        <span className="text-xs text-muted-foreground">
                          {t("engagement")}
                        </span>
                        <span className="font-mono text-lg font-bold">
                          {a.engagementScore}
                          <span className="text-xs text-muted-foreground">
                            /100
                          </span>
                        </span>
                      </div>
                      <div className="w-full h-2 bg-muted rounded overflow-hidden">
                        <div
                          className={`h-full ${
                            a.engagementScore >= 70
                              ? "bg-green-500"
                              : a.engagementScore >= 40
                                ? "bg-amber-500"
                                : "bg-slate-400"
                          }`}
                          style={{ width: `${a.engagementScore}%` }}
                        />
                      </div>
                    </div>

                    <div className="space-y-1.5 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground flex items-center gap-1">
                          <Activity className="w-3 h-3" />
                          {t("signals30d")}
                        </span>
                        <span className="font-mono">{a.recentSignals30d}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">
                          {t("lastSignal")}
                        </span>
                        <span>{formatRelative(a.lastSignalAt, t)}</span>
                      </div>
                      {a.annualRevenueUsd && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">{t("revenue")}</span>
                          <span className="font-mono">
                            {formatRevenue(a.annualRevenueUsd)}
                          </span>
                        </div>
                      )}
                      {a.employeeBand && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">{t("size")}</span>
                          <span>{a.employeeBand.replace("_", " ")}</span>
                        </div>
                      )}
                      {a.industrySlug && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">
                            {t("industry")}
                          </span>
                          <span className="truncate ml-2">
                            {a.industrySlug}
                          </span>
                        </div>
                      )}
                    </div>

                    {a.isStalePriority && (
                      <div className="mt-3 pt-3 border-t border-amber-500/30 text-xs flex items-center gap-1 text-amber-700 dark:text-amber-300">
                        <AlertTriangle className="w-3 h-3" />
                        {t("staleFooter")}
                      </div>
                    )}
                    {!a.isStalePriority && a.engagementScore >= 70 && (
                      <div className="mt-3 pt-3 border-t text-xs flex items-center gap-1 text-green-700 dark:text-green-300">
                        <TrendingUp className="w-3 h-3" />
                        {t("hotAccount")}
                      </div>
                    )}
                    <button
                      onClick={() => setSelectedAccount(a)}
                      className="mt-3 w-full text-left text-xs font-medium text-primary hover:underline"
                    >
                      {t("detail.openCta")} →
                    </button>
                  </MotionCard>
                ))}
              </div>
            )}
          </>
        )}

        <div className="mt-6 rounded-lg border border-zinc-200 dark:border-zinc-700 p-4 text-xs text-muted-foreground space-y-1.5">
          <p className="font-semibold text-foreground">{t("glossary.title")}</p>
          <p><span className="font-medium text-foreground">{t("glossary.gradeTerm")}</span> — {t("glossary.grade")}</p>
          <p><span className="font-medium text-foreground">{t("glossary.tierTerm")}</span> — {t("glossary.tier")}</p>
          <p><span className="font-medium text-foreground">{t("glossary.scoreTerm")}</span> — {t("glossary.score")}</p>
          <p><span className="font-medium text-foreground">{t("glossary.stagesTerm")}</span> — {t("glossary.stages")}</p>
        </div>

        <PromoteCompaniesDialog
          open={promoteOpen}
          onOpenChange={setPromoteOpen}
          onPromoted={() => loadData(stageFilter)}
        />

        <AccountDetailDrawer
          account={selectedAccount}
          onClose={() => setSelectedAccount(null)}
          onChanged={() => loadData(stageFilter)}
        />
      </div>
    </MotionPage>
  )
}
