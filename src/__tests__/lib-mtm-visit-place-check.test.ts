import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import * as placeModule from "@/lib/mtm/visit-place-check"
import * as reviewModule from "@/lib/mtm/visit-review"
import {
  VISIT_PLACE_VERDICT_MESSAGE_KEYS,
  effectiveGeofenceRadius,
  formatMtmDistance,
  placeCheck,
  visitPlaceSummary,
  type VisitPlaceVerdict,
} from "@/lib/mtm/visit-place-check"

/**
 * One "was the visit recorded at the customer?" rule for every web page
 * (2026-09-14: #203 and #205 answered it differently, so a visit read «Zonada»
 * on the route and a warning on the review).
 */

// Store pin in Baku; 0.001° of latitude is ~111 m.
const STORE = { latitude: 40.4093, longitude: 49.8671 }
const AT_DOOR = { lat: 40.4094, lng: 49.8671 }
const ACROSS_TOWN = { lat: 40.4793, lng: 49.8671 } // ~7.8 km

function visit(overrides: Partial<Parameters<typeof visitPlaceSummary>[0]> = {}) {
  return {
    status: "CHECKED_OUT",
    checkInLat: AT_DOOR.lat,
    checkInLng: AT_DOOR.lng,
    checkOutLat: AT_DOOR.lat,
    checkOutLng: AT_DOOR.lng,
    customer: { ...STORE, geofenceRadius: null },
    ...overrides,
  }
}

describe("the single place rule", () => {
  it("inside: check-in and check-out at the door", () => {
    const summary = visitPlaceSummary(visit(), 100)
    expect(summary.verdict).toBe("at_point")
    expect(summary.checkIn.state).toBe("at_point")
    expect(summary.checkOut?.state).toBe("at_point")
    expect(summary.distanceMeters).toBe(11)
  })

  it("outside: a check-in 7.8 km away, with the distance", () => {
    const summary = visitPlaceSummary(visit({ checkInLat: ACROSS_TOWN.lat, checkInLng: ACROSS_TOWN.lng }), 100)
    expect(summary.verdict).toBe("outside")
    expect(summary.distanceMeters).toBeGreaterThan(7_700)
    expect(summary.distanceMeters).toBeLessThan(7_900)
  })

  it("outside: checked in at the door, checked out from across town", () => {
    const summary = visitPlaceSummary(visit({ checkOutLat: ACROSS_TOWN.lat, checkOutLng: ACROSS_TOWN.lng }), 100)
    expect(summary.verdict).toBe("outside")
    expect(summary.distanceMeters).toBe(summary.checkOut?.distanceMeters)
  })

  it("no GPS: neither fix is usable", () => {
    const summary = visitPlaceSummary(visit({ checkInLat: null, checkInLng: null, checkOutLat: null, checkOutLng: null }), 100)
    expect(summary.verdict).toBe("no_gps")
    expect(summary.distanceMeters).toBeNull()
  })

  it("(0, 0) is unknown on either side, never a place in the Gulf of Guinea", () => {
    expect(visitPlaceSummary(visit({ checkInLat: 0, checkInLng: 0, checkOutLat: 0, checkOutLng: 0 }), 100).verdict).toBe("no_gps")
    expect(visitPlaceSummary(visit({ checkOutLat: 0, checkOutLng: 0 }), 100).verdict).toBe("checkout_gps_missing")
    expect(visitPlaceSummary(visit({ customer: { latitude: 0, longitude: 0 } }), 100).verdict).toBe("no_pin")
  })

  it("check-out GPS missing on a finished visit is a warning, not «in zone» (the #205 difference)", () => {
    const summary = visitPlaceSummary(visit({ checkOutLat: null, checkOutLng: null }), 100)
    expect(summary.verdict).toBe("checkout_gps_missing")
    expect(summary.distanceMeters).toBe(summary.checkIn.distanceMeters)
  })

  it("a check-out fix alone does not prove arrival (the #205 difference)", () => {
    expect(visitPlaceSummary(visit({ checkInLat: null, checkInLng: null }), 100).verdict).toBe("checkin_gps_missing")
  })

  it("an open visit is not asked for a check-out fix", () => {
    const summary = visitPlaceSummary(visit({ status: "CHECKED_IN", checkOutLat: null, checkOutLng: null }), 100)
    expect(summary.verdict).toBe("at_point")
    expect(summary.checkOut).toBeNull()
    expect(summary.checkOutSkipped).toBe("visit_open")
  })

  it("cancelled: the check-out is not measured, whatever it carries (the #205 difference)", () => {
    const summary = visitPlaceSummary(visit({ status: "CANCELLED", checkOutLat: ACROSS_TOWN.lat, checkOutLng: ACROSS_TOWN.lng }), 100)
    expect(summary.checkOut).toBeNull()
    expect(summary.checkOutSkipped).toBe("not_checked_out")
    expect(summary.verdict).toBe("at_point")
  })

  it("radius falls back customer → organization → 100 m", () => {
    expect(effectiveGeofenceRadius(500, 200)).toBe(500)
    expect(effectiveGeofenceRadius(null, 200)).toBe(200)
    expect(effectiveGeofenceRadius(0, undefined)).toBe(100)
    // ~222 m away: outside the default, inside a 250 m organization setting, inside a customer 300 m override.
    const far = visit({ checkInLat: 40.4113, checkOutLat: 40.4113 })
    expect(visitPlaceSummary(far).verdict).toBe("outside")
    expect(visitPlaceSummary(far, 250).radiusMeters).toBe(250)
    expect(visitPlaceSummary(far, 250).verdict).toBe("at_point")
    expect(visitPlaceSummary({ ...far, customer: { ...STORE, geofenceRadius: 300 } }, 100)).toMatchObject({ verdict: "at_point", radiusMeters: 300 })
  })

  it("a single fix is judged with the same boundary (distance equal to the radius is inside)", () => {
    const exact = placeCheck({ latitude: AT_DOOR.lat, longitude: AT_DOOR.lng }, STORE, 11)
    expect(exact).toEqual({ state: "at_point", distanceMeters: 11, radiusMeters: 11 })
    expect(placeCheck({ latitude: AT_DOOR.lat, longitude: AT_DOOR.lng }, STORE, 10).state).toBe("outside")
  })
})

