"use client"

/**
 * D8 Loyalty Builder — live PREVIEW panel (Slice 2 step 3a).
 *
 * The interactive centerpiece: shows the admin EXACTLY what members earn /
 * which promo applies, computed through the same pure helpers production uses
 * (via src/lib/loyalty/preview.ts). Three tools:
 *   1. Points calculator — order amount + event → points at every tier.
 *   2. Tier ladder — the configured tiers + their multipliers.
 *   3. Promo tester — what-if a promo code against an order.
 *
 * Pure presentational + client compute; takes the already-loaded rules / tiers
 * / promos as props (the builder page owns the fetch).
 */
import { useMemo, useState } from "react"
import { useTranslations } from "next-intl"
import { Calculator, Layers, TicketPercent } from "lucide-react"
import { MotionCard } from "@/components/ui/motion"
import {
  earnPreview,
  promoPreview,
  type PreviewEarnRule,
  type PreviewTier,
  type PreviewPromoCode,
} from "@/lib/loyalty/preview"
import { EARN_RULE_TRIGGERS, type EarnRuleTrigger } from "@/lib/loyalty/limits"
import { tierColor } from "@/lib/loyalty/tier-colors"

const AMOUNT_PRESETS = [10, 50, 250]

interface Props {
  rules: PreviewEarnRule[]
  tiers: PreviewTier[]
  promos: PreviewPromoCode[]
  /** Display + promo currency (org primary). */
  currency?: string
}

