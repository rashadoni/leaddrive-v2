/**
 * G6 subscription-filter-matcher — slice-1 pure helper.
 *
 * Given a published event payload + a subscription's filter spec, decide
 * whether the event should be delivered to this subscription. The
 * dispatcher (slice-2) calls this per (event × subscription) pair before
 * issuing the delivery attempt.
 *
 * Filter shape mirrors PayloadFilter in ./types — dot-path keys + an
 * object of predicates. Empty filter = deliver everything.
 */

import type { PayloadFilter, PayloadFilterPredicate } from "./types"

export interface MatchOptions {
  /** Optional eventType equality filter (subscription.eventTypeFilter). */
  eventTypeFilter?: string | null
  /** Optional payload predicates (subscription.payloadFilter). */
  payloadFilter?: PayloadFilter
}

export interface MatchInput {
  eventType: string
  payload: Record<string, unknown>
}

/**
 * Returns true iff every constraint in `options` is satisfied.
 *
 * Semantics:
 *   • Empty / undefined eventTypeFilter → no eventType constraint.
 *   • Empty / undefined payloadFilter → no payload constraint.
 *   • Multiple predicates on the same path are AND-ed (eq + exists, etc.).
 *   • Multiple paths in payloadFilter are AND-ed (slice-2 may add OR groups).
 */
export function matchesSubscription(
  event: MatchInput,
  options: MatchOptions = {},
): boolean {
  // 1. eventType equality filter.
  if (options.eventTypeFilter !== undefined && options.eventTypeFilter !== null) {
    if (event.eventType !== options.eventTypeFilter) return false
  }
  // 2. payload predicates.
  if (options.payloadFilter && Object.keys(options.payloadFilter).length > 0) {
    for (const [path, predicates] of Object.entries(options.payloadFilter)) {
      const value = resolvePath(event.payload, path)
      if (!applyPredicates(value, predicates)) return false
    }
  }
  return true
}

/**
 * Resolve a dot-path against a value. Returns `undefined` if any path
 * segment is missing. Array indexing via numeric segment (`items.0.id`).
 *
 * Exported because slice-2 may want to reuse for tracing.
 */
export function resolvePath(root: unknown, path: string): unknown {
  if (path === "") return root
  const segments = path.split(".")
  let cur: unknown = root
  for (const segment of segments) {
    if (cur === null || cur === undefined) return undefined
    if (Array.isArray(cur)) {
      const idx = Number(segment)
      if (!Number.isInteger(idx) || idx < 0 || idx >= cur.length) return undefined
      cur = cur[idx]
      continue
    }
    if (typeof cur === "object") {
      cur = (cur as Record<string, unknown>)[segment]
      continue
    }
    return undefined
  }
  return cur
}

function applyPredicates(
  value: unknown,
  predicates: PayloadFilterPredicate,
): boolean {
  // exists — special: explicit presence check, ignores other predicates
  // only if value is undefined.
  if (predicates.exists !== undefined) {
    const isPresent = value !== undefined
    if (isPresent !== predicates.exists) return false
  }
  if (predicates.eq !== undefined) {
    if (!deepEqual(value, predicates.eq)) return false
  }
  if (predicates.neq !== undefined) {
    if (deepEqual(value, predicates.neq)) return false
  }
  if (predicates.in !== undefined) {
    if (!predicates.in.some((candidate) => deepEqual(value, candidate))) {
      return false
    }
  }
  if (predicates.not_in !== undefined) {
    if (predicates.not_in.some((candidate) => deepEqual(value, candidate))) {
      return false
    }
  }
  if (predicates.gt !== undefined) {
    if (typeof value !== "number" || !(value > predicates.gt)) return false
  }
  if (predicates.gte !== undefined) {
    if (typeof value !== "number" || !(value >= predicates.gte)) return false
  }
  if (predicates.lt !== undefined) {
    if (typeof value !== "number" || !(value < predicates.lt)) return false
  }
  if (predicates.lte !== undefined) {
    if (typeof value !== "number" || !(value <= predicates.lte)) return false
  }
  if (predicates.contains !== undefined) {
    if (typeof value !== "string") return false
    if (!value.includes(predicates.contains)) return false
  }
  return true
}

/**
 * Deep equality for primitives + plain objects + arrays. Enough for
 * filter-value comparisons. NaN === NaN (matches lodash isEqual).
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a === "number" && typeof b === "number") {
    if (Number.isNaN(a) && Number.isNaN(b)) return true
  }
  if (a === null || b === null) return false
  if (typeof a !== "object" || typeof b !== "object") return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false
    }
    return true
  }
  const aKeys = Object.keys(a as Record<string, unknown>).sort()
  const bKeys = Object.keys(b as Record<string, unknown>).sort()
  if (aKeys.length !== bKeys.length) return false
  for (let i = 0; i < aKeys.length; i++) {
    if (aKeys[i] !== bKeys[i]) return false
  }
  for (const key of aKeys) {
    if (
      !deepEqual(
        (a as Record<string, unknown>)[key],
        (b as Record<string, unknown>)[key],
      )
    ) {
      return false
    }
  }
  return true
}
