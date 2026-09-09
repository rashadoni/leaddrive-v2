import { describe, expect, it } from "vitest"
import { canonicalDealStage } from "@/lib/deal-stage-normalization"

describe("canonicalDealStage", () => {
  it("merges legacy and localized won aliases", () => {
    expect(canonicalDealStage("CLOSED_WON")).toBe("WON")
    expect(canonicalDealStage("Qazandı")).toBe("WON")
    expect(canonicalDealStage("custom success", ["Custom Success"])).toBe("WON")
  })

  it("merges lost aliases and canonicalizes common open stages", () => {
    expect(canonicalDealStage("CLOSED_LOST")).toBe("LOST")
    expect(canonicalDealStage("Uduzdu")).toBe("LOST")
    expect(canonicalDealStage("Lid")).toBe("LEAD")
    expect(canonicalDealStage("Kvalifikasiya")).toBe("QUALIFIED")
  })

  it("preserves a custom open stage label", () => {
    expect(canonicalDealStage("Demo scheduled")).toBe("Demo scheduled")
  })
})
