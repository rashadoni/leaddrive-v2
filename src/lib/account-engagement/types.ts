/**
 * Account Engagement (Pardot) types — C5 slice 1.
 *
 * Salesforce Marketing Cloud Account Engagement analogue. Shared shape
 * between 4 pure helpers:
 *   1. state-machine             — account + journey + enrollment lifecycle
 *   2. account-grade-calculator  — ICP fit attributes → grade (A..F)
 *   3. account-score-calculator  — intent signals + decay → engagement score (0..100)
 *   4. intent-signal-classifier  — raw signal kind → category + weight
 *
 * Pure — no Prisma imports.
 */

/* ─── MarketingAccount lifecycle + transitions ────────────────────────── */

/**
 * Slice-2 surfaces (API + UI + future cron worker) share this threshold.
 * Engagement score below this AND zero recent signals AND high-fit ICP
 * (tier_1/tier_2) flags an account as "stale-priority" — best-fit but quiet.
 */
export const STALE_PRIORITY_SCORE_THRESHOLD = 25

export const ACCOUNT_LIFECYCLE_STAGES = [
  "target",
  "engaged",
  "mql",
  "sql",
  "opportunity",
  "customer",
  "churned",
] as const

export type AccountLifecycleStage = (typeof ACCOUNT_LIFECYCLE_STAGES)[number]

/**
 *   target       → engaged | churned
 *   engaged      → mql | target (downgrade) | churned
 *   mql          → sql | engaged (downgrade) | churned
 *   sql          → opportunity | mql (downgrade) | churned
 *   opportunity  → customer | sql (lost) | churned
 *   customer     → churned
 *   churned      → target (re-engage)
 *
 * Downgrades are allowed because account engagement is a real-time
 * signal — an account that stops engaging should fall back. But the
 * stage-transition timestamps are immutable, so the historical
 * progression is preserved.
 */
export const ACCOUNT_LIFECYCLE_TRANSITIONS: Readonly<
  Record<AccountLifecycleStage, readonly AccountLifecycleStage[]>
> = {
  target: ["engaged", "churned"],
  engaged: ["mql", "target", "churned"],
  mql: ["sql", "engaged", "churned"],
  sql: ["opportunity", "mql", "churned"],
  opportunity: ["customer", "sql", "churned"],
  customer: ["churned"],
  churned: ["target"],
}

/* ─── ICP tier ────────────────────────────────────────────────────────── */

export const ICP_TIERS = [
  "tier_1",
  "tier_2",
  "tier_3",
  "tier_4",
  "unscored",
] as const

export type IcpTier = (typeof ICP_TIERS)[number]

/* ─── Grade ──────────────────────────────────────────────────────────── */

export const GRADES = ["A", "B", "C", "D", "F", "unassigned"] as const
export type Grade = (typeof GRADES)[number]

/* ─── Employee band ──────────────────────────────────────────────────── */

export const EMPLOYEE_BANDS = [
  "micro",
  "small",
  "mid_market",
  "enterprise",
  "strategic",
] as const

export type EmployeeBand = (typeof EMPLOYEE_BANDS)[number]

/* ─── Intent signal kinds + weights ──────────────────────────────────── */

export const SIGNAL_KINDS = [
  "page_view_high_intent",
  "page_view_research",
  "content_download",
  "form_submission",
  "email_engagement",
  "chat_high_intent",
  "third_party_intent",
  "competitor_research",
  "event_attendance",
  "social_engagement",
] as const

export type SignalKind = (typeof SIGNAL_KINDS)[number]

/**
 * Signal categories — the classifier maps SignalKind → category.
 * Score-calculator aggregates by category (so 10 page_view_research
 * signals don't outweigh 1 form_submission).
 */
export const SIGNAL_CATEGORIES = [
  "passive",      // research / awareness
  "engaged",      // active engagement (email opens, content)
  "high_intent",  // buying signals (demos, pricing, competitor research)
  "third_party",  // external intent feed
] as const

export type SignalCategory = (typeof SIGNAL_CATEGORIES)[number]

/* ─── Journey lifecycle + transitions ─────────────────────────────────── */

export const JOURNEY_STATUSES = [
  "draft",
  "active",
  "paused",
  "archived",
] as const

export type JourneyStatus = (typeof JOURNEY_STATUSES)[number]

/**
 *   draft    → active | archived
 *   active   → paused | archived
 *   paused   → active | archived
 *   archived — terminal
 */
export const JOURNEY_TRANSITIONS: Readonly<
  Record<JourneyStatus, readonly JourneyStatus[]>
> = {
  draft: ["active", "archived"],
  active: ["paused", "archived"],
  paused: ["active", "archived"],
  archived: [],
}

