/**
 * The quote PDF as the customer reads it (`src/lib/cpq/quote-pdf.ts`), checked
 * on the real PDF bytes: the words and their positions are decoded from the
 * content streams jsPDF writes, not from the calls the renderer makes.
 *
 * Found 2026-11-18 on KP-2026-014 v2 (demo, BOOO.AZ): an Azerbaijani
 * organization's offer said «QUOTE / FROM / FOR / Subtotal / DRAFT», and the
 * quantity and price columns, fixed 20 mm apart, printed «24 180.00 AZN» —
 * one number to the reader.
 */
import { describe, it, expect } from "vitest"
import { inflateSync } from "node:zlib"
import { jsPDF } from "jspdf"
import { generateQuotePdf, layoutQuoteTable, quotePdfLanguage, QUOTE_COLUMN_GAP, type QuotePdfInput } from "@/lib/cpq/quote-pdf"
import { registerUnicodeFont } from "@/lib/pdf/unicode-font"

interface Run { text: string; x: number; y: number; size: number; bold: boolean }

const PT_PER_MM = 72 / 25.4

/** Every text run of the PDF with its position (pt) and font size. */
function pdfRuns(bytes: Uint8Array): Run[] {
  const source = Buffer.from(bytes).toString("latin1")
  const streams: string[] = []
  const objects = new Map<string, string>()
  for (const match of source.matchAll(/(\d+) 0 obj\b([\s\S]*?)endobj/g)) {
    const body = match[2]
    objects.set(match[1], body)
    const start = body.indexOf("stream\n")
    if (start < 0) continue
    const end = body.lastIndexOf("\nendstream")
    const buffer = Buffer.from(body.slice(start + 7, end), "latin1")
    streams.push(/\/FlateDecode/.test(body.slice(0, start)) ? inflateSync(buffer).toString("latin1") : buffer.toString("latin1"))
  }
  const map = new Map<string, string>()
  for (const stream of streams.filter((value) => value.includes("beginbfchar"))) {
    for (const block of stream.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
      for (const pair of block[1].matchAll(/<([a-f\d]+)>\s*<([a-f\d]+)>/gi)) {
        map.set(pair[1].toLowerCase(), pair[2].match(/.{4}/g)!.map((unit) => String.fromCharCode(parseInt(unit, 16))).join(""))
      }
    }
  }
  // Both weights are written as /BaseFont /DejaVuSans; `registerUnicodeFont`
  // adds regular first and bold second, and jsPDF numbers resources in that
  // order — so the later DejaVuSans resource is the bold one.
  const dejaVu = [...source.matchAll(/\/(F(\d+)) (\d+) 0 R/g)]
    .filter((ref) => /\/BaseFont \/DejaVuSans\b/.test(objects.get(ref[3]) ?? ""))
    .sort((a, b) => Number(a[2]) - Number(b[2]))
  const boldFonts = new Set(dejaVu.length >= 2 ? [dejaVu[dejaVu.length - 1][1]] : [])
  const decode = (hex: string) => (hex.match(/.{4}/g) ?? []).map((unit) => map.get(unit.toLowerCase()) ?? "?").join("")
  const runs: Run[] = []
  for (const stream of streams) {
    for (const block of stream.matchAll(/BT([\s\S]*?)ET/g)) {
      let size = 0
      let bold = false
      let leading = 0
      let x = 0
      let y = 0
      for (const op of block[1].matchAll(/\/(F\d+) ([\d.]+) Tf|([\d.]+) TL|(-?[\d.]+) (-?[\d.]+) Td|T\*|<([a-f\d]+)>\s*Tj/gi)) {
        if (op[1]) { bold = boldFonts.has(op[1]); size = Number(op[2]) }
        else if (op[3]) leading = Number(op[3])
        else if (op[4]) { x += Number(op[4]); y += Number(op[5]) }
        else if (op[0] === "T*") y -= leading
        else if (op[6]) runs.push({ text: decode(op[6]), x, y, size, bold })
      }
    }
  }
  return runs
}

const measureDoc = new jsPDF({ unit: "mm", format: "a4" })
const MEASURE_FONT = registerUnicodeFont(measureDoc)
/** Width in pt, in the weight the run is printed in. */
function widthPt(run: Run): number {
  measureDoc.setFont(MEASURE_FONT, run.bold ? "bold" : "normal")
  measureDoc.setFontSize(run.size)
  return measureDoc.getTextWidth(run.text) * PT_PER_MM
}

