/**
 * Personalization metrics aggregator — C4 slice 1.
 *
 * Rolls up per-variant metrics into:
 *   • Per-variant performance (CTR, conversion rate, lift over control)
 *   • Overall totals
 *
 * Lift over control = (variantConversionRate - controlConversionRate)
 *                     / controlConversionRate
 *
 * Returned as a fraction (0.15 = +15% lift). Null when control's rate
 * is 0 (undefined math) OR when the variant IS the control (lift
 * comparison against self is meaningless).
 *
 * Pure synchronous. All ratios `number | null` (consistent null-on-
 * undefined-math convention — same as C3 metrics-aggregator).
 */
import type {
  AggregateMetricsInput,
  AggregateMetricsResult,
  MetricsRollup,
  VariantPerformance,
} from "./types"

function isNonNegInt(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 0
}

function safeRatio(num: number, denom: number): number | null {
  if (denom === 0) return null
  return num / denom
}

export function aggregateMetrics(input: AggregateMetricsInput): AggregateMetricsResult {
  if (!Array.isArray(input.variants)) {
    return { ok: false, error: "variants must be an array" }
  }

  // Find control + validate inputs in one pass.
  let controlConvRate: number | null = null
  let controlFound = false
  for (let i = 0; i < input.variants.length; i++) {
    const v = input.variants[i]
    if (
      !isNonNegInt(v.decisions) ||
      !isNonNegInt(v.impressions) ||
      !isNonNegInt(v.clicks) ||
      !isNonNegInt(v.conversions)
    ) {
      return {
        ok: false,
        error: `variants[${i}] count fields must be non-negative integers`,
      }
    }
    if (v.clicks > v.impressions) {
      return {
        ok: false,
        error: `variants[${i}].clicks ${v.clicks} exceeds impressions ${v.impressions}`,
      }
    }
    if (v.conversions > v.impressions) {
      return {
        ok: false,
        error: `variants[${i}].conversions ${v.conversions} exceeds impressions ${v.impressions}`,
      }
    }
    if (v.isControl) {
      if (controlFound) {
        return {
          ok: false,
          error: "more than one variant flagged as isControl=true",
        }
      }
      controlFound = true
      controlConvRate = safeRatio(v.conversions, v.impressions)
    }
  }

  const perVariant: VariantPerformance[] = input.variants.map((v) => {
    const ctr = safeRatio(v.clicks, v.impressions)
    const conversionRate = safeRatio(v.conversions, v.impressions)
    let liftOverControlPct: number | null = null
    if (!v.isControl && controlConvRate !== null && controlConvRate > 0 && conversionRate !== null) {
      liftOverControlPct = (conversionRate - controlConvRate) / controlConvRate
    }
    return {
      variantId: v.variantId,
      variantSlug: v.variantSlug,
      isControl: v.isControl,
      decisions: v.decisions,
      impressions: v.impressions,
      clicks: v.clicks,
      conversions: v.conversions,
      ctr,
      conversionRate,
      liftOverControlPct,
    }
  })

  const totals = perVariant.reduce(
    (acc, p) => ({
      decisions: acc.decisions + p.decisions,
      impressions: acc.impressions + p.impressions,
      clicks: acc.clicks + p.clicks,
      conversions: acc.conversions + p.conversions,
    }),
    { decisions: 0, impressions: 0, clicks: 0, conversions: 0 }
  )

  const rollup: MetricsRollup = { perVariant, totals }
  return { ok: true, rollup }
}
