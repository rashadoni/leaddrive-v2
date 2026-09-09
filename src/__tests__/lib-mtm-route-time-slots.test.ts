import { describe, expect, it } from "vitest"
import {
  MTM_ROUTE_TIME_SLOTS,
  isMtmRouteTimeSlot,
  nextMtmRouteTimeSlot,
  normalizeMtmRouteTimeSlot,
} from "@/lib/mtm/route-time-slots"

describe("MTM route time slots", () => {
  it("offers just the 48 practical half-hour choices", () => {
    expect(MTM_ROUTE_TIME_SLOTS).toHaveLength(48)
    expect(MTM_ROUTE_TIME_SLOTS[0]).toBe("00:00")
    expect(MTM_ROUTE_TIME_SLOTS[1]).toBe("00:30")
    expect(MTM_ROUTE_TIME_SLOTS.at(-1)).toBe("23:30")
    expect(MTM_ROUTE_TIME_SLOTS).not.toContain("14:27")
  })

  it("recognizes and normalizes the supported schedule times", () => {
    expect(isMtmRouteTimeSlot("14:00")).toBe(true)
    expect(isMtmRouteTimeSlot("14:30")).toBe(true)
    expect(isMtmRouteTimeSlot("14:27")).toBe(false)
    expect(normalizeMtmRouteTimeSlot("14:27")).toBe("14:30")
    expect(normalizeMtmRouteTimeSlot("14:44")).toBe("14:30")
  })

  it("continues a route in half-hour increments", () => {
    expect(nextMtmRouteTimeSlot([])).toBe("09:00")
    expect(nextMtmRouteTimeSlot(["09:00", "09:30"])).toBe("10:00")
    expect(nextMtmRouteTimeSlot(["14:27"])).toBe("15:00")
  })
})
