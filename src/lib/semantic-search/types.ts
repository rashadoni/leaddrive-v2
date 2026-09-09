/**
 * Semantic Search types — H13 Phase 3 slice 1.
 *
 * Salesforce Einstein Search analogue: text query → embedding →
 * cosine-similarity search across heterogeneous CRM records (Deal,
 * Contact, Company, Ticket, KbArticle). One unified result list ranked
 * by similarity.
 *
 * Slice 1 stores embeddings as Postgres Float[] and ranks in JS at
 * query time — good enough for thousands of records per tenant.
 * Slice 2 migrates to pgvector for native kNN at scale.
 */

/** Whitelist of record types we currently embed + search across. */
export type RecordType = "deal" | "contact" | "company" | "ticket" | "kb_article"

/** All currently embeddable record types, ordered for stable surfaces. */
export const ALL_RECORD_TYPES: readonly RecordType[] = [
  "deal",
  "contact",
  "company",
  "ticket",
  "kb_article",
]

/** Dense vector — magnitudes vary, callers must normalise before storing. */
export type EmbeddingVector = readonly number[]

/** One result row in a search response. */
export interface SearchHit {
  recordType: RecordType
  recordId: string
  /** Cosine similarity in [-1, 1]; in practice [0, 1] for normalised L2 vectors. */
  similarity: number
  /** The embedded source text — useful for inline preview in UI. */
  contentSnippet: string
  /** Schema version of the embedding that produced this row. */
  embeddingVersion: number
}

/** Aggregate response: hits + per-type breakdown for facets. */
export interface SearchResult {
  hits: SearchHit[]
  /** Total candidates considered across all record types. */
  candidateCount: number
  /** Count per type — feeds the UI facet panel. */
  byType: Partial<Record<RecordType, number>>
}

/* ─── Embedder DI ─────────────────────────────────────────────────────── */

export interface SemanticEmbedClient {
  /** Embed a single piece of text. Implementations must return a
   * fixed-dimension vector for any input (pad on short, truncate or
   * truncate-then-pad on long). Same model for index + query. */
  embed(text: string): Promise<EmbeddingVector>
  /** Stable identifier persisted alongside the vector — lets the
   * search path skip rows whose embedder version mismatches the
   * current one. */
  readonly model: string
}

/* ─── Index / search inputs ───────────────────────────────────────────── */

export interface IndexRecordInput {
  embedder: SemanticEmbedClient
  recordType: RecordType
  recordId: string
  /** Already-extracted searchable text (caller-side concat of relevant fields). */
  content: string
}

export interface SearchAcrossInput {
  embedder: SemanticEmbedClient
  query: string
  /** Optional subset of types to consider; defaults to all. */
  types?: readonly RecordType[]
  /** Max hits to return. Default 20. */
  limit?: number
  /** Minimum similarity floor in [-1, 1]. Default 0. */
  threshold?: number
}

/** Slice 1 row shape — Float[] in DB, vector mapped client-side. */
export interface CandidateRow {
  recordType: RecordType
  recordId: string
  content: string
  embedding: number[]
  embeddingVersion: number
}
