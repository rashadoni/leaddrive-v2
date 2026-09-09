import { describe, it, expect } from "vitest"
import { jsPDF } from "jspdf"
import { registerUnicodeFont, PDF_FONT } from "@/lib/pdf/unicode-font"

/**
 * Guards the Azerbaijani-PDF fix: jsPDF's built-in Helvetica only supports
 * Latin-1 and mangled Azerbaijani (ə/İ/ş/ğ → Y/0/1). registerUnicodeFont embeds
 * DejaVu Sans so those glyphs render. If someone reverts to Helvetica, the
 * embedded-font size check below fails (a Helvetica PDF of this text is ~3 KB;
 * with the embedded TTF it is hundreds of KB).
 */
describe("registerUnicodeFont", () => {
  it("registers DejaVuSans and renders Azerbaijani without error", () => {
    const doc = new jsPDF()
    const font = registerUnicodeFont(doc)
    expect(font).toBe(PDF_FONT)

    doc.setFont(font, "bold")
    doc.text("İT Xidmət Müqaviləsi — Məsuliyyət və Cərimələr", 15, 20)
    doc.setFont(font, "normal")
    doc.text("Əsas Anlayışlar · şərtlər · ödəniş · AŞAĞI · İcraçı", 15, 35)

    const out = Buffer.from(doc.output("arraybuffer"))
    // The embedded Unicode TTF makes the PDF large — proves it's NOT Helvetica.
    expect(out.byteLength).toBeGreaterThan(100_000)
    expect(out.toString("latin1")).toContain("DejaVuSans")
  })
})