export const JOURNEY_GOAL_KINDS = [
  "pipeline_creation",
  "meeting_booked",
  "trial_started",
  "custom",
] as const

export type JourneyGoalKind = (typeof JOURNEY_GOAL_KINDS)[number]

/* ─── Enrollment lifecycle + transitions ──────────────────────────────── */

export const ENROLLMENT_STATUSES = [
  "enrolled",
  "in_progress",
  "goal_met",
  "exited",
  "failed",
] as const

export type EnrollmentStatus = (typeof ENROLLMENT_STATUSES)[number]

/**
 *   enrolled    → in_progress | exited | failed
 *   in_progress → goal_met | exited | failed
 *   goal_met    — terminal (success)
 *   exited      — terminal (no meeting goal)
 *   failed      — terminal (disqualified)
 */
export const ENROLLMENT_TRANSITIONS: Readonly<
  Record<EnrollmentStatus, readonly EnrollmentStatus[]>
> = {
  enrolled: ["in_progress", "exited", "failed"],
  in_progress: ["goal_met", "exited", "failed"],
  goal_met: [],
  exited: [],
  failed: [],
}

/* ─── Transition result ───────────────────────────────────────────────── */

export type TransitionResult = { ok: true } | { ok: false; error: string }

/* ─── Account grade calculator I/O ────────────────────────────────────── */

export interface CalculateGradeInput {
  /** Optional ICP tier — pre-computed by ABM strategist. */
  icpTier: IcpTier
  /** Employee band — proxy for company size. */
  employeeBand: EmployeeBand | null
  /** Industry vertical slug — caller checks against tenant's target list. */
  industrySlug: string | null
  /** Target industries (slice-2 reads from per-tenant config). */
  targetIndustries: readonly string[]
  /** Annual revenue (USD). NULL = unknown. */
  annualRevenueUsd: number | null
  /** Minimum revenue threshold for non-F grade. */
  minRevenueUsd?: number
  /**
   * Disqualified industries — accounts in these get grade F regardless
   * of other factors (e.g. competitors, restricted countries).
   */
  disqualifiedIndustries?: readonly string[]
}

export interface GradeBreakdown {
  grade: Grade
  /** Score 0..100 driven by the multiplicative components below. */
  rawScore: number
  icpComponent: number
  bandComponent: number
  industryComponent: number
  revenueComponent: number
  rationale: string
}

export type CalculateGradeResult =
  | { ok: true; breakdown: GradeBreakdown }
  | { ok: false; error: string }

/* ─── Account engagement score calculator I/O ─────────────────────────── */

export interface ScoreSignal {
  signalKind: SignalKind
  weight: number
  occurredAt: Date
}

export interface CalculateScoreInput {
  signals: readonly ScoreSignal[]
  /** Reference time — "now" for decay computation. */
  asOf: Date
  /** Half-life in days for time-decay. Default 14 days. */
  halfLifeDays?: number
  /** Cap on score (default 100). */
  cap?: number
}

export interface ScoreBreakdown {
  /** Final score 0..cap (default 100), rounded to integer. */
  score: number
  /**
   * Per-category contribution AFTER decay but BEFORE the global cap
   * and rounding. Σ byCategory == rawTotal exactly (modulo FP).
   * NOTE: byCategory values are raw floats — they may individually
   * exceed `cap` and they are NOT rounded. Callers comparing against
   * `score` must aggregate then min(cap) themselves; do not assume
   * Σ byCategory == score.
   * (rawTotal is pre-cap; score is post-cap-and-round, hence the
   * intentional divergence.)
   */
  byCategory: Readonly<Record<SignalCategory, number>>
  /** Total raw (pre-cap, pre-round) score. */
  rawTotal: number
  /** Count of signals counted. */
  signalCount: number
  /** Count of signals outside lookback window dropped. */
  droppedAncientSignals: number
}

export type CalculateScoreResult =
  | { ok: true; breakdown: ScoreBreakdown }
  | { ok: false; error: string }

/* ─── Intent signal classifier I/O ────────────────────────────────────── */

export interface ClassifySignalInput {
  signalKind: SignalKind
  /** Optional resource ref — slice-2 may bump weight for specific
   *  resources (e.g. /pricing page view > /blog page view). */
  resourceRef?: string | null
}

export interface SignalClassification {
  category: SignalCategory
  /** Default weight 1..100 — slice-2 may override via per-tenant config. */
  defaultWeight: number
  /** Whether this signal kind by itself is "MQL-qualifying"
   *  (a single such signal may bump the account to MQL). */
  mqlQualifying: boolean
}

export type ClassifySignalResult =
  | { ok: true; classification: SignalClassification }
  | { ok: false; error: string }
