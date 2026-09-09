import { describe, it, expect } from "vitest"
import { LINE_TYPES, isDecimalLineType, isValidLineQuantity } from "@/lib/cpq/line-types"

describe("cpq line types", () => {
  it("exposes the five types in order", () => {
    expect(LINE_TYPES).toEqual(["hardware", "license", "subscription", "service", "other"])
  })
  it("only service is decimal", () => {
    expect(isDecimalLineType("service")).toBe(true)
    for (const t of ["hardware", "license", "subscription", "other"]) {
      expect(isDecimalLineType(t)).toBe(false)
    }
  })
  it("treats null/undefined/unknown as integer (non-decimal)", () => {
    expect(isDecimalLineType(null)).toBe(false)
    expect(isDecimalLineType(undefined)).toBe(false)
    expect(isDecimalLineType("bogus")).toBe(false)
  })
})

describe("isValidLineQuantity (the route + UI rule)", () => {
  it("allows decimal > 0 for service", () => {
    expect(isValidLineQuantity("service", 2.5)).toBe(true)
    expect(isValidLineQuantity("service", "0.75")).toBe(true)
    expect(isValidLineQuantity("service", 3)).toBe(true)
  })
  it("rejects decimal, zero and empty-string for non-service", () => {
    for (const t of ["hardware", "license", "subscription", "other"]) {
      expect(isValidLineQuantity(t, 2.5)).toBe(false)
      expect(isValidLineQuantity(t, 0)).toBe(false)
      expect(isValidLineQuantity(t, "")).toBe(false)
    }
  })
  it("rejects zero / empty / non-finite even for service (no silent zero)", () => {
    expect(isValidLineQuantity("service", 0)).toBe(false)
    expect(isValidLineQuantity("service", "")).toBe(false)
    expect(isValidLineQuantity("service", "abc")).toBe(false)
  })
  it("accepts integers everywhere and undefined/null (defaults to 1)", () => {
    expect(isValidLineQuantity("hardware", 3)).toBe(true)
    expect(isValidLineQuantity("hardware", undefined)).toBe(true)
    expect(isValidLineQuantity("hardware", null)).toBe(true)
  })
})
