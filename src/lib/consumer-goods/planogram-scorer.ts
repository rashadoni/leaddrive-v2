/**
 * Planogram-compliance scorer — R4 Phase 5 slice 1.
 *
 * Given an expected planogram (facings per SKU + required products +
 * optional share-of-shelf target) and agent-recorded observations
 * from an MTM visit, compute four sub-scores + a weighted 0..100
 * total + a per-rule penalty breakdown for the audit detail UI.
 *
 * Pure synchronous. No I/O. The four sub-scores:
 *
 *   osaScore                  fraction of REQUIRED products present
 *   shareOfShelfScore         actual SoS / expected SoS, capped at 1.0
 *                             (null when expectedShareOfShelf not set)
 *   planogramComplianceScore  per-SKU min(actual, expected) / expected,
 *                             averaged. Over-facing doesn't help.
 *   priceTagAccuracy          correct / total. null when total is 0.
 *
 * Total = weighted sum (default 40/20/30/10). Caller can override
 * weights via the `weights` parameter.
 */
import type {
  AuditObservations,
  PlanogramSpec,
  ScoreBreakdown,
  ScorePenalty,
} from "./types"

export interface ScoreWeights {
  osa: number
  shareOfShelf: number
  planogramCompliance: number
  priceTagAccuracy: number
}

export const DEFAULT_SCORE_WEIGHTS: ScoreWeights = {
  osa: 40,
  shareOfShelf: 20,
  planogramCompliance: 30,
  priceTagAccuracy: 10,
}

export interface ScorePlanogramInput {
  spec: PlanogramSpec
  observations: AuditObservations
  weights?: Partial<ScoreWeights>
}

export function scorePlanogram(input: ScorePlanogramInput): ScoreBreakdown {
  const { spec, observations } = input
  const weights = { ...DEFAULT_SCORE_WEIGHTS, ...(input.weights ?? {}) }
  const penalties: ScorePenalty[] = []

  // OSA: required products present / required products total.
  let osaScore: number
  if (spec.requiredProducts.length === 0) {
    osaScore = 1
  } else {
    const presentSet = new Set(observations.productsPresent)
    const missingRequired = spec.requiredProducts.filter(sku => !presentSet.has(sku))
    osaScore = (spec.requiredProducts.length - missingRequired.length) / spec.requiredProducts.length
    for (const sku of missingRequired) {
      penalties.push({
        code: "missing_required_product",
        message: `Required product "${sku}" is not on shelf`,
        weight: weights.osa / spec.requiredProducts.length,
      })
    }
  }

  // Share-of-Shelf: actual SoS = our facings / total facings.
  // Score = min(actual / expected, 1). Null when expected not set.
  let shareOfShelfScore: number | null = null
  if (spec.expectedShareOfShelf != null && spec.expectedShareOfShelf > 0) {
    const ourFacings = Object.values(observations.facingsByProduct).reduce(
      (sum, n) => sum + (Number.isFinite(n) ? n : 0),
      0
    )
    const total = observations.totalShelfFacings
    if (total != null && total > 0) {
      const actualSoS = ourFacings / total
      shareOfShelfScore = Math.min(actualSoS / spec.expectedShareOfShelf, 1)
      if (actualSoS < spec.expectedShareOfShelf) {
        penalties.push({
          code: "share_of_shelf_below_target",
          message: `Share-of-shelf ${(actualSoS * 100).toFixed(1)}% < target ${(spec.expectedShareOfShelf * 100).toFixed(1)}%`,
          weight: weights.shareOfShelf * (1 - shareOfShelfScore),
        })
      }
    } else {
      // Expected set but total not measured — caller bug. Treat as 0.
      shareOfShelfScore = 0
      penalties.push({
        code: "share_of_shelf_unmeasured",
        message: "totalShelfFacings not recorded — share-of-shelf cannot be computed",
        weight: weights.shareOfShelf,
      })
    }
  }

  // Planogram compliance: per-SKU min(actual, expected) / expected,
  // averaged. Over-facing earns no bonus (capped at 1.0 per SKU).
  let planogramComplianceScore = 1
  const expectedSkus = Object.keys(spec.facingsByProduct)
  if (expectedSkus.length > 0) {
    let sum = 0
    for (const sku of expectedSkus) {
      const expected = spec.facingsByProduct[sku] ?? 0
      if (expected <= 0) continue
      const actual = Number.isFinite(observations.facingsByProduct[sku])
        ? observations.facingsByProduct[sku]
        : 0
      const skuScore = Math.min(actual / expected, 1)
      sum += skuScore
      if (actual < expected) {
        penalties.push({
          code: "insufficient_facings",
          message: `"${sku}": ${actual} facings (expected ${expected})`,
          weight: (weights.planogramCompliance / expectedSkus.length) * (1 - skuScore),
        })
      }
    }
    planogramComplianceScore = sum / expectedSkus.length
  }

  // Price-tag accuracy. Defensively clamp `priceTagsCorrect` to
  // `priceTagsTotal` — the route enforces the invariant for user-
  // facing POSTs, but a future internal worker / direct-Prisma write
  // could persist a broken observation. Better to score conservatively
  // than to emit a > 1.0 fraction that breaks the weighted total.
  let priceTagAccuracy: number | null = null
  if (observations.priceTagsTotal > 0) {
    const correctClamped = Math.min(
      observations.priceTagsCorrect,
      observations.priceTagsTotal
    )
    priceTagAccuracy = correctClamped / observations.priceTagsTotal
    if (priceTagAccuracy < 1) {
      const wrong = observations.priceTagsTotal - correctClamped
      penalties.push({
        code: "price_tag_inaccurate",
        message: `${wrong} of ${observations.priceTagsTotal} price tags incorrect`,
        weight: weights.priceTagAccuracy * (1 - priceTagAccuracy),
      })
    }
    if (observations.priceTagsCorrect > observations.priceTagsTotal) {
      penalties.push({
        code: "price_tag_count_inconsistent",
        message: `priceTagsCorrect (${observations.priceTagsCorrect}) > priceTagsTotal (${observations.priceTagsTotal}); clamped`,
        weight: 0,
      })
    }
  }

  // Weighted total. Sub-scores that are null (e.g. shareOfShelf when
  // expected not set, priceTagAccuracy when no tags inspected) drop
  // out of both numerator and denominator so the total stays on a
  // 0..100 scale rather than penalising for unmeasured-by-design.
  let weightSum = weights.osa + weights.planogramCompliance
  let weighted = osaScore * weights.osa + planogramComplianceScore * weights.planogramCompliance
  if (shareOfShelfScore != null) {
    weighted += shareOfShelfScore * weights.shareOfShelf
    weightSum += weights.shareOfShelf
  }
  if (priceTagAccuracy != null) {
    weighted += priceTagAccuracy * weights.priceTagAccuracy
    weightSum += weights.priceTagAccuracy
  }
  const totalScore = weightSum > 0 ? (weighted / weightSum) * 100 : 0

  return {
    osaScore,
    shareOfShelfScore,
    planogramComplianceScore,
    priceTagAccuracy,
    totalScore,
    penalties,
  }
}
