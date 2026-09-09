/**
 * Segment Activation types — G5 final Phase 6 slice.
 *
 * Salesforce Data Cloud Activation analogue. Bridges G4 DataCloud
 * Segment ↔ external destinations. Shared shape between 5 pure
 * helpers:
 *   1. state-machine          — activation + run lifecycle
 *   2. member-diff-calculator — prev set × current set → adds/removes
 *   3. target-payload-router  — target-type → routes to C3/C2/email helper
 *   4. schedule-evaluator     — cron string + asOf → is-due?
 *   5. (re-exported)          — typed I/O for slice-2 worker
 *
 * Pure — no Prisma imports.
 */

/* ─── Activation status + transitions ─────────────────────────────────── */

export const ACTIVATION_STATUSES = [
  "draft",
  "active",
  "paused",
  "archived",
  "error",
] as const

export type ActivationStatus = (typeof ACTIVATION_STATUSES)[number]

/**
 *   draft → active | archived
 *   active → paused | archived | error
 *   paused → active | archived
 *   error → active (auto-recover on next success) | paused | archived
 *   archived → []
 */
export const ACTIVATION_TRANSITIONS: Readonly<
  Record<ActivationStatus, readonly ActivationStatus[]>
> = {
  draft: ["active", "archived"],
  active: ["paused", "archived", "error"],
  paused: ["active", "archived"],
  error: ["active", "paused", "archived"],
  archived: [],
}

/* ─── Target type ─────────────────────────────────────────────────────── */

export const ACTIVATION_TARGET_TYPES = [
  "ad_audience_sync",
  "mobile_campaign",
  "email_campaign",
  "webhook",
] as const

export type ActivationTargetType = (typeof ACTIVATION_TARGET_TYPES)[number]

/* ─── Run status + transitions ────────────────────────────────────────── */

export const RUN_STATUSES = [
  "pending",
  "running",
  "succeeded",
  "failed",
  "skipped",
] as const

export type RunStatus = (typeof RUN_STATUSES)[number]

/**
 *   pending → running | skipped
 *   running → succeeded | failed
 *   succeeded → []
 *   failed → []
 *   skipped → []
 */
export const RUN_TRANSITIONS: Readonly<Record<RunStatus, readonly RunStatus[]>> = {
  pending: ["running", "skipped"],
  running: ["succeeded", "failed"],
  succeeded: [],
  failed: [],
  skipped: [],
}

/* ─── Trigger source ──────────────────────────────────────────────────── */

export const TRIGGER_SOURCES = ["cron", "manual", "api"] as const
export type TriggerSource = (typeof TRIGGER_SOURCES)[number]

/* ─── Transition result ───────────────────────────────────────────────── */

export type TransitionResult =
  | { ok: true }
  | { ok: false; error: string }

/* ─── Member diff calculator I/O ──────────────────────────────────────── */

export interface DiffMembersInput {
  /** Previous run's member-id set (slice-2 worker snapshots). */
  previousMembers: readonly string[]
  /** Current segment-membership snapshot from G4 evaluator. */
  currentMembers: readonly string[]
  /**
   * Max members per run — defends slice-2 dispatcher against accidental
   * full-tenant bombing. Default 100K (FB / Google audience max).
   */
  maxMembers?: number
}

export interface MemberDiff {
  /** Members in current but not in previous (new adds). */
  added: string[]
  /** Members in previous but not in current (drop-offs). */
  removed: string[]
  /** Members in both (unchanged — slice-2 dispatcher may skip re-push). */
  unchanged: string[]
  /** Total current count. */
  currentCount: number
}

export type DiffMembersResult =
  | { ok: true; diff: MemberDiff }
  | { ok: false; error: string }

export const DEFAULT_MAX_MEMBERS_PER_RUN = 100_000

/* ─── Target payload router I/O ───────────────────────────────────────── */

/**
 * Route descriptor — caller-side dispatcher reads `helper` to pick
 * which slice-2 module call into. Slice-1 returns the routing
 * info; slice-2 runtime resolves to actual function.
 */
export interface TargetRoute {
  targetType: ActivationTargetType
  /** Helper module identifier. */
  helper:
    | "advertising-studio.audience-payload-builder"
    | "mobile-studio.dispatcher"
    | "email-campaign.dispatcher"
    | "webhook.poster"
  /** Method on the helper module. */
  method: string
  /** Whether the diff is incremental-friendly (FB supports add+remove
   * separately; webhook delivers the whole set; email re-enrolls each run). */
  supportsIncremental: boolean
}

export interface RouteTargetInput {
  targetType: ActivationTargetType
}

export type RouteTargetResult =
  | { ok: true; route: TargetRoute }
  | { ok: false; error: string }

/* ─── Schedule evaluator I/O ──────────────────────────────────────────── */

/**
 * Minimal cron parser — supports 5-field cron (minute hour day-of-month
 * month day-of-week). Each field is one of:
 *   *           — any value
 *   N           — exact value
 *   N,N,N       — list
 *   N-N         — range
 *   asterisk/N  — step from 0 (the literal pattern is "asterisk" + "/N")
 *
 * Slice-1 doesn't support advanced features (L, W, #, day-name aliases).
 * Slice-2 may upgrade to a battle-tested cron-parser dependency.
 */
export interface EvaluateScheduleInput {
  /** Cron string. NULL = manual-only (helper returns nextFireAt=null + isDue=false). */
  schedule: string | null
  /** Last successful run timestamp — helper computes nextFire AFTER this. */
  lastRunAt: Date | null
  /** Caller-supplied "now". */
  asOf: Date
  /** Caller's IANA timezone — defaults to UTC. */
  timezone?: string
}

export interface ScheduleEvaluation {
  /** True if asOf is past the next-fire time AND no run since. */
  isDue: boolean
  /** Next computed fire time. NULL when schedule is null. */
  nextFireAt: Date | null
  /**
   * Whether the schedule string parses correctly. Helper rejects
   * unsupported syntax early.
   */
  parseValid: boolean
  /** Parse error if !parseValid. */
  parseError?: string
}

export type EvaluateScheduleResult =
  | { ok: true; evaluation: ScheduleEvaluation }
  | { ok: false; error: string }
