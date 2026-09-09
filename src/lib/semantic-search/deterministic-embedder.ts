/**
 * Slice-1 deterministic embedder — H13 Phase 3.
 *
 * Token-hash-based pseudo-embedding. Produces a 256-dim float vector
 * by hashing whitespace-split tokens into buckets. Same text → same
 * vector. Tokens with semantic overlap (queries share a word with the
 * indexed content) will share buckets, so the cosine similarity is
 * non-trivially > 0 — enough for end-to-end smoke tests and a working
 * UI in slice 1 without requiring a Voyage API key.
 *
 * **Not** a real embedder — it doesn't understand semantics. Slice 2
 * wires a `VoyageEmbedder` that calls the existing
 * `src/lib/ai/embeddings.ts` Voyage pipeline behind this same DI.
 * Same `model` string ("deterministic-fallback-v1" vs "voyage-3-lite")
 * forces an index migration: rows persisted under the fallback aren't
 * comparable to Voyage queries and the engine should re-embed them.
 */
import { createHash } from "node:crypto"
import type { EmbeddingVector, SemanticEmbedClient } from "./types"

export const DETERMINISTIC_DIM = 256
const MODEL = "deterministic-fallback-v1"

function tokenise(text: string): string[] {
  return text
    .toLowerCase()
    .split(/\s+/g)
    .map(t => t.replace(/[^\p{L}\p{N}_-]/gu, ""))
    .filter(t => t.length > 0)
}

function bucketFor(token: string): number {
  // SHA-256 → first 4 bytes → uint32 → modulo dim.
  const h = createHash("sha256").update(token).digest()
  const n = (h[0] << 24) | (h[1] << 16) | (h[2] << 8) | h[3]
  return Math.abs(n) % DETERMINISTIC_DIM
}

/**
 * Pseudo-embed a string. Counts (capped at 8 per bucket to limit
 * runaway repetition weight), then L2-normalises. Empty input → zero
 * vector (cosine treats as orthogonal — caller already throws on
 * empty content at the engine boundary).
 */
function embedDeterministic(text: string): EmbeddingVector {
  const vec = new Array<number>(DETERMINISTIC_DIM).fill(0)
  const tokens = tokenise(text)
  for (const tok of tokens) {
    const idx = bucketFor(tok)
    if (vec[idx] < 8) vec[idx] += 1
  }
  let mag = 0
  for (let i = 0; i < DETERMINISTIC_DIM; i++) mag += vec[i] * vec[i]
  mag = Math.sqrt(mag)
  if (mag === 0) return vec
  for (let i = 0; i < DETERMINISTIC_DIM; i++) vec[i] /= mag
  return vec
}

export const DeterministicEmbedder: SemanticEmbedClient = {
  model: MODEL,
  async embed(text: string): Promise<EmbeddingVector> {
    return embedDeterministic(text)
  },
}
