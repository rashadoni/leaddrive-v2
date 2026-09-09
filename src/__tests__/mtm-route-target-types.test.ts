import { describe, expect, it } from "vitest"
import {
  MTM_ROUTE_TARGET_TYPE_ALL_CUSTOMERS,
  MTM_ROUTE_TARGET_TYPE_DEFAULTS,
  coerceMtmRouteTargetTypes,
  parseMtmRouteTargetTypes,
  routeTargetLabel,
} from "@/lib/mtm/route-target-types"

describe("MTM route target type settings", () => {
  it("ships an explicit all-customers scope before category filters", () => {
    expect(MTM_ROUTE_TARGET_TYPE_DEFAULTS.map((entry) => entry.id)).toEqual([
      "all-customers",
      "doctors",
      "pharmacies",
      "clinics",
      "organizations",
    ])
    expect(MTM_ROUTE_TARGET_TYPE_DEFAULTS.find((entry) => entry.id === "all-customers")?.objectType).toBeNull()
    expect(MTM_ROUTE_TARGET_TYPE_DEFAULTS.find((entry) => entry.id === "organizations")?.objectType).toBe("OTHER")
  })

  it("accepts a tenant-defined hospital button with localized labels", () => {
    const parsed = parseMtmRouteTargetTypes([{
      id: "hospitals",
      labels: { az: "Xəstəxanalar", ru: "Больницы", en: "Hospitals" },
      direction: "ORGANIZATION",
      objectType: "CLINIC",
      organizationKind: "Hospital",
      enabled: true,
    }])

    expect(parsed.success).toBe(true)
    if (!parsed.success) return
    expect(routeTargetLabel(parsed.data[0], "az")).toBe("Xəstəxanalar")
    expect(parsed.data[0].organizationKind).toBe("Hospital")
  })

  it("rejects duplicate IDs and configurations with no visible type", () => {
    const duplicate = [
      { ...MTM_ROUTE_TARGET_TYPE_DEFAULTS[0], labels: { ...MTM_ROUTE_TARGET_TYPE_DEFAULTS[0].labels } },
      { ...MTM_ROUTE_TARGET_TYPE_DEFAULTS[0], labels: { ...MTM_ROUTE_TARGET_TYPE_DEFAULTS[0].labels } },
    ]
    expect(parseMtmRouteTargetTypes(duplicate).success).toBe(false)
    expect(parseMtmRouteTargetTypes([{ ...duplicate[0], enabled: false }]).success).toBe(false)
  })

  it("falls back to independent default objects when stored JSON is invalid", () => {
    const first = coerceMtmRouteTargetTypes("invalid")
    const second = coerceMtmRouteTargetTypes(null)
    first[0].labels.az = "Changed"
    expect(second[0].labels.az).not.toBe("Changed")
  })

  it("upgrades legacy category-only settings with an always-visible all-customers scope", () => {
    const legacy = MTM_ROUTE_TARGET_TYPE_DEFAULTS
      .filter((entry) => entry.id !== MTM_ROUTE_TARGET_TYPE_ALL_CUSTOMERS.id)
      .map((entry) => ({ ...entry, labels: { ...entry.labels } }))

    const normalized = coerceMtmRouteTargetTypes(legacy)

    expect(normalized[0]).toMatchObject({
      id: "all-customers",
      direction: "ORGANIZATION",
      objectType: null,
      enabled: true,
    })
    expect(normalized.map((entry) => entry.id)).toEqual([
      "all-customers",
      "doctors",
      "pharmacies",
      "clinics",
      "organizations",
    ])
  })
})
