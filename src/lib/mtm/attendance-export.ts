import jsPDF from "jspdf"
import { buildXlsxWorkbook } from "@/lib/export/tabular"
import { protectMtmExcelText } from "@/lib/mtm/excel-contract"
import { registerUnicodeFont } from "@/lib/pdf/unicode-font"
import type { AttendanceTable } from "@/lib/mtm/attendance-table"

export const MAX_ATTENDANCE_EXPORT_ROWS = 10_000
export class AttendanceExportTooLarge extends Error { readonly code = "MTM_ATTENDANCE_EXPORT_TOO_LARGE" }
export function checkAttendanceExportSize(table: AttendanceTable) {
  if (table.rows.length > MAX_ATTENDANCE_EXPORT_ROWS) throw new AttendanceExportTooLarge()
}
export function buildAttendanceXlsx(table: AttendanceTable) {
  checkAttendanceExportSize(table)
  return buildXlsxWorkbook([
    { name: table.title, headers: table.columns.map((column) => protectMtmExcelText(column.label) as string), rows: table.rows.map((row) => row.cells.map(protectMtmExcelText)) },
    { name: "Info", headers: [protectMtmExcelText(table.title) as string], rows: [...table.details, ...table.totals].map((line) => [protectMtmExcelText(line)]) },
  ])
}

/** Readable horizontal bands repeat the employee column in a 31-day month. */
export function buildAttendancePdf(table: AttendanceTable): Buffer {
  checkAttendanceExportSize(table)
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4", compress: true })
  const font = registerUnicodeFont(doc)
  const margin = 12
  const width = 297 - margin * 2
  const bottom = 195
  const identity = table.columns.findIndex((column) => column.key === "employee")
  const all = table.columns.map((_, index) => index)
  const bands: number[][] = []
  // A day report (up to 16 columns) stays on one page width — its notes are not a second page
  // (owner, 2026-11-01); only a month grid's 31 days are cut into bands.
  const perBand = all.length <= 16 ? all.length : 12
  for (let i = 0; i < all.length; i += perBand) {
    const band = all.slice(i, i + perBand)
    if (i && identity >= 0 && !band.includes(identity)) band.unshift(identity)
    bands.push(band)
  }
  /**
   * Every column first gets room for its longest word (header included), so a word such as
   * «TExnologiyaları» is never cut in the middle; what is left goes mostly to the notes and the
   * name-like columns. When even the words do not fit, the earlier proportional split is kept.
   */
  const columnWidths = (band: number[], fontSize: number) => {
    const keys = band.map((index) => table.columns[index].key)
    const weights = keys.map((key) => key === "notes" ? 4 : ["employee", "position", "department", "team", "status"].includes(key) ? 1.2 : 0.3)
    const proportional = () => {
      const old = keys.map((key) => ["employee", "team", "status", "notes"].includes(key) ? 1.6 : 1)
      const sum = old.reduce((total, weight) => total + weight, 0)
      return old.map((weight) => width * weight / sum)
    }
    // A name and a date are kept on one line when they fit in a fifth of the page; other cells only keep their words whole.
    const widest = (values: unknown[], bold: boolean, whole: boolean) => {
      doc.setFont(font, bold ? "bold" : "normal").setFontSize(fontSize)
      let result = 0
      for (const value of values) for (const piece of whole ? [String(value ?? "")] : String(value ?? "").split(/\s+/)) result = Math.max(result, doc.getTextWidth(piece))
      return result
    }
    const longest = band.map((index) => {
      const name = table.columns[index].key === "employee" || table.columns[index].key === "date"
      const cells = Math.min(widest(table.rows.map((row) => row.cells[index]), false, name), name ? width / 5 : Infinity)
      return Math.min(Math.max(widest([table.columns[index].label], true, false), cells, name ? widest(table.rows.map((row) => row.cells[index]), false, false) : 0) + 4.5, width / 3)
    })
    const needed = longest.reduce((total, value) => total + value, 0)
    if (needed > width) return proportional()
    const weightSum = weights.reduce((total, weight) => total + weight, 0)
    return longest.map((value, position) => value + (width - needed) * weights[position] / weightSum)
  }
  let y = margin
  const textBlock = (text: string, bold = false, size = 8) => {
    doc.setFont(font, bold ? "bold" : "normal").setFontSize(size)
    const lines = doc.splitTextToSize(text, width) as string[]
    for (const line of lines) {
      if (y + 4 > bottom) { doc.addPage(); y = margin }
      doc.text(line, margin, y + 3)
      y += size >= 12 ? 6 : 4
    }
  }
  textBlock(table.title, true, 14)
  for (const detail of table.details) textBlock(detail)
  y += 4
  for (let bandIndex = 0; bandIndex < bands.length; bandIndex++) {
    const band = bands[bandIndex]
    if (bandIndex) { doc.addPage(); y = margin; textBlock(table.title, true, 12); y += 2 }
    const fontSize = band.length > 12 ? 7 : 8
    const widths = columnWidths(band, fontSize)
    const draw = (values: (string | number)[], header: boolean) => {
      doc.setFont(font, header ? "bold" : "normal").setFontSize(fontSize)
      const cells = band.map((index, position) => doc.splitTextToSize(String(values[index] ?? ""), widths[position] - 4) as string[])
      const lineCount = Math.max(1, ...cells.map((lines) => lines.length))
      // Very long user-entered text continues rather than being clipped.
      for (let offset = 0; offset < lineCount;) {
        let capacity = Math.floor((bottom - y - 4) / 4)
        if (capacity < 1) { doc.addPage(); y = margin; if (!header) draw(table.columns.map((column) => column.label), true); capacity = Math.floor((bottom - y - 4) / 4) }
        const count = Math.min(capacity, lineCount - offset)
        const height = count * 4 + 4
        let x = margin
        doc.setFont(font, header ? "bold" : "normal").setFontSize(fontSize)
        for (let position = 0; position < band.length; position++) {
          if (header) { doc.setFillColor(250, 237, 228); doc.rect(x, y, widths[position], height, "F") }
          doc.setDrawColor(228, 228, 231).rect(x, y, widths[position], height)
          const lines = cells[position].slice(offset, offset + count)
          if (lines.length) doc.text(lines, x + 2, y + 5, { lineHeightFactor: 1.4 })
          x += widths[position]
        }
        y += height
        offset += count
      }
    }
    draw(table.columns.map((column) => column.label), true)
    for (const row of table.rows) draw(row.cells, false)
  }
  y += 5
  for (const line of table.totals) textBlock(line)
  const pages = doc.getNumberOfPages()
  for (let number = 1; number <= pages; number++) { doc.setPage(number); doc.setFont(font, "normal").setFontSize(7); doc.text(`${number} / ${pages}`, 285, 204, { align: "right" }) }
  return Buffer.from(doc.output("arraybuffer"))
}
