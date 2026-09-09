/**
 * Rollup Summary types — N6 Phase 4 slice 1.
 *
 * Salesforce-style aggregations: a `RollupField` on a parent entity
 * computes count/sum/avg/min/max over its children (filtered by an
 * optional predicate). The computed value is persisted per-parent in
 * `RollupValue` so reads are O(1) instead of O(children).
 *
 * Slice 1 ships definition + manual recompute. Slice 2 hooks Prisma
 * middleware so child mutations incrementally update affected
 * parents' `RollupValue` rows.
 */

export type AggregateFn = "count" | "sum" | "avg" | "min" | "max"

/** Predicate operators supported in the slice-1 filter spec. */
export type FilterOp =
  | "eq"     // strict equality
  | "ne"     // strict inequality
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "in"     // value ∈ [array]
  | "nin"    // value ∉ [array]
  | "isnull"
  | "notnull"

export interface FilterPredicate {
  field: string
  op: FilterOp
  /** Right-hand-side value. For `in`/`nin` this is an array; for
   * `isnull`/`notnull` it is ignored. */
  value?: unknown
}

/**
 * Slice-1 filter spec: array of predicates AND-joined. Empty array =
 * no filter (matches every child). Slice 2 widens to nested AND/OR.
 */
export type FilterSpec = readonly FilterPredicate[]

/** Full spec for one rollup. Mirrors `RollupField` row + parsed filter. */
export interface RollupSpec {
  id: string
  name: string
  parentEntity: string
  childEntity: string
  aggregate: AggregateFn
  /** Required for sum/avg/min/max; null for count. */
  aggregateField: string | null
  parentKey: string
  filter: FilterSpec
}

/** Single (rollupSpec, parent) computation outcome. */
export interface RollupComputation {
  parentId: string
  numericValue: number | null
  childCount: number
}

/** Bulk-recompute result returned by the orchestrator. */
export interface RollupRecomputeResult {
  rollupFieldId: string
  parentsConsidered: number
  parentsWithChildren: number
  childRowsScanned: number
}
