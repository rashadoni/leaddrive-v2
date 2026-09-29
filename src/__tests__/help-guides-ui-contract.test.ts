import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { HELP_REGISTRY } from "@/content/help/registry"

function source(path: string): string {
  return readFileSync(path, "utf8")
}

describe("Help and Da Vinci guide wiring", () => {
  const drawer = source("src/components/help/help-drawer.tsx")
  const helpButton = source("src/components/help/help-button.tsx")
  const assistant = source("src/components/ai-assistant-panel.tsx")

  it("registers both guides in every supported locale", () => {
    for (const slug of ["help-center", "ai-assistant"] as const) {
      const article = HELP_REGISTRY[slug]
      for (const locale of ["az", "en", "ru"] as const) {
        expect(article.title[locale]).toBeTruthy()
        expect(article.subtitle[locale]).toBeTruthy()
        expect(article.content[locale]).toBeTruthy()
      }
    }
  })

  it("opens the general Help guide without losing the contextual article", () => {
    expect(drawer).toContain("const [activeSlug, setActiveSlug] = useState<HelpSlug>(slug)")
    expect(drawer).toContain('setActiveSlug("help-center")')
    expect(drawer).toContain("activeSlug !== slug")
    expect(drawer).toContain("setActiveSlug(slug)")
  })

  it("keeps the Da Vinci guide reachable from the assistant header", () => {
    expect(assistant).toContain('<HelpButton\n                slug="ai-assistant"')
    expect(assistant.indexOf('slug="ai-assistant"')).toBeGreaterThan(assistant.indexOf("{/* Header */}"))
    expect(assistant).toContain("onOpenChange={setHelpOpen}")
    expect(assistant).toContain("if (!open || helpOpen) return")
    expect(helpButton).toContain("onOpenChange?.(nextOpen)")
  })
})
