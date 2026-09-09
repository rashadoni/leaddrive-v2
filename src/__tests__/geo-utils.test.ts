import { describe, it, expect } from "vitest"
import { calculateDistance, formatDistance } from "@/lib/geo-utils"

describe("calculateDistance (Haversine)", () => {
  it("returns 0 for identical coordinates", () => {
    expect(calculateDistance(40.4093, 49.8671, 40.4093, 49.8671)).toBe(0)
  })

  it("calculates ~111km for 1 degree latitude difference", () => {
    const dist = calculateDistance(0, 0, 1, 0)
    expect(dist).toBeGreaterThan(110_000)
    expect(dist).toBeLessThan(112_000)
  })

  it("calculates ~111km for 1 degree longitude difference at equator", () => {
    const dist = calculateDistance(0, 0, 0, 1)
    expect(dist).toBeGreaterThan(110_000)
    expect(dist).toBeLessThan(112_000)
  })

  it("calculates known distance between two Baku points (~950m)", () => {
    // Fountain Square to Nizami Street area (~950m apart)
    const dist = calculateDistance(40.3777, 49.8920, 40.3692, 49.8346)
    expect(dist).toBeGreaterThan(4_000)
    expect(dist).toBeLessThan(6_000)
  })

  it("is commutative (A→B == B→A)", () => {
    const d1 = calculateDistance(40.4093, 49.8671, 40.4200, 49.8800)
    const d2 = calculateDistance(40.4200, 49.8800, 40.4093, 49.8671)
    expect(Math.abs(d1 - d2)).toBeLessThan(0.001)
  })

  it("handles negative coordinates (southern/western hemisphere)", () => {
    const dist = calculateDistance(-33.8688, 151.2093, -33.8651, 151.2099)
    expect(dist).toBeGreaterThan(0)
    expect(dist).toBeLessThan(1000)
  })

  it("returns meters, not kilometers", () => {
    // Two points ~100m apart
    const dist = calculateDistance(40.4093, 49.8671, 40.4102, 49.8671)
    expect(dist).toBeGreaterThan(50)
    expect(dist).toBeLessThan(200)
  })

  it("detects within 100m geofence correctly", () => {
    // ~50m apart
    const close = calculateDistance(40.4093, 49.8671, 40.40975, 49.8671)
    expect(close).toBeLessThan(100)
  })

  it("detects outside 100m geofence correctly", () => {
    // ~500m apart
    const far = calculateDistance(40.4093, 49.8671, 40.4138, 49.8671)
    expect(far).toBeGreaterThan(100)
  })
})

describe("formatDistance", () => {
  it("formats meters under 1000 as 'Xm'", () => {
    expect(formatDistance(0)).toBe("0m")
    expect(formatDistance(50)).toBe("50m")
    expect(formatDistance(99)).toBe("99m")
    expect(formatDistance(999)).toBe("999m")
  })

  it("formats 1000m and above as 'X.Xkm'", () => {
    expect(formatDistance(1000)).toBe("1.0km")
    expect(formatDistance(1500)).toBe("1.5km")
    expect(formatDistance(10000)).toBe("10.0km")
  })

  it("rounds sub-kilometer values", () => {
    expect(formatDistance(99.6)).toBe("100m")
    expect(formatDistance(49.4)).toBe("49m")
  })
})
