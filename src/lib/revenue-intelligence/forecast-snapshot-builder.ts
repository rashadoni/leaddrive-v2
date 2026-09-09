/**
 * A12 forecast-snapshot-builder — slice-1 pure helper.
 *
 * Given a list of active deals + stage probability map + period window,
 * compute the three forecast buckets:
 *   • committed    — deals at stages with probability >= COMMITTED_PROBABILITY_THRESHOLD
 *   • best-case    — deals at stages with probability >= BEST_CASE_PROBABILITY_THRESHOLD
 *   • forecast     — probability-weighted sum (deal.amount * stage.probability)
 *
 * Pure function: no DB, no clock.
 *
 * Filters applied:
 *   • Deals closed (WON/LOST) before period start → excluded (historical).
 *   • Deals with expectedCloseAt outside [periodStart, periodEnd] → excluded.
 *   • Deals at unknown stages → excluded (defensive, slice-2 logs warning).
 *   • Negative amounts → clamped to 0 (defensive).
 */

import {
  BEST_CASE_PROBABILITY_THRESHOLD,
  COMMITTED_PROBABILITY_THRESHOLD,
  type DealForSnapshot,
  type SnapshotBuildResult,
  type StageProbabilityMap,
} from "./types"

export interface SnapshotBuildInput {
  deals: ReadonlyArray<DealForSnapshot>
  stageProbabilities: StageProbabilityMap
  periodStart: Date
  periodEnd: Date
  /** Optional asOf for "exclude deals closed before this date" check. Default = periodStart. */
  asOf?: Date
}

/**
 * Build a forecast snapshot from a deal stream.
 *
 * Best-case ALWAYS dominates committed (best-case includes committed
 * deals by design). DB CHECK constraint enforces this invariant.
 */
export function buildForecastSnapshot(
  input: SnapshotBuildInput,
): SnapshotBuildResult {
  const { deals, stageProbabilities, periodStart, periodEnd } = input
  const periodStartMs = periodStart.getTime()
  const periodEndMs = periodEnd.getTime()

  let committedAmount = 0
  let bestCaseAmount = 0
  let forecastAmount = 0
  let dealsCommitted = 0
  let dealsBestCase = 0
  let dealsTotal = 0
  let dealsExcluded = 0

  for (const deal of deals) {
    // 1. Closed-before-period → exclude (historical).
    if (deal.closedAt && deal.closedAt.getTime() < periodStartMs) {
      dealsExcluded += 1
      continue
    }
    // 2. Out-of-period (expectedCloseAt set + outside window).
    if (deal.expectedCloseAt) {
      const ecMs = deal.expectedCloseAt.getTime()
      if (ecMs < periodStartMs || ecMs > periodEndMs) {
        dealsExcluded += 1
        continue
      }
    }
    // 3. Unknown stage → exclude.
    if (!Object.prototype.hasOwnProperty.call(stageProbabilities, deal.stage)) {
      dealsExcluded += 1
      continue
    }
    const probability = stageProbabilities[deal.stage]
    if (
      typeof probability !== "number" ||
      !Number.isFinite(probability) ||
      probability < 0 ||
      probability > 1
    ) {
      dealsExcluded += 1
      continue
    }
    // 4. Defensive amount clamp.
    const amount =
      typeof deal.amount === "number" &&
      Number.isFinite(deal.amount) &&
      deal.amount > 0
        ? deal.amount
        : 0

    dealsTotal += 1
    forecastAmount += amount * probability
    if (probability >= BEST_CASE_PROBABILITY_THRESHOLD) {
      bestCaseAmount += amount
      dealsBestCase += 1
      if (probability >= COMMITTED_PROBABILITY_THRESHOLD) {
        committedAmount += amount
        dealsCommitted += 1
      }
    }
  }

  return {
    committedAmount: round2(committedAmount),
    bestCaseAmount: round2(bestCaseAmount),
    forecastAmount: round2(forecastAmount),
    dealsCommitted,
    dealsBestCase,
    dealsTotal,
    dealsExcluded,
  }
}

/**
 * Round to 2 decimal places — money values shouldn't carry float-noise
 * in reporting columns. Exported so slice-2 can re-use for variance.
 */
export function round2(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.round(value * 100) / 100
}
