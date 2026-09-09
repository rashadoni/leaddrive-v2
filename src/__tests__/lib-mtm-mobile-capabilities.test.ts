import { describe, expect, it } from "vitest"
import {
  hasMobileCapability,
  hasMobilePermission,
  mobileCapabilities,
  mobileFieldPermissions,
  requireMobileCapability,
  mobilePermissions,
  requireMobilePermission,
} from "@/lib/mtm/mobile-capabilities"

describe("MTM mobile capability matrix", () => {
  it("gives Agents field execution and tracking only", () => {
    expect(mobileCapabilities("AGENT")).toEqual(["FIELD_EXECUTE", "FIELD_TRACK"])
    expect(hasMobileCapability("AGENT", "FIELD_EXECUTE")).toBe(true)
    expect(hasMobileCapability("AGENT", "TEAM_READ")).toBe(false)
  })

  it.each(["ADMIN", "MANAGER", "SUPERVISOR"])("gives %s team and explicit self-location capabilities without field tracking", (role) => {
    expect(mobileCapabilities(role)).toEqual(["TEAM_READ", "TEAM_DECIDE", "SELF_LOCATION_SHARE"])
    expect(hasMobileCapability(role, "TEAM_READ")).toBe(true)
    expect(hasMobileCapability(role, "SELF_LOCATION_SHARE")).toBe(true)
    expect(hasMobileCapability(role, "FIELD_TRACK")).toBe(false)
  })

  it("fails closed for unknown and missing roles", () => {
    expect(mobileCapabilities("OWNER")).toEqual([])
    expect(mobileCapabilities(undefined)).toEqual([])
    expect(hasMobileCapability("OWNER", "FIELD_EXECUTE")).toBe(false)
  })

  it("keeps granular Route & Field and Workforce permissions independent", () => {
    expect(mobileFieldPermissions("AGENT", {
      routeField: true,
      workforceHrm: false,
      canPlanOwnRoutes: true,
      canSelfPublishRoutes: true,
    })).toEqual(["ROUTE_SELF_READ", "ROUTE_EXECUTE", "ROUTE_SELF_PLAN", "ROUTE_SELF_PUBLISH"])

    expect(mobileFieldPermissions("AGENT", {
      routeField: false,
      workforceHrm: true,
    })).toEqual(["WORKTIME_SELF_READ", "WORKTIME_SELF_MUTATE"])

    expect(mobileFieldPermissions("ADMIN", {
      routeField: true,
      workforceHrm: true,
    })).toEqual([
      "ROUTE_TEAM_READ",
      "ROUTE_TEAM_PLAN",
      "ROUTE_CHANGE_DECIDE",
      "WORKTIME_TEAM_READ",
      "WORKTIME_REQUEST_DECIDE",
      "WORKTIME_POLICY_ADMIN",
    ])
  })

  it("maps legacy roles to granular worktime and route permissions without changing legacy capabilities", () => {
    expect(mobileCapabilities("AGENT")).toEqual(["FIELD_EXECUTE", "FIELD_TRACK"])
    expect(mobilePermissions("AGENT")).toEqual([
      "WORKTIME_SELF_READ",
      "WORKTIME_SELF_MUTATE",
      "ROUTE_SELF_PLAN",
      "ROUTE_EXECUTE",
    ])
    expect(hasMobilePermission("MANAGER", "WORKTIME_TEAM_READ")).toBe(true)
    expect(hasMobilePermission("MANAGER", "WORKTIME_POLICY_ADMIN")).toBe(false)
    expect(hasMobilePermission("ADMIN", "WORKTIME_POLICY_ADMIN")).toBe(true)
    expect(mobilePermissions("OWNER")).toEqual([])
  })

  it("returns a stable 403 response for a missing capability", async () => {
    const response = requireMobileCapability({ role: "MANAGER" }, "FIELD_TRACK")
    expect(response?.status).toBe(403)
    await expect(response?.json()).resolves.toEqual({
      error: "Forbidden",
      code: "MTM_MOBILE_CAPABILITY_REQUIRED",
      capability: "FIELD_TRACK",
    })
    expect(requireMobileCapability({ role: "AGENT" }, "FIELD_TRACK")).toBeNull()
  })

  it("returns a stable 403 response for a missing granular permission", async () => {
    const response = requireMobilePermission({ role: "AGENT" }, "WORKTIME_TEAM_READ")
    expect(response?.status).toBe(403)
    await expect(response?.json()).resolves.toEqual({
      error: "Forbidden",
      code: "MTM_MOBILE_PERMISSION_REQUIRED",
      permission: "WORKTIME_TEAM_READ",
    })
    expect(requireMobilePermission({ role: "AGENT" }, "WORKTIME_SELF_MUTATE")).toBeNull()
  })
})
