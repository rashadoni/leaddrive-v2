import { describe, expect, it } from "vitest"
import { isRouteBuilderStopLocked, routeBuilderStopPlannedTimeForSave } from "@/lib/mtm/route-builder-stop-time"

// Baku, UTC+4: a stored 06:15Z is shown as 10:15 and snapped to the 10:00 slot.
const input = { date: "2026-09-16", timezone: "Asia/Baku", publishedEdit: true }
const visitedAtQuarterPast = {
  status: "VISITED",
  plannedTime: "10:00",
  originalPlannedTime: "2026-09-16T06:15:00.000Z",
  originalSlot: "10:00",
}

describe("route builder stop times in a published edit", () => {
  it("sends a visited 10:15 stop back untouched instead of the 10:00 slot", () => {
    expect(routeBuilderStopPlannedTimeForSave(visitedAtQuarterPast, input)).toBe("2026-09-16T06:15:00.000Z")
  })

  it("keeps a locked stop's stored time even if the form value moved", () => {
    expect(routeBuilderStopPlannedTimeForSave({ ...visitedAtQuarterPast, plannedTime: "11:30" }, input))
      .toBe("2026-09-16T06:15:00.000Z")
  })

  it("keeps an unlocked stop's stored time unless the user picked another slot", () => {
    const pending = { ...visitedAtQuarterPast, status: "PENDING" }
    expect(routeBuilderStopPlannedTimeForSave(pending, input)).toBe("2026-09-16T06:15:00.000Z")
    expect(routeBuilderStopPlannedTimeForSave({ ...pending, plannedTime: "11:30" }, input)).toBe("2026-09-16T07:30:00.000Z")
    expect(routeBuilderStopPlannedTimeForSave({ ...pending, plannedTime: null }, input)).toBeNull()
  })

  it("converts the slot for new stops and for drafts", () => {
    expect(routeBuilderStopPlannedTimeForSave({ status: undefined, plannedTime: "09:00" }, input)).toBe("2026-09-16T05:00:00.000Z")
    expect(routeBuilderStopPlannedTimeForSave(visitedAtQuarterPast, { ...input, publishedEdit: false }))
      .toBe("2026-09-16T06:00:00.000Z")
  })

  it("locks a PENDING stop with an open visit, like the server", () => {
    expect(isRouteBuilderStopLocked({ status: "PENDING", hasVisit: true })).toBe(true)
    expect(isRouteBuilderStopLocked({ status: "SKIPPED" })).toBe(true)
    expect(isRouteBuilderStopLocked({ status: "PENDING" })).toBe(false)
    expect(isRouteBuilderStopLocked({})).toBe(false)
  })
})
