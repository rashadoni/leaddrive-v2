import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { formatMtmDistance, mtmVisitGeofenceState } from "@/lib/mtm/visit-geofence-state"

const STORE = { customerLatitude: 40.4093, customerLongitude: 49.8671 }

describe("mtmVisitGeofenceState (prod audit 2026-09-14: «Təsdiqlənib» on every visit)", () => {
  it("reports OUTSIDE for a check-in 7.8 km from the pin, with the distance", () => {
    const result = mtmVisitGeofenceState({
      ...STORE,
      checkInLat: 40.4793,
      checkInLng: 49.8671,
      defaultGeofenceRadius: 100,
    })
    expect(result.state).toBe("OUTSIDE")
    expect(result.radiusMeters).toBe(100)
    expect(result.checkInDistanceMeters).toBeGreaterThan(7_700)
    expect(result.checkInDistanceMeters).toBeLessThan(7_900)
    expect(result.checkOutDistanceMeters).toBeNull()
    expect(result.distanceMeters).toBe(result.checkInDistanceMeters)
  })

  it("reports INSIDE only when every recorded coordinate is within the radius", () => {
    const inside = mtmVisitGeofenceState({
      ...STORE,
      checkInLat: 40.4094,
      checkInLng: 49.8672,
      checkOutLat: 40.4095,
      checkOutLng: 49.8671,
      defaultGeofenceRadius: 100,
    })
    expect(inside.state).toBe("INSIDE")

    // Checked in at the door, checked out from across town.
    const leftEarly = mtmVisitGeofenceState({
      ...STORE,
      checkInLat: 40.4094,
      checkInLng: 49.8672,
      checkOutLat: 40.5263,
      checkOutLng: 49.8671,
      defaultGeofenceRadius: 100,
    })
    expect(leftEarly.state).toBe("OUTSIDE")
    expect(leftEarly.distanceMeters).toBe(leftEarly.checkOutDistanceMeters)
  })

  it("prefers the customer's own radius over the organization default", () => {
    const result = mtmVisitGeofenceState({
      ...STORE,
      checkInLat: 40.4113,
      checkInLng: 49.8671,
      customerGeofenceRadius: 500,
      defaultGeofenceRadius: 100,
    })
    expect(result.radiusMeters).toBe(500)
    expect(result.state).toBe("INSIDE")
  })

  it("never claims either answer when there is nothing to measure", () => {
    expect(mtmVisitGeofenceState({ ...STORE, defaultGeofenceRadius: 100 }).state).toBe("NO_VISIT_GPS")
    expect(mtmVisitGeofenceState({
      customerLatitude: null,
      customerLongitude: null,
      checkInLat: 40.4,
      checkInLng: 49.8,
      defaultGeofenceRadius: 100,
    }).state).toBe("NO_CUSTOMER_COORDINATES")
    // (0, 0) is "unknown", not a place in the Gulf of Guinea.
    expect(mtmVisitGeofenceState({
      customerLatitude: 0,
      customerLongitude: 0,
      checkInLat: 40.4,
      checkInLng: 49.8,
      defaultGeofenceRadius: 100,
    }).state).toBe("NO_CUSTOMER_COORDINATES")
    expect(mtmVisitGeofenceState({ ...STORE, checkInLat: 0, checkInLng: 0, defaultGeofenceRadius: 100 }).state).toBe("NO_VISIT_GPS")
  })

  it("formats distances in the reader's number format", () => {
    expect(formatMtmDistance(7_734, "en")).toBe("7.7 km")
    expect(formatMtmDistance(7_734, "az")).toMatch(/^7[.,]7 km$/)
    expect(formatMtmDistance(449.6, "en")).toBe("450 m")
    // Units come from translations: Russian reads Cyrillic units.
    const ru = JSON.parse(readFileSync("messages/ru.json", "utf8")).mtmMap.distanceUnits
    const label = (unit: "m" | "km", value: string) => ru[unit].replace("{value}", value)
    expect(formatMtmDistance(7_734, "ru", label)).toMatch(/^7,7\s?км$/)
    expect(formatMtmDistance(450, "ru", label)).toBe("450 м")
  })
})