/** Pairs of runs on one baseline whose boxes come closer than `minGapMm`. */
function crowded(runs: Run[], minGapMm: number): string[] {
  const rows = new Map<number, Run[]>()
  for (const run of runs) {
    const key = Math.round(run.y * 2)
    rows.set(key, [...(rows.get(key) ?? []), run])
  }
  const problems: string[] = []
  for (const row of rows.values()) {
    const sorted = [...row].sort((a, b) => a.x - b.x)
    for (let i = 1; i < sorted.length; i += 1) {
      const gap = (sorted[i].x - (sorted[i - 1].x + widthPt(sorted[i - 1]))) / PT_PER_MM
      if (gap < minGapMm) problems.push(`«${sorted[i - 1].text}» → «${sorted[i].text}»: ${gap.toFixed(1)} mm`)
    }
  }
  return problems
}

function quote(overrides: Partial<QuotePdfInput["quote"]> = {}): QuotePdfInput["quote"] {
  return {
    quoteNumber: "KP-2026-014",
    version: 2,
    status: "draft",
    validUntil: new Date("2026-11-30T00:00:00Z"),
    currency: "AZN",
    subtotal: "4320",
    discountAmount: "0",
    discountPct: null,
    totalAmount: "4320",
    notes: null,
    customerName: "Azər Mebel MMC",
    createdAt: new Date("2026-11-18T00:00:00Z"),
    sentAt: null,
    acceptedAt: null,
    deal: null,
    lineItems: [
      { productName: "Ofis stulu", description: null, quantity: "24", unitPrice: "180", lineDiscountAmount: "0", lineDiscountPct: null, lineTotal: "4320", sortOrder: 0 },
    ],
    ...overrides,
  }
}

const organization = { name: "BOOO.AZ", logo: null, branding: null }

function render(lang: string | null, q = quote()) {
  return pdfRuns(generateQuotePdf({ lang, quote: q, organization }))
}

describe("quote PDF language", () => {
  it("Azerbaijani: every label in Azerbaijani, none of the English ones left", () => {
    const runs = render("az")
    const texts = runs.map((r) => r.text)
    // The decoder tells the weights apart (the gap checks below rely on it).
    expect(runs.find((r) => r.text === "CƏMİ")?.bold).toBe(true)
    expect(runs.find((r) => r.text === "Ofis stulu")?.bold).toBe(false)
    for (const word of ["KOMMERSİYA TƏKLİFİ", "TƏKLİF EDƏN", "MÜŞTƏRİ", "Mal / xidmət", "Miqdar", "Qiymət, AZN", "Məbləğ, AZN", "Ara cəm", "CƏMİ", "QARALAMA"]) {
      expect(texts).toContain(word)
    }
    expect(texts.some((t) => t.startsWith("Tarix: 18.11.2026"))).toBe(true)
    expect(texts.some((t) => t.startsWith("Etibarlılıq müddəti: 30.11.2026"))).toBe(true)
    expect(texts.some((t) => t.includes("versiya 2"))).toBe(true)
    const english = /\b(QUOTE|FROM|FOR|ITEM|QTY|PRICE|DISC|TOTAL|Subtotal|DRAFT|Issued|Valid until|Generated)\b/
    expect(texts.filter((t) => english.test(t))).toEqual([])
  })

  it("Russian and English speak their own words", () => {
    const ru = render("ru").map((r) => r.text)
    for (const word of ["КОММЕРЧЕСКОЕ ПРЕДЛОЖЕНИЕ", "Товар / услуга", "Кол-во", "Цена, AZN", "Подытог", "ИТОГО", "ЧЕРНОВИК"]) expect(ru).toContain(word)
    const en = render("en").map((r) => r.text)
    for (const word of ["QUOTE", "FROM", "FOR", "Qty", "Price, AZN", "Subtotal", "TOTAL", "DRAFT"]) expect(en).toContain(word)
  })

  it("the deal line of the buyer is in the PDF's language", () => {
    const texts = render("az", quote({ customerName: null, deal: { name: "Ofis mebeli", company: { name: "Azər Mebel" } } })).map((r) => r.text)
    expect(texts).toContain("Sövdələşmə: Ofis mebeli")
  })

  it("language: ?lang, then the organization's customer language, then the CRM's own, then az", () => {
    expect(quotePdfLanguage({ query: "en", organizationSettings: { language: "ru" }, uiLocale: "az" })).toBe("en")
    expect(quotePdfLanguage({ query: "xx", organizationSettings: { language: "ru" }, uiLocale: "az" })).toBe("ru")
    expect(quotePdfLanguage({ organizationSettings: { locale: "en" }, uiLocale: "az" })).toBe("en")
    expect(quotePdfLanguage({ organizationSettings: {}, uiLocale: "ru" })).toBe("ru")
    expect(quotePdfLanguage({ organizationSettings: null })).toBe("az")
  })
})

