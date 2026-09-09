import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

/**
 * Field UX audit 2026-09-05, task C9 (RUX-106): the routes page must say which
 * view you are looking at. The plan names the place — the dropdown button's
 * label — and not the requirement, so this pins what the code already does
 * rather than inventing what it should.
 *
 * Three separate affordances, because one of them alone is not an indicator:
 * the label names the active view, `aria-pressed` tells a screen reader, and
 * the tinted border shows it to someone glancing at the row.
 */
describe("MTM routes view indicator", () => {
  const page = readFileSync("src/app/(dashboard)/mtm/routes/page.tsx", "utf8")

  it("names the active advanced view on the dropdown itself", () => {
    // Not a fixed "More views": someone who left the page in the matrix and
    // came back needs the button to say matrix.
    expect(page).toContain('const advancedViewLabel = viewMode === "list"')
    expect(page).toContain('{advancedViewLabel}<ChevronDown')
    expect(page).toContain("aria-label={advancedViewLabel}")
    expect(page).toContain("title={advancedViewLabel}")
  })

  it("marks the calendar button pressed, not merely coloured", () => {
    expect(page).toContain('aria-pressed={viewMode === "calendar"}')
    expect(page).toContain('variant={viewMode === "calendar" ? "default" : "ghost"}')
  })

  it("tints the dropdown while an advanced view is active", () => {
    // Without this the row looks like nothing is selected whenever the active
    // view lives behind the dropdown.
    expect(page).toContain('const advancedViewActive = viewMode === "list" || viewMode === "matrix" || viewMode === "approvals"')
    expect(page).toContain('advancedViewActive ? "border-primary/35 bg-primary/5 text-primary"')
  })

  it("has a label for every advanced view in every language", () => {
    const missing: string[] = []
    for (const locale of ["en", "ru", "az"]) {
      const messages = JSON.parse(readFileSync(`messages/${locale}.json`, "utf8"))
      for (const key of ["viewList", "viewMatrix", "viewApprovals", "viewMyRoutes", "viewTeamCalendar", "viewMyCalendar"]) {
        if (typeof messages.mtmRoutesPage?.[key] !== "string") missing.push(`${locale}.${key}`)
      }
    }
    expect(missing).toEqual([])
  })
})
