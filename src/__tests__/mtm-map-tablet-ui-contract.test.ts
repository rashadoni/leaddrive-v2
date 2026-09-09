import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

/** Field UX audit 2026-09-05, task C15 (tablet, 834 px). */
describe("MTM map page on a tablet", () => {
  const page = readFileSync("src/app/(dashboard)/mtm/map/page.tsx", "utf8")

  it("puts the map above the filters on narrow screens", () => {
    // Two rows of filters and status chips came first, so the manager opened
    // the map page and saw no map without scrolling.
    expect(page).toContain('data-testid="mtm-map-canvas"')
    expect(page).toContain("max-lg:order-first")
  })

  it("keeps the desktop order untouched", () => {
    // The reorder is scoped to max-lg on purpose: on a wide screen the filter
    // strip above the map is where people already look for it.
    expect(page).not.toContain("order-first lg:order-first")
    expect(page).toContain("flex flex-col gap-3")
  })
})
