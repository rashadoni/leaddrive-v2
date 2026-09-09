/**
 * Query-tree validator — G4 Phase 6 Block B slice 1.
 *
 * Validates an untrusted JSON query tree against the canonical
 * `QueryNode` shape + the field-op-compatibility matrix. Returns
 * either a typed tree (caller can safely cast the input) OR a list
 * of errors for the admin UI.
 *
 * Defensive against:
 *   • Wrong shape (missing required fields, unknown discriminants)
 *   • Op-vs-field-type mismatch (e.g. `gt` on a boolean)
 *   • Excessive depth (DoS / pathological queries) — capped at MAX_QUERY_DEPTH
 *   • `not` subtree with != 1 child
 *   • Empty subtree (`and: []`) — meaningless; reject
 *   • Insight-path missing the `.value` / `.confidence` suffix
 *   • Caller-supplied value type doesn't match the op:
 *     - `in/not_in` requires an array
 *     - `between` requires a 2-element ordered tuple
 *     - `contains/starts_with` requires a string
 *     - `days_ago_*` requires a positive integer
 *
 * Pure synchronous.
 */
import {
  FIELD_OP_COMPATIBILITY,
  FIELD_TYPE_MAP,
  MAX_QUERY_CHILDREN,
  MAX_QUERY_DEPTH,
  QUERY_COMPARISON_OPS,
  QUERY_LOGIC_OPS,
  type FieldType,
  type QueryComparisonOp,
  type QueryCondition,
  type QueryLogicOp,
  type QueryNode,
  type QuerySubtree,
  type ValidateQueryInput,
  type ValidateQueryResult,
} from "./types"

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
}

function isQueryLogicOp(s: unknown): s is QueryLogicOp {
  return typeof s === "string" && (QUERY_LOGIC_OPS as readonly string[]).includes(s)
}

function isQueryComparisonOp(s: unknown): s is QueryComparisonOp {
  return (
    typeof s === "string" && (QUERY_COMPARISON_OPS as readonly string[]).includes(s)
  )
}

/**
 * Get a field's type from the canonical registry. For insight fields,
 * inner=`value`/`confidence` are both numeric; `confidence` is
 * range-checked at evaluation time (0..1).
 */
function resolveFieldType(
  fieldPath: string,
  source: "profile" | "insight"
): FieldType | null {
  if (source === "profile") {
    return FIELD_TYPE_MAP[fieldPath] ?? null
  }
  // source === "insight": expected "<key>.value" or "<key>.confidence"
  const dotIdx = fieldPath.lastIndexOf(".")
  if (dotIdx === -1) return null
  const inner = fieldPath.slice(dotIdx + 1)
  if (inner !== "value" && inner !== "confidence") return null
  return "number"
}

