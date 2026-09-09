/**
 * POST /api/v1/charts/advanced
 *
 * Take a raw input payload + a chart kind and return the normalised
 * shape (validated, aggregated, with computed stats / running totals).
 * Slice 2's dashboard widgets call this for any of the four advanced
 * chart kinds; slice 1 callers post the input data directly (no
 * server-side query → data path yet).
 *
 * Body:
 *   { kind: "sankey", input: { nodes, links } }
 *   { kind: "waterfall", input: { steps, start? } }
 *   { kind: "heatmap", input: { rows, cols, cells, fill? } }
 *   { kind: "treemap", input: { name, value?, children? } }
 *
 * Part of I6 Advanced visualizations (Phase 4 slice 1).
 */
import { NextResponse } from "next/server"
import { z } from "zod"
import { withRlsAuth } from "@/lib/with-rls"
import { buildAdvancedChart } from "@/lib/charts/advanced"
import { MAX_HEATMAP_CELLS } from "@/lib/charts/advanced/heatmap"

const sankeyInputSchema = z.object({
  nodes: z
    .array(
      z.object({
        id: z.string().min(1).max(120),
        label: z.string().max(200).optional(),
        color: z.string().max(32).optional(),
      })
    )
    .min(1)
    .max(200),
  links: z
    .array(
      z.object({
        source: z.string().min(1).max(120),
        target: z.string().min(1).max(120),
        value: z.number(),
      })
    )
    .max(2000),
})

const waterfallInputSchema = z.object({
  steps: z
    .array(
      z.object({
        label: z.string().min(1).max(120),
        value: z.number(),
        kind: z.enum(["increase", "decrease", "total"]),
        color: z.string().max(32).optional(),
      })
    )
    .min(1)
    .max(100),
  start: z.number().optional(),
})

const heatmapInputSchema = z.object({
  rows: z.array(z.string().min(1).max(120)).min(1).max(200),
  cols: z.array(z.string().min(1).max(120)).min(1).max(200),
  // Cap matches the engine's MAX_HEATMAP_CELLS so callers get a 400
  // at the schema boundary instead of a 422 from the engine. Symmetric.
  cells: z
    .array(
      z.object({
        row: z.string().min(1).max(120),
        col: z.string().min(1).max(120),
        value: z.number(),
      })
    )
    .max(MAX_HEATMAP_CELLS),
  fill: z.number().nullable().optional(),
})

// Treemap is recursive — Zod typing needs the lazy trick. Cap depth
// implicitly via the engine's MAX_TREEMAP_DEPTH (10).
interface TreemapInputZod {
  name: string
  value?: number
  children?: TreemapInputZod[]
  color?: string
}
const treemapInputSchema: z.ZodType<TreemapInputZod> = z.lazy(() =>
  z.object({
    name: z.string().min(1).max(200),
    value: z.number().optional(),
    children: z.array(treemapInputSchema).max(500).optional(),
    color: z.string().max(32).optional(),
  })
)

const bodySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("sankey"), input: sankeyInputSchema }),
  z.object({ kind: z.literal("waterfall"), input: waterfallInputSchema }),
  z.object({ kind: z.literal("heatmap"), input: heatmapInputSchema }),
  z.object({ kind: z.literal("treemap"), input: treemapInputSchema }),
])

export const POST = withRlsAuth("reports", "read", async (req, auth) => {
  // `reports:read` — render-prep belongs in the reports/dashboards
  // module rather than `ai` (no LLM cost) or `settings` (no admin
  // implication). Same scope I1/I2 dashboard widget endpoints use.

  // Transport-agnostic body parsing — req.text() + trim, mirrors H6/H13.
  let body: unknown = {}
  let raw: string
  try {
    raw = await req.text()
  } catch {
    return NextResponse.json({ error: "Could not read request body" }, { status: 400 })
  }
  if (raw.trim().length > 0) {
    try {
      body = JSON.parse(raw)
    } catch {
      return NextResponse.json({ error: "Malformed JSON body" }, { status: 400 })
    }
  }
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  let shape
  try {
    // No cast needed — input types use mutable arrays so the Zod-
    // inferred discriminated union is structurally assignable to
    // BuildAdvancedCall directly.
    shape = buildAdvancedChart(parsed.data)
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Chart-prep failed" },
      { status: 422 }
    )
  }

  return NextResponse.json({ success: true, ...shape })
})
