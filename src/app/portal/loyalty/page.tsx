"use client"

/**
 * D8 Loyalty — member-facing portal page (Slice 3 step 2).
 *
 * A tenant's customer sees their own points / tier / progress / benefits /
 * eligible promo codes / recent history. Consumes GET /api/v1/public/portal-loyalty
 * (portal-JWT scoped, contactId from the token). Inherits the portal shell
 * (header/auth/branding) from src/app/portal/layout.tsx.
 */
import { useCallback, useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { Card, CardContent } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { Award, Gift, Sparkles, Copy, Check, Loader2 } from "lucide-react"
import { tierColor } from "@/lib/loyalty/tier-colors"

interface HistoryRow {
  type: string
  delta: number
  lifetimeDelta: number
  reason: string | null
  createdAt: string
}
interface PromoRow {
  code: string
  description: string | null
  discountType: "percentage" | "fixed"
  discountValue: number
  currency: string | null
  minOrderAmount: number | null
  validUntil: string | null
}
interface RewardRow {
  id: string
  name: string
  description: string | null
  pointsCost: number
  affordable: boolean
  soldOut: boolean
}
interface LoyaltyData {
  account: { points: number; lifetimePoints: number; tier: string | null; tierName: string | null }
  card: { memberName: string | null; memberNumber: string; qrDataUrl: string | null }
  tier: {
    current: { code: string; name: string; benefits: unknown; multiplier: number } | null
    next: { code: string; name: string; minLifetimePoints: number } | null
    pointsToNext: number | null
    progressPct: number
  }
  benefits: unknown
  history: HistoryRow[]
  promoCodes: PromoRow[]
  rewards: RewardRow[]
}

/** Benefits JSON is free-form — coerce to a string[] for display. */
function benefitList(b: unknown): string[] {
  if (Array.isArray(b)) return b.map(String).filter(Boolean)
  if (b && typeof b === "object") return Object.keys(b as Record<string, unknown>)
  return []
}

export default function PortalLoyaltyPage() {
  const t = useTranslations("portal.loyalty")

  const [data, setData] = useState<LoyaltyData | null>(null)
  const [enabled, setEnabled] = useState(true)
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState<string | null>(null)
  const [redeeming, setRedeeming] = useState<string | null>(null)
  const [redeemMsg, setRedeemMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const load = useCallback(async () => {
    try {
      const j = await fetch("/api/v1/public/portal-loyalty").then((r) => r.json())
      setEnabled(j.enabled !== false)
      setData(j.data ?? null)
    } catch {
      setEnabled(false)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function redeem(reward: RewardRow) {
    if (redeeming || !reward.affordable || reward.soldOut) return
    if (!confirm(t("confirmRedeem", { name: reward.name, points: reward.pointsCost.toLocaleString() }))) return
    setRedeeming(reward.id)
    setRedeemMsg(null)
    try {
      const r = await fetch("/api/v1/public/portal-redeem", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rewardId: reward.id }),
      })
      const j = await r.json().catch(() => ({}))
      if (r.ok && j.success) {
        setRedeemMsg({ ok: true, text: t("redeemOk", { name: reward.name }) })
        await load()
      } else {
        const text =
          j.error === "insufficient_points"
            ? t("redeemInsufficient")
            : j.error === "out_of_stock"
              ? t("redeemSoldOut")
              : t("redeemFailed")
        setRedeemMsg({ ok: false, text })
      }
    } catch {
      setRedeemMsg({ ok: false, text: t("redeemFailed") })
    } finally {
      setRedeeming(null)
    }
  }

  async function copy(code: string) {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(code)
      setTimeout(() => setCopied((c) => (c === code ? null : c)), 1500)
    } catch {
      /* clipboard blocked — no-op */
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-20 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" /> {t("loading")}
      </div>
    )
  }
  if (!enabled || !data) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">
          <Award className="mx-auto mb-3 h-10 w-10 opacity-40" />
          <p>{t("notAvailable")}</p>
        </CardContent>
      </Card>
    )
  }

  const { account, tier, history, promoCodes } = data
  const benefits = benefitList(data.benefits)

  return (
    <div className="space-y-5">
      <h1 className="flex items-center gap-2 text-2xl font-bold">
        <Sparkles className="h-6 w-6 text-primary" />
        {t("title")}
      </h1>

      {/* ── digital membership card (brand-tinted via the primary CSS var) ── */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-primary to-primary/70 p-5 text-white shadow-lg">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-widest text-white/70">{t("card.program")}</p>
            <p className="mt-1 truncate text-lg font-bold">{data.card.memberName ?? t("card.member")}</p>
            {account.tierName && (
              <span className="mt-2 inline-block rounded-full bg-white/20 px-2.5 py-0.5 text-xs font-semibold backdrop-blur">
                {account.tierName}
              </span>
            )}
          </div>
          {data.card.qrDataUrl && (
            <div className="shrink-0 rounded-lg bg-white p-1.5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={data.card.qrDataUrl}
                alt={t("card.qrAlt")}
                width={80}
                height={80}
                className="h-20 w-20"
              />
            </div>
          )}
        </div>
        <div className="mt-6 flex items-end justify-between gap-4">
          <div>
            <p className="text-[10px] uppercase tracking-widest text-white/60">{t("card.number")}</p>
            <p className="font-mono text-sm tracking-wider">{data.card.memberNumber}</p>
          </div>
          <div className="text-right">
            <p className="text-[10px] uppercase tracking-widest text-white/60">{t("card.points")}</p>
            <p className="font-mono text-lg font-bold tabular-nums">{account.points.toLocaleString()}</p>
          </div>
        </div>
      </div>

      {/* ── points hero + tier ──────────────────────────── */}
      <Card>
        <CardContent className="p-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">{t("balance")}</p>
              <p className="font-mono text-4xl font-bold tabular-nums">{account.points.toLocaleString()}</p>
              <p className="text-sm text-muted-foreground">
                {t("points")} · {account.lifetimePoints.toLocaleString()} {t("lifetime")}
              </p>
            </div>
            {account.tierName && (
              <span className={`rounded-full px-3 py-1 text-sm font-semibold ${tierColor(account.tier)}`}>
                {account.tierName}
              </span>
            )}
          </div>

          {/* progress to next tier */}
          <div className="mt-5">
            {tier.next && tier.pointsToNext !== null ? (
              <>
                <div className="mb-1.5 flex justify-between text-xs text-muted-foreground">
                  <span>{account.tierName ?? t("noTier")}</span>
                  <span>{tier.next.name}</span>
                </div>
                <Progress value={tier.progressPct} max={100} />
                <p className="mt-1.5 text-sm text-muted-foreground">
                  {t("toNext", { points: tier.pointsToNext.toLocaleString(), tier: tier.next.name })}
                </p>
              </>
            ) : (
              <p className="text-sm font-medium text-primary">{t("topTier")}</p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ── benefits ───────────────────────────────────── */}
      {benefits.length > 0 && (
        <Card>
          <CardContent className="p-5">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <Award className="h-4 w-4 text-primary" /> {t("benefits")}
            </h2>
            <ul className="space-y-1.5">
              {benefits.map((b) => (
                <li key={b} className="flex items-center gap-2 text-sm">
                  <Check className="h-3.5 w-3.5 text-green-600" /> {b}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* ── redeem rewards ─────────────────────────────── */}
      {redeemMsg && (
        <div
          className={`rounded-lg px-4 py-2.5 text-sm ${
            redeemMsg.ok
              ? "bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300"
              : "bg-destructive/10 text-destructive"
          }`}
        >
          {redeemMsg.text}
        </div>
      )}
      {data.rewards.length > 0 && (
        <Card>
          <CardContent className="p-5">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <Gift className="h-4 w-4 text-primary" /> {t("rewardsTitle")}
            </h2>
            <div className="space-y-2">
              {data.rewards.map((r) => (
                <div key={r.id} className="flex items-center justify-between gap-3 rounded-lg border p-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{r.name}</p>
                    {r.description && <p className="truncate text-xs text-muted-foreground">{r.description}</p>}
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className="font-mono text-sm font-semibold">
                      {r.pointsCost.toLocaleString()} {t("points")}
                    </span>
                    <button
                      onClick={() => redeem(r)}
                      disabled={!r.affordable || r.soldOut || redeeming === r.id}
                      className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {redeeming === r.id
                        ? "…"
                        : r.soldOut
                          ? t("redeemSoldOutShort")
                          : !r.affordable
                            ? t("redeemNeedMore")
                            : t("redeemBtn")}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── promo codes ────────────────────────────────── */}
      {promoCodes.length > 0 && (
        <Card>
          <CardContent className="p-5">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <Gift className="h-4 w-4 text-primary" /> {t("promos")}
            </h2>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {promoCodes.map((p) => (
                <div key={p.code} className="flex items-center justify-between gap-2 rounded-lg border p-3">
                  <div className="min-w-0">
                    <p className="font-mono text-sm font-semibold">{p.code}</p>
                    <p className="text-xs text-muted-foreground">
                      {p.discountType === "percentage" ? `${p.discountValue}%` : `${p.discountValue} ${p.currency ?? ""}`}
                      {p.minOrderAmount ? ` · ${t("minOrder", { amount: p.minOrderAmount.toLocaleString() })}` : ""}
                    </p>
                  </div>
                  <button
                    onClick={() => copy(p.code)}
                    className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs transition hover:bg-muted"
                  >
                    {copied === p.code ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
                    {copied === p.code ? t("copied") : t("copy")}
                  </button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── history ────────────────────────────────────── */}
      <Card>
        <CardContent className="p-5">
          <h2 className="mb-3 text-sm font-semibold">{t("history")}</h2>
          {history.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noHistory")}</p>
          ) : (
            <div className="divide-y">
              {history.map((h, i) => (
                <div key={i} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <div className="min-w-0">
                    <p className="truncate">{h.reason || t(`txType.${h.type}` as never)}</p>
                    <p className="text-xs text-muted-foreground">{new Date(h.createdAt).toLocaleDateString()}</p>
                  </div>
                  <span className={`font-mono font-semibold tabular-nums ${h.delta >= 0 ? "text-green-600" : "text-red-600"}`}>
                    {h.delta >= 0 ? `+${h.delta}` : h.delta}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
