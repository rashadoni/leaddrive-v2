/**
 * Prediction engine — H3 Phase 3 slice 1.
 *
 * Glues the pure helpers (`features` + `trainer` + `scorer`) into one
 * pair of orchestrators the routes call:
 *
 *   trainPredictionModel({ specs, records, targetField, positiveValues, options? })
 *     → PredictionArtifact
 *
 *   scoreRecord({ artifact, specs, record })
 *     → { score, band }
 *
 * Routes are responsible for DB writes; this module stays I/O-free so
 * the trainer is unit-testable and slice 2 can swap in a Python sidecar
 * without ripping out the routes.
 */
import { buildFeatureVector, featureNamesFor, labelFor } from "./features"
import { bandFromScore, scoreFeatures } from "./scorer"
import { trainLogisticRegression } from "./trainer"
import type {
  ConfidenceBand,
  FieldSpec,
  PredictionArtifact,
  TrainOptions,
  TrainingSample,
} from "./types"

export interface TrainPredictionInput {
  specs: readonly FieldSpec[]
  records: readonly Record<string, unknown>[]
  targetField: string
  positiveValues: readonly string[]
  options?: Partial<TrainOptions>
}

/**
 * Compute per-column means + stds from a feature matrix. Zero-std
 * columns (constant features) store std=1 so the standardiser becomes
 * the identity — keeps gradient descent from dividing by zero on dead
 * columns (e.g. categorical buckets that never appear).
 */
function computeStats(features: readonly number[][], dim: number): { means: number[]; stds: number[] } {
  const n = features.length
  const means = new Array<number>(dim).fill(0)
  for (const row of features) for (let j = 0; j < dim; j++) means[j] += row[j]
  for (let j = 0; j < dim; j++) means[j] /= n

  const stds = new Array<number>(dim).fill(0)
  for (const row of features) {
    for (let j = 0; j < dim; j++) {
      const d = row[j] - means[j]
      stds[j] += d * d
    }
  }
  for (let j = 0; j < dim; j++) {
    const variance = stds[j] / n
    const sd = Math.sqrt(variance)
    stds[j] = sd > 1e-9 ? sd : 1
  }
  return { means, stds }
}

function standardiseRow(row: readonly number[], means: readonly number[], stds: readonly number[]): number[] {
  const out = new Array<number>(row.length)
  for (let j = 0; j < row.length; j++) {
    // Defensive `|| 1` so a future serialiser/Python-sidecar round-trip
    // that drops zero-std safeguards doesn't divide by zero.
    const sd = stds[j] || 1
    out[j] = (row[j] - means[j]) / sd
  }
  return out
}

export function trainPredictionModel(input: TrainPredictionInput): PredictionArtifact {
  const featureNames = featureNamesFor(input.specs)
  const rawFeatures = input.records.map(r => buildFeatureVector(r, input.specs))
  const labels = input.records.map(r => labelFor(r, input.targetField, input.positiveValues))

  const { means, stds } = computeStats(rawFeatures, featureNames.length)

  const samples: TrainingSample[] = rawFeatures.map((row, i) => ({
    features: standardiseRow(row, means, stds),
    label: labels[i],
  }))

  const fit = trainLogisticRegression({
    featureNames,
    samples,
    options: input.options,
  })

  return { ...fit, means, stds }
}

export interface ScoreRecordInput {
  artifact: PredictionArtifact
  specs: readonly FieldSpec[]
  record: Record<string, unknown>
}

export interface ScoredRecord {
  score: number
  band: ConfidenceBand
}

export function scoreRecord(input: ScoreRecordInput): ScoredRecord {
  // Feature-spec drift guard: if the user edited inputFields after the
  // last train, the artifact's weights line up with the OLD column order.
  // Cross-check feature names — `scoreFeatures` only checks length, which
  // misses same-dim/different-vocab swaps (silent prediction corruption).
  const currentNames = featureNamesFor(input.specs)
  if (currentNames.length !== input.artifact.featureNames.length) {
    throw new Error(
      `Feature spec drifted from trained artifact (current ${currentNames.length} columns vs trained ${input.artifact.featureNames.length}). ` +
        `Retrain the model after editing inputFields.`
    )
  }
  for (let j = 0; j < currentNames.length; j++) {
    if (currentNames[j] !== input.artifact.featureNames[j]) {
      throw new Error(
        `Feature spec drifted from trained artifact at column ${j}: ` +
          `current "${currentNames[j]}" vs trained "${input.artifact.featureNames[j]}". Retrain the model.`
      )
    }
  }
  const rawFeatures = buildFeatureVector(input.record, input.specs)
  const standardised = standardiseRow(rawFeatures, input.artifact.means, input.artifact.stds)
  const score = scoreFeatures(input.artifact, standardised)
  return { score, band: bandFromScore(score) }
}

/**
 * Parse + validate the JSON-stored feature spec from a `PredictionModel`
 * row. Keeps the runtime defensive — slice 2's Python sidecar could
 * write back a spec, and we don't want a malformed JSON to crash the
 * scorer with a cryptic shape error.
 */
export function parseFieldSpecs(raw: unknown): FieldSpec[] {
  if (!Array.isArray(raw)) {
    throw new Error("inputFields must be an array")
  }
  const seen = new Set<string>()
  const out: FieldSpec[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") {
      throw new Error("inputFields entry must be an object")
    }
    const obj = entry as Record<string, unknown>
    const field = obj.field
    const kind = obj.kind
    if (typeof field !== "string" || field.length === 0) {
      throw new Error("inputFields entry missing string `field`")
    }
    // Validate kind-specific shape BEFORE the dedupe check so a malformed
    // categorical payload reports its specific error rather than being
    // shadowed by a duplicate-name error when the same bad spec is listed
    // twice.
    let parsedEntry: FieldSpec
    if (kind === "numeric") {
      parsedEntry = { field, kind: "numeric" }
    } else if (kind === "categorical") {
      const vals = obj.oneHotValues
      if (!Array.isArray(vals) || vals.some(v => typeof v !== "string")) {
        throw new Error(`Categorical field "${field}" missing string[] oneHotValues`)
      }
      parsedEntry = { field, kind: "categorical", oneHotValues: vals as string[] }
    } else {
      throw new Error(`Unknown feature kind "${String(kind)}" on field "${field}"`)
    }
    if (seen.has(field)) {
      throw new Error(`Duplicate field "${field}" in inputFields — each field may appear once`)
    }
    seen.add(field)
    out.push(parsedEntry)
  }
  return out
}
