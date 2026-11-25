/**
 * The signature sheet of a contract signed through LeadDrive's own e-sign
 * flow (`src/lib/clm/signature-sheet.ts`): the words a reader sees, the time
 * zone they are printed in, the drawn signature as the signing page stores it,
 * and the sheet arriving as extra pages of the contract PDF.
 */
import { describe, it, expect } from "vitest"
import {
  formatSheetTime,
  parseSignatureStrokes,
  sheetTimeZone,
  signatureMark,
  signatureSheetContent,
  type SignatureSheet,
} from "@/lib/clm/signature-sheet"
import { generateContractPdf, type ContractPdfInput } from "@/lib/clm/contract-pdf"

const HASH = "3f2a9c1d".padEnd(64, "0")

function sheet(over?: Partial<SignatureSheet>): SignatureSheet {
  return {
    sentAt: new Date("2026-11-25T06:30:00Z"),
    completedAt: new Date("2026-11-25T10:05:09Z"),
    versionNo: 3,
    contentHash: HASH,
    signers: [
      {
        order: 2,
        fullName: "Fərid Qəhrəmanov",
        email: "farid@kaspi.az",
        role: "signer",
        status: "signed",
        signatureMethod: "drawn",
        // exactly what the signing page's canvas produces (`${type}${x},${y}` joined by spaces)
        signaturePayload: { svgPath: "M10.0,20.0 L30.0,40.0 L50.0,20.0 M200.0,90.0 L220.0,100.0", widthPx: 600, heightPx: 180 },
        viewedAt: new Date("2026-11-25T09:58:00Z"),
        signedAt: new Date("2026-11-25T10:05:09Z"),
        signedIpAddress: "185.81.80.12",
      },
      {
        order: 1,
        fullName: "Rəşad Rəhimov",
        email: "director@example.az",
        role: "signer",
        status: "signed",
        signatureMethod: "typed",
        signaturePayload: { typedName: "Rəşad Rəhimov", font: "dancing-script" },
        viewedAt: new Date("2026-11-25T06:40:00Z"),
        signedAt: new Date("2026-11-25T06:42:00Z"),
        signedIpAddress: "5.191.10.4",
      },
      {
        order: 3,
        fullName: "Mühasibat",
        email: "acc@example.az",
        role: "cc",
        status: "pending",
        signatureMethod: null,
        signaturePayload: null,
        viewedAt: null,
        signedAt: null,
        signedIpAddress: null,
      },
    ],
    ...over,
  }
}

const doc = { contractNumber: "AS/2026-0774", title: "Alğı-satqı müqaviləsi" }

describe("parseSignatureStrokes", () => {
  it("splits the signing page's path into strokes at every move", () => {
    expect(parseSignatureStrokes("M10.0,20.0 L30.0,40.0 L50.0,20.0 M200.0,90.0 L220.0,100.0")).toEqual([
      [[10, 20], [30, 40], [50, 20]],
      [[200, 90], [220, 100]],
    ])
  })

  it("draws less, never throws, on a path it does not understand", () => {
    expect(parseSignatureStrokes("")).toEqual([])
    expect(parseSignatureStrokes("Q1,2 Z <script>")).toEqual([])
    expect(parseSignatureStrokes("L5,5 L6,6")).toEqual([[[5, 5], [6, 6]]])
  })
})

describe("signatureMark", () => {
  it("is the typed name, or the drawn strokes in the canvas's own size", () => {
    expect(signatureMark({ signatureMethod: "typed", signaturePayload: { typedName: "  Rəşad  " } })).toEqual({ kind: "typed", text: "Rəşad" })
    const drawn = signatureMark({ signatureMethod: "drawn", signaturePayload: { svgPath: "M1,1 L2,2", widthPx: 300, heightPx: 90 } })
    expect(drawn).toMatchObject({ kind: "drawn", width: 300, height: 90 })
  })

  it("is nothing when the stored payload does not match its method", () => {
    expect(signatureMark({ signatureMethod: "typed", signaturePayload: { svgPath: "M1,1" } })).toEqual({ kind: "none" })
    expect(signatureMark({ signatureMethod: "drawn", signaturePayload: null })).toEqual({ kind: "none" })
    expect(signatureMark({ signatureMethod: "uploaded", signaturePayload: { fileRefId: "f1" } })).toEqual({ kind: "none" })
  })
})

describe("time on the sheet", () => {
  it("prints the reader's zone and its offset, so the hour is never ambiguous", () => {
    expect(formatSheetTime(new Date("2026-11-25T10:05:09Z"), "Asia/Baku")).toBe("25.11.2026 14:05:09 (UTC+4)")
    expect(formatSheetTime(new Date("2026-11-25T10:05:09Z"), "UTC")).toBe("25.11.2026 10:05:09 (UTC)")
    expect(formatSheetTime(new Date("2026-11-25T10:05:09Z"), "Asia/Kolkata")).toBe("25.11.2026 15:35:09 (UTC+5:30)")
    expect(formatSheetTime(new Date("2026-07-01T12:00:00Z"), "America/New_York")).toBe("01.07.2026 08:00:00 (UTC-4)")
  })

  it("falls back to UTC for a zone the runtime does not know", () => {
    expect(sheetTimeZone("Mars/Olympus")).toBe("UTC")
    expect(sheetTimeZone(null)).toBe("UTC")
    expect(sheetTimeZone("Asia/Baku")).toBe("Asia/Baku")
  })
})

