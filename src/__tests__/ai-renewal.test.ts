import { describe, it, expect } from "vitest"
import { defaultSubject, defaultEmailBody, wrapBrandedHtml } from "@/lib/ai/renewal"

describe("ai/renewal — email formatters", () => {
  describe("defaultSubject()", () => {
    it("returns Russian variant for lang='ru'", () => {
      const s = defaultSubject("ACME", "ru")
      expect(s).toBe("ACME — Предложение о продлении договора")
    })
    it("returns Azerbaijani variant for lang='az'", () => {
      const s = defaultSubject("ACME", "az")
      expect(s).toContain("ACME")
      expect(s).toContain("yenilənməsi")
    })
    it("falls back to English for unknown lang", () => {
      const s = defaultSubject("ACME", "xx")
      expect(s).toBe("ACME — Contract Renewal Proposal")
    })
    it("preserves company name verbatim", () => {
      const s = defaultSubject("Zeytun Pharm MMC", "en")
      expect(s).toContain("Zeytun Pharm MMC")
    })
  })

  describe("defaultEmailBody()", () => {
    it("Russian body contains localized greeting + values", () => {
      const b = defaultEmailBody("Иван", "2026-05-20", 15300, "AZN", "LeadDrive", "ru")
      expect(b).toContain("Здравствуйте, Иван")
      expect(b).toContain("15300 AZN")
      expect(b).toContain("2026-05-20")
      expect(b).toContain("— LeadDrive")
    })
    it("Azerbaijani body uses 'Salam'", () => {
      const b = defaultEmailBody("Rashad", "2026-05-20", 200, "USD", "LeadDrive", "az")
      expect(b).toContain("Salam, Rashad")
      expect(b).toContain("200 USD")
    })
    it("English body uses 'Hello'", () => {
      const b = defaultEmailBody("John", "2026-05-20", 500, "EUR", "LeadDrive", "en")
      expect(b).toContain("Hello John")
      expect(b).toContain("500 EUR")
    })
  })

  describe("wrapBrandedHtml()", () => {
    it("wraps inner HTML with a branded shell containing org name and h2", () => {
      const out = wrapBrandedHtml("<p>hello</p>", "LeadDrive", "en")
      expect(out).toContain("<h2")
      expect(out).toContain("LeadDrive")
      expect(out).toContain("<p>hello</p>")
      // English footer hint
      expect(out).toContain("Reply directly")
    })
    it("localizes footer note for ru", () => {
      const out = wrapBrandedHtml("<p>x</p>", "LeadDrive", "ru")
      expect(out).toContain("Ответьте напрямую")
    })
    it("escapes <, >, & in org name", () => {
      const out = wrapBrandedHtml("<p>x</p>", "A<B>&C", "en")
      expect(out).toContain("A&lt;B&gt;&amp;C")
      expect(out).not.toContain("<B>")
    })
  })
})
