/**
 * S6 CPQ — slice-3 piece-2: Quote PDF renderer.
 *
 * Pure helper that takes a Quote + its line items + optional Deal +
 * Organization snapshot, returns a PDF as `Uint8Array` ready to stream
 * back from the route. Mirrors the offers `/api/v1/offers/[id]/pdf`
 * jsPDF pattern but factored as a reusable function so the route stays
 * a thin orchestrator and the renderer is unit-testable.
 *
 * Tenant branding: reads `Organization.branding` (JSON: primaryColor,
 * companyName, favicon) + `Organization.logo` (separate column).
 * Falls back to the org `name` when companyName is absent, and to a
 * neutral grey accent when primaryColor is unset.
 *
 * Language (2026-11-19): the PDF goes to the customer, so it speaks the
 * organization's language — az / ru / en, the words in `WORDS` — chosen by
 * `quotePdfLanguage`. Until then every label was English («QUOTE», «FROM»,
 * «Subtotal», «DRAFT») on an Azerbaijani tenant's offer.
 *
 * Table (2026-11-19): the currency is named once, in the money column
 * headers («Qiymət, AZN»), not after every number, and every numeric column
 * is as wide as its longest value (`layoutQuoteTable`), with a fixed gap to
 * its neighbour. Before, columns sat at fixed offsets 20 mm apart, so a
 * quantity of 24 and «180.00 AZN» printed as «24 180.00 AZN» — one number.
 * The item column takes what is left and wraps long names.
 *
 * Rejection reason: NOT included in the customer-facing PDF — it's an
 * internal audit field stored under bound-AAD encryption. The route
 * layer would never decrypt it just to ship in a buyer's email.
 */
import jsPDF from "jspdf"
import { registerUnicodeFont } from "@/lib/pdf/unicode-font"
import { locales } from "@/i18n/routing"
import type { Prisma } from "@prisma/client"

export interface QuotePdfInput {
  /** az / ru / en; anything else falls back to az. See `quotePdfLanguage`. */
  lang?: string | null
  quote: {
    quoteNumber: string
    version: number
    status: string
    validUntil: Date | null
    currency: string
    subtotal: Prisma.Decimal | string
    discountAmount: Prisma.Decimal | string
    discountPct: Prisma.Decimal | string | null
    totalAmount: Prisma.Decimal | string
    notes: string | null
    customerName: string | null
    createdAt: Date
    sentAt: Date | null
    acceptedAt: Date | null
    deal: { name: string; company?: { name: string } | null } | null
    lineItems: Array<{
      productName: string
      description: string | null
      quantity: Prisma.Decimal | string
      unitPrice: Prisma.Decimal | string
      lineDiscountAmount: Prisma.Decimal | string
      lineDiscountPct: Prisma.Decimal | string | null
      lineTotal: Prisma.Decimal | string
      sortOrder: number
    }>
  }
  organization: {
    name: string
    logo: string | null
    branding: Prisma.JsonValue
  }
}

interface BrandingShape {
  primaryColor?: string
  companyName?: string
  favicon?: string
}

/**
 * Parse `Organization.branding` defensively — schema is `Json` so
 * unexpected shapes shouldn't crash the renderer.
 */
function readBranding(branding: Prisma.JsonValue): BrandingShape {
  if (!branding || typeof branding !== "object" || Array.isArray(branding)) return {}
  const b = branding as Record<string, unknown>
  return {
    primaryColor: typeof b.primaryColor === "string" ? b.primaryColor : undefined,
    companyName: typeof b.companyName === "string" ? b.companyName : undefined,
    favicon: typeof b.favicon === "string" ? b.favicon : undefined,
  }
}

/**
 * #RRGGBB → [r, g, b] tuple for jsPDF setTextColor / setFillColor.
 * Returns `null` if parse fails; caller falls back to a neutral colour.
 */
function parseHexColor(hex: string | undefined): [number, number, number] | null {
  if (!hex) return null
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim())
  if (!m) return null
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]
}


export type QuotePdfLang = "az" | "ru" | "en"

