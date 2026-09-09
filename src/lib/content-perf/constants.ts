/**
 * M10 Content Performance AI — shared constants.
 *
 * Score weights tuned for the 0-100 output range. Email marketing
 * industry benchmarks (B2B SaaS, 2025):
 *   - Strong open rate: ~25-30%
 *   - Strong click-through (per open): ~3-5%
 *   - Bounce rate red flag: > 2%
 *   - Unsubscribe rate red flag: > 0.5%
 *   - Spam complaint red flag: > 0.1%
 *
 * Weights chosen so a "strong" campaign hits ~90, a "median" campaign
 * sits at ~60, and a campaign with bad signals (high bounce / spam)
 * drops below 30 into the warning zone.
 */

export const CONTENT_SCORE_WEIGHTS = {
  /** Starting baseline; add bonuses, subtract penalties.
   *  Asymmetry vs T9 HealthScore baseline (80): T9 says "no signals
   *  = mostly healthy" because customer existence implies relationship
   *  health. Content has no such implication — "no data = unknown",
   *  so the baseline sits at the middle of the range. */
  baseline: 50,

  // ── Open rate ──────────────────────────────────────────────────
  /** Multiplier applied to openRate (0..1). openRate=0.3 → +25.5 */
  openRateBonusMultiplier: 85,
  /** Cap on open bonus to prevent runaway scores when openRate
   *  approaches 1 (synthetic tests / tiny denominators). */
  openRateBonusMax: 30,

  // ── Click rate (per open, not per send) ───────────────────────
  /** clickRate=0.05 → +12.5 */
  clickRateBonusMultiplier: 250,
  clickRateBonusMax: 25,

  // ── Bounce penalty ────────────────────────────────────────────
  /** bounceRate × this → subtracted. bounceRate=0.02 → −1.0,
   *  bounceRate=0.10 → −5.0 (capped at penaltyMax). */
  bounceRatePenaltyMultiplier: 50,
  bounceRatePenaltyMax: 20,

  // ── Unsubscribe penalty ───────────────────────────────────────
  /** unsubscribeRate × this. unsubscribeRate=0.005 → −0.4 */
  unsubscribeRatePenaltyMultiplier: 80,
  unsubscribeRatePenaltyMax: 15,

  // ── Spam penalty — harshest ───────────────────────────────────
  /** spamRate × this. spamRate=0.001 → −0.15, spamRate=0.01 → −1.5 */
  spamRatePenaltyMultiplier: 150,
  spamRatePenaltyMax: 25,

  // ── Recency: stale content less reliable signal ───────────────
  /** Days from now until full penalty applies. */
  recencyPenaltyMaxDays: 180,
  /** Cap on recency penalty. */
  recencyPenaltyMax: 10,

  // ── Sample size: small samples = low confidence ───────────────
  /** Below this many sends, score is heavily dampened toward baseline. */
  minSampleSize: 50,
} as const
