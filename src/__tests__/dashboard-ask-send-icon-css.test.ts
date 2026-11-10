/**
 * The send arrow of «Da Vinci-dən soruşun» on the dashboard takes the action button's own
 * foreground. From 2026-10-25 the button on the wallpaper is near-white, and the rule that paints
 * the field's icons white reached the arrow too — white on white, the button looked empty (owner,
 * 2026-11-10: «что с кнопкой поиска случилось»). Measured in Chromium with these stylesheets:
 * the arrow was rgba(255,255,255,0.8) on rgb(245,245,245), and is rgb(23,23,23) after the fix.
 * This keeps the two rules that decide it from drifting back.
 */
import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const css = readFileSync("src/app/globals.css", "utf8").replace(/\/\*[\s\S]*?\*\//g, "")

const rulesFor = (selector: string) =>
  [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(([, selectors]) => selectors.split(",").some((s) => s.trim() === selector))
    .map(([, , body]) => body)

describe("dashboard ask field: the send arrow stays visible", () => {
  it("no rule paints every icon of the field — only the sparkle in the input row", () => {
    expect(rulesFor(".dashboard-welcome-command svg").join("")).not.toMatch(/(^|[^-])color\s*:/)
    expect(rulesFor('html[data-wallpaper][data-wallpaper-scope="dashboard"] .dashboard-welcome-command svg')).toEqual([])
    expect(rulesFor(".dashboard-welcome-command > div > svg").join("")).toMatch(/color\s*:/)
  })

  it("the arrow inherits the button's foreground", () => {
    expect(rulesFor(".dashboard-welcome-command button svg").join("")).toMatch(/color\s*:\s*inherit/)
  })
})
