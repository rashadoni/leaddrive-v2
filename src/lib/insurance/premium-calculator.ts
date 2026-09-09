/**
 * Premium calculator — R7 slice 1.
 *
 * Computes an indicative annual premium for a candidate policy. This
 * is INDICATIVE, not the final bound premium — slice-2 rating engine
 * incorporates underwriter-specific factors (motor-vehicle reports,
 * credit-based insurance scoring, claims history, etc.).
 *
 * Formula (slice-1):
 *   totalCoveragePremium = coverageLimit × baseRate(lineOfBusiness) × termYears
 *   riskMultiplier       = riskTierMultiplier(riskTier)
 *   deductibleCredit     = deductible × deductibleCreditRate(lineOfBusiness)
 *   annualPremium        = max(0, totalCoveragePremium × riskMultiplier − deductibleCredit)
 *                            ÷ termYears
 *
 *   breakdown.basePremium  = totalCoveragePremium / termYears       (annualized)
 *   breakdown.deductibleCredit = deductibleCredit / termYears        (annualized)
 *   breakdown.annualPremium    = annualPremium (annualized)
 *
 * Where:
 *   baseRate (per $1 of coverage per year):
 *     auto       — 0.0150  (1.50% of coverage)
 *     home       — 0.0080
 *     life       — 0.0020  (much lower — actuarial)
 *     health     — 0.0250
 *     commercial — 0.0120
 *     umbrella   — 0.0010  (very thin layer over base liability)
 *     marine     — 0.0140
 *
 *   riskTierMultiplier:
 *     preferred  — 0.80
 *     standard   — 1.00
 *     substandard — 1.40
 *     declined   — N/A (returns ok:false)
 *
 *   deductibleCreditRate (per $1 of deductible):
 *     auto / home / commercial / marine — 0.10 ($1000 deductible → $100 credit)
 *     life / health / umbrella — 0  (no deductible credit applicable)
 *
 * Numbers chosen to give plausible quotes for testing; slice-2 wires
 * tenant-configurable rate tables.
 */
import {
  LINES_OF_BUSINESS,
  RISK_TIERS,
  type CalculatePremiumInput,
  type CalculatePremiumResult,
  type LineOfBusiness,
  type RiskTier,
} from "./types"

const BASE_RATES: Readonly<Record<LineOfBusiness, number>> = {
  auto: 0.015,
  home: 0.008,
  life: 0.002,
  health: 0.025,
  commercial: 0.012,
  umbrella: 0.001,
  marine: 0.014,
}

const RISK_MULTIPLIERS: Readonly<Record<RiskTier, number>> = {
  preferred: 0.8,
  standard: 1.0,
  substandard: 1.4,
  declined: NaN, // sentinel — caller branch returns ok:false before lookup
}

const DEDUCTIBLE_CREDIT_RATES: Readonly<Record<LineOfBusiness, number>> = {
  auto: 0.1,
  home: 0.1,
  commercial: 0.1,
  marine: 0.1,
  life: 0,
  health: 0,
  umbrella: 0,
}

function isLineOfBusiness(v: unknown): v is LineOfBusiness {
  return (
    typeof v === "string" &&
    (LINES_OF_BUSINESS as readonly string[]).includes(v)
  )
}

function isRiskTier(v: unknown): v is RiskTier {
  return typeof v === "string" && (RISK_TIERS as readonly string[]).includes(v)
}

function isFiniteNonNegative(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n >= 0
}

export function calculatePremium(
  input: CalculatePremiumInput
): CalculatePremiumResult {
  if (!isLineOfBusiness(input.lineOfBusiness)) {
    return {
      ok: false,
      error: `unknown lineOfBusiness "${String(input.lineOfBusiness)}"`,
    }
  }
  if (!isRiskTier(input.riskTier)) {
    return { ok: false, error: `unknown riskTier "${String(input.riskTier)}"` }
  }
  if (input.riskTier === "declined") {
    return { ok: false, error: "riskTier='declined' — applicant uninsurable" }
  }
  if (!isFiniteNonNegative(input.coverageLimit)) {
    return {
      ok: false,
      error: "coverageLimit must be a finite non-negative number",
    }
  }
  if (
    input.deductible !== undefined &&
    !isFiniteNonNegative(input.deductible)
  ) {
    return {
      ok: false,
      error: "deductible must be a finite non-negative number when supplied",
    }
  }
  if (
    !Number.isFinite(input.termYears) ||
    input.termYears <= 0 ||
    !Number.isInteger(input.termYears)
  ) {
    return { ok: false, error: "termYears must be a positive integer" }
  }
  if (
    input.multiplierOverride !== undefined &&
    (!Number.isFinite(input.multiplierOverride) ||
      input.multiplierOverride < 0)
  ) {
    return {
      ok: false,
      error: "multiplierOverride must be a finite non-negative number",
    }
  }

  const baseRate = BASE_RATES[input.lineOfBusiness]
  const totalCoveragePremium = input.coverageLimit * baseRate * input.termYears
  const riskMultiplier =
    input.multiplierOverride !== undefined
      ? input.multiplierOverride
      : RISK_MULTIPLIERS[input.riskTier]
  const deductible = input.deductible ?? 0
  const deductibleCredit =
    deductible * DEDUCTIBLE_CREDIT_RATES[input.lineOfBusiness]
  const adjustedTotal = totalCoveragePremium * riskMultiplier
  const totalAfterCredit = Math.max(0, adjustedTotal - deductibleCredit)
  // Annual premium = total / term years.
  const annualPremium = totalAfterCredit / input.termYears

  return {
    ok: true,
    breakdown: {
      basePremium: totalCoveragePremium / input.termYears,
      riskMultiplier,
      deductibleCredit: deductibleCredit / input.termYears,
      annualPremium,
    },
  }
}

/** Test-only — surfaces rate tables for drift guards. */
export const __PREMIUM_INTERNALS = {
  BASE_RATES,
  RISK_MULTIPLIERS,
  DEDUCTIBLE_CREDIT_RATES,
}
