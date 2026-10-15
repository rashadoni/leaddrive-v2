/**
 * The hints of the doctor and institution cards, the task form, «how the
 * figures are counted», pharmacy promotions, the product catalogue, the visit
 * workspace, a day's movement history, Excel exchange and the settings
 * sub-pages (owner, 2026-10-15: «подсказок в модуле очень мало»): words
 * in all three languages for every key asked for, the same blanks, none unused.
 */
import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

type Messages = { [key: string]: string | Messages }
const messages = (locale: string) => JSON.parse(readFileSync(`messages/${locale}.json`, "utf8")) as Messages
const at = (path: string, locale: string) => {
  let node: unknown = messages(locale)
  for (const part of path.split(".")) node = (node as Messages | undefined)?.[part]
  return ((node as Messages | undefined) ?? {}) as Record<string, string>
}
const blanks = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort()
/** Every `"hint.<key>"` (or `"detail.hint.<key>"`) a screen asks for, written out as a literal. */
const used = (files: readonly string[], prefix: string) => {
  const pattern = new RegExp(`"${prefix.replace(/\./g, "\\.")}(\\w+)"`, "g")
  return new Set(files.flatMap((file) => [...readFileSync(file, "utf8").matchAll(pattern)].map((match) => match[1])))
}
const component = (name: string) => `src/components/mtm/${name}.tsx`
const settings = (name: string) => `src/app/(dashboard)/mtm/settings/${name}.tsx`

describe.each([
  ["mtmContactDetail.hint", "hint.", [component("contact-detail"), component("contact-duplicate-dialog")]],
  ["mtmContactEdit.hint", "hint.", [component("contact-edit-dialog")]],
  ["mtmContactScoring.hint", "hint.", [component("contact-scoring-panel"), component("contact-scoring-entry-dialogs")]],
  ["mtmContactWorkplace.hint", "hint.", [component("contact-workplace-dialog")]],
  ["mtmContactDictionaryAssignments.hint", "hint.", [component("contact-dictionary-assignment-panel")]],
  ["mtmCustomers.detail.hint", "detail.hint.", [component("organization-detail")]],
  ["mtmExplainableKpi.hint", "hint.", [component("explainable-kpi-dashboard")]],
  ["mtmPharmacyPromotions.hint", "hint.", ["workspace", "detail", "definition-admin", "campaign-admin", "agent-capture"].map((name) => component(`pharmacy-promotion-${name}`))],
  ["mtmProductCatalog.hint", "hint.", ["src/app/(dashboard)/mtm/products/page.tsx"]],
  ["mtmVisitWorkspace.hint", "hint.", ["src/app/(dashboard)/mtm/visits/visit-workspace.tsx"]],
  ["mtmMap.history.hint", "hint.", [component("location-history-panel")]],
  ["mtmExcel.hint", "hint.", [component("excel-exchange-panel")]],
  ["mtmAgentSection.hint", "hint.", [component("agent-section")]],
  ["mtmScoringFormulas.hint", "hint.", [settings("scoring-formula-settings")]],
  ["mtmContactCategories.hint", "hint.", [settings("contact-category-settings")]],
  ["mtmContactDictionaries.hint", "hint.", [settings("contact-dictionary-settings")]],
  ["mtmOrganizationAttributes.hint", "hint.", [settings("organization-attribute-package-settings")]],
  ["mtmCoverageAdmin.hint", "hint.", [component("coverage-policy-admin")]],
] as const)("the hints of %s", (path, prefix, files) => {
  const keys = used(files, prefix)
  it("are written for every key the screen asks for, in Russian, Azerbaijani and English, with the same blanks", () => {
    expect(keys.size).toBeGreaterThan(0)
    const [r, a, e] = ["ru", "az", "en"].map((locale) => at(path, locale))
    const missing: string[] = []
    for (const key of keys) {
      for (const [locale, texts] of [["ru", r], ["az", a], ["en", e]] as const) {
        if (typeof texts[key] !== "string" || texts[key].trim().length < 8) missing.push(`${locale}.${key}`)
      }
      if (typeof r[key] === "string") {
        expect(blanks(a[key] ?? ""), `az.${key}`).toEqual(blanks(r[key]))
        expect(blanks(e[key] ?? ""), `en.${key}`).toEqual(blanks(r[key]))
      }
    }
    expect(missing).toEqual([])
  })
  it("has no words the screen never shows", () => {
    expect(Object.keys(at(path, "ru")).filter((key) => !keys.has(key))).toEqual([])
  })
})

describe.each(["mtmCustomers.detail.hint", "mtmOrganizationAttributes.hint"])("the institution hints of %s", (path) => {
  it("call institutions what the section calls them", () => {
    const banned: Record<string, RegExp> = {
      ru: /клиент|организац|объект/i,
      az: /müştəri|təşkilat|obyekt/i,
      en: /customer|organi[sz]ation|\bsites?\b/i,
    }
    for (const [locale, word] of Object.entries(banned)) {
      const wrong = Object.entries(at(path, locale)).filter(([, text]) => word.test(text))
      expect(wrong, locale).toEqual([])
    }
  })
})
