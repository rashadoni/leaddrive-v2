import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

/**
 * Field UX audit 2026-09-05, the last open tail of task C7.
 *
 * The team week is a seven-day grid inside `overflow-x-auto`. At tablet width
 * Saturday and Sunday were cut off with nothing saying so — the audit's words
 * were "обрезаны без намёка на прокрутку", and a manager reads that as a
 * five-day week rather than as a scrollable one.
 */
const grid = readFileSync("src/components/mtm/route-week-plan.tsx", "utf8")
const css = readFileSync("src/app/globals.css", "utf8")

describe("C7 tail: the week says it continues", () => {
  it("marks the scroller", () => {
    expect(grid).toContain('data-testid="mtm-week-scroller" className="scroll-hint-x overflow-x-auto"')
  })

  it("uncovers the shadow only on the side that has more", () => {
    // The local/scroll pair is the whole trick: the covering gradients move
    // with the content, so a shadow appears exactly where content continues.
    const rule = css.slice(css.indexOf(".scroll-hint-x {"), css.indexOf("}", css.indexOf(".scroll-hint-x {")))
    expect(rule).toContain("background-attachment: local, local, scroll, scroll;")
    expect(rule).toContain("linear-gradient(to right, hsl(var(--card)) 40%")
    expect(rule).toContain("linear-gradient(to left, hsl(var(--card)) 40%")
  })

  it("uses theme tokens, so it survives dark mode", () => {
    const rule = css.slice(css.indexOf(".scroll-hint-x {"), css.indexOf("}", css.indexOf(".scroll-hint-x {")))
    expect(rule).not.toMatch(/#[0-9a-f]{3,8}\b/i)
    expect(rule).toContain("hsl(var(--foreground) / 0.16)")
  })

  it("costs no listener and no state", () => {
    // A resize/scroll listener for a visual hint is the kind of thing that
    // survives long enough to leak; this needs neither.
    const scroller = grid.slice(grid.indexOf('data-testid="mtm-week-scroller"') - 400, grid.indexOf('data-testid="mtm-week-scroller"') + 400)
    expect(scroller).not.toContain("addEventListener")
    expect(scroller).not.toContain("onScroll")
  })
})
