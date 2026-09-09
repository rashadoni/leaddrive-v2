/**
 * Media Cloud types — R11 slice 1.
 *
 * Salesforce Media Cloud analogue. Shared shape between 4 pure helpers:
 *   1. state-machine                — subscriber + content + campaign + placement lifecycle
 *   2. ad-targeting-matcher         — campaign targeting × subscriber → match score
 *   3. content-metric-aggregator    — consumption events → DAU/MAU/avg-session
 *   4. ad-pacing-calculator         — campaign budget × flight × pacing → daily target
 *
 * Pure — no Prisma imports.
 */

/* ─── Subscriber status + transitions ─────────────────────────────────── */

export const SUBSCRIBER_STATUSES = [
  "trial",
  "active",
  "paused",
  "churned",
  "banned",
] as const

export type SubscriberStatus = (typeof SUBSCRIBER_STATUSES)[number]

/**
 *   trial    → active | churned | banned
 *   active   → paused | churned | banned
 *   paused   → active | churned | banned
 *   churned  → active (win-back) | banned
 *   banned   — terminal (banned subscribers don't get re-enabled in slice-1)
 */
export const SUBSCRIBER_TRANSITIONS: Readonly<
  Record<SubscriberStatus, readonly SubscriberStatus[]>
> = {
  trial: ["active", "churned", "banned"],
  active: ["paused", "churned", "banned"],
  paused: ["active", "churned", "banned"],
  churned: ["active", "banned"],
  banned: [],
}

/* ─── Content kind + status + monetization ────────────────────────────── */

export const CONTENT_KINDS = [
  "article",
  "video",
  "audio",
  "podcast",
  "live_stream",
  "series_episode",
] as const

export type ContentKind = (typeof CONTENT_KINDS)[number]

export const CONTENT_STATUSES = [
  "draft",
  "scheduled",
  "published",
  "unpublished",
  "archived",
] as const

export type ContentStatus = (typeof CONTENT_STATUSES)[number]

/**
 *   draft       → scheduled | published
 *   scheduled   → published | draft (un-schedule)
 *   published   → unpublished | archived
 *   unpublished → published (re-publish) | archived
 *   archived    — terminal
 */
export const CONTENT_TRANSITIONS: Readonly<
  Record<ContentStatus, readonly ContentStatus[]>
> = {
  draft: ["scheduled", "published"],
  scheduled: ["published", "draft"],
  published: ["unpublished", "archived"],
  unpublished: ["published", "archived"],
  archived: [],
}

export const MONETIZATION_KINDS = [
  "free",
  "metered",
  "paywalled",
  "ad_supported",
  "premium_only",
] as const

export type MonetizationKind = (typeof MONETIZATION_KINDS)[number]

/* ─── Ad campaign goal + status + transitions ─────────────────────────── */

export const CAMPAIGN_GOALS = [
  "brand_awareness",
  "reach",
  "conversions",
  "retargeting",
  "direct_response",
] as const

export type CampaignGoal = (typeof CAMPAIGN_GOALS)[number]

export const CAMPAIGN_STATUSES = [
  "draft",
  "scheduled",
  "running",
  "paused",
  "completed",
  "cancelled",
] as const

export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number]

/**
 *   draft     → scheduled | cancelled
 *   scheduled → running | cancelled
 *   running   → paused | completed | cancelled
 *   paused    → running | completed | cancelled
 *   completed — terminal
 *   cancelled — terminal
 */
export const CAMPAIGN_TRANSITIONS: Readonly<
  Record<CampaignStatus, readonly CampaignStatus[]>
> = {
  draft: ["scheduled", "cancelled"],
  scheduled: ["running", "cancelled"],
  running: ["paused", "completed", "cancelled"],
  paused: ["running", "completed", "cancelled"],
  completed: [],
  cancelled: [],
}

/* ─── Ad placement slot + status + pricing + transitions ──────────────── */

export const PLACEMENT_SLOT_KINDS = [
  "pre_roll",
  "mid_roll",
  "post_roll",
  "banner",
  "sidebar",
  "native_inline",
  "sponsored_content",
] as const

export type PlacementSlotKind = (typeof PLACEMENT_SLOT_KINDS)[number]

export const PLACEMENT_STATUSES = [
  "pending",
  "live",
  "paused",
  "completed",
  "cancelled",
] as const

export type PlacementStatus = (typeof PLACEMENT_STATUSES)[number]

/**
 *   pending   → live | cancelled
 *   live      → paused | completed | cancelled
 *   paused    → live | completed | cancelled
 *   completed — terminal
 *   cancelled — terminal
 */
export const PLACEMENT_TRANSITIONS: Readonly<
  Record<PlacementStatus, readonly PlacementStatus[]>
> = {
  pending: ["live", "cancelled"],
  live: ["paused", "completed", "cancelled"],
  paused: ["live", "completed", "cancelled"],
  completed: [],
  cancelled: [],
}

