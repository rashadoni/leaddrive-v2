import { NextResponse } from "next/server"
import { z } from "zod"
import { withRouteFieldWebRlsAuth } from "@/lib/with-mtm-rls-auth"
import { checkRateLimit } from "@/lib/rate-limit"
import { buildXlsxWorkbook, contentDispositionAttachment } from "@/lib/export/tabular"
import { protectMtmExcelText } from "@/lib/mtm/excel-contract"

const MAX_COLUMNS = 16
/** The live roster is capped at 500 employees; the file never needs more rows than twice that. */
const MAX_ROWS = 1_000
const MAX_CELL_LENGTH = 300
const MAX_BODY_BYTES = 1_000_000
const RATE_LIMIT = { maxRequests: 10, windowMs: 60_000 }

const ExportSchema = z.object({
  sheetName: z.string().trim().min(1).max(31),
  /** The file's name without the extension: lower-case ASCII, digits and dashes. */
  fileName: z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/),
  headers: z.array(z.string().trim().min(1).max(80)).min(1).max(MAX_COLUMNS),
  rows: z.array(z.array(z.string().max(MAX_CELL_LENGTH)).max(MAX_COLUMNS)).max(MAX_ROWS),
}).refine((table) => table.rows.every((row) => row.length === table.headers.length), {
  message: "Every row must have one cell per header",
})

/**
 * POST /api/v1/mtm/locations/export
 *
 * The live map's list as an .xlsx file. The table is sent by the page — the
 * rows the dispatcher sees, already in words (src/lib/mtm/live-map-roster-export.ts):
 * the status, the freshness and the distance to the picked point are worked
 * out in the browser, and a file read from the database here would disagree
 * with the screen. This route only puts those words into a workbook; it reads
 * and writes nothing of the tenant.
 *
 * A real workbook rather than a CSV: Excel with Russian or Azerbaijani
 * regional settings opens a comma-separated file into one column.
 */
export const POST = withRouteFieldWebRlsAuth("read", async (req, auth) => {
  if (!checkRateLimit(`mtm-live-map-export:${auth.orgId}:${auth.userId}`, RATE_LIMIT)) {
    return NextResponse.json(
      { error: "Too many exports. Try again in a minute.", code: "MTM_LIVE_MAP_EXPORT_RATE_LIMITED" },
      { status: 429, headers: { "Retry-After": "60" } },
    )
  }

  const raw = await req.text().catch(() => "")
  if (!raw || Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) {
    return NextResponse.json(
      { error: "The table is empty or too large", code: "MTM_LIVE_MAP_EXPORT_INVALID" },
      { status: raw ? 413 : 400 },
    )
  }
  let body: unknown
  try {
    body = JSON.parse(raw)
  } catch {
    return NextResponse.json({ error: "Invalid JSON", code: "MTM_LIVE_MAP_EXPORT_INVALID" }, { status: 400 })
  }
  const parsed = ExportSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid table", code: "MTM_LIVE_MAP_EXPORT_INVALID" }, { status: 400 })
  }

  const { sheetName, fileName, headers, rows } = parsed.data
  // An employee's name is typed by somebody: a cell that begins like a
  // formula stays text when the file is opened or saved on as CSV.
  const workbook = buildXlsxWorkbook([{
    name: sheetName,
    headers: headers.map((header) => protectMtmExcelText(header) as string),
    rows: rows.map((row) => row.map((cell) => protectMtmExcelText(cell))),
  }])
  const buffer = Buffer.from(await workbook.xlsx.writeBuffer())
  return new NextResponse(buffer as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": contentDispositionAttachment(`${fileName}.xlsx`),
      "Cache-Control": "no-store",
    },
  })
})
