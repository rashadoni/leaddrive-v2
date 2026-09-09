/**
 * C9 attribution-model-evaluator — slice-1 pure helper.
 *
 * Given an ordered list of touchpoints + a model type + config, assign
 * per-touchpoint weights that sum to 1.0. This is the core math of the
 * five canonical attribution models.
 *
 * Pure function — no DB, no clock. Touchpoints must be sorted by
 * occurredAt ascending; the helper asserts and re-sorts defensively.
 *
 * Returns an EMPTY array if the input is empty (no touchpoints = no
 * credit). For non-empty inputs, weights always sum to exactly 1.0
 * (within IEEE float rounding — final renormalization step ensures this).
 */

import {
  DEFAULT_TIME_DECAY_HALF_LIFE_DAYS,
  type AttributionModelType,
  type CustomConfig,
  type ModelConfig,
  type TimeDecayConfig,
  type TouchpointForAttribution,
  type TouchpointWeight,
  type UShapedConfig,
} from "./types"

export interface EvaluateInput {
  touchpoints: ReadonlyArray<TouchpointForAttribution>
  modelType: AttributionModelType
  /** Per-modelType config; passed-through verbatim. */
  config?: ModelConfig
  /**
   * The conversion event time (deal closed-won). Used by time_decay to
   * compute touchpoint age. If absent, time_decay falls back to the
   * latest touchpoint's occurredAt as conversion reference.
   */
  conversionAt?: Date
}

/**
 * Evaluate a model on a touchpoint list, returning per-touchpoint weights.
 *
 * Behavior per model:
 *   • first_touch: 100% to earliest touchpoint, 0% to rest.
 *   • last_touch:  100% to latest touchpoint, 0% to rest.
 *   • linear:      1/N to each touchpoint.
 *   • time_decay:  weight ∝ 2^(-ageDays / halfLifeDays); renormalized.
 *   • u_shaped:    firstWeight + lastWeight + (middleWeight spread evenly).
 *                  With 1 touchpoint: all credit goes there.
 *                  With 2 touchpoints: firstWeight + lastWeight (renormalized
 *                  if those don't sum to 1 since no middle exists).
 *   • custom:      piecewise-linear curve over normalized touchpoint position
 *                  (0 = first touch, 1 = conversion). Each touchpoint's raw
 *                  weight = the curve interpolated at its position; renormalized
 *                  to sum 1.0. Falls back to linear only if the curve is absent
 *                  (validator should reject that first).
 */
export function evaluateAttributionModel(
  input: EvaluateInput,
): TouchpointWeight[] {
  const ordered = sortTouchpoints(input.touchpoints)
  if (ordered.length === 0) return []
  switch (input.modelType) {
    case "first_touch":
      return assignFirstTouch(ordered)
    case "last_touch":
      return assignLastTouch(ordered)
    case "linear":
      return assignLinear(ordered)
    case "time_decay":
      return assignTimeDecay(ordered, input.config, input.conversionAt)
    case "u_shaped":
      return assignUShaped(ordered, input.config)
    case "custom":
      return assignCustom(ordered, input.config)
    default:
      return assignLinear(ordered)
  }
}

function sortTouchpoints(
  list: ReadonlyArray<TouchpointForAttribution>,
): TouchpointForAttribution[] {
  // Copy + sort by occurredAt ASC. Stable enough for tied timestamps.
  return [...list].sort(
    (a, b) => a.occurredAt.getTime() - b.occurredAt.getTime(),
  )
}

function assignFirstTouch(
  ordered: TouchpointForAttribution[],
): TouchpointWeight[] {
  return ordered.map((tp, idx) => ({
    touchpointId: tp.touchpointId,
    campaignId: tp.campaignId,
    weight: idx === 0 ? 1 : 0,
  }))
}

function assignLastTouch(
  ordered: TouchpointForAttribution[],
): TouchpointWeight[] {
  const lastIdx = ordered.length - 1
  return ordered.map((tp, idx) => ({
    touchpointId: tp.touchpointId,
    campaignId: tp.campaignId,
    weight: idx === lastIdx ? 1 : 0,
  }))
}

function assignLinear(
  ordered: TouchpointForAttribution[],
): TouchpointWeight[] {
  const share = 1 / ordered.length
  return ordered.map((tp) => ({
    touchpointId: tp.touchpointId,
    campaignId: tp.campaignId,
    weight: share,
  }))
}

function assignTimeDecay(
  ordered: TouchpointForAttribution[],
  config: ModelConfig | undefined,
  conversionAt: Date | undefined,
): TouchpointWeight[] {
  const halfLifeDays =
    config && config.modelType === "time_decay"
      ? (config as TimeDecayConfig).halfLifeDays
      : DEFAULT_TIME_DECAY_HALF_LIFE_DAYS
  const conversionTime =
    conversionAt?.getTime() ??
    ordered[ordered.length - 1].occurredAt.getTime()
  // Raw weight per touchpoint = 2^(-age_days / halfLife).
  const raw = ordered.map((tp) => {
    const ageMs = Math.max(0, conversionTime - tp.occurredAt.getTime())
    const ageDays = ageMs / (24 * 60 * 60 * 1000)
    return Math.pow(2, -ageDays / halfLifeDays)
  })
  return renormalize(ordered, raw)
}