const WORDS: Record<QuotePdfLang, {
  title: string
  version: (n: number) => string
  from: string
  to: string
  deal: string
  issued: string
  sent: string
  validUntil: string
  no: string
  item: string
  qty: string
  price: string
  discount: string
  amount: string
  subtotal: string
  total: string
  notes: string
  generated: string
  page: string
  status: Record<string, string>
}> = {
  az: {
    title: "KOMMERSİYA TƏKLİFİ",
    version: (n) => `versiya ${n}`,
    from: "TƏKLİF EDƏN",
    to: "MÜŞTƏRİ",
    deal: "Sövdələşmə",
    issued: "Tarix",
    sent: "Göndərilib",
    validUntil: "Etibarlılıq müddəti",
    no: "№",
    item: "Mal / xidmət",
    qty: "Miqdar",
    price: "Qiymət",
    discount: "Endirim",
    amount: "Məbləğ",
    subtotal: "Ara cəm",
    total: "CƏMİ",
    notes: "QEYD",
    generated: "Hazırlanıb",
    page: "səhifə",
    status: { draft: "QARALAMA", sent: "GÖNDƏRİLİB", viewed: "BAXILIB", accepted: "QƏBUL EDİLİB", rejected: "RƏDD EDİLİB", expired: "MÜDDƏTİ BİTİB" },
  },
  ru: {
    title: "КОММЕРЧЕСКОЕ ПРЕДЛОЖЕНИЕ",
    version: (n) => `версия ${n}`,
    from: "ПОСТАВЩИК",
    to: "КЛИЕНТ",
    deal: "Сделка",
    issued: "Дата",
    sent: "Отправлено",
    validUntil: "Действует до",
    no: "№",
    item: "Товар / услуга",
    qty: "Кол-во",
    price: "Цена",
    discount: "Скидка",
    amount: "Сумма",
    subtotal: "Подытог",
    total: "ИТОГО",
    notes: "ПРИМЕЧАНИЕ",
    generated: "Сформировано",
    page: "стр.",
    status: { draft: "ЧЕРНОВИК", sent: "ОТПРАВЛЕНО", viewed: "ПРОСМОТРЕНО", accepted: "ПРИНЯТО", rejected: "ОТКЛОНЕНО", expired: "ИСТЁК СРОК" },
  },
  en: {
    title: "QUOTE",
    version: (n) => `v${n}`,
    from: "FROM",
    to: "FOR",
    deal: "Deal",
    issued: "Issued",
    sent: "Sent",
    validUntil: "Valid until",
    no: "No.",
    item: "Item",
    qty: "Qty",
    price: "Price",
    discount: "Discount",
    amount: "Amount",
    subtotal: "Subtotal",
    total: "TOTAL",
    notes: "NOTES",
    generated: "Generated",
    page: "page",
    status: { draft: "DRAFT", sent: "SENT", viewed: "VIEWED", accepted: "ACCEPTED", rejected: "REJECTED", expired: "EXPIRED" },
  },
}

function asLang(value: unknown): QuotePdfLang | null {
  return typeof value === "string" && (locales as readonly string[]).includes(value) ? (value as QuotePdfLang) : null
}

/**
 * The language of the quote PDF:
 *   `?lang=` on the request → the organization's «Язык общения с клиентами»
 *   (`settings.language`, older `settings.locale` — the rule of
 *   `organizationLocale`) → the language the person's CRM is open in
 *   (`x-locale`) → az.
 * The organization's setting goes before the person's own screen: the PDF is
 * for the customer, as the tenant's e-mails and WhatsApp notices are.
 */
export function quotePdfLanguage(input: { query?: string | null; organizationSettings?: unknown; uiLocale?: string | null }): QuotePdfLang {
  const settings = input.organizationSettings && typeof input.organizationSettings === "object" && !Array.isArray(input.organizationSettings)
    ? (input.organizationSettings as Record<string, unknown>)
    : {}
  return asLang(input.query) ?? asLang(settings.language) ?? asLang(settings.locale) ?? asLang(input.uiLocale) ?? "az"
}

function toNumber(value: Prisma.Decimal | string | number): number {
  return typeof value === "number" ? value : Number(value.toString())
}

