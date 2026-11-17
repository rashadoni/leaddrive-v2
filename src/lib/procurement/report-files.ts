import jsPDF from "jspdf"
import { registerUnicodeFont } from "@/lib/pdf/unicode-font"
import type { SheetSpec } from "@/lib/export/tabular"
import type { ProcurementReport } from "@/lib/procurement/reports"

/**
 * The purchasing report as files (task 7.2): an Excel workbook with one sheet
 * per table and a PDF with the figures and the supplier and margin tables.
 * Column titles in the reader's language.
 */
type Lang = "az" | "ru" | "en"

const W: Record<Lang, Record<string, string>> = {
  ru: { title: "Отчёт по закупкам", period: "Период", orders: "Заказы", suppliers: "Поставщики", deals: "Маржа по сделкам", number: "№", supplier: "Поставщик", deal: "Сделка", status: "Статус", currency: "Валюта", total: "Сумма", created: "Создан", expected: "Срок", received: "Принят", delay: "Опоздание, дн.", count: "Заказов", spend: "Расход", gotIn: "Принято", onTime: "Вовремя", late: "С опозданием", avgDelay: "Ср. опоздание, дн.", revenue: "Выручка", cost: "Себестоимость", margin: "Маржа", marginPct: "Маржа, %", otherCurrency: "заказы в другой валюте", kpiOrders: "Заказов", kpiOnTime: "Вовремя, %", kpiDelay: "Среднее опоздание, дн.", kpiLate: "Опаздывают сейчас", kpiApproval: "Согласование, ч", kpiSpend: "Расход" },
  az: { title: "Təchizat hesabatı", period: "Dövr", orders: "Sifarişlər", suppliers: "Təchizatçılar", deals: "Sövdələşmələr üzrə marja", number: "№", supplier: "Təchizatçı", deal: "Sövdələşmə", status: "Status", currency: "Valyuta", total: "Məbləğ", created: "Yaradılıb", expected: "Müddət", received: "Qəbul edilib", delay: "Gecikmə, gün", count: "Sifariş", spend: "Xərc", gotIn: "Qəbul edilib", onTime: "Vaxtında", late: "Gecikmə ilə", avgDelay: "Orta gecikmə, gün", revenue: "Gəlir", cost: "Maya dəyəri", margin: "Marja", marginPct: "Marja, %", otherCurrency: "başqa valyutada sifarişlər", kpiOrders: "Sifariş", kpiOnTime: "Vaxtında, %", kpiDelay: "Orta gecikmə, gün", kpiLate: "İndi gecikir", kpiApproval: "Təsdiq, saat", kpiSpend: "Xərc" },
  en: { title: "Purchasing report", period: "Period", orders: "Orders", suppliers: "Suppliers", deals: "Margin by deal", number: "No.", supplier: "Supplier", deal: "Deal", status: "Status", currency: "Currency", total: "Total", created: "Created", expected: "Due", received: "Received", delay: "Delay, days", count: "Orders", spend: "Spend", gotIn: "Received", onTime: "On time", late: "Late", avgDelay: "Avg delay, days", revenue: "Revenue", cost: "Cost", margin: "Margin", marginPct: "Margin, %", otherCurrency: "orders in another currency", kpiOrders: "Orders", kpiOnTime: "On time, %", kpiDelay: "Avg delay, days", kpiLate: "Late now", kpiApproval: "Approval, hours", kpiSpend: "Spend" },
}

export function reportLang(value: string | null | undefined): Lang {
  return value === "ru" || value === "en" ? value : "az"
}

const day = (iso: string | null) => (iso ? iso.slice(0, 10) : "")

export function reportSheets(report: ProcurementReport, lang: Lang): SheetSpec[] {
  const w = W[lang]
  return [
    {
      name: w.orders,
      headers: [w.number, w.supplier, w.deal, w.status, w.currency, w.total, w.created, w.expected, w.received, w.delay],
      rows: report.orders.map((o) => [o.number, o.supplier, o.deal ?? "", o.status, o.currency, o.total, day(o.createdAt), day(o.expectedDeliveryAt), day(o.receivedAt), o.delayDays ?? ""]),
    },
    {
      name: w.suppliers,
      headers: [w.supplier, w.currency, w.count, w.spend, w.gotIn, w.onTime, w.late, w.avgDelay],
      rows: report.suppliers.map((s) => [s.supplier, s.currency, s.orders, s.spend, s.received, s.onTime, s.late, s.averageDelayDays ?? ""]),
    },
    {
      name: w.deals,
      headers: [w.deal, w.currency, w.revenue, w.cost, w.margin, w.marginPct],
      rows: report.deals.map((d) => [d.deal, d.currency, d.revenue, d.cost ?? w.otherCurrency, d.margin ?? "", d.marginPct ?? ""]),
    },
  ]
}

