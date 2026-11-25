/**
 * Price protocols and acceptance acts of a contract (owner 2026-11-25, mock
 * «Протокол цены и акт») — the arithmetic, which protocol's prices hold, what
 * counts as a price off the protocol, the words of the documents and their
 * PDF. Also that the invoice's printable act no longer tells every
 * organisation's customer it bought IT services.
 */
import { describe, it, expect } from "vitest"
import {
  activeProtocol,
  documentTotals,
  documentWords,
  lineAmount,
  linesFromDeal,
  linesFromInvoice,
  moneyText,
  nextNumber,
  priceDeviations,
  quantityText,
  type DocumentFacts,
} from "@/lib/clm/contract-documents"
import { generateContractDocumentPdf } from "@/lib/clm/contract-document-pdf"
import { getTranslations } from "@/lib/invoice-templates"

const d = (iso: string) => new Date(`${iso}T00:00:00Z`)

describe("sums", () => {
  it("a line without a quantity has no amount; VAT goes on top of the subtotal", () => {
    expect(lineAmount({ quantity: null, unitPrice: 60 })).toBe(0)
    expect(lineAmount({ quantity: 3, unitPrice: 14.335 })).toBe(43.01)
    expect(documentTotals([{ quantity: 400, unitPrice: 96 }, { quantity: 4, unitPrice: 75 }, { quantity: null, unitPrice: 60 }], 0.18)).toEqual({
      subtotal: 38700,
      vatAmount: 6966,
      totalAmount: 45666,
    })
  })

  it("numbers per contract and kind keep counting past a cancelled one", () => {
    expect(nextNumber([])).toBe(1)
    expect(nextNumber([1, 3, 2])).toBe(4)
  })

  it("writes money and quantities the way AZ and RU documents do", () => {
    expect(moneyText(38700)).toBe("38 700,00")
    expect(moneyText(-5.5)).toBe("-5,50")
    expect(quantityText(2.5)).toBe("2,5")
    expect(quantityText(null)).toBe("—")
  })
})

describe("lines from the deal and the invoice", () => {
  it("a deal line's discount is part of the agreed price; a line without a price starts at 0", () => {
    const lines = linesFromDeal([
      { productId: "p1", name: "Taxta palet", quantity: "400", unitPrice: "100", discountPct: "4", product: { unit: "ədəd" } },
      { productId: null, name: "Çatdırılma", quantity: "1", unitPrice: null, discountPct: "0" },
    ])
    expect(lines).toEqual([
      { productId: "p1", name: "Taxta palet", unit: "ədəd", quantity: 400, unitPrice: 96 },
      { productId: null, name: "Çatdırılma", unit: null, quantity: 1, unitPrice: 0 },
    ])
  })

  it("an act repeats the invoice's goods, quantities and prices after the line discount", () => {
    expect(linesFromInvoice([{ productId: "p1", name: "Taxta palet", quantity: 400, unitPrice: "100", discount: 4 }])).toEqual([
      { productId: "p1", name: "Taxta palet", unit: null, quantity: 400, unitPrice: 96 },
    ])
  })
})

describe("which protocol's prices hold", () => {
  const rows = [
    { id: "p1", number: 1, status: "signed", validFrom: d("2026-01-01"), validTo: d("2026-06-30"), documentDate: d("2026-01-01") },
    { id: "p2", number: 2, status: "signed", validFrom: d("2026-07-01"), validTo: d("2026-12-31"), documentDate: d("2026-07-01") },
    { id: "p3", number: 3, status: "draft", validFrom: d("2027-01-01"), validTo: null, documentDate: d("2026-11-25") },
    { id: "p4", number: 4, status: "cancelled", validFrom: null, validTo: null, documentDate: d("2026-11-26") },
  ]
  it("the signed one whose period covers the day — through the whole last day — not a newer draft", () => {
    expect(activeProtocol(rows, d("2026-03-10"))).toMatchObject({ protocol: { id: "p1" }, signed: true })
    expect(activeProtocol(rows, new Date("2026-06-30T18:00:00Z"))).toMatchObject({ protocol: { id: "p1" }, signed: true })
    expect(activeProtocol(rows, d("2026-11-25"))).toMatchObject({ protocol: { id: "p2" }, signed: true })
  })
  it("with no signed one covering the day, the latest draft — marked unsigned; never a cancelled one", () => {
    expect(activeProtocol(rows, d("2027-02-01"))).toMatchObject({ protocol: { id: "p3" }, signed: false })
    expect(activeProtocol([rows[3]], d("2026-11-26"))).toBeNull()
  })
})

