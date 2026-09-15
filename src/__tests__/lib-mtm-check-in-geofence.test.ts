import { describe, expect, it, vi } from "vitest"
import {
  checkInGeofenceRadius,
  clampCheckInGeofenceRadius,
  createAlertOutOfZoneReader,
  storedFlagEnabled,
} from "@/lib/mtm/check-in-geofence"

describe("shared check-in geofence rule", () => {
  it("clamps to 25..10000 m with a 100 m fallback", () => {
    expect(clampCheckInGeofenceRadius(25)).toBe(25)
    expect(clampCheckInGeofenceRadius(10_000)).toBe(10_000)
    expect(clampCheckInGeofenceRadius("250")).toBe(250)
    for (const bad of [24, 10_001, 0, -5, Number.NaN, null, undefined, "x"]) {
      expect(clampCheckInGeofenceRadius(bad)).toBe(100)
    }
  })

  it("prefers the customer radius, then the organization setting", () => {
    expect(checkInGeofenceRadius(null, 300)).toBe(300)
    expect(checkInGeofenceRadius(undefined, 300)).toBe(300)
    expect(checkInGeofenceRadius(40, 300)).toBe(40)
    // A set but out-of-range customer radius falls back to 100 m, not to the
    // organization value — exactly what the sync paths always did.
    expect(checkInGeofenceRadius(5, 300)).toBe(100)
  })

  it("reads stored booleans strictly", () => {
    expect(storedFlagEnabled(false, true)).toBe(false)
    expect(storedFlagEnabled("false", true)).toBe(false)
    expect(storedFlagEnabled("200", true)).toBe(true)
    expect(storedFlagEnabled(undefined, true)).toBe(true)
  })

  it("reads alertOutOfZone once per request and does not cache a failed read", async () => {
    const findFirst = vi.fn()
      .mockRejectedValueOnce(new Error("transient"))
      .mockResolvedValueOnce({ value: false })
    const read = createAlertOutOfZoneReader("org-1")
    const client = { mtmSetting: { findFirst } } as never
    await expect(read(client)).rejects.toThrow("transient")
    expect(await read(client)).toBe(false)
    expect(await read(client)).toBe(false)
    expect(findFirst).toHaveBeenCalledTimes(2)
    expect(findFirst).toHaveBeenLastCalledWith({ where: { organizationId: "org-1", key: "alertOutOfZone" }, select: { value: true } })
  })
})
