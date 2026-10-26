/**
 * The MTM colours the owner approved on 2026-10-18 («не слишком ли много
 * заливок, и цветовая схема, и меню внутри блоков»), held across every MTM
 * page, not only the ones the mockup showed:
 *
 * - a status is the colour of its words or a dot, never a pale tinted pill,
 *   tile, cell or square under an icon;
 * - warnings and notices are white with a coloured left edge;
 * - inside a page a chosen tab is dark text over an orange line and a chosen
 *   chip uses the shared neutral selection — primary actions use common CRM tokens.
 */
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { MTM_TAB_ROW, mtmChipClass, mtmTabClass } from "@/components/mtm/calm-classes"
import { Badge } from "@/components/mtm/mtm-badge"

const ROOTS = ["src/components/mtm", "src/app/(dashboard)/mtm"]

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sources(path)
    return path.endsWith(".tsx") ? [path] : []
  })
}

const files = ROOTS.flatMap(sources)

/** Pale colour fills (`bg-amber-50`, `bg-sky-100/70`, `dark:bg-…` aside); a hover tint is not counted. */
const PALE_FILL = /(?<![\w:-])bg-(?:amber|sky|blue|rose|red|emerald|orange|violet|green|teal|indigo|cyan|yellow|lime|purple|fuchsia)-(?:50|100|200)(?![0-9])/

/** A button that turns into a filled one when chosen: the second filled pill inside a page. */
const FILLED_WHEN_CHOSEN = /variant=\{[^{}]*\?\s*"default"\s*:\s*"(?:outline|ghost)"\}/

describe("MTM calm colours (owner, 2026-10-18)", () => {
  it("reads every MTM page", () => {
    expect(files.length).toBeGreaterThan(150)
  })

  it("paints no status, notice or icon square with a pale colour fill", () => {
    const found = files.flatMap((path) =>
      readFileSync(path, "utf8").split("\n").flatMap((line, index) => (PALE_FILL.test(line) ? [`${path}:${index + 1}`] : [])),
    )
    expect(found).toEqual([])
  })

  it("never gives a chosen tab or chip the primary action variant", () => {
    const found = files.flatMap((path) =>
      readFileSync(path, "utf8").split("\n").flatMap((line, index) => (FILLED_WHEN_CHOSEN.test(line) ? [`${path}:${index + 1}`] : [])),
    )
    expect(found).toEqual([])
  })

  it("marks a chosen tab by an orange line under dark text, on a row with one grey rule", () => {
    expect(mtmTabClass(true)).toContain("border-b-2")
    expect(mtmTabClass(true)).toContain("border-primary")
    expect(mtmTabClass(true)).toContain("text-foreground")
    expect(mtmTabClass(false)).toContain("border-transparent")
    for (const active of [true, false]) expect(mtmTabClass(active)).not.toMatch(/\bbg-primary\b/)
    expect(MTM_TAB_ROW).toContain("border-b")
  })

  it("uses the shared neutral selected chip and preserves semantic status text", () => {
    expect(mtmChipClass(true)).toBe("crm-choice-selected text-foreground")
    expect(mtmChipClass(false)).toBe("text-muted-foreground")
    expect(mtmChipClass(true, "text-red-600")).toBe("crm-choice-selected crm-choice-semantic text-red-600")
    expect(mtmChipClass(false, "text-red-600")).toBe("text-red-600")
  })

  it("draws a status badge as coloured words with a dot, and a plain one with a thin edge", () => {
    const warning = renderToStaticMarkup(createElement(Badge, { variant: "warning" }, "Gözləyir"))
    expect(warning).toContain("text-amber-700")
    expect(warning).toContain("rounded-full bg-amber-500")
    expect(warning).not.toMatch(PALE_FILL)
    expect(warning).toContain("Gözləyir")

    const outline = renderToStaticMarkup(createElement(Badge, { variant: "outline" }, "A"))
    expect(outline).toContain("border-border")
    expect(outline).not.toMatch(/\bbg-/)
  })

  it("gives every MTM page the calm Badge, not the shared tinted one", () => {
    const shared = files.filter((path) => !path.endsWith("mtm-badge.tsx") && /import \{ Badge \} from "@\/components\/ui\/badge"/.test(readFileSync(path, "utf8")))
    expect(shared).toEqual([])
  })
})

/**
 * The demo draws the MTM pages again (its scenes), and the intro clips are
 * filmed on those scenes. Filmed in the colours from before 2026-10-18, the
 * clips showed the owner a module the CRM no longer looks like, and he had
 * them re-filmed (2026-10-20). The scenes keep to the same rules.
 */
const DEMO_SCENES = [
  "src/components/demo-center/journey/scenes/mtm-scene.tsx",
  "src/components/demo-center/journey/scenes/personnel-scene.tsx",
]

/** A class that fills in only for the chosen one: `active ? "bg-primary …" : …`. */
const FILLS_WHEN_CHOSEN = /\?\s*"[^"]*\b(?:bg-primary|bg-foreground|bg-orange-500|bg-zinc-900|bg-emerald-600|bg-blue-600)\b/
/** A pressed or selected Button with no variant is the filled default one (the scenes write a Button on one line). */
const pressedDefaultButton = (line: string) => /<Button\b/.test(line) && /\baria-(?:selected|pressed)\b/.test(line) && !/\bvariant=/.test(line)

describe("the demo's MTM and Personnel screens in the calm colours (owner, 2026-10-20)", () => {
  const lines = DEMO_SCENES.flatMap((path) => readFileSync(path, "utf8").split("\n").map((line, index) => ({ at: `${path}:${index + 1}`, line })))

  it("paint no pale fill, and fill no tab, chip or button because it is the chosen one", () => {
    expect(lines.filter(({ line }) => PALE_FILL.test(line)).map(({ at }) => at)).toEqual([])
    expect(lines.filter(({ line }) => FILLED_WHEN_CHOSEN.test(line) || FILLS_WHEN_CHOSEN.test(line) || pressedDefaultButton(line)).map(({ at }) => at)).toEqual([])
  })

  it("draw the tabs inside a page with the module's own classes, and no shared tinted Badge", () => {
    for (const path of DEMO_SCENES) {
      const source = readFileSync(path, "utf8")
      expect(source, path).toContain("MTM_TAB_ROW")
      expect(source, path).toContain("mtmTabClass(")
      expect(source, path).not.toMatch(/from "@\/components\/ui\/badge"/)
    }
  })

  it("draw «Kömək» as the CRM's own help button, class for class", async () => {
    const { DEMO_HELP_BUTTON_CLASSES } = await import("@/components/demo-center/journey/scenes/demo-help-button")
    const product = readFileSync("src/components/help/help-button.tsx", "utf8")
    expect(product).toContain(DEMO_HELP_BUTTON_CLASSES.label)
    expect(product).toContain(DEMO_HELP_BUTTON_CLASSES.icon)
  })
})
