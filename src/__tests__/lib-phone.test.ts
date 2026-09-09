import { describe, it, expect } from "vitest"
import { normalizePhone } from "@/lib/phone"

describe("normalizePhone", () => {
  it("collapses formatting variants of one E.164 number to the same key", () => {
    const want = "+994501234567"
    expect(normalizePhone("+994 50 123-45-67")).toBe(want)
    expect(normalizePhone("+994 (50) 123 45 67")).toBe(want)
    expect(normalizePhone("+994501234567")).toBe(want)
  })

  it("keeps a single leading + and strips all non-digits", () => {
    expect(normalizePhone("994-50-1234567")).toBe("994501234567")
    expect(normalizePhone("tel:+994501234567")).toBe("+994501234567")
  })

  it("is null/empty safe", () => {
    expect(normalizePhone("")).toBe("")
    expect(normalizePhone(undefined as unknown as string)).toBe("")
  })
})
