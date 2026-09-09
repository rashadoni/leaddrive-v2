/**
 * G6 Real-time Event Stream — types + state machines.
 *
 * Slice-1 contract for the pub/sub backbone. Types here mirror the
 * Prisma schema (prisma/schema.prisma) + the DB-level CHECK constraints
 * + triggers (prisma/migrations/20260519110000_event_stream/migration.sql).
 *
 * Slice-2 reads these to drive the publish-API, dispatcher worker, and
 * admin UI. Slice-3 layers webhook signing, replay-from-cursor, and
 * rate limiting on top.
 *
 * NOT to be confused with N14 PlatformEvent / PlatformEventLog — those
 * are the Apex-style declarative event definition + per-tenant call log
 * (Salesforce Platform Events analogue used by the Apex sandbox). G6
 * is the *infrastructure* — typed pub/sub with subscriptions, retries,
 * and dead-letters. Different layer, different concerns.
 */

// ── Stream lifecycle ────────────────────────────────────────────

export type StreamStatus = "draft" | "active" | "paused" | "archived"

export const STREAM_STATUSES: readonly StreamStatus[] = [
  "draft",
  "active",
  "paused",
  "archived",
] as const

/**
 * Allowed status transitions, mirroring the DB trigger in
 * event_streams_lifecycle_fn. Empty array = terminal.
 */
export const STREAM_STATUS_TRANSITIONS: Readonly<
  Record<StreamStatus, readonly StreamStatus[]>
> = {
  draft: ["active", "archived"],
  active: ["paused", "archived"],
  paused: ["active", "archived"],
  archived: [],
}

// ── Subscription lifecycle ──────────────────────────────────────

export type SubscriptionStatus = "active" | "paused" | "archived"

export const SUBSCRIPTION_STATUSES: readonly SubscriptionStatus[] = [
  "active",
  "paused",
  "archived",
] as const

export const SUBSCRIPTION_STATUS_TRANSITIONS: Readonly<
  Record<SubscriptionStatus, readonly SubscriptionStatus[]>
> = {
  active: ["paused", "archived"],
  paused: ["active", "archived"],
  archived: [],
}

// ── Target types (subscription destinations) ────────────────────

export type SubscriptionTargetType =
  | "webhook"
  | "internal_queue"
  | "workflow"
  | "activation"

export const SUBSCRIPTION_TARGET_TYPES: readonly SubscriptionTargetType[] = [
  "webhook",
  "internal_queue",
  "workflow",
  "activation",
] as const

// ── Delivery-attempt outcome ────────────────────────────────────

export type DeliveryOutcome =
  | "pending"
  | "succeeded"
  | "failed"
  | "exhausted"

export const DELIVERY_OUTCOMES: readonly DeliveryOutcome[] = [
  "pending",
  "succeeded",
  "failed",
  "exhausted",
] as const

/**
 * Once a delivery row leaves "pending" it's immutable (DB trigger
 * enforces). These are the terminal outcomes.
 */
export const DELIVERY_TERMINAL_OUTCOMES: readonly DeliveryOutcome[] = [
  "succeeded",
  "failed",
  "exhausted",
] as const

// ── Dead-letter triage ──────────────────────────────────────────

export type DeadLetterTriageStatus =
  | "open"
  | "replaying"
  | "resolved"
  | "discarded"

export const DEAD_LETTER_TRIAGE_STATUSES: readonly DeadLetterTriageStatus[] = [
  "open",
  "replaying",
  "resolved",
  "discarded",
] as const

export const DEAD_LETTER_TRIAGE_TRANSITIONS: Readonly<
  Record<DeadLetterTriageStatus, readonly DeadLetterTriageStatus[]>
> = {
  open: ["replaying", "resolved", "discarded"],
  // Operator can return a replay to open ("cancel replay"), or close it.
  replaying: ["open", "resolved", "discarded"],
  resolved: [],
  discarded: [],
}

// ── Event payload shape (publisher-side input) ──────────────────

/**
 * The input shape a slice-2 publisher hands to the event-validator.
 * `sequence` is server-assigned (taken inside the transaction); the
 * publisher doesn't supply it.
 */
