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
import {
  drawSignatureSheet,
  sheetLang,
  sheetTimeZone,
  signatureSheetContent,
  type SheetLang,
  type SignatureSheet,
} from "@/lib/clm/signature-sheet"

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
  /** az (default) | ru | en — the labels; the contract text stays as written. */
  lang?: string | null
  /** IANA zone for the signature sheet's times; UTC when absent or unknown. */
  timeZone?: string | null
  /**
   * The signed copy: `renderedBody` is then the signed version's text and the
   * sheet is appended as the last page.
   */
  signatureSheet?: SignatureSheet | null
}

const WORDS: Record<SheetLang, Record<string, string>> = {
  az: {
    title: "MÜQAVİLƏ",
    type: "Növ",
    start: "Başlanğıc",
    end: "Bitmə",
    value: "Məbləğ",
    partyA: "TƏRƏF A (İCRAÇI)",
    partyB: "TƏRƏF B (SİFARİŞÇİ)",
    noBody: "[Müqavilənin mətni yoxdur — şablon hələ doldurulmayıb]",
    generated: "Tərtib edilib",
    contract: "Müqavilə",
    page: "səhifə",
  },
  ru: {
    title: "ДОГОВОР",
    type: "Тип",
    start: "Начало",
    end: "Окончание",
    value: "Сумма",
    partyA: "СТОРОНА А (ИСПОЛНИТЕЛЬ)",
    partyB: "СТОРОНА Б (ЗАКАЗЧИК)",
    noBody: "[Текста договора нет — шаблон ещё не заполнен]",
    generated: "Сформирован",
    contract: "Договор",
    page: "стр.",
  },
  en: {
    title: "CONTRACT",
    type: "Type",
    start: "Start",
    end: "End",
    value: "Value",
    partyA: "PARTY A (SERVICE PROVIDER)",
    partyB: "PARTY B (CLIENT)",
    noBody: "[No contract body — template has not been rendered]",
    generated: "Generated",
    contract: "Contract",
    page: "page",
  },
}

const TYPES: Record<SheetLang, Record<string, string>> = {
  az: { service_agreement: "Xidmət müqaviləsi", nda: "NDA", maintenance: "Texniki xidmət", license: "Lisenziya", sla: "SLA", other: "Digər" },
  ru: { service_agreement: "Договор услуг", nda: "NDA", maintenance: "Обслуживание", license: "Лицензия", sla: "SLA", other: "Другое" },
  en: { service_agreement: "Service Agreement", nda: "NDA", maintenance: "Maintenance", license: "License", sla: "SLA", other: "Other" },
}

const STATUSES: Record<SheetLang, Record<string, string>> = {
  az: {
    draft: "QARALAMA", pending_approval: "TƏSDİQ GÖZLƏYİR", approved: "TƏSDİQLƏNİB", active: "QÜVVƏDƏ", renewing: "YENİLƏNİR",
    renewed: "YENİLƏNİB", expired: "BİTİB", terminated: "XİTAM VERİLİB", rejected: "RƏDD EDİLİB", cancelled: "LƏĞV EDİLİB",
  },
  ru: {
    draft: "ЧЕРНОВИК", pending_approval: "НА СОГЛАСОВАНИИ", approved: "СОГЛАСОВАН", active: "ДЕЙСТВУЕТ", renewing: "ПРОДЛЕНИЕ",
    renewed: "ПРОДЛЁН", expired: "ИСТЁК", terminated: "РАСТОРГНУТ", rejected: "ОТКЛОНЁН", cancelled: "ОТМЕНЁН",
  },
  en: {
    draft: "DRAFT", pending_approval: "PENDING APPROVAL", approved: "APPROVED", active: "ACTIVE", renewing: "RENEWING",
    renewed: "RENEWED", expired: "EXPIRED", terminated: "TERMINATED", rejected: "REJECTED", cancelled: "CANCELLED",
  },
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
  return d.toISOString().slice(0, 10).split("-").reverse().join(".")
}

function fmtMoney(value: Prisma.Decimal | number | null, currency: string): string {
  if (value === null || value === undefined) return "—"
  const n = typeof value === "number" ? value : Number(value.toString())
  if (!Number.isFinite(n)) return "—"
  return `${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`
}

export function generateContractPdf(input: ContractPdfInput): Uint8Array {
  const { contract, organization } = input
  const lang = sheetLang(input.lang)
  const w = WORDS[lang]
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
  doc.text(w.title, margin, y + 4)

  // Contract number + status (right-aligned)
  doc.setFontSize(10)
  doc.setFont(FONT, "normal")
  doc.text(contract.contractNumber, pageWidth - margin, y, { align: "right" })
  doc.setTextColor(accent[0], accent[1], accent[2])
  doc.setFont(FONT, "bold")
  const statusLabel = STATUSES[lang][contract.status] ?? contract.status.toUpperCase().replace(/_/g, " ")
  doc.text(statusLabel, pageWidth - margin, y + 6, { align: "right" })
  doc.setTextColor(20, 20, 20)

  y += 18

  // ── Metadata row (type + dates + value) ────────────────────────────
  doc.setFont(FONT, "normal")
  doc.setFontSize(9)
  doc.setTextColor(120, 120, 120)
  const metaParts: string[] = [
    `${w.type}: ${TYPES[lang][contract.type] ?? contract.type}`,
    `${w.start}: ${fmtDate(contract.startDate)}`,
    `${w.end}: ${fmtDate(contract.endDate)}`,
  ]
  if (contract.valueAmount !== null) {
    metaParts.push(`${w.value}: ${fmtMoney(contract.valueAmount, contract.currency)}`)
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
  doc.text(w.partyA, margin, y)
  doc.text(w.partyB, pageWidth / 2 + 4, y)
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

  const bodyText = contract.renderedBody || w.noBody

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

  // ── Signature sheet (signed copy only) ──────────────────────────────
  if (input.signatureSheet) {
    const content = signatureSheetContent(
      input.signatureSheet,
      { contractNumber: contract.contractNumber, title: contract.title },
      lang,
      sheetTimeZone(input.timeZone),
    )
    drawSignatureSheet(doc, FONT, content)
  }

  // ── Footer on every page, with «page N / M» ─────────────────────────
  // On a signed copy the count shows a missing or added page at a glance.
  const footerY = pageHeight - 8
  const pages = doc.getNumberOfPages()
  const footer = `${w.generated} ${fmtDate(new Date())} · ${sellerName} · ${w.contract} ${contract.contractNumber}`
  for (let page = 1; page <= pages; page++) {
    doc.setPage(page)
    doc.setFontSize(8)
    doc.setTextColor(150, 150, 150)
    doc.setFont(FONT, "normal")
    doc.text(`${footer} · ${w.page} ${page} / ${pages}`, pageWidth / 2, footerY, { align: "center" })
  }

  return new Uint8Array(doc.output("arraybuffer"))
}