describe("signatureSheetContent", () => {
  it("lists the signers in signing order, with how, when and from where, in Azerbaijani", () => {
    const content = signatureSheetContent(sheet(), doc, "az", "Asia/Baku")
    expect(content.title).toBe("İMZA VƏRƏQİ")
    expect(content.facts).toContainEqual(["Sənəd", "AS/2026-0774 · Alğı-satqı müqaviləsi"])
    expect(content.facts).toContainEqual(["İmzalanmış versiya", "№ 3"])
    // the full fingerprint, not a shortened one: it is what a reader recomputes
    expect(content.facts).toContainEqual(["Sənədin izi (SHA-256)", HASH])
    expect(content.facts).toContainEqual(["Tamamlandı", "25.11.2026 14:05:09 (UTC+4)"])

    expect(content.signers.map((s) => s.heading)).toEqual(["1. Rəşad Rəhimov", "2. Fərid Qəhrəmanov"])
    const farid = content.signers[1]
    expect(farid.facts).toEqual([
      ["E-poçt", "farid@kaspi.az"],
      ["İmza üsulu", "Sadə elektron imza — əl ilə çəkilib"],
      ["Baxıldı", "25.11.2026 13:58:00 (UTC+4)"],
      ["İmzalandı", "25.11.2026 14:05:09 (UTC+4)"],
      ["IP ünvanı", "185.81.80.12"],
    ])
    expect(farid.mark.kind).toBe("drawn")
    expect(content.signers[0].mark).toEqual({ kind: "typed", text: "Rəşad Rəhimov" })
  })

  it("names copy recipients apart from signers, and says plainly the signatures are not qualified", () => {
    const content = signatureSheetContent(sheet(), doc, "az", "UTC")
    expect(content.signers.some((s) => s.heading.includes("Mühasibat"))).toBe(false)
    expect(content.copies).toBe("Surət alanlar: Mühasibat (acc@example.az)")
    expect(content.note).toContain("sadə elektron imzadır (gücləndirilmiş deyil)")
  })

  it("does not invent a signature for a signer who has not signed", () => {
    const base = sheet()
    const unsigned = sheet({
      signers: [{ ...base.signers[0], status: "sent", signedAt: null, signatureMethod: null, signaturePayload: null, signedIpAddress: null }],
    })
    const [only] = signatureSheetContent(unsigned, doc, "ru", "UTC").signers
    expect(only.facts).toEqual([
      ["E-mail", "farid@kaspi.az"],
      ["Подписал", "Не подписал"],
    ])
    expect(only.mark).toEqual({ kind: "none" })
  })

  it("speaks Russian and English as well", () => {
    expect(signatureSheetContent(sheet(), doc, "ru", "UTC").title).toBe("ЛИСТ ПОДПИСЕЙ")
    expect(signatureSheetContent(sheet(), doc, "en", "UTC").signers[0].facts[1]).toEqual([
      "Signature method",
      "Simple electronic signature — typed name",
    ])
  })
})

describe("the signed copy PDF", () => {
  const input: ContractPdfInput = {
    contract: {
      contractNumber: "AS/2026-0774",
      title: "Alğı-satqı müqaviləsi",
      type: "service_agreement",
      status: "active",
      startDate: new Date("2026-11-25"),
      endDate: new Date("2027-11-25"),
      currency: "AZN",
      valueAmount: 12000,
      renderedBody: "1. Müqavilənin predmeti\nSatıcı malı təhvil verir.",
      company: { name: "«Kaspi Logistika» MMC" },
    },
    organization: { name: "«Nümunə» MMC", logo: null, branding: null },
    lang: "az",
  }
  const pages = (bytes: Uint8Array) => (Buffer.from(bytes).toString("latin1").match(/\/Type \/Page\b(?!s)/g) ?? []).length

  it("gains the signature sheet as its last page; the plain PDF does not", () => {
    const plain = generateContractPdf(input)
    const signed = generateContractPdf({ ...input, signatureSheet: sheet(), timeZone: "Asia/Baku" })
    expect(pages(plain)).toBe(1)
    expect(pages(signed)).toBe(2)
  })

  it("keeps going onto further pages when there are many signers", () => {
    const base = sheet()
    const many = Array.from({ length: 12 }, (_, i) => ({ ...base.signers[0], order: i + 1, fullName: `İmzalayan ${i + 1}` }))
    const signed = generateContractPdf({ ...input, signatureSheet: sheet({ signers: many }), timeZone: "UTC" })
    expect(pages(signed)).toBeGreaterThan(2)
  })
})