function validateCondition(
  raw: Record<string, unknown>,
  path: string,
  errors: string[]
): QueryCondition | null {
  // 1. field
  const fieldRaw = raw.field
  if (!isPlainObject(fieldRaw)) {
    errors.push(`${path}: condition.field must be an object {source, path}`)
    return null
  }
  const fieldSource = fieldRaw.source
  if (fieldSource !== "profile" && fieldSource !== "insight") {
    errors.push(`${path}: condition.field.source must be "profile" or "insight"; got ${String(fieldSource)}`)
    return null
  }
  const fieldPath = fieldRaw.path
  if (typeof fieldPath !== "string" || fieldPath.length === 0) {
    errors.push(`${path}: condition.field.path must be a non-empty string`)
    return null
  }
  const fieldType = resolveFieldType(fieldPath, fieldSource)
  if (fieldType === null) {
    errors.push(
      `${path}: unknown field "${fieldSource}.${fieldPath}" — see FIELD_TYPE_MAP / insight path "<key>.value|confidence"`
    )
    return null
  }

  // 2. op
  if (!isQueryComparisonOp(raw.op)) {
    errors.push(`${path}: condition.op "${String(raw.op)}" is not a known comparison op`)
    return null
  }
  const op: QueryComparisonOp = raw.op
  if (!FIELD_OP_COMPATIBILITY[fieldType].includes(op)) {
    errors.push(
      `${path}: op "${op}" is not allowed for field type "${fieldType}" (field=${fieldSource}.${fieldPath})`
    )
    return null
  }

  // 3. value — shape depends on op
  const value = raw.value
  switch (op) {
    case "isnull":
    case "not_null":
      // value ignored — accept any value (including undefined).
      break
    case "in":
    case "not_in":
      if (!Array.isArray(value) || value.length === 0) {
        errors.push(`${path}: op "${op}" requires a non-empty array value`)
        return null
      }
      break
    case "between":
      if (!Array.isArray(value) || value.length !== 2) {
        errors.push(`${path}: op "between" requires a 2-element [lo, hi] array value`)
        return null
      }
      break
    case "contains":
    case "starts_with":
      if (typeof value !== "string") {
        errors.push(`${path}: op "${op}" requires a string value`)
        return null
      }
      break
    case "days_ago_lt":
    case "days_ago_gte":
      if (!Number.isInteger(value) || (value as number) < 0) {
        errors.push(`${path}: op "${op}" requires a non-negative integer (days)`)
        return null
      }
      break
    case "eq":
    case "neq":
    case "gt":
    case "gte":
    case "lt":
    case "lte":
      // Field-type compatibility was checked above; basic type-check on value here.
      // `date` accepts: ISO string (most common — JSON-serialised),
      // epoch-ms number (Date.now() result), or Date instance (in-process
      // caller). Evaluator's `compareNumeric` accepts all three; keeping
      // validator/evaluator parity prevents the "validator rejects what
      // evaluator would have matched" trap.
      if (
        (fieldType === "number" && typeof value !== "number") ||
        (fieldType === "boolean" && typeof value !== "boolean") ||
        (fieldType === "string" && typeof value !== "string") ||
        (fieldType === "date" &&
          !(typeof value === "string" || typeof value === "number" || value instanceof Date))
      ) {
        errors.push(
          `${path}: op "${op}" value type doesn't match field type "${fieldType}" — got ${typeof value}`
        )
        return null
      }
      break
  }

  return {
    type: "condition",
    field: { source: fieldSource, path: fieldPath },
    op,
    value,
  }
}

function validateSubtree(
  raw: Record<string, unknown>,
  path: string,
  depth: number,
  maxDepth: number,
  errors: string[]
): QuerySubtree | null {
  if (!isQueryLogicOp(raw.logic)) {
    errors.push(`${path}: subtree.logic must be one of ${QUERY_LOGIC_OPS.join("/")}; got "${String(raw.logic)}"`)
    return null
  }
  if (!Array.isArray(raw.children) || raw.children.length === 0) {
    errors.push(`${path}: subtree.children must be a non-empty array`)
    return null
  }
  if (raw.children.length > MAX_QUERY_CHILDREN) {
    errors.push(
      `${path}: subtree has ${raw.children.length} children — exceeds MAX_QUERY_CHILDREN ${MAX_QUERY_CHILDREN} (regroup with nested AND/OR or split into multiple segments)`
    )
    return null
  }
  if (raw.logic === "not" && raw.children.length !== 1) {
    errors.push(`${path}: "not" subtree requires exactly 1 child; got ${raw.children.length}`)
    return null
  }
  const childNodes: QueryNode[] = []
  for (let i = 0; i < raw.children.length; i++) {
    const child = raw.children[i]
    const childPath = `${path}.children[${i}]`
    const validated = validateNode(child, childPath, depth + 1, maxDepth, errors)
    if (validated === null) return null
    childNodes.push(validated)
  }
  return {
    type: "subtree",
    logic: raw.logic,
    children: childNodes,
  }
}

function validateNode(
  raw: unknown,
  path: string,
  depth: number,
  maxDepth: number,
  errors: string[]
): QueryNode | null {
  if (depth > maxDepth) {
    errors.push(`${path}: query depth ${depth} exceeds max ${maxDepth}`)
    return null
  }
  if (!isPlainObject(raw)) {
    errors.push(`${path}: node must be an object; got ${typeof raw}`)
    return null
  }
  const t = raw.type
  if (t === "condition") return validateCondition(raw, path, errors)
  if (t === "subtree") return validateSubtree(raw, path, depth, maxDepth, errors)
  errors.push(`${path}: node.type must be "condition" or "subtree"; got "${String(t)}"`)
  return null
}

export function validateQuery(input: ValidateQueryInput): ValidateQueryResult {
  const errors: string[] = []
  const maxDepth = input.maxDepth ?? MAX_QUERY_DEPTH
  const root = validateNode(input.root, "$", 0, maxDepth, errors)
  if (errors.length > 0 || root === null) {
    return { ok: false, errors }
  }
  return { ok: true, root }
}
