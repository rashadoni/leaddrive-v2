"use client"

/**
 * D8 Loyalty — per-account detail page.
 *
 * Drill-down from /loyalty/dashboard top-10 list. Shows account
 * header (member name, tier, points, lifetime points), full 100-row
 * transaction history, and two admin actions: manual earn + manual
 * redeem. Concurrency-safe via the CAS pattern in the POST endpoints.
 */
import { use, useCallback, useEffect, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { MotionPage, MotionCard } from "@/components/ui/motion"
import {
  AlertCircle,
  ArrowLeft,
  Award,
  Loader2,
  Mail,
  Minus,
  Phone,
  Plus,
  TrendingUp,
} from "lucide-react"
import Link from "next/link"
import { HelpButton } from "@/components/help/help-button"

interface Account {
  id: string
  contactId: string
  contactName: string | null
  contactEmail: string | null
  contactPhone: string | null
  points: number
  lifetimePoints: number
  tier: string | null
  tierUpgradedAt: string | null
  createdAt: string
  updatedAt: string
}

interface Txn {
  id: string
  type: string
  delta: number
  lifetimeDelta: number
  reason: string | null
  createdAt: string
}

interface DetailResponse {
  account: Account
  transactions: Txn[]
  hasMoreTransactions: boolean
  transactionsTruncated: boolean
  txLimit: number
}

const TIER_COLORS: Record<string, string> = {
  bronze: "bg-amber-700 text-white",
  silver: "bg-slate-400 text-white",
  gold: "bg-yellow-500 text-white",
  platinum: "bg-purple-500 text-white",
  diamond: "bg-cyan-500 text-white",
}

const TXN_TYPE_COLORS: Record<string, string> = {
  earn: "text-green-600",
  redeem: "text-blue-600",
  expire: "text-slate-500",
  adjustment_credit: "text-green-600",
  adjustment_debit: "text-red-600",
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

// Threshold above which an earn/redeem op requires explicit
// confirmation. Stops accidental fat-finger "redeem 10000" from
// silently destroying a member's balance — CAS protects against
// race but not human error.
const LARGE_OP_THRESHOLD = 1000

function ActionForm({
  mode,
  accountId,
  onSuccess,
  available,
  t,
}: {
  mode: "earn" | "redeem"
  accountId: string
  onSuccess: () => void
  available: number
  t: ReturnType<typeof useTranslations<"slice2.loyaltyAccountDetail">>
}) {
  const [points, setPoints] = useState("")
  const [reason, setReason] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  // When set, we're showing the confirm card for a large operation
  // and waiting for the user to click "Confirm" or "Cancel".
  const [pendingConfirm, setPendingConfirm] = useState<{
    n: number
    reason: string
  } | null>(null)

  const performSubmit = async (n: number, reasonStr: string) => {
    setSubmitting(true)
    try {
      const res = await fetch(
        `/api/v1/loyalty-accounts/${accountId}/${mode}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ points: n, reason: reasonStr || undefined }),
        },
      )
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || `HTTP ${res.status}`)
      }
      setPoints("")
      setReason("")
      setPendingConfirm(null)
      onSuccess()
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed")
    } finally {
      setSubmitting(false)
    }
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErr(null)
    const n = parseInt(points, 10)
    if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) {
      setErr(t("enterPositive"))
      return
    }
    if (mode === "redeem" && n > available) {
      setErr(t("cannotRedeem", { n, available }))
      return
    }
    // Large operation → show confirmation card, await explicit confirm.
    if (n >= LARGE_OP_THRESHOLD) {
      setPendingConfirm({ n, reason })
      return
    }
    await performSubmit(n, reason)
  }

  const accent = mode === "earn" ? "text-green-600" : "text-blue-600"
  const btnAccent =
    mode === "earn"
      ? "bg-green-600 hover:bg-green-700 text-white"
      : "bg-blue-600 hover:bg-blue-700 text-white"

  // Confirmation card replaces the form while pending.
  if (pendingConfirm) {
    const modeLabel = mode === "earn" ? t("credit") : t("redeem")
    return (
      <div className="space-y-2">
        <p className={`text-sm font-medium ${accent}`}>
          {t("confirmLargeTitle")}
        </p>
        <p className="text-sm text-muted-foreground">
          {t("confirmLargeDesc", { mode: modeLabel.toLowerCase(), n: pendingConfirm.n })}
        </p>
        {pendingConfirm.reason && (
          <p className="text-xs text-muted-foreground">
            {pendingConfirm.reason}
          </p>
        )}
        {err && (
          <p className="text-xs text-red-600 flex items-start gap-1">
            <AlertCircle className="w-3 h-3 mt-0.5 shrink-0" />
            {err}
          </p>
        )}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => {
              setPendingConfirm(null)
              setErr(null)
            }}
            disabled={submitting}
            className="flex-1 py-1.5 rounded text-sm font-medium border hover:bg-muted disabled:opacity-50"
          >
            {t("confirmCancel")}
          </button>
          <button
            type="button"
            onClick={() =>
              performSubmit(pendingConfirm.n, pendingConfirm.reason)
            }
            disabled={submitting}
            className={`flex-1 py-1.5 rounded text-sm font-medium ${btnAccent} disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1`}
          >
            {submitting && <Loader2 className="w-3 h-3 animate-spin" />}
            {t("confirmYes")}
          </button>
        </div>
      </div>
    )
  }

  return (
    <form onSubmit={submit} className="space-y-2">
      <p className={`text-sm font-medium flex items-center gap-1 ${accent}`}>
        {mode === "earn" ? (
          <>
            <Plus className="w-4 h-4" /> {t("creditPoints")}
          </>
        ) : (
          <>
            <Minus className="w-4 h-4" /> {t("redeemPoints")}
          </>
        )}
      </p>
      <input
        type="number"
        min={1}
        step={1}
        value={points}
        onChange={(e) => setPoints(e.target.value)}
        placeholder={t("pointsPlaceholder")}
        required
        className="w-full px-3 py-1.5 rounded border border-zinc-200 dark:border-zinc-700 bg-background text-sm font-mono"
      />
      <input
        type="text"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder={t("reasonPlaceholder")}
        maxLength={500}
        className="w-full px-3 py-1.5 rounded border border-zinc-200 dark:border-zinc-700 bg-background text-sm"
      />
      {err && (
        <p className="text-xs text-red-600 flex items-start gap-1">
          <AlertCircle className="w-3 h-3 mt-0.5 shrink-0" />
          {err}
        </p>
      )}
      <button
        type="submit"
        disabled={submitting}
        className={`w-full py-1.5 rounded text-sm font-medium ${btnAccent} disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1`}
      >
        {submitting && <Loader2 className="w-3 h-3 animate-spin" />}
        {mode === "earn" ? t("credit") : t("redeem")}
      </button>
    </form>
  )
}

export default function LoyaltyAccountDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = use(params)
  const t = useTranslations("slice2.loyaltyAccountDetail")
  const to = useTranslations("slice2.loyaltyOverview")
  const locale = useLocale()
  const tc = useTranslations("slice2.common")
  const [data, setData] = useState<DetailResponse | null>(null)
  // Older transaction pages appended via "Load more" — kept separate
  // from the initial `data.transactions` so a `load()` refresh after
  // earn/redeem only replaces the most recent page, not the whole tail.
  const [olderTxns, setOlderTxns] = useState<Txn[]>([])
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMoreLoaded, setHasMoreLoaded] = useState(true)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/v1/loyalty-accounts/${id}`)
      if (!res.ok) {
        if (res.status === 404) throw new Error(t("accountNotFound"))
        throw new Error(`HTTP ${res.status}`)
      }
      const json = (await res.json()) as DetailResponse
      setData(json)
      // Reset pagination state on a fresh load (e.g. after earn/redeem).
      setOlderTxns([])
      setHasMoreLoaded(json.hasMoreTransactions)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : tc("errorFetchFailed"))
    } finally {
      setLoading(false)
    }
  }, [id, t, tc])

  const loadMore = async () => {
    if (!data) return
    const allTxns = [...data.transactions, ...olderTxns]
    const oldestTxn = allTxns[allTxns.length - 1]
    if (!oldestTxn) return
    setLoadingMore(true)
    try {
      const res = await fetch(
        `/api/v1/loyalty-accounts/${id}?txBefore=${encodeURIComponent(oldestTxn.createdAt)}`,
      )
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = (await res.json()) as DetailResponse
      setOlderTxns((prev) => [...prev, ...json.transactions])
      setHasMoreLoaded(json.hasMoreTransactions)
    } catch (e) {
      setError(e instanceof Error ? e.message : tc("errorFetchFailed"))
    } finally {
      setLoadingMore(false)
    }
  }

  useEffect(() => {
    load()
  }, [load])

  return (
    <MotionPage className="p-6">
      <div className="max-w-5xl mx-auto">
        <div className="mb-4">
          <Link
            href="/loyalty/dashboard"
            className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
          >
            <ArrowLeft className="w-4 h-4" />
            {t("backLink")}
          </Link>
        </div>

        {error && (
          <MotionCard className="mb-4 p-4 border border-destructive bg-destructive/10 rounded-lg flex items-start gap-2">
            <AlertCircle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
            <p className="text-sm">{error}</p>
          </MotionCard>
        )}

        {loading && !data && (
          <MotionCard className="p-12 text-center text-muted-foreground">
            <Loader2 className="w-6 h-6 animate-spin inline mr-2" />
            {tc("loading")}
          </MotionCard>
        )}

        {data && (
          <>
            {/*
              Tier names come from the overview dictionary so account detail
              stays aligned with dashboard and member list labels.
            */}
            <MotionCard className="p-5 border border-zinc-200 dark:border-zinc-700 rounded-lg mb-4">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <h1 className="text-2xl font-bold flex items-center gap-2">
                    <Award className="w-6 h-6 text-primary" />
                    {data.account.contactName ?? t("unknownMember")}
                    <HelpButton slug="loyalty-account-detail" variant="label" />
                  </h1>
                  <div className="text-sm text-muted-foreground space-x-3 mt-1 flex flex-wrap gap-x-3">
                    {data.account.contactEmail && (
                      <span className="inline-flex items-center gap-1">
                        <Mail className="w-3 h-3" />
                        {data.account.contactEmail}
                      </span>
                    )}
                    {data.account.contactPhone && (
                      <span className="inline-flex items-center gap-1">
                        <Phone className="w-3 h-3" />
                        {data.account.contactPhone}
                      </span>
                    )}
                  </div>
                </div>
                {data.account.tier && (
                  <span
                    className={`px-3 py-1 rounded text-sm font-medium ${
                      TIER_COLORS[data.account.tier] ?? "bg-muted"
                    }`}
                  >
                    {to.has(`tierLabels.${data.account.tier}`)
                      ? to(`tierLabels.${data.account.tier}`)
                      : data.account.tier}
                  </span>
                )}
              </div>
              <div className="grid grid-cols-2 gap-4 mt-4 pt-4 border-t">
                <div>
                  <p className="text-xs text-muted-foreground">
                    {t("available")}
                  </p>
                  <p className="text-3xl font-bold font-mono mt-0.5">
                    {data.account.points.toLocaleString()}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <TrendingUp className="w-3 h-3" />
                    {t("lifetime")}
                  </p>
                  <p className="text-3xl font-bold font-mono mt-0.5">
                    {data.account.lifetimePoints.toLocaleString()}
                  </p>
                  {data.account.tierUpgradedAt && (
                    <p className="text-xs text-muted-foreground">
                      {t("tierUpgraded", { when: formatRelative(data.account.tierUpgradedAt, locale) })}
                    </p>
                  )}
                </div>
              </div>
            </MotionCard>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <MotionCard className="p-4 border border-zinc-200 dark:border-zinc-700 rounded-lg">
                <ActionForm
                  mode="earn"
                  accountId={data.account.id}
                  available={data.account.points}
                  onSuccess={load}
                  t={t}
                />
              </MotionCard>
              <MotionCard className="p-4 border border-zinc-200 dark:border-zinc-700 rounded-lg">
                <ActionForm
                  mode="redeem"
                  accountId={data.account.id}
                  available={data.account.points}
                  onSuccess={load}
                  t={t}
                />
              </MotionCard>
            </div>

            <MotionCard className="p-4 border border-zinc-200 dark:border-zinc-700 rounded-lg">
              <h2 className="text-lg font-semibold mb-3">
                {t("transactionHistory")}
              </h2>
              {data.transactions.length === 0 && olderTxns.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">
                  {t("noTransactions")}
                </p>
              ) : (
                <>
                  <div className="divide-y">
                    {[...data.transactions, ...olderTxns].map((tx) => (
                      <div
                        key={tx.id}
                        className="py-2 grid grid-cols-[100px_1fr_auto_auto] gap-3 items-center text-sm"
                      >
                        <span
                          className={`font-medium ${TXN_TYPE_COLORS[tx.type] ?? ""}`}
                        >
                          {t.has(`txnTypeLabels.${tx.type}`) ? t(`txnTypeLabels.${tx.type}`) : tx.type.replace("_", " ")}
                        </span>
                        <span className="text-muted-foreground text-xs truncate">
                          {tx.reason || "—"}
                        </span>
                        <span
                          className={`font-mono font-semibold ${
                            tx.delta > 0
                              ? "text-green-600"
                              : tx.delta < 0
                                ? "text-red-600"
                                : ""
                          }`}
                        >
                          {tx.delta > 0 ? "+" : ""}
                          {tx.delta.toLocaleString()}
                          {tx.lifetimeDelta > 0 && (
                            <span className="text-xs text-muted-foreground ml-1">
                              {t("lifetimeDelta", { n: tx.lifetimeDelta })}
                            </span>
                          )}
                        </span>
                        <span className="text-xs text-muted-foreground shrink-0">
                          {formatRelative(tx.createdAt, locale)}
                        </span>
                      </div>
                    ))}
                  </div>
                  {hasMoreLoaded && (
                    <div className="pt-3 border-t mt-2 flex justify-center">
                      <button
                        type="button"
                        onClick={loadMore}
                        disabled={loadingMore}
                        className="px-4 py-1.5 rounded text-sm border hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                      >
                        {loadingMore && (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        )}
                        {t("loadMore")}
                      </button>
                    </div>
                  )}
                </>
              )}
            </MotionCard>
          </>
        )}
      </div>
    </MotionPage>
  )
}
