import { describe, expect, it } from "vitest"
import { nextWiderPeriod } from "@/lib/mtm/empty-period-fallback"

const ORDER = ["today", "7d", "30d", "all"] as const
const base = { order: ORDER, current: "today" as const, rows: 0, userChose: false, alreadyWidened: false, loading: false }

describe("opening a screen on an empty period", () => {
  it("widens one step when the default period is empty", () => {
    expect(nextWiderPeriod(base)).toBe("7d")
  })

  /** The nearest period with data is the answer, not the largest one. */
  it("never jumps straight to everything", () => {
    expect(nextWiderPeriod({ ...base, current: "7d" })).toBe("30d")
    expect(nextWiderPeriod({ ...base, current: "30d" })).toBe("all")
    expect(nextWiderPeriod({ ...base, current: "all" })).toBeNull()
  })

  it("stays put once the reader has chosen a period", () => {
    expect(nextWiderPeriod({ ...base, userChose: true })).toBeNull()
  })

  it("widens at most once, so an empty tenant is not walked end to end", () => {
    expect(nextWiderPeriod({ ...base, alreadyWidened: true })).toBeNull()
  })

  /** A list that has not loaded yet is not an empty period. */
  it("waits for the load to finish", () => {
    expect(nextWiderPeriod({ ...base, loading: true })).toBeNull()
  })

  it("leaves a period that has rows alone", () => {
    expect(nextWiderPeriod({ ...base, rows: 1 })).toBeNull()
  })

  it("does not guess when the period is not in the list", () => {
    expect(nextWiderPeriod({ ...base, current: "quarter" as never })).toBeNull()
  })
})
