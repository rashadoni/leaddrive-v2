import { describe, expect, it } from "vitest"

import { normalizeLineNumber } from "@/lib/voip/line-numbers"

describe("a line number as operators and the PBX write it", () => {
  it("reads the common Azerbaijani and international forms as one E.164 number", () => {
    for (const raw of ["+994 12 555 30 65", "994125553065", "012-555-30-65", "(012) 555 30 65", "00994125553065", "125553065"]) {
      expect(normalizeLineNumber(raw), raw).toBe("+994125553065")
    }
    expect(normalizeLineNumber("+44 20 7946 0958")).toBe("+442079460958")
  })

  it("is no number for the station's label, an extension or garbage", () => {
    for (const raw of ["fanum-inbound-browser", "101", "", null, undefined, "+0123", "12345678901234567"]) {
      expect(normalizeLineNumber(raw), String(raw)).toBeNull()
    }
  })
})
