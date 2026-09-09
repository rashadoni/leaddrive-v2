/**
 * Tests for I6 Advanced visualizations slice 1 — pure data-shape helpers.
 * No DB, no network, deterministic synthetic inputs.
 */
import { describe, it, expect } from "vitest"
import { buildAdvancedChart } from "@/lib/charts/advanced"
import { MAX_HEATMAP_CELLS, buildHeatmap } from "@/lib/charts/advanced/heatmap"
import { MAX_SANKEY_NODES, buildSankey } from "@/lib/charts/advanced/sankey"
import {
  MAX_TREEMAP_DEPTH,
  MAX_TREEMAP_NODES,
  buildTreemap,
} from "@/lib/charts/advanced/treemap"
import {
  MAX_WATERFALL_STEPS,
  buildWaterfall,
} from "@/lib/charts/advanced/waterfall"

/* ─── buildSankey ─────────────────────────────────────────────────────── */

describe("I6 — buildSankey", () => {
  it("threads nodes + links into a normalised DAG", () => {
    const r = buildSankey({
      nodes: [{ id: "a" }, { id: "b" }, { id: "c" }],
      links: [
        { source: "a", target: "b", value: 10 },
        { source: "b", target: "c", value: 7 },
      ],
    })
    expect(r.nodes).toHaveLength(3)
    expect(r.links).toHaveLength(2)
    expect(r.totalFlow).toBe(17)
  })

  it("aggregates duplicate (source,target) by sum", () => {
    const r = buildSankey({
      nodes: [{ id: "a" }, { id: "b" }],
      links: [
        { source: "a", target: "b", value: 5 },
        { source: "a", target: "b", value: 7 },
        { source: "a", target: "b", value: 3 },
      ],
    })
    expect(r.links).toHaveLength(1)
    expect(r.links[0].value).toBe(15)
    expect(r.totalFlow).toBe(15)
  })

  it("drops links with non-positive or non-finite value", () => {
    const r = buildSankey({
      nodes: [{ id: "a" }, { id: "b" }],
      links: [
        { source: "a", target: "b", value: 5 },
        { source: "a", target: "b", value: 0 },
        { source: "a", target: "b", value: -3 },
        { source: "a", target: "b", value: NaN },
      ],
    })
    expect(r.links[0].value).toBe(5)
  })

  it("rejects self-loops", () => {
    expect(() =>
      buildSankey({
        nodes: [{ id: "a" }],
        links: [{ source: "a", target: "a", value: 1 }],
      })
    ).toThrow(/self-loop/)
  })

  it("rejects unknown source/target", () => {
    expect(() =>
      buildSankey({
        nodes: [{ id: "a" }],
        links: [{ source: "a", target: "b", value: 1 }],
      })
    ).toThrow(/target "b" not in nodes/)
  })

  it("detects + surfaces a cycle path", () => {
    expect(() =>
      buildSankey({
        nodes: [{ id: "a" }, { id: "b" }, { id: "c" }],
        links: [
          { source: "a", target: "b", value: 1 },
          { source: "b", target: "c", value: 1 },
          { source: "c", target: "a", value: 1 },
        ],
      })
    ).toThrow(/cycle detected: a → b → c → a/)
  })

  it("dedupes nodes by id (first wins on label)", () => {
    const r = buildSankey({
      nodes: [
        { id: "x", label: "First" },
        { id: "x", label: "Second" },
        { id: "y" },
      ],
      links: [{ source: "x", target: "y", value: 1 }],
    })
    expect(r.nodes).toHaveLength(2)
    expect(r.nodes.find(n => n.id === "x")?.label).toBe("First")
  })

  it("defaults label to id when missing", () => {
    const r = buildSankey({
      nodes: [{ id: "alpha" }, { id: "beta", label: "Beta!" }],
      links: [{ source: "alpha", target: "beta", value: 1 }],
    })
    expect(r.nodes.find(n => n.id === "alpha")?.label).toBe("alpha")
    expect(r.nodes.find(n => n.id === "beta")?.label).toBe("Beta!")
  })

  it("rejects empty node list", () => {
    expect(() => buildSankey({ nodes: [], links: [] })).toThrow(/at least one node/)
  })

  it("rejects too many nodes", () => {
    const nodes = Array.from({ length: MAX_SANKEY_NODES + 1 }, (_, i) => ({ id: `n${i}` }))
    expect(() => buildSankey({ nodes, links: [] })).toThrow(/exceeds cap/)
  })

  it("rejects link with missing source", () => {
    expect(() =>
      buildSankey({
        nodes: [{ id: "a" }, { id: "b" }],
        links: [{ source: "", target: "b", value: 1 }],
      })
    ).toThrow(/missing source/)
  })

  it("rejects link with missing target (symmetric counterpart)", () => {
    expect(() =>
      buildSankey({
        nodes: [{ id: "a" }, { id: "b" }],
        links: [{ source: "a", target: "", value: 1 }],
      })
    ).toThrow(/missing source or target/)
  })
})

