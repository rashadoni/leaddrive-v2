import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

/**
 * Every sidebar group named in the navigation must have a label in every
 * language.
 *
 * `scripts/check-translations.js` compares the three message files against
 * each other, so a key missing from all three passes it while the app renders
 * the key path instead of a name. That is exactly what shipped: the group was
 * renamed from "Workforce" to "HRM", the label was not renamed with it, and
 * the sidebar showed `NAV.GROUPS.HRM` to every user of that module — its own
 * uppercase styling making it look like a deliberate, if baffling, name.
 *
 * Same idea as `dashboard-widget-labels.test.ts`: check what the CODE asks for
 * against what exists, not the files against each other.
 */
const LANGUAGES = ["en", "ru", "az"] as const

function navGroups(): string[] {
  const source = readFileSync("src/lib/nav-items.ts", "utf8")
  const groups = [...source.matchAll(/group:\s*"([^"]+)"/g)].map((m) => m[1])
  return [...new Set(groups)].sort()
}

function groupLabels(language: string): Record<string, unknown> {
  const file = JSON.parse(readFileSync(`messages/${language}.json`, "utf8"))
  return (file.nav?.groups ?? {}) as Record<string, unknown>
}

describe("sidebar group labels", () => {
  const groups = navGroups()

  it("finds the groups at all", () => {
    // Negative control: a matcher that stops matching makes every assertion
    // below vacuously true, which is how this class of bug hides.
    expect(groups.length).toBeGreaterThan(10)
    expect(groups).toContain("HRM")
    expect(groups).toContain("CRM")
  })

  it.each(LANGUAGES)("%s names every group the sidebar renders", (language) => {
    const labels = groupLabels(language)
    const missing = groups.filter((group) => !(group in labels))
    expect(missing).toEqual([])
  })

  it.each(LANGUAGES)("%s leaves none of them blank", (language) => {
    const labels = groupLabels(language)
    // A key present but empty renders as nothing, which reads as a broken
    // sidebar rather than as a missing translation.
    const blank = groups.filter(
      (group) => typeof labels[group] === "string" && !String(labels[group]).trim(),
    )
    expect(blank).toEqual([])
  })
})
