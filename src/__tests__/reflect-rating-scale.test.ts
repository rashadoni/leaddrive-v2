import { describe, it, expect } from "vitest"
import { toFiveStar } from "@/lib/surveys/reflect-rating"

describe("toFiveStar — scale survey score to the ticket's 1-5 star widget", () => {
  it("NPS (0-10) scales to 1-5", () => {
    expect(toFiveStar("nps", 0)).toBe(1)   // clamped up (no 0-star)
    expect(toFiveStar("nps", 6)).toBe(3)   // the real-world case: 6/10 → 3 stars, not a false 5/5
    expect(toFiveStar("nps", 8)).toBe(4)
    expect(toFiveStar("nps", 10)).toBe(5)
  })
  it("CES (1-7) scales to 1-5", () => {
    expect(toFiveStar("ces", 1)).toBe(1)
    expect(toFiveStar("ces", 7)).toBe(5)
    expect(toFiveStar("ces", 4)).toBe(3)
  })
  it("CSAT / rating (already 1-5) passes through, clamped", () => {
    expect(toFiveStar("csat", 4)).toBe(4)
    expect(toFiveStar("csat", 5)).toBe(5)
    expect(toFiveStar("rating", 3)).toBe(3)
    expect(toFiveStar("csat", 0)).toBe(1)  // safety clamp
    expect(toFiveStar("csat", 9)).toBe(5)  // safety clamp
  })
})
