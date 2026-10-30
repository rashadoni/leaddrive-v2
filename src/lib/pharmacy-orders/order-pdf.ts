import { jsPDF } from "jspdf"

import { PDF_FONT, registerUnicodeFont } from "@/lib/pdf/unicode-font"

/**
 * The phone order as a document the pharmacy keeps (owner, 2026-10-29: «как в
 * 1С… без лого, название как в 1С, если там на русском — на русском»). Shaped
 * like Zeytun's own 1C printout: company line, document line, pharmacy, one
 * table, totals. Product names are 1C's Наименование exactly as the feed has
 * it; a line nobody found yet carries the caller's words.
 */
export type OrderPdfLine = { name: string; found: boolean; quantity: number; unit: string; price: string | null; total: string | null }
export type OrderPdfInput = {
  company: string
  label: string
  takenAt: Date
  pharmacy: string | null
  status: { kind: "received" } | { kind: "confirmed"; at: Date } | { kind: "rejected"; at: Date }
  lines: OrderPdfLine[]
  total: string
}

const MM = { left: 15, right: 195, top: 18 }
const COLUMNS = [
  { title: "№", width: 9, align: "right" as const },
  { title: "Məhsulun adı (1C)", width: 93, align: "left" as const },
  { title: "Miqdar", width: 16, align: "right" as const },
  { title: "Vahid", width: 16, align: "left" as const },
  { title: "Qiymət", width: 20, align: "right" as const },
  { title: "Məbləğ", width: 26, align: "right" as const },
]

function bakuTime(at: Date) {
  return new Intl.DateTimeFormat("ru-RU", { timeZone: "Asia/Baku", day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit" }).format(at).replace(",", "")
}

const money = (value: string) => Number(value).toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function phoneOrderPdf(input: OrderPdfInput): Uint8Array<ArrayBuffer> {
  const doc = new jsPDF({ unit: "mm", format: "a4" })
  registerUnicodeFont(doc)
  let y = MM.top
  doc.setFont(PDF_FONT, "bold").setFontSize(15).text(input.company, MM.left, y)
  y += 8
  doc.setFontSize(12).text(`Sifariş ${input.label} — ${bakuTime(input.takenAt)}`, MM.left, y)
  y += 6
  doc.setFont(PDF_FONT, "normal").setFontSize(9.5)
  doc.text(input.status.kind === "confirmed" ? `Təsdiqləndi: ${bakuTime(input.status.at)}`
    : input.status.kind === "rejected" ? `Rədd edildi: ${bakuTime(input.status.at)}` : "Menecerin yoxlamasını gözləyir", MM.left, y)
  y += 5
  doc.text("Telefonla qəbul edilib (süni intellekt köməkçisi)", MM.left, y)
  y += 8
  doc.setFont(PDF_FONT, "bold").text("Alıcı:", MM.left, y)
  doc.setFont(PDF_FONT, "normal").text(input.pharmacy ?? "—", MM.left + 13, y)
  y += 7

  // A long order runs over several pages: each one repeats the table's head
  // and says which order and page it is, so a printed sheet stands alone.
  const PAGE_BOTTOM = 280
  const row = (cells: string[], bold: boolean, fill?: boolean) => {
    doc.setFont(PDF_FONT, bold ? "bold" : "normal").setFontSize(9)
    const wrapped = cells.map((cell, i) => doc.splitTextToSize(cell, COLUMNS[i].width - 3) as string[])
    const height = Math.max(...wrapped.map(lines => lines.length)) * 4.2 + 3
    if (!fill && y + height > PAGE_BOTTOM) { doc.addPage(); y = MM.top; head() }
    let x = MM.left
    if (fill) { doc.setFillColor(242, 242, 242); doc.rect(MM.left, y, MM.right - MM.left, height, "F") }
    doc.setFont(PDF_FONT, bold ? "bold" : "normal").setFontSize(9)
    wrapped.forEach((lines, i) => {
      const col = COLUMNS[i]
      doc.rect(x, y, col.width, height)
      lines.forEach((line, k) => {
        const ty = y + 4.6 + k * 4.2
        if (col.align === "right") doc.text(line, x + col.width - 1.5, ty, { align: "right" })
        else doc.text(line, x + 1.5, ty)
      })
      x += col.width
    })
    y += height
  }
  const head = () => row(COLUMNS.map(c => c.title), true, true)
  doc.setDrawColor(150)
  head()
  input.lines.forEach((line, i) => row([String(i + 1), line.found ? line.name : `${line.name} (yoxlanılır)`, String(line.quantity),
    line.unit, line.price ? money(line.price) : "—", line.total ? money(line.total) : "—"], false))

  const unpriced = input.lines.some(line => !line.found || !line.total)
  if (y + 7 + (unpriced ? 6 : 0) > PAGE_BOTTOM + 8) { doc.addPage(); y = MM.top }
  y += 7
  doc.setFont(PDF_FONT, "bold").setFontSize(11)
  const amount = `${money(input.total)} AZN`
  doc.text(amount, MM.right, y, { align: "right" })
  doc.text("Cəmi:", MM.right - doc.getTextWidth(amount) - 4, y, { align: "right" })
  if (unpriced) {
    y += 6
    doc.setFont(PDF_FONT, "normal").setFontSize(8.5)
    doc.text("Qiyməti olmayan sətirlər cəmə daxil deyil; menecer onları yoxlayır.", MM.right, y, { align: "right" })
  }
  const pages = doc.getNumberOfPages()
  if (pages > 1) {
    doc.setFont(PDF_FONT, "normal").setFontSize(8.5).setTextColor(110)
    for (let page = 1; page <= pages; page++) {
      doc.setPage(page)
      doc.text(`Sifariş ${input.label} — səhifə ${page} / ${pages}`, MM.right, 290, { align: "right" })
    }
  }
  return new Uint8Array(doc.output("arraybuffer"))
}
