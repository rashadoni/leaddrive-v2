import ExcelJS from "exceljs"

/**
 * A spreadsheet the customer already keeps — .xlsx or .csv — read into a header
 * row and data rows of plain strings (docs/sales-procurement/README.md, task 7.4).
 * The first sheet of a workbook; a CSV with `,` or `;` (what Excel writes in
 * Azerbaijan and Russia), quoted fields with commas and line breaks inside.
 */
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024
export const MAX_IMPORT_ROWS = 5000

export class SpreadsheetError extends Error {
  constructor(readonly code: "TOO_BIG" | "UNREADABLE" | "EMPTY" | "TOO_MANY_ROWS" | "TYPE", message: string) {
    super(message)
  }
}

export interface Sheet { headers: string[]; rows: string[][] }

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return ""
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  if (typeof value === "object") {
    if ("richText" in value && Array.isArray(value.richText)) return value.richText.map((part) => part.text).join("")
    if ("text" in value && typeof value.text === "string") return value.text
    if ("result" in value) return cellText(value.result as ExcelJS.CellValue)
    if ("hyperlink" in value && typeof value.hyperlink === "string") return value.hyperlink
    return ""
  }
  return String(value)
}

function parseCsv(text: string): string[][] {
  const firstLine = text.slice(0, text.indexOf("\n") === -1 ? text.length : text.indexOf("\n"))
  const delimiter = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ";" : ","
  const rows: string[][] = []
  let row: string[] = []
  let field = ""
  let quoted = false
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i += 1 }
      else if (ch === '"') quoted = false
      else field += ch
    } else if (ch === '"') quoted = true
    else if (ch === delimiter) { row.push(field); field = "" }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i += 1
      row.push(field); field = ""
      rows.push(row); row = []
    } else field += ch
  }
  if (field !== "" || row.length > 0) { row.push(field); rows.push(row) }
  return rows
}

export async function readSpreadsheet(fileName: string, bytes: Buffer): Promise<Sheet> {
  if (bytes.length > MAX_IMPORT_BYTES) throw new SpreadsheetError("TOO_BIG", "The file is larger than 5 MB")
  const lower = fileName.toLowerCase()
  let table: string[][]
  if (lower.endsWith(".xlsx")) {
    const workbook = new ExcelJS.Workbook()
    try {
      await workbook.xlsx.load(bytes as unknown as ArrayBuffer)
    } catch {
      throw new SpreadsheetError("UNREADABLE", "The workbook could not be read")
    }
    const sheet = workbook.worksheets[0]
    if (!sheet) throw new SpreadsheetError("EMPTY", "The workbook has no sheet")
    table = []
    sheet.eachRow({ includeEmpty: false }, (row) => {
      const values = Array.isArray(row.values) ? row.values.slice(1) : []
      table.push(values.map((value) => cellText(value as ExcelJS.CellValue).trim()))
    })
  } else if (lower.endsWith(".csv") || lower.endsWith(".txt")) {
    table = parseCsv(bytes.toString("utf8").replace(/^﻿/, "")).map((row) => row.map((cell) => cell.trim()))
  } else {
    throw new SpreadsheetError("TYPE", "Only .xlsx and .csv files are read")
  }
  table = table.filter((row) => row.some((cell) => cell !== ""))
  if (table.length < 2) throw new SpreadsheetError("EMPTY", "The file has no rows under its header")
  if (table.length - 1 > MAX_IMPORT_ROWS) throw new SpreadsheetError("TOO_MANY_ROWS", `At most ${MAX_IMPORT_ROWS} rows at once`)
  const width = Math.max(...table.map((row) => row.length))
  const headers = Array.from({ length: width }, (_, i) => table[0][i] || `#${i + 1}`)
  const rows = table.slice(1).map((row) => Array.from({ length: width }, (_, i) => row[i] ?? ""))
  return { headers, rows }
}
