/**
 * Feature extraction — H3 Phase 3 slice 1.
 *
 * Maps a raw record (Deal/Lead/Ticket) onto a deterministic numeric
 * vector that matches the trained model's `featureNames` order.
 *
 * Numeric features:    coerced via `Number()`, NaN → 0.
 * Categorical features: one-hot encoded against the spec's closed
 *                       vocabulary, plus an "other" bucket for unseen
 *                       values (so production records with new
 *                       categories still produce a stable vector size).
 *
 * Pure, synchronous, no I/O.
 */
import type { FieldSpec } from "./types"

/**
 * Compute the canonical `featureNames` list for a spec. The order must
 * stay stable between train and score — that's why this helper is the
 * single source of truth for column ordering.
 */
export function featureNamesFor(specs: readonly FieldSpec[]): string[] {
  const names: string[] = []
  for (const spec of specs) {
    if (spec.kind === "numeric") {
      names.push(spec.field)
    } else {
      for (const value of spec.oneHotValues) {
        names.push(`${spec.field}=${value}`)
      }
      names.push(`${spec.field}=__other__`)
    }
  }
  return names
}

/**
 * Extract one feature vector from a record. Field lookup uses dot-free
 * keys directly off the record object — caller is expected to pass a
 * flat shape (e.g. `{ amount: 12000, source: "web" }`).
 */
export function buildFeatureVector(
  record: Record<string, unknown>,
  specs: readonly FieldSpec[]
): number[] {
  const vec: number[] = []
  for (const spec of specs) {
    if (spec.kind === "numeric") {
      const raw = record[spec.field]
      const n = typeof raw === "number" ? raw : Number(raw)
      // NaN and ±Infinity collapse to 0 — they'd otherwise nuke the
      // entire weight update during gradient descent.
      vec.push(Number.isFinite(n) ? n : 0)
    } else {
      const raw = record[spec.field]
      const value = raw == null ? "" : String(raw)
      let matched = false
      for (const candidate of spec.oneHotValues) {
        if (candidate === value) {
          vec.push(1)
          matched = true
        } else {
          vec.push(0)
        }
      }
      vec.push(matched ? 0 : 1)
    }
  }
  return vec
}

/**
 * Compute the binary label for a training row by checking if the
 * record's `targetField` value is in the model's `positiveValues` set.
 */
export function labelFor(
  record: Record<string, unknown>,
  targetField: string,
  positiveValues: readonly string[]
): 0 | 1 {
  const raw = record[targetField]
  const value = raw == null ? "" : String(raw)
  return positiveValues.includes(value) ? 1 : 0
}
