/**
 * The MTM panel's and the employee week's hints (owner, 2026-10-15: «подсказок
 * в модуле очень мало») have their words in all three languages — a key without
 * words would be drawn as «hint.kpiInField» under the cursor — and every word
 * written is used.
 */
import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

type Messages = { [key: string]: string | Messages }
const page = (locale: string) => (JSON.parse(readFileSync(`messages/${locale}.json`, "utf8")) as Messages).mtmDashboardPage as Messages
const hintsOf = (locale: string, namespace: "home" | "operationalWeek") => ((page(locale)[namespace] as Messages).hint ?? {}) as Record<string, string>

const SOURCES: Record<"home" | "operationalWeek", string[]> = {
  home: ["home-dashboard", "home-parts", "home-attention-card", "home-team-card", "home-insight-cards"].map((name) => `src/components/mtm/${name}.tsx`),
  operationalWeek: ["src/components/mtm/operational-week-home.tsx"],
}
const usedIn = (files: string[]) => new Set(files.flatMap((file) => [...readFileSync(file, "utf8").matchAll(/"hint\.(\w+)"/g)].map((match) => match[1])))
const blanks = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort()

describe.each(["home", "operationalWeek"] as const)("the hints of mtmDashboardPage.%s", (namespace) => {
  const used = usedIn(SOURCES[namespace])

  it("are written for every key the screen asks for, in Russian, Azerbaijani and English, with the same blanks", () => {
    expect(used.size).toBeGreaterThan(15)
    const ru = hintsOf("ru", namespace), az = hintsOf("az", namespace), en = hintsOf("en", namespace)
    const missing: string[] = []
    for (const key of used) {
      for (const [locale, texts] of [["ru", ru], ["az", az], ["en", en]] as const) {
        if (typeof texts[key] !== "string" || texts[key].trim().length < 8) missing.push(`${locale}.${key}`)
      }
      if (typeof ru[key] === "string") {
        expect(blanks(az[key] ?? ""), `az.${key}`).toEqual(blanks(ru[key]))
        expect(blanks(en[key] ?? ""), `en.${key}`).toEqual(blanks(ru[key]))
      }
    }
    expect(missing).toEqual([])
  })

  it("has no words the screen never shows", () => {
    expect(Object.keys(hintsOf("ru", namespace)).filter((key) => !used.has(key))).toEqual([])
  })
})
