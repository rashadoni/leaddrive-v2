import { describe, expect, it } from "vitest"
import { hasMtmCoordinates, normalizeMtmCoordinates, withNormalizedCoordinates } from "@/lib/mtm/geo-coordinates"

describe("normalizeMtmCoordinates", () => {
  it("keeps a real pair untouched", () => {
    expect(normalizeMtmCoordinates({ latitude: 40.4093, longitude: 49.8671 })).toEqual({ latitude: 40.4093, longitude: 49.8671 })
  })

  it("treats Null Island (0, 0) as unknown", () => {
    // Field UX audit 2026-09-05 M-02: 0,0 rendered as "6745.7 km" from Baku.
    expect(normalizeMtmCoordinates({ latitude: 0, longitude: 0 })).toEqual({ latitude: null, longitude: null })
  })

  it("keeps a legitimate zero on one axis", () => {
    expect(normalizeMtmCoordinates({ latitude: 0, longitude: 49.8 })).toEqual({ latitude: 0, longitude: 49.8 })
    expect(normalizeMtmCoordinates({ latitude: 40.4, longitude: 0 })).toEqual({ latitude: 40.4, longitude: 0 })
  })

  it.each([
    ["latitude missing", { longitude: 49.8 }],
    ["longitude null", { latitude: 40.4, longitude: null }],
    ["both null", { latitude: null, longitude: null }],
    ["NaN", { latitude: Number.NaN, longitude: 49.8 }],
    ["out of range", { latitude: 91, longitude: 49.8 }],
    ["longitude out of range", { latitude: 40.4, longitude: 181 }],
    ["no input", null],
    ["undefined input", undefined],
  ])("returns null on both axes when the pair is unusable: %s", (_label, input) => {
    expect(normalizeMtmCoordinates(input as never)).toEqual({ latitude: null, longitude: null })
  })
})

describe("hasMtmCoordinates", () => {
  it("narrows only usable pairs", () => {
    expect(hasMtmCoordinates({ latitude: 40.4, longitude: 49.8 })).toBe(true)
    expect(hasMtmCoordinates({ latitude: 0, longitude: 0 })).toBe(false)
    expect(hasMtmCoordinates({ latitude: null, longitude: null })).toBe(false)
    expect(hasMtmCoordinates(undefined)).toBe(false)
  })
})

describe("withNormalizedCoordinates", () => {
  it("rewrites only the coordinate pair of a row", () => {
    const row = { id: "c-1", name: "Store", latitude: 0, longitude: 0, city: "Baku" }
    expect(withNormalizedCoordinates(row)).toEqual({ id: "c-1", name: "Store", latitude: null, longitude: null, city: "Baku" })
    expect(row.latitude).toBe(0)
  })
})
