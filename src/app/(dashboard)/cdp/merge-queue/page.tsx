"use client"

/**
 * G2 Identity Resolution — slice-2 UI.
 *
 * Pending profile-merge candidates with side-by-side comparison and the
 * fuzzy-match score breakdown. Operators see WHY the matcher proposed
 * a merge (email Levenshtein, phone-digit edit, name similarity) and
 * can sanity-check before slice-2-full wires the approve/reject mutations.
 */
import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { MotionPage, MotionCard } from "@/components/ui/motion"
import { HelpButton } from "@/components/help/help-button"
import { Button } from "@/components/ui/button"
import {
  AlertCircle,
  AlertTriangle,
  ArrowRightLeft,
  CheckCircle2,
  Loader2,
  Mail,
  Phone,
  User,
} from "lucide-react"

interface ProfileSide {
  id: string
  displayName: string | null
  displayEmail: string | null
  displayPhone: string | null
  emailNormalized: string | null
  phoneNormalized: string | null
  nameNormalized: string | null
  totalSpent: number
  lifetimeOrderCount: number
  firstSeenAt: string | null
  lastSeenAt: string | null
  channelsActive: string[]
}

interface Candidate {
  id: string
  score: number
  tier: "auto" | "manual" | "weak"
  reason: string | null
  breakdown: {
    email: number | null
    phone: number | null
    name: number | null
    emailWeight: number | null
    phoneWeight: number | null
    nameWeight: number | null
  }
  createdAt: string
  primary: ProfileSide | null
  secondary: ProfileSide | null
}

interface QueueResponse {
  items: Candidate[]
  totalPending: number
  statusCounts: Record<string, number>
  truncated: boolean
  fetchCap: number
  thresholds: { auto: number; manual: number }
}

function formatPct(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "—"
  return `${Math.round(n * 100)}%`
}

interface RelativeLabels {
  today: string
  daysAgo: (n: number) => string
  monthsAgo: (n: number) => string
}

function formatRelative(iso: string | null, labels: RelativeLabels): string {
  if (!iso) return "—"
  const ms = Date.now() - new Date(iso).getTime()
  const days = Math.floor(ms / 86_400_000)
  if (days < 1) return labels.today
  if (days < 30) return labels.daysAgo(days)
  return labels.monthsAgo(Math.floor(days / 30))
}

