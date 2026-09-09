/**
 * Advanced visualization data shapes — I6 Phase 4 slice 1.
 *
 * Four chart kinds:
 *   sankey    — node→node flows with weighted edges (stage→stage funnel)
 *   waterfall — running total of additive contributions (revenue bridge)
 *   heatmap   — value grid over two categorical axes (rep × stage)
 *   treemap   — hierarchical area-by-value (company → contacts → deals)
 *
 * Slice 1 ships only the data layer — pure transforms from raw input
 * to a chart-lib-agnostic shape that maps cleanly onto Recharts /
 * Nivo / Vega-Lite. Slice 2 picks the render lib + wires the actual
 * React widgets into the dashboard builder.
 */

export type AdvancedChartKind = "sankey" | "waterfall" | "heatmap" | "treemap"

/* ─── Sankey ──────────────────────────────────────────────────────────── */

export interface SankeyNode {
  /** Stable identifier — referenced by links. */
  id: string
  /** Display label; defaults to id when absent. */
  label?: string
  /** Optional color hint for the renderer. */
  color?: string
}

export interface SankeyLink {
  source: string
  target: string
  /** Edge weight — must be > 0; engine drops/raises on non-positive. */
  value: number
}

export interface SankeyInput {
  // Input types use mutable arrays so Zod-inferred body shapes
  // (which are structurally mutable) flow into the engine without a
  // boundary cast. Engines treat inputs as read-only by discipline,
  // not by TS modifier.
  nodes: SankeyNode[]
  links: SankeyLink[]
}

export interface SankeyShape {
  nodes: SankeyNode[]
  links: SankeyLink[]
  /** Total flow value across all edges — convenient for the title bar. */
  totalFlow: number
}

/* ─── Waterfall ───────────────────────────────────────────────────────── */

export type WaterfallStepKind = "increase" | "decrease" | "total"

export interface WaterfallStep {
  label: string
  /**
   * Signed magnitude of the step:
   *   - increase / decrease use the magnitude (engine handles sign by kind)
   *   - total ignores `value` and renders the running cumulative
   */
  value: number
  kind: WaterfallStepKind
  color?: string
}

export interface WaterfallInput {
  steps: WaterfallStep[]
  /** Optional starting cumulative value (default 0). */
  start?: number
}

export interface WaterfallBar {
  label: string
  kind: WaterfallStepKind
  /** Bar bottom — runner before this step. */
  start: number
  /** Bar top — runner after this step. */
  end: number
  /** The step's effective contribution (positive for increase, negative for decrease, runner for total). */
  delta: number
  color?: string
}

export interface WaterfallShape {
  bars: WaterfallBar[]
  /** Final running total after all steps. */
  finalTotal: number
}

/* ─── Heatmap ─────────────────────────────────────────────────────────── */

export interface HeatmapCell {
  row: string
  col: string
  value: number
}

export interface HeatmapInput {
  /** Row axis order. */
  rows: string[]
  /** Column axis order. */
  cols: string[]
  cells: HeatmapCell[]
  /** Optional densification fill (default: null → renderer chooses). */
  fill?: number | null
}

export interface HeatmapShape {
  rows: string[]
  cols: string[]
  /** Densified rows × cols grid — every cell present, missing values use `fill`. */
  matrix: (number | null)[][]
  /** Aggregate stats over present (non-null) cells — drives the color scale. */
  stats: {
    min: number
    max: number
    mean: number
    presentCount: number
  }
}

/* ─── Treemap ─────────────────────────────────────────────────────────── */

export interface TreemapInput {
  /** Display label of the node. */
  name: string
  /**
   * Leaf-only: numeric value contribution. Internal nodes have
   * `children` instead. If both are present, `value` is ignored — the
   * engine recomputes from children sum to keep the tree consistent.
   */
  value?: number
  children?: TreemapInput[]
  color?: string
}

export interface TreemapNode {
  name: string
  value: number
  /** 0 for the root; depth N for a node N levels down. */
  depth: number
  /** Percentage of the root value this node represents. */
  percentOfRoot: number
  color?: string
  children?: TreemapNode[]
}

export interface TreemapShape {
  root: TreemapNode
  /** Max depth observed — useful for legend rendering. */
  maxDepth: number
}
