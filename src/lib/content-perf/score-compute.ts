/**
 * M10 Content Performance AI — slice-1 pure compute helper.
 *
 * Takes raw aggregation numbers (from Campaign.total* columns or
 * EmailLog roll-up per templateId) and returns a 0-100 score plus
 * the factors breakdown for the UI's "why" panel.
 *
 * Pure: no Prisma, no fetch, no Date.now() (caller passes `now`).
 * Slice-2 cron supplies inputs via batched aggregation queries; tests
 * pin weights + clamps via the exported `CONTENT_SCORE_WEIGHTS`.
 *
 * Sample size guard: when totalSent < `minSampleSize`, the bonuses
 * are scaled DOWN by `sampleSize/minSampleSize` so a 5-send campaign
 * doesn't claim a "strong" score off three opens. Penalties are NOT
 * dampened — even a tiny campaign with 100% bounce gets the bounce
 * penalty in full (it's still a real signal).
 */
import { CONTENT_SCORE_WEIGHTS as W } from "./constants"

export interface ContentPerfInput {
  /** Total emails sent (denominator for open / bounce / unsubscribe / spam). */
  totalSent: number
  /** Unique opens; ratio against totalSent. */
  totalOpened: number
  /** Clicks; ratio against totalOpened (not totalSent — measures
   *  CTR-among-readers, the standard industry metric used by
   *  Salesforce Marketing Cloud / HubSpot reporting). */
  totalClicked: number
  /** Bounces; ratio against totalSent. */
  totalBounced: number
  /** Unsubscribes; ratio against totalSent. */
  totalUnsubscribed: number
  /** Spam complaints; ratio against totalSent. */
  totalSpam: number
  /** When the content was last sent / used. Drives recency penalty. */
  lastSentAt: Date | null
  /** Caller-supplied "now" for test determinism. */
  now: Date
}

export interface ContentPerfResult {
  score: number
  factors: {
    baseline: number
    openRate: number
    clickRate: number
    bounceRate: number
    unsubscribeRate: number
    spamRate: number
    openBonus: number
    clickBonus: number
    bouncePenalty: number
    unsubscribePenalty: number
    spamPenalty: number
    recencyPenalty: number
    sampleSize: number
    sampleSizeFactor: number
  }
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

export function computeContentScore(input: ContentPerfInput): ContentPerfResult {
  const sent = Math.max(0, input.totalSent)

  // Safe ratios — 0 when denominator is 0.
  const openRate = sent === 0 ? 0 : clamp(input.totalOpened / sent, 0, 1)
  const clickRate =
    input.totalOpened === 0
      ? 0
      : clamp(input.totalClicked / input.totalOpened, 0, 1)
  const bounceRate = sent === 0 ? 0 : clamp(input.totalBounced / sent, 0, 1)
  const unsubscribeRate =
    sent === 0 ? 0 : clamp(input.totalUnsubscribed / sent, 0, 1)
  const spamRate = sent === 0 ? 0 : clamp(input.totalSpam / sent, 0, 1)

  // Sample-size dampening factor for BONUSES (not penalties).
  // 0..1 — full credit at sampleSize >= minSampleSize.
  const sampleSizeFactor =
    sent === 0 ? 0 : clamp(sent / W.minSampleSize, 0, 1)

  // Bonuses — open + click (rates × multiplier, capped, × confidence).
  const rawOpenBonus = openRate * W.openRateBonusMultiplier
  const openBonus = clamp(rawOpenBonus, 0, W.openRateBonusMax) * sampleSizeFactor

  const rawClickBonus = clickRate * W.clickRateBonusMultiplier
  const clickBonus = clamp(rawClickBonus, 0, W.clickRateBonusMax) * sampleSizeFactor

  // Penalties — bounce / unsubscribe / spam (rates × multiplier, capped).
  const bouncePenalty = clamp(
    bounceRate * W.bounceRatePenaltyMultiplier,
    0,
    W.bounceRatePenaltyMax,
  )
  const unsubscribePenalty = clamp(
    unsubscribeRate * W.unsubscribeRatePenaltyMultiplier,
    0,
    W.unsubscribeRatePenaltyMax,
  )
  const spamPenalty = clamp(
    spamRate * W.spamRatePenaltyMultiplier,
    0,
    W.spamRatePenaltyMax,
  )

  // Recency — linear 0..max from now → recencyPenaltyMaxDays.
  let recencyPenalty = 0
  if (input.lastSentAt) {
    const ageMs = input.now.getTime() - input.lastSentAt.getTime()
    const ageDays = ageMs / 86_400_000
    const clampedDays = clamp(ageDays, 0, W.recencyPenaltyMaxDays)
    recencyPenalty =
      (clampedDays / W.recencyPenaltyMaxDays) * W.recencyPenaltyMax
  }

  const raw =
    W.baseline +
    openBonus +
    clickBonus -
    bouncePenalty -
    unsubscribePenalty -
    spamPenalty -
    recencyPenalty

  const score = Math.max(0, Math.min(100, Math.round(raw)))

  return {
    score,
    factors: {
      baseline: W.baseline,
      openRate: round2(openRate),
      clickRate: round2(clickRate),
      bounceRate: round2(bounceRate),
      unsubscribeRate: round2(unsubscribeRate),
      spamRate: round2(spamRate),
      openBonus: round2(openBonus),
      clickBonus: round2(clickBonus),
      bouncePenalty: round2(bouncePenalty),
      unsubscribePenalty: round2(unsubscribePenalty),
      spamPenalty: round2(spamPenalty),
      recencyPenalty: round2(recencyPenalty),
      sampleSize: sent,
      sampleSizeFactor: round2(sampleSizeFactor),
    },
  }
}

// Re-export so the slice-2 cron + slice-3 UI can import from one file.
// CONTENT_ENTITY_TYPES re-exported here so the const isn't dead code
// until slice-2 cron lands.
export { CONTENT_SCORE_WEIGHTS } from "./constants"
export { CONTENT_ENTITY_TYPES, type ContentEntityType } from "./types"
