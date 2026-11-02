import { NextResponse } from "next/server"
import ExcelJS from "exceljs"
import { Prisma } from "@prisma/client"
import { withRlsAuth } from "@/lib/with-rls"
import { prisma } from "@/lib/prisma"
import { eQaimeWhere } from "@/lib/finance/e-qaime"
import ruMessages from "../../../../../../messages/ru.json"
import enMessages from "../../../../../../messages/en.json"
import azMessages from "../../../../../../messages/az.json"

const CATALOGS = { az: azMessages, ru: ruMessages, en: enMessages } as const
type Lang = keyof typeof CATALOGS

/** More than this and the accountant should narrow the period. */
const MAX_INVOICES = 5000

const COLUMNS = [
  "direction", "kind", "status", "serialNumber", "date", "sellerName", "sellerVoen", "buyerName", "buyerVoen",
  "product", "code", "unit", "quantity", "price", "net", "vat18Base", "vat", "otherBase", "excise", "roadTax",
  "lineTotal", "comment", "sourceSerial",
] as const
const WIDTHS = [12, 16, 18, 18, 12, 34, 13, 34, 13, 40, 13, 9, 11, 12, 14, 14, 12, 14, 11, 11, 14, 36, 18]

const dec = (value: unknown) => {
  if (value === null || value === undefined || value === "") return new Prisma.Decimal(0)
  try { return new Prisma.Decimal(String(value)) } catch { return new Prisma.Decimal(0) }
}
const num = (d: Prisma.Decimal) => d.toNumber()

/**
 * GET — every line of every invoice in the tab's filter, one row per product,
 * as an Excel file: what accountants otherwise copy from the portal by hand.
 * Takes the same query as the list, both directions unless `direction` is set.
 */
export const GET = withRlsAuth("finance", "read", async (req, { orgId }) => {
  const params = req.nextUrl.searchParams
  const direction = params.get("direction")
  const cookieLang = req.cookies.get("NEXT_LOCALE")?.value
  const lang: Lang = cookieLang === "ru" || cookieLang === "en" ? cookieLang : "az"
  const t = (CATALOGS[lang] as unknown as { finance: { eqaime: Record<string, Record<string, string>> } }).finance.eqaime

  const where = {
    ...eQaimeWhere(orgId, params),
    ...(direction === "inbox" || direction === "outbox" ? { direction } : {}),
  }
  const count = await prisma.eQaimeInvoice.count({ where })
  if (count > MAX_INVOICES) {
    return NextResponse.json({ error: "Too many invoices", limit: MAX_INVOICES }, { status: 422 })
  }
  const invoices = await prisma.eQaimeInvoice.findMany({ where, orderBy: [{ issuedAt: "asc" }, { serialNumber: "asc" }] })

  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet("e-qaime", { views: [{ state: "frozen", ySplit: 1 }] })
  sheet.columns = COLUMNS.map((key, index) => ({ header: t.export[key] ?? key, key, width: WIDTHS[index] }))
  sheet.getRow(1).font = { bold: true }
  sheet.getRow(1).alignment = { wrapText: true, vertical: "middle" }

  for (const invoice of invoices) {
    const ours = { name: invoice.ownName, voen: invoice.ownVoen }
    const theirs = { name: invoice.counterpartyName, voen: invoice.counterpartyVoen ?? "" }
    const [seller, buyer] = invoice.direction === "inbox" ? [theirs, ours] : [ours, theirs]
    const lines = Array.isArray(invoice.items) ? (invoice.items as Record<string, string | null>[]) : []
    for (const line of lines.length ? lines : [{}]) {
      const vat18 = dec(line.vat18)
      const vat = vat18.times("0.18")
      const other = dec(line.vat0).plus(dec(line.vatFree)).plus(dec(line.exempt))
      const net = dec(line.cost)
      const excise = dec(line.excise)
      const roadTax = dec(line.roadTax)
      sheet.addRow({
        direction: t.direction[invoice.direction] ?? invoice.direction,
        kind: (invoice.kind && t.kind[invoice.kind]) || invoice.kind || "",
        status: t.status[invoice.status] ?? invoice.status,
        serialNumber: invoice.serialNumber,
        date: invoice.issuedAt,
        sellerName: seller.name,
        sellerVoen: seller.voen,
        buyerName: buyer.name,
        buyerVoen: buyer.voen,
        product: line.name ?? "",
        code: line.code ?? "",
        unit: line.unit ?? "",
        quantity: line.quantity == null ? null : num(dec(line.quantity)),
        price: line.price == null ? null : num(dec(line.price)),
        net: num(net),
        vat18Base: num(vat18),
        vat: num(vat.toDecimalPlaces(6)),
        otherBase: num(other),
        excise: num(excise),
        roadTax: num(roadTax),
        lineTotal: num(net.plus(vat).plus(excise).plus(roadTax).toDecimalPlaces(6)),
        comment: [invoice.comment, invoice.comment2].filter(Boolean).join(" · "),
        sourceSerial: line.sourceSerial ?? invoice.sourceSerials.join(", "),
      })
    }
  }
  sheet.getColumn("date").numFmt = "dd.mm.yyyy"
  for (const key of ["quantity", "price", "net", "vat18Base", "vat", "otherBase", "excise", "roadTax", "lineTotal"]) {
    sheet.getColumn(key).numFmt = "#,##0.00####"
  }

  const buffer = await workbook.xlsx.writeBuffer()
  const from = params.get("from") ?? ""
  const to = params.get("to") ?? ""
  const name = `e-qaime${from ? `_${from}` : ""}${to ? `_${to}` : ""}.xlsx`.replace(/[^\w.-]/g, "")
  return new NextResponse(new Uint8Array(buffer as ArrayBuffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "private, no-store",
    },
  })
})
