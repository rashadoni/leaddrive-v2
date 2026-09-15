import { describe, expect, it, vi } from "vitest"
import {
  checkInGeofenceRadius,
  clampCheckInGeofenceRadius,
  createAlertOutOfZoneReader,
  geofenceRadiusOutOfRange,
} from "@/lib/mtm/check-in-geofence"
import { coerceMtmBooleanSetting, coerceMtmNumberSetting } from "@/lib/mtm/setting-values"
import { CustomerCreateSchema } from "@/lib/mtm-validators"

describe("shared check-in geofence rule", () => {
  it("clamps a usable radius to the nearest bound of 25..10000 m", () => {
    expect(clampCheckInGeofenceRadius(25)).toBe(25)
    expect(clampCheckInGeofenceRadius(10_000)).toBe(10_000)
    expect(clampCheckInGeofenceRadius("250")).toBe(250)
    expect(clampCheckInGeofenceRadius(5)).toBe(25)
    expect(clampCheckInGeofenceRadius(20_000)).toBe(10_000)
    expect(clampCheckInGeofenceRadius(50_000)).toBe(10_000)
  })

  it("falls back to 100 m only for a missing, non-numeric or non-positive radius", () => {
    for (const bad of [0, -5, Number.NaN, null, undefined, "x", ""]) {
      expect(clampCheckInGeofenceRadius(bad)).toBe(100)
    }
  })

  it("prefers the customer radius, then the organization setting, then 100 m", () => {
    expect(checkInGeofenceRadius(null, 300)).toBe(300)
    expect(checkInGeofenceRadius(undefined, 300)).toBe(300)
    expect(checkInGeofenceRadius(40, 300)).toBe(40)
    expect(checkInGeofenceRadius(5, 300)).toBe(25)
    expect(checkInGeofenceRadius(20_000, 300)).toBe(10_000)
    expect(checkInGeofenceRadius(null, 20_000)).toBe(10_000)
    expect(checkInGeofenceRadius(null, null)).toBe(100)
    expect(geofenceRadiusOutOfRange(24)).toBe(true)
    expect(geofenceRadiusOutOfRange(10_001)).toBe(true)
    expect(geofenceRadiusOutOfRange(null)).toBe(false)
  })

  it("accepts only 25..10000 m for new customer writes", () => {
    const base = { name: "Clinic", category: "A" }
    for (const [radius, ok] of [[25, true], [10_000, true], [null, true], [24, false], [10_001, false], [50_000, false]] as const) {
      const parsed = CustomerCreateSchema.safeParse({ ...base, geofenceRadius: radius })
      const radiusIssue = parsed.success ? undefined : parsed.error.issues.find((issue) => issue.path[0] === "geofenceRadius")
      expect(radiusIssue === undefined).toBe(ok)
    }
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

  it("parses alertOutOfZone with the settings rule", async () => {
    for (const [value, expected] of [[null, true], [true, true], ["true", true], [false, false], ["false", false], ["yes", false]] as const) {
      const read = createAlertOutOfZoneReader("org-1")
      const findFirst = vi.fn().mockResolvedValue(value === null ? null : { value })
      expect(await read({ mtmSetting: { findFirst } } as never)).toBe(expected)
    }
  })
})

describe("one parser for stored MTM settings", () => {
  it("booleans: only a true boolean or the string \"true\" is on; missing keeps the default", () => {
    expect(coerceMtmBooleanSetting(undefined, true)).toBe(true)
    expect(coerceMtmBooleanSetting(null, false)).toBe(false)
    expect(coerceMtmBooleanSetting(false, true)).toBe(false)
    expect(coerceMtmBooleanSetting("true", false)).toBe(true)
    expect(coerceMtmBooleanSetting("false", true)).toBe(false)
    expect(coerceMtmBooleanSetting("200", true)).toBe(false)
    expect(coerceMtmBooleanSetting(1, true)).toBe(true)
  })

  it("numbers: finite Number(raw), otherwise the default", () => {
    expect(coerceMtmNumberSetting("12", 10)).toBe(12)
    expect(coerceMtmNumberSetting(5, 10)).toBe(5)
    expect(coerceMtmNumberSetting("abc", 10)).toBe(10)
    expect(coerceMtmNumberSetting(null, 10)).toBe(10)
  })

  it("is the rule getMtmSettings uses", async () => {
    const { readFileSync } = await import("node:fs")
    const source = readFileSync("src/lib/mtm-settings.ts", "utf8")
    expect(source).toContain("coerceMtmNumberSetting(raw, fallback)")
    expect(source).toContain("coerceMtmBooleanSetting(raw, fallback)")
  })
})
