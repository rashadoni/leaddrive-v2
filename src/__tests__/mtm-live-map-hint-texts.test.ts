/**
 * The live map's hints (owner, 2026-10-15: «подсказок в модуле очень мало»)
 * have their words in all three languages — a key without words would be drawn
 * as «mtmMap.hint.chipLate» under the cursor — and every word written is used.
 */
import { readFileSync, readdirSync } from "node:fs"
import { describe, expect, it } from "vitest"

type Messages = { [key: string]: string | Messages }
const hintsOf = (locale: string) =>
  ((JSON.parse(readFileSync(`messages/${locale}.json`, "utf8")) as Messages).mtmMap as Messages).hint as Record<string, string>

const SOURCES = [
  "src/app/(dashboard)/mtm/map/page.tsx",
  ...readdirSync("src/components/mtm").filter((file) => /^live-map.*\.tsx$/.test(file)).map((file) => `src/components/mtm/${file}`),
]
const used = new Set(SOURCES.flatMap((file) => [...readFileSync(file, "utf8").matchAll(/"hint\.(\w+)"/g)].map((match) => match[1])))
const blanks = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort()

describe("the live map's hints", () => {
  it("are written for every key the screen asks for, in Russian, Azerbaijani and English, with the same blanks", () => {
    const ru = hintsOf("ru"), az = hintsOf("az"), en = hintsOf("en")
    expect(used.size).toBeGreaterThan(80)
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
    expect(Object.keys(hintsOf("ru")).filter((key) => !used.has(key))).toEqual([])
  })
})