function ProfileCard({
  p,
  side,
  labels,
  rel,
}: {
  p: ProfileSide | null
  side: string
  labels: {
    spent: string
    orders: string
    missing: string
    noName: string
    channelTpl: (n: number) => string
  }
  rel: RelativeLabels
}) {
  if (!p) {
    return (
      <div className="p-3 border border-zinc-200 dark:border-zinc-700 rounded-lg text-xs text-muted-foreground">
        {labels.missing}
      </div>
    )
  }
  return (
    <div className="p-3 border border-zinc-200 dark:border-zinc-700 rounded-lg space-y-1.5">
      <div className="flex items-center justify-between gap-2 mb-1">
        <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium">
          {side}
        </p>
        <code className="text-xs text-muted-foreground">{p.id.slice(-8)}</code>
      </div>
      <p className="font-medium truncate">{p.displayName ?? labels.noName}</p>
      <div className="space-y-0.5 text-xs text-muted-foreground">
        {p.displayEmail && (
          <p className="flex items-center gap-1 truncate">
            <Mail className="w-3 h-3" />
            {p.displayEmail}
          </p>
        )}
        {p.displayPhone && (
          <p className="flex items-center gap-1">
            <Phone className="w-3 h-3" />
            {p.displayPhone}
          </p>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2 pt-2 text-xs">
        <div>
          <p className="text-muted-foreground">{labels.spent}</p>
          <p className="font-mono">
            {Number.isFinite(p.totalSpent) && p.totalSpent > 0
              ? `$${Math.round(p.totalSpent)}`
              : "—"}
          </p>
        </div>
        <div>
          <p className="text-muted-foreground">{labels.orders}</p>
          <p className="font-mono">{p.lifetimeOrderCount}</p>
        </div>
      </div>
      <div className="text-xs text-muted-foreground pt-1">
        {formatRelative(p.lastSeenAt, rel)} · {labels.channelTpl(p.channelsActive.length)}
      </div>
    </div>
  )
}

export default function IdentityMergeQueuePage() {
  const t = useTranslations("slice2.identityMergeQueue")
  const tc = useTranslations("slice2.common")
  const TIER_BADGES: Record<Candidate["tier"], { label: string; class: string }> = {
    auto: {
      label: t("tierAuto"),
      class:
        "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 border border-green-500",
    },
    manual: {
      label: t("tierManual"),
      class:
        "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200 border border-amber-500",
    },
    weak: {
      label: t("tierWeak"),
      class:
        "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border border-slate-400",
    },
  }
  const profileLabels = {
    spent: t("spent"),
    orders: t("orders"),
    missing: t("profileMissing"),
    noName: t("noName"),
    channelTpl: (n: number) => t("channels", { count: n }),
  }
  const relLabels: RelativeLabels = {
    today: t("relToday"),
    daysAgo: (n: number) => t("relDaysAgo", { days: n }),
    monthsAgo: (n: number) => t("relMonthsAgo", { months: n }),
  }
  const [data, setData] = useState<QueueResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [resolvingId, setResolvingId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch("/api/v1/identity-merge-queue")
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

  const resolve = async (id: string, action: "merge" | "reject") => {
    setResolvingId(id)
    setActionError(null)
    try {
      const res = await fetch(`/api/v1/identity-merge-queue/${id}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      // Both actions take the candidate out of the pending queue; reflect locally.
      const bucket = action === "merge" ? "manually_merged" : "rejected"
      setData((d) =>
        d
          ? {
              ...d,
              items: d.items.filter((c) => c.id !== id),
              totalPending: Math.max(0, d.totalPending - 1),
              statusCounts: { ...d.statusCounts, [bucket]: (d.statusCounts[bucket] ?? 0) + 1 },
            }
          : d,
      )
    } catch (e) {
      setActionError(e instanceof Error ? e.message : tc("errorFetchFailed"))
    } finally {
      setResolvingId(null)
    }
  }

  return (
    <MotionPage className="p-6">
      <div className="max-w-7xl mx-auto">
        <header className="mb-6">
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <ArrowRightLeft className="w-8 h-8 text-primary" />
            {t("title")}
            <HelpButton slug="cdp-merge-queue" variant="label" />
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

        {actionError && (
          <MotionCard className="mb-4 p-3 border border-destructive bg-destructive/10 rounded-lg flex items-start gap-2 text-sm">
            <AlertCircle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
            {t("resolveFailed")}: {actionError}
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
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
              <MotionCard className="p-3 border border-zinc-200 dark:border-zinc-700 rounded-lg">
                <p className="text-xs text-muted-foreground">{t("kpiPending")}</p>
                <p
                  className={`text-2xl font-bold mt-0.5 ${
                    data.totalPending > 0 ? "text-amber-600" : ""
                  }`}
                >
                  {data.totalPending}
                </p>
              </MotionCard>
              <MotionCard className="p-3 border border-zinc-200 dark:border-zinc-700 rounded-lg">
                <p className="text-xs text-muted-foreground">{t("kpiTotalFlagged")}</p>
                <p className="text-2xl font-bold mt-0.5">
                  {Object.values(data.statusCounts).reduce((a, b) => a + b, 0)}
                </p>
              </MotionCard>
              <MotionCard className="p-3 border border-zinc-200 dark:border-zinc-700 rounded-lg">
                <p className="text-xs text-muted-foreground">
                  {t("kpiManuallyMerged")}
                </p>
                <p className="text-2xl font-bold mt-0.5">
                  {data.statusCounts.manually_merged ?? 0}
                </p>
              </MotionCard>
              <MotionCard className="p-3 border border-zinc-200 dark:border-zinc-700 rounded-lg">
                <p className="text-xs text-muted-foreground">{t("kpiRejected")}</p>
                <p className="text-2xl font-bold mt-0.5">
                  {data.statusCounts.rejected ?? 0}
                </p>
              </MotionCard>
            </div>

            {data.items.length === 0 ? (
              <MotionCard className="p-12 text-center text-muted-foreground">
                <CheckCircle2 className="w-12 h-12 mx-auto mb-3 text-green-600 opacity-70" />
                <p className="font-medium">{t("emptyTitle")}</p>
                <p className="text-sm mt-1 max-w-md mx-auto">
                  {t("emptyDesc", {
                    auto: Math.round((data?.thresholds.auto ?? 0.95) * 100),
                    manual: Math.round((data?.thresholds.manual ?? 0.7) * 100),
                  })}
                </p>
              </MotionCard>
            ) : (
              <div className="space-y-4">
                {data.items.map((c) => {
                  const tier = TIER_BADGES[c.tier]
                  return (
                    <MotionCard key={c.id} className="p-4 border border-zinc-200 dark:border-zinc-700 rounded-lg">
                      <div className="flex items-start justify-between gap-2 mb-3 flex-wrap">
                        <div className="flex items-center gap-3">
                          <div className="text-3xl font-bold font-mono">
                            {formatPct(c.score)}
                          </div>
                          <div>
                            <span
                              className={`px-2 py-0.5 rounded text-xs ${tier.class}`}
                            >
                              {tier.label}
                            </span>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {t("flagged", { when: formatRelative(c.createdAt, relLabels) })}
                              {c.reason && ` · ${c.reason}`}
                            </p>
                          </div>
                        </div>
                        <div className="text-xs text-muted-foreground space-x-3">
                          <span>
                            {t("breakdownEmail")}{" "}
                            <strong>{formatPct(c.breakdown.email)}</strong>
                          </span>
                          <span>
                            {t("breakdownPhone")}{" "}
                            <strong>{formatPct(c.breakdown.phone)}</strong>
                          </span>
                          <span>
                            {t("breakdownName")}{" "}
                            <strong>{formatPct(c.breakdown.name)}</strong>
                          </span>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] gap-3 items-center">
                        <ProfileCard p={c.primary} side={t("primary")} labels={profileLabels} rel={relLabels} />
                        <ArrowRightLeft className="w-5 h-5 text-muted-foreground mx-auto rotate-90 md:rotate-0" />
                        <ProfileCard p={c.secondary} side={t("secondary")} labels={profileLabels} rel={relLabels} />
                      </div>

                      <div className="flex justify-end gap-2 mt-3">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={resolvingId === c.id}
                          onClick={() => resolve(c.id, "reject")}
                        >
                          {t("rejectAction")}
                        </Button>
                        <Button
                          size="sm"
                          disabled={resolvingId === c.id}
                          onClick={() => resolve(c.id, "merge")}
                        >
                          {resolvingId === c.id ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            t("mergeAction")
                          )}
                        </Button>
                      </div>
                    </MotionCard>
                  )
                })}
              </div>
            )}
          </>
        )}

        <div className="mt-6 text-xs text-muted-foreground space-y-1">
          {data && (
            <p>
              {t("footerThresholds", {
                auto: Math.round(data.thresholds.auto * 100),
                manual: Math.round(data.thresholds.manual * 100),
              })}
            </p>
          )}
          <p>{t("footerCron")}</p>
        </div>
      </div>
    </MotionPage>
  )
}
