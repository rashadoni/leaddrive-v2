import { describe, it, expect } from "vitest"
import { readFileSync } from "fs"

/**
 * Every label the dashboard widget registry asks for must exist in every
 * language.
 *
 * `scripts/check-translations.js` compares the three files against EACH OTHER,
 * so a key missing from all three passes it while the app throws. That is what
 * happened: 27 registry keys had no translation anywhere, and the dashboard
 * logged `MISSING_MESSAGE: dashboard.risksBanner` 42 times in a single visit —
 * green parity, red console.
 *
 * This checks the other axis: what the CODE asks for against what exists.
 */

const LANGUAGES = ["en", "ru", "az"] as const

function registryKeys(): string[] {
  const source = readFileSync("src/lib/dashboard/widget-registry.ts", "utf8")
  return [...source.matchAll(/(?:titleKey|descKey):\s*"([^"]+)"/g)].map((m) => m[1])
}

function dashboardMessages(language: string): Record<string, unknown> {
  const file = JSON.parse(readFileSync(`messages/${language}.json`, "utf8"))
  return (file.dashboard ?? {}) as Record<string, unknown>
}

describe("dashboard widget labels", () => {
  const keys = registryKeys()

  it("finds the keys at all", () => {
    // Negative control: a matcher that stops matching would make every
    // assertion below vacuous — which is exactly how this went unnoticed.
    expect(keys.length).toBeGreaterThan(20)
    expect(keys).toContain("risksBanner")
  })

  it.each(LANGUAGES)("%s has every label the registry asks for", (language) => {
    const messages = dashboardMessages(language)
    const missing = keys.filter((key) => !(key in messages))
    expect(missing).toEqual([])
  })

  it.each(LANGUAGES)("%s leaves none of them empty", (language) => {
    const messages = dashboardMessages(language)
    const blank = keys.filter((key) => typeof messages[key] === "string" && !String(messages[key]).trim())
    // A key present but empty renders as nothing, which reads as a broken
    // widget rather than a missing translation.
    expect(blank).toEqual([])
  })
})
