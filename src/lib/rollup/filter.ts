/**
 * Filter predicate evaluator — N6 Phase 4 slice 1.
 *
 * Pure synchronous predicate AND-join. Each predicate matches one
 * field on a child record against a literal (or an array, for in/nin).
 * Slice 2 widens to nested expressions (AND/OR/NOT trees) — for now
 * the simple flat AND covers the common Salesforce rollup filter UX
 * (e.g. "stage = 'won' AND amount > 1000").
 */
import { coerceNumeric } from "./aggregator"
import type { FilterPredicate, FilterSpec, FilterOp } from "./types"

function isPrimitive(v: unknown): v is string | number | boolean {
  return typeof v === "string" || typeof v === "number" || typeof v === "boolean"
}

function compareScalar(a: unknown, b: unknown): number {
  if (a == null || b == null) return NaN
  if (typeof a === "number" && typeof b === "number") return a - b
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime()
  if (a instanceof Date && typeof b === "string") {
    const bd = Date.parse(b)
    return Number.isNaN(bd) ? NaN : a.getTime() - bd
  }
  if (typeof a === "string" && b instanceof Date) {
    const ad = Date.parse(a)
    return Number.isNaN(ad) ? NaN : ad - b.getTime()
  }
  // Numeric-coercion fallback: align with aggregator's `coerceNumeric`
  // so a string column with numeric content ("100") gets compared as
  // a number against `value: 50`, not as a lexicographic string
  // ("100" < "50" because '1' < '5'). When EITHER side is a number
  // and the other coerces cleanly to one, do a numeric compare.
  if (typeof a === "number" || typeof b === "number") {
    const na = typeof a === "number" ? a : coerceNumeric(a)
    const nb = typeof b === "number" ? b : coerceNumeric(b)
    if (na != null && nb != null) return na - nb
  }
  if (isPrimitive(a) && isPrimitive(b)) {
    const sa = String(a)
    const sb = String(b)
    return sa < sb ? -1 : sa > sb ? 1 : 0
  }
  return NaN
}

/**
 * Evaluate one predicate against one record. Returns true when the
 * record matches the predicate; false otherwise. Unknown operators
 * throw — caller validates the spec at write time.
 */
export function evaluatePredicate(
  record: Record<string, unknown>,
  predicate: FilterPredicate
): boolean {
  const left = record[predicate.field]
  const op: FilterOp = predicate.op
  const right = predicate.value

  switch (op) {
    case "eq":
      // Strict equality with date normalisation. Malformed date string
      // → no match (both eq and ne yield false on NaN comparisons,
      // mirroring SQL three-valued logic for incomparable values).
      if (left instanceof Date && typeof right === "string") {
        const parsed = Date.parse(right)
        if (Number.isNaN(parsed)) return false
        return left.getTime() === parsed
      }
      return left === right
    case "ne":
      if (left instanceof Date && typeof right === "string") {
        const parsed = Date.parse(right)
        // Malformed date → ne returns false too (matches eq behaviour
        // above; otherwise `ne malformed` would always be true which
        // is a sharper edge than the consistent "incomparable → false"
        // rule applied across the gt/gte/lt/lte branches).
        if (Number.isNaN(parsed)) return false
        return left.getTime() !== parsed
      }
      return left !== right
    case "gt": {
      const d = compareScalar(left, right)
      return Number.isFinite(d) && d > 0
    }
    case "gte": {
      const d = compareScalar(left, right)
      return Number.isFinite(d) && d >= 0
    }
    case "lt": {
      const d = compareScalar(left, right)
      return Number.isFinite(d) && d < 0
    }
    case "lte": {
      const d = compareScalar(left, right)
      return Number.isFinite(d) && d <= 0
    }
    case "in":
      if (!Array.isArray(right)) return false
      return right.includes(left)
    case "nin":
      if (!Array.isArray(right)) return true
      return !right.includes(left)
    case "isnull":
      return left == null
    case "notnull":
      return left != null
    default: {
      const exhaustive: never = op
      throw new Error(`Unsupported filter op: ${exhaustive}`)
    }
  }
}

/**
 * Run the full AND-joined predicate chain. Empty spec → matches every
 * record (Salesforce rollup default).
 */
export function matchesFilter(
  record: Record<string, unknown>,
  filter: FilterSpec
): boolean {
  for (const p of filter) {
    if (!evaluatePredicate(record, p)) return false
  }
  return true
}

/**
 * Defensive runtime parser for a `filterJson` blob stored on
 * `RollupField.filterJson`. Caller validates at write time too (Zod);
 * this is the second line of defence at read time.
 */
export function parseFilterSpec(raw: unknown): FilterSpec {
  if (raw == null) return []
  if (!Array.isArray(raw)) {
    throw new Error("filterJson must be an array of predicates")
  }
  const out: FilterPredicate[] = []
  const validOps: ReadonlySet<FilterOp> = new Set([
    "eq", "ne", "gt", "gte", "lt", "lte", "in", "nin", "isnull", "notnull",
  ])
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") {
      throw new Error("filterJson entry must be an object")
    }
    const obj = entry as Record<string, unknown>
    const field = obj.field
    const op = obj.op
    if (typeof field !== "string" || field.length === 0) {
      throw new Error("filterJson entry missing string `field`")
    }
    if (typeof op !== "string" || !validOps.has(op as FilterOp)) {
      throw new Error(`filterJson entry has unsupported op: ${String(op)}`)
    }
    out.push({ field, op: op as FilterOp, value: obj.value })
  }
  return out
}