/* ─── buildWaterfall ──────────────────────────────────────────────────── */

describe("I6 — buildWaterfall", () => {
  it("computes running start/end for an increase chain", () => {
    const r = buildWaterfall({
      steps: [
        { label: "Start", value: 100, kind: "increase" },
        { label: "Won", value: 30, kind: "increase" },
        { label: "Lost", value: 10, kind: "decrease" },
      ],
    })
    expect(r.bars[0]).toMatchObject({ start: 0, end: 100, delta: 100 })
    expect(r.bars[1]).toMatchObject({ start: 100, end: 130, delta: 30 })
    expect(r.bars[2]).toMatchObject({ start: 120, end: 130, delta: -10 })
    expect(r.finalTotal).toBe(120)
  })

  it("respects custom start cumulative", () => {
    const r = buildWaterfall({
      steps: [{ label: "Add", value: 50, kind: "increase" }],
      start: 200,
    })
    expect(r.bars[0]).toMatchObject({ start: 200, end: 250 })
    expect(r.finalTotal).toBe(250)
  })

  it("total step renders cumulative as bar, doesn't advance runner", () => {
    const r = buildWaterfall({
      steps: [
        { label: "A", value: 50, kind: "increase" },
        { label: "Subtotal", value: 0, kind: "total" },
        { label: "B", value: 25, kind: "increase" },
      ],
    })
    // Subtotal bar runs from 0 to 50; runner stays 50, so B goes 50→75.
    expect(r.bars[1]).toMatchObject({ start: 0, end: 50, delta: 50, kind: "total" })
    expect(r.bars[2]).toMatchObject({ start: 50, end: 75 })
    expect(r.finalTotal).toBe(75)
  })

  it("takes magnitude of value regardless of sign (decrease handles its own sign)", () => {
    const r = buildWaterfall({
      steps: [
        { label: "Add", value: 100, kind: "increase" },
        { label: "Sub", value: -30, kind: "decrease" }, // negative sign on decrease still subtracts |30|
      ],
    })
    expect(r.bars[1]).toMatchObject({ delta: -30 })
    expect(r.finalTotal).toBe(70)
  })

  it("total bar straddles zero when runner is negative", () => {
    const r = buildWaterfall({
      steps: [
        { label: "Loss", value: 30, kind: "decrease" },
        { label: "Net", value: 0, kind: "total" },
      ],
    })
    // Runner is -30; total bar should run from -30 to 0.
    expect(r.bars[1]).toMatchObject({ start: -30, end: 0, kind: "total" })
  })

  it("rejects empty steps", () => {
    expect(() => buildWaterfall({ steps: [] })).toThrow(/at least one step/)
  })

  it("rejects too many steps", () => {
    const steps = Array.from({ length: MAX_WATERFALL_STEPS + 1 }, (_, i) => ({
      label: `s${i}`,
      value: 1,
      kind: "increase" as const,
    }))
    expect(() => buildWaterfall({ steps })).toThrow(/exceeds cap/)
  })

  it("rejects non-finite step value", () => {
    expect(() =>
      buildWaterfall({
        steps: [{ label: "Bad", value: Infinity, kind: "increase" }],
      })
    ).toThrow(/non-finite/)
  })

  it("rejects step missing label", () => {
    expect(() =>
      buildWaterfall({ steps: [{ label: "", value: 1, kind: "increase" }] })
    ).toThrow(/missing label/)
  })
})

/* ─── buildHeatmap ────────────────────────────────────────────────────── */

