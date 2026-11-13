import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

/**
 * Zeytun 2026-11-13, through the owner: «Общий календарь, чтоб посмотреть по
 * дням/неделям, какие маршруты имеются, — не нашёл. Их надо сделать в видном
 * месте, либо создать кнопку». The calendar lived only in the sidebar; the
 * routes page, where people look for it, had no way there.
 */
const PAGE = "src/app/(dashboard)/mtm/routes/page.tsx"

describe("the routes page opens the calendar with a button", () => {
  const page = readFileSync(PAGE, "utf8")
  const toolbar = page.slice(page.indexOf('data-testid="mtm-route-toolbar"'), page.indexOf("</header>"))

  it("has a worded button to /mtm/calendar in its toolbar, not on the calendar itself", () => {
    const button = toolbar.slice(toolbar.indexOf('data-testid="mtm-routes-open-calendar"') - 200, toolbar.indexOf('data-testid="mtm-routes-open-calendar"') + 400)
    expect(button).toContain('{!calendarSurface ? <Hint text={t("hint.openCalendar")}>')
    expect(button).toContain('<Link href="/mtm/calendar">')
    expect(button).toContain('{t("openCalendar")}')
  })

  it("says it in every language, with a hint", () => {
    for (const locale of ["en", "ru", "az"]) {
      const routes = JSON.parse(readFileSync(`messages/${locale}.json`, "utf8")).mtmRoutesPage
      expect(typeof routes.openCalendar, locale).toBe("string")
      expect(typeof routes.hint.openCalendar, locale).toBe("string")
    }
  })
})
