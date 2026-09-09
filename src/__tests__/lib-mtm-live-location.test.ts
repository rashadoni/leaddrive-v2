import { describe, expect, it } from "vitest"
import { classifyGpsFreshness, explainMissingLocation, mapWorkdayState } from "@/lib/mtm/live-location"

const NOW = new Date("2026-08-01T12:00:00.000Z")

describe("SWM-12 live location states", () => {
  it.each([
    ["2026-08-01T11:55:00.000Z", "ONLINE"],
    ["2026-08-01T11:54:59.000Z", "DELAYED"],
    ["2026-08-01T11:45:00.000Z", "DELAYED"],
    ["2026-08-01T11:44:59.000Z", "STALE"],
    [null, "NO_LOCATION"],
  ])("classifies %s as %s at exact freshness thresholds", (recordedAt, expected) => {
    expect(classifyGpsFreshness(recordedAt, NOW)).toBe(expected)
  })

  it("keeps GPS freshness independent from workday state", () => {
    expect(mapWorkdayState("STARTED")).toBe("ACTIVE")
    expect(mapWorkdayState("PAUSED")).toBe("PAUSED")
    expect(mapWorkdayState("COMPLETED")).toBe("CLOSED")
    expect(mapWorkdayState(null)).toBe("NOT_STARTED")
  })

  it("explains roster rows that cannot create a marker", () => {
    expect(explainMissingLocation({ hasLocation: false, lastSeenAt: null })).toBe("NO_LOCATION_REPORTED")
    expect(explainMissingLocation({ hasLocation: false, lastSeenAt: NOW })).toBe("NO_LOCATION_REPORTED")
    expect(explainMissingLocation({ hasLocation: false, lastSeenAt: null, permissionState: "DENIED" })).toBe("PERMISSION_NOT_GRANTED")
    expect(explainMissingLocation({ hasLocation: true, lastSeenAt: null })).toBe("AVAILABLE")
  })
})
