/**
 * Advertising Studio types — C3 Phase 6 Block G second slice.
 *
 * Salesforce Marketing Cloud Advertising Studio analogue. Shared
 * shape between 5 pure helpers:
 *   1. state-machine             — provider + sync + tracking transitions
 *   2. pii-hasher                — SHA-256 normalize+hash (FB / Google match)
 *   3. audience-payload-builder  — per-provider payload format
 *   4. metrics-aggregator        — rollups + ROAS / CPA / CTR computations
 *   5. (re-exported)             — typed I/O for slice-2 dispatcher
 *
 * Pure — no Prisma imports.
 */

/* ─── Providers ───────────────────────────────────────────────────────── */

export const AD_PROVIDER_TYPES = [
  "facebook",
  "google",
  "linkedin",
  "tiktok",
  "twitter",
] as const

export type AdProviderType = (typeof AD_PROVIDER_TYPES)[number]

/* ─── Provider connection status + transitions ────────────────────────── */

export const PROVIDER_STATUSES = [
  "draft",
  "connected",
  "disconnected",
  "error",
  "expired",
] as const

export type ProviderStatus = (typeof PROVIDER_STATUSES)[number]

/**
 *   draft → connected | error
 *   connected → disconnected | error | expired
 *   disconnected → connected (re-auth)
 *   error → connected | disconnected
 *   expired → connected (re-auth) | disconnected
 */
export const PROVIDER_TRANSITIONS: Readonly<
  Record<ProviderStatus, readonly ProviderStatus[]>
> = {
  draft: ["connected", "error"],
  connected: ["disconnected", "error", "expired"],
  disconnected: ["connected"],
  error: ["connected", "disconnected"],
  expired: ["connected", "disconnected"],
}

/* ─── Audience sync status + transitions ──────────────────────────────── */

export const AUDIENCE_SYNC_STATUSES = [
  "pending",
  "syncing",
  "active",
  "stale",
  "error",
  "deleted",
] as const

export type AudienceSyncStatus = (typeof AUDIENCE_SYNC_STATUSES)[number]

/**
 *   pending → syncing | deleted
 *   syncing → active | error | deleted
 *   active → stale | error | deleted  (source segment edits flip to stale)
 *   stale → syncing | deleted
 *   error → syncing (retry) | deleted
 *   deleted → []
 */
export const AUDIENCE_SYNC_TRANSITIONS: Readonly<
  Record<AudienceSyncStatus, readonly AudienceSyncStatus[]>
> = {
  pending: ["syncing", "deleted"],
  syncing: ["active", "error", "deleted"],
  active: ["stale", "error", "deleted"],
  stale: ["syncing", "deleted"],
  error: ["syncing", "deleted"],
  deleted: [],
}

/* ─── Campaign tracking status + transitions ──────────────────────────── */

export const TRACKING_STATUSES = ["active", "paused", "completed", "archived"] as const
export type TrackingStatus = (typeof TRACKING_STATUSES)[number]

/**
 *   active → paused | completed | archived
 *   paused → active | completed | archived
 *   completed → archived
 *   archived → []
 */
export const TRACKING_TRANSITIONS: Readonly<
  Record<TrackingStatus, readonly TrackingStatus[]>
> = {
  active: ["paused", "completed", "archived"],
  paused: ["active", "completed", "archived"],
  completed: ["archived"],
  archived: [],
}

/* ─── Transition result ───────────────────────────────────────────────── */

export type TransitionResult =
  | { ok: true }
  | { ok: false; error: string }

/* ─── PII hasher I/O ──────────────────────────────────────────────────── */

/**
 * Match-keys supported by Facebook Custom Audiences + Google Customer
 * Match. Each provider has its own normalization rules; the hasher
 * helper produces the SHA-256 hex of the normalised lowercase form
 * (universal across FB/Google requirements).
 */
export type PiiKind = "email" | "phone" | "first_name" | "last_name" | "zip" | "country"

export interface HashPiiInput {
  kind: PiiKind
  /** Raw value — caller passes from CRM. Helper normalises before hashing. */
  value: string
}

export type HashPiiResult =
  | { ok: true; sha256Hex: string }
  | { ok: false; error: string }

/* ─── Audience payload builder I/O ────────────────────────────────────── */

export interface AudienceMember {
  /** Optional CRM contact id (caller correlation only — not in payload). */
  contactId?: string
  /** Plain CRM fields — caller pre-fetched. Helper hashes per-provider rules. */
  email?: string | null
  phone?: string | null
  firstName?: string | null
  lastName?: string | null
  zip?: string | null
  /** ISO 3166-1 alpha-2 country code. */
  country?: string | null
}

export interface BuildAudiencePayloadInput {
  providerType: AdProviderType
  /** External audience name — provider-side label. */
  audienceName: string
  /** Members to include. */
  members: readonly AudienceMember[]
  /** Optional batch size (default 10000 — FB max per call). Helper enforces. */
  batchSize?: number
}

export interface AudienceBatch {
  /** Schema fields per provider — array of field keys. */
  schema: readonly string[]
  /** Each row: parallel array of values matching schema order. */
  data: readonly (readonly string[])[]
}

export interface BuildAudiencePayloadResult_OK {
  ok: true
  providerType: AdProviderType
  audienceName: string
  /** Batches — caller dispatches one POST per batch. */
  batches: AudienceBatch[]
  /**
   * Members that produced no match-keys after hashing (no email/phone).
   * Distinct from `invalidCount` — these are legitimate contacts who
   * happen to lack PII the provider can match against.
   */
  unmatchableCount: number
  /**
   * Members rejected as malformed (null, non-object). Signals a caller
   * bug — slice-2 dispatcher should alarm on this independently of
   * the normal unmatchable count. Architect-pass-1 close-out.
   */
  invalidCount: number
}

export type BuildAudiencePayloadResult =
  | BuildAudiencePayloadResult_OK
  | { ok: false; errors: string[] }

export const DEFAULT_BATCH_SIZE = 10_000
export const MAX_BATCH_SIZE = 65_000

/* ─── Metrics aggregator I/O ──────────────────────────────────────────── */

export interface CampaignMetricsSnapshot {
  spendMinor: number
  impressions: number
  clicks: number
  conversions: number
  conversionValueMinor: number
  currency: string
}

export interface AggregateMetricsInput {
  /** Per-campaign rows — caller pre-fetches. Mixed currencies REJECTED. */
  campaigns: readonly CampaignMetricsSnapshot[]
  baseCurrency: string
}

export interface MetricsAggregate {
  totalSpendMinor: number
  totalImpressions: number
  totalClicks: number
  totalConversions: number
  totalConversionValueMinor: number
  /**
   * Click-through rate as a fraction 0..1 (clicks/impressions).
   * NULL when no impressions — distinguishes "no data" from "0%".
   * Architect-pass-1 close-out: aligned with cpaMinor/roas/cpcMinor
   * null-on-zero-divisor convention.
   */
  ctr: number | null
  /** Conversion rate as a fraction 0..1 (conversions/clicks). NULL when no clicks. */
  conversionRate: number | null
  /** Cost-per-acquisition in minor units (spend/conversions; null if 0 conv). */
  cpaMinor: number | null
  /** Return on ad spend as a fraction (value/spend; null if 0 spend). */
  roas: number | null
  /** Cost-per-click in minor units (spend/clicks; null if 0 clicks). */
  cpcMinor: number | null
  campaignCount: number
}

export type AggregateMetricsResult =
  | { ok: true; aggregate: MetricsAggregate }
  | { ok: false; error: string }
