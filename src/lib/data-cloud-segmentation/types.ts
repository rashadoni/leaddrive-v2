/**
 * Data Cloud Segmentation types — G4 Phase 6 Block B slice 1.
 *
 * Salesforce Segment Builder analogue. Query-tree shape + canonical
 * field-path registry for filtering UnifiedProfile + ProfileInsight
 * data.
 *
 * Two pure-helper workflows ship in slice 1:
 *   1. query-validator — shape-check the JSON tree before insert
 *      (depth limit, op compatibility per field type, value type).
 *   2. query-evaluator — given a profile + its insights, return
 *      boolean "is this profile in the segment?" Used for unit-test
 *      verification and small-scale runtime checks; slice-2 query-
 *      translator generates a Prisma where-clause for bulk scans.
 *
 * Slice 2 wires:
 *   • JSON tree → Prisma where translator (bulk membership scan).
 *   • Refresh cron that UPSERTs `DataCloudSegmentMembership` rows.
 *   • Builder UI (admin) over `query` field.
 * Slice 3 wires G5 activation pipeline (push membership → ad audiences).
 */

/* ─── Query tree shape ────────────────────────────────────────────────── */

export const QUERY_LOGIC_OPS = ["and", "or", "not"] as const
export type QueryLogicOp = (typeof QUERY_LOGIC_OPS)[number]

/**
 * Per-field comparison operators. The validator enforces which ops
 * apply to which field type (see FIELD_OP_COMPATIBILITY below).
 *
 *   eq / neq     — number, string, boolean
 *   gt / gte / lt / lte — number, date
 *   in / not_in  — value lists (string[] / number[])
 *   contains     — string[] (channelsActive) — "is X a member of the array"
 *   starts_with  — string (email prefix match)
 *   isnull / not_null — any nullable field
 *   between      — number / date (inclusive both ends)
 *   days_ago_lt / days_ago_gte — date fields, expressed as "N days ago"
 *                                vs the evaluator's asOf timestamp
 */
export const QUERY_COMPARISON_OPS = [
  "eq",
  "neq",
  "gt",
  "gte",
  "lt",
  "lte",
  "in",
  "not_in",
  "contains",
  "starts_with",
  "isnull",
  "not_null",
  "between",
  "days_ago_lt",
  "days_ago_gte",
] as const

export type QueryComparisonOp = (typeof QUERY_COMPARISON_OPS)[number]

/* ─── Field path registry ─────────────────────────────────────────────── */

/**
 * Available fields. `source` distinguishes profile-level columns
 * from insight values (which require a `path` like `ltv.value` to
 * pick which insight + which inner field).
 *
 * Adding a new field requires:
 *   1. Extend `FIELD_TYPE_MAP` below
 *   2. Extend `FIELD_OP_COMPATIBILITY` with allowed ops
 *   3. Extend the evaluator's accessor switch
 *   4. (slice 2) Extend the Prisma-where translator
 */
export type QueryFieldSource = "profile" | "insight"

export interface QueryFieldRef {
  source: QueryFieldSource
  /**
   * For source='profile': one of the FIELD_TYPE_MAP keys below
   * (e.g. "totalSpent", "channelsActive", "lastSeenAt").
   * For source='insight': "<insightKey>.<inner>" where inner is
   *   "value" or "confidence" — e.g. "ltv.value", "churn_risk.value".
   */
  path: string
}

/**
 * Field type used to gate which operators are valid. The
 * validator looks up the field's type and rejects ops that don't
 * fit (e.g. `gt` on a boolean field, `contains` on a number).
 */
export type FieldType =
  | "number"
  | "string"
  | "boolean"
  | "date"
  | "string_array"

/**
 * Canonical profile-level field registry. Adding a Prisma column to
 * UnifiedProfile does NOT auto-add a queryable field here — same
 * defense-in-depth as G1's PublicProduct filter (G6 lib).
 */
export const FIELD_TYPE_MAP: Readonly<Record<string, FieldType>> = {
  // UnifiedProfile aggregate columns
  totalSpent: "number",
  lifetimeOrderCount: "number",
  firstSeenAt: "date",
  lastSeenAt: "date",
  channelsActive: "string_array",
  primaryCurrency: "string",
  emailNormalized: "string",
  phoneNormalized: "string",
}