export function LoyaltyPreviewPanel({ rules, tiers, promos, currency = "AZN" }: Props) {
  const t = useTranslations("slice2.loyaltyBuilder")
  const tt = useTranslations("slice2.loyaltyEarnRules.triggers")

  const [amount, setAmount] = useState(50)
  const [trigger, setTrigger] = useState<EarnRuleTrigger>("purchase")
  const [promoId, setPromoId] = useState<string>(promos[0]?.id ?? "")
  const [subtotal, setSubtotal] = useState(100)

  const earnRows = useMemo(
    () => earnPreview(rules, tiers, { trigger, orderAmount: amount, currency }),
    [rules, tiers, trigger, amount, currency],
  )

  const sortedTiers = useMemo(
    () => [...tiers].filter((x) => x.isActive !== false).sort((a, b) => a.minLifetimePoints - b.minLifetimePoints),
    [tiers],
  )

  const selectedPromo = promos.find((p) => p.id === promoId) ?? null
  const promoResult = useMemo(
    () =>
      selectedPromo
        ? promoPreview(selectedPromo, { subtotal, currency: selectedPromo.currency ?? currency })
        : null,
    [selectedPromo, subtotal, currency],
  )

  return (
    <div className="space-y-4">
      {/* ── Points calculator ───────────────────────────── */}
      <MotionCard className="rounded-xl border bg-card p-4">
        <div className="mb-3 flex items-center gap-2">
          <Calculator className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">{t("calcTitle")}</h3>
        </div>
        <p className="mb-3 text-xs text-muted-foreground">{t("calcHint")}</p>

        <div className="mb-3 grid grid-cols-2 gap-2">
          <label className="block">
            <span className="mb-1 block text-xs text-muted-foreground">{t("orderAmount")}</span>
            <input
              type="number" min={0} value={amount}
              onChange={(e) => setAmount(Math.max(0, Number(e.target.value) || 0))}
              className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-muted-foreground">{t("event")}</span>
            <select
              value={trigger}
              onChange={(e) => setTrigger(e.target.value as EarnRuleTrigger)}
              className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
            >
              {EARN_RULE_TRIGGERS.map((tr) => (
                <option key={tr} value={tr}>{tt(tr)}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="mb-3 flex gap-1">
          {AMOUNT_PRESETS.map((p) => (
            <button
              key={p}
              onClick={() => setAmount(p)}
              className={`rounded-md border px-2 py-0.5 text-xs transition ${
                amount === p ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted"
              }`}
            >
              {currency} {p}
            </button>
          ))}
        </div>

        <div className="overflow-hidden rounded-md border">
          <div className="grid grid-cols-[1fr_auto_auto] gap-2 bg-muted/50 px-3 py-1.5 text-[11px] font-medium text-muted-foreground">
            <span>{t("colTier")}</span>
            <span className="text-right">{t("colMultiplier")}</span>
            <span className="text-right">{t("colPoints")}</span>
          </div>
          {earnRows.map((r) => (
            <div key={r.tierCode ?? "__base"} className="grid grid-cols-[1fr_auto_auto] items-center gap-2 border-t px-3 py-1.5 text-sm">
              <span className="flex items-center gap-2">
                <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${tierColor(r.tierCode)}`}>
                  {r.tierName || r.tierCode || t("noTierLabel")}
                </span>
              </span>
              <span className="text-right tabular-nums text-muted-foreground">×{r.multiplier}</span>
              <span className="text-right font-mono font-semibold tabular-nums">
                {r.award > 0 ? `+${r.award}` : "—"}
              </span>
            </div>
          ))}
          {earnRows.every((r) => r.award === 0) && (
            <div className="border-t px-3 py-2 text-xs text-muted-foreground">{t("noRule")}</div>
          )}
        </div>
      </MotionCard>

      {/* ── Tier ladder ─────────────────────────────────── */}
      <MotionCard className="rounded-xl border bg-card p-4">
        <div className="mb-3 flex items-center gap-2">
          <Layers className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">{t("tierLadderTitle")}</h3>
        </div>
        {sortedTiers.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t("noTiers")}</p>
        ) : (
          <div className="flex flex-wrap items-stretch gap-2">
            {sortedTiers.map((tier) => (
              <div key={tier.code} className="flex min-w-[88px] flex-1 flex-col gap-1 rounded-lg border p-2">
                <span className={`self-start rounded px-1.5 py-0.5 text-[11px] font-medium ${tierColor(tier.code)}`}>
                  {tier.name || tier.code}
                </span>
                <span className="text-[11px] text-muted-foreground">
                  {tier.minLifetimePoints.toLocaleString()}+ {t("ptsShort")}
                </span>
                <span className="text-xs font-semibold tabular-nums">×{tier.multiplier}</span>
              </div>
            ))}
          </div>
        )}
      </MotionCard>

      {/* ── Promo tester ────────────────────────────────── */}
      <MotionCard className="rounded-xl border bg-card p-4">
        <div className="mb-3 flex items-center gap-2">
          <TicketPercent className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">{t("promoTesterTitle")}</h3>
        </div>
        {promos.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t("noPromos")}</p>
        ) : (
          <>
            <div className="mb-3 grid grid-cols-2 gap-2">
              <label className="block">
                <span className="mb-1 block text-xs text-muted-foreground">{t("promoCode")}</span>
                <select
                  value={promoId}
                  onChange={(e) => setPromoId(e.target.value)}
                  className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
                >
                  {promos.map((p) => (
                    <option key={p.id} value={p.id}>{p.code}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-xs text-muted-foreground">{t("subtotal")}</span>
                <input
                  type="number" min={0} value={subtotal}
                  onChange={(e) => setSubtotal(Math.max(0, Number(e.target.value) || 0))}
                  className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
                />
              </label>
            </div>
            {promoResult && (
              promoResult.ok ? (
                <div className="rounded-md border border-green-600/30 bg-green-600/10 px-3 py-2 text-sm">
                  <span className="font-semibold text-green-700 dark:text-green-400">
                    −{selectedPromo?.currency ?? currency} {promoResult.amount}
                  </span>{" "}
                  <span className="text-muted-foreground">{t("applies")}</span>
                  {promoResult.capped && <span className="text-muted-foreground"> {t("cappedNote")}</span>}
                </div>
              ) : (
                <div className="rounded-md border border-amber-600/30 bg-amber-600/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
                  {t(`reason.${promoResult.reason}` as never)}
                </div>
              )
            )}
          </>
        )}
      </MotionCard>
    </div>
  )
}
