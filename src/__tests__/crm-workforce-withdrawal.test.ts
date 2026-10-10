import { describe, expect, it } from "vitest"
import { accessibleNavItems } from "@/lib/nav-items"
import { CAPABILITY_SECTIONS, TOGGLEABLE_CAPABILITIES } from "@/lib/admin-sidebar-catalog"
import {
  hasTenantCapabilityEntitlement,
  isTenantCapabilityEnabled,
  resolveTenantCapabilities,
} from "@/lib/tenant-capabilities"
import { isWithdrawnCrmPath } from "@/lib/crm-product-availability"

describe("Workforce withdrawal from CRM", () => {
  it.each(["admin", "superadmin", "manager", "viewer"])("hides HRM for %s despite a retained entitlement", (role) => {
    const context = { plan: "enterprise", role, modules: {
      crm: true, support: true, "route-field": true, "workforce-hrm": true,
      "attendance-qr": true, "attendance-device-trust": true,
    } }
    const original = structuredClone(context)
    const items = accessibleNavItems(context)
    expect(items.some((item) => item.href.startsWith("/workforce"))).toBe(false)
    expect(items.some((item) => item.href === "/mtm/routes")).toBe(true)
    expect(items.some((item) => item.group === "Support")).toBe(true)
    expect(hasTenantCapabilityEntitlement("workforce-hrm", context)).toBe(true)
    expect(isTenantCapabilityEnabled("workforce-hrm", context)).toBe(false)
    expect(isTenantCapabilityEnabled("route-field", context)).toBe(true)
    expect(resolveTenantCapabilities(context).map((item) => item.definition.id))
      .not.toEqual(expect.arrayContaining(["workforce-hrm"]))
    expect(resolveTenantCapabilities(context).some((item) => item.definition.id.startsWith("attendance-"))).toBe(false)
    expect(context).toEqual(original)
  })

  it("does not let a legacy bundle or an add-on reactivate HRM", () => {
    const legacy = { plan: "enterprise", modules: { mtm: true, "attendance-qr": true, "attendance-device-trust": true } }
    expect(hasTenantCapabilityEntitlement("workforce-hrm", legacy)).toBe(true)
    expect(isTenantCapabilityEnabled("workforce-hrm", legacy)).toBe(false)
    expect(isTenantCapabilityEnabled("attendance-qr", legacy)).toBe(false)
    expect(isTenantCapabilityEnabled("attendance-device-trust", legacy)).toBe(false)
    expect(isTenantCapabilityEnabled("route-field", legacy)).toBe(true)
  })

  it("removes HRM from the superadmin module picker while retaining Route & Field", () => {
    expect(TOGGLEABLE_CAPABILITIES).not.toContain("workforce-hrm")
    expect(TOGGLEABLE_CAPABILITIES).toContain("route-field")
    expect(CAPABILITY_SECTIONS.some((section) => section.group === "HRM")).toBe(false)
  })

  it.each([
    "/workforce", "/workforce/timesheet", "/%77orkforce/exceptions",
    "/api/v1/workforce/requests", "/api/v1/%77orkforce/today/action",
    "/api/v1/mtm/mobile/hrm", "/api/v1/mtm/mobile/workday",
    "/api/v1/mtm/mobile/attendance/devices/enrollments",
    "/api/v1/mtm/week/workday", "/api/v1/mtm/work-calendar/day",
    "/api/v1/mtm/operations/hrm/request/decision", "/api/v2/mtm/mobile/sync/workforce",
    "/api/cron/workforce-no-show-review", "/marketplace/demo/workforce-hrm",
    "/marketplace/demo/attendance-qr", "/marketplace/demo/attendance-device-trust",
  ])("withdraws the direct entry %s", (path) => expect(isWithdrawnCrmPath(path)).toBe(true))

  it.each([
    "/mtm/routes", "/api/v1/mtm/mobile/session", "/api/v1/mtm/mobile/sync/push",
    "/api/v1/mtm/work-calendar-extra", "/workforce-other", "/support", "/api/v1/tickets",
  ])("preserves the unrelated entry %s", (path) => expect(isWithdrawnCrmPath(path)).toBe(false))
})
