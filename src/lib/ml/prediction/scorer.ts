/**
 * Scorer — apply a trained artifact to a feature vector. H3 Phase 3 slice 1.
 *
 * Dispatches by `artifact.algorithm` so slice 2's Python-trained
 * artifacts (xgboost / random forest) can plug in here without forcing
 * the train + score code to live in the same process.
 */
import { PREDICTION_ALGORITHM, type ConfidenceBand, type PredictionArtifact } from "./types"

function sigmoid(z: number): number {
  if (z >= 0) {
    const ez = Math.exp(-z)
    return 1 / (1 + ez)
  }
  const ez = Math.exp(z)
  return ez / (1 + ez)
}

/**
 * Score a feature vector with the model's trained artifact. Returns
 * probability of the positive class in [0, 1]. Throws when the vector
 * dimensionality disagrees with the artifact (caller bug — feature
 * spec changed between train and score without retraining).
 */
export function scoreFeatures(artifact: PredictionArtifact, features: readonly number[]): number {
  if (artifact.algorithm !== PREDICTION_ALGORITHM) {
    throw new Error(`Unsupported algorithm "${artifact.algorithm}" (slice 1 only ships ${PREDICTION_ALGORITHM}).`)
  }
  if (features.length !== artifact.weights.length) {
    throw new Error(
      `Feature vector length ${features.length} does not match artifact weights (${artifact.weights.length}). ` +
        `Retrain the model after feature-spec changes.`
    )
  }
  let z = artifact.bias
  for (let j = 0; j < features.length; j++) z += artifact.weights[j] * features[j]
  return sigmoid(z)
}

/**
 * Map a probability score to a coarse confidence band. Thresholds are
 * intentionally stable across all models — the UI sorts and filters by
 * band, so changing the cutoffs is a UX migration, not a math tweak.
 */
export function bandFromScore(score: number): ConfidenceBand {
  if (!Number.isFinite(score)) return "uncertain"
  if (score >= 0.8) return "very_likely"
  if (score >= 0.6) return "likely"
  if (score >= 0.4) return "uncertain"
  if (score >= 0.2) return "unlikely"
  return "very_unlikely"
}
