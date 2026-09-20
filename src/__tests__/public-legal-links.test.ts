import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const LOCALES = ["en", "ru", "az"] as const
const EXPECTED_LABELS = {
  en: ["CRM Privacy Policy", "Terms of Use", "Data Deletion"],
  ru: ["Политика конфиденциальности CRM", "Условия использования", "Удаление данных"],
  az: ["CRM Məxfilik Siyasəti", "İstifadə Şərtləri", "Məlumat Silinməsi"],
} as const

describe("public legal entry links", () => {
  it("localizes all three legal labels in EN, RU and AZ", () => {
    for (const locale of LOCALES) {
      const footer = JSON.parse(
        readFileSync(`messages/${locale}.json`, "utf8"),
      ).marketing.footer

      expect([footer.privacy, footer.terms, footer.dataDeletion]).toEqual(
        EXPECTED_LABELS[locale],
      )
    }
  })

  it("links the marketing footer to the localized CRM legal documents", () => {
    const footer = readFileSync("src/components/marketing/footer.tsx", "utf8")

    expect(footer).toContain("`/legal/privacy?lang=${locale}`")
    expect(footer).toContain("`/legal/terms?lang=${locale}`")
    expect(footer).toContain("`/legal/data-deletion?lang=${locale}`")
    expect(footer).not.toContain('href: "/privacy"')
  })

  it("shows the same three localized links on the CRM login screen", () => {
    const layout = readFileSync("src/app/(auth)/layout.tsx", "utf8")

    expect(layout).toContain("`/legal/privacy?lang=${locale}`")
    expect(layout).toContain("`/legal/terms?lang=${locale}`")
    expect(layout).toContain("`/legal/data-deletion?lang=${locale}`")
    expect(layout).toContain('{t("footer.privacy")}')
    expect(layout).toContain('{t("footer.terms")}')
    expect(layout).toContain('{t("footer.dataDeletion")}')
    expect(layout).not.toContain('href="/privacy"')
  })
})
