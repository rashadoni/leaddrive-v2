/**
 * D8 Loyalty — client-side PREVIEW mirror (Slice 2 Loyalty Builder).
 *
 * Pure, client-importable. Does NOT reimplement any loyalty math — it adapts
 * the admin-API JSON shapes into the helper input shapes and calls the EXACT
 * SAME pure helpers the server routes use (`evaluateEarn`, `resolveTierFromList`,
 * `validatePromoApplication`, `calculateDiscount`). So the builder's live
 * preview is byte-faithful to production ("preview == reality"), the same
 * property the leaderboard config + attribution CurvePreview rely on.
 *
 * THE GOTCHA this file centralizes: the admin GET routes return date columns
 * (`createdAt`/`validFrom`/`validUntil`) as ISO STRINGS, but the helpers type
 * them as `Date`. Calling a helper with a string date silently breaks the
 * validity-window logic (string comparisons), so every date is re-hydrated to
 * `Date` here before the helper sees it.
 */
import { evaluateEarn, type EarnRuleRow } from "./earn-pipeline"
import { resolveTierFromList, type ActiveTierRow } from "./tier-resolver"
import { validatePromoApplication } from "./promo-validator"
import { calculateDiscount } from "./discount-calculator"
import type { PromoCodeRow, PromoRejectionReason } from "./types"
import type { EarnRuleTrigger } from "./limits"

// ── date hydration ────────────────────────────────────────────────
function toDate(v: string | Date | null | undefined): Date | null {
  if (v == null) return null
  return v instanceof Date ? v : new Date(v)
}
function toDateReq(v: string | Date): Date {
  return v instanceof Date ? v : new Date(v)
}

// ── earn preview ──────────────────────────────────────────────────

/** EarnRule as the admin GET route serializes it (numbers normalized,
 *  dates as ISO strings). Dates also accept `Date` for direct test use. */
export interface PreviewEarnRule {
  id: string
  name: string
  trigger: string
  pointsRate: number | null
  pointsFlat: number | null
  minOrderAmount: number | null
  productCategory: string | null
  priority: number
  applyTierMultiplier: boolean
  isActive: boolean
  validFrom: string | Date | null
  validUntil: string | Date | null
  createdAt: string | Date
}

/** Tier as the admin GET route serializes it. */
export interface PreviewTier {
  code: string
  name?: string | null
  minLifetimePoints: number
  multiplier: number
  isActive?: boolean
}

export interface EarnPreviewContext {
  trigger: EarnRuleTrigger
  orderAmount: number
  currency: string
  productCategory?: string | null
  /** Injectable clock (defaults to now via the helper). */
  asOf?: Date
}

/** One row of the earn calculator: points a member AT this tier would earn. */
export interface EarnPreviewRow {
  /** Tier slug, or null for the "no tier yet" baseline. */
  tierCode: string | null
  tierName: string | null
  minLifetimePoints: number | null
  multiplier: number
  award: number
  base: number
  source: "flat" | "rate" | "no_rule"
  ruleName: string | null
}

function hydrateRule(r: PreviewEarnRule): EarnRuleRow {
  return {
    id: r.id,
    name: r.name,
    trigger: r.trigger,
    pointsRate: r.pointsRate,
    pointsFlat: r.pointsFlat,
    minOrderAmount: r.minOrderAmount,
    productCategory: r.productCategory,
    priority: r.priority,
    applyTierMultiplier: r.applyTierMultiplier,
    isActive: r.isActive,
    validFrom: toDate(r.validFrom),
    validUntil: toDate(r.validUntil),
    createdAt: toDateReq(r.createdAt),
  }
}

/**
 * Compute the points an order earns at EVERY tier (plus a "no tier" baseline
 * when the lowest tier sits above 0), using the real rule engine + tier
 * resolver. Rows are ordered baseline → ascending tier threshold.
 */
