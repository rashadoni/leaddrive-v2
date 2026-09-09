/**
 * Sankey flow normaliser — I6 Phase 4 slice 1.
 *
 * Validates the input, aggregates duplicate (source→target) edges by
 * sum, rejects self-loops + cycles. Cycle detection uses a DFS with a
 * recursion-stack set — most chart libs (Recharts, Nivo, d3-sankey)
 * silently mis-render or stack-overflow on a cyclic graph, so we
 * catch it at the data-prep boundary.
 *
 * Error policy (intentional asymmetry, not a bug):
 *   - Self-loops, unknown refs, cycles, missing endpoints  → THROW
 *     (these are caller-side data bugs — silent drop would hide
 *      a real graph-structure problem)
 *   - Zero / negative / NaN link values                     → DROP
 *     (these are data-cleansing concerns — an analytics query
 *      will routinely produce empty buckets that shouldn't fail
 *      the whole chart render)
 *
 * Pure, synchronous. No I/O.
 */
import type { SankeyInput, SankeyLink, SankeyShape } from "./types"

/** Hard cap on nodes per chart — prevents pathological renders. */
export const MAX_SANKEY_NODES = 200

export function buildSankey(input: SankeyInput): SankeyShape {
  const { nodes, links } = input

  if (nodes.length === 0) {
    throw new Error("Sankey requires at least one node")
  }
  if (nodes.length > MAX_SANKEY_NODES) {
    throw new Error(`Sankey node count ${nodes.length} exceeds cap ${MAX_SANKEY_NODES}`)
  }

  // 1. Dedupe nodes by id — first wins (preserves declared order + label).
  const nodeById = new Map<string, { id: string; label?: string; color?: string }>()
  for (const n of nodes) {
    if (!n.id) throw new Error("Sankey node missing id")
    if (!nodeById.has(n.id)) {
      nodeById.set(n.id, { id: n.id, label: n.label ?? n.id, color: n.color })
    }
  }

  // 2. Aggregate links: same (source,target) merge by sum; drop non-positive.
  const linkBucket = new Map<string, SankeyLink>()
  for (const l of links) {
    if (!l.source || !l.target) {
      throw new Error("Sankey link missing source or target")
    }
    if (!nodeById.has(l.source)) {
      throw new Error(`Sankey link source "${l.source}" not in nodes`)
    }
    if (!nodeById.has(l.target)) {
      throw new Error(`Sankey link target "${l.target}" not in nodes`)
    }
    if (l.source === l.target) {
      throw new Error(`Sankey self-loop rejected: "${l.source}" → "${l.target}"`)
    }
    if (!Number.isFinite(l.value) || l.value <= 0) {
      // Drop silently — non-positive flows are meaningless in a Sankey.
      continue
    }
    const key = `${l.source}\x00${l.target}`
    const existing = linkBucket.get(key)
    if (existing) {
      existing.value += l.value
    } else {
      linkBucket.set(key, { source: l.source, target: l.target, value: l.value })
    }
  }

  const aggregatedLinks = [...linkBucket.values()]

  // 3. Cycle detection — DFS with WHITE/GRAY/BLACK marker set.
  // Most Sankey renderers assume a DAG; cycles cause infinite loops or
  // silently wrong layouts. We surface the cycle as a thrown error
  // listing the path so the caller can debug.
  const adj = new Map<string, string[]>()
  for (const l of aggregatedLinks) {
    const list = adj.get(l.source) ?? []
    list.push(l.target)
    adj.set(l.source, list)
  }

  const WHITE = 0
  const GRAY = 1
  const BLACK = 2
  const color = new Map<string, number>()
  for (const id of nodeById.keys()) color.set(id, WHITE)

  function visit(start: string): string[] | null {
    const stack: { node: string; nextIdx: number; path: string[] }[] = [
      { node: start, nextIdx: 0, path: [start] },
    ]
    color.set(start, GRAY)
    while (stack.length > 0) {
      const top = stack[stack.length - 1]
      const children = adj.get(top.node) ?? []
      if (top.nextIdx >= children.length) {
        color.set(top.node, BLACK)
        stack.pop()
        continue
      }
      const next = children[top.nextIdx++]
      const c = color.get(next) ?? WHITE
      if (c === GRAY) {
        // Cycle: gray-cycle close.
        const cycleStart = top.path.indexOf(next)
        return [...top.path.slice(cycleStart), next]
      }
      if (c === WHITE) {
        color.set(next, GRAY)
        stack.push({ node: next, nextIdx: 0, path: [...top.path, next] })
      }
    }
    return null
  }

  for (const id of nodeById.keys()) {
    if (color.get(id) === WHITE) {
      const cycle = visit(id)
      if (cycle) {
        throw new Error(`Sankey cycle detected: ${cycle.join(" → ")}`)
      }
    }
  }

  const totalFlow = aggregatedLinks.reduce((acc, l) => acc + l.value, 0)

  return {
    nodes: [...nodeById.values()],
    links: aggregatedLinks,
    totalFlow,
  }
}
