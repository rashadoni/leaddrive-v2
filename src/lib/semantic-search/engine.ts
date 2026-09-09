/**
 * Semantic search engine — H13 Phase 3 slice 1.
 *
 * Two pure orchestrators glued to the embedder DI:
 *   embedAndHashContent  — produce vector + SHA-256 hash for index path
 *   rankCandidates        — score + threshold + top-K against candidate rows
 *
 * Both are testable without DB or network: tests inject a deterministic
 * embedder and pre-built candidate arrays. Routes wrap them with the
 * actual Prisma reads/writes.
 */
import { createHash } from "node:crypto"
import { topK } from "./similarity"
import { ALL_RECORD_TYPES } from "./types"
import type {
  CandidateRow,
  EmbeddingVector,
  RecordType,
  SearchHit,
  SearchResult,
  SemanticEmbedClient,
} from "./types"

/** SHA-256 hex of the embedded content — re-index path skips unchanged. */
export function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex")
}

export interface EmbedAndHashResult {
  embedding: EmbeddingVector
  contentHash: string
  model: string
}

/**
 * Produce the (embedding, hash) pair for a piece of content. Caller
 * persists both — `contentHash` lets the next re-index skip if the
 * content hasn't changed.
 */
export async function embedAndHashContent(
  embedder: SemanticEmbedClient,
  content: string
): Promise<EmbedAndHashResult> {
  const trimmed = content.trim()
  if (!trimmed) {
    throw new Error("Cannot embed empty content")
  }
  const embedding = await embedder.embed(trimmed)
  if (!Array.isArray(embedding) || embedding.length === 0) {
    throw new Error(`Embedder returned invalid vector (length ${embedding?.length ?? "?"})`)
  }
  return {
    embedding,
    contentHash: hashContent(trimmed),
    model: embedder.model,
  }
}

export interface RankInput {
  queryEmbedding: EmbeddingVector
  candidates: readonly CandidateRow[]
  limit: number
  threshold: number
}

const DEFAULT_LIMIT = 20
const DEFAULT_THRESHOLD = 0

/**
 * Rank a fetched candidate set against a query embedding. Builds the
 * per-type breakdown for facet rendering and produces a typed
 * `SearchResult`. Pure — caller fetched the candidates.
 */
export function rankCandidates(input: RankInput): SearchResult {
  const limit = input.limit > 0 ? input.limit : DEFAULT_LIMIT
  const threshold = Number.isFinite(input.threshold) ? input.threshold : DEFAULT_THRESHOLD

  const scored = topK(
    input.queryEmbedding,
    input.candidates.map(c => ({ embedding: c.embedding, item: c })),
    limit,
    threshold
  )

  const hits: SearchHit[] = scored.map(s => ({
    recordType: s.item.recordType,
    recordId: s.item.recordId,
    similarity: s.similarity,
    contentSnippet: s.item.content.slice(0, 240),
    embeddingVersion: s.item.embeddingVersion,
  }))

  const byType: Partial<Record<RecordType, number>> = {}
  for (const c of input.candidates) {
    byType[c.recordType] = (byType[c.recordType] ?? 0) + 1
  }

  return {
    hits,
    candidateCount: input.candidates.length,
    byType,
  }
}

/** Re-export the runtime type list for routes that want the canonical order. */
export { ALL_RECORD_TYPES }
