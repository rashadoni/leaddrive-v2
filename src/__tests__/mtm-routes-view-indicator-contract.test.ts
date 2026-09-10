import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

/**
 * Field UX audit 2026-09-05, task C9 — and the requirement it actually has.
 *
 * The plan cites RUX-106 and an earlier pass recorded that RUX-106 "is not in
 * the repository". It is: `docs/mtm-routes-ux-roadmap-2026-08-23.md` line 116,
 * "Replace duplicated status chips/counters with one filter model / Status
 * count has one source and one interaction". That is the subject of C11, which
 * is closed — not a view indicator. So RUX-106 is the wrong citation for C9.
 *
 * C9's real requirement is the audit's own finding W-08: "Два элемента
 * одновременно выглядят выбранными. При активном календаре выпадающая кнопка
 * подписана «Bütün marşrutlar», последним выбранным вторичным видом."
 *
 * Verified on production 2026-09-10 through the owner's browser, walking the
 * exact path that produced it — calendar → matrix → calendar:
 *
 *   calendar        → "Nəzarət və hesabatlar"   (the generic tools label)
 *   matrix          → "Həftə planı"             (names the active view)
 *   back to calendar→ "Nəzarət və hesabatlar", calendar aria-pressed=true
 *
 * The label is derived from `viewMode` every render, never remembered, so the
 * stale secondary name cannot come back. Three affordances carry it, because
 * one alone is not an indicator: the label names the active view,
 * `aria-pressed` tells a screen reader, and the tinted border shows it to
 * someone glancing at the row.
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

  it("falls back to the generic tools label while a primary view is active", () => {
    // This is W-08 itself: the dropdown must not keep the name of the last
    // secondary view once the calendar or the week is the active one.
    expect(page).toContain("        : planningToolsLabel")
    expect(page).toContain('const planningToolsLabel = t(capabilities.canReview ? "controlAndReports" : "routePlanningTools")')
    // Derived from viewMode on every render — there is no remembered label to
    // go stale.
    expect(page).not.toContain("setAdvancedViewLabel")
    expect(page).not.toContain("useState(advancedViewLabel")
  })

  it("has a label for every advanced view in every language", () => {
    const missing: string[] = []
    for (const locale of ["en", "ru", "az"]) {
      const messages = JSON.parse(readFileSync(`messages/${locale}.json`, "utf8"))
      for (const key of ["viewList", "viewMatrix", "viewApprovals", "viewMyRoutes", "viewTeamCalendar", "viewMyCalendar", "controlAndReports", "routePlanningTools"]) {
        if (typeof messages.mtmRoutesPage?.[key] !== "string") missing.push(`${locale}.${key}`)
      }
    }
    expect(missing).toEqual([])
  })
})
