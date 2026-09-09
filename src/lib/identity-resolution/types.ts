/**
 * Identity Resolution types — G2 Phase 6 Block B slice 1.
 *
 * Salesforce Identity Resolution analogue. Builds on G1
 * UnifiedProfile's exact-match merger by adding fuzzy-similarity
 * scoring (Levenshtein + digit-edit on phone + name similarity).
 *
 * Three pure-helper workflows:
 *
 *   1. Levenshtein — edit-distance primitive; pure DP.
 *   2. Fuzzy matcher — given two normalized identities, produce a
 *      0..1 composite score with per-key breakdown.
 *   3. Merge resolver — given a score + thresholds, decide:
 *        auto_merge (>= auto threshold)
 *        manual_review (>= manual threshold, < auto)
 *        reject (< manual)
 *
 * Slice 2 wires the admin queue routes; slice 3 wires the AI
 * duplicate-detection pipeline (reuses `src/lib/ai/duplicates.ts`).
 */

/* ─── Match-status enum (matches DB CHECK) ────────────────────────────── */

export const PROFILE_MERGE_CANDIDATE_STATUSES = [
  "pending",
  "auto_merged",
  "manually_merged",
  "rejected",
] as const

export type ProfileMergeCandidateStatus =
  (typeof PROFILE_MERGE_CANDIDATE_STATUSES)[number]

/* ─── Fuzzy matcher I/O ───────────────────────────────────────────────── */

/**
 * Normalized identity shape — matches `NormalizedIdentity` from G1
 * `unified-profile/types.ts` (re-declared here to keep G2 standalone-
 * testable; consumers can cast both ways).
 */
export interface FuzzyIdentity {
  emailNormalized: string | null
  phoneNormalized: string | null
  nameNormalized: string | null
}

/** Mutable shape for caller overrides — accept any non-negative weight. */
export interface FuzzyWeights {
  email: number
  phone: number
  name: number
}

/**
 * Default key weights — composite score = sum(key_score * weight) /
 * sum(weight_of_present_keys). Email is highest because it's the
 * strongest identity signal (much harder to collide on by accident
 * than a phone or a name). Name is lowest because many distinct
 * people share names.
 *
 * ⚠️ Scale-invariance: weights don't need to sum to 1.0. `{6, 3, 1}`
 * produces identical composite scores to `{0.6, 0.3, 0.1}` because
 * the formula normalizes by `sum(weight_of_present_keys)`. Only the
 * RATIOS matter when tuning per-tenant overrides.
 *
 * Slice-3 may tune these per-tenant; slice-1 ships the defaults.
 */
export const FUZZY_DEFAULT_WEIGHTS: FuzzyWeights = {
  email: 0.6,
  phone: 0.3,
  name: 0.1,
}

export interface FuzzyMatchOptions {
  /** Optional override of FUZZY_DEFAULT_WEIGHTS. */
  weights?: FuzzyWeights
}

export interface FuzzyMatchBreakdown {
  /**
   * Per-key similarity 0..1. `null` if key is absent on EITHER side.
   *
   * ⚠️ JSON-safety contract: this column persists to a Postgres JSONB
   * column (`profile_merge_candidates.matchBreakdown`). NaN is NOT
   * valid JSON — `JSON.stringify(NaN)` returns `"null"` which silently
   * collapses the typed signal. Using `number | null` here keeps the
   * shape JSON-clean AND survives a round-trip through Prisma's
   * `Json` type without losing the "key was absent" semantic.
   */
  email: number | null
  phone: number | null
  name: number | null
  /** The weight contribution actually applied (zeroed when key absent). */
  emailWeight: number
  phoneWeight: number
  nameWeight: number
}

export interface FuzzyMatchResult {
  /** Composite 0..1 score. 0 when no keys are comparable on both sides. */
  score: number
  breakdown: FuzzyMatchBreakdown
}

/* ─── Merge resolver I/O ──────────────────────────────────────────────── */

/** Mutable shape for caller overrides — accept any score thresholds. */
export interface MergeThresholds {
  /** Score >= this → auto-merge (high confidence). */
  autoMerge: number
  /** Score >= this AND < autoMerge → manual review queue. */
  manualReview: number
}

export const DEFAULT_MERGE_THRESHOLDS: MergeThresholds = {
  autoMerge: 0.95,
  manualReview: 0.7,
}

export interface ResolveMergeInput {
  score: number
  /** Optional override of DEFAULT_MERGE_THRESHOLDS. */
  thresholds?: MergeThresholds
}

export type ResolveMergeDecision =
  | { kind: "auto_merge"; reason: string }
  | { kind: "manual_review"; reason: string }
  | { kind: "reject"; reason: string }

/* ─── Pair-key derivation ─────────────────────────────────────────────── */

/**
 * Given two profile ids, return the canonical (primary, secondary)
 * ordering. The lexicographically-smaller id is primary — gives the
 * partial UNIQUE `(org, primary, secondary) WHERE status='pending'`
 * deterministic membership so two concurrent matchers on the same
 * pair both compute (primary='abc', secondary='xyz') and race-collide
 * to a single P2002 rather than emitting duplicate queue rows.
 */
export interface CanonicalPair {
  primaryProfileId: string
  secondaryProfileId: string
}
