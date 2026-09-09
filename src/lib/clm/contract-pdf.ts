/**
 * CLM Slice 1c — Contract PDF renderer.
 *
 * Pure helper: takes a Contract + Organization snapshot, returns a PDF
 * as `Uint8Array`. Mirrors the CPQ `quote-pdf.ts` jsPDF pattern:
 * header band (branding accent colour), title, contract metadata row,
 * parties block (seller org / buyer company), then the rendered body
 * with splitTextToSize wrapping + automatic page breaks, footer.
 *
 * Design constraints:
 * - No PII beyond what is already stored on the Contract record itself
 *   (company name, dates, value, rendered clause body).
 * - Currency formatting matches quote-pdf (ISO suffix, en-US locale).
 * - Rendered body is the substituted clause text (Contract.renderedBody);
 *   if absent, a placeholder is shown instead of crashing.
 */
import jsPDF from "jspdf"
import { registerUnicodeFont } from "@/lib/pdf/unicode-font"
import type { Prisma } from "@prisma/client"

export interface ContractPdfInput {
  contract: {
    contractNumber: string
    title: string
    type: string
    status: string
    startDate: Date | null
    endDate: Date | null
    currency: string
    valueAmount: Prisma.Decimal | number | null
    renderedBody: string | null
    company: { name: string } | null
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
}

function readBranding(branding: Prisma.JsonValue): BrandingShape {
  if (!branding || typeof branding !== "object" || Array.isArray(branding)) return {}
  const b = branding as Record<string, unknown>
  return {
    primaryColor: typeof b.primaryColor === "string" ? b.primaryColor : undefined,
    companyName: typeof b.companyName === "string" ? b.companyName : undefined,
  }
}

function parseHexColor(hex: string | undefined): [number, number, number] | null {
  if (!hex) return null
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim())
  if (!m) return null
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]
}

function fmtDate(d: Date | null): string {
  if (!d) return "—"
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
}

function fmtMoney(value: Prisma.Decimal | number | null, currency: string): string {
  if (value === null || value === undefined) return "—"
  const n = typeof value === "number" ? value : Number(value.toString())
  if (!Number.isFinite(n)) return "—"
  return `${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`
}

/** Human-readable contract type label. */
function fmtType(type: string): string {
  const map: Record<string, string> = {
    service_agreement: "Service Agreement",
    nda: "NDA",
    maintenance: "Maintenance",
    license: "License",
    sla: "SLA",
    other: "Other",
  }
  return map[type] ?? type
}