const fmt = (value: number) => value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function reportPdf(report: ProcurementReport, lang: Lang, organization: string): Uint8Array {
  const w = W[lang]
  const doc = new jsPDF({ unit: "mm", format: "a4" })
  const FONT = registerUnicodeFont(doc)
  const width = doc.internal.pageSize.getWidth()
  const height = doc.internal.pageSize.getHeight()
  const margin = 15
  let y = 18
  doc.setFont(FONT, "bold")
  doc.setFontSize(15)
  doc.text(w.title, margin, y)
  doc.setFont(FONT, "normal")
  doc.setFontSize(9)
  doc.text(`${organization} · ${w.period}: ${day(report.period.from)} — ${day(new Date(new Date(report.period.to).getTime() - 86_400_000).toISOString())}`, margin, y + 6)
  y += 14
  const k = report.kpis
  const spend = Object.entries(k.committedByCurrency).map(([c, v]) => `${fmt(v)} ${c}`).join(", ") || "0"
  const kpis: [string, string][] = [
    [w.kpiOrders, String(k.orders)], [w.kpiSpend, spend], [w.kpiOnTime, k.onTimePct === null ? "—" : String(k.onTimePct)],
    [w.kpiDelay, k.averageDelayDays === null ? "—" : String(k.averageDelayDays)], [w.kpiLate, String(k.lateOpen)], [w.kpiApproval, k.averageApprovalHours === null ? "—" : String(k.averageApprovalHours)],
  ]
  for (const [label, value] of kpis) {
    doc.text(`${label}: ${value}`, margin, y)
    y += 5
  }
  y += 4
  const table = (title: string, headers: string[], rows: string[][], cols: number[], right: Set<number>) => {
    if (y > height - 40) { doc.addPage(); y = 18 }
    doc.setFont(FONT, "bold")
    doc.setFontSize(11)
    doc.text(title, margin, y)
    y += 6
    doc.setFontSize(8)
    const head = () => {
      doc.setFont(FONT, "bold")
      headers.forEach((h, i) => doc.text(h, right.has(i) ? cols[i + 1] - 2 : cols[i], y, right.has(i) ? { align: "right" } : undefined))
      doc.setFont(FONT, "normal")
      y += 5
    }
    head()
    for (const row of rows) {
      if (y > height - 15) { doc.addPage(); y = 18; head() }
      row.forEach((cell, i) => {
        const text = (doc.splitTextToSize(cell, cols[i + 1] - cols[i] - 3) as string[])[0] ?? ""
        doc.text(text, right.has(i) ? cols[i + 1] - 2 : cols[i], y, right.has(i) ? { align: "right" } : undefined)
      })
      y += 4.5
    }
    y += 5
  }
  table(w.suppliers, [w.supplier, w.currency, w.count, w.spend, w.onTime, w.late, w.avgDelay],
    report.suppliers.map((s) => [s.supplier, s.currency, String(s.orders), fmt(s.spend), String(s.onTime), String(s.late), s.averageDelayDays === null ? "—" : String(s.averageDelayDays)]),
    [margin, 70, 88, 106, 140, 158, 175, width - margin], new Set([2, 3, 4, 5, 6]))
  table(w.deals, [w.deal, w.currency, w.revenue, w.cost, w.margin, w.marginPct],
    report.deals.map((d) => [d.deal, d.currency, fmt(d.revenue), d.cost === null ? w.otherCurrency : fmt(d.cost), d.margin === null ? "—" : fmt(d.margin), d.marginPct === null ? "—" : String(d.marginPct)]),
    [margin, 78, 96, 125, 152, 178, width - margin], new Set([2, 3, 4, 5]))
  return new Uint8Array(doc.output("arraybuffer"))
}
