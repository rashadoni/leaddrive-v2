import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

/**
 * Field UX audit 2026-09-05, C15 tail: "футер шага 3 без обрезки" at the
 * tablet width. Measured on production 2026-09-13 in an 834×695 window
 * (`resize_window` cannot change width, a popup opened from the page can),
 * with eight customers on step 3. Three defects, one screen:
 *
 *   1. The dialog root is a fixed `inset-0` box rendered in place inside the
 *      page's `space-y-3`, so it inherited a 12 px bottom margin: 683 px tall
 *      on a 695 px screen, page visible under the sheet.
 *   2. The `sr-only` time labels had the dialog as their containing block,
 *      not the scroller they sit in. They stretched the dialog's scrollHeight
 *      to 876 px, and the `scrollIntoView` on entering step 3 scrolled the
 *      dialog by 89 px — close button at y −89…−53, stepper off the top.
 *   3. With few customers the planner kept its content height, so the footer
 *      ended at y=620 and 62 px of empty sheet sat below it.
 *
 * With the three changes applied live on the same page: root 0–695, dialog
 * scrollTop 0 with scrollHeight = clientHeight, close button 12–48, footer
 * 609–694. These are source checks; the geometry was read from the browser.
 */
const dialog = readFileSync("src/components/ui/dialog.tsx", "utf8")
const routesPage = readFileSync("src/app/(dashboard)/mtm/routes/page.tsx", "utf8")
const builder = readFileSync("src/components/mtm/route-builder.tsx", "utf8")

describe("C15: the planner sheet is exactly the screen", () => {
  it("does not let a parent's spacing shorten a fixed dialog root", () => {
    expect(dialog).toContain("className={`fixed inset-0 z-[60] m-0 flex justify-center")
  })

  it("contains the scroller's absolutely positioned labels inside the scroller", () => {
    const scroller = 'className="relative mx-auto min-h-0 w-full max-w-6xl flex-1 overflow-y-auto overscroll-contain"'
    expect(builder).toContain(scroller)
    // The time labels this is about are still sr-only and still inside it.
    const afterScroller = builder.slice(builder.indexOf(scroller))
    expect(afterScroller).toContain('className="sr-only">{t("plannedTime")}</Label>')
  })

  it("lets the planner fill the sheet so the footer sits on the bottom edge", () => {
    expect(routesPage).toContain('data-testid="mtm-route-builder-dialog" className="flex min-h-0 flex-1 flex-col overflow-hidden"')
    expect(builder).toContain('data-testid="mtm-route-builder" className="flex min-h-0 max-h-dvh flex-1 flex-col overflow-hidden')
    // The footer stays the builder's own sticky last row, not a second copy.
    expect(builder.match(/data-testid="mtm-route-builder-actions"/g)?.length).toBe(1)
  })
})

/**
 * The other C15 tail item: "после выбора дня прокрутка к панели действия".
 * Same window, calendar agenda: tapping 1 September left the plan button at
 * y=664–708 and the day's route at 720–780 on a 695 px screen. Replaying
 * `scrollIntoView({ block: "nearest" })` on the panel in that page scrolled
 * the page 96 px: panel 550–683, the tapped day still visible at 314–358.
 */
describe("C15: picking a day brings its panel into view", () => {
  const calendar = readFileSync("src/components/mtm/route-calendar.tsx", "utf8")

  it("scrolls the selected day's panel into view from the day grid", () => {
    expect(calendar).toContain('ref={selectedDayPanelRef} data-testid="mtm-route-calendar-selected-day"')
    const dayButton = calendar.slice(calendar.indexOf("data-route-calendar-date={key}"), calendar.indexOf("data-route-calendar-date={key}") + 1200)
    expect(dayButton).toContain("selectDate(key)")
    expect(dayButton).toContain("revealSelectedDayPanel()")
  })

  it("does not move a panel that is already visible, and respects reduced motion", () => {
    const reveal = calendar.slice(calendar.indexOf("function revealSelectedDayPanel() {"), calendar.indexOf("function revealSelectedDayPanel() {") + 400)
    expect(reveal).toContain('block: "nearest"')
    expect(reveal).not.toContain('block: "start"')
    expect(reveal).toContain("prefers-reduced-motion: reduce")
    // After paint: the panel must already show the newly selected day.
    expect(reveal).toContain("requestAnimationFrame")
  })
})
