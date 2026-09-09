/**
 * Waterfall step normaliser — I6 Phase 4 slice 1.
 *
 * Computes start/end per bar from a running cumulative, attaching the
 * effective delta and the implicit sign convention:
 *
 *   increase: |value| added to runner       (start = prev, end = prev + |v|)
 *   decrease: |value| subtracted from runner (start = prev - |v|, end = prev)
 *   total:    bar from baseline to current runner (no contribution)
 *
 * The bottom-up start/end layout matches what most chart libs expect
 * for a bar chart with custom y-domain bars.
 */
import type { WaterfallBar, WaterfallInput, WaterfallShape } from "./types"

export const MAX_WATERFALL_STEPS = 100

export function buildWaterfall(input: WaterfallInput): WaterfallShape {
  const { steps } = input
  if (steps.length === 0) throw new Error("Waterfall requires at least one step")
  if (steps.length > MAX_WATERFALL_STEPS) {
    throw new Error(`Waterfall step count ${steps.length} exceeds cap ${MAX_WATERFALL_STEPS}`)
  }

  const bars: WaterfallBar[] = []
  let runner = input.start ?? 0

  for (const step of steps) {
    if (!step.label) throw new Error("Waterfall step missing label")
    if (!Number.isFinite(step.value)) {
      throw new Error(`Waterfall step "${step.label}" has non-finite value`)
    }
    const magnitude = Math.abs(step.value)

    switch (step.kind) {
      case "increase": {
        const start = runner
        const end = runner + magnitude
        bars.push({
          label: step.label,
          kind: "increase",
          start,
          end,
          delta: magnitude,
          color: step.color,
        })
        runner = end
        break
      }
      case "decrease": {
        const start = runner - magnitude
        const end = runner
        bars.push({
          label: step.label,
          kind: "decrease",
          start,
          end,
          delta: -magnitude,
          color: step.color,
        })
        runner = start
        break
      }
      case "total": {
        // Total bar runs from baseline (0) to the current cumulative —
        // its `delta` is the runner itself for label-rendering purposes.
        bars.push({
          label: step.label,
          kind: "total",
          start: Math.min(0, runner),
          end: Math.max(0, runner),
          delta: runner,
          color: step.color,
        })
        // Total bar does NOT advance the runner — it's a snapshot.
        break
      }
      default: {
        const exhaustive: never = step.kind
        throw new Error(`Unsupported waterfall step kind: ${exhaustive}`)
      }
    }
  }

  return { bars, finalTotal: runner }
}
