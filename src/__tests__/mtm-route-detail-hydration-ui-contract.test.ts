import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

function source(path: string): string {
  return readFileSync(path, "utf8")
}

function routeMessages(locale: "az" | "en" | "ru"): Record<string, string> {
  return JSON.parse(source(`messages/${locale}.json`)).mtmRoutesPage
}

describe("MTM route detail hydration UI contract", () => {
  const routesPage = source("src/app/(dashboard)/mtm/routes/page.tsx")
  const routeMap = source("src/components/mtm/route-map.tsx")

  it("hydrates an opened route through the scoped detail endpoint without widening list data", () => {
    expect(routesPage).toContain("async function hydrateRouteDetail")
    expect(routesPage).toContain('fetch(`/api/v1/mtm/routes/${encodeURIComponent(route.id)}`')
    expect(routesPage).toContain('headers: orgId ? { "x-organization-id": String(orgId) } : {}')
    expect(routesPage).toContain("signal: controller.signal")
    expect(routesPage).toContain("routeDetailRequestRef.current.controller?.abort()")
    expect(routesPage).toContain("setRoutes((current) => current.map((item) => item.id === detail.id ? detail : item))")
    expect(routesPage).toContain("setSelectedRoute((current) => current?.id === detail.id ? detail : current)")
  })

  it("keeps the existing detail surface usable while enrichment loads or fails", () => {
    expect(routesPage).toContain("setSelectedRoute(route)")
    expect(routesPage).toContain("void hydrateRouteDetail(route)")
    expect(routesPage).toContain('aria-busy={routeDetailLoading}')
    expect(routesPage).toContain("Opening a route must not depend on a map.")
  })

  it("decides stop coordinates through the shared guard, which keeps a zero on one axis", () => {
    // Field UX audit A1: the map filters with hasMtmCoordinates(), whose tests
    // prove that (0, 49.8) is a location while (0, 0) and null are not; the
    // route card shows the map (with its own empty state) for any route that
    // has stops instead of hiding it when no stop has coordinates.
    expect(routesPage).toContain("{selectedRoutePoints.length > 0 && (")
    expect(routeMap).toContain("hasMtmCoordinates(point.customer)")
    expect(routeMap).not.toContain("p.customer?.latitude && p.customer?.longitude")
  })

  it("keeps the existing map semantically navigable and localizes every visible map fact", () => {
    expect(routeMap).toContain('useTranslations("mtmRoutesPage")')
    expect(routeMap).toContain("useLocale()")
    expect(routeMap).toContain('aria-label={t("routeMapLabel")}')
    expect(routeMap).toContain('<ol className="sr-only" aria-label={t("routeMapStopsLabel")}>')
    expect(routeMap).toContain('html: `<div aria-hidden="true" style="')
    expect(routeMap).toContain("keyboard")
    expect(routeMap).toContain("alt={details.accessibleLabel}")
    expect(routeMap).toContain("title={details.accessibleLabel}")
    expect(routeMap).not.toContain("Loading map...")
    expect(routeMap).not.toContain("Status: {point.status}")
    expect(routeMap).not.toContain("Visited: {new Date(point.visitedAt)")

    const requiredKeys = [
      "routeMapLabel",
      "routeMapStopsLabel",
      "routeMapStopLabel",
      "routeMapStatusLabel",
      "routeMapVisitedAt",
      "routeMapUnnamedStop",
      "routeMapLoading",
    ]
    for (const locale of ["az", "en", "ru"] as const) {
      const messages = routeMessages(locale)
      for (const key of requiredKeys) expect(messages[key]).toEqual(expect.any(String))
      expect(messages.routeMapStopLabel).toContain("{number}")
      expect(messages.routeMapStopLabel).toContain("{name}")
      expect(messages.routeMapStatusLabel).toContain("{status}")
      expect(messages.routeMapVisitedAt).toContain("{time}")
    }
  })

  it("keeps the hard-coded Advisor label off the route detail", () => {
    // This started as "replace the English title="Advisor risk" with the
    // localised widget". The owner then decided the block does not belong on
    // this surface at all (RUX-604, plan task C10), which answers the original
    // complaint more completely than a translation would: there is no label to
    // read in the wrong language because there is no block.
    //
    // The half that still guards something stays. The widget itself is now
    // asserted ABSENT here and in mtm-route-card-ui-contract, so the decision
    // cannot be undone by accident.
    expect(routesPage).not.toContain('title="Advisor risk"')
    expect(routesPage).not.toContain("AdvisorRecordWidget")
  })

  it("preserves readable route and stop status contrast in the existing dark theme", () => {
    expect(routesPage).toContain('dark:bg-blue-950/40 dark:text-blue-300')
    expect(routesPage).toContain('dark:bg-green-950/40 dark:text-green-300')
    expect(routesPage).toContain('dark:bg-red-950/40 dark:text-red-300')
    expect(routesPage).toContain('dark:bg-green-950/20 dark:text-green-300')
    expect(routesPage).toContain('dark:bg-red-950/20 dark:text-red-300')
  })

  it("formats route-detail visit times in the selected application locale", () => {
    expect(routesPage).toContain('formatTime(new Date(p.visitedAt), locale)')
    expect(routesPage).not.toContain('toLocaleTimeString(')
  })
})
