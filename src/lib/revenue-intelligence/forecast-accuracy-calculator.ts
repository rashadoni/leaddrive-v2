/**
 * A12 forecast-accuracy-calculator — slice-1 pure helper.
 *
 * Given a captured forecast snapshot + the actual won amount for the
 * period, compute variance metrics + classify accuracy.
 *
 * Pure function: no DB.
 *
 * Variance definitions (positive = over-delivered):
 *   variance_abs   = actual - forecasted
 *   variance_pct   = variance_abs / forecasted   (null when forecasted = 0)
 *
 * Accuracy class (per `forecast vs actual`):
 *   accurate         — |variance_pct| ≤ tolerance (default 5%)
 *   over_delivered   — variance_pct > +tolerance
 *   under_delivered  — variance_pct < -tolerance
 *   unknown          — forecast was 0 (insufficient data)
 *
 * The class is computed against the **forecast** bucket (probability-
 * weighted), not committed or best-case. Committed/best-case variances
 * are computed in parallel but don't drive classification — they're
 * for operators to spot sandbagging (over-committed sandbaggers) or
 * sales-leadership tuning (best-case wildly off → coaching).
 *
 * State-machine helpers + state guards also exported (mirror DB CHECK).
 */

import {
  ACCURACY_CLASSES,
  DEFAULT_ACCURACY_TOLERANCE,
  FORECAST_SCOPES,
  TRANSITION_TYPES,
  VELOCITY_PERIOD_KEYS,
  type AccuracyClass,
  type AccuracyInput,
  type AccuracyResult,
  type ForecastScope,
  type TransitionType,
  type VelocityPeriodKey,
} from "./types"

/**
 * Compute the accuracy report from a snapshot + actual.
 *
 * Defensive behaviors:
 *   • Negative actualAmount clamped to 0 (won deals can't be negative).
 *   • NaN/Infinity forecasted → variance_pct = null, class = unknown.
 *   • Tolerance clamped to [0, 1] (defaults if invalid).
 */
export function calculateForecastAccuracy(
  input: AccuracyInput,
): AccuracyResult {
  const { snapshot, actualAmount } = input
  const tolerance = clampTolerance(input.tolerance)

  const actual = safeNonNeg(actualAmount)
  const forecasted = safeNonNeg(snapshot.forecastAmount)
  const committed = safeNonNeg(snapshot.committedAmount)
  const bestCase = safeNonNeg(snapshot.bestCaseAmount)

  const varianceAbsForecast = round2(actual - forecasted)
  const varianceAbsCommitted = round2(actual - committed)
  const varianceAbsBestCase = round2(actual - bestCase)

  const variancePctForecast = pctOrNull(actual - forecasted, forecasted)
  const variancePctCommitted = pctOrNull(actual - committed, committed)
  const variancePctBestCase = pctOrNull(actual - bestCase, bestCase)

  let accuracyClass: AccuracyClass = "unknown"
  if (variancePctForecast !== null) {
    if (Math.abs(variancePctForecast) <= tolerance) {
      accuracyClass = "accurate"
    } else if (variancePctForecast > 0) {
      accuracyClass = "over_delivered"
    } else {
      accuracyClass = "under_delivered"
    }
  }

  return {
    actualAmount: actual,
    forecastedAmount: forecasted,
    committedAmount: committed,
    bestCaseAmount: bestCase,
    varianceAbsForecast,
    varianceAbsCommitted,
    varianceAbsBestCase,
    variancePctForecast,
    variancePctCommitted,
    variancePctBestCase,
    accuracyClass,
  }
}

function pctOrNull(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(denominator) || denominator === 0) return null
  return round4(numerator / denominator)
}

function round2(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.round(value * 100) / 100
}

function round4(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.round(value * 10000) / 10000
}

function safeNonNeg(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0
  return value
}

function clampTolerance(value: number | undefined): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 1
  ) {
    return DEFAULT_ACCURACY_TOLERANCE
  }
  return value
}

// ── Type guards (mirror DB CHECK constraints) ───────────────────

export function isAccuracyClass(value: unknown): value is AccuracyClass {
  return (
    typeof value === "string" &&
    ACCURACY_CLASSES.includes(value as AccuracyClass)
  )
}

export function isForecastScope(value: unknown): value is ForecastScope {
  return (
    typeof value === "string" &&
    FORECAST_SCOPES.includes(value as ForecastScope)
  )
}

export function isTransitionType(value: unknown): value is TransitionType {
  return (
    typeof value === "string" &&
    TRANSITION_TYPES.includes(value as TransitionType)
  )
}

export function isVelocityPeriodKey(
  value: unknown,
): value is VelocityPeriodKey {
  return (
    typeof value === "string" &&
    VELOCITY_PERIOD_KEYS.includes(value as VelocityPeriodKey)
  )
}
