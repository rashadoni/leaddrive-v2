import { describe, expect, it } from "vitest"
import { mtmPhotoPeriodStart } from "@/lib/mtm/photo-period"

describe("mtmPhotoPeriodStart (review of #205: tenant timezone, not the browser's)", () => {
  // Sunday 13 September 2026, 22:30 UTC = Monday 14 September, 02:30 in Baku.
  const now = new Date("2026-09-13T22:30:00.000Z")

  it("starts today at the organization's midnight", () => {
    expect(new Date(mtmPhotoPeriodStart("today", now, "Asia/Baku")).toISOString()).toBe("2026-09-13T20:00:00.000Z")
    expect(new Date(mtmPhotoPeriodStart("today", now, "UTC")).toISOString()).toBe("2026-09-13T00:00:00.000Z")
  })

  it("starts the week on the organization's Monday", () => {
    // Already Monday in Baku; still Sunday in UTC, whose week began on the 7th.
    expect(new Date(mtmPhotoPeriodStart("week", now, "Asia/Baku")).toISOString()).toBe("2026-09-13T20:00:00.000Z")
    expect(new Date(mtmPhotoPeriodStart("week", now, "UTC")).toISOString()).toBe("2026-09-07T00:00:00.000Z")
  })

  it("has no lower bound for all", () => {
    expect(mtmPhotoPeriodStart("all", now, "Asia/Baku")).toBe(Number.NEGATIVE_INFINITY)
  })
})
