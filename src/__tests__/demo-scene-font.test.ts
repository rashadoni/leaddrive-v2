/**
 * The demo's scenes in the CRM's own font (owner, 2026-10-20: the intro clips
 * are re-filmed so that they match the CRM). The CRM sets its pages in Plus
 * Jakarta Sans — `next/font/local` in `src/lib/fonts/dashboard-font.ts`, put on
 * the dashboard's <main> with `font-dashboard`
 * <main>. The clips had been filmed in the body's Inter/Arial, which the
 * filming box drew as Liberation Sans.
 *
 * `next/font` runs only under Next's compiler, so what is checked is the
 * wiring: the dashboard's very font object, the variable defined on every
 * demo route, and the scene container that reads it.
 */
import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8")

describe("the demo's scenes are set in the CRM's font", () => {
  it("uses the dashboard's very font object, under its variable", () => {
    const dashboard = read("src/app/(dashboard)/layout.tsx")
    const demo = read("src/components/demo-center/journey/demo-scene-font.ts")
    expect(dashboard).toContain('import { dashboardFont } from "@/lib/fonts/dashboard-font"')
    expect(dashboard).toContain("${dashboardFont.variable}")
    expect(demo).toContain('import { dashboardFont } from "@/lib/fonts/dashboard-font"')
    expect(demo).toMatch(/export const demoSceneFont = dashboardFont\n/)
    expect(read("src/lib/fonts/dashboard-font.ts")).toContain('variable: "--font-dashboard"')
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
