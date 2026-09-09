/**
 * Heatmap matrix builder — I6 Phase 4 slice 1.
 *
 * Densifies a sparse `{row, col, value}` cell list into a full rows×cols
 * matrix (missing cells filled with `input.fill ?? null`), and computes
 * aggregate stats (min/max/mean/presentCount) over the non-null cells
 * — those drive the color scale + the legend.
 *
 * Last-write-wins on duplicate cells. Cells referencing unknown
 * row/col labels are dropped silently (caller-side warning is fine —
 * dropping is safer than throwing when the caller might be passing
 * partial data).
 */
import type { HeatmapInput, HeatmapShape } from "./types"

export const MAX_HEATMAP_CELLS = 10_000

export function buildHeatmap(input: HeatmapInput): HeatmapShape {
  const rows = [...input.rows]
  const cols = [...input.cols]

  if (rows.length === 0 || cols.length === 0) {
    throw new Error("Heatmap requires at least one row and one column")
  }
  if (rows.length * cols.length > MAX_HEATMAP_CELLS) {
    throw new Error(
      `Heatmap grid ${rows.length}×${cols.length} = ${rows.length * cols.length} cells exceeds cap ${MAX_HEATMAP_CELLS}`
    )
  }

  // Duplicate row/col labels would break the index map. Reject up front
  // rather than silently using the first (which produces hard-to-debug
  // missing-cell renders).
  if (new Set(rows).size !== rows.length) {
    throw new Error("Heatmap row labels must be unique")
  }
  if (new Set(cols).size !== cols.length) {
    throw new Error("Heatmap column labels must be unique")
  }

  const rowIdx = new Map<string, number>(rows.map((r, i) => [r, i]))
  const colIdx = new Map<string, number>(cols.map((c, i) => [c, i]))
  const fill = input.fill === undefined ? null : input.fill

  const matrix: (number | null)[][] = rows.map(() => cols.map(() => fill))

  for (const cell of input.cells) {
    const r = rowIdx.get(cell.row)
    const c = colIdx.get(cell.col)
    if (r === undefined || c === undefined) continue // unknown axis label
    if (!Number.isFinite(cell.value)) continue
    matrix[r][c] = cell.value
  }

  // Stats over present (non-null) cells only.
  let min = Infinity
  let max = -Infinity
  let sum = 0
  let present = 0
  for (const row of matrix) {
    for (const v of row) {
      if (v == null) continue
      if (v < min) min = v
      if (v > max) max = v
      sum += v
      present++
    }
  }

  return {
    rows,
    cols,
    matrix,
    stats: {
      min: present === 0 ? 0 : min,
      max: present === 0 ? 0 : max,
      mean: present === 0 ? 0 : sum / present,
      presentCount: present,
    },
  }
}
