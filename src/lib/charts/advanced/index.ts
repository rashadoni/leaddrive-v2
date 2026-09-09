/**
 * Advanced visualization render-prep — I6 Phase 4 slice 1.
 *
 * Single entrypoint for callers (the dashboard widget renderer, slice 2
 * React components, the new `/api/v1/charts/advanced` route) that
 * doesn't want to import per-kind helpers. Dispatch by `kind` keeps
 * the surface uniform and lets the route stay type-safe.
 */
import { buildHeatmap } from "./heatmap"
import { buildSankey } from "./sankey"
import { buildTreemap } from "./treemap"
import { buildWaterfall } from "./waterfall"
import type {
  AdvancedChartKind,
  HeatmapInput,
  HeatmapShape,
  SankeyInput,
  SankeyShape,
  TreemapInput,
  TreemapShape,
  WaterfallInput,
  WaterfallShape,
} from "./types"

export interface BuildSankeyCall {
  kind: "sankey"
  input: SankeyInput
}
export interface BuildWaterfallCall {
  kind: "waterfall"
  input: WaterfallInput
}
export interface BuildHeatmapCall {
  kind: "heatmap"
  input: HeatmapInput
}
export interface BuildTreemapCall {
  kind: "treemap"
  input: TreemapInput
}

export type BuildAdvancedCall =
  | BuildSankeyCall
  | BuildWaterfallCall
  | BuildHeatmapCall
  | BuildTreemapCall

export type AdvancedChartShape =
  | { kind: "sankey"; shape: SankeyShape }
  | { kind: "waterfall"; shape: WaterfallShape }
  | { kind: "heatmap"; shape: HeatmapShape }
  | { kind: "treemap"; shape: TreemapShape }

/**
 * Discriminated dispatcher: caller passes the kind + matching input
 * payload, returns the normalised shape tagged with the same kind so
 * the consumer can narrow.
 */
export function buildAdvancedChart(call: BuildAdvancedCall): AdvancedChartShape {
  switch (call.kind) {
    case "sankey":
      return { kind: "sankey", shape: buildSankey(call.input) }
    case "waterfall":
      return { kind: "waterfall", shape: buildWaterfall(call.input) }
    case "heatmap":
      return { kind: "heatmap", shape: buildHeatmap(call.input) }
    case "treemap":
      return { kind: "treemap", shape: buildTreemap(call.input) }
    default: {
      const exhaustive: never = call
      throw new Error(`Unsupported advanced chart kind: ${JSON.stringify(exhaustive)}`)
    }
  }
}

export const ALL_ADVANCED_KINDS: readonly AdvancedChartKind[] = [
  "sankey",
  "waterfall",
  "heatmap",
  "treemap",
]

export { buildSankey, buildWaterfall, buildHeatmap, buildTreemap }

// Explicit re-exports — prevents accidental leakage as types.ts grows.
export type {
  AdvancedChartKind,
  SankeyNode,
  SankeyLink,
  SankeyInput,
  SankeyShape,
  WaterfallStepKind,
  WaterfallStep,
  WaterfallInput,
  WaterfallBar,
  WaterfallShape,
  HeatmapCell,
  HeatmapInput,
  HeatmapShape,
  TreemapInput,
  TreemapNode,
  TreemapShape,
} from "./types"
