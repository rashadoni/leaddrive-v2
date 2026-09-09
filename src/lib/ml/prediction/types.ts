/**
 * Einstein Prediction Builder types — H3 Phase 3 slice 1.
 *
 * No-code AutoML on per-tenant org records. A model definition declares
 * the target object, the binary outcome it predicts, and the input
 * feature spec. The trained artifact is a logistic-regression weight
 * vector + bias (slice 1 baseline) — slice 2 swaps the trainer for a
 * Python sidecar without touching this contract.
 */

export type ObjectType = "deal" | "lead" | "ticket"

export type FeatureKind = "numeric" | "categorical"

export interface NumericFieldSpec {
  field: string
  kind: "numeric"
}

export interface CategoricalFieldSpec {
  field: string
  kind: "categorical"
  /** Closed vocabulary — values outside this list are encoded as "other". */
  oneHotValues: string[]
}

export type FieldSpec = NumericFieldSpec | CategoricalFieldSpec

/** Confidence band derived from a probability score. */
export type ConfidenceBand =
  | "very_likely"
  | "likely"
  | "uncertain"
  | "unlikely"
  | "very_unlikely"

export const PREDICTION_ALGORITHM = "logreg-v1" as const

/**
 * Trained artifact stored on `PredictionModel.artifact`. Versioned by
 * `algorithm` — slice 2's sidecar may emit "logreg-v2" or "xgb-v1" and
 * the scorer dispatches accordingly.
 *
 * Feature standardisation (z-scoring) is part of the v1 contract: the
 * trainer computes per-column means + stds from the training set,
 * applies them before fitting, and the scorer re-applies them before
 * inference. Without this, mixed-scale features (e.g. amount in 10000s
 * + probability in 0-100) tank logreg convergence.
 */
export interface PredictionArtifact {
  algorithm: typeof PREDICTION_ALGORITHM
  /** Stable order of feature columns matching `weights[]`. */
  featureNames: string[]
  /** Per-column mean from the training set — used to z-score new records. */
  means: number[]
  /** Per-column std-dev from the training set; zero-std columns store 1 to avoid div-by-zero. */
  stds: number[]
  weights: number[]
  bias: number
  /** Number of records used in training. */
  sampleCount: number
  /** Number of positive-class records (for class-imbalance audit). */
  positiveCount: number
  /** Accuracy on the training set (slice 2 will add holdout/test split). */
  accuracy: number
  trainedAt: string
}

/** Slice 1 training-input row — a record plus its binary label. */
export interface TrainingSample {
  features: number[]
  label: 0 | 1
}

/** Slice 1 training-options block — caller controls regularisation + iteration cap. */
export interface TrainOptions {
  /** L2 regularisation coefficient. Higher = stronger shrinkage. */
  l2: number
  /** Learning rate for batch gradient descent. */
  learningRate: number
  /** Maximum iterations — caps runaway loops on non-separable data. */
  maxIterations: number
  /** Convergence threshold on weight delta L2 norm. */
  tolerance: number
}

export const DEFAULT_TRAIN_OPTIONS: TrainOptions = {
  l2: 0.01,
  learningRate: 0.1,
  maxIterations: 500,
  tolerance: 1e-5,
}