function assignUShaped(
  ordered: TouchpointForAttribution[],
  config: ModelConfig | undefined,
): TouchpointWeight[] {
  // Pull weights from config or defaults (40/20/40).
  let firstW = 0.4
  let lastW = 0.4
  let middleW = 0.2
  if (config && config.modelType === "u_shaped") {
    const c = config as UShapedConfig
    firstW = c.firstWeight
    lastW = c.lastWeight
    middleW = c.middleWeight
  }

  const n = ordered.length
  if (n === 1) {
    return [
      {
        touchpointId: ordered[0].touchpointId,
        campaignId: ordered[0].campaignId,
        weight: 1,
      },
    ]
  }
  if (n === 2) {
    // No middle exists; split firstW + lastW renormalized to 1.0.
    const total = firstW + lastW
    return [
      {
        touchpointId: ordered[0].touchpointId,
        campaignId: ordered[0].campaignId,
        weight: total === 0 ? 0.5 : firstW / total,
      },
      {
        touchpointId: ordered[1].touchpointId,
        campaignId: ordered[1].campaignId,
        weight: total === 0 ? 0.5 : lastW / total,
      },
    ]
  }
  // n >= 3: middle gets middleW spread evenly across the (n-2) middle tps.
  const middleEach = middleW / (n - 2)
  const raw: number[] = ordered.map((_tp, idx) => {
    if (idx === 0) return firstW
    if (idx === n - 1) return lastW
    return middleEach
  })
  // Architect-suggested defense: validator should reject configs whose
  // weights don't sum to 1.0, but a caller bypassing the validator could
  // still hand us bad weights. Renormalize so output always sums to 1.0
  // regardless of input drift. Validator-then-evaluate remains the
  // intended contract; this is defense in depth.
  return renormalize(ordered, raw)
}

/**
 * Custom curve: map each touchpoint's normalized position (0 = first touch,
 * 1 = conversion) through a user-defined piecewise-linear curve, then
 * renormalize so the weights sum to 1.0. The curve is a list of
 * {position ∈ [0,1], weight > 0} control points (validated upstream).
 */
function assignCustom(
  ordered: TouchpointForAttribution[],
  config: ModelConfig | undefined,
): TouchpointWeight[] {
  const curve =
    config && config.modelType === "custom" && Array.isArray((config as CustomConfig).curve)
      ? (config as CustomConfig).curve
      : null
  // No usable curve → defensive linear (validator should have rejected this).
  if (!curve || curve.length === 0) return assignLinear(ordered)

  // Sort control points so interpolation walks left → right.
  const pts = [...curve].sort((a, b) => a.position - b.position)
  const n = ordered.length
  const raw = ordered.map((_tp, idx) => {
    // Single touchpoint sits at position 0; renormalize gives it all the credit.
    const q = n === 1 ? 0 : idx / (n - 1)
    return interpolateCurve(pts, q)
  })
  return renormalize(ordered, raw)
}

/**
 * Piecewise-linear interpolation of a position-sorted curve at query position
 * q ∈ [0,1]. Clamps to the endpoint weight outside the curve's position range.
 */
function interpolateCurve(
  pts: ReadonlyArray<{ position: number; weight: number }>,
  q: number,
): number {
  if (q <= pts[0].position) return pts[0].weight
  const last = pts[pts.length - 1]
  if (q >= last.position) return last.weight
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]
    const b = pts[i + 1]
    if (q >= a.position && q <= b.position) {
      const span = b.position - a.position
      if (span <= 0) return a.weight // coincident positions — take the left point
      return a.weight + (b.weight - a.weight) * ((q - a.position) / span)
    }
  }
  return last.weight // unreachable given the clamps above
}

/**
 * Given raw (positive) weights, scale so they sum to 1.0. Exported so callers
 * (and the custom-curve path above) can re-use it.
 */
export function renormalize(
  ordered: TouchpointForAttribution[],
  rawWeights: number[],
): TouchpointWeight[] {
  const total = rawWeights.reduce((a, b) => a + b, 0)
  if (total <= 0 || !Number.isFinite(total)) {
    // Degenerate — fall back to even split.
    const share = 1 / ordered.length
    return ordered.map((tp) => ({
      touchpointId: tp.touchpointId,
      campaignId: tp.campaignId,
      weight: share,
    }))
  }
  return ordered.map((tp, i) => ({
    touchpointId: tp.touchpointId,
    campaignId: tp.campaignId,
    weight: rawWeights[i] / total,
  }))
}