describe("quote PDF table", () => {
  it("quantity and price are separate numbers, the currency only in the header", () => {
    const runs = render("az")
    const texts = runs.map((r) => r.text)
    expect(texts).toContain("24")
    expect(texts).toContain("180.00")
    expect(texts).not.toContain("180.00 AZN")
    expect(texts.filter((t) => /\d\s+\d/.test(t) && !/\d{2}\.\d{2}\.\d{4}/.test(t) && !t.includes("/"))).toEqual([])
    const qty = runs.find((r) => r.text === "24")!
    const price = runs.find((r) => r.text === "180.00")!
    expect((price.x - (qty.x + widthPt(qty))) / PT_PER_MM).toBeGreaterThanOrEqual(QUOTE_COLUMN_GAP - 1)
  })

  it("long numbers, a discount column and long names: nothing on a line comes closer than 2.5 mm", () => {
    const lineItems = [
      { productName: "Ofis stulu", description: null, quantity: "24", unitPrice: "180", lineDiscountAmount: "0", lineDiscountPct: null, lineTotal: "4320", sortOrder: 0 },
      {
        productName: "Konfrans zalı üçün dəri üzlüklü, hündürlüyü tənzimlənən, beş təkərli ergonomik rəhbər kreslosu (qara, İtaliya istehsalı)",
        description: "Çatdırılma və quraşdırma qiymətə daxildir; zəmanət 36 ay, servis Bakı daxilində pulsuzdur.",
        quantity: "125000.5",
        unitPrice: "9876543.21",
        lineDiscountAmount: "1234567.89",
        lineDiscountPct: null,
        lineTotal: "1234567890123.45",
        sortOrder: 1,
      },
    ]
    const runs = render("ru", quote({ lineItems, subtotal: "1234567890123.45", totalAmount: "1234567890123.45" }))
    const texts = runs.map((r) => r.text)
    expect(texts).toContain("Скидка, AZN")
    expect(texts).toContain("125,000.5")
    expect(texts).toContain("9,876,543.21")
    expect(crowded(runs, 2.5)).toEqual([])
    // The long name wrapped instead of running under the numbers.
    expect(runs.filter((r) => r.text.startsWith("Konfrans") || r.text.includes("kreslosu")).length).toBeGreaterThanOrEqual(1)
    const qty = runs.find((r) => r.text === "125,000.5")!
    for (const run of runs.filter((r) => /Konfrans|ergonomik|kreslosu|İtaliya|istehsalı/.test(r.text))) {
      expect((run.x + widthPt(run)) / PT_PER_MM).toBeLessThan(qty.x / PT_PER_MM)
    }
    // Every text stays on the page.
    for (const run of runs) expect((run.x + widthPt(run)) / PT_PER_MM, run.text).toBeLessThanOrEqual(210 - 10)
  })

  it("every language and every quote of the example: no crowded line anywhere", () => {
    for (const lang of ["az", "ru", "en"]) expect(crowded(render(lang), 2.5), lang).toEqual([])
  })

  it("layout: each numeric column fits its widest value, neighbours keep the gap, the item column gets the rest", () => {
    const doc = new jsPDF({ unit: "mm", format: "a4" })
    const font = registerUnicodeFont(doc)
    const values = ["999,999,999.99", "1.00"]
    const layout = layoutQuoteTable(doc, font, {
      left: 14,
      right: 196,
      rowCount: 2,
      noHeader: "№",
      columns: [
        { key: "qty", header: "Miqdar", values: ["1,000,000", "2"] },
        { key: "price", header: "Qiymət, AZN", values },
        { key: "discount", header: "Endirim, AZN", values },
        { key: "total", header: "Məbləğ, AZN", values, boldValues: true },
      ],
    })
    expect(layout.item.width).toBeGreaterThanOrEqual(55)
    for (let i = 1; i < layout.columns.length; i += 1) {
      const leftEdge = layout.columns[i].right - layout.columns[i].width
      expect(leftEdge - layout.columns[i - 1].right).toBeGreaterThanOrEqual(QUOTE_COLUMN_GAP - 1e-9)
    }
    expect(layout.columns[0].right - layout.columns[0].width - (layout.item.left + layout.item.width)).toBeGreaterThanOrEqual(QUOTE_COLUMN_GAP - 1e-9)
    doc.setFont(font, "bold")
    doc.setFontSize(layout.fontSize)
    expect(layout.columns[3].width).toBeGreaterThanOrEqual(doc.getTextWidth("999,999,999.99") - 1e-9)
  })
})
