/**
 * Unified Customer Profile types — G1 Phase 6 Block B slice 1.
 *
 * Salesforce Data Cloud Customer 360 analogue. Three pure-helper
 * workflows:
 *
 *   1. Identity-key normalization — input email / phone / name from
 *      any source → canonical lookup key (lowercased email, E.164
 *      phone, whitespace-collapsed name).
 *   2. Profile merger — given a candidate source record + a list of
 *      existing profiles in the same tenant, pick the profile to
 *      merge into OR signal "create new" with a stable identity key.
 *   3. Profile aggregator — given the source records linked to a
 *      profile, compute the materialized columns (totalSpent,
 *      lifetimeOrderCount, lastSeenAt, channelsActive).
 *
 * Slice 2 wires the nightly refresh cron + 360-view route + real-
 * time merge hooks on Contact / Lead / etc. create-update. Slice 3
 * wires G2 fuzzy identity-resolution.
 */

/* ─── Source-type registry ────────────────────────────────────────────── */

/**
 * Tuple of supported source types — single source of truth. Matches
 * the DB CHECK at migration `profile_sources_type_check`. To add a
 * new source (e.g. NewsletterSubscriber):
 *   1. Extend this tuple
 *   2. Add a CHECK enum entry in a new migration
 *   3. Ship merger-side support for the new source's identity keys
 */
export const PROFILE_SOURCE_TYPES = [
  "contact",
  "lead",
  "mtm_customer",
  "portal_user",
  "web_chat_session",
] as const

export type ProfileSourceType = (typeof PROFILE_SOURCE_TYPES)[number]

/* ─── Identity-key normalization ──────────────────────────────────────── */

export interface NormalizeIdentityInput {
  /** Caller-supplied — any case, may have whitespace. */
  email?: string | null
  /** Caller-supplied — may be local-format (e.g. "050 123 45 67") or international. */
  phone?: string | null
  /** Optional country hint for phone normalization (e.g. "AZ", "US"). Falls back to E.164 detection. */
  defaultCountry?: string
  /** Caller-supplied — any case + whitespace. */
  name?: string | null
}

export interface NormalizedIdentity {
  /** Lowercased + trimmed. Null if input was null/empty/invalid. */
  emailNormalized: string | null
  /** E.164 format (e.g. "+994501234567"). Null if invalid / unparseable. */
  phoneNormalized: string | null
  /** Lowercased + single-space collapsed. Null if empty. */
  nameNormalized: string | null
  /** True when at least one of email/phone is set. The DB CHECK requires this. */
  hasMatchableKey: boolean
}

/* ─── Profile merger ──────────────────────────────────────────────────── */

/**
 * A row from `unified_profiles` table — the merger reads these from
 * Prisma and decides which (if any) to merge a new source into.
 */
export interface ExistingProfileRow {
  id: string
  emailNormalized: string | null
  phoneNormalized: string | null
}

/**
 * Candidate source record awaiting merge decision. The merger doesn't
 * care about source type at decision time — just the identity keys.
 */
export interface MergeCandidate {
  identity: NormalizedIdentity
  sourceType: ProfileSourceType
  sourceId: string
}

export type MergeDecision =
  /** Merge candidate into an existing profile. */
  | { action: "merge_into"; targetProfileId: string; reason: string }
  /** Create a brand-new profile with the candidate's identity. */
  | { action: "create_new"; reason: string }
  /**
   * Ambiguous — candidate's email matches one profile, phone matches
   * a DIFFERENT profile. Slice-1 returns this discriminant; slice-2
   * route falls back to operator review (admin "merge candidates"
   * queue). Slice 3 G2 may auto-resolve via fuzzy scoring.
   */
  | { action: "ambiguous"; candidateProfileIds: readonly string[]; reason: string }
  /** Candidate has no matchable identity (no email AND no phone). */
  | { action: "reject"; reason: string }

export interface MergeInput {
  candidate: MergeCandidate
  /**
   * Existing profiles for the SAME tenant. Caller pre-filters.
   *
   * ⚠️ Determinism contract: caller MUST pass `existing` in a
   * stable order (e.g. Prisma `orderBy: { id: 'asc' }`). The merger's
   * "first-found wins" defensive path on duplicate-email rows
   * (which the partial UNIQUE prevents at DB but can race during
   * a backup-restore) depends on this order. Heap-ordered Postgres
   * output can flip the chosen profile between cron runs without
   * an explicit `orderBy`, causing a source to ping-pong between
   * two profiles across refreshes.
   */
  existing: readonly ExistingProfileRow[]
}

/* ─── Profile aggregator ──────────────────────────────────────────────── */

/**
 * A source record's contribution to the aggregator. Caller fetches
 * one of these per source row and passes the array; helper computes
 * the rollup.
 */
export interface AggregatorSourceRow {
  sourceType: ProfileSourceType
  /** Earliest activity timestamp from this source (createdAt / firstInteractionAt). */
  firstSeenAt: Date | null
  /** Latest activity timestamp (updatedAt / lastInteractionAt / lastMessageAt). */
  lastSeenAt: Date | null
}

/**
 * An invoice contribution. Only `status='paid'` invoices count toward
 * totalSpent / lifetimeOrderCount. Caller pre-filters.
 */
export interface AggregatorInvoiceRow {
  totalAmount: number
  currency: string
  /** Invoice status — must be 'paid' to count. Caller can include non-paid; aggregator filters. */
  status: string
}

export interface AggregateProfileInput {
  /** All source records linked to the profile (via profile_sources). */
  sources: readonly AggregatorSourceRow[]
  /** All invoices attached to the contact / company underlying the profile. */
  invoices: readonly AggregatorInvoiceRow[]
  /**
   * The profile's preferred currency for totalSpent aggregation. Invoices
   * in OTHER currencies are summed separately and reported as
   * `crossCurrencyTotals` — slice-1 does NOT do FX conversion; slice-3
   * may add it via a stored rate table.
   */
  primaryCurrency: string
}

export interface AggregateProfileResult {
  totalSpent: number
  lifetimeOrderCount: number
  firstSeenAt: Date | null
  lastSeenAt: Date | null
  /**
   * Source types that contributed activity, sorted ascending. Matches
   * the `unified_profiles.channelsActive` Postgres array column —
   * slice-2 segmentation queries `WHERE 'web_chat_session' =
   * ANY(channelsActive)` directly without LIKE-substring false
   * positives.
   */
  channelsActive: readonly ProfileSourceType[]
  /**
   * Per-currency totals for non-primary-currency invoices. Empty record
   * when all invoices are in primaryCurrency. Slice-3 may FX-convert
   * these and fold into totalSpent.
   */
  crossCurrencyTotals: Record<string, number>
}
