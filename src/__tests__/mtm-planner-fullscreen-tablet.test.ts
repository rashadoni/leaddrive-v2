import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

/**
 * Field UX audit 2026-09-05, first item of the C15 tail: "полноэкранный лист
 * планировщика ниже 900 px".
 *
 * At the tablet width the audit measured — 834 — the route planner opened as a
 * floating card with an inset around it, where a sheet was needed. The reason
 * was one letter: the dialog switched to full screen below `md`, which is 768,
 * so 834 fell on the dialog side of the line by 66 px.
 *
 * The number 900 is not decoration: it is the width the plan wrote down, and
 * it has to be one number in three places, or the surface will be full screen
 * while its own content still reserves a 2rem inset.
 */
const dialog = readFileSync("src/components/ui/dialog.tsx", "utf8")
const routesPage = readFileSync("src/app/(dashboard)/mtm/routes/page.tsx", "utf8")
const builder = readFileSync("src/components/mtm/route-builder.tsx", "utf8")

describe("C15: the planner takes the screen below 900 px", () => {
  it("gives the dialog a breakpoint that exists for this measurement", () => {
    expect(dialog).toContain('mobileFullscreenBreakpoint?: "sm" | "md" | "tablet"')
    expect(dialog).toContain('"items-stretch p-0 min-[900px]:items-center min-[900px]:p-4"')
    expect(dialog).toContain('"rounded-none min-[900px]:rounded-lg"')
  })

  it("keeps the other two breakpoints working", () => {
    // Every other dialog in the product still asks for sm or md.
    expect(dialog).toContain('"items-stretch p-0 md:items-center md:p-4"')
    expect(dialog).toContain('"items-stretch p-0 sm:items-center sm:p-4"')
  })

  it("asks for it on the planner", () => {
    expect(routesPage).toContain('mobileFullscreenBreakpoint="tablet"')
  })

  it("moves the height cap with it, in both places that hold one", () => {
    // A full-screen surface whose content still reserves calc(100dvh-2rem)
    // puts the step-3 footer back under the fold — the next item of the same
    // tail.
    expect(routesPage).toContain('maxHeightClassName="max-h-dvh min-[900px]:max-h-[min(52rem,calc(100dvh-2rem))]"')
    expect(builder).toContain('min-[900px]:max-h-[min(52rem,calc(100dvh-2rem))]')
    expect(builder).not.toContain('md:max-h-[min(52rem,calc(100dvh-2rem))]')
  })
})