/**
 * Allowed operators per field type. Validator gates by intersecting
 * `FIELD_OP_COMPATIBILITY[type]` with the caller-supplied op.
 */
export const FIELD_OP_COMPATIBILITY: Readonly<
  Record<FieldType, readonly QueryComparisonOp[]>
> = {
  number: ["eq", "neq", "gt", "gte", "lt", "lte", "in", "not_in", "between", "isnull", "not_null"],
  string: ["eq", "neq", "in", "not_in", "starts_with", "isnull", "not_null"],
  // RESERVED: no boolean field exists in FIELD_TYPE_MAP today, but the
  // type+op pairing is fixed here so adding one in a later slice (e.g.
  // "isVip", "isSubscribed") doesn't require touching the matrix
  // alongside the field-map. Drift guard test pins the row.
  boolean: ["eq", "neq", "isnull", "not_null"],
  date: ["eq", "neq", "gt", "gte", "lt", "lte", "between", "isnull", "not_null", "days_ago_lt", "days_ago_gte"],
  string_array: ["contains", "isnull", "not_null"],
}

/* ─── Query node types ────────────────────────────────────────────────── */

export interface QueryCondition {
  type: "condition"
  field: QueryFieldRef
  op: QueryComparisonOp
  /**
   * Value shape depends on op:
   *   eq/neq/gt/gte/lt/lte — number | string | boolean (matches field type)
   *   in/not_in            — number[] | string[]
   *   between              — [number, number] | [string, string] (date ISO)
   *   contains             — string (member to check in string_array)
   *   starts_with          — string
   *   isnull/not_null      — null (value ignored)
   *   days_ago_lt/days_ago_gte — number (positive integer days)
   */
  value: unknown
}

export interface QuerySubtree {
  type: "subtree"
  logic: QueryLogicOp
  /** Children: nested subtrees AND/OR direct conditions. `not` requires exactly 1 child. */
  children: readonly QueryNode[]
}

export type QueryNode = QueryCondition | QuerySubtree

/* ─── Validator I/O ───────────────────────────────────────────────────── */

export const MAX_QUERY_DEPTH = 8

/**
 * Max children per subtree node. Defends against pathological "flat
 * but wide" queries (a single AND with 100K conditions) that bypass
 * MAX_QUERY_DEPTH and would DoS the slice-2 Prisma-where translator
 * (each child becomes a clause in the generated SQL). 32 covers
 * realistic Salesforce-style Segment Builder usage; admin UI exposes
 * grouping for anything beyond.
 */
export const MAX_QUERY_CHILDREN = 32

export interface ValidateQueryInput {
  root: unknown
  /** Optional override of MAX_QUERY_DEPTH. */
  maxDepth?: number
}

export type ValidateQueryResult =
  | { ok: true; root: QueryNode }
  | { ok: false; errors: string[] }

/* ─── Evaluator I/O ───────────────────────────────────────────────────── */

/**
 * Profile shape the evaluator reads. Loose-typed — caller pre-fetches
 * the relevant fields. Mirrors a subset of G1 UnifiedProfile.
 */
export interface EvaluatorProfile {
  totalSpent: number | null
  lifetimeOrderCount: number | null
  firstSeenAt: Date | null
  lastSeenAt: Date | null
  channelsActive: readonly string[]
  primaryCurrency: string | null
  emailNormalized: string | null
  phoneNormalized: string | null
}

/** Single insight reading — value + confidence pair, keyed by insightDef.key. */
export interface EvaluatorInsight {
  value: number | null
  confidence: number | null
}

export interface EvaluatorInput {
  profile: EvaluatorProfile
  /** Map from insightDef.key → reading. Missing key = absent. */
  insights: Readonly<Record<string, EvaluatorInsight>>
  /** Caller-supplied asOf for `days_ago_*` ops. Defaults to now() in the evaluator. */
  asOf?: Date
}

export type EvaluatorResult =
  | { ok: true; matched: boolean }
  | { ok: false; error: string }
