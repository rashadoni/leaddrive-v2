/**
 * C9 touchpoint-aggregator — slice-1 pure helper.
 *
 * Given per-touchpoint weights (output of attribution-model-evaluator),
 * collapse to per-campaign credit by summing the touchpoint weights
 * that share a campaignId.
 *
 * Slice-2 worker uses this to convert touchpoint-level weights into
 * the campaign_influences rows it persists.
 *
 * Pure function — no DB.
 */

import type {
  CampaignInfluenceComputed,
  TouchpointWeight,
} from "./types"

/**
 * Aggregate per-touchpoint weights to per-campaign weights.
 *
 * Properties:
 *   • Output sorted by descending weight for stable reporting.
 *   • Campaigns with 0 net weight are omitted (they wouldn't show in UI).
 *   • touchpointCount = number of original touchpoints from that campaign.
 *   • Sum of output weights ≈ sum of input weights (typically 1.0).
 */
export function aggregateByCampaign(
  touchpointWeights: ReadonlyArray<TouchpointWeight>,
): CampaignInfluenceComputed[] {
  if (touchpointWeights.length === 0) return []
  const bucket = new Map<
    string,
    { weight: number; touchpointCount: number }
  >()
  for (const tw of touchpointWeights) {
    const existing = bucket.get(tw.campaignId)
    if (existing) {
      existing.weight += tw.weight
      existing.touchpointCount += 1
    } else {
      bucket.set(tw.campaignId, {
        weight: tw.weight,
        touchpointCount: 1,
      })
    }
  }
  const result: CampaignInfluenceComputed[] = []
  for (const [campaignId, agg] of bucket.entries()) {
    if (agg.weight <= 0) continue
    result.push({
      campaignId,
      weight: agg.weight,
      touchpointCount: agg.touchpointCount,
    })
  }
  // Sort by weight DESC, then campaignId ASC for stable tests.
  result.sort((a, b) => {
    if (b.weight !== a.weight) return b.weight - a.weight
    return a.campaignId.localeCompare(b.campaignId)
  })
  return result
}

/**
 * Sum the weights of all entries — slice-2 worker can use to verify the
 * total is 1.0 (allowing for IEEE float rounding).
 */
export function totalWeight(
  entries: ReadonlyArray<CampaignInfluenceComputed | TouchpointWeight>,
): number {
  let total = 0
  for (const e of entries) total += e.weight
  return total
}
