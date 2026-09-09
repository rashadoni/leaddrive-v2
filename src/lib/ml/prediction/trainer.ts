/**
 * Logistic-regression trainer (slice 1 baseline) — H3 Phase 3.
 *
 * Batch gradient descent with L2 regularisation. Deterministic — same
 * input → same weights — so the artifact can be diff-reviewed in code
 * review. No external deps; pure JS math.
 *
 * Slice 2 swaps this for a Python sidecar implementing scikit-learn /
 * XGBoost. The contract (`PredictionArtifact`) stays the same — only
 * the `algorithm` field changes from "logreg-v1".
 *
 * Throws on degenerate inputs (no samples, mismatched dims, single-class
 * training set) — the caller surfaces these as model status "failed".
 */
import {
  DEFAULT_TRAIN_OPTIONS,
  PREDICTION_ALGORITHM,
  type PredictionArtifact,
  type TrainOptions,
  type TrainingSample,
} from "./types"

export interface TrainInput {
  samples: TrainingSample[]
  featureNames: string[]
  options?: Partial<TrainOptions>
}

const MIN_SAMPLES = 10

function sigmoid(z: number): number {
  // Numerically stable: avoid overflow for large positive/negative z.
  if (z >= 0) {
    const ez = Math.exp(-z)
    return 1 / (1 + ez)
  }
  const ez = Math.exp(z)
  return ez / (1 + ez)
}

export function trainLogisticRegression(input: TrainInput): PredictionArtifact {
  const { samples, featureNames } = input
  const opts: TrainOptions = { ...DEFAULT_TRAIN_OPTIONS, ...(input.options ?? {}) }

  if (samples.length < MIN_SAMPLES) {
    throw new Error(`Need at least ${MIN_SAMPLES} training samples (got ${samples.length}).`)
  }
  const dim = featureNames.length
  if (dim === 0) {
    throw new Error("Feature spec is empty — at least one input field required.")
  }
  for (const s of samples) {
    if (s.features.length !== dim) {
      throw new Error(
        `Feature vector length ${s.features.length} does not match spec dimension ${dim}.`
      )
    }
  }
  const positiveCount = samples.reduce((acc, s) => acc + s.label, 0)
  if (positiveCount === 0 || positiveCount === samples.length) {
    throw new Error(
      `Training set has only one class (${positiveCount} positive / ${samples.length} total). ` +
        `Need at least one example of each class to fit a logistic regression.`
    )
  }

  // Initialise weights at zero (logreg with no bias init = 0.5 prob baseline).
  let weights = new Array<number>(dim).fill(0)
  let bias = 0
  const n = samples.length
  const lr = opts.learningRate
  const l2 = opts.l2

  for (let iter = 0; iter < opts.maxIterations; iter++) {
    // Accumulate gradients across all samples.
    const wGrad = new Array<number>(dim).fill(0)
    let bGrad = 0

    for (const sample of samples) {
      let z = bias
      for (let j = 0; j < dim; j++) z += weights[j] * sample.features[j]
      const p = sigmoid(z)
      const err = p - sample.label
      for (let j = 0; j < dim; j++) wGrad[j] += err * sample.features[j]
      bGrad += err
    }

    // L2 regularisation on weights only (not bias).
    const newWeights = new Array<number>(dim)
    let deltaSq = 0
    for (let j = 0; j < dim; j++) {
      const step = lr * (wGrad[j] / n + l2 * weights[j])
      newWeights[j] = weights[j] - step
      deltaSq += step * step
    }
    const bStep = lr * (bGrad / n)
    const newBias = bias - bStep
    deltaSq += bStep * bStep

    weights = newWeights
    bias = newBias

    if (Math.sqrt(deltaSq) < opts.tolerance) break
  }

  // Training-set accuracy.
  let correct = 0
  for (const sample of samples) {
    let z = bias
    for (let j = 0; j < dim; j++) z += weights[j] * sample.features[j]
    const predicted = sigmoid(z) >= 0.5 ? 1 : 0
    if (predicted === sample.label) correct++
  }
  const accuracy = correct / samples.length

  // Identity standardisation defaults — the engine overrides with real
  // per-column stats. Callers that hit `trainLogisticRegression` directly
  // (currently only unit tests on already-standardised data) get a no-op
  // standardiser in the artifact.
  return {
    algorithm: PREDICTION_ALGORITHM,
    featureNames: [...featureNames],
    means: new Array<number>(dim).fill(0),
    stds: new Array<number>(dim).fill(1),
    weights,
    bias,
    sampleCount: samples.length,
    positiveCount,
    accuracy,
    trainedAt: new Date().toISOString(),
  }
}
