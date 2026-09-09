import { describe, it, expect } from "vitest"
import { readFileSync } from "fs"
import en from "../../messages/en.json"
import az from "../../messages/az.json"
import ru from "../../messages/ru.json"
import {
  COMPANY_LEGAL_NAME,
  COMPANY_LEGAL_ADDRESS,
  COMPANY_LEGAL_LOCALITY,
  COMPANY_LEGAL_COUNTRY_CODE,
} from "@/lib/constants"

/**
 * Pins the company's real identity everywhere it is stated publicly.
 *
 * Until 2026-09-01 the About page told readers AND search engines (via
 * schema.org JSON-LD) that LeadDrive was "a European technology company …
 * built by Ukrainian engineers", founded in Kyiv, served "from our Warsaw
 * office". None of it was true — the product is built in Baku by Fanumsec
 * MMC. The same fabrication had been copied into the marketing metadata
 * keywords and into the AI chat's system prompt, so the assistant repeated
 * it to customers in conversation.
 *
 * The strings were corrected once by hand (#1068) and the copies drifted
 * back apart, which is why identity now comes from constants and this file
 * guards both halves: the constants must reach the pages, and the fabricated
 * story must not reappear in any locale.
 */
describe("company identity", () => {
  const locales = { en, az, ru } as const

  it.each([
    "src/app/(marketing)/about/page.tsx",
    "src/app/(marketing)/layout.tsx",
    "src/app/api/v1/ai/chat/route.ts",
  ])("%s states the company from the shared constant, not a local copy", (path) => {
    const source = readFileSync(path, "utf8")
    expect(source).toContain("COMPANY_LEGAL_NAME")
    // A hardcoded literal is exactly how these three drifted apart before.
    expect(
      source.replace(/COMPANY_LEGAL_[A-Z_]+/g, ""),
      "state the legal name through the constant, not inline",
    ).not.toContain(COMPANY_LEGAL_NAME)
  })

  it("keeps the About page's structured data on the real company", () => {
    const source = readFileSync("src/app/(marketing)/about/page.tsx", "utf8")
    // Search engines and AI answer engines read this block; a wrong
    // foundingLocation here is a false public claim, not a typo.
    expect(source).toMatch(/name:\s*COMPANY_LEGAL_ADDRESS/)
    expect(source).toMatch(/addressLocality:\s*COMPANY_LEGAL_LOCALITY/)
    expect(source).toMatch(/addressCountry:\s*COMPANY_LEGAL_COUNTRY_CODE/)
  })

  it.each(Object.keys(locales))(
    "%s marketing copy does not retell the fabricated origin story",
    (locale) => {
      const marketing = JSON.stringify(
        (locales as Record<string, { marketing: unknown }>)[locale].marketing,
      )
      expect(marketing).not.toMatch(
        /Ukrain|Kyiv|Warsaw|украин|Киев|Варшав|ukrayn|Kiyev|Varşava/i,
      )
      expect(marketing, "the company is not an Inc.").not.toContain("LeadDrive Inc")
    },
  )

  it("names the real company on the About page in every locale", () => {
    for (const [locale, messages] of Object.entries(locales)) {
      const about = (messages as { marketing: { about: { subtitle: string } } })
        .marketing.about
      expect(about.subtitle, `${locale} subtitle`).toContain(COMPANY_LEGAL_NAME)
    }
  })

  it("keeps the client proposal deck on the real identity", () => {
    // A proposal is a commercial claim handed to a prospect. This deck signed
    // itself "© 2026 LeadDrive Inc. | Warsaw, Poland" and stamped the same
    // name into the PPTX metadata, so the fabricated identity kept reaching
    // customers by post after the site was corrected. A .mjs script cannot
    // import the TS constants, so the values are asserted here instead.
    const source = readFileSync("scripts/generate-proposal.mjs", "utf8")
    expect(source).not.toContain("LeadDrive Inc")
    expect(source).not.toMatch(/Warsaw|Poland/)
    expect(source).toContain(COMPANY_LEGAL_NAME)
  })

  it("exposes a coherent constant set", () => {
    // ADDRESS is what prose interpolates; LOCALITY/COUNTRY feed JSON-LD.
    // They drift apart silently, so assert they still describe one place.
    expect(COMPANY_LEGAL_ADDRESS).toContain(COMPANY_LEGAL_LOCALITY)
    expect(COMPANY_LEGAL_COUNTRY_CODE).toMatch(/^[A-Z]{2}$/)
  })
})
