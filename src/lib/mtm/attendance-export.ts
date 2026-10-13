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
  for (let i = 0; i < all.length; i += 12) {
    const band = all.slice(i, i + 12)
    if (i && identity >= 0 && !band.includes(identity)) band.unshift(identity)
    bands.push(band)
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
    const weights = band.map((index) => ["employee", "team", "status", "notes"].includes(table.columns[index].key) ? 1.6 : 1)
    const weightSum = weights.reduce((sum, weight) => sum + weight, 0)
    const widths = weights.map((weight) => width * weight / weightSum)
    const draw = (values: (string | number)[], header: boolean) => {
      doc.setFont(font, header ? "bold" : "normal").setFontSize(8)
      const cells = band.map((index, position) => doc.splitTextToSize(String(values[index] ?? ""), widths[position] - 4) as string[])
      const lineCount = Math.max(1, ...cells.map((lines) => lines.length))
      // Very long user-entered text continues rather than being clipped.
      for (let offset = 0; offset < lineCount;) {
        let capacity = Math.floor((bottom - y - 4) / 4)
        if (capacity < 1) { doc.addPage(); y = margin; if (!header) draw(table.columns.map((column) => column.label), true); capacity = Math.floor((bottom - y - 4) / 4) }
        const count = Math.min(capacity, lineCount - offset)
        const height = count * 4 + 4
        let x = margin
        doc.setFont(font, header ? "bold" : "normal").setFontSize(8)
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
