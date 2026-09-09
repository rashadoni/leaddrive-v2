/**
 * D8 Loyalty — storefront earn pipeline (Phase D).
 *
 * Pure helpers that translate a storefront earn event (purchase /
 * signup / referral / ...) into points using the tenant's configured
 * LoyaltyEarnRule rows + active LoyaltyTier multiplier.
 *
 * Rule selection algorithm:
 *   1. Filter to active rules whose `trigger` matches the event.
 *   2. Apply validity-window check (validFrom <= asOf <= validUntil).
 *   3. Apply minOrderAmount check (orderAmount >= rule.minOrderAmount).
 *   4. Apply productCategory check (if rule.productCategory set, must equal ctx).
 *   5. Sort by [priority DESC, createdAt ASC] — admin GET surfaces
 *      rules in the same order so what operator sees == what fires.
 *   6. First survivor wins.
 *
 * Award computation:
 *   - If rule.pointsFlat is set, base = pointsFlat (orderAmount ignored).
 *   - Else base = Math.floor(rule.pointsRate × orderAmount).
 *     (Math.floor at the base layer because we work in integer points;
 *     a 1pt/$ rule on a $9.99 order awards 9 points, not 10.)
 *   - If rule.applyTierMultiplier is true: award = Math.floor(base × tierMultiplier).
 *     (Conservative; documented in tier-resolver.ts.)
 *   - Else: award = base.
 *
 * Pure — no DB. The route layer reads rules from DB, calls this, then
 * writes the LoyaltyAccount + LoyaltyTransaction.
 */
import { applyTierMultiplier } from "./tier-resolver"
import type { EarnRuleTrigger } from "./limits"

/**
 * A row from LoyaltyEarnRule, narrowed to the fields the pipeline cares
 * about. The route's Prisma select must include all these.
 */
export interface EarnRuleRow {
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
  validFrom: Date | null
  validUntil: Date | null
  createdAt: Date
}

/**
 * The event context for a single earn evaluation.
 */
export interface EarnContext {
  trigger: EarnRuleTrigger
  /** Storefront order amount in `currency`. Required for pointsRate rules. */
  orderAmount: number
  currency: string
  /** Optional category filter (matches rule.productCategory exactly). */
  productCategory: string | null
  /** Caller-supplied — testability. Defaults to now(). */
  asOf?: Date
}

/* ─── Rule selection ────────────────────────────────────────────────── */

/**
 * Given an org's full active rule list + an event, pick the winning
 * rule. Returns null when no rule matches.
 */
export function pickEarnRule(
  rules: readonly EarnRuleRow[],
  ctx: EarnContext,
): EarnRuleRow | null {
  const asOf = ctx.asOf ?? new Date()

  const eligible = rules.filter((r) => {
    if (!r.isActive) return false
    if (r.trigger !== ctx.trigger) return false
    if (r.validFrom && asOf < r.validFrom) return false
    if (r.validUntil && asOf > r.validUntil) return false
    if (r.minOrderAmount !== null && ctx.orderAmount < r.minOrderAmount) {
      return false
    }
    if (r.productCategory !== null && r.productCategory !== ctx.productCategory) {
      return false
    }
    // Must award something. A pointsRate rule on a $0 order would
    // award 0 — skip such rules; flat-only rules always pass.
    if (r.pointsFlat === null) {
      if (r.pointsRate === null || r.pointsRate <= 0) return false
      const wouldAward = Math.floor(r.pointsRate * ctx.orderAmount)
      if (wouldAward <= 0) return false
    }
    return true
  })

  if (eligible.length === 0) return null

  // Sort by [priority DESC, createdAt ASC]. Matches admin GET ordering
  // (loyalty-earn-rules/route.ts) so the operator dashboard preview
  // is faithful to firing order.
  //
  // `eligible` is a fresh array returned by .filter() so the in-place
  // sort here does NOT mutate the caller's `rules` array — safe.
  eligible.sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority
    return a.createdAt.getTime() - b.createdAt.getTime()
  })
  return eligible[0]
}

/* ─── Award computation ─────────────────────────────────────────────── */

export interface EarnComputeResult {
  /** Total points to credit the LoyaltyAccount. */
  award: number
  /** Base award before tier multiplier (transparency for audit). */
  base: number
  /** Whether the rule's flat path won (vs. rate × amount). */
  source: "flat" | "rate"
  /** The tier multiplier that was actually applied (1.0 if !applyTierMultiplier). */
  appliedMultiplier: number
}

/**
 * Compute the integer point award for a single (rule, ctx) pair with
 * the given tier multiplier. Pure math.
 *
 * `tierMultiplier` is the multiplier resolved from `LoyaltyTier`
 * (1.0 fallback when the account has no tier). Pass through verbatim
 * — applyTierMultiplier() handles the floor + safety guards.
 */
export function computeEarnAmount(
  rule: EarnRuleRow,
  ctx: EarnContext,
  tierMultiplier: number,
): EarnComputeResult {
  let base: number
  let source: "flat" | "rate"

  if (rule.pointsFlat !== null) {
    // Flat-priority rule: orderAmount irrelevant. Used for signup
    // bonuses, birthday awards, referral credits. The DB CHECK
    // `loyalty_earn_rules_award_present_check` guarantees the value
    // is non-null when pointsRate is null; both-set is allowed and
    // flat wins (documented in migration line 178-180).
    base = Math.max(0, rule.pointsFlat)
    source = "flat"
  } else if (rule.pointsRate !== null && rule.pointsRate > 0 && ctx.orderAmount > 0) {
    // Rate × amount rule: Math.floor at the base layer so we stay in
    // integer-points space. $9.99 × 1pt/$ = 9.99 → floor = 9.
    base = Math.floor(rule.pointsRate * ctx.orderAmount)
    source = "rate"
  } else {
    return { award: 0, base: 0, source: "rate", appliedMultiplier: 1.0 }
  }

  const appliedMultiplier = rule.applyTierMultiplier ? tierMultiplier : 1.0
  const award = rule.applyTierMultiplier
    ? applyTierMultiplier(base, tierMultiplier)
    : base

  return { award, base, source, appliedMultiplier }
}

/* ─── Convenience: pick + compute together ──────────────────────────── */

export interface EarnPipelineResult {
  rule: EarnRuleRow | null
  award: number
  base: number
  source: "flat" | "rate" | "no_rule"
  appliedMultiplier: number
}

/**
 * One-call wrapper: select the rule, compute the award. Returns
 * `{rule: null, award: 0}` when no rule matches.
 */
export function evaluateEarn(
  rules: readonly EarnRuleRow[],
  ctx: EarnContext,
  tierMultiplier: number,
): EarnPipelineResult {
  const rule = pickEarnRule(rules, ctx)
  if (!rule) {
    return {
      rule: null,
      award: 0,
      base: 0,
      source: "no_rule",
      appliedMultiplier: 1.0,
    }
  }
  const compute = computeEarnAmount(rule, ctx, tierMultiplier)
  return {
    rule,
    award: compute.award,
    base: compute.base,
    source: compute.source,
    appliedMultiplier: compute.appliedMultiplier,
  }
}
