import { describe, expect, it } from "vitest"
import {
  addDateKeyDays,
  currentDateKey,
  effectiveRoutePointStatus,
  effectiveRouteStatus,
  isDateKey,
  isWeekendDateKey,
  localDateKeyToUtc,
  startOfIsoWeekDateKey,
} from "@/lib/mtm/mobile-week"

describe("MTM mobile week helpers", () => {
  it("validates real YYYY-MM-DD calendar dates", () => {
    expect(isDateKey("2026-07-15")).toBe(true)
    expect(isDateKey("2026-02-29")).toBe(false)
    expect(isDateKey("15/07/2026")).toBe(false)
  })

  it("normalizes any date to the Monday of its ISO week", () => {
    expect(startOfIsoWeekDateKey("2026-07-15")).toBe("2026-07-13")
    expect(startOfIsoWeekDateKey("2026-07-19")).toBe("2026-07-13")
    expect(startOfIsoWeekDateKey("2026-07-20")).toBe("2026-07-20")
    expect(addDateKeyDays("2026-12-31", 1)).toBe("2027-01-01")
  })

  it("uses the organization timezone for today and local range boundaries", () => {
    const instant = new Date("2026-07-14T21:30:00.000Z")
    expect(currentDateKey(instant, "Asia/Baku")).toBe("2026-07-15")
    expect(localDateKeyToUtc("2026-07-15", "Asia/Baku").toISOString()).toBe(
      "2026-07-14T20:00:00.000Z",
    )
  })

  it("keeps persisted terminal states and derives MISSED only for unfinished past routes", () => {
    expect(effectiveRouteStatus({
      status: "PLANNED",
      date: new Date("2026-07-14T00:00:00.000Z"),
      totalPoints: 4,
      visitedPoints: 2,
    }, "2026-07-15")).toBe("MISSED")

    expect(effectiveRouteStatus({
      status: "IN_PROGRESS",
      date: "2026-07-15",
      totalPoints: 4,
      visitedPoints: 2,
    }, "2026-07-15")).toBe("IN_PROGRESS")

    expect(effectiveRouteStatus({
      status: "COMPLETED",
      date: "2026-07-14",
      totalPoints: 4,
      visitedPoints: 3,
    }, "2026-07-15")).toBe("COMPLETED")

    expect(effectiveRouteStatus({
      status: "PLANNED",
      date: "2026-07-14",
      totalPoints: 4,
      visitedPoints: 0,
    }, "2026-07-15", {
      isWorkingDay: false,
      routePlanningAllowed: false,
    })).toBe("PLANNED")
  })

  it("derives point states without rewriting persisted data", () => {
    expect(effectiveRoutePointStatus("VISITED", "MISSED")).toBe("VISITED")
    expect(effectiveRoutePointStatus("SKIPPED", "PLANNED")).toBe("MISSED")
    expect(effectiveRoutePointStatus("PENDING", "MISSED")).toBe("MISSED")
    expect(effectiveRoutePointStatus("PENDING", "PLANNED")).toBe("PENDING")
  })

  it("keeps a stored INCOMPLETE instead of deriving MISSED over it", () => {
    // The day-close job has already decided this day is over. Deriving MISSED on
    // top would replace a stored fact with a guess, and would name the same
    // route differently in the app and on the web.
    expect(effectiveRouteStatus({
      status: "INCOMPLETE",
      date: "2026-07-14",
      totalPoints: 4,
      visitedPoints: 1,
    }, "2026-07-15")).toBe("INCOMPLETE")

    expect(effectiveRouteStatus({
      status: "INCOMPLETE",
      date: "2026-07-14",
      totalPoints: 4,
      visitedPoints: 4,
    }, "2026-07-15")).toBe("INCOMPLETE")
  })

  it("still calls the unvisited stops of a closed day missed, not pending", () => {
    // Without this, closing the route would quietly turn its unreached stops
    // back into work that is still to do.
    expect(effectiveRoutePointStatus("PENDING", "INCOMPLETE")).toBe("MISSED")
    expect(effectiveRoutePointStatus("VISITED", "INCOMPLETE")).toBe("VISITED")
  })

  it("marks Saturday and Sunday as the provisional non-working default", () => {
    expect(isWeekendDateKey("2026-07-17")).toBe(false)
    expect(isWeekendDateKey("2026-07-18")).toBe(true)
    expect(isWeekendDateKey("2026-07-19")).toBe(true)
  })
})
