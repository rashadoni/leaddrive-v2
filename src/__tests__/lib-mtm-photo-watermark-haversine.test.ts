import { describe, it, expect } from "vitest"
import { haversineMeters } from "@/lib/mtm/photo-watermark"

describe("haversineMeters", () => {
  it("returns 0 for identical points", () => {
    const baku = { latitude: 40.4093, longitude: 49.8671 }
    expect(haversineMeters(baku, baku)).toBe(0)
  })

  it("returns ≈111 m for 0.001 latitude delta (1 deg ≈ 111.13 km)", () => {
    const a = { latitude: 40.0, longitude: 49.0 }
    const b = { latitude: 40.001, longitude: 49.0 }
    const distance = haversineMeters(a, b)
    expect(distance).toBeGreaterThan(110)
    expect(distance).toBeLessThan(112)
  })

  it("returns ≈50 m for points exactly 50 m apart (anti-tampering threshold pass)", () => {
    // 50 m N at this latitude: ∆lat = 50 / 111_113 ≈ 0.000450 deg
    const a = { latitude: 40.4093, longitude: 49.8671 }
    const b = { latitude: 40.4093 + 0.00045, longitude: 49.8671 }
    const distance = haversineMeters(a, b)
    // Haversine on sub-100m distances is deterministic to ~0.1m; this
    // tight band catches off-by-radius / unit-confusion bugs.
    expect(distance).toBeGreaterThan(49)
    expect(distance).toBeLessThan(51)
  })

  it("returns >50 m for points 100 m apart (anti-tampering threshold fail)", () => {
    const a = { latitude: 40.4093, longitude: 49.8671 }
    const b = { latitude: 40.4093 + 0.0009, longitude: 49.8671 } // ~100 m N
    expect(haversineMeters(a, b)).toBeGreaterThan(50)
  })
})
