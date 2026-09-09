import { describe, expect, it } from "vitest"
import { contactCoveragePeriod, contactCoverageState } from "@/lib/mtm/contact-list-coverage"

describe("MTM contact-list coverage", () => {
  it("uses the requested calendar month and calculates its exact UTC date envelope", () => {
    expect(contactCoveragePeriod("2026-02", "2026-07-15")).toEqual({
      key: "2026-02",
      startKey: "2026-02-01",
      endKey: "2026-02-28",
      start: new Date("2026-02-01T00:00:00.000Z"),
      end: new Date("2026-02-28T00:00:00.000Z"),
    })
  })

  it("falls back to the current month when the URL value is invalid", () => {
    expect(contactCoveragePeriod("2026-99", "2026-07-15").key).toBe("2026-07")
  })

  it("derives state only from the signed snapshot's uncovered value", () => {
    expect(contactCoverageState("0.0000")).toBe("COVERED")
    expect(contactCoverageState("12.5000")).toBe("GAP")
    expect(contactCoverageState("-1")).toBe("COVERAGE_ROW_INVALID")
  })
})
