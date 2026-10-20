/**
 * The demo's scenes in the CRM's own font (owner, 2026-10-20: the intro clips
 * are re-filmed so that they match the CRM). The CRM sets its pages in Plus
 * Jakarta Sans — `next/font` in the dashboard layout, `font-dashboard` on its
 * <main>. The clips had been filmed in the body's Inter/Arial, which the
 * filming box drew as Liberation Sans.
 *
 * `next/font` runs only under Next's compiler, so what is checked is the
 * wiring: the same font call as the dashboard's, the variable defined on every
 * demo route, and the scene container that reads it.
 */
import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8")

/** The options object of the first `Plus_Jakarta_Sans({ … })` call, whitespace folded. */
function jakartaOptions(source: string): string {
  const match = /Plus_Jakarta_Sans\(\{([\s\S]*?)\}\)/.exec(source)
  expect(match, "a Plus_Jakarta_Sans({ … }) call").not.toBeNull()
  return match![1].replace(/\s+/g, " ").trim()
}

describe("the demo's scenes are set in the CRM's font", () => {
  it("loads Plus Jakarta Sans with the dashboard's very options, under its variable", () => {
    const dashboard = jakartaOptions(read("src/app/(dashboard)/layout.tsx"))
    const demo = jakartaOptions(read("src/components/demo-center/journey/demo-scene-font.ts"))
    expect(demo).toBe(dashboard)
    expect(demo).toContain('variable: "--font-dashboard"')
  })

  it.each(["demo-open", "demo-access", "demo-preview"])("defines the variable on /%s without a box of its own", (route) => {
    const layout = read(`src/app/${route}/layout.tsx`)
    expect(layout).toContain('from "@/components/demo-center/journey/demo-scene-font"')
    expect(layout).toContain("demoSceneFont.variable")
    // `contents`: the wrapper draws nothing, so the pages keep their own layout.
    expect(layout).toMatch(/className=\{`contents \$\{demoSceneFont\.variable\}`\}/)
  })

  it("puts the scene, and only the scene, in that font", () => {
    const player = read("src/components/demo-center/journey/demo-journey-player.tsx")
    expect(player).toMatch(/<main id="demo-scene" className="font-dashboard /)
    // The guide, the sidebar and the header around it keep the demo's own font.
    expect(player.match(/className=[^>]*\bfont-dashboard\b/g)).toHaveLength(1)
  })
})
