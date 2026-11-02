import { describe, expect, it } from "vitest"
import { isCrmCapabilityAvailable } from "@/lib/crm-product-availability"
import { navItems } from "@/lib/nav-items"
import { isTenantCapabilityEnabled } from "@/lib/tenant-capabilities"
import {
  CAPABILITY_SECTIONS,
  TENANT_MODULE_SECTIONS,
  TENANT_MODULE_CONTROLS,
  SIDEBAR_SECTIONS,
  TOGGLEABLE_CAPABILITIES,
  TOGGLEABLE_MODULES,
  disableCapability,
  enableCapability,
  entitlementKeysForCapabilityId,
  isCapabilityEnabled,
} from "@/lib/admin-sidebar-catalog"

describe("admin capability catalog", () => {
  it("covers every available capability-gated area in the navigation", () => {
    const expected = new Set(
      navItems.flatMap((item) => {
        const capability = item.capability ?? item.tenantCapability
        return capability && isCrmCapabilityAvailable(capability) ? [capability] : []
      }),
    )
    expect(expected.size).toBeGreaterThan(0)
    expect(new Set(TOGGLEABLE_CAPABILITIES)).toEqual(expected)
    // Withdrawn capabilities cannot be enabled from the tenant editor.
    expect(TOGGLEABLE_CAPABILITIES).not.toContain("workforce-hrm")
  })

  it("omits archived HRM pages and keeps the Route & Field section", () => {
    expect(CAPABILITY_SECTIONS.find((section) => section.group === "HRM")).toBeUndefined()
    const routes = CAPABILITY_SECTIONS.find((section) => section.group === "Route & Field")!
    expect(routes.items.length).toBeGreaterThan(0)
    expect(routes.items.every((item) => item.capabilityId === "route-field")).toBe(true)
  })

  it("stays out of the module catalogue, which the module tests lock", () => {
    const moduleHrefs = new Set(SIDEBAR_SECTIONS.flatMap((s) => s.items.map((i) => i.href)))
    const capabilityOnlyHrefs = navItems
      .filter((item) => item.capability && !item.module)
      .map((item) => item.href)

    expect(capabilityOnlyHrefs.length).toBeGreaterThan(0)
    for (const href of capabilityOnlyHrefs) expect(moduleHrefs.has(href)).toBe(false)
    // And a capability id is never mistaken for a module id.
    for (const capability of TOGGLEABLE_CAPABILITIES) {
      expect(TOGGLEABLE_MODULES).not.toContain(capability)
    }
  })

  it("grants the capability's own entitlement, not a made-up key", () => {
    const keys = entitlementKeysForCapabilityId("workforce-hrm")
    expect(keys).toContain("workforce-hrm")
    expect(entitlementKeysForCapabilityId("not-a-capability")).toEqual([])
  })

  it("toggles additively, leaving every unrelated flag alone", () => {
    // `features` co-hosts AI-automation keys, social flags and group modules,
    // each driven by its own control. A capability toggle must touch only its
    // own keys — the same rule the module toggles follow.
    const before = ["crm", "sales", "ai_auto_lead_shadow", "social_discovery"]
    const on = enableCapability(before, "workforce-hrm")

    expect(isCapabilityEnabled(before, "workforce-hrm")).toBe(false)
    expect(isCapabilityEnabled(on, "workforce-hrm")).toBe(true)
    for (const flag of before) expect(on).toContain(flag)

    const off = disableCapability(on, "workforce-hrm")
    expect(isCapabilityEnabled(off, "workforce-hrm")).toBe(false)
    expect(off.sort()).toEqual([...before].sort())
  })

  it("does not double-write when granted twice", () => {
    const once = enableCapability(["crm"], "workforce-hrm")
    const twice = enableCapability(once, "workforce-hrm")
    expect(twice).toEqual(once)
  })

  it("cannot reactivate withdrawn HRM by changing the stored features array", () => {
    // Archived entitlement helpers remain available for extraction. Runtime
    // access stays closed independently of the raw flags.
    const tenant = { plan: "professional", role: "admin", addons: [] as string[] }
    const asModules = (features: string[]) => Object.fromEntries(features.map((f) => [f, true]))

    const off = ["crm", "sales"]
    const on = enableCapability(off, "workforce-hrm")

    expect(isTenantCapabilityEnabled("workforce-hrm", { ...tenant, features: on, modules: asModules(on) })).toBe(false)

    const revoked = disableCapability(on, "workforce-hrm")
    expect(
      isTenantCapabilityEnabled("workforce-hrm", { ...tenant, features: revoked, modules: asModules(revoked) }),
    ).toBe(false)
  })

  it("unifies module and capability pages once, with each actual gate", () => {
    const routes = TENANT_MODULE_SECTIONS.find((section) => section.group === "Route & Field")!
    expect(routes.controls).toEqual([
      { kind: "capability", id: "route-field" }, { kind: "module", id: "mtm" },
    ])
    expect(routes.items.find((item) => item.href === "/mtm")?.control.id).toBe("route-field")
    expect(routes.items.find((item) => item.href === "/mtm/settings")?.control.id).toBe("mtm")
    expect(TENANT_MODULE_SECTIONS.find((section) => section.group === "Personnel")?.controls)
      .toEqual([{ kind: "capability", id: "personnel" }])
    const hrefs = TENANT_MODULE_SECTIONS.flatMap((section) => section.items.map((item) => item.href))
    expect(new Set(hrefs).size).toBe(hrefs.length)
    expect(new Set(hrefs)).toEqual(new Set(navItems.filter((item) => {
      const capability = item.capability ?? item.tenantCapability
      return capability ? isCrmCapabilityAvailable(capability) : Boolean(item.module)
    }).map((item) => item.href)))
    expect(TENANT_MODULE_CONTROLS.map((control) => control.id)).not.toContain("workforce-hrm")
  })
})
