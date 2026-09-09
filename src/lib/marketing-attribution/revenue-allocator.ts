/**
 * C9 revenue-allocator — Decimal-exact apportionment (#11).
 *
 * Given a deal's revenue + per-campaign weights (output of
 * touchpoint-aggregator), split the revenue across campaigns so that the
 * per-campaign `attributedRevenue` values sum EXACTLY to the deal total —
 * no pennies lost or gained to float rounding.
 *
 * Before #11 this was a naive `weight × dealAmount` per campaign: each value
 * was then rounded independently to the Decimal(18,4) column, so a 3-way split
 * of $100 stored 33.3333 × 3 = 99.9999 and lost a unit. Now it uses the
 * largest-remainder (Hamilton) method on the money grid:
 *
 *   1. Target total T = round(dealAmount × SCALE) grid-units (SCALE = 10^4,
 *      matching campaign_influences.attributedRevenue Decimal(18,4),
 *      prisma/schema.prisma:11829).
 *   2. Normalize the weights so Σ = 1, then each campaign's ideal share is
 *      (weight / Σweight) × T. Floor each onto the grid.
 *   3. The leftover units — computed as the EXACT integer difference
 *      `T − Σ floor(ideal_i)`, NOT a Math.round of a fragile float sum — are
 *      handed one at a time to the campaigns with the largest fractional
 *      remainder, ties broken by campaignId for determinism.
 *
 * Because the leftover is an exact integer in [0, n), every grid-unit lands on
 * a distinct campaign and the parts sum to T with no drift in either direction
 * (an earlier float `Math.round(Σfrac)` could both drop a unit at x.4999… and
 * invent one at x.5 — see the #11 adversarial regression tests).
 *
 * Precision: grid-exact (parts sum to the grid-rounded deal total, no penny
 * lost or gained) for every reachable amount. The create API caps deal values
 * at 1e9 and the 8000-iteration fuzz proves zero drift across that range with
 * orders of magnitude to spare. Exactness rests on the grid-units
 * (amount·SCALE) staying well below 2^53; for amounts in the hundreds of
 * billions they approach it, float spacing exceeds the 4-decimal grid, and for
 * some weight combinations a unit can drift — first under-, eventually (past
 * the ~$900B / 2^53 wall) over-allocating. The two-directional clamp below
 * holds exactness across the reachable range and as far as the grid stays
 * representable. The residual regime is a hard limit of the JS-number input
 * (the worker passes decimalToNumber(Decimal(18,4))), not of the method, and
 * unreachable via the API.
 *
 * Pure function — no DB.
 */

import type { CampaignInfluenceComputed } from "./types"

export interface AllocatedInfluence extends CampaignInfluenceComputed {
  /** weight-proportional share of dealAmount, on the Decimal(18,4) grid. */
  attributedRevenue: number
}

export interface AllocateInput {
  /** Closed-won deal revenue. Must be ≥ 0. */
  dealAmount: number
  /** Per-campaign weights from touchpoint-aggregator. */
  influences: ReadonlyArray<CampaignInfluenceComputed>
}

/** Decimal places of campaign_influences.attributedRevenue — Decimal(18,4). */
export const MONEY_DECIMAL_PLACES = 4
/** Grid factor: 1 currency unit = MONEY_SCALE integer grid-units. */
const MONEY_SCALE = 10 ** MONEY_DECIMAL_PLACES

/**
 * Apportion dealAmount across campaigns by weight, exact on the money grid.
 *
 * Defensive behaviors:
 *   • Negative dealAmount clamped to 0 (no negative attribution).
 *   • NaN / Infinity dealAmount → 0 across the board.
 *   • Negative / non-finite per-campaign weight treated as 0.
 *   • All weights 0 (or empty influences) → 0 per campaign.
 *
 * Weights are normalized by their sum, so the full dealAmount is distributed
 * across the campaigns that carry credit and the per-campaign values sum to
 * the (grid-rounded) dealAmount exactly. The aggregator already emits weights
 * summing to 1.0, so for real inputs normalization is a no-op that also
 * absorbs float overshoot (e.g. a single weight at 1.0000000002).
 */
export function allocateRevenue(input: AllocateInput): AllocatedInfluence[] {
  const safeAmount =
    Number.isFinite(input.dealAmount) && input.dealAmount > 0
      ? input.dealAmount
      : 0

  if (input.influences.length === 0) return []

  // Clamp each weight to ≥ 0 (a negative weight would steal grid-units).
  const w = input.influences.map((inf) =>
    Number.isFinite(inf.weight) && inf.weight > 0 ? inf.weight : 0,
  )
  const sumW = w.reduce((s, x) => s + x, 0)

  if (safeAmount === 0 || sumW <= 0) {
    return input.influences.map((inf) => ({ ...inf, attributedRevenue: 0 }))
  }

  // Target total in grid-units. dealAmount is on the Decimal(18,4) grid, so
  // round() recovers the exact integer even when the float representation of
  // an on-grid value is a hair off (0.0019 × 10000 = 18.999999999999996).
  const totalUnits = Math.round(safeAmount * MONEY_SCALE)

  // Largest-remainder on the integer grid. Normalizing by sumW makes
  // Σ ideal == totalUnits (in exact arithmetic), so the leftover below is an
  // EXACT integer difference — never a Math.round of a fragile float sum.
  const ideal = w.map((x) => (x / sumW) * totalUnits)
  const units = ideal.map((u) => Math.floor(u))
  const sumBase = units.reduce((s, u) => s + u, 0)
  let leftover = totalUnits - sumBase

  // Biggest fractional part first; ties by campaignId asc so identical inputs
  // always produce identical output.
  const order = input.influences
    .map((inf, i) => ({ i, frac: ideal[i] - units[i], campaignId: inf.campaignId }))
    .sort(
      (a, b) =>
        b.frac - a.frac ||
        (a.campaignId < b.campaignId ? -1 : a.campaignId > b.campaignId ? 1 : 0),
    )

  // In exact arithmetic leftover ∈ [0, n]; correct in BOTH directions so the
  // result lands on totalUnits across the reachable range. The negative branch
  // only fires at extreme magnitudes (totalUnits near 2^53), where float drift
  // in Σ(weight/sumW) can push Σfloor a hair past totalUnits; it claws units
  // back from the SMALLEST remainders (rounded up least deservedly), never
  // below 0. Right at the 2^53 wall a residual unit can survive if claw-back
  // exhausts the nonzero remainders — the documented precision limit, far past
  // any reachable amount.
  for (let k = 0; k < order.length && leftover > 0; k++, leftover--) {
    units[order[k].i] += 1
  }
  for (let k = order.length - 1; k >= 0 && leftover < 0; k--) {
    if (units[order[k].i] > 0) {
      units[order[k].i] -= 1
      leftover += 1
    }
  }

  return input.influences.map((inf, i) => ({
    ...inf,
    attributedRevenue: units[i] / MONEY_SCALE,
  }))
}

/**
 * Total attributed revenue across all entries. Equals the deal amount (to the
 * money grid) when at least one weight is positive.
 *
 * Note: summed in float here, so a few entries on the 4-decimal grid may show
 * a sub-grid representation error (e.g. 99.99999999999999 for $100). The
 * underlying grid-units sum exactly — Postgres sums the Decimal column without
 * that artifact. Use Math.round(total * 10**MONEY_DECIMAL_PLACES) for an exact
 * grid comparison.
 */
export function totalAttributedRevenue(
  entries: ReadonlyArray<AllocatedInfluence>,
): number {
  let total = 0
  for (const e of entries) total += e.attributedRevenue
  return total
}
