import { describe, expect, it } from "vitest"
import { typedPhone } from "@/components/ui/phone-input"

// Owner, 2026-11-19: «+» first, then digits only, and no more digits than a number has.
describe("typedPhone — the sign-in number as it is typed", () => {
  it("keeps «+» and digits only, whatever was typed or pasted", () => {
    expect(typedPhone("+994 (50) 123-45-67")).toBe("+994501234567")
    expect(typedPhone("abc+994x50")).toBe("+99450")
    expect(typedPhone("994501234567")).toBe("+994501234567")
  })

  it("stops an Azerbaijani number at nine digits after the code, others at 15", () => {
    expect(typedPhone("+9945012345678999")).toBe("+994501234567")
    expect(typedPhone("+4412345678901234567")).toBe("+441234567890123")
  })

  it("reads a leading 00 as «+» and leaves an empty field empty", () => {
    expect(typedPhone("00994501234567")).toBe("+994501234567")
    expect(typedPhone("+")).toBe("+")
    expect(typedPhone("")).toBe("")
    expect(typedPhone("abc")).toBe("")
  })
})