export function generateContractPdf(input: ContractPdfInput): Uint8Array {
  const { contract, organization } = input
  const branding = readBranding(organization.branding)
  const accent = parseHexColor(branding.primaryColor) ?? [60, 60, 60]
  const sellerName = branding.companyName ?? organization.name

  const doc = new jsPDF({ unit: "mm", format: "a4" })
  // Unicode font so Azerbaijani (ə/İ/ş/ğ) renders correctly — jsPDF's Helvetica
  // only supports Latin-1 and would mangle it.
  const FONT = registerUnicodeFont(doc)
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  const margin = 14
  let y = 18

  // ── Header band ────────────────────────────────────────────────────
  doc.setFillColor(accent[0], accent[1], accent[2])
  doc.rect(0, 0, pageWidth, 10, "F")

  // Document type title
  doc.setFontSize(22)
  doc.setFont(FONT, "bold")
  doc.setTextColor(20, 20, 20)
  doc.text("CONTRACT", margin, y + 4)

  // Contract number + status (right-aligned)
  doc.setFontSize(10)
  doc.setFont(FONT, "normal")
  doc.text(contract.contractNumber, pageWidth - margin, y, { align: "right" })
  doc.setTextColor(accent[0], accent[1], accent[2])
  doc.setFont(FONT, "bold")
  doc.text(contract.status.toUpperCase().replace("_", " "), pageWidth - margin, y + 6, { align: "right" })
  doc.setTextColor(20, 20, 20)

  y += 18

  // ── Metadata row (type + dates + value) ────────────────────────────
  doc.setFont(FONT, "normal")
  doc.setFontSize(9)
  doc.setTextColor(120, 120, 120)
  const metaParts: string[] = [
    `Type: ${fmtType(contract.type)}`,
    `Start: ${fmtDate(contract.startDate)}`,
    `End: ${fmtDate(contract.endDate)}`,
  ]
  if (contract.valueAmount !== null) {
    metaParts.push(`Value: ${fmtMoney(contract.valueAmount, contract.currency)}`)
  }
  doc.text(metaParts.join("   ·   "), margin, y)
  y += 8

  // ── Title ──────────────────────────────────────────────────────────
  doc.setFontSize(14)
  doc.setFont(FONT, "bold")
  doc.setTextColor(20, 20, 20)
  const titleLines = doc.splitTextToSize(contract.title, pageWidth - margin * 2) as string[]
  doc.text(titleLines, margin, y)
  y += titleLines.length * 6 + 6

  // ── Parties block (seller / buyer) ─────────────────────────────────
  const colWidth = pageWidth / 2 - margin - 4

  doc.setFont(FONT, "bold")
  doc.setFontSize(9)
  doc.setTextColor(120, 120, 120)
  doc.text("PARTY A (SERVICE PROVIDER)", margin, y)
  doc.text("PARTY B (CLIENT)", pageWidth / 2 + 4, y)
  y += 5

  doc.setFont(FONT, "normal")
  doc.setFontSize(11)
  doc.setTextColor(20, 20, 20)

  const sellerLines = doc.splitTextToSize(sellerName, colWidth) as string[]
  sellerLines.forEach((ln, i) => doc.text(ln, margin, y + i * 5))

  const buyerText = contract.company?.name ?? "—"
  const buyerLines = doc.splitTextToSize(buyerText, colWidth) as string[]
  buyerLines.forEach((ln, i) => doc.text(ln, pageWidth / 2 + 4, y + i * 5))

  y += Math.max(sellerLines.length, buyerLines.length) * 5 + 10

  // ── Divider line ────────────────────────────────────────────────────
  doc.setDrawColor(accent[0], accent[1], accent[2])
  doc.setLineWidth(0.5)
  doc.line(margin, y, pageWidth - margin, y)
  y += 8

  // ── Rendered body (the substituted clause text) ─────────────────────
  doc.setFont(FONT, "normal")
  doc.setFontSize(10)
  doc.setTextColor(30, 30, 30)
  doc.setDrawColor(220, 220, 220)
  doc.setLineWidth(0.2)

  const bodyText = contract.renderedBody || "[No contract body — template has not been rendered]"

  // Split the body into paragraphs (blank-line separated), then wrap each.
  const paragraphs = bodyText.split(/\n{2,}/)

  for (const paragraph of paragraphs) {
    // Check if this looks like a clause heading (short, ends without period,
    // is on its own paragraph); render bold.
    const trimmed = paragraph.trim()
    if (!trimmed) continue

    const lines = trimmed.split("\n")
    // Heuristic: first line of a clause paragraph is the title if the rest
    // exist and it's ≤ 80 chars without trailing period. Render it bold.
    const isClauseHeading = lines.length >= 2 && lines[0].length <= 80 && !lines[0].endsWith(".")

    if (isClauseHeading) {
      // Page break check for heading + at least one line of body
      if (y > pageHeight - 30) {
        doc.addPage()
        y = 20
      }
      doc.setFont(FONT, "bold")
      doc.setFontSize(10)
      const headingLines = doc.splitTextToSize(lines[0], pageWidth - margin * 2) as string[]
      doc.text(headingLines, margin, y)
      y += headingLines.length * 5 + 2

      // Remaining lines as normal body
      const bodyPart = lines.slice(1).join("\n").trim()
      if (bodyPart) {
        doc.setFont(FONT, "normal")
        const bodyLines = doc.splitTextToSize(bodyPart, pageWidth - margin * 2) as string[]
        for (const line of bodyLines) {
          if (y > pageHeight - 20) {
            doc.addPage()
            y = 20
          }
          doc.text(line, margin, y)
          y += 5
        }
      }
    } else {
      doc.setFont(FONT, "normal")
      doc.setFontSize(10)
      const wrappedLines = doc.splitTextToSize(trimmed, pageWidth - margin * 2) as string[]
      for (const line of wrappedLines) {
        if (y > pageHeight - 20) {
          doc.addPage()
          y = 20
        }
        doc.text(line, margin, y)
        y += 5
      }
    }

    y += 4 // paragraph gap
  }

  // ── Footer (all pages) ──────────────────────────────────────────────
  // jsPDF doesn't natively loop pages for footer; we write it on the
  // last page (the current page when rendering ends). For multi-page
  // contracts this gives footer only on the last page — a common
  // convention for legal docs. Slice-3 can add per-page footers.
  const footerY = pageHeight - 8
  doc.setFontSize(8)
  doc.setTextColor(150, 150, 150)
  doc.setFont(FONT, "normal")
  const footer = `Generated ${new Date().toLocaleDateString("en-GB")} · ${sellerName} · Contract ${contract.contractNumber}`
  doc.text(footer, pageWidth / 2, footerY, { align: "center" })

  return new Uint8Array(doc.output("arraybuffer"))
}