export interface PublishEventInput {
  /** Logical event type — finer-grained than streamKey. */
  eventType: string
  /** Optional dedup key (NULL = no dedup). */
  idempotencyKey?: string | null
  /** Event payload — validated against parent stream.payloadSchema. */
  payload: Record<string, unknown>
  /** Optional traceability metadata. */
  source?: Record<string, unknown>
  /**
   * Wall-clock time the publisher claims event happened. Defaults to
   * "now" if absent.
   */
  occurredAt?: Date
}

// ── Light JSON-Schema-ish contract for payload validation ───────

/**
 * Minimal payload-schema shape supported by slice-1 event-validator.
 * NOT a full draft-07 JSON-Schema implementation — slice-2 swaps in
 * the heavier validator (likely ajv).
 *
 * Shape:
 *   {
 *     "required": ["dealId", "amount"],
 *     "properties": {
 *       "dealId":  { "type": "string" },
 *       "amount":  { "type": "number" },
 *       "stage":   { "type": "string", "enum": ["won","lost","open"] },
 *       "metadata":{ "type": "object" }
 *     }
 *   }
 */
export interface PayloadSchema {
  required?: string[]
  properties?: Record<string, PayloadFieldSchema>
}

export interface PayloadFieldSchema {
  /**
   * Type tag — slice-1 validator accepts these. Other values are
   * pass-through (no validation).
   */
  type?: "string" | "number" | "boolean" | "object" | "array" | "null"
  /** Enum constraint (string fields). */
  enum?: readonly (string | number | boolean | null)[]
}

// ── Subscription payload filter ─────────────────────────────────

/**
 * Per-path predicates the subscription-filter-matcher evaluates against
 * the event payload. Path uses dot notation. Operators:
 *
 *   eq       — strict equality
 *   neq      — strict inequality
 *   in       — value ∈ array
 *   not_in   — value ∉ array
 *   gt/gte   — greater than / greater-or-equal (numeric)
 *   lt/lte   — less than / less-or-equal (numeric)
 *   contains — substring match (string field)
 *   exists   — path resolves to a non-undefined value
 */
export interface PayloadFilterPredicate {
  eq?: unknown
  neq?: unknown
  in?: readonly unknown[]
  not_in?: readonly unknown[]
  gt?: number
  gte?: number
  lt?: number
  lte?: number
  contains?: string
  exists?: boolean
}

export type PayloadFilter = Record<string, PayloadFilterPredicate>

// ── Retry policy config (per-subscription) ──────────────────────

/**
 * Slice-1 delivery-retry-policy computes next-attempt delay from this.
 * Slice-2 will read these per-subscription (maxAttempts is on the
 * subscription row); the other knobs are config defaults that can be
 * overridden in subscription.metadata in slice-3.
 */
export interface RetryPolicyConfig {
  /** Max attempts before escalating to dead-letter. */
  maxAttempts: number
  /** Initial delay (ms) before attempt 2 (after attempt 1 fails). */
  initialDelayMs: number
  /** Cap on the computed delay (ms). */
  maxDelayMs: number
  /** Exponential backoff base. delay = initial * (base ** (attempt - 1)). */
  exponentBase: number
  /**
   * Jitter strategy. "none" = exact; "full" = uniform [0, delay]; "equal" =
   * delay/2 + uniform [0, delay/2]. Slice-1 deterministic helper takes
   * an explicit jitter value so tests are reproducible.
   */
  jitter: "none" | "full" | "equal"
}

export const DEFAULT_RETRY_POLICY: Readonly<RetryPolicyConfig> = {
  maxAttempts: 5,
  initialDelayMs: 1_000, // 1s
  maxDelayMs: 5 * 60_000, // 5 min
  exponentBase: 2,
  jitter: "equal",
}

// ── Retention pruner config ─────────────────────────────────────

/**
 * Input shape for retention-pruner.ts — given a stream's retentionSeconds
 * and "now", returns the cutoff Date before which events should be
 * deleted.
 */
export interface RetentionPlan {
  streamId: string
  /**
   * `null` if the stream retains indefinitely (no pruning needed).
   * Otherwise: all events with occurredAt < cutoff are eligible.
   */
  cutoff: Date | null
}