export function earnPreview(
  rules: readonly PreviewEarnRule[],
  tiers: readonly PreviewTier[],
  ctx: EarnPreviewContext,
): EarnPreviewRow[] {
  const hydrated = rules.map(hydrateRule)
  const active: (ActiveTierRow & { name: string | null })[] = tiers
    .filter((t) => t.isActive !== false)
    .map((t) => ({ code: t.code, minLifetimePoints: t.minLifetimePoints, multiplier: t.multiplier, name: t.name ?? null }))
    .sort((a, b) => a.minLifetimePoints - b.minLifetimePoints || a.code.localeCompare(b.code))

  const evalCtx = {
    trigger: ctx.trigger,
    orderAmount: ctx.orderAmount,
    currency: ctx.currency,
    productCategory: ctx.productCategory ?? null,
    ...(ctx.asOf ? { asOf: ctx.asOf } : {}),
  }

  const rows: EarnPreviewRow[] = []
  const lowest = active[0]?.minLifetimePoints ?? 0

  // "no tier" baseline — only meaningful when there's a gap below the lowest
  // tier (e.g. no 0-point bronze), or when there are no tiers at all.
  if (active.length === 0 || lowest > 0) {
    const resolved = resolveTierFromList(active, 0)
    const r = evaluateEarn(hydrated, evalCtx, resolved.multiplier)
    rows.push({
      tierCode: resolved.tier,
      tierName: null,
      minLifetimePoints: null,
      multiplier: resolved.multiplier,
      award: r.award,
      base: r.base,
      source: r.source,
      ruleName: r.rule?.name ?? null,
    })
  }

  for (const t of active) {
    // Resolve the multiplier through the REAL resolver at this tier's
    // threshold (proves the resolver picks this tier), then run the engine.
    // resolveTierFromList at exactly this tier's threshold resolves to this
    // tier (inclusive boundary + same tie-break), so resolved.tier === t.code.
    const resolved = resolveTierFromList(active, t.minLifetimePoints)
    const r = evaluateEarn(hydrated, evalCtx, resolved.multiplier)
    rows.push({
      tierCode: resolved.tier,
      tierName: t.name,
      minLifetimePoints: t.minLifetimePoints,
      multiplier: resolved.multiplier,
      award: r.award,
      base: r.base,
      source: r.source,
      ruleName: r.rule?.name ?? null,
    })
  }

  return rows
}

// ── promo preview ─────────────────────────────────────────────────

/** PromoCode as the admin GET route serializes it (dates as ISO strings). */
export interface PreviewPromoCode {
  id: string
  code: string
  discountType: "percentage" | "fixed"
  discountValue: number
  currency: string | null
  minOrderAmount: number | null
  usageLimit: number | null
  perCustomerLimit: number | null
  validFrom: string | Date | null
  validUntil: string | Date | null
  isActive: boolean
}

export interface PromoPreviewInput {
  subtotal: number
  currency: string
  contactId?: string | null
  asOf?: Date
}

export interface PromoPreviewResult {
  ok: boolean
  /** Set when ok=false — drives the tester's "why" message. */
  reason?: PromoRejectionReason
  message?: string
  /** Set when ok=true — the computed discount. */
  amount?: number
  capped?: boolean
}

function hydratePromo(c: PreviewPromoCode): PromoCodeRow {
  return {
    id: c.id,
    code: c.code,
    discountType: c.discountType,
    discountValue: c.discountValue,
    currency: c.currency,
    minOrderAmount: c.minOrderAmount,
    usageLimit: c.usageLimit,
    perCustomerLimit: c.perCustomerLimit,
    validFrom: toDate(c.validFrom),
    validUntil: toDate(c.validUntil),
    isActive: c.isActive,
  }
}

/**
 * What-if a promo code against an order. Usage/per-customer limits can't be hit
 * in a preview, so counts are zeroed — the tester surfaces every OTHER rejection
 * (inactive / expired / currency / min-order) plus the computed discount.
 */
export function promoPreview(
  code: PreviewPromoCode,
  order: PromoPreviewInput,
): PromoPreviewResult {
  const row = hydratePromo(code)
  const validity = validatePromoApplication({
    code: row,
    order: { subtotal: order.subtotal, currency: order.currency, contactId: order.contactId ?? null },
    counts: { total: 0, byContact: 0 },
    ...(order.asOf ? { asOf: order.asOf } : {}),
  })
  if (!validity.ok) {
    return { ok: false, reason: validity.reason, message: validity.message }
  }
  const discount = calculateDiscount({ code: row, subtotal: order.subtotal })
  return { ok: true, amount: discount.amount, capped: discount.capped }
}
