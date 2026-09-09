/**
 * Account engagement score calculator — C5 slice 1.
 *
 * Aggregates intent signals into a 0..100 engagement score with
 * exponential time-decay.
 *
 * Formula:
 *   ageDays = (asOf − signal.occurredAt) / 1 day
 *   decayFactor = 2 ^ (−ageDays / halfLifeDays)
 *   contribution = signal.weight × decayFactor
 *
 *   rawTotal = Σ contribution across all signals
 *   score = min(cap, rawTotal)
 *
 * Decay rationale:
 *   • A form_submission from 14 days ago (default halfLife) contributes
 *     half its weight.
 *   • A form_submission from 28 days ago contributes 1/4 its weight.
 *   • Ancient signals fade naturally without an explicit lookback window.
 *
 * Drops:
 *   • Signals with negative ageDays (occurredAt > asOf) → invalid input,
 *     return ok:false.
 *   • Signals older than 5 × halfLifeDays are dropped from the count
 *     for the `droppedAncientSignals` counter, since contribution
 *     becomes negligible (1/32 of weight). Caller can adjust lookback
 *     via halfLifeDays.
 *
 * Pure synchronous.
 */
import { classifySignal } from "./intent-signal-classifier"
import {
  SIGNAL_CATEGORIES,
  SIGNAL_KINDS,
  type CalculateScoreInput,
  type CalculateScoreResult,
  type ScoreBreakdown,
  type SignalCategory,
} from "./types"

const MS_PER_DAY = 24 * 60 * 60 * 1000
const DEFAULT_HALF_LIFE_DAYS = 14
const DEFAULT_CAP = 100
const ANCIENT_HALF_LIVES = 5 // signals older than 5*halfLife are negligible

function isFiniteDate(d: unknown): d is Date {
  return d instanceof Date && Number.isFinite(d.getTime())
}

function isFiniteNonNegative(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n >= 0
}

export function calculateAccountScore(
  input: CalculateScoreInput
): CalculateScoreResult {
  if (!Array.isArray(input.signals)) {
    return { ok: false, error: "signals must be an array" }
  }
  if (!isFiniteDate(input.asOf)) {
    return { ok: false, error: "asOf must be a finite Date" }
  }
  if (
    input.halfLifeDays !== undefined &&
    (!Number.isFinite(input.halfLifeDays) || input.halfLifeDays <= 0)
  ) {
    return {
      ok: false,
      error: "halfLifeDays must be a positive finite number",
    }
  }
  if (
    input.cap !== undefined &&
    (!Number.isFinite(input.cap) || input.cap <= 0)
  ) {
    return { ok: false, error: "cap must be a positive finite number" }
  }

  const halfLife = input.halfLifeDays ?? DEFAULT_HALF_LIFE_DAYS
  const cap = input.cap ?? DEFAULT_CAP
  const asOfMs = input.asOf.getTime()
  const ancientThresholdMs = asOfMs - halfLife * ANCIENT_HALF_LIVES * MS_PER_DAY

  // Initialize per-category accumulator.
  const byCategory: Record<SignalCategory, number> = {
    passive: 0,
    engaged: 0,
    high_intent: 0,
    third_party: 0,
  }

  let rawTotal = 0
  let signalCount = 0
  let droppedAncientSignals = 0

  for (const sig of input.signals) {
    if (sig === null || typeof sig !== "object") {
      return { ok: false, error: "every signal must be an object" }
    }
    if (!(SIGNAL_KINDS as readonly string[]).includes(sig.signalKind)) {
      return {
        ok: false,
        error: `unknown signalKind "${String(sig.signalKind)}"`,
      }
    }
    if (!isFiniteNonNegative(sig.weight) || sig.weight === 0) {
      return {
        ok: false,
        error: "signal.weight must be a positive finite number",
      }
    }
    if (sig.weight > 100) {
      return {
        ok: false,
        error: `signal.weight ${sig.weight} exceeds max 100`,
      }
    }
    if (!isFiniteDate(sig.occurredAt)) {
      return { ok: false, error: "signal.occurredAt must be a finite Date" }
    }
    const sigMs = sig.occurredAt.getTime()
    if (sigMs > asOfMs) {
      return {
        ok: false,
        error: `signal.occurredAt (${sig.occurredAt.toISOString()}) is in the future relative to asOf`,
      }
    }
    if (sigMs < ancientThresholdMs) {
      droppedAncientSignals++
      continue
    }
    const ageDays = (asOfMs - sigMs) / MS_PER_DAY
    const decay = Math.pow(2, -ageDays / halfLife)
    const contribution = sig.weight * decay

    // Determine category via classifier (safe — kind is already validated).
    const classification = classifySignal({ signalKind: sig.signalKind })
    if (!classification.ok) {
      // Should be unreachable since we validated signalKind above.
      return classification
    }
    byCategory[classification.classification.category] += contribution
    rawTotal += contribution
    signalCount++
  }

  const score = Math.min(cap, Math.round(rawTotal))

  const breakdown: ScoreBreakdown = {
    score,
    byCategory,
    rawTotal,
    signalCount,
    droppedAncientSignals,
  }
  return { ok: true, breakdown }
}

/** Test-only — surfaces decay constants. */
export const __SCORE_INTERNALS = {
  DEFAULT_HALF_LIFE_DAYS,
  DEFAULT_CAP,
  ANCIENT_HALF_LIVES,
}

/** Surface category list for tests / drift guards. */
export { SIGNAL_CATEGORIES }
