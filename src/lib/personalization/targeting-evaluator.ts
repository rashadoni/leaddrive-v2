/**
 * Targeting evaluator — C4 slice 1.
 *
 * Given visitor context + targeting rules, returns boolean match +
 * per-predicate trace for slice-2 debug UI.
 *
 * Rules shape:
 *   { allOf?: TargetingPredicate[], anyOf?: TargetingPredicate[], noneOf?: TargetingPredicate[] }
 *
 * Semantics:
 *   • allOf: every predicate must match (AND).
 *   • anyOf: at least one predicate must match (OR).
 *   • noneOf: no predicate may match (NOT).
 *   • Empty rules (no buckets) → match=true (degenerate "everyone").
 *   • Predicate against missing field → no-match (defensive, slice-2 may
 *     parameterise to allow "missing == not-equal").
 *
 * Pure synchronous. Defense-in-depth:
 *   • Object.prototype.hasOwnProperty.call on field reads.
 *   • Forbidden field/segment slug check.
 *   • Per-source value resolver — visitor/profile/segment.
 */
import {
  FIELD_SOURCES,
  PREDICATE_OPS,
  type EvaluateTargetingInput,
  type EvaluateTargetingResult,
  type PredicateOp,
  type TargetingPredicate,
  type VisitorContext,
} from "./types"

const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"])

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
}

function has(o: Record<string, unknown>, k: string): boolean {
  return Object.prototype.hasOwnProperty.call(o, k)
}

/* ─── Field-value resolution ──────────────────────────────────────────── */

function resolveValue(
  predicate: TargetingPredicate,
  visitor: VisitorContext
): unknown {
  if (FORBIDDEN_KEYS.has(predicate.field)) return null
  switch (predicate.source) {
    case "visitor": {
      if (!visitor.attributes || !isPlainObject(visitor.attributes)) return null
      if (!has(visitor.attributes, predicate.field)) return null
      return visitor.attributes[predicate.field]
    }
    case "profile": {
      if (!visitor.profile || !isPlainObject(visitor.profile)) return null
      if (!has(visitor.profile, predicate.field)) return null
      return visitor.profile[predicate.field]
    }
    case "segment": {
      // For segment source, `field` is the segment slug and we return
      // a boolean indicating membership. Ops like eq/in operate on the
      // boolean; ops like contains don't apply.
      const segments = visitor.segmentMembership ?? []
      return segments.includes(predicate.field)
    }
  }
}

/* ─── Per-op evaluation ───────────────────────────────────────────────── */

function evaluatePredicate(
  p: TargetingPredicate,
  visitor: VisitorContext
): { matched: boolean; reason?: string } {
  if (!(PREDICATE_OPS as readonly string[]).includes(p.op)) {
    return { matched: false, reason: `unknown op "${String(p.op)}"` }
  }
  if (!(FIELD_SOURCES as readonly string[]).includes(p.source)) {
    return { matched: false, reason: `unknown source "${String(p.source)}"` }
  }
  if (typeof p.field !== "string" || p.field.length === 0) {
    return { matched: false, reason: "field must be a non-empty string" }
  }

  // null/not_null don't read p.value.
  if (p.op === "isnull") {
    const v = resolveValue(p, visitor)
    return { matched: v === null || v === undefined }
  }
  if (p.op === "not_null") {
    const v = resolveValue(p, visitor)
    return { matched: v !== null && v !== undefined }
  }

  const v = resolveValue(p, visitor)
  if (v === null || v === undefined) {
    return { matched: false, reason: "field missing/null" }
  }

  switch (p.op) {
    case "eq":
      return { matched: v === p.value }
    case "neq":
      return { matched: v !== p.value }
    case "in":
      if (!Array.isArray(p.value)) {
        return { matched: false, reason: "in: value must be array" }
      }
      return { matched: (p.value as unknown[]).includes(v) }
    case "not_in":
      if (!Array.isArray(p.value)) {
        return { matched: false, reason: "not_in: value must be array" }
      }
      return { matched: !(p.value as unknown[]).includes(v) }
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      if (typeof v !== "number" || typeof p.value !== "number") {
        return { matched: false, reason: `${p.op} requires numeric operands` }
      }
      switch (p.op) {
        case "gt":
          return { matched: v > p.value }
        case "gte":
          return { matched: v >= p.value }
        case "lt":
          return { matched: v < p.value }
        case "lte":
          return { matched: v <= p.value }
      }
      return { matched: false }
    }
    case "contains": {
      // contains: string-contains or array-contains. Slice-1 simple.
      if (typeof v === "string" && typeof p.value === "string") {
        return { matched: v.includes(p.value) }
      }
      if (Array.isArray(v)) {
        return { matched: v.includes(p.value as never) }
      }
      return { matched: false, reason: "contains: value/operand type mismatch" }
    }
    // isnull / not_null handled above.
    default:
      return { matched: false, reason: `unhandled op "${String(p.op)}"` }
  }
}

/* ─── Main entry ──────────────────────────────────────────────────────── */

export function evaluateTargeting(
  input: EvaluateTargetingInput
): EvaluateTargetingResult {
  const trace: EvaluateTargetingResult["trace"] = []
  if (!input.rules || typeof input.rules !== "object") {
    return { matched: false, trace }
  }
  if (!input.visitor || typeof input.visitor !== "object") {
    return { matched: false, trace }
  }
  if (typeof input.visitor.visitorId !== "string" || input.visitor.visitorId.length === 0) {
    return { matched: false, trace }
  }

  const { allOf, anyOf, noneOf } = input.rules

  // Empty rules → match everyone.
  if (
    (!allOf || allOf.length === 0) &&
    (!anyOf || anyOf.length === 0) &&
    (!noneOf || noneOf.length === 0)
  ) {
    return { matched: true, trace }
  }

  // allOf: short-circuit on first miss.
  if (allOf && allOf.length > 0) {
    for (let i = 0; i < allOf.length; i++) {
      const result = evaluatePredicate(allOf[i], input.visitor)
      trace.push({
        bucket: "allOf",
        index: i,
        predicate: allOf[i],
        matched: result.matched,
        reason: result.reason,
      })
      if (!result.matched) {
        return { matched: false, trace }
      }
    }
  }

  // anyOf: short-circuit on first hit.
  if (anyOf && anyOf.length > 0) {
    let anyHit = false
    for (let i = 0; i < anyOf.length; i++) {
      const result = evaluatePredicate(anyOf[i], input.visitor)
      trace.push({
        bucket: "anyOf",
        index: i,
        predicate: anyOf[i],
        matched: result.matched,
        reason: result.reason,
      })
      if (result.matched) {
        anyHit = true
        break
      }
    }
    if (!anyHit) return { matched: false, trace }
  }

  // noneOf: short-circuit on first hit (which means rejection).
  if (noneOf && noneOf.length > 0) {
    for (let i = 0; i < noneOf.length; i++) {
      const result = evaluatePredicate(noneOf[i], input.visitor)
      trace.push({
        bucket: "noneOf",
        index: i,
        predicate: noneOf[i],
        matched: result.matched,
        reason: result.reason,
      })
      if (result.matched) {
        return { matched: false, trace }
      }
    }
  }

  return { matched: true, trace }
}
