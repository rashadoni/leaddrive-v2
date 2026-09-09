import { describe, expect, it } from "vitest"

import {
  MAX_VOICE_MONTHLY_MINUTES,
  MIN_VOICE_MONTHLY_MINUTES,
  normalizeMonthlyMinutes,
} from "@/lib/ai/voice/monthly-budget"

describe("voice monthly budget setting", () => {
  it("accepts a whole number of minutes inside the allowed range", () => {
    expect(normalizeMonthlyMinutes(300)).toBe(300)
    expect(normalizeMonthlyMinutes("300")).toBe(300)
    expect(normalizeMonthlyMinutes(MIN_VOICE_MONTHLY_MINUTES)).toBe(MIN_VOICE_MONTHLY_MINUTES)
    expect(normalizeMonthlyMinutes(MAX_VOICE_MONTHLY_MINUTES)).toBe(MAX_VOICE_MONTHLY_MINUTES)
  })

  it("rejects values that would silently disable or absurdly inflate voice", () => {
    // Zero and negatives read as "no voice at all" while looking like a limit,
    // and a fractional ceiling makes the reservation arithmetic meaningless.
    expect(normalizeMonthlyMinutes(0)).toBeNull()
    expect(normalizeMonthlyMinutes(-5)).toBeNull()
    expect(normalizeMonthlyMinutes(12.5)).toBeNull()
    expect(normalizeMonthlyMinutes(MAX_VOICE_MONTHLY_MINUTES + 1)).toBeNull()
  })

  it("treats anything unparseable as unset so the deployment default applies", () => {
    // A settings typo must fall back to the default rather than take voice away
    // from the whole organisation.
    expect(normalizeMonthlyMinutes(undefined)).toBeNull()
    expect(normalizeMonthlyMinutes(null)).toBeNull()
    expect(normalizeMonthlyMinutes("")).toBeNull()
    expect(normalizeMonthlyMinutes("unlimited")).toBeNull()
    expect(normalizeMonthlyMinutes({})).toBeNull()
  })
})
