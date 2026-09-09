import ExcelJS from "exceljs"

/**
 * Shared tabular-export helpers (CSV + XLSX). Mirrors the conventions already used
 * across the app's export endpoints (ExcelJS, csvEscape, RFC-5987 filenames) so
 * the task export + the upcoming operational/KPI reports all build files the same
 * way. Keep it data-only and framework-agnostic (no NextResponse here).
 */

export interface SheetSpec {
  name: string
  headers: string[]
  rows: unknown[][]
}

// UTF-8 byte-order mark (U+FEFF) prepended to CSV so Excel renders non-ASCII
// (Azerbaijani labels, the manat sign, etc.) correctly instead of as mojibake.
const UTF8_BOM = "﻿"

/** RFC-4180 CSV cell escaping + formula-injection guard ([P3] 2026-06-10): string cells starting
 *  with = + - @ (or a leading TAB/CR variant) get a `'` prefix so user-controlled values (task
 *  comments, survey emails/names) can't execute as live formulas in Excel/Sheets. Numbers/Dates
 *  are emitted as-is (a numeric -5 stays -5; Dates serialize to ISO which never starts with a
 *  trigger char). Mirrors inbox-analytics csvCell. */
export function csvEscape(v: unknown): string {
  if (v == null) return ""
  let s = v instanceof Date ? v.toISOString() : String(v)
  if (typeof v === "string" && /^[\t\r]*[=+\-@]/.test(s)) s = `'${s}`
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** Build a single-sheet CSV string (BOM-prefixed for Excel). */
export function toCsv(headers: string[], rows: unknown[][]): string {
  const lines = [headers.map(csvEscape).join(",")]
  for (const r of rows) lines.push(r.map(csvEscape).join(","))
  return UTF8_BOM + lines.join("\r\n")
}

/** Build an ExcelJS workbook from one or more sheet specs (bold header row +
 *  rough auto-width). The caller awaits `.xlsx.writeBuffer()` and responds. */
export function buildXlsxWorkbook(sheets: SheetSpec[]): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook()
  wb.creator = "LeadDrive CRM"
  for (const s of sheets) {
    // Excel sheet names cap at 31 chars and forbid : \ / ? * [ ].
    const ws = wb.addWorksheet(s.name.replace(/[:\\/?*[\]]/g, " ").slice(0, 31) || "Sheet")
    ws.addRow(s.headers)
    ws.getRow(1).font = { bold: true }
    ws.views = [{ state: "frozen", ySplit: 1 }]
    for (const r of s.rows) ws.addRow(r as ExcelJS.CellValue[])
    s.headers.forEach((h, i) => {
      const maxCell = s.rows.reduce((m, r) => Math.max(m, String(r[i] ?? "").length), h.length)
      ws.getColumn(i + 1).width = Math.min(60, Math.max(10, maxCell + 2))
    })
  }
  return wb
}

/** RFC-5987 Content-Disposition value supporting non-ASCII filenames. */
export function contentDispositionAttachment(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7E]/g, "_").replace(/"/g, "_")
  const utf8 = encodeURIComponent(filename)
  return `attachment; filename="${ascii}"; filename*=UTF-8''${utf8}`
}
