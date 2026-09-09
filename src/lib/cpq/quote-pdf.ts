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
 * Currency formatting: uses the quote's own `currency` (per slice-1
 * Decimal(18,4) storage), formatted with `toLocaleString` for the
 * thousand separator. No locale-specific symbol because tenants may
 * use AZN / USD / EUR interchangeably; the ISO code is shown as a
 * trailing suffix to keep the format unambiguous.
 *
 * Rejection reason: NOT included in the customer-facing PDF — it's an
 * internal audit field stored under bound-AAD encryption. The route
 * layer would never decrypt it just to ship in a buyer's email.
 */
import jsPDF from "jspdf"
import { registerUnicodeFont } from "@/lib/pdf/unicode-font"
import type { Prisma } from "@prisma/client"

export interface QuotePdfInput {
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

function fmtMoney(value: Prisma.Decimal | string, currency: string): string {
  const n = typeof value === "string" ? Number(value) : Number(value.toString())
  if (!Number.isFinite(n)) return `${value} ${currency}`
  return `${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`
}

function fmtDate(d: Date | null): string {
  if (!d) return "—"
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
}

/**
 * Resolve the PDF "FOR" (buyer) lines. Precedence:
 *   typed customerName (trimmed, non-empty) → linked deal's company →
 *   `Deal: <name>` → "—". Manual name fully overrides the deal lines.
 * Pure + exported so the precedence is unit-testable without rendering a PDF.
 */
export function resolveBuyerName(quote: {
  customerName?: string | null
  deal?: { name?: string | null; company?: { name?: string | null } | null } | null
}): string[] {
  const manualName = quote.customerName?.trim()
  if (manualName) return [manualName]
  const lines: string[] = []
  if (quote.deal?.company?.name) lines.push(quote.deal.company.name)
  if (quote.deal?.name) lines.push(`Deal: ${quote.deal.name}`)
  return lines.length > 0 ? lines : ["—"]
}

function fmtQty(value: Prisma.Decimal | string): string {
  const n = typeof value === "string" ? Number(value) : Number(value.toString())
  if (!Number.isFinite(n)) return String(value)
  // Show 2 decimals only if non-zero — keeps "1.00" looking like "1"
  return n % 1 === 0 ? String(Math.round(n)) : n.toFixed(2)
}

export function generateQuotePdf(input: QuotePdfInput): Uint8Array {
  const { quote, organization } = input
  const branding = readBranding(organization.branding)
  const accent = parseHexColor(branding.primaryColor) ?? [60, 60, 60] // neutral grey fallback
  const sellerName = branding.companyName ?? organization.name

  const doc = new jsPDF({ unit: "mm", format: "a4" })
  // Unicode font so Azerbaijani (ə/İ/ş/ğ) renders instead of mangling under Helvetica.
  const FONT = registerUnicodeFont(doc)
  const pageWidth = doc.internal.pageSize.getWidth()
  const margin = 14
  let y = 18

  // ── Header band ─────────────────────────────────────────────────
  doc.setFillColor(accent[0], accent[1], accent[2])
  doc.rect(0, 0, pageWidth, 10, "F")

  // Title
  doc.setFontSize(22)
  doc.setFont(FONT, "bold")
  doc.setTextColor(20, 20, 20)
  doc.text("QUOTE", margin, y + 4)

  // Quote number + version + status (right-aligned)
  doc.setFontSize(10)
  doc.setFont(FONT, "normal")
  const numberText = `${quote.quoteNumber}${quote.version > 1 ? `  v${quote.version}` : ""}`
  doc.text(numberText, pageWidth - margin, y, { align: "right" })
  doc.setTextColor(accent[0], accent[1], accent[2])
  doc.setFont(FONT, "bold")
  doc.text(quote.status.toUpperCase(), pageWidth - margin, y + 6, { align: "right" })
  doc.setTextColor(20, 20, 20)

  y += 18

  // ── Seller / Buyer ──────────────────────────────────────────────
  doc.setFont(FONT, "bold")
  doc.setFontSize(9)
  doc.setTextColor(120, 120, 120)
  doc.text("FROM", margin, y)
  doc.text("FOR", pageWidth / 2 + 4, y)

  y += 5
  doc.setFont(FONT, "normal")
  doc.setFontSize(11)
  doc.setTextColor(20, 20, 20)

  // Column width: each column spans from its left edge to the page midpoint
  // (FROM) or to pageWidth-margin (FOR), with a 4mm inter-column gap.
  // This value is used for splitTextToSize so long names wrap instead of
  // overflowing the page edge.
  const colWidth = pageWidth / 2 - margin - 4

  // Seller ("FROM") — wrap long org/company names
  const sellerLines = doc.splitTextToSize(sellerName, colWidth) as string[]
  sellerLines.forEach((ln, i) => doc.text(ln, margin, y + i * 5))

  // Buyer ("FOR"): resolve precedence then wrap each resolved line
  let buyerLines = resolveBuyerName(quote)
  buyerLines = buyerLines.flatMap((ln) => doc.splitTextToSize(ln, colWidth) as string[])
  buyerLines.forEach((line, i) => {
    doc.text(line, pageWidth / 2 + 4, y + i * 5)
  })

  // Advance y by whichever column is taller so the dates row below
  // never overlaps either the seller or buyer text block.
  y += Math.max(sellerLines.length, buyerLines.length) * 5 + 6

  // ── Dates row ───────────────────────────────────────────────────
  doc.setFontSize(9)
  doc.setTextColor(120, 120, 120)
  doc.text(`Issued: ${fmtDate(quote.createdAt)}`, margin, y)
  if (quote.sentAt) {
    doc.text(`Sent: ${fmtDate(quote.sentAt)}`, margin + 50, y)
  }
  if (quote.validUntil) {
    doc.setFont(FONT, "bold")
    doc.text(`Valid until: ${fmtDate(quote.validUntil)}`, pageWidth - margin, y, { align: "right" })
    doc.setFont(FONT, "normal")
  }

  y += 10

  // ── Line items table ────────────────────────────────────────────
  const colX = {
    item: margin,
    qty: pageWidth - margin - 70,
    price: pageWidth - margin - 50,
    discount: pageWidth - margin - 28,
    total: pageWidth - margin,
  }

  // Header row
  doc.setFillColor(accent[0], accent[1], accent[2])
  doc.rect(margin, y - 4, pageWidth - margin * 2, 7, "F")
  doc.setFont(FONT, "bold")
  doc.setFontSize(9)
  doc.setTextColor(255, 255, 255)
  doc.text("ITEM", colX.item + 2, y)
  doc.text("QTY", colX.qty, y, { align: "right" })
  doc.text("PRICE", colX.price, y, { align: "right" })
  doc.text("DISC", colX.discount, y, { align: "right" })
  doc.text("TOTAL", colX.total, y, { align: "right" })
  y += 8

  doc.setTextColor(20, 20, 20)
  doc.setFont(FONT, "normal")
  doc.setFontSize(9)

  // Sort by sortOrder defensively
  const sortedLines = [...quote.lineItems].sort((a, b) => a.sortOrder - b.sortOrder)
  sortedLines.forEach((line) => {
    // Page break if no room for at least one row
    if (y > 250) {
      doc.addPage()
      y = 20
    }
    // Right-side columns (qty / price / disc / total) all live on the
    // SAME baseline as the product name. Render them first so wrapped
    // description below doesn't push them down — they should align with
    // the product name even when description wraps to multiple lines.
    doc.text(line.productName, colX.item + 2, y)
    doc.text(fmtQty(line.quantity), colX.qty, y, { align: "right" })
    doc.text(fmtMoney(line.unitPrice, quote.currency), colX.price, y, { align: "right" })
    doc.text(fmtMoney(line.lineDiscountAmount, quote.currency), colX.discount, y, { align: "right" })
    doc.setFont(FONT, "bold")
    doc.text(fmtMoney(line.lineTotal, quote.currency), colX.total, y, { align: "right" })
    doc.setFont(FONT, "normal")

    let rowHeight = 7
    if (line.description) {
      doc.setTextColor(120, 120, 120)
      // Wrap the description; track wrapped-line count so the row
      // separator lands BELOW the description, not on top of it.
      const descLines = doc.splitTextToSize(line.description, 90)
      doc.text(descLines, colX.item + 2, y + 4)
      doc.setTextColor(20, 20, 20)
      rowHeight = 7 + descLines.length * 4
    }
    y += rowHeight
    doc.setDrawColor(230)
    doc.line(margin, y - 2, pageWidth - margin, y - 2)
  })

  y += 4

  // ── Totals panel (right-aligned) ────────────────────────────────
  if (y > 240) {
    doc.addPage()
    y = 20
  }
  const labelX = pageWidth - margin - 40
  const valueX = pageWidth - margin
  doc.setFontSize(10)
  doc.text("Subtotal", labelX, y, { align: "right" })
  doc.text(fmtMoney(quote.subtotal, quote.currency), valueX, y, { align: "right" })
  y += 6

  // Effective discount = subtotal − totalAmount. Both numbers are stored
  // truths from slice-1 `rollUpQuote` — using their difference avoids a
  // second computation that could drift from the route's rounding rules.
  // The label distinguishes pct (percentage shown) vs amount mode for
  // sales-rep clarity.
  const discountAmount = Number(quote.discountAmount.toString())
  const discountPct = quote.discountPct ? Number(quote.discountPct.toString()) : 0
  const subtotalNum = Number(quote.subtotal.toString())
  const totalNum = Number(quote.totalAmount.toString())
  const effectiveDiscount = Math.max(0, subtotalNum - totalNum)
  // ASCII `-` (not Unicode U+2212 minus) — keep it plain ASCII so it renders
  // consistently across fonts; a font lacking the Unicode minus glyph falls
  // back to per-character rendering with wide letter-spacing. Caught in PROD
  // smoke when discount value rendered as "− 3 0 0 . 0 0 A Z N".
  if (effectiveDiscount > 0.0001) {
    const label = discountPct > 0 ? `Discount (${discountPct.toFixed(2)}%)` : "Discount"
    doc.text(label, labelX, y, { align: "right" })
    doc.text(`-${fmtMoney(effectiveDiscount.toFixed(4), quote.currency)}`, valueX, y, { align: "right" })
    y += 6
  } else if (discountAmount > 0) {
    // Edge: stored discountAmount but effective came out 0 (e.g. clamped
    // line total) — still surface the intent rather than hide it.
    doc.text("Discount", labelX, y, { align: "right" })
    doc.text(`-${fmtMoney(quote.discountAmount, quote.currency)}`, valueX, y, { align: "right" })
    y += 6
  }

  // Total band — rect extends from (labelX − labelWidth − cushion) so
  // the right-aligned "TOTAL" sits fully within the accent band even
  // if labelX shifts later (e.g. currency column added, RTL flip).
  // `getTextWidth` is computed at the band's actual font/size, so the
  // cushion is self-correcting per font metrics. Previous hard-coded
  // 30mm cushion was caught as brittle by architect P2; the earlier
  // `labelX - 4` left "TOT" outside the band (white-on-page) — found
  // in PROD smoke.
  doc.setFillColor(accent[0], accent[1], accent[2])
  doc.setFont(FONT, "bold")
  doc.setFontSize(12)
  const totalLabelWidth = doc.getTextWidth("TOTAL")
  const bandLeft = labelX - totalLabelWidth - 6 // 6mm extra cushion
  doc.rect(bandLeft, y - 4, pageWidth - bandLeft - margin + 8, 9, "F")
  doc.setTextColor(255, 255, 255)
  doc.text("TOTAL", labelX, y + 2, { align: "right" })
  doc.text(fmtMoney(quote.totalAmount, quote.currency), valueX, y + 2, { align: "right" })
  doc.setTextColor(20, 20, 20)
  doc.setFont(FONT, "normal")
  doc.setFontSize(10)

  y += 16

  // ── Notes ───────────────────────────────────────────────────────
  if (quote.notes) {
    if (y > 250) {
      doc.addPage()
      y = 20
    }
    doc.setFont(FONT, "bold")
    doc.setFontSize(9)
    doc.setTextColor(120, 120, 120)
    doc.text("NOTES", margin, y)
    y += 5
    doc.setFont(FONT, "normal")
    doc.setFontSize(9)
    doc.setTextColor(60, 60, 60)
    const noteLines = doc.splitTextToSize(quote.notes, pageWidth - margin * 2)
    doc.text(noteLines, margin, y)
    y += noteLines.length * 4 + 6
  }

  // ── Footer ──────────────────────────────────────────────────────
  doc.setFontSize(8)
  doc.setTextColor(150, 150, 150)
  doc.setFont(FONT, "normal")
  const footer = `Generated ${new Date().toLocaleDateString("en-GB")} · ${sellerName} · Quote ${quote.quoteNumber}`
  doc.text(footer, pageWidth / 2, doc.internal.pageSize.getHeight() - 8, { align: "center" })

  return new Uint8Array(doc.output("arraybuffer"))
}
