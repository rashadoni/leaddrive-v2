import { describe, it, expect } from "vitest"
import { formatSlaHours } from "@/lib/format-sla"

describe("formatSlaHours", () => {
  it("formats whole hours", () => {
    expect(formatSlaHours(2)).toBe("2h")
    expect(formatSlaHours(24)).toBe("24h")
  })
  it("formats sub-hour values as minutes", () => {
    expect(formatSlaHours(0.5)).toBe("30m")
    expect(formatSlaHours(0.25)).toBe("15m")
    expect(formatSlaHours(0.75)).toBe("45m")
  })
  it("formats mixed hours + minutes", () => {
    expect(formatSlaHours(2.5)).toBe("2h 30m")
    expect(formatSlaHours(2.25)).toBe("2h 15m")
  })
  it("rounds a repeating fraction (20 min stored as 0.3333h) to a clean minute label", () => {
    expect(formatSlaHours(20 / 60)).toBe("20m")
    expect(formatSlaHours(40 / 60)).toBe("40m")
    expect(formatSlaHours(1 + 10 / 60)).toBe("1h 10m")
  })
  it("handles zero / nullish", () => {
    expect(formatSlaHours(0)).toBe("0m")
    expect(formatSlaHours(undefined as unknown as number)).toBe("0m")
  })
})
