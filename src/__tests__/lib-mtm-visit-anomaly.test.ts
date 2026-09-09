import { describe, it, expect } from "vitest"
import {
  checkGpsVsCustomer,
  VISIT_ANOMALY_GPS_THRESHOLD_M,
} from "@/lib/mtm/visit-anomaly"

// Baku center / Yasamal pair: ~4.2 km apart — well outside the 100m
// threshold but within reasonable test latitude.
const BAKU_CENTER = { lat: 40.4093, lng: 49.8671 }
// ~50 m N of Baku center (Δlat = 50 / 111_113 ≈ 0.00045)
const NEAR_BAKU = { lat: 40.4093 + 0.00045, lng: 49.8671 }
// ~150 m N — definitely outside 100m
const FAR_BAKU = { lat: 40.4093 + 0.00135, lng: 49.8671 }

describe("checkGpsVsCustomer (M3-5a)", () => {
  it("default threshold = 100 m (≥ M1-2 tampering tolerance ×2)", () => {
    expect(VISIT_ANOMALY_GPS_THRESHOLD_M).toBe(100)
  })

  it("within radius (≤50 m) → isAnomaly=false, distance reported", () => {
    const r = checkGpsVsCustomer({
      photoLatitude: NEAR_BAKU.lat,
      photoLongitude: NEAR_BAKU.lng,
      customerLatitude: BAKU_CENTER.lat,
      customerLongitude: BAKU_CENTER.lng,
    })
    expect(r.isAnomaly).toBe(false)
    expect(r.distanceMeters).toBeGreaterThan(40)
    expect(r.distanceMeters).toBeLessThan(60)
  })

  it("outside radius (~150 m) → isAnomaly=true, distance reported", () => {
    const r = checkGpsVsCustomer({
      photoLatitude: FAR_BAKU.lat,
      photoLongitude: FAR_BAKU.lng,
      customerLatitude: BAKU_CENTER.lat,
      customerLongitude: BAKU_CENTER.lng,
    })
    expect(r.isAnomaly).toBe(true)
    expect(r.distanceMeters).toBeGreaterThan(100)
  })

  it("distance just under threshold (~99 m) → NOT anomaly (strict >)", () => {
    // 99 m N: ∆lat = 99 / 111_113 ≈ 0.000891
    const just_under = { lat: BAKU_CENTER.lat + 0.000891, lng: BAKU_CENTER.lng }
    const r = checkGpsVsCustomer({
      photoLatitude: just_under.lat,
      photoLongitude: just_under.lng,
      customerLatitude: BAKU_CENTER.lat,
      customerLongitude: BAKU_CENTER.lng,
    })
    expect(r.distanceMeters).toBeGreaterThan(97)
    expect(r.distanceMeters).toBeLessThanOrEqual(100)
    expect(r.isAnomaly).toBe(false)
  })

  it("distance just over threshold (~101 m) → IS anomaly", () => {
    // 101 m N: ∆lat = 101 / 111_113 ≈ 0.000909
    const just_over = { lat: BAKU_CENTER.lat + 0.000909, lng: BAKU_CENTER.lng }
    const r = checkGpsVsCustomer({
      photoLatitude: just_over.lat,
      photoLongitude: just_over.lng,
      customerLatitude: BAKU_CENTER.lat,
      customerLongitude: BAKU_CENTER.lng,
    })
    expect(r.distanceMeters).toBeGreaterThan(100)
    expect(r.isAnomaly).toBe(true)
  })

  it("missing photo GPS → isAnomaly=false, distance=null (can't compare)", () => {
    const r = checkGpsVsCustomer({
      photoLatitude: null,
      photoLongitude: null,
      customerLatitude: BAKU_CENTER.lat,
      customerLongitude: BAKU_CENTER.lng,
    })
    expect(r.isAnomaly).toBe(false)
    expect(r.distanceMeters).toBeNull()
  })

  it("missing customer GPS → isAnomaly=false, distance=null", () => {
    const r = checkGpsVsCustomer({
      photoLatitude: BAKU_CENTER.lat,
      photoLongitude: BAKU_CENTER.lng,
      customerLatitude: null,
      customerLongitude: null,
    })
    expect(r.isAnomaly).toBe(false)
    expect(r.distanceMeters).toBeNull()
  })

  it("partial GPS pair (lat only, no lng) treated as missing", () => {
    const r = checkGpsVsCustomer({
      photoLatitude: BAKU_CENTER.lat,
      photoLongitude: null,
      customerLatitude: BAKU_CENTER.lat,
      customerLongitude: BAKU_CENTER.lng,
    })
    expect(r.distanceMeters).toBeNull()
    expect(r.isAnomaly).toBe(false)
  })

  it("custom threshold honored — 30m setting catches the 50m case", () => {
    const r = checkGpsVsCustomer({
      photoLatitude: NEAR_BAKU.lat,
      photoLongitude: NEAR_BAKU.lng,
      customerLatitude: BAKU_CENTER.lat,
      customerLongitude: BAKU_CENTER.lng,
      maxDistanceMeters: 30,
    })
    expect(r.isAnomaly).toBe(true)
  })
})
