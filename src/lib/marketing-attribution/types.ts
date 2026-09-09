/**
 * C9 Marketing Attribution — types + state machines.
 *
 * Slice-1 contract for the multi-touch attribution engine. Types mirror
 * the Prisma schema + DB-level CHECK constraints + triggers.
 *
 * Slice-2 reads these to drive the recomputation worker. Slice-3 layers
 * custom curves + real-time recomputation via G6 event stream.
 */

// ── Attribution model types ─────────────────────────────────────

export type AttributionModelType =
  | "first_touch"
  | "last_touch"
  | "linear"
  | "time_decay"
  | "u_shaped"
  | "custom"

export const ATTRIBUTION_MODEL_TYPES: readonly AttributionModelType[] = [
  "first_touch",
  "last_touch",
  "linear",
  "time_decay",
  "u_shaped",
  "custom",
] as const

// ── Model lifecycle ─────────────────────────────────────────────

export type ModelStatus = "draft" | "active" | "archived"

export const MODEL_STATUSES: readonly ModelStatus[] = [
  "draft",
  "active",
  "archived",
] as const

/**
 * Mirror of attribution_models_lifecycle_fn DB trigger.
 *   draft     → active | archived
 *   active    → archived (no return to draft once shipped)
 *   archived  → terminal
 */
export const MODEL_STATUS_TRANSITIONS: Readonly<
  Record<ModelStatus, readonly ModelStatus[]>
> = {
  draft: ["active", "archived"],
  active: ["archived"],
  archived: [],
}

// ── Calculation-run lifecycle ───────────────────────────────────

export type RunStatus = "pending" | "running" | "succeeded" | "failed"

export const RUN_STATUSES: readonly RunStatus[] = [
  "pending",
  "running",
  "succeeded",
  "failed",
] as const

export const RUN_STATUS_TRANSITIONS: Readonly<
  Record<RunStatus, readonly RunStatus[]>
> = {
  pending: ["running", "failed"],
  running: ["succeeded", "failed"],
  succeeded: [],
  failed: [],
}

export type TriggerSource = "cron" | "manual" | "api"

export const TRIGGER_SOURCES: readonly TriggerSource[] = [
  "cron",
  "manual",
  "api",
] as const

// ── Touchpoint channels ─────────────────────────────────────────

export type TouchpointChannel =
  | "email"
  | "ad"
  | "web"
  | "social"
  | "event"
  | "sms"
  | "call"
  | "other"

export const TOUCHPOINT_CHANNELS: readonly TouchpointChannel[] = [
  "email",
  "ad",
  "web",
  "social",
  "event",
  "sms",
  "call",
  "other",
] as const

// ── Model config shapes ─────────────────────────────────────────

/**
 * Discriminated union per modelType. Validators reject configs that
 * don't match their declared modelType.
 */
export type ModelConfig =
  | FirstTouchConfig
  | LastTouchConfig
  | LinearConfig
  | TimeDecayConfig
  | UShapedConfig
  | CustomConfig

/**
 * Shared across all model types: C9 account-based rollup. When true (the
 * DEFAULT), a deal's touchpoints include its company SIBLING contacts (B2B —
 * a touch often sits on a colleague, not the deal's own contact). Set false to
 * narrow attribution to the deal's OWN contact(s), for orgs where company-wide
 * rollup over-dilutes credit across unrelated touches.
 */
export interface AttributionConfigBase {
  accountRollup?: boolean
}
export interface FirstTouchConfig extends AttributionConfigBase {
  modelType: "first_touch"
}
export interface LastTouchConfig extends AttributionConfigBase {
  modelType: "last_touch"
}
export interface LinearConfig extends AttributionConfigBase {
  modelType: "linear"
}

/**
 * Time-decay weights toward conversion using exponential half-life.
 * Weight at age `t` days from conversion = 2^(-t / halfLifeDays).
 * Older touchpoints decay; touchpoint at conversion time has weight 1.
 */
export interface TimeDecayConfig extends AttributionConfigBase {
  modelType: "time_decay"
  halfLifeDays: number
}

/**
 * U-shaped: emphasis on first + last with smaller middle. Three weights
 * MUST sum to 1.0. Salesforce defaults: first=0.4, last=0.4, middle=0.2.
 */
export interface UShapedConfig extends AttributionConfigBase {
  modelType: "u_shaped"
  firstWeight: number
  lastWeight: number
  /** Total credit distributed across middle touchpoints (split evenly). */
  middleWeight: number
}

/**
 * Slice-3 user-defined curve. Each entry maps a normalized position
 * (0 = first touchpoint, 1 = conversion) to a relative weight.
 * Curve is interpolated + renormalized so weights sum to 1.0.
 */
export interface CustomConfig extends AttributionConfigBase {
  modelType: "custom"
  curve: { position: number; weight: number }[]
}

// ── Touchpoint input shape (for helpers) ────────────────────────

/**
 * Slim representation of a touchpoint used by model-evaluator etc.
 * The DB row has more columns; helpers only need these.
 */
export interface TouchpointForAttribution {
  touchpointId: string
  campaignId: string
  occurredAt: Date
  /**
   * Interaction type (e.g. email_clicked, email_opened, event_registered,
   * deal_campaign_link). Drives engagement weighting + de-dup (#12). Optional:
   * positional models work without it; engagement weighting treats an absent
   * type as the neutral default.
   */
  touchpointType?: string
}

/**
 * Output of model-evaluator: per-touchpoint weight in [0, 1].
 * Sum across all entries = 1.0 if the input set was non-empty.
 */
export interface TouchpointWeight {
  touchpointId: string
  campaignId: string
  weight: number
}

// ── Influence row (post-aggregation) ────────────────────────────

/**
 * Output of touchpoint-aggregator: per-campaign rolled-up credit.
 * Sum across all entries = 1.0 (slice-2 worker writes these rows).
 */
export interface CampaignInfluenceComputed {
  campaignId: string
  weight: number
  touchpointCount: number
}

// ── Defaults ────────────────────────────────────────────────────

export const DEFAULT_TIME_DECAY_HALF_LIFE_DAYS = 7
export const DEFAULT_U_SHAPED_FIRST = 0.4
export const DEFAULT_U_SHAPED_LAST = 0.4
export const DEFAULT_U_SHAPED_MIDDLE = 0.2
export const U_SHAPED_WEIGHT_SUM_TOLERANCE = 1e-6
