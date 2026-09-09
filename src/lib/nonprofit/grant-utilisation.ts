/**
 * Grant utilisation calculator — R9 Phase 5 slice 1.
 *
 * Given a grant row, compute:
 *   - disbursed % of awarded
 *   - spent % of disbursed
 *   - overall utilisation (spent / awarded)
 *   - remaining funds available to spend
 *   - pending disbursement (still to be drawn from funder)
 *   - days remaining in the period of performance
 *   - at-risk flag: spent significantly behind elapsed period
 *
 * Pure synchronous. No I/O.
 */
import type { GrantRow, GrantUtilisation } from "./types"

export interface ComputeGrantUtilisationInput {
  grant: GrantRow
  /**
   * Reference timestamp for "today" — defaults to now. Tests inject
   * a fixed clock for determinism.
   */
  asOf?: Date
  /**
   * At-risk threshold: grant is flagged when spent% lags elapsed%
   * by more than this margin (e.g. 0.2 = 20 pp behind). Default 0.2.
   */
  atRiskMargin?: number
}

const DEFAULT_AT_RISK_MARGIN = 0.2
const MS_PER_DAY = 86_400_000

export function computeGrantUtilisation(
  input: ComputeGrantUtilisationInput
): GrantUtilisation {
  const { grant } = input
  const asOf = input.asOf ?? new Date()
  const atRiskMargin = input.atRiskMargin ?? DEFAULT_AT_RISK_MARGIN

  // Defensive — clamp negative storage corruption to 0 so the math
  // doesn't produce negative percentages.
  const awarded = Math.max(grant.awardedAmount, 0)
  const disbursed = Math.max(Math.min(grant.disbursedAmount, awarded), 0)
  const spent = Math.max(Math.min(grant.spentAmount, disbursed), 0)

  const disbursedPct = awarded === 0 ? null : disbursed / awarded
  const spentPct = disbursed === 0 ? null : spent / disbursed
  const overallUtilisationPct = awarded === 0 ? null : spent / awarded
  const remainingFunds = disbursed - spent
  const pendingDisbursement = awarded - disbursed

  let daysRemainingInPeriod: number | null = null
  let atRisk = false
  if (grant.periodEnd && grant.periodEnd instanceof Date) {
    const msRemaining = grant.periodEnd.getTime() - asOf.getTime()
    daysRemainingInPeriod = Math.floor(msRemaining / MS_PER_DAY)

    // At-risk check: compute "expected utilisation" as elapsed-fraction
    // of the period. If spent% lags expected% by > atRiskMargin AND
    // there's still period left, flag.
    if (grant.periodStart && grant.periodStart instanceof Date) {
      const totalMs = grant.periodEnd.getTime() - grant.periodStart.getTime()
      const elapsedMs = Math.max(0, Math.min(asOf.getTime() - grant.periodStart.getTime(), totalMs))
      const elapsedFraction = totalMs > 0 ? elapsedMs / totalMs : 0
      const actualUtilisation = overallUtilisationPct ?? 0
      if (
        msRemaining > 0 && // still in-period
        grant.status === "active" &&
        elapsedFraction - actualUtilisation > atRiskMargin
      ) {
        atRisk = true
      }
    }
  }

  return {
    disbursedPct,
    spentPct,
    overallUtilisationPct,
    remainingFunds,
    pendingDisbursement,
    daysRemainingInPeriod,
    atRisk,
  }
}
