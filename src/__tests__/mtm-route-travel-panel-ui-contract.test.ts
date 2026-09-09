import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

function source(path: string): string {
  return readFileSync(path, "utf8")
}

describe("MTM route travel panel UI contract", () => {
  const panel = source("src/components/mtm/route-travel-panel.tsx")
  const routesPage = source("src/app/(dashboard)/mtm/routes/page.tsx")
  const routeMap = source("src/components/mtm/route-map.tsx")

  it("adds travel beside the existing detail map and never replaces it", () => {
    expect(routesPage).toContain('import { MtmRouteTravelPanel } from "@/components/mtm/route-travel-panel"')
    expect(routesPage).toContain("<MtmRouteMap points={selectedRoutePoints} />")
    expect(routesPage).toContain("<MtmRouteTravelPanel")
    expect(routeMap).not.toContain("Google")
  })

  it("makes the paid estimate explicit, version-bound, and transient in the browser", () => {
    expect(panel).toContain('method: "POST"')
    expect(panel).toContain('"idempotency-key": createIdempotencyKey()')
    expect(panel).toContain("expectedVersion: route.version")
    expect(panel).toContain("sourceFingerprint")
    expect(panel).toContain("data?.transient !== true")
    expect(panel).toContain("requestRef.current?.abort()")
    expect(panel).not.toContain("localStorage")
    expect(panel).not.toContain("sessionStorage")
    expect(panel).not.toContain("indexedDB")
  })

  it("explains idempotency recovery instead of collapsing it into a generic provider error", () => {
    expect(panel).toContain('"MTM_ROUTE_TRAVEL_IDEMPOTENCY_REQUIRED"')
    expect(panel).toContain('"MTM_ROUTE_TRAVEL_IDEMPOTENCY_MISMATCH"')
    expect(panel).toContain('t("routeTravelIdempotencyRequired")')
    expect(panel).toContain('t("routeTravelIdempotencyMismatch")')
  })

  it("keeps Google content on an explicit separate iframe surface and announces state", () => {
    expect(panel).toContain("onClick={() => setGoogleMapOpen(true)}")
    expect(panel).toContain("<iframe")
    expect(panel).toContain('referrerPolicy="strict-origin-when-cross-origin"')
    expect(panel).toContain('aria-live="polite"')
    expect(panel).toContain('target="_blank"')
    expect(panel).toContain('rel="noreferrer"')
    expect(panel).toContain('className="min-h-11"')
  })
})
