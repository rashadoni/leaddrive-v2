import { describe, it, expect } from "vitest"
import { normalize, levenshtein, similarityRatio, phoneDigits } from "@/lib/ai/duplicates"

describe("ai/duplicates — pure helpers", () => {
  describe("normalize", () => {
    it("lowercases + trims + collapses whitespace", () => {
      expect(normalize("  Hello   WORLD  ")).toBe("hello world")
    })
    it("returns empty string for null/undefined", () => {
      expect(normalize(null)).toBe("")
      expect(normalize(undefined)).toBe("")
    })
  })

  describe("phoneDigits", () => {
    it("strips non-digit characters", () => {
      expect(phoneDigits("+1 (415) 555-0123")).toBe("14155550123")
      expect(phoneDigits("+994 50-123-45-67")).toBe("994501234567")
    })
    it("handles null/undefined", () => {
      expect(phoneDigits(null)).toBe("")
      expect(phoneDigits(undefined)).toBe("")
    })
  })

  describe("levenshtein", () => {
    it("returns 0 for identical strings", () => {
      expect(levenshtein("abc", "abc")).toBe(0)
    })
    it("returns length of non-empty string when the other is empty", () => {
      expect(levenshtein("", "hello")).toBe(5)
      expect(levenshtein("world", "")).toBe(5)
    })
    it("computes small edit distances correctly", () => {
      expect(levenshtein("kitten", "sitting")).toBe(3)
      expect(levenshtein("saturday", "sunday")).toBe(3)
    })
  })

  describe("similarityRatio", () => {
    it("returns 1.0 for identical normalized strings", () => {
      expect(similarityRatio("ACME Corp", "acme corp")).toBe(1)
    })
    it("returns 0 for both-empty inputs", () => {
      expect(similarityRatio("", "")).toBe(0)
    })
    it("correctly identifies near-duplicates", () => {
      // 'John Smith' vs 'Jon Smith' — 1 edit out of 10 chars → 0.9
      const r = similarityRatio("John Smith", "Jon Smith")
      expect(r).toBeGreaterThanOrEqual(0.88)
      expect(r).toBeLessThan(1)
    })
    it("returns low similarity for unrelated strings", () => {
      expect(similarityRatio("Alice", "Bob")).toBeLessThan(0.5)
    })
  })
})
