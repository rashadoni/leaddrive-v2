import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"

/**
 * Findings F-11, F-12 and F-13 (docs/isms/ISMS-02-gap-analysis.md).
 *
 * A privacy policy is a statement by a named operator about what it does with
 * other people's personal data. Three things were wrong with it:
 *
 *   F-11 it named "LeadDrive Inc.", a company that is not the legal entity;
 *   F-12 it described its subprocessors as "hosting, email service", while text
 *        also went to language models and calls were recorded by a telephony
 *        provider;
 *   F-13 it claimed "All data is stored in an encrypted PostgreSQL database".
 *        Checked on production: no LUKS, no dm-crypt, plain ext4 on /dev/sda1.
 *        41 columns and the OAuth tokens are encrypted at the application layer;
 *        the database as a whole is not.
 *
 * An unverified claim of protection is worse than no claim: it is the thing a
 * regulator penalises and an auditor writes up. This gate holds the corrected
 * text in place across all three locales.
 */

const LOCALES = ["en", "ru", "az"] as const

function privacy(locale: string): Record<string, string> {
  return JSON.parse(readFileSync(`messages/${locale}.json`, "utf8")).privacy
}

describe.each(LOCALES)("privacy policy — %s", locale => {
  const p = privacy(locale)

  it("names the actual legal entity", () => {
    expect(p.p1).toContain("Fanumsec MMC")
    expect(p.p1).not.toContain("LeadDrive Inc")
  })

  it("does not claim the whole database is encrypted", () => {
    // Production has no disk encryption. The claim must describe field-level
    // encryption, which is what actually exists.
    expect(p.p4).not.toMatch(/encrypted PostgreSQL database|зашифрованной базе|şifrələnmiş.*bazada/i)
    expect(p.p4).toMatch(/AES-256-GCM/)
  })

  it("names every subprocessor that receives personal data", () => {
    const listed = [p.p5_l1, p.p5_l2, p.p5_l3, p.p5_l4, p.p5_l5, p.p5_l6, p.p5_l7].join(" ")
    for (const provider of ["Contabo", "Hetzner", "Cloudflare", "Meta", "Anthropic", "OpenAI", "Google", "Sentry"]) {
      expect(listed, `${provider} receives personal data and must be named`).toContain(provider)
    }
  })

  it("discloses region-dependent processing without inventing a hosting location", () => {
    expect(p.p5_note).toBeTruthy()
    expect(p.p5_note).toMatch(/region|регион/i)
    expect(p.p5_note).toMatch(/safeguard|гарант|təminat/i)
    expect(p.p5_note).toMatch(/under review|проверяются|nəzərdən keçirilir/i)
    expect(p.p5_note).not.toMatch(
      /are subject to applicable transfer safeguards|применяются предусмотренные законом гарантии|qüvvədə olan transsərhəd ötürmə təminatları tətbiq olunur/i,
    )
    expect(p.p5_note).not.toMatch(/confirmed current|подтверждённые актуальные|təsdiqlənmiş cari/i)
    expect(p.p5_note).not.toMatch(/processed in Germany|обработка ведётся в Германии|Emal Almaniyada/i)
  })

  it("states the real deletion window instead of promising the impossible", () => {
    // Object Lock keeps backups immutable for up to 400 days. "Deleted
    // immediately" is a promise the system cannot keep.
    expect(p.p7_note).toBeTruthy()
    expect(p.p7_note).toContain("400")
  })
})

describe("the privacy page renders the corrected sections", () => {
  const page = readFileSync("src/app/(marketing)/legal/privacy/page.tsx", "utf8")

  it.each(["p5_l1", "p5_l5", "p5_l7", "p5_note", "p7_note"])(
    "renders %s — a translated key nothing displays is not a disclosure",
    key => {
      expect(page).toContain(`t("${key}")`)
    },
  )
})

/**
 * F-11, second pass. Correcting the policy TEXT was not enough and the live site
 * proved it: while messages/*.json said one thing, three legal pages each
 * carried their own hardcoded "LeadDrive Inc., Warsaw, Poland" in the contact
 * block, the footer claimed copyright for that company on every page, the Terms
 * of Service named it as the provider in all three locales, and the schema.org
 * markup published a Polish postal address for machines to index.
 *
 * The identity of a data controller is not branding. It is the party a data
 * subject exercises rights against and a regulator writes to. A privacy policy
 * that names a company which does not exist, in a country where it does not
 * operate, points those rights at nobody.
 *
 * These now live in one constant each, and this holds them there.
 */
describe("the site names one legal entity, in one place", () => {
  const constants = readFileSync("src/lib/constants.ts", "utf8")

  it("declares the entity centrally", () => {
    expect(constants).toContain('COMPANY_LEGAL_NAME = "Fanumsec MMC"')
    expect(constants).toMatch(/COMPANY_LEGAL_ADDRESS = "Baku, Azerbaijan"/)
  })

  it.each([
    "src/app/(marketing)/legal/privacy/page.tsx",
    "src/app/(marketing)/legal/terms/page.tsx",
    "src/app/(marketing)/legal/data-deletion/page.tsx",
  ])("%s takes the contact identity from the constant", path => {
    const source = readFileSync(path, "utf8")
    expect(source).toContain("{COMPANY_LEGAL_NAME}, {COMPANY_LEGAL_ADDRESS}")
    expect(source, "a hardcoded copy is how these drifted from the policy text").not.toContain("LeadDrive Inc")
  })

  it("does not claim copyright for a company that does not exist", () => {
    const footer = readFileSync("src/components/marketing/footer.tsx", "utf8")
    expect(footer).toContain("{COMPANY_LEGAL_NAME}")
    expect(footer).not.toContain("LeadDrive Inc")
  })

  it.each([
    "src/app/(marketing)/home/page.tsx",
    "src/app/(marketing)/about/page.tsx",
  ])("%s publishes the real address in structured data", path => {
    // JSON-LD is a machine-readable factual claim that search engines index.
    const source = readFileSync(path, "utf8")
    expect(source).not.toMatch(/addressLocality:\s*"Warsaw"/)
    expect(source).not.toMatch(/addressCountry:\s*"PL"/)
    // Either the literal or the shared constant — what matters is that the
    // published country is Azerbaijan, not that it is spelled inline.
    expect(source).toMatch(/addressCountry:\s*("AZ"|COMPANY_LEGAL_COUNTRY_CODE)/)
  })

  describe.each(LOCALES)("%s", locale => {
    const all = JSON.parse(readFileSync(`messages/${locale}.json`, "utf8"))

    it("names the real provider in the Terms of Service", () => {
      expect(all.terms.p1).toContain("Fanumsec MMC")
      expect(all.terms.p1).not.toContain("LeadDrive Inc")
    })

    it("does not put the footer in the wrong country", () => {
      expect(all.marketing.footer.location).not.toMatch(/Warsaw|Варшав|Poland|Польш|Polşa/i)
      expect(all.marketing.footer.location).toMatch(/Baku|Баку|Bak\u0131/i)
    })
  })
})
