/**
 * A12 velocity-aggregator — slice-1 pure helper.
 *
 * Given a list of stage-duration samples for a (pipeline, stage), compute:
 *   • dealsEntered / dealsExited / dealsAdvanced / dealsRegressed /
 *     dealsLost / dealsWon counts
 *   • avg / p50 / p90 duration percentiles
 *   • conversionRate = dealsAdvanced / dealsEntered
 *   • isBottleneck = p90 > BOTTLENECK_P90_THRESHOLD_SECONDS (30 days)
 *
 * Pure function: no DB.
 *
 * Percentile semantics:
 *   • Computed via linear interpolation on the SORTED samples
 *     (matches NumPy.percentile default behavior).
 *   • NULL when samples array is empty (no exited deals).
 */

import {
  BOTTLENECK_P90_THRESHOLD_SECONDS,
  type StageDurationSample,
  type VelocityPeriodKey,
  type VelocityResult,
} from "./types"

export interface VelocityInput {
  pipelineId: string
  stage: string
  periodKey: VelocityPeriodKey
  samples: ReadonlyArray<StageDurationSample>
  /** Deals that entered the stage during the window — including those still in stage. */
  dealsEntered: number
}

/**
 * Aggregate samples → velocity metrics.
 *
 * Empty samples → all percentiles null, counts zeroed (except dealsEntered
 * which is caller-provided). Conversion rate null when dealsEntered = 0.
 */
export function aggregateVelocity(input: VelocityInput): VelocityResult {
  const { pipelineId, stage, periodKey, samples, dealsEntered } = input

  let advanced = 0
  let regressed = 0
  let lost = 0
  let won = 0
  const durations: number[] = []

  for (const s of samples) {
    if (
      typeof s.durationSeconds !== "number" ||
      !Number.isFinite(s.durationSeconds) ||
      s.durationSeconds < 0
    ) {
      continue // defensive — invalid sample
    }
    durations.push(s.durationSeconds)
    if (s.advanced) advanced += 1
    if (s.regressed) regressed += 1
    if (s.lost) lost += 1
    if (s.won) won += 1
  }

  const dealsExited = durations.length

  const avgDurationSeconds =
    durations.length > 0
      ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
      : null
  const p50DurationSeconds = percentile(durations, 0.5)
  const p90DurationSeconds = percentile(durations, 0.9)

  const conversionRate =
    dealsEntered > 0 ? advanced / dealsEntered : null

  const isBottleneck =
    p90DurationSeconds !== null &&
    p90DurationSeconds > BOTTLENECK_P90_THRESHOLD_SECONDS

  return {
    pipelineId,
    stage,
    periodKey,
    dealsEntered,
    dealsExited,
    dealsAdvanced: advanced,
    dealsRegressed: regressed,
    dealsLost: lost,
    dealsWon: won,
    avgDurationSeconds,
    p50DurationSeconds,
    p90DurationSeconds,
    conversionRate:
      conversionRate === null ? null : roundPct(conversionRate),
    isBottleneck,
  }
}

/**
 * Compute the nth percentile (0..1) of a number array via linear
 * interpolation between the two closest ranks. Returns null on empty.
 *
 * Exported so slice-2 reporting can re-use the same formula on
 * pre-aggregated buckets.
 */
export function percentile(
  samples: ReadonlyArray<number>,
  q: number,
): number | null {
  if (samples.length === 0) return null
  if (samples.length === 1) return Math.round(samples[0])
  const sorted = [...samples].sort((a, b) => a - b)
  const clampedQ = Math.max(0, Math.min(1, q))
  // Linear interpolation: index = q * (n - 1)
  const idx = clampedQ * (sorted.length - 1)
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  if (lo === hi) return Math.round(sorted[lo])
  const fraction = idx - lo
  return Math.round(sorted[lo] + (sorted[hi] - sorted[lo]) * fraction)
}

function roundPct(value: number): number {
  // 4 decimal places: 0.4567 → keep precision for display while avoiding float noise
  return Math.round(value * 10000) / 10000
}
