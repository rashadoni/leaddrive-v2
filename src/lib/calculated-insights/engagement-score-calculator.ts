/**
 * Engagement-score calculator — G3 Phase 6 Block B slice 1.
 *
 * 0..100 composite score reflecting how actively a customer engages
 * across the available channels. Three input signals from G1
 * UnifiedProfile aggregates:
 *
 *   1. RECENCY    — days since lastSeenAt. Higher score for recent
 *                   activity. Decay over 90 days to 0.
 *   2. FREQUENCY  — paid invoice count + bonus for recurring cadence.
 *   3. BREADTH    — count of distinct active channels.
 *
 * Composite weights (slice-1 defaults):
 *   recency 50% / frequency 30% / breadth 20%
 *
 * Each sub-signal normalized to 0..1, then composite scaled to 0..100.
 *
 * Confidence:
 *   - 0 channels + 0 invoices: confidence = 0
 *   - >= 1 signal: confidence = 0.5
 *   - >= 1 channel + >= 1 invoice: confidence = 1.0
 *
 * Slice-3 may swap to a recency-frequency-monetary (RFM) clustering
 * model if reporting demands it.
 *
 * Pure synchronous.
 */
import type { CalculatorInput, CalculatorOutput } from "./types"

const MS_PER_DAY = 24 * 60 * 60 * 1000

/**
 * Days past `lastSeenAt` at which the recency component reaches 0.
 * A customer not seen for 90 days contributes ZERO recency signal.
 */
const RECENCY_DECAY_DAYS = 90

/**
 * Paid-invoice count at which the frequency component saturates to 1.
 * 10+ paid invoices = max frequency credit.
 */
const FREQUENCY_SATURATION_COUNT = 10

/**
 * Active-channel count at which the breadth component saturates to 1.
 * 4+ channels = max breadth credit. NB: 5 source types are defined
 * (contact / lead / mtm_customer / portal_user / web_chat_session),
 * but the slice-1 design caps credit at 4 — a customer touching ALL
 * 5 channels gets the SAME breadth score as one touching 4 channels.
 *
 * This is a deliberate "binary at ≥4" simplification — most real
 * customers exercise 2-3 channels max, and going from "many" to
 * "all" is not meaningfully different for engagement targeting.
 * Slice-2 may revisit (saturate at 5, OR add a per-extra bonus) if
 * customer feedback shows operators want to distinguish "max engaged"
 * from "near-max engaged".
 */
const BREADTH_SATURATION_COUNT = 4

const WEIGHTS = {
  recency: 0.5,
  frequency: 0.3,
  breadth: 0.2,
} as const

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0
  if (n < 0) return 0
  if (n > 1) return 1
  return n
}

export function calculateEngagementScore(
  input: CalculatorInput
): CalculatorOutput {
  const { profile, invoices } = input
  const asOf = input.asOf ?? new Date()

  // ── Recency: linear decay from 1 (today) to 0 (90+ days). ──
  let recency = 0
  if (profile.lastSeenAt instanceof Date) {
    const daysAgo =
      (asOf.getTime() - profile.lastSeenAt.getTime()) / MS_PER_DAY
    recency = clamp01(1 - daysAgo / RECENCY_DECAY_DAYS)
  }

  // ── Frequency: saturating count of paid invoices. ──
  const paidCount = invoices.filter(
    (i) =>
      i.paidAt instanceof Date &&
      Number.isFinite(i.totalAmount) &&
      i.totalAmount > 0
  ).length
  const frequency = clamp01(paidCount / FREQUENCY_SATURATION_COUNT)

  // ── Breadth: saturating count of distinct active channels. ──
  const channelCount = profile.channelsActive.length
  const breadth = clamp01(channelCount / BREADTH_SATURATION_COUNT)

  const composite =
    recency * WEIGHTS.recency +
    frequency * WEIGHTS.frequency +
    breadth * WEIGHTS.breadth

  // Scale 0..1 → 0..100.
  const score = round2(composite * 100)

  // Confidence tiers — see header.
  let confidence: number
  if (channelCount === 0 && paidCount === 0) {
    confidence = 0
  } else if (channelCount > 0 && paidCount > 0) {
    confidence = 1
  } else {
    confidence = 0.5
  }

  return {
    value: score,
    confidence,
    metadata: {
      recency: round2(recency),
      frequency: round2(frequency),
      breadth: round2(breadth),
      paidInvoiceCount: paidCount,
      channelCount,
      composite: round2(composite),
    },
  }
}