describe("I6 — buildHeatmap", () => {
  it("densifies a sparse cell list into a full matrix", () => {
    const r = buildHeatmap({
      rows: ["r1", "r2"],
      cols: ["c1", "c2"],
      cells: [
        { row: "r1", col: "c1", value: 10 },
        { row: "r2", col: "c2", value: 20 },
      ],
    })
    expect(r.matrix).toEqual([
      [10, null],
      [null, 20],
    ])
  })

  it("uses custom fill for missing cells", () => {
    const r = buildHeatmap({
      rows: ["r1"],
      cols: ["c1", "c2"],
      cells: [{ row: "r1", col: "c1", value: 5 }],
      fill: 0,
    })
    expect(r.matrix).toEqual([[5, 0]])
  })

  it("computes stats over present cells only (ignores null fill)", () => {
    const r = buildHeatmap({
      rows: ["r1", "r2"],
      cols: ["c1"],
      cells: [
        { row: "r1", col: "c1", value: 10 },
        { row: "r2", col: "c1", value: 30 },
      ],
    })
    expect(r.stats).toEqual({ min: 10, max: 30, mean: 20, presentCount: 2 })
  })

  it("negative-value cells produce correct min/max for color scale", () => {
    const r = buildHeatmap({
      rows: ["r1"],
      cols: ["c1", "c2", "c3"],
      cells: [
        { row: "r1", col: "c1", value: -10 },
        { row: "r1", col: "c2", value: -5 },
        { row: "r1", col: "c3", value: -1 },
      ],
    })
    expect(r.stats.min).toBe(-10)
    expect(r.stats.max).toBe(-1)
    expect(r.stats.mean).toBeCloseTo(-16 / 3, 5)
  })

  it("returns zeroed stats when no present cells", () => {
    const r = buildHeatmap({
      rows: ["r1"],
      cols: ["c1"],
      cells: [],
    })
    expect(r.stats).toEqual({ min: 0, max: 0, mean: 0, presentCount: 0 })
  })

  it("drops cells referencing unknown axis labels", () => {
    const r = buildHeatmap({
      rows: ["r1"],
      cols: ["c1"],
      cells: [
        { row: "r1", col: "c1", value: 7 },
        { row: "r99", col: "c1", value: 99 }, // unknown row
        { row: "r1", col: "c99", value: 88 }, // unknown col
      ],
    })
    expect(r.stats.presentCount).toBe(1)
    expect(r.matrix[0][0]).toBe(7)
  })

  it("last-write-wins on duplicate cells", () => {
    const r = buildHeatmap({
      rows: ["r1"],
      cols: ["c1"],
      cells: [
        { row: "r1", col: "c1", value: 1 },
        { row: "r1", col: "c1", value: 99 },
      ],
    })
    expect(r.matrix[0][0]).toBe(99)
  })

  it("skips non-finite cell values", () => {
    const r = buildHeatmap({
      rows: ["r1"],
      cols: ["c1"],
      cells: [{ row: "r1", col: "c1", value: NaN }],
    })
    expect(r.matrix[0][0]).toBeNull()
  })

  it("rejects duplicate row/col labels", () => {
    expect(() =>
      buildHeatmap({ rows: ["a", "a"], cols: ["x"], cells: [] })
    ).toThrow(/row labels must be unique/)
    expect(() =>
      buildHeatmap({ rows: ["a"], cols: ["x", "x"], cells: [] })
    ).toThrow(/column labels must be unique/)
  })

  it("rejects oversized grid", () => {
    const rows = Array.from({ length: 200 }, (_, i) => `r${i}`)
    const cols = Array.from({ length: 200 }, (_, i) => `c${i}`)
    // 200 × 200 = 40000, OK. 200 × 100 = 20000 — also OK. Need > MAX_HEATMAP_CELLS = 10000.
    const cols2 = Array.from({ length: 51 }, (_, i) => `c${i}`)
    // 200 × 51 = 10_200 > 10_000.
    expect(() => buildHeatmap({ rows, cols: cols2, cells: [] })).toThrow(/exceeds cap/)
    expect(MAX_HEATMAP_CELLS).toBe(10_000)
  })

  it("rejects empty rows or cols", () => {
    expect(() => buildHeatmap({ rows: [], cols: ["c"], cells: [] })).toThrow(
      /at least one row/
    )
    expect(() => buildHeatmap({ rows: ["r"], cols: [], cells: [] })).toThrow(
      /at least one row and one column/
    )
  })
})

/* ─── buildTreemap ────────────────────────────────────────────────────── */

