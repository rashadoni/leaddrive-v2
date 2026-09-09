import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

function source(path: string): string {
  return readFileSync(path, "utf8")
}

function messages(locale: string): Record<string, Record<string, string>> {
  return JSON.parse(source(`messages/${locale}.json`))
}

describe("MTM route map coordinates UI contract (field UX audit A1 / W-09)", () => {
  it("never places a stop without coordinates on the map", () => {
    const map = source("src/components/mtm/route-map.tsx")

    expect(map).toContain('import { hasMtmCoordinates } from "@/lib/mtm/geo-coordinates"')
    expect(map).toContain(".filter((point) => hasMtmCoordinates(point.customer))")
    expect(map).not.toContain("defaultCenter")
  })

  it("explains an all-unknown route instead of rendering nothing", () => {
    const map = source("src/components/mtm/route-map.tsx")

    expect(map).toContain('data-testid="mtm-route-map-empty"')
    expect(map).toContain('t("routeMapNoCoordinates")')
    expect(map).toContain('data-testid="mtm-route-map-missing"')
    expect(map).toContain('t("routeMapMissingCoordinates", { count: missingCount })')
  })

  it("lets the map own its empty state on the route card", () => {
    const page = source("src/app/(dashboard)/mtm/routes/page.tsx")

    expect(page).not.toContain("hasRouteMapPoints")
    expect(page).toContain("{selectedRoutePoints.length > 0 && (")
  })

  it("ships the empty-state copy in all three languages", () => {
    for (const locale of ["az", "ru", "en"]) {
      const page = messages(locale).mtmRoutesPage
      expect(page.routeMapNoCoordinates, locale).toBeTruthy()
      expect(page.routeMapMissingCoordinates, locale).toContain("{count, plural,")
    }
    expect(messages("ru").mtmRoutesPage.routeMapMissingCoordinates).toMatch(/one \{.*few \{.*many \{.*other \{/)
  })
})
