/**
 * Personalization / Interaction Studio types — C4 Phase 6 Block G
 * slice 3 (closes Block G).
 *
 * Salesforce Interaction Studio analogue. Shared shape between 5
 * pure helpers:
 *   1. state-machine          — experience lifecycle transitions
 *   2. targeting-evaluator    — visitor profile × rules → match?
 *   3. variant-selector       — weighted-random + sticky assignment
 *   4. metrics-aggregator     — impressions / clicks / conversions / lift
 *   5. (re-exported)          — typed I/O for slice-2 decision API
 *
 * Pure — no Prisma imports.
 */

/* ─── Experience status + transitions ─────────────────────────────────── */

export const EXPERIENCE_STATUSES = ["draft", "active", "paused", "archived"] as const
export type ExperienceStatus = (typeof EXPERIENCE_STATUSES)[number]

/**
 *   draft → active | archived
 *   active → paused | archived
 *   paused → active | archived
 *   archived → []   (terminal; clone-to-draft is a new row)
 */
export const EXPERIENCE_TRANSITIONS: Readonly<
  Record<ExperienceStatus, readonly ExperienceStatus[]>
> = {
  draft: ["active", "archived"],
  active: ["paused", "archived"],
  paused: ["active", "archived"],
  archived: [],
}

/* ─── Sticky-assignment mode ──────────────────────────────────────────── */

export const STICKY_MODES = ["visitor", "contact", "none"] as const
export type StickyMode = (typeof STICKY_MODES)[number]

/* ─── Targeting rules ─────────────────────────────────────────────────── */

/**
 * Predicate operators. Mirrors a subset of G4 segmentation ops —
 * targeting-evaluator is a much simpler engine (single-level, no
 * subtree recursion) suited to real-time decisioning.
 */
export const PREDICATE_OPS = [
  "eq",
  "neq",
  "in",
  "not_in",
  "gt",
  "gte",
  "lt",
  "lte",
  "contains",
  "isnull",
  "not_null",
] as const

export type PredicateOp = (typeof PREDICATE_OPS)[number]

/**
 * Field source — visitor (cookie state), profile (UnifiedProfile),
 * or segment (boolean membership in a G4 DataCloudSegment).
 */
export const FIELD_SOURCES = ["visitor", "profile", "segment"] as const
export type FieldSource = (typeof FIELD_SOURCES)[number]

export interface TargetingPredicate {
  source: FieldSource
  /** Field name / segment slug. */
  field: string
  op: PredicateOp
  /** Comparison value — type depends on op. */
  value?: string | number | boolean | (string | number | boolean)[] | null
}

export interface TargetingRules {
  /** All predicates must match (AND). */
  allOf?: readonly TargetingPredicate[]
  /** At least one predicate must match (OR). */
  anyOf?: readonly TargetingPredicate[]
  /** No predicate may match (NOT). */
  noneOf?: readonly TargetingPredicate[]
}

/* ─── Targeting evaluator I/O ─────────────────────────────────────────── */

export interface VisitorContext {
  /** Pseudonymous cookie / localStorage id. */
  visitorId: string
  /** Optional logged-in Contact + UnifiedProfile correlations. */
  contactId?: string | null
  unifiedProfileId?: string | null
  /** Per-visitor state: pageviews, last-seen-at, custom attributes. */
  attributes?: Readonly<Record<string, string | number | boolean | null>>
  /** UnifiedProfile field snapshot — flat dotted-path map. */
  profile?: Readonly<Record<string, string | number | boolean | null>>
  /** Set of G4 DataCloudSegment slugs the visitor matches. */
  segmentMembership?: readonly string[]
}

export interface EvaluateTargetingInput {
  rules: TargetingRules
  visitor: VisitorContext
}

export interface EvaluateTargetingResult {
  /** True if rules match (visitor qualifies for this experience). */
  matched: boolean
  /** Per-predicate trace for slice-2 debug UI. */
  trace: {
    bucket: "allOf" | "anyOf" | "noneOf"
    index: number
    predicate: TargetingPredicate
    matched: boolean
    reason?: string
  }[]
}

/* ─── Variant selector I/O ────────────────────────────────────────────── */

export interface VariantSnapshot {
  id: string
  slug: string
  weight: number
  isControl: boolean
  isActive: boolean
}

export interface SelectVariantInput {
  variants: readonly VariantSnapshot[]
  /** Sticky-assignment key — visitor.visitorId or contact.contactId or random. */
  stickyKey: string | null
  /**
   * Optional rng — DI for test determinism. Returns [0, 1). Defaults
   * to a hash of stickyKey (when present) or Math.random().
   */
  rng?: () => number
}

export interface SelectVariantResult_OK {
  ok: true
  variant: VariantSnapshot
  /** Was the selection sticky (same visitor → same variant)? */
  wasSticky: boolean
}

export type SelectVariantResult =
  | SelectVariantResult_OK
  | { ok: false; error: string }

/* ─── Metrics aggregator I/O ──────────────────────────────────────────── */

/**
 * Per-variant snapshot — caller pre-fetches via grouped count queries.
 * Slice-2 metrics endpoint produces this shape.
 */
export interface VariantMetricsSnapshot {
  variantId: string
  variantSlug: string
  isControl: boolean
  decisions: number
  impressions: number
  clicks: number
  conversions: number
}

export interface AggregateMetricsInput {
  variants: readonly VariantMetricsSnapshot[]
}

export interface VariantPerformance {
  variantId: string
  variantSlug: string
  isControl: boolean
  decisions: number
  impressions: number
  clicks: number
  conversions: number
  /** Click-through rate: clicks / impressions. Null if no impressions. */
  ctr: number | null
  /** Conversion rate: conversions / impressions. Null if no impressions. */
  conversionRate: number | null
  /** Lift over control as fraction; null if control conversionRate is 0 or this IS control. */
  liftOverControlPct: number | null
}

export interface MetricsRollup {
  perVariant: VariantPerformance[]
  totals: {
    decisions: number
    impressions: number
    clicks: number
    conversions: number
  }
}

export type AggregateMetricsResult =
  | { ok: true; rollup: MetricsRollup }
  | { ok: false; error: string }
