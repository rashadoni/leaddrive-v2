import jsPDF from "jspdf"
import { registerUnicodeFont } from "@/lib/pdf/unicode-font"

/**
 * A purchase order as the supplier receives it (task 3.3): who orders, from
 * whom, the lines with prices, the total and the expected date. Plain and
 * printable, in the language asked for (Azerbaijani by default — the
 * suppliers are local), several pages for a long order with the table header
 * repeated.
 */
type Lang = "az" | "ru" | "en"

const WORDS: Record<Lang, Record<string, string>> = {
  az: { title: "SATINALMA SİFARİŞİ", buyer: "Sifarişçi", supplier: "Təchizatçı", date: "Tarix", expected: "Çatdırılma tarixi", no: "№", item: "Mal / xidmət", qty: "Miqdar", unit: "Vahid", price: "Qiymət", amount: "Məbləğ", total: "Cəmi", note: "Qeyd", page: "səhifə", voen: "VÖEN" },
  ru: { title: "ЗАКАЗ ПОСТАВЩИКУ", buyer: "Заказчик", supplier: "Поставщик", date: "Дата", expected: "Срок поставки", no: "№", item: "Товар / услуга", qty: "Кол-во", unit: "Ед.", price: "Цена", amount: "Сумма", total: "Итого", note: "Примечание", page: "стр.", voen: "VÖEN" },
  en: { title: "PURCHASE ORDER", buyer: "Buyer", supplier: "Supplier", date: "Date", expected: "Delivery date", no: "No.", item: "Item", qty: "Qty", unit: "Unit", price: "Price", amount: "Amount", total: "Total", note: "Note", page: "page", voen: "VÖEN" },
}

export interface OrderPdfInput {
  lang?: string | null
  number: string
  createdAt: Date
  expectedDeliveryAt: Date | null
  currency: string
  totalAmount: string | number
  note: string | null
  buyer: { name: string }
  supplier: { name: string; voen: string | null; address: string | null; phone: string | null; email: string | null }
  items: { name: string; unit: string | null; quantity: string | number; unitPrice: string | number; total: string | number }[]
}

const fmt = (value: string | number, digits = 2) => Number(value).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits === 2 ? 2 : 4 })
const day = (date: Date) => date.toISOString().slice(0, 10).split("-").reverse().join(".")

export function generatePurchaseOrderPdf(input: OrderPdfInput): Uint8Array {
  const lang: Lang = input.lang === "ru" || input.lang === "en" ? input.lang : "az"
  const w = WORDS[lang]
  const doc = new jsPDF({ unit: "mm", format: "a4" })
  const FONT = registerUnicodeFont(doc)
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  const margin = 15
  const cols = { no: margin, item: margin + 8, qty: 120, unit: 138, price: 165, amount: pageWidth - margin }

  doc.setFont(FONT, "bold")
  doc.setFontSize(16)
  doc.text(w.title, margin, 20)
  doc.setFontSize(11)
  doc.text(input.number, pageWidth - margin, 20, { align: "right" })
  doc.setFont(FONT, "normal")
  doc.setFontSize(9)
  doc.text(`${w.date}: ${day(input.createdAt)}`, pageWidth - margin, 26, { align: "right" })
  if (input.expectedDeliveryAt) doc.text(`${w.expected}: ${day(input.expectedDeliveryAt)}`, pageWidth - margin, 31, { align: "right" })

  let y = 40
  doc.setFont(FONT, "bold")
  doc.text(w.buyer, margin, y)
  doc.text(w.supplier, pageWidth / 2, y)
  doc.setFont(FONT, "normal")
  y += 5
  doc.text(doc.splitTextToSize(input.buyer.name, pageWidth / 2 - margin - 4), margin, y)
  const supplierLines = [
    input.supplier.name,
    input.supplier.voen ? `${w.voen}: ${input.supplier.voen}` : null,
    input.supplier.address,
    [input.supplier.phone, input.supplier.email].filter(Boolean).join(" · ") || null,
  ].filter((line): line is string => !!line)
  let sy = y
  for (const line of supplierLines) {
    const wrapped = doc.splitTextToSize(line, pageWidth / 2 - margin) as string[]
    doc.text(wrapped, pageWidth / 2, sy)
    sy += wrapped.length * 4.5
  }
  y = Math.max(y + 6, sy) + 6

  const header = () => {
    doc.setFillColor(240, 240, 240)
    doc.rect(margin, y - 4.5, pageWidth - margin * 2, 7, "F")
    doc.setFont(FONT, "bold")
    doc.text(w.no, cols.no, y)
    doc.text(w.item, cols.item, y)
    doc.text(w.qty, cols.qty, y, { align: "right" })
    doc.text(w.unit, cols.unit, y)
    doc.text(w.price, cols.price, y, { align: "right" })
    doc.text(w.amount, cols.amount, y, { align: "right" })
    doc.setFont(FONT, "normal")
    y += 7
  }
  header()
  input.items.forEach((item, index) => {
    const wrapped = doc.splitTextToSize(item.name, cols.qty - cols.item - 18) as string[]
    const height = Math.max(1, wrapped.length) * 4.5 + 1.5
    if (y + height > pageHeight - 25) {
      doc.addPage()
      y = 20
      header()
    }
    doc.text(String(index + 1), cols.no, y)
    doc.text(wrapped, cols.item, y)
    doc.text(fmt(item.quantity, 4), cols.qty, y, { align: "right" })
    doc.text(item.unit ?? "", cols.unit, y)
    doc.text(fmt(item.unitPrice), cols.price, y, { align: "right" })
    doc.text(fmt(item.total), cols.amount, y, { align: "right" })
    y += height
  })
  y += 2
  doc.setDrawColor(200, 200, 200)
  doc.line(margin, y - 3, pageWidth - margin, y - 3)
  doc.setFont(FONT, "bold")
  doc.text(`${w.total}: ${fmt(input.totalAmount)} ${input.currency}`, pageWidth - margin, y + 2, { align: "right" })
  doc.setFont(FONT, "normal")
  if (input.note) {
    y += 10
    if (y > pageHeight - 30) { doc.addPage(); y = 20 }
    doc.text(`${w.note}: `, margin, y)
    doc.text(doc.splitTextToSize(input.note, pageWidth - margin * 2 - 20), margin + 20, y)
  }

  const pages = doc.getNumberOfPages()
  for (let page = 1; page <= pages; page += 1) {
    doc.setPage(page)
    doc.setFontSize(8)
    doc.text(`${input.number} · ${w.page} ${page} / ${pages}`, pageWidth - margin, pageHeight - 10, { align: "right" })
  }
  return new Uint8Array(doc.output("arraybuffer"))
}