describe("one label set for every page", () => {
  const verdicts: VisitPlaceVerdict[] = ["at_point", "outside", "checkout_gps_missing", "checkin_gps_missing", "no_gps", "no_pin"]

  it("has a message for every verdict in every locale, outside with its distance", () => {
    for (const locale of ["az", "ru", "en"]) {
      const messages = JSON.parse(readFileSync(`messages/${locale}.json`, "utf8")).mtmPlaceCheck
      for (const verdict of verdicts) {
        const text = messages[VISIT_PLACE_VERDICT_MESSAGE_KEYS[verdict]]
        expect(typeof text === "string" && text.trim().length > 0, `${locale}.${verdict}`).toBe(true)
      }
      expect(messages.outside).toContain("{distance}")
      expect(messages.distanceDetail).toContain("{distance}")
      expect(messages.distanceDetail).toContain("{radius}")
    }
  })

  it("the old per-page label sets are gone", () => {
    for (const locale of ["az", "ru", "en"]) {
      const messages = JSON.parse(readFileSync(`messages/${locale}.json`, "utf8"))
      expect(messages.mtmMap.history.geofence).toBeUndefined()
      expect(messages.mtmRoutesPage.stopFact.inZone).toBeUndefined()
      expect(messages.mtmRoutesPage.stopFact.outOfZone).toBeUndefined()
      expect(messages.mtmVisitsPage.gpsConfirmed).toBeUndefined()
      expect(messages.mtmVisitsPage.review.placeAtPoint).toBeUndefined()
    }
  })

  it("formats distances in the reader's number format with translated units", () => {
    expect(formatMtmDistance(7_734, "en")).toBe("7.7 km")
    expect(formatMtmDistance(449.6, "en")).toBe("450 m")
    const ru = JSON.parse(readFileSync("messages/ru.json", "utf8")).mtmMap.distanceUnits
    const label = (unit: "m" | "km", value: string) => ru[unit].replace("{value}", value)
    expect(formatMtmDistance(7_734, "ru", label)).toMatch(/^7,7\s?км$/)
  })
})

describe("nobody re-implements the rule", () => {
  it("visit-review re-exports the same functions", () => {
    expect(reviewModule.visitPlaceSummary).toBe(placeModule.visitPlaceSummary)
    expect(reviewModule.placeCheck).toBe(placeModule.placeCheck)
    expect(reviewModule.effectiveGeofenceRadius).toBe(placeModule.effectiveGeofenceRadius)
  })

  it("the #205 helper is deleted and imported nowhere", () => {
    expect(existsSync("src/lib/mtm/visit-geofence-state.ts")).toBe(false)
    const offenders: string[] = []
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name)
        if (statSync(path).isDirectory()) { walk(path); continue }
        if (!/\.(ts|tsx)$/.test(name) || path.endsWith("lib-mtm-visit-place-check.test.ts")) continue
        const source = readFileSync(path, "utf8")
        if (source.includes("visit-geofence-state") || source.includes("mtmVisitGeofenceState")) offenders.push(path)
      }
    }
    walk("src")
    expect(offenders).toEqual([])
  })

  it("the field pages judge a visit through visitPlaceSummary, not their own distance check", () => {
    const pages = {
      "src/components/mtm/location-history-panel.tsx": "visitPlaceSummary(visit, data.policy.geofenceRadiusMeters)",
      "src/app/(dashboard)/mtm/routes/page.tsx": "visitPlaceSummary({",
      "src/app/(dashboard)/mtm/visits/page.tsx": "visitPlaceSummary(visit, meta.geofenceRadius)",
      "src/app/(dashboard)/mtm/visits/visit-review-panel.tsx": "visitPlaceSummary({",
    }
    for (const [path, call] of Object.entries(pages)) {
      const source = readFileSync(path, "utf8")
      expect(source, path).toContain(call)
      expect(source, path).not.toMatch(/calculateDistance\(/)
      expect(source, path).not.toMatch(/distance\w*\s*<=\s*\w*radius/i)
    }
    const routeDetailApi = readFileSync("src/app/api/v1/mtm/routes/[id]/route.ts", "utf8")
    expect(routeDetailApi).toContain("effectiveGeofenceRadius(customer.geofenceRadius, settings.geofenceRadius)")
  })
})