function fmtNumber(value: Prisma.Decimal | string | number): string {
  const n = toNumber(value)
  if (!Number.isFinite(n)) return String(value)
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtMoney(value: Prisma.Decimal | string | number, currency: string): string {
  return `${fmtNumber(value)} ${currency}`
}

function fmtQty(value: Prisma.Decimal | string): string {
  const n = toNumber(value)
  if (!Number.isFinite(n)) return String(value)
  // Whole quantities stay whole («24», not «24.00»).
  return n.toLocaleString("en-US", { maximumFractionDigits: 4 })
}

/** dd.mm.yyyy — the way the order PDF and Azerbaijani paperwork write dates. */
function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10).split("-").reverse().join(".")
}

/**
 * Resolve the PDF buyer lines. Precedence:
 *   typed customerName (trimmed, non-empty) → linked deal's company →
 *   `<Deal>: <name>` → "—". Manual name fully overrides the deal lines.
 * Pure + exported so the precedence is unit-testable without rendering a PDF.
 */
export function resolveBuyerName(
  quote: {
    customerName?: string | null
    deal?: { name?: string | null; company?: { name?: string | null } | null } | null
  },
  dealLabel = "Deal",
): string[] {
  const manualName = quote.customerName?.trim()
  if (manualName) return [manualName]
  const lines: string[] = []
  if (quote.deal?.company?.name) lines.push(quote.deal.company.name)
  if (quote.deal?.name) lines.push(`${dealLabel}: ${quote.deal.name}`)
  return lines.length > 0 ? lines : ["—"]
}

export type QuoteTableColumnKey = "qty" | "price" | "discount" | "total"

export interface QuoteTableLayout {
  fontSize: number
  no: { left: number; width: number }
  item: { left: number; width: number }
  /** Right-aligned numeric columns, left to right; `right` is the alignment edge. */
  columns: Array<{ key: QuoteTableColumnKey; header: string; right: number; width: number }>
}

/** Space between two numeric columns, mm — never less, whatever the numbers. */
export const QUOTE_COLUMN_GAP = 5
const TABLE_PAD = 2
const ITEM_MIN_WIDTH = 55

/**
 * Column geometry of the line-items table. Each numeric column is exactly as
 * wide as its widest cell (header included, at the weight it is printed in),
 * and columns are laid right to left with `QUOTE_COLUMN_GAP` between them, so
 * two neighbouring numbers cannot touch. The item column gets the rest; if
 * that is under `ITEM_MIN_WIDTH`, the table steps down a point size (9 → 7).
 */
export function layoutQuoteTable(
  doc: jsPDF,
  font: string,
  input: {
    left: number
    right: number
    rowCount: number
    noHeader: string
    columns: Array<{ key: QuoteTableColumnKey; header: string; values: string[]; boldValues?: boolean }>
  },
): QuoteTableLayout {
  const measure = (text: string, bold: boolean, size: number) => {
    doc.setFont(font, bold ? "bold" : "normal")
    doc.setFontSize(size)
    return doc.getTextWidth(text)
  }
  let layout: QuoteTableLayout | null = null
  for (const size of [9, 8, 7]) {
    const noWidth = Math.max(measure(input.noHeader, true, size), measure(String(Math.max(1, input.rowCount)), false, size))
    const widths = input.columns.map((col) =>
      Math.max(measure(col.header, true, size), ...col.values.map((v) => measure(v, !!col.boldValues, size))),
    )
    let cursor = input.right - TABLE_PAD
    const placed: QuoteTableLayout["columns"] = []
    for (let i = input.columns.length - 1; i >= 0; i -= 1) {
      placed.unshift({ key: input.columns[i].key, header: input.columns[i].header, right: cursor, width: widths[i] })
      cursor -= widths[i] + QUOTE_COLUMN_GAP
    }
    const noLeft = input.left + TABLE_PAD
    const itemLeft = noLeft + noWidth + 3
    layout = {
      fontSize: size,
      no: { left: noLeft, width: noWidth },
      item: { left: itemLeft, width: cursor - itemLeft },
      columns: placed,
    }
    if (layout.item.width >= ITEM_MIN_WIDTH) break
  }
  doc.setFont(font, "normal")
  return layout!
}

