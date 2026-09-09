import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

/**
 * Field UX audit 2026-09-05, W-03 / task C3: the document language must
 * follow the request locale. A hard-coded `lang="en"` put screen readers,
 * hyphenation and spell-check into the wrong language for the Azerbaijani
 * and Russian interface.
 */
describe("root layout document language", () => {
  const layout = readFileSync("src/app/layout.tsx", "utf8")

  it("takes the locale from next-intl's request config", () => {
    expect(layout).toContain('import { getLocale, getMessages } from "next-intl/server"')
    expect(layout).toContain("const locale = await getLocale()")
  })

  it("never hard-codes the html lang attribute", () => {
    expect(layout).toContain("<html lang={locale} suppressHydrationWarning>")
    expect(layout).not.toMatch(/<html lang="[a-z-]+"/)
  })
})
