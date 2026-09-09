/**
 * Treemap hierarchy normaliser — I6 Phase 4 slice 1.
 *
 * Recursively walks the input tree:
 *   1. Computes each node's `value` as `sum(children)` for internal
 *      nodes; trusts the supplied value only for leaves. If the
 *      caller supplied both `value` and `children`, the children sum
 *      wins (consistency over caller intent).
 *   2. Stamps `depth` from root (0) down.
 *   3. Stamps `percentOfRoot` against the root's total value.
 *   4. Tracks `maxDepth` for legend rendering.
 *
 * Defensive limits: max depth 10 (prevents stack overflow on
 * pathological trees), max nodes 5000 (Recharts/Nivo can render but
 * UX degrades).
 */
import type { TreemapInput, TreemapNode, TreemapShape } from "./types"

export const MAX_TREEMAP_DEPTH = 10
export const MAX_TREEMAP_NODES = 5000

interface WalkState {
  nodesSeen: number
  maxDepth: number
}

function walk(
  input: TreemapInput,
  depth: number,
  state: WalkState
): TreemapNode {
  state.nodesSeen++
  if (state.nodesSeen > MAX_TREEMAP_NODES) {
    throw new Error(`Treemap node count exceeds cap ${MAX_TREEMAP_NODES}`)
  }
  if (depth > MAX_TREEMAP_DEPTH) {
    throw new Error(`Treemap depth ${depth} exceeds cap ${MAX_TREEMAP_DEPTH}`)
  }
  if (depth > state.maxDepth) state.maxDepth = depth

  if (!input.name) {
    throw new Error("Treemap node missing name")
  }

  const hasChildren = Array.isArray(input.children) && input.children.length > 0

  if (!hasChildren) {
    // Leaf — trust the supplied value when finite. Missing/null → 0
    // (Salesforce-style sentinel for "no contribution"). NaN/Infinity
    // are caller bugs — fail loud rather than silently coercing to 0.
    let v: number
    if (input.value == null) {
      v = 0
    } else if (Number.isFinite(input.value)) {
      v = input.value
    } else {
      throw new Error(
        `Treemap leaf "${input.name}" has non-finite value ${input.value} — null/omitted defaults to 0; NaN/Infinity is a data bug`
      )
    }
    return {
      name: input.name,
      value: v,
      depth,
      percentOfRoot: 0, // re-stamped after the full walk
      color: input.color,
    }
  }

  // Internal — recurse, sum children, ignore any caller-supplied value.
  const children = (input.children ?? []).map(c => walk(c, depth + 1, state))
  const sum = children.reduce((acc, n) => acc + n.value, 0)
  return {
    name: input.name,
    value: sum,
    depth,
    percentOfRoot: 0,
    color: input.color,
    children,
  }
}

function stampPercents(node: TreemapNode, rootValue: number): void {
  node.percentOfRoot = rootValue > 0 ? node.value / rootValue : 0
  if (node.children) {
    for (const child of node.children) stampPercents(child, rootValue)
  }
}

export function buildTreemap(input: TreemapInput): TreemapShape {
  const state: WalkState = { nodesSeen: 0, maxDepth: 0 }
  const root = walk(input, 0, state)
  stampPercents(root, root.value)
  return { root, maxDepth: state.maxDepth }
}
