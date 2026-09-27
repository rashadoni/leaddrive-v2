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

  it("shows every view as its own pressed-or-not tab, with no dropdown to hide one", () => {
    // Owner 2026-09-25: four views hid behind a dropdown next to two visible
    // ones. Each view is now a tab in one row; aria-pressed tells a screen
    // reader, the filled variant shows it to someone glancing at the row.
    expect(page).toContain('data-testid="mtm-route-view-tabs"')
    expect(page).not.toContain("advancedViewLabel")
    expect(page).not.toContain("advancedViewsOpen")
    for (const view of ["calendar", "week", "list", "matrix", "approvals"]) {
      expect(page).toContain(`aria-pressed={viewMode === "${view}"}`)
      expect(page).toContain(`variant={viewMode === "${view}" ? "default" : "ghost"}`)
    }
    // Excel is an action, not a view: a button with words beside «Plan route».
    expect(page.indexOf('data-testid="mtm-routes-excel-exchange"')).toBeLessThan(page.indexOf('data-testid="mtm-route-builder-open"'))
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
