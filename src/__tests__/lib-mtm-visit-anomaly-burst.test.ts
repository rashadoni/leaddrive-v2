/**
 * M3-5b — Unit tests for checkBurstUpload pure function.
 *
 * Spec: >5 photos from the same agent within 30 seconds is a burst (anti-fraud).
 */
import { describe, it, expect } from "vitest"
import { checkBurstUpload } from "@/lib/mtm/visit-anomaly"

describe("checkBurstUpload (M3-5b)", () => {
  it("returns isBurst=false when count ≤ 5 (exactly at threshold, not exceeded)", () => {
    const result = checkBurstUpload({ count: 5 })
    expect(result.isBurst).toBe(false)
    expect(result.count).toBe(5)
  })

  it("returns isBurst=true when count > 5", () => {
    const result = checkBurstUpload({ count: 6 })
    expect(result.isBurst).toBe(true)
    expect(result.count).toBe(6)
  })

  it("returns isBurst=false for 0 photos", () => {
    expect(checkBurstUpload({ count: 0 }).isBurst).toBe(false)
  })

  it("returns isBurst=false for 1 photo", () => {
    expect(checkBurstUpload({ count: 1 }).isBurst).toBe(false)
  })

  it("returns isBurst=true for large burst (50 photos)", () => {
    expect(checkBurstUpload({ count: 50 }).isBurst).toBe(true)
  })

  it("respects custom maxPhotos threshold (maxPhotos=2)", () => {
    expect(checkBurstUpload({ count: 2, maxPhotos: 2 }).isBurst).toBe(false)
    expect(checkBurstUpload({ count: 3, maxPhotos: 2 }).isBurst).toBe(true)
  })
})
