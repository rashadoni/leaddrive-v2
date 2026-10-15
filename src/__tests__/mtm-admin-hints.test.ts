/**
 * The hints of MTM settings and «Доступ» (owner, 2026-10-15: «подсказок в
 * модуле очень мало»): words in all three languages for every key asked for,
 * none unused, and the alert thresholds carry the description lines that had
 * been written for them and never drawn.
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
const used = (files: string[]) => new Set(files.flatMap((file) => [...readFileSync(file, "utf8").matchAll(/"hint\.(\w+)"/g)].map((match) => match[1])))

describe.each([
  ["mtmSettingsPage.hint", ["src/app/(dashboard)/mtm/settings/route-target-type-settings.tsx"]],
  ["mtmVisitPolicies.hint", ["src/app/(dashboard)/mtm/settings/visit-action-switches.tsx", "src/app/(dashboard)/mtm/settings/visit-policy-settings.tsx"]],
  ["mtmAccess.hint", ["src/components/mtm/access-panel.tsx", "src/components/mtm/agent-permission-matrix.tsx"]],
] as const)("the hints of %s", (path, files) => {
  const keys = used([...files])
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

describe("the alert thresholds on the settings page", () => {
  const page = readFileSync("src/app/(dashboard)/mtm/settings/page.tsx", "utf8")
  it("each have a description line, written in all three languages", () => {
    for (const key of ["hintAutoCheckout", "hintDeviationThreshold", "hintDeviationThrottle"]) {
      expect(page).toContain(`hintKey: "${key}"`)
      for (const locale of ["ru", "az", "en"]) expect(typeof at("mtmSettingsPage", locale)[key], `${locale}.${key}`).toBe("string")
    }
    // …and the threshold row draws it.
    expect(page).toContain("{threshold.hintKey ? <div className=\"mt-0.5 text-xs text-muted-foreground\">{ts(threshold.hintKey)}</div> : null}")
  })
})
