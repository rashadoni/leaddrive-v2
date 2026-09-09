/**
 * C5 Account Engagement — Phase 6: ICP tier auto-scoring.
 *
 * Derives an ICP tier (tier_1..tier_4 / unscored) from a company's firmographics
 * — employee band, industry-in-target, revenue — so promoted accounts no longer
 * default to "unscored". The tier feeds the grade calculator (ICP_COMPONENT_BY_TIER)
 * and the stale-priority rule (tier_1/2 + low score). Pure + config-aware
 * (targetIndustries from the tenant's grade weights).
 */
import type { EmployeeBand, IcpTier } from "./types"

export interface ScoreIcpInput {
  employeeBand: EmployeeBand | null
  industrySlug: string | null
  /** Company annual revenue (number; same scale as Company.annualRevenue). */
  annualRevenueUsd: number | null
  /** Tenant's target industry slugs (empty list = no preference → neutral). */
  targetIndustries: readonly string[]
}

export interface IcpScore {
  tier: IcpTier
  rationale: string
}

const BAND_RANK: Readonly<Record<EmployeeBand, number>> = {
  strategic: 4,
  enterprise: 3,
  mid_market: 2,
  small: 1,
  micro: 0,
}

/**
 * Fit score → tier. Components:
 *   • band rank (0..4)
 *   • industry: +2 if in the tenant's target list, −1 if a target list exists
 *     and the industry is NOT in it, 0 if no list / unknown industry
 *   • revenue: +2 ≥ $100M, +1 ≥ $10M, else 0
 * Thresholds: ≥5 tier_1 · ≥3 tier_2 · ≥1 tier_3 · else tier_4.
 * No firmographics at all → unscored (defer until data exists).
 */
export function scoreIcpTier(input: ScoreIcpInput): IcpScore {
  const { employeeBand, industrySlug, annualRevenueUsd, targetIndustries } = input

  if (employeeBand == null && industrySlug == null && annualRevenueUsd == null) {
    return { tier: "unscored", rationale: "no firmographic data — tier deferred" }
  }

  const bandRank = employeeBand != null ? BAND_RANK[employeeBand] : 0

  let targetComponent = 0
  if (industrySlug != null && targetIndustries.length > 0) {
    targetComponent = targetIndustries.includes(industrySlug) ? 2 : -1
  }

  let revenueComponent = 0
  if (annualRevenueUsd != null && Number.isFinite(annualRevenueUsd)) {
    if (annualRevenueUsd >= 100_000_000) revenueComponent = 2
    else if (annualRevenueUsd >= 10_000_000) revenueComponent = 1
  }

  const score = bandRank + targetComponent + revenueComponent
  let tier: IcpTier
  if (score >= 5) tier = "tier_1"
  else if (score >= 3) tier = "tier_2"
  else if (score >= 1) tier = "tier_3"
  else tier = "tier_4"

  return {
    tier,
    rationale: `band=${bandRank} + target=${targetComponent} + revenue=${revenueComponent} = ${score} → ${tier}`,
  }
}
