/**
 * Contract PDF renderer (Slice 1c, covered in Step 6).
 *
 * `generateContractPdf` is a pure function (jsPDF + DejaVu Unicode font, no I/O).
 * Coverage: produces a valid PDF, tolerates null body, renders Azerbaijani +
 * Cyrillic without throwing, parses/falls back branding colour, accepts Decimal
 * or number values, and paginates a long body.
 */
import { describe, it, expect } from "vitest"
import { generateContractPdf, type ContractPdfInput } from "@/lib/clm/contract-pdf"

const PDF_MAGIC = "%PDF"

function isPdf(bytes: Uint8Array): boolean {
  return String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) === PDF_MAGIC
}

function baseInput(over?: Partial<ContractPdfInput["contract"]>, org?: Partial<ContractPdfInput["organization"]>): ContractPdfInput {
  return {
    contract: {
      contractNumber: "CTR-2026-0001",
      title: "Master Services Agreement",
      type: "service_agreement",
      status: "active",
      startDate: new Date("2026-01-01"),
      endDate: new Date("2026-12-31"),
      currency: "USD",
      valueAmount: 125000,
      renderedBody: "1. Term\n  The agreement runs for twelve months.\n\n2. Fees\n  The Buyer pays the Seller monthly.",
      company: { name: "Acme Corp" },
      ...over,
    },
    organization: {
      name: "LeadDrive Inc.",
      logo: null,
      branding: null,
      ...org,
    },
  }
}

describe("generateContractPdf", () => {
  it("produces a non-empty, valid PDF", () => {
    const out = generateContractPdf(baseInput())
    expect(out).toBeInstanceOf(Uint8Array)
    expect(out.length).toBeGreaterThan(500)
    expect(isPdf(out)).toBe(true)
  })

  it("tolerates a null renderedBody (placeholder, no throw)", () => {
    const out = generateContractPdf(baseInput({ renderedBody: null }))
    expect(isPdf(out)).toBe(true)
  })

  it("renders Azerbaijani + Cyrillic glyphs without throwing", () => {
    const out = generateContractPdf(
      baseInput({
        title: "Müqavilə — Хidmət sazişi",
        renderedBody: "Məsuliyyət və öhdəliklər.\nСтороны договорились о следующем.",
        company: { name: "Şirkət MMC" },
      }),
    )
    expect(isPdf(out)).toBe(true)
  })

  it("parses a branding primaryColor and falls back on an invalid one", () => {
    const ok = generateContractPdf(baseInput({}, { branding: { primaryColor: "#1a2b3c", companyName: "Brand Co" } }))
    expect(isPdf(ok)).toBe(true)
    const bad = generateContractPdf(baseInput({}, { branding: { primaryColor: "not-a-color" } }))
    expect(isPdf(bad)).toBe(true)
  })

  it("accepts a Decimal-like value (toString) as well as a number", () => {
    const decimalLike = { toString: () => "99999.99" } as unknown as ContractPdfInput["contract"]["valueAmount"]
    const out = generateContractPdf(baseInput({ valueAmount: decimalLike }))
    expect(isPdf(out)).toBe(true)
    const nullVal = generateContractPdf(baseInput({ valueAmount: null }))
    expect(isPdf(nullVal)).toBe(true)
  })

  it("paginates a long body without throwing", () => {
    const longBody = Array.from({ length: 250 }, (_, i) => `Clause ${i + 1}\n  This is the text of clause number ${i + 1}.`).join("\n\n")
    const out = generateContractPdf(baseInput({ renderedBody: longBody }))
    expect(isPdf(out)).toBe(true)
    // a 250-clause body must be materially larger than the short fixture
    expect(out.length).toBeGreaterThan(5000)
  })
})