export function generateQuotePdf(input: QuotePdfInput): Uint8Array {
  const { quote, organization } = input
  const lang = quotePdfLanguage({ query: input.lang })
  const w = WORDS[lang]
  const branding = readBranding(organization.branding)
  const accent = parseHexColor(branding.primaryColor) ?? [60, 60, 60] // neutral grey fallback
  const sellerName = branding.companyName ?? organization.name
  const currency = quote.currency

  const doc = new jsPDF({ unit: "mm", format: "a4" })
  // Unicode font so Azerbaijani (ə/İ/ş/ğ) and Cyrillic render instead of mangling under Helvetica.
  const FONT = registerUnicodeFont(doc)
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  const margin = 14
  const bottomLimit = pageHeight - 22
  let y = 18

  const newPage = () => {
    doc.addPage()
    y = 20
  }

  // ── Header band ─────────────────────────────────────────────────
  doc.setFillColor(accent[0], accent[1], accent[2])
  doc.rect(0, 0, pageWidth, 10, "F")

  // Quote number + version + status (right-aligned)
  doc.setFontSize(10)
  doc.setFont(FONT, "normal")
  doc.setTextColor(20, 20, 20)
  const numberText = `${quote.quoteNumber}${quote.version > 1 ? ` · ${w.version(quote.version)}` : ""}`
  doc.text(numberText, pageWidth - margin, y, { align: "right" })
  const numberWidth = doc.getTextWidth(numberText)
  doc.setTextColor(accent[0], accent[1], accent[2])
  doc.setFont(FONT, "bold")
  const statusText = w.status[quote.status] ?? quote.status.toUpperCase()
  doc.text(statusText, pageWidth - margin, y + 6, { align: "right" })
  const statusWidth = doc.getTextWidth(statusText)
  doc.setTextColor(20, 20, 20)

  // Title — shrinks rather than run into the number block on the right.
  doc.setFont(FONT, "bold")
  const titleRoom = pageWidth - margin * 2 - Math.max(numberWidth, statusWidth) - 8
  let titleSize = 20
  doc.setFontSize(titleSize)
  while (titleSize > 12 && doc.getTextWidth(w.title) > titleRoom) {
    titleSize -= 1
    doc.setFontSize(titleSize)
  }
  doc.text(w.title, margin, y + 4)

  y += 18

  // ── Seller / Buyer ──────────────────────────────────────────────
  doc.setFont(FONT, "bold")
  doc.setFontSize(9)
  doc.setTextColor(120, 120, 120)
  doc.text(w.from, margin, y)
  doc.text(w.to, pageWidth / 2 + 4, y)

  y += 5
  doc.setFont(FONT, "normal")
  doc.setFontSize(11)
  doc.setTextColor(20, 20, 20)

  // Each column spans to the page midpoint (seller) or the right margin
  // (buyer) with a 4 mm gap; long names wrap instead of overflowing.
  const colWidth = pageWidth / 2 - margin - 4
  const sellerLines = doc.splitTextToSize(sellerName, colWidth) as string[]
  sellerLines.forEach((ln, i) => doc.text(ln, margin, y + i * 5))
  const buyerLines = resolveBuyerName(quote, w.deal).flatMap((ln) => doc.splitTextToSize(ln, colWidth) as string[])
  buyerLines.forEach((line, i) => doc.text(line, pageWidth / 2 + 4, y + i * 5))
  y += Math.max(sellerLines.length, buyerLines.length) * 5 + 6

  // ── Dates row ───────────────────────────────────────────────────
  doc.setFontSize(9)
  doc.setTextColor(120, 120, 120)
  let dateX = margin
  for (const [label, date] of [[w.issued, quote.createdAt], [w.sent, quote.sentAt]] as const) {
    if (!date) continue
    const text = `${label}: ${fmtDate(date)}`
    doc.text(text, dateX, y)
    dateX += doc.getTextWidth(text) + 8
  }
  if (quote.validUntil) {
    doc.setFont(FONT, "bold")
    doc.text(`${w.validUntil}: ${fmtDate(quote.validUntil)}`, pageWidth - margin, y, { align: "right" })
    doc.setFont(FONT, "normal")
  }
  y += 10

  // ── Line items table ────────────────────────────────────────────
  const sortedLines = [...quote.lineItems].sort((a, b) => a.sortOrder - b.sortOrder)
  // The discount column only when some line has one — a column of zeros
  // takes room the item names need.
  const showDiscount = sortedLines.some((line) => toNumber(line.lineDiscountAmount) > 0.0001)
  const table = layoutQuoteTable(doc, FONT, {
    left: margin,
    right: pageWidth - margin,
    rowCount: sortedLines.length,
    noHeader: w.no,
    columns: [
      { key: "qty", header: w.qty, values: sortedLines.map((l) => fmtQty(l.quantity)) },
      { key: "price", header: `${w.price}, ${currency}`, values: sortedLines.map((l) => fmtNumber(l.unitPrice)) },
      ...(showDiscount
        ? [{ key: "discount" as const, header: `${w.discount}, ${currency}`, values: sortedLines.map((l) => fmtNumber(l.lineDiscountAmount)) }]
        : []),
      { key: "total", header: `${w.amount}, ${currency}`, values: sortedLines.map((l) => fmtNumber(l.lineTotal)), boldValues: true },
    ],
  })
  const size = table.fontSize
  // Matches `lineHeightFactor: 1.15` below (1 pt = 0.3528 mm).
  const lineHeight = size * 1.15 * 0.3528
  const descSize = size - 1
  const descLineHeight = descSize * 1.15 * 0.3528

  const tableHeader = () => {
    doc.setFillColor(accent[0], accent[1], accent[2])
    doc.rect(margin, y - 4.5, pageWidth - margin * 2, 7, "F")
    doc.setFont(FONT, "bold")
    doc.setFontSize(size)
    doc.setTextColor(255, 255, 255)
    doc.text(w.no, table.no.left, y)
    doc.text(w.item, table.item.left, y)
    for (const col of table.columns) doc.text(col.header, col.right, y, { align: "right" })
    doc.setTextColor(20, 20, 20)
    doc.setFont(FONT, "normal")
    y += 7.5
  }
  tableHeader()

  sortedLines.forEach((line, index) => {
    doc.setFont(FONT, "normal")
    doc.setFontSize(size)
    const nameLines = doc.splitTextToSize(line.productName, table.item.width) as string[]
    doc.setFontSize(descSize)
    const descLines = line.description ? (doc.splitTextToSize(line.description, table.item.width) as string[]) : []
    const rowHeight = nameLines.length * lineHeight + descLines.length * descLineHeight + 3
    if (y + rowHeight > bottomLimit) {
      newPage()
      tableHeader()
    }
    doc.setFontSize(size)
    doc.text(String(index + 1), table.no.left, y)
    doc.text(nameLines, table.item.left, y, { lineHeightFactor: 1.15 })
    const cells: Record<QuoteTableColumnKey, string> = {
      qty: fmtQty(line.quantity),
      price: fmtNumber(line.unitPrice),
      discount: fmtNumber(line.lineDiscountAmount),
      total: fmtNumber(line.lineTotal),
    }
    for (const col of table.columns) {
      doc.setFont(FONT, col.key === "total" ? "bold" : "normal")
      doc.text(cells[col.key], col.right, y, { align: "right" })
    }
    doc.setFont(FONT, "normal")
    if (descLines.length > 0) {
      doc.setFontSize(descSize)
      doc.setTextColor(120, 120, 120)
      doc.text(descLines, table.item.left, y + nameLines.length * lineHeight, { lineHeightFactor: 1.15 })
      doc.setTextColor(20, 20, 20)
    }
    y += rowHeight
    doc.setDrawColor(230)
    doc.line(margin, y - 3, pageWidth - margin, y - 3)
  })

  y += 4

  // ── Totals panel (right-aligned) ────────────────────────────────
  if (y > bottomLimit - 24) newPage()
  const discountAmount = toNumber(quote.discountAmount)
  const discountPct = quote.discountPct ? toNumber(quote.discountPct) : 0
  // Effective discount = subtotal − totalAmount. Both are stored truths from
  // slice-1 `rollUpQuote`; their difference cannot drift from its rounding.
  const effectiveDiscount = Math.max(0, toNumber(quote.subtotal) - toNumber(quote.totalAmount))
  // ASCII `-` (not U+2212): a font lacking the Unicode minus falls back to
  // per-character rendering («− 3 0 0 . 0 0 A Z N», caught in PROD smoke).
  const rows: Array<{ label: string; value: string }> = [{ label: w.subtotal, value: fmtMoney(quote.subtotal, currency) }]
  if (effectiveDiscount > 0.0001) {
    rows.push({ label: discountPct > 0 ? `${w.discount} (${discountPct.toFixed(2)}%)` : w.discount, value: `-${fmtMoney(effectiveDiscount, currency)}` })
  } else if (discountAmount > 0) {
    // Stored discount but effective came out 0 (clamped line total) — still show the intent.
    rows.push({ label: w.discount, value: `-${fmtMoney(quote.discountAmount, currency)}` })
  }
  const totalValue = fmtMoney(quote.totalAmount, currency)
  // The value column is as wide as its widest value, so a long total cannot
  // run into its label.
  doc.setFont(FONT, "normal")
  doc.setFontSize(10)
  const plainWidth = Math.max(...rows.map((r) => doc.getTextWidth(r.value)))
  doc.setFont(FONT, "bold")
  doc.setFontSize(12)
  const totalWidth = doc.getTextWidth(totalValue)
  const totalLabelWidth = doc.getTextWidth(w.total)
  const valueX = pageWidth - margin
  const labelX = valueX - Math.max(plainWidth, totalWidth, 30) - 8

  doc.setFont(FONT, "normal")
  doc.setFontSize(10)
  for (const row of rows) {
    doc.text(row.label, labelX, y, { align: "right" })
    doc.text(row.value, valueX, y, { align: "right" })
    y += 6
  }

  // Total band — starts left of the right-aligned label by its own width,
  // so the whole label sits inside the band at any language and font.
  doc.setFillColor(accent[0], accent[1], accent[2])
  doc.setFont(FONT, "bold")
  doc.setFontSize(12)
  const bandLeft = labelX - totalLabelWidth - 6
  doc.rect(bandLeft, y - 4, pageWidth - margin - bandLeft, 9, "F")
  doc.setTextColor(255, 255, 255)
  doc.text(w.total, labelX, y + 2, { align: "right" })
  doc.text(totalValue, valueX - 2, y + 2, { align: "right" })
  doc.setTextColor(20, 20, 20)
  doc.setFont(FONT, "normal")
  doc.setFontSize(10)

  y += 16

  // ── Notes ───────────────────────────────────────────────────────
  if (quote.notes) {
    doc.setFontSize(9)
    const noteLines = doc.splitTextToSize(quote.notes, pageWidth - margin * 2) as string[]
    if (y + 10 > bottomLimit) newPage()
    doc.setFont(FONT, "bold")
    doc.setTextColor(120, 120, 120)
    doc.text(w.notes, margin, y)
    y += 5
    doc.setFont(FONT, "normal")
    doc.setTextColor(60, 60, 60)
    for (const noteLine of noteLines) {
      if (y > bottomLimit) newPage()
      doc.text(noteLine, margin, y)
      y += 4
    }
  }

  // ── Footer on every page ────────────────────────────────────────
  const pages = doc.getNumberOfPages()
  doc.setFontSize(8)
  doc.setFont(FONT, "normal")
  // One line, clear of the page number on the right, however long the seller's name.
  const generated = (doc.splitTextToSize(`${w.generated} ${fmtDate(new Date())} · ${sellerName} · ${quote.quoteNumber}`, pageWidth - margin * 2 - 30) as string[])[0]
  for (let page = 1; page <= pages; page += 1) {
    doc.setPage(page)
    doc.setFontSize(8)
    doc.setTextColor(150, 150, 150)
    doc.setFont(FONT, "normal")
    doc.text(generated, margin, pageHeight - 8)
    doc.text(`${w.page} ${page} / ${pages}`, pageWidth - margin, pageHeight - 8, { align: "right" })
  }

  return new Uint8Array(doc.output("arraybuffer"))
}
