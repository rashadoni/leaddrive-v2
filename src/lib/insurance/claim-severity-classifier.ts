/**
 * Claim severity classifier — R7 slice 1.
 *
 * Bands a claim into one of 4 severity tiers based on:
 *   • Absolute dollar amount (initial reserve, paid + current reserve)
 *   • Loss-type adjustments (death/disability skew higher even at low $)
 *   • Optional policy-coverage ratio (when totalAmount approaches the
 *     face value, the claim is catastrophic for THIS policy regardless
 *     of absolute size — a $5K claim on a $5K policy = total loss).
 *
 * Tier thresholds (slice-1 defaults — slice-2 tenant-configurable):
 *   catastrophic — totalAmount > $500K OR (coverage ratio > 0.80
 *                  AND total > $25K) OR loss = death
 *   major        — totalAmount > $50K
 *   moderate     — totalAmount > $5K
 *   minor        — otherwise
 *
 * Loss-type skew:
 *   death        → catastrophic (always — death claims need exec review)
 *   disability   → bump by one tier
 *   medical      → bump by one tier (catastrophic injury implications)
 *
 * Pure synchronous.
 */
import {
  CLAIM_LOSS_TYPES,
  CLAIM_SEVERITIES,
  type ClaimSeverity,
  type ClassifyClaimSeverityInput,
  type ClassifyClaimSeverityResult,
} from "./types"

const TIER_RANK: Readonly<Record<ClaimSeverity, number>> = {
  minor: 0,
  moderate: 1,
  major: 2,
  catastrophic: 3,
}

const RANK_TO_TIER: ClaimSeverity[] = [
  "minor",
  "moderate",
  "major",
  "catastrophic",
]

function bumpTier(tier: ClaimSeverity, by: number): ClaimSeverity {
  const newRank = Math.min(TIER_RANK[tier] + by, RANK_TO_TIER.length - 1)
  return RANK_TO_TIER[newRank]
}

function bandByAmount(amount: number): ClaimSeverity {
  if (amount > 500_000) return "catastrophic"
  if (amount > 50_000) return "major"
  if (amount > 5_000) return "moderate"
  return "minor"
}

function isFiniteNonNegative(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n >= 0
}

export function classifyClaimSeverity(
  input: ClassifyClaimSeverityInput
): ClassifyClaimSeverityResult {
  if (!isFiniteNonNegative(input.totalAmount)) {
    return {
      ok: false,
      error: "totalAmount must be a finite non-negative number",
    }
  }
  if (!(CLAIM_LOSS_TYPES as readonly string[]).includes(input.lossType)) {
    return {
      ok: false,
      error: `unknown lossType "${String(input.lossType)}"`,
    }
  }
  if (
    input.policyCoverageLimit !== null &&
    input.policyCoverageLimit !== undefined &&
    !isFiniteNonNegative(input.policyCoverageLimit)
  ) {
    return {
      ok: false,
      error:
        "policyCoverageLimit must be a finite non-negative number when supplied",
    }
  }

  // 1. Death is always catastrophic — exec review required by regulator.
  if (input.lossType === "death") {
    return {
      ok: true,
      severity: "catastrophic",
      rationale: "lossType='death' is unconditionally catastrophic",
    }
  }

  // 2. Base classification by dollar amount.
  let band = bandByAmount(input.totalAmount)
  let rationale = `totalAmount=${input.totalAmount} bands to ${band}`

  // 3. Coverage-ratio override (slim policy → small claim still total loss).
  if (
    input.policyCoverageLimit !== null &&
    input.policyCoverageLimit !== undefined &&
    input.policyCoverageLimit > 0 &&
    input.totalAmount > 25_000
  ) {
    const ratio = input.totalAmount / input.policyCoverageLimit
    if (ratio > 0.8 && TIER_RANK[band] < TIER_RANK.catastrophic) {
      band = "catastrophic"
      rationale = `coverage ratio ${ratio.toFixed(2)} > 0.80 → catastrophic (override)`
    }
  }

  // 4. Loss-type skew bumps.
  if (input.lossType === "disability" || input.lossType === "medical") {
    const bumped = bumpTier(band, 1)
    if (bumped !== band) {
      rationale += `; lossType='${input.lossType}' bumps to ${bumped}`
      band = bumped
    }
  }

  return { ok: true, severity: band, rationale }
}

/** Test-only — surfaces rank table for ordering tests. */
export const __SEVERITY_INTERNALS = { TIER_RANK, RANK_TO_TIER }
