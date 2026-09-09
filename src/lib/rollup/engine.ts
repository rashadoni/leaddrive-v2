/**
 * Rollup engine — N6 Phase 4 slice 1.
 *
 * Pure orchestrator: given a `RollupSpec` and a flat child-row array
 * (caller has done the Prisma fetch + tenant scoping), bucket children
 * by parent FK, apply the filter, run the aggregate, and emit one
 * `RollupComputation` per parent.
 *
 * The route layer wraps this with the actual `prisma.<entity>.findMany`
 * + the upsert into `RollupValue`. Slice 2's middleware-driven
 * incremental update reuses the same `computeForParent` helper for the
 * single-parent case.
 */
import { aggregate } from "./aggregator"
import { matchesFilter } from "./filter"
import type { RollupComputation, RollupSpec } from "./types"

/**
 * Slice 1 cap on parents per recompute call. The route does N-by-N
 * upserts; slice 2 will batch via raw ON CONFLICT and lift this.
 * Exported so the route uses the same number it surfaces in error
 * messages — slice 2's lift won't drift between code and copy.
 */
export const MAX_PARENTS_PER_RECOMPUTE = 10_000

export interface ComputeRollupsInput {
  spec: RollupSpec
  /**
   * Set of all parent IDs the caller wants results for. Every parent
   * gets a `RollupComputation` row so the persistence layer can write
   * a sentinel — but the `numericValue` semantics depend on the
   * aggregate:
   *
   *   count          → 0 (a meaningful "zero children" value)
   *   sum/avg/min/max → null (distinguishes "no matches" from "0")
   *
   * `childCount` is 0 in both cases; consumers can use it to tell
   * apart the no-matches case regardless of the aggregate function.
   */
  parentIds: readonly string[]
  /** Flat child-row array — caller did the Prisma fetch. Each row
   * must carry the `parentKey` and (for non-count) the `aggregateField`. */
  children: readonly Record<string, unknown>[]
}

/**
 * Bucket children by parent FK + run filter + aggregate. Returns one
 * computation per `parentIds` entry; parents absent from `parentIds`
 * but present in `children` are ignored (caller decides the universe).
 */
export function computeRollups(input: ComputeRollupsInput): RollupComputation[] {
  const { spec, parentIds, children } = input

  // Group child rows by parent FK, applying the filter as we go.
  const byParent = new Map<string, unknown[]>()
  for (const child of children) {
    const parentRef = child[spec.parentKey]
    if (parentRef == null || typeof parentRef !== "string") continue
    if (!matchesFilter(child, spec.filter)) continue

    const existing = byParent.get(parentRef) ?? []
    if (spec.aggregate === "count") {
      // For count, the per-row payload is irrelevant — push a sentinel.
      existing.push(true)
    } else {
      if (spec.aggregateField == null) {
        throw new Error(
          `Aggregate "${spec.aggregate}" requires aggregateField but spec.aggregateField is null`
        )
      }
      existing.push(child[spec.aggregateField])
    }
    byParent.set(parentRef, existing)
  }

  return parentIds.map(parentId => {
    const vals = byParent.get(parentId) ?? []
    return {
      parentId,
      numericValue: aggregate(spec.aggregate, vals),
      childCount: vals.length,
    }
  })
}

/**
 * Single-parent convenience wrapper. Slice 2's middleware hook calls
 * this when one child row changes — caller fetches *only* that
 * parent's children, then asks the engine for the one updated value.
 */
export function computeForParent(
  spec: RollupSpec,
  parentId: string,
  children: readonly Record<string, unknown>[]
): RollupComputation {
  const [only] = computeRollups({ spec, parentIds: [parentId], children })
  return only
}
