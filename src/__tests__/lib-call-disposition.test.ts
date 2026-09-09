import { describe, expect, it } from "vitest"

import {
  CALL_DISPOSITIONS,
  CALL_DISPOSITION_I18N_KEYS,
  QUICK_CALL_DISPOSITIONS,
  isCallDisposition,
} from "@/lib/calls/disposition"

describe("canonical per-call disposition vocabulary", () => {
  it("defines the one authoritative business outcome set for human and AI calls", () => {
    expect(CALL_DISPOSITIONS).toEqual([
      "interested",
      "not_interested",
      "callback",
      "voicemail",
      "wrong_number",
      "no_answer",
      "other",
    ])
    expect(new Set(CALL_DISPOSITIONS).size).toBe(CALL_DISPOSITIONS.length)
    expect(Object.keys(CALL_DISPOSITION_I18N_KEYS)).toEqual(CALL_DISPOSITIONS)
  })

  it("keeps the fast UI subset inside the canonical set and validates unknown input", () => {
    expect(QUICK_CALL_DISPOSITIONS).toEqual([
      "interested",
      "callback",
      "no_answer",
      "not_interested",
      "wrong_number",
    ])
    expect(QUICK_CALL_DISPOSITIONS.every(isCallDisposition)).toBe(true)
    expect(isCallDisposition("sold")).toBe(false)
    expect(isCallDisposition("customer_spoke")).toBe(false)
  })
})