describe("I6 — buildTreemap", () => {
  it("aggregates leaf values bottom-up; computes percent-of-root", () => {
    const r = buildTreemap({
      name: "Org",
      children: [
        {
          name: "Sales",
          children: [
            { name: "EU", value: 40 },
            { name: "US", value: 60 },
          ],
        },
        { name: "Service", value: 100 },
      ],
    })
    expect(r.root.value).toBe(200)
    const sales = r.root.children![0]
    expect(sales.value).toBe(100)
    expect(sales.percentOfRoot).toBe(0.5)
    const service = r.root.children![1]
    expect(service.percentOfRoot).toBe(0.5)
    expect(r.root.depth).toBe(0)
    expect(sales.depth).toBe(1)
    expect(sales.children![0].depth).toBe(2)
    expect(r.maxDepth).toBe(2)
  })

  it("ignores caller-supplied value on internal nodes (children sum wins)", () => {
    const r = buildTreemap({
      name: "Root",
      value: 9999, // ignored
      children: [
        { name: "A", value: 10 },
        { name: "B", value: 20 },
      ],
    })
    expect(r.root.value).toBe(30) // not 9999
  })

  it("trusts leaf value (default 0)", () => {
    const r = buildTreemap({
      name: "Root",
      children: [{ name: "Leaf" }], // no value
    })
    expect(r.root.value).toBe(0)
    expect(r.root.children![0].value).toBe(0)
  })

  it("zero-value root → percent-of-root is 0 (not NaN from div-by-zero)", () => {
    const r = buildTreemap({
      name: "Root",
      children: [{ name: "Leaf", value: 0 }],
    })
    expect(r.root.children![0].percentOfRoot).toBe(0)
  })

  it("rejects empty name", () => {
    expect(() => buildTreemap({ name: "" })).toThrow(/missing name/)
  })

  it("rejects non-finite leaf value (NaN / Infinity) — caller-side data bug", () => {
    expect(() =>
      buildTreemap({ name: "Root", children: [{ name: "Leaf", value: NaN }] })
    ).toThrow(/non-finite/)
    expect(() =>
      buildTreemap({ name: "Root", children: [{ name: "Leaf", value: Infinity }] })
    ).toThrow(/non-finite/)
  })

  it("rejects depth overflow", () => {
    // Build a chain depth MAX + 1
    let node: { name: string; children?: typeof node[] } = {
      name: `n${MAX_TREEMAP_DEPTH + 1}`,
    }
    for (let i = MAX_TREEMAP_DEPTH; i >= 0; i--) {
      node = { name: `n${i}`, children: [node] }
    }
    expect(() => buildTreemap(node)).toThrow(/depth/)
  })

  it("rejects node-count overflow", () => {
    const children = Array.from({ length: MAX_TREEMAP_NODES + 1 }, (_, i) => ({
      name: `leaf${i}`,
      value: 1,
    }))
    expect(() => buildTreemap({ name: "Root", children })).toThrow(/node count/)
  })

  it("preserves color on nodes", () => {
    const r = buildTreemap({
      name: "Root",
      color: "#ff0000",
      children: [{ name: "Leaf", value: 1, color: "#00ff00" }],
    })
    expect(r.root.color).toBe("#ff0000")
    expect(r.root.children![0].color).toBe("#00ff00")
  })
})

/* ─── buildAdvancedChart dispatcher ───────────────────────────────────── */

describe("I6 — buildAdvancedChart dispatcher", () => {
  it("dispatches to sankey by kind", () => {
    const r = buildAdvancedChart({
      kind: "sankey",
      input: {
        nodes: [{ id: "a" }, { id: "b" }],
        links: [{ source: "a", target: "b", value: 1 }],
      },
    })
    expect(r.kind).toBe("sankey")
    if (r.kind === "sankey") {
      expect(r.shape.totalFlow).toBe(1)
    }
  })

  it("dispatches to waterfall by kind", () => {
    const r = buildAdvancedChart({
      kind: "waterfall",
      input: { steps: [{ label: "x", value: 1, kind: "increase" }] },
    })
    expect(r.kind).toBe("waterfall")
    if (r.kind === "waterfall") {
      expect(r.shape.finalTotal).toBe(1)
    }
  })

  it("dispatches to heatmap by kind", () => {
    const r = buildAdvancedChart({
      kind: "heatmap",
      input: { rows: ["a"], cols: ["b"], cells: [{ row: "a", col: "b", value: 1 }] },
    })
    expect(r.kind).toBe("heatmap")
    if (r.kind === "heatmap") {
      expect(r.shape.stats.presentCount).toBe(1)
    }
  })

  it("dispatches to treemap by kind", () => {
    const r = buildAdvancedChart({
      kind: "treemap",
      input: { name: "Root", children: [{ name: "L", value: 5 }] },
    })
    expect(r.kind).toBe("treemap")
    if (r.kind === "treemap") {
      expect(r.shape.root.value).toBe(5)
    }
  })

  it("propagates engine errors (cycle in sankey)", () => {
    expect(() =>
      buildAdvancedChart({
        kind: "sankey",
        input: {
          nodes: [{ id: "a" }, { id: "b" }],
          links: [
            { source: "a", target: "b", value: 1 },
            { source: "b", target: "a", value: 1 },
          ],
        },
      })
    ).toThrow(/cycle/)
  })
})