export const PRICING_MODELS = ["cpm", "cpc", "cpa", "flat"] as const
export type PricingModel = (typeof PRICING_MODELS)[number]

/* ─── Consumption event + device ──────────────────────────────────────── */

export const EVENT_KINDS = [
  "view_start",
  "view_progress",
  "view_complete",
  "view_abandon",
  "click",
  "conversion",
  "share",
  "bookmark",
] as const

export type EventKind = (typeof EVENT_KINDS)[number]

export const DEVICE_KINDS = [
  "web",
  "mobile_web",
  "ios_app",
  "android_app",
  "smart_tv",
  "other",
] as const

export type DeviceKind = (typeof DEVICE_KINDS)[number]

/* ─── Transition result ───────────────────────────────────────────────── */

export type TransitionResult = { ok: true } | { ok: false; error: string }

/* ─── Ad targeting matcher I/O ────────────────────────────────────────── */

export interface TargetingCriteria {
  /** Subscriber must have one of these tiers. Empty = any. */
  tiers?: readonly string[]
  /** Subscriber must be in one of these regions. Empty = any. */
  regions?: readonly string[]
  /** Content must be in one of these genres. Empty = any. */
  genres?: readonly string[]
  /** Content must be in one of these kinds. Empty = any. */
  contentKinds?: readonly ContentKind[]
  /** Content must be in one of these languages. Empty = any. */
  languages?: readonly string[]
}

export interface SubscriberContext {
  tierSlug: string
  billingRegion: string | null
}

export interface ContentContext {
  contentKind: ContentKind
  genreSlug: string | null
  languageCode: string | null
  /** Empty array = global; non-empty = subscriber.region must be IN. */
  licensedRegions: readonly string[]
}

export interface MatchAdTargetingInput {
  criteria: TargetingCriteria
  subscriber: SubscriberContext
  content: ContentContext
}

export interface TargetingMatchResult {
  matched: boolean
  /** Score 0..1; higher = more criteria matched. */
  score: number
  /** Which criteria fired (for debugging). */
  matchedFacets: readonly string[]
  /** Which criteria failed (for debugging). */
  unmatchedFacets: readonly string[]
}

export type MatchAdTargetingResult =
  | { ok: true; match: TargetingMatchResult }
  | { ok: false; error: string }

/* ─── Content metric aggregator I/O ───────────────────────────────────── */

export interface ConsumptionEvent {
  eventKind: EventKind
  occurredAt: Date
  subscriberId: string | null
  contentId: string
  engagedSeconds?: number | null
  progressPct?: number | null
}

export interface AggregateMetricsInput {
  events: readonly ConsumptionEvent[]
  /** Window for aggregation (inclusive start, exclusive end). */
  windowStart: Date
  windowEnd: Date
}

export interface ContentMetrics {
  /** Distinct subscribers (DAU/MAU input). */
  uniqueSubscribers: number
  /** Total view_start events. */
  viewStarts: number
  /** Total view_complete events. */
  viewCompletes: number
  /** Total view_abandon events. */
  viewAbandons: number
  /**
   * Completion rate = view_complete / view_start (0..1).
   * NULL when viewStarts === 0 (rate undefined — no denominator).
   * Slice-2 change: was `number` with NaN sentinel; callers had to
   * use `Number.isNaN` to test the undefined case. Switched to
   * `number | null` so the undefined case is type-safe at the
   * consumer (e.g. `metrics.completionRate ?? defaultRate` works
   * cleanly without a NaN-check branch).
   */
  completionRate: number | null
  /** Average engagedSeconds across view_complete events. */
  avgEngagedSeconds: number
  /** Total click events. */
  clicks: number
  /** Total conversion events. */
  conversions: number
}

export type AggregateMetricsResult =
  | { ok: true; metrics: ContentMetrics }
  | { ok: false; error: string }

/* ─── Ad pacing calculator I/O ────────────────────────────────────────── */

export interface CalculatePacingInput {
  /** Total campaign budget. */
  totalBudget: number
  /** Amount already spent. */
  spentAmount: number
  /** Flight start. */
  flightStartAt: Date
  /** Flight end (exclusive). */
  flightEndAt: Date
  /** "Now" — caller's wall clock. */
  asOf: Date
  /** Daily budget cap (NULL = no cap). */
  dailyBudgetCap?: number | null
}

export interface PacingPlan {
  /** Remaining budget (totalBudget − spentAmount). */
  remainingBudget: number
  /** Days remaining in flight (asOf to flightEndAt). */
  remainingDays: number
  /** Daily-pace target: remainingBudget / remainingDays (clamped to dailyBudgetCap if set). */
  dailyPaceTarget: number
  /** Is campaign over-paced (spent ahead of schedule)? */
  isOverPaced: boolean
  /** Is campaign under-paced (spent behind schedule)? */
  isUnderPaced: boolean
  /** Expected spend by asOf based on linear pacing. */
  expectedSpendByNow: number
}

export type CalculatePacingResult =
  | { ok: true; pacing: PacingPlan }
  | { ok: false; error: string }
