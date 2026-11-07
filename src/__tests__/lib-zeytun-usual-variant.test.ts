import { describe, expect, it } from "vitest"

import { markUsualVariant } from "@/lib/voice-agent/pharmacy/zeytun-inbound-pilot"
import { namesFormOrStrength } from "@/lib/voice-agent/pharmacy/name-search"

// Owner's queue 2026-11-06, task 11: the line stand asked "ampula or həb?" for 6 of 10 products.
describe("the variant a pharmacy usually orders", () => {
  const amp = { externalId: "a", name: "Spazmalgon 2 ml № 10 (Ampula)", nameAz: null }
  const tab = { externalId: "b", name: "Spazmalgon № 20 (Həb)", nameAz: null }
  const linex = { externalId: "c", name: "Lineks № 16 (Kapsul)", nameAz: "Lineks № 16" }

  it("marks the one variant of a name the pharmacy orders, and nothing without a list", () => {
    expect(markUsualVariant([amp, tab, linex], ["a", "c"])).toEqual([{ ...amp, usual: true }, tab, { ...linex, usual: true }])
    expect(markUsualVariant([amp, tab], null)).toEqual([amp, tab])
    expect(markUsualVariant([amp, tab], [])).toEqual([amp, tab])
  })

  it("marks none when the pharmacy orders two variants of the same name", () => {
    expect(markUsualVariant([amp, tab, linex], ["a", "b"])).toEqual([amp, tab, linex])
  })

  it("knows when the caller already said a form or a strength", () => {
    expect(namesFormOrStrength("Spazmalgon")).toBe(false)
    expect(namesFormOrStrength("Linex")).toBe(false)
    expect(namesFormOrStrength("Spazmalgon ampula")).toBe(true)
    expect(namesFormOrStrength("Paracetamol həb")).toBe(true)
    expect(namesFormOrStrength("Magnerot 500")).toBe(true)
  })
})
