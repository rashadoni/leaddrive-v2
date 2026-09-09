/**
 * A12 waterfall-analyzer — slice-1 pure helper.
 *
 * Given a list of stage transitions within a period, bucket them by
 * transitionType and compute net amount delta. Output is the "pipeline
 * waterfall" report: how many deals advanced / regressed / won / lost /
 * etc. between time T1 and T2, and how much $ moved.
 *
 * Pure function: no DB.
 *
 * Amount delta semantics:
 *   • created       — toAmount (deal entered with this value)
 *   • advanced/regressed/reassigned — toAmount - fromAmount (re-pricing during move)
 *   • won           — +toAmount (closed-won deals add to revenue)
 *   • lost          — -toAmount (closed-lost deals remove from pipeline)
 *   • reopened      — toAmount (re-entered pipeline)
 *
 * Net amount delta = sum of all bucket deltas → "did pipeline grow
 * or shrink this period?"
 */

import {
  TRANSITION_TYPES,
  type TransitionType,
  type WaterfallAnalysis,
  type WaterfallBucket,
  type WaterfallTransition,
} from "./types"

export interface WaterfallInput {
  transitions: ReadonlyArray<WaterfallTransition>
  periodStart: Date
  periodEnd: Date
}

/**
 * Build the waterfall analysis. Empty input → all buckets at 0.
 *
 * Transitions outside [periodStart, periodEnd] are dropped before
 * bucketing.
 */
export function analyzeWaterfall(input: WaterfallInput): WaterfallAnalysis {
  const startMs = input.periodStart.getTime()
  const endMs = input.periodEnd.getTime()

  // Initialize all buckets so output is stable regardless of input.
  const bucketMap = new Map<TransitionType, WaterfallBucket>()
  for (const tt of TRANSITION_TYPES) {
    bucketMap.set(tt, {
      transitionType: tt,
      count: 0,
      totalAmountDelta: 0,
      dealIds: [],
    })
  }

  let totalTransitions = 0

  for (const t of input.transitions) {
    const tMs = t.transitionedAt.getTime()
    if (tMs < startMs || tMs > endMs) continue
    if (!TRANSITION_TYPES.includes(t.transitionType)) continue

    const bucket = bucketMap.get(t.transitionType)!
    bucket.count += 1
    bucket.totalAmountDelta += computeAmountDelta(t)
    bucket.dealIds.push(t.dealId)
    totalTransitions += 1
  }

  // Stable order matches TRANSITION_TYPES tuple.
  const buckets: WaterfallBucket[] = []
  let netAmountDelta = 0
  for (const tt of TRANSITION_TYPES) {
    const b = bucketMap.get(tt)!
    // Round delta to 2 decimals for reporting cleanliness.
    b.totalAmountDelta = Math.round(b.totalAmountDelta * 100) / 100
    buckets.push(b)
    netAmountDelta += b.totalAmountDelta
  }

  return {
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    buckets,
    netAmountDelta: Math.round(netAmountDelta * 100) / 100,
    totalTransitions,
  }
}

/**
 * Compute the amount delta for a single transition per the semantics
 * documented in the file header. Exported so slice-2 can reuse for
 * per-deal diff displays.
 */
export function computeAmountDelta(t: WaterfallTransition): number {
  const toAmt = safeAmount(t.toAmount)
  switch (t.transitionType) {
    case "created":
      // Deal entered pipeline with toAmount.
      return toAmt
    case "won":
      // Won deal — pure revenue addition.
      return toAmt
    case "lost":
      // Lost deal — remove from pipeline.
      return -toAmt
    case "reopened":
      // Re-entered pipeline.
      return toAmt
    case "advanced":
    case "regressed":
    case "reassigned": {
      // Re-pricing delta.
      const fromAmt = safeAmount(t.fromAmount)
      return toAmt - fromAmt
    }
    default:
      return 0
  }
}

function safeAmount(value: number | null | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0
  return value
}

/**
 * Pure helper for slice-2: given a waterfall analysis, return only the
 * non-empty buckets sorted by magnitude of impact. Useful for "top
 * movers this week" UI cards.
 */
export function topMovingBuckets(
  analysis: WaterfallAnalysis,
  limit = 3,
): WaterfallBucket[] {
  return [...analysis.buckets]
    .filter((b) => b.count > 0)
    .sort((a, b) => Math.abs(b.totalAmountDelta) - Math.abs(a.totalAmountDelta))
    .slice(0, Math.max(0, limit))
}
