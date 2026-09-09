/**
 * Cosine similarity + top-K ranking — H13 Phase 3 slice 1.
 *
 * Pure number-crunching helpers. No I/O. Used by the engine to score
 * candidate rows against a query embedding.
 *
 * Cosine is preferred over raw dot product because our embedder doesn't
 * guarantee L2-normalised output — Voyage (slice 2 backend) returns
 * unit vectors, but the slice-1 deterministic fallback doesn't, so the
 * helper divides by the product of magnitudes.
 */
import type { EmbeddingVector } from "./types"

/**
 * Thrown when two vectors disagree on dimension. Subclassed so the
 * `topK` defensive path can identify it via `instanceof` instead of
 * regex-matching the message string — survives a future error-message
 * rewording without silently breaking the defensive filter.
 */
export class DimMismatchError extends Error {
  constructor(a: number, b: number) {
    super(`Cosine similarity dim mismatch: ${a} vs ${b} — re-index after model change.`)
    this.name = "DimMismatchError"
  }
}

/**
 * Cosine similarity in [-1, 1]. Returns 0 for either-side zero vectors
 * (treats them as orthogonal — safer than throwing because production
 * embedders may emit all-zero vectors for empty input).
 */
export function cosineSimilarity(a: EmbeddingVector, b: EmbeddingVector): number {
  if (a.length === 0 || b.length === 0) return 0
  if (a.length !== b.length) {
    throw new DimMismatchError(a.length, b.length)
  }
  let dot = 0
  let magA = 0
  let magB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    magA += a[i] * a[i]
    magB += b[i] * b[i]
  }
  if (magA === 0 || magB === 0) return 0
  return dot / (Math.sqrt(magA) * Math.sqrt(magB))
}

export interface ScoredCandidate<T> {
  item: T
  similarity: number
}

/**
 * Score every candidate against the query, sort by similarity (desc),
 * drop below threshold, return top `limit`. Stable on equal similarity
 * (preserves input order for tie-breaking — keeps results reproducible).
 *
 * Defensive on dim-mismatch: a single corrupted DB row (or one written
 * under an old embedder version not yet purged) would otherwise throw
 * from inside the .map and 500 the entire search. Mis-dimensioned
 * candidates are scored as `-Infinity` and naturally filtered out by
 * any sane threshold (default 0). Other unexpected errors propagate.
 */
export function topK<T>(
  query: EmbeddingVector,
  candidates: readonly { embedding: EmbeddingVector; item: T }[],
  limit: number,
  threshold = 0
): ScoredCandidate<T>[] {
  const scored: { item: T; similarity: number; idx: number }[] = candidates.map((c, idx) => {
    let similarity: number
    try {
      similarity = cosineSimilarity(query, c.embedding)
    } catch (e) {
      // Only swallow dim-mismatch (via sentinel class, not string match)
      // so the defensive filter survives an error-message rewording.
      // Other errors propagate — genuine engine bugs shouldn't be masked.
      if (e instanceof DimMismatchError) {
        similarity = -Infinity
      } else {
        throw e
      }
    }
    return { item: c.item, similarity, idx }
  })
  return scored
    .filter(s => s.similarity >= threshold)
    .sort((a, b) => {
      if (b.similarity !== a.similarity) return b.similarity - a.similarity
      return a.idx - b.idx // stable on ties
    })
    .slice(0, limit)
    .map(({ item, similarity }) => ({ item, similarity }))
}