describe("prices off the protocol", () => {
  const protocol = [
    { productId: "p-palet", name: "Taxta palet", unitPrice: 96 },
    { productId: null, name: "Çatdırılma  Bakı daxili", unitPrice: 60 },
  ]
  it("matches by product, else by the name as people write it; an extra line is not a deviation", () => {
    const out = priceDeviations(
      [
        { productId: "p-palet", name: "Palet (renamed on the invoice)", unitPrice: "96.00" },
        { productId: null, name: "çatdırılma bakı daxili", unitPrice: 75 },
        { productId: null, name: "Bir dəfəlik xidmət", unitPrice: 500 },
      ],
      protocol,
    )
    expect(out).toEqual([{ itemIndex: 1, name: "çatdırılma bakı daxili", invoicePrice: 75, protocolPrice: 60 }])
  })
})

const facts: DocumentFacts = {
  kind: "acceptance_act",
  number: 1,
  documentDate: d("2026-12-02"),
  validFrom: null,
  validTo: null,
  contractNumber: "AS/2026-0775",
  contractDate: d("2026-11-25"),
  contractTitle: "Alğı-satqı müqaviləsi",
  our: { name: "Nümunə MMC", director: "R. Rəhimov" },
  counterparty: { name: "Kaspi Logistika MMC", director: "F. Qəhrəmanov" },
  invoiceNumber: "INV-0412",
  vatRate: 0.18,
}

describe("the documents' words", () => {
  it("an act names both sides, the contract and the invoice — and says nothing of IT services", () => {
    const w = documentWords(facts, "az")
    expect(w.title).toBe("TƏHVİL-TƏSLİM AKTI № 1")
    expect(w.subtitle).toBe("25.11.2026 tarixli AS/2026-0775 nömrəli müqavilə üzrə, INV-0412 nömrəli hesab-faktura")
    expect(w.intro).toContain("«Nümunə MMC»")
    expect(w.intro).toContain("«Kaspi Logistika MMC»")
    expect(w.intro).toContain("«Alğı-satqı müqaviləsi»")
    expect(w.vat).toBe("ƏDV 18%")
    for (const lang of ["az", "ru", "en"] as const) expect(JSON.stringify(documentWords(facts, lang))).not.toMatch(/İnformasiya|информацион|information technology|\bİT\b|\bИТ\b|\bIT\b/)
  })

  it("a protocol is an appendix of the contract with the period its prices hold", () => {
    const w = documentWords({ ...facts, kind: "price_protocol", number: 2, validFrom: d("2026-11-25"), validTo: d("2027-11-24") }, "ru")
    expect(w.title).toBe("ПРОТОКОЛ СОГЛАСОВАНИЯ ЦЕН")
    expect(w.subtitle).toBe("Приложение № 2 к договору № AS/2026-0775 от 25.11.2026")
    expect(w.validity).toBe("Цены действуют: 25.11.2026 — 24.11.2027")
  })

  it("the invoice's printable act no longer says IT services, monthly, or 15 business days — in any language", () => {
    for (const lang of ["az", "ru", "en"] as const) {
      const t = getTranslations(lang)
      const text = [t.actIntroTemplate, t.actClause1Template, t.actClause2, t.actClause3].join(" ")
      expect(text).not.toMatch(/İnformasiya|информацион|information technology|İT xidmət|ИТ услуг|IT services|15 \(/)
      expect(t.actIntroTemplate).toContain("{contractNumber}")
    }
  })
})

describe("the PDF", () => {
  const pages = (bytes: Uint8Array) => (Buffer.from(bytes).toString("latin1").match(/\/Type \/Page\b(?!s)/g) ?? []).length
  it("renders a short act on one page and a long protocol over several", () => {
    const one = generateContractDocumentPdf({ facts, lines: [{ productId: null, name: "Taxta palet", unit: "ədəd", quantity: 400, unitPrice: 96 }], currency: "AZN", lang: "az" })
    expect(Buffer.from(one.slice(0, 4)).toString()).toBe("%PDF")
    expect(pages(one)).toBe(1)
    const many = Array.from({ length: 80 }, (_, i) => ({ productId: null, name: `Mövqe ${i + 1} — uzun ad ilə ki, sətir iki dəfə bükülsün və cədvəl səhifəni keçsin`, unit: "ədəd", quantity: null, unitPrice: 10 + i }))
    expect(pages(generateContractDocumentPdf({ facts: { ...facts, kind: "price_protocol" }, lines: many, currency: "AZN", lang: "ru" }))).toBeGreaterThan(2)
  })
})
