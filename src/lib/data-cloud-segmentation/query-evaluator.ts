/**
 * In-memory query-tree evaluator — G4 Phase 6 Block B slice 1.
 *
 * Given a validated `QueryNode` + a profile + its insights, return
 * boolean "does this profile match the segment query?"
 *
 * Used by:
 *   • Unit tests that verify query semantics
 *   • Slice-2 ad-hoc preview ("show me 5 matching profiles for this
 *     query before I save it")
 *   • Slice-3 real-time membership recompute on profile updates
 *
 * Slice-2 query-translator (JSON → Prisma where) handles bulk scans;
 * this in-memory evaluator's semantics MUST match the translator's
 * SQL output so the preview and the cron produce identical
 * membership decisions.
 *
 * Pure synchronous.
 */
import { FIELD_TYPE_MAP } from "./types"
import type {
  EvaluatorInput,
  EvaluatorInsight,
  EvaluatorProfile,
  EvaluatorResult,
  QueryComparisonOp,
  QueryCondition,
  QueryFieldRef,
  QueryNode,
} from "./types"

const MS_PER_DAY = 24 * 60 * 60 * 1000

/**
 * Resolve a field reference to its current value on the profile +
 * insights snapshot. Returns `null` for absent fields — callers that
 * want strict "missing field = no match" should use `isnull`/`not_null`.
 *
 * Defense-in-depth: re-checks the profile path against FIELD_TYPE_MAP
 * even though the validator already gates it. This blocks prototype-
 * chain access (`__proto__`, `constructor`, `toString`, etc.) if a
 * caller bypasses the validator (test fixture, slice-2 internal
 * helper that mutates a tree post-validation). For `insight` paths
 * the `dot` parser already requires the `<key>.value|.confidence`
 * shape, so prototype keys can't slip in.
 */
function resolveFieldValue(
  ref: QueryFieldRef,
  input: EvaluatorInput
): unknown {
  if (ref.source === "profile") {
    // Allowlist guard — rejects any key not in FIELD_TYPE_MAP.
    if (!Object.prototype.hasOwnProperty.call(FIELD_TYPE_MAP, ref.path)) {
      return null
    }
    const k = ref.path as keyof EvaluatorProfile
    return input.profile[k] ?? null
  }
  // source === "insight": path = "<key>.value" | "<key>.confidence"
  const dotIdx = ref.path.lastIndexOf(".")
  if (dotIdx === -1) return null
  const key = ref.path.slice(0, dotIdx)
  const inner = ref.path.slice(dotIdx + 1)
  if (inner !== "value" && inner !== "confidence") return null
  const reading: EvaluatorInsight | undefined = input.insights[key]
  if (!reading) return null
  if (inner === "value") return reading.value ?? null
  return reading.confidence ?? null
}

function toDate(v: unknown): Date | null {
  if (v instanceof Date) return Number.isFinite(v.getTime()) ? v : null
  if (typeof v === "string") {
    const d = new Date(v)
    return Number.isFinite(d.getTime()) ? d : null
  }
  return null
}

function compareNumeric(actual: unknown, expected: unknown, op: QueryComparisonOp): boolean {
  // Cast dates to ms for numeric comparison
  let a: number, b: number
  if (actual instanceof Date) {
    a = actual.getTime()
  } else if (typeof actual === "number") {
    a = actual
  } else {
    return false
  }
  if (expected instanceof Date) {
    b = expected.getTime()
  } else if (typeof expected === "number") {
    b = expected
  } else if (typeof expected === "string") {
    // For date columns the value may arrive as ISO string post-JSON-deserialize.
    const d = new Date(expected)
    if (!Number.isFinite(d.getTime())) return false
    b = d.getTime()
  } else {
    return false
  }
  switch (op) {
    case "eq": return a === b
    case "neq": return a !== b
    case "gt": return a > b
    case "gte": return a >= b
    case "lt": return a < b
    case "lte": return a <= b
    default: return false
  }
}

function evaluateCondition(
  cond: QueryCondition,
  input: EvaluatorInput
): boolean {
  const actual = resolveFieldValue(cond.field, input)
  const { op, value } = cond

  // null / not_null handled regardless of op-specific value rules.
  if (op === "isnull") return actual === null
  if (op === "not_null") return actual !== null

  // Absent field never matches any other op.
  if (actual === null) return false

  switch (op) {
    case "eq":
    case "neq":
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      // Numeric / date path
      if (typeof actual === "number" || actual instanceof Date) {
        return compareNumeric(actual, value, op)
      }
      // String / boolean equality only (gt/lt on strings is left to slice-2 if needed)
      if (op === "eq") return actual === value
      if (op === "neq") return actual !== value
      return false
    }

    case "in": {
      if (!Array.isArray(value)) return false
      return value.includes(actual)
    }
    case "not_in": {
      if (!Array.isArray(value)) return true
      return !value.includes(actual)
    }

    case "contains": {
      // string_array field — actual is a readonly string[]
      if (!Array.isArray(actual)) return false
      return actual.includes(value as string)
    }

    case "starts_with": {
      if (typeof actual !== "string" || typeof value !== "string") return false
      return actual.startsWith(value)
    }

    case "between": {
      if (!Array.isArray(value) || value.length !== 2) return false
      const [lo, hi] = value
      // Cast lo / hi via the same numeric/date path. Inclusive both ends.
      if (actual instanceof Date || typeof actual === "number") {
        return (
          compareNumeric(actual, lo, "gte") && compareNumeric(actual, hi, "lte")
        )
      }
      return false
    }

    case "days_ago_lt":
    case "days_ago_gte": {
      // actual must be a date; value is a positive integer (days).
      const actualDate = toDate(actual)
      if (actualDate === null) return false
      if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
        return false
      }
      const asOf = input.asOf ?? new Date()
      const daysAgo = (asOf.getTime() - actualDate.getTime()) / MS_PER_DAY
      if (op === "days_ago_lt") return daysAgo < value
      return daysAgo >= value // days_ago_gte
    }
  }
}

function evaluateNode(node: QueryNode, input: EvaluatorInput): boolean {
  if (node.type === "condition") return evaluateCondition(node, input)
  // subtree
  const childResults = node.children.map((c) => evaluateNode(c, input))
  if (node.logic === "and") return childResults.every(Boolean)
  if (node.logic === "or") return childResults.some(Boolean)
  // not — validator ensures exactly 1 child
  return !childResults[0]
}

export function evaluateQuery(
  root: QueryNode,
  input: EvaluatorInput
): EvaluatorResult {
  try {
    const matched = evaluateNode(root, input)
    return { ok: true, matched }
  } catch (e) {
    // Defensive — validator should have rejected malformed input upstream,
    // but if a bug here surfaces at evaluation time, surface a clean error.
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, error: `Evaluator runtime error: ${msg}` }
  }
}
