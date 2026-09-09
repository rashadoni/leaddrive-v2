/**
 * Metrics aggregator — C3 slice 1.
 *
 * Rolls up per-campaign metrics into a single set of derived values:
 * total spend, CTR, conversion rate, CPA, ROAS, CPC.
 *
 * All money math in integer minor units. Counts are stored as BigInt
 * in the DB column but the helper accepts Number (caller converts
 * BigInt → Number — realistic counts are well within safe integer).
 *
 * Pure synchronous. Mixed-currency rejected — slice-3 wires FX.
 */
import {
  type AggregateMetricsInput,
  type AggregateMetricsResult,
  type MetricsAggregate,
} from "./types"

function isNonNegInt(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 0
}

export function aggregateMetrics(input: AggregateMetricsInput): AggregateMetricsResult {
  if (typeof input.baseCurrency !== "string" || !/^[A-Z]{3}$/.test(input.baseCurrency)) {
    return { ok: false, error: "baseCurrency must be a 3-letter ISO-4217 code" }
  }
  if (!Array.isArray(input.campaigns)) {
    return { ok: false, error: "campaigns must be an array" }
  }

  let totalSpendMinor = 0
  let totalImpressions = 0
  let totalClicks = 0
  let totalConversions = 0
  let totalConversionValueMinor = 0
  let campaignCount = 0

  for (let i = 0; i < input.campaigns.length; i++) {
    const c = input.campaigns[i]
    if (typeof c.currency !== "string" || !/^[A-Z]{3}$/.test(c.currency)) {
      return { ok: false, error: `campaigns[${i}].currency must be ISO-4217` }
    }
    if (c.currency !== input.baseCurrency) {
      return {
        ok: false,
        error: `campaigns[${i}].currency "${c.currency}" differs from base "${input.baseCurrency}" — slice-3 FX required`,
      }
    }
    if (!isNonNegInt(c.spendMinor)) {
      return { ok: false, error: `campaigns[${i}].spendMinor must be a non-negative integer` }
    }
    if (!isNonNegInt(c.impressions)) {
      return { ok: false, error: `campaigns[${i}].impressions must be a non-negative integer` }
    }
    if (!isNonNegInt(c.clicks)) {
      return { ok: false, error: `campaigns[${i}].clicks must be a non-negative integer` }
    }
    if (c.clicks > c.impressions) {
      return {
        ok: false,
        error: `campaigns[${i}].clicks ${c.clicks} exceeds impressions ${c.impressions}`,
      }
    }
    if (!isNonNegInt(c.conversions)) {
      return {
        ok: false,
        error: `campaigns[${i}].conversions must be a non-negative integer`,
      }
    }
    if (c.conversions > c.clicks) {
      return {
        ok: false,
        error: `campaigns[${i}].conversions ${c.conversions} exceeds clicks ${c.clicks}`,
      }
    }
    if (!isNonNegInt(c.conversionValueMinor)) {
      return {
        ok: false,
        error: `campaigns[${i}].conversionValueMinor must be a non-negative integer`,
      }
    }

    totalSpendMinor += c.spendMinor
    totalImpressions += c.impressions
    totalClicks += c.clicks
    totalConversions += c.conversions
    totalConversionValueMinor += c.conversionValueMinor
    campaignCount += 1
  }

  // Architect-pass-1 close-out: null-on-zero-divisor convention for ALL
  // ratios (was mixed 0-vs-null before). UI distinguishes "no data" from
  // "0%" — slice-2 dashboard renders "—" for null.
  const ctr = totalImpressions > 0 ? totalClicks / totalImpressions : null
  const conversionRate = totalClicks > 0 ? totalConversions / totalClicks : null
  const cpaMinor =
    totalConversions > 0 ? Math.round(totalSpendMinor / totalConversions) : null
  const roas =
    totalSpendMinor > 0 ? totalConversionValueMinor / totalSpendMinor : null
  const cpcMinor =
    totalClicks > 0 ? Math.round(totalSpendMinor / totalClicks) : null

  const aggregate: MetricsAggregate = {
    totalSpendMinor,
    totalImpressions,
    totalClicks,
    totalConversions,
    totalConversionValueMinor,
    ctr,
    conversionRate,
    cpaMinor,
    roas,
    cpcMinor,
    campaignCount,
  }
  return { ok: true, aggregate }
}
