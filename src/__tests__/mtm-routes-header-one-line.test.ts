import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

/**
 * Field UX audit 2026-09-05, W-05 and the tail of task C5: the first screen
 * was spent on chrome.
 *
 * Measured on the owner's browser at the audit's own desktop width, 1470x675,
 * on 10 September: the first row of the week grid began at y=312. Forty-six
 * per cent of the window went to headers before anything to work with.
 *
 * Part of that was a page heading that said what three other things already
 * said: the module tab strip highlights "Marşrutlar", the heading repeats it,
 * and the help article behind the "?" explains the page in full. The subtitle
 * was the fourth copy, and the Definition of Done puts explanation behind the
 * "?" rather than above the data.
 */
const PAGE = "src/app/(dashboard)/mtm/routes/page.tsx"

describe("C5 tail: the routes heading is one line", () => {
  it("keeps the heading and drops the paragraph under it", () => {
    const page = readFileSync(PAGE, "utf8")
    const header = page.slice(page.indexOf('data-testid="mtm-route-header"'), page.indexOf('data-testid="mtm-route-toolbar"'))
    expect(header).toContain('<h1 className="text-lg font-semibold leading-6 text-foreground">{t("title")}</h1>')
    expect(header).not.toContain('{t("subtitle")}')
  })

  it("leaves the explanation reachable where the rule puts it", () => {
    const page = readFileSync(PAGE, "utf8")
    expect(page).toContain('<HelpButton slug="mtm-routes" className="shrink-0" />')
  })

  it("does not leave the string behind as a fourth answer", () => {
    // A key nothing reads is the next person's "surely this is shown
    // somewhere"; the help article carries the description now.
    const orphans: string[] = []
    for (const locale of ["en", "ru", "az"]) {
      const messages = JSON.parse(readFileSync(`messages/${locale}.json`, "utf8"))
      if ("subtitle" in (messages.mtmRoutesPage ?? {})) orphans.push(locale)
    }
    expect(orphans).toEqual([])
  })

  it("still names the page for anyone who arrives without the tab strip", () => {
    const titles: string[] = []
    for (const locale of ["en", "ru", "az"]) {
      const messages = JSON.parse(readFileSync(`messages/${locale}.json`, "utf8"))
      const title = messages.mtmRoutesPage?.title
      if (typeof title === "string" && title.trim()) titles.push(locale)
    }
    expect(titles).toEqual(["en", "ru", "az"])
  })
})
