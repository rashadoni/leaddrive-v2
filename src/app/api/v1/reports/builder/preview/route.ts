import { NextResponse } from "next/server"
import { z, ZodError } from "zod"
import { withRls } from "@/lib/with-rls"
import { executeReport } from "@/lib/report-engine"

const previewSchema = z.object({
  entityType: z.string().min(1).max(100).optional(),
  entity: z.string().min(1).max(100).optional(),
  columns: z.any(),
  filters: z.any().default([]),
  groupBy: z.string().max(100).optional().nullable(),
  sortBy: z.string().max(100).optional().nullable(),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
  limit: z.number().int().min(1).max(10000).default(100),
}).refine(data => data.entityType || data.entity, {
  message: "entityType or entity is required",
})

export const POST = withRls(async (req, { orgId }) => {
  let body
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  let config
  try {
    config = previewSchema.parse(body)
  } catch (e) {
    if (e instanceof ZodError) {
      return NextResponse.json({ error: "Validation failed", details: e.flatten().fieldErrors }, { status: 400 })
    }
    return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  }

  // Normalize: accept both "entity" and "entityType"
  const entityType = config.entityType || config.entity!

  // Normalize columns: accept string[] or {field,label}[]
  const normalizedColumns = Array.isArray(config.columns)
    ? config.columns.map((c: any) => typeof c === "string" ? { field: c } : c)
    : []

  // Normalize filters
  const normalizedFilters = Array.isArray(config.filters)
    ? config.filters.map((f: any) => ({
        field: f.field,
        op: f.operator || f.op || "eq",
        value: f.value,
      }))
    : []

  try {
    const result = await executeReport(orgId, {
      entityType,
      columns: normalizedColumns,
      filters: normalizedFilters,
      groupBy: config.groupBy ?? undefined,
      sortBy: config.sortBy ?? undefined,
      sortOrder: config.sortOrder,
      limit: config.limit,
    })

    // Transform to frontend-expected format: { rows, total, aggregates }
    const data = result.data as any[]
    return NextResponse.json({
      rows: data,
      total: data.length,
      aggregates: result.type === "grouped" ? { groupBy: result.groupBy } : undefined,
    })
  } catch (e: any) {
    console.error("Report preview error:", e)
    return NextResponse.json({ error: e.message || "Report execution failed" }, { status: 500 })
  }
})
