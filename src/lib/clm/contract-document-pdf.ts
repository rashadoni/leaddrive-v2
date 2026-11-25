/**
 * The PDF of a price protocol or an acceptance act (src/lib/clm/contract-documents.ts):
 * title, the contract it belongs to, the table of goods and services, the
 * totals with VAT, the closing sentence and a signature block for both sides.
 * Several pages for a long table, the header row repeated, «page N / M» below.
 */
import jsPDF from "jspdf"
import { registerUnicodeFont } from "@/lib/pdf/unicode-font"
import { drawSignatureSheet, sheetTimeZone, signatureSheetContent, type SignatureSheet } from "@/lib/clm/signature-sheet"
import {
  documentTotals,
  documentWords,
  lineAmount,
  moneyText,
  quantityText,
  type DocLang,
  type DocumentFacts,
  type DocumentLine,
} from "@/lib/clm/contract-documents"

export interface DocumentPdfInput {
  facts: DocumentFacts
  lines: DocumentLine[]
  currency: string
  lang: DocLang
  /** The signed copy: who signed, how and when, as the last page (signature-sheet.ts). */
  signatureSheet?: SignatureSheet | null
  /** IANA zone for the sheet's times; UTC when absent or unknown. */
  timeZone?: string | null
}

export function generateContractDocumentPdf(input: DocumentPdfInput): Uint8Array {
  const { facts, lines, currency, lang } = input
  const w = documentWords(facts, lang)
  const totals = documentTotals(lines, facts.vatRate)
  const doc = new jsPDF({ unit: "mm", format: "a4" })
  const FONT = registerUnicodeFont(doc)
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  const margin = 15
  const width = pageWidth - margin * 2
  const bottom = pageHeight - 22
  let y = 20

  doc.setTextColor(20, 20, 20)
  doc.setFont(FONT, "bold")
  doc.setFontSize(14)
  doc.text(w.title, pageWidth / 2, y, { align: "center" })
  y += 6
  doc.setFont(FONT, "normal")
  doc.setFontSize(9.5)
  for (const line of doc.splitTextToSize(w.subtitle, width) as string[]) {
    doc.text(line, pageWidth / 2, y, { align: "center" })
    y += 4.6
  }
  y += 2
  doc.setFontSize(9)
  doc.setTextColor(90, 90, 90)
  doc.text(w.city, margin, y)
  if (w.validity) doc.text(w.validity, pageWidth - margin, y, { align: "right" })
  y += 8

  doc.setTextColor(25, 25, 25)
  doc.setFontSize(10)
  const intro = doc.splitTextToSize(w.intro, width) as string[]
  doc.text(intro, margin, y)
  y += intro.length * 4.8 + 4

  // ── Table ─────────────────────────────────────────────────────────────
  const cols = [
    { key: "no", width: 9, align: "left" as const },
    { key: "name", width: width - 9 - 18 - 20 - 26 - 30, align: "left" as const },
    { key: "unit", width: 18, align: "left" as const },
    { key: "quantity", width: 20, align: "right" as const },
    { key: "price", width: 26, align: "right" as const },
    { key: "amount", width: 30, align: "right" as const },
  ]
  const header = () => {
    doc.setFillColor(242, 242, 242)
    doc.rect(margin, y - 4.5, width, 7, "F")
    doc.setFont(FONT, "bold")
    doc.setFontSize(8.5)
    let x = margin
    for (const col of cols) {
      const label = w.columns[col.key as keyof typeof w.columns]
      doc.text(label, col.align === "right" ? x + col.width - 1.5 : x + 1.5, y, { align: col.align })
      x += col.width
    }
    y += 6
    doc.setFont(FONT, "normal")
    doc.setFontSize(9)
  }
  header()
  lines.forEach((line, index) => {
    const nameLines = doc.splitTextToSize(line.name, cols[1].width - 3) as string[]
    const rowHeight = Math.max(1, nameLines.length) * 4.4 + 2
    if (y + rowHeight > bottom) {
      doc.addPage()
      y = 20
      header()
    }
    const cells = [
      String(index + 1),
      nameLines,
      line.unit ?? "",
      quantityText(line.quantity),
      moneyText(line.unitPrice),
      line.quantity === null ? "—" : moneyText(lineAmount(line)),
    ]
    let x = margin
    cols.forEach((col, i) => {
      doc.text(cells[i] as string | string[], col.align === "right" ? x + col.width - 1.5 : x + 1.5, y, { align: col.align })
      x += col.width
    })
    y += rowHeight
    doc.setDrawColor(225, 225, 225)
    doc.setLineWidth(0.2)
    doc.line(margin, y - 3, margin + width, y - 3)
  })

  // ── Totals (when there are quantities to add up) ──────────────────────
  if (lines.some((l) => l.quantity !== null)) {
    if (y + 20 > bottom) {
      doc.addPage()
      y = 20
    }
    y += 2
    const rows: Array<[string, string, boolean]> = [
      [w.subtotal, `${moneyText(totals.subtotal)} ${currency}`, false],
      [w.vat, `${moneyText(totals.vatAmount)} ${currency}`, false],
      [w.total, `${moneyText(totals.totalAmount)} ${currency}`, true],
    ]
    for (const [label, value, bold] of rows) {
      doc.setFont(FONT, bold ? "bold" : "normal")
      doc.text(label, pageWidth - margin - 60, y)
      doc.text(value, pageWidth - margin - 1.5, y, { align: "right" })
      y += 5.5
    }
  }

  // ── Closing and signatures ────────────────────────────────────────────
  doc.setFont(FONT, "normal")
  doc.setFontSize(9.5)
  const closing = doc.splitTextToSize(w.closing, width) as string[]
  if (y + closing.length * 4.6 + 40 > bottom) {
    doc.addPage()
    y = 20
  }
  y += 4
  doc.text(closing, margin, y)
  y += closing.length * 4.6 + 10

  const half = width / 2
  const side = (x: number, label: string, party: { name: string; director: string | null }) => {
    let yy = y
    doc.setFont(FONT, "bold")
    doc.text(label, x, yy)
    yy += 5
    doc.setFont(FONT, "normal")
    for (const l of doc.splitTextToSize(party.name, half - 8) as string[]) {
      doc.text(l, x, yy)
      yy += 4.6
    }
    if (party.director) {
      doc.text(`${w.director}: ${party.director}`, x, yy)
      yy += 4.6
    }
    yy += 8
    doc.setDrawColor(150, 150, 150)
    doc.line(x, yy, x + half - 12, yy)
    doc.setFontSize(8)
    doc.setTextColor(120, 120, 120)
    doc.text(w.signature, x, yy + 4)
    doc.setFontSize(9.5)
    doc.setTextColor(25, 25, 25)
  }
  side(margin, w.sideA, facts.our)
  side(margin + half + 4, w.sideB, facts.counterparty)

  if (input.signatureSheet) {
    const content = signatureSheetContent(
      input.signatureSheet,
      { contractNumber: facts.contractNumber, title: w.title },
      lang,
      sheetTimeZone(input.timeZone),
    )
    drawSignatureSheet(doc, FONT, content)
  }

  const pages = doc.getNumberOfPages()
  for (let page = 1; page <= pages; page++) {
    doc.setPage(page)
    doc.setFontSize(8)
    doc.setTextColor(150, 150, 150)
    doc.text(`${w.subtitle} · ${page} / ${pages}`, pageWidth / 2, pageHeight - 8, { align: "center" })
  }
  return new Uint8Array(doc.output("arraybuffer"))
}
