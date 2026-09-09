import { NextResponse } from "next/server"
import { z, ZodError } from "zod"
import { withRls } from "@/lib/with-rls"
import { executeReport } from "@/lib/report-engine"
import ExcelJS from "exceljs"

const exportSchema = z.object({
  entityType: z.string().min(1).max(100).optional(),
  entity: z.string().min(1).max(100).optional(),
  // .optional() is load-bearing: the frontend sends columns INSIDE `config`
  // (see the unwrap below), so there is no top-level key. Under zod 3 a bare
  // z.any() accepted a missing key; zod 4 requires it, which turned every
  // Report Builder export into a 400 the UI swallowed silently.
  columns: z.any().optional(),
  filters: z.any().default([]),
  groupBy: z.string().max(100).optional().nullable(),
  sortBy: z.string().max(100).optional().nullable(),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
  format: z.enum(["csv", "xlsx"]),
  // Also accept nested config from frontend
  config: z.any().optional(),
}).refine(data => data.entityType || data.entity || data.config?.entity || data.config?.entityType, {
  message: "entityType or entity is required",
})

export const POST = withRls(async (req, { orgId }) => {

  let body
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  let validated
  try {
    validated = exportSchema.parse(body)
  } catch (e) {
    if (e instanceof ZodError) {
      return NextResponse.json({ error: "Validation failed", details: e.flatten().fieldErrors }, { status: 400 })
    }
    return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  }

  // Unwrap nested config if frontend sent { config: {...}, format }
  const cfg = validated.config || validated
  const entityType = cfg.entityType || cfg.entity
  const format = validated.format

  // Normalize columns: accept string[] or {field,label}[]
  const rawColumns = cfg.columns || []
  const normalizedColumns = Array.isArray(rawColumns)
    ? rawColumns.map((c: any) => typeof c === "string" ? { field: c } : c)
    : []

  // Normalize filters
  const normalizedFilters = Array.isArray(cfg.filters)
    ? cfg.filters.map((f: any) => ({
        field: f.field,
        op: f.operator || f.op || "eq",
        value: f.value,
      }))
    : []

  let result
  try {
    result = await executeReport(orgId, {
      entityType,
      columns: normalizedColumns,
      filters: normalizedFilters,
      groupBy: cfg.groupBy ?? undefined,
      sortBy: cfg.sortBy ?? undefined,
      sortOrder: cfg.sortOrder || "desc",
    })
  } catch (e: any) {
    console.error("Report export error:", e)
    return NextResponse.json({ error: e.message || "Report execution failed" }, { status: 500 })
  }

  const rows = result.data as Record<string, any>[]
  const columnNames = normalizedColumns.map((c: any) => c.field || c)
  const filename = `report-${entityType}-${Date.now()}`

  if (format === "csv") {
    const escapeCsv = (val: any): string => {
      if (val === null || val === undefined) return ""
      const str = String(val)
      if (str.includes(",") || str.includes('"') || str.includes("\n")) {
        return `"${str.replace(/"/g, '""')}"`
      }
      return str
    }

    const headerLine = columnNames.map(escapeCsv).join(",")
    const dataLines = rows.map((row) => {
      return columnNames.map((col: string) => {
        // Handle relation fields like "company.name"
        if (col.includes(".")) {
          const [rel, field] = col.split(".")
          return escapeCsv(row[rel]?.[field] ?? "")
        }
        return escapeCsv(row[col])
      }).join(",")
    })
    const csv = [headerLine, ...dataLines].join("\n")

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}.csv"`,
      },
    })
  }

  // XLSX export
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet("Report")

  sheet.columns = columnNames.map((col: string) => ({
    header: col,
    key: col,
    width: 20,
  }))

  for (const row of rows) {
    const rowData: Record<string, any> = {}
    for (const col of columnNames) {
      if (col.includes(".")) {
        const [rel, field] = col.split(".")
        rowData[col] = row[rel]?.[field] ?? ""
      } else {
        rowData[col] = row[col] ?? ""
      }
    }
    sheet.addRow(rowData)
  }

  // Style header row
  const headerRow = sheet.getRow(1)
  headerRow.font = { bold: true }
  headerRow.commit()

  const buffer = await workbook.xlsx.writeBuffer()

  return new NextResponse(buffer as ArrayBuffer, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}.xlsx"`,
    },
  })
})
