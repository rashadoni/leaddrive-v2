import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { navItems } from "@/lib/nav-items"
import { isTenantCapabilityEnabled } from "@/lib/tenant-capabilities"
import {
  CAPABILITY_SECTIONS,
  SIDEBAR_SECTIONS,
  TOGGLEABLE_CAPABILITIES,
  TOGGLEABLE_MODULES,
  disableCapability,
  enableCapability,
  entitlementKeysForCapabilityId,
  isCapabilityEnabled,
} from "@/lib/admin-sidebar-catalog"

function source(path: string): string {
  return readFileSync(path, "utf8")
}

/**
 * Some sidebar areas are gated by a tenant capability rather than a group
 * module: `capability` where there is no group module at all (HRM), and
 * `tenantCapability` for a capability layered inside a historical group module
 * (Route & Field).
 *
 * They are deliberately kept out of the module catalogue — a Workforce grant
 * must not read as an MTM module toggle — but the consequence was that the
 * superadmin tenant editor had no control for them at all: HRM could not be
 * turned on or off anywhere, which is what the owner ran into. They get their
 * own card, built from the same navigation the sidebar renders.
 */
describe("admin capability catalog", () => {
  it("covers every capability-gated area in the navigation", () => {
    const expected = new Set(
      navItems.flatMap((item) => {
        const capability = item.capability ?? item.tenantCapability
        return capability ? [capability] : []
      }),
    )
    expect(expected.size).toBeGreaterThan(0)
    expect(new Set(TOGGLEABLE_CAPABILITIES)).toEqual(expected)
    // The one the owner asked about.
    expect(TOGGLEABLE_CAPABILITIES).toContain("workforce-hrm")
  })

  it("lists the pages each capability unlocks, grouped like the sidebar", () => {
    const hrm = CAPABILITY_SECTIONS.find((section) => section.group === "HRM")
    expect(hrm, "HRM has no group module, so it can only appear here").toBeTruthy()
    expect(hrm!.items.length).toBeGreaterThan(0)
    for (const item of hrm!.items) {
      expect(item.capabilityId).toBe("workforce-hrm")
      expect(item.href.startsWith("/")).toBe(true)
      expect(item.tKey).toBeTruthy()
    }
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

  it("actually changes access, not just the features array", () => {
    // The point of the switch is that the tenant gains or loses the pages. A
    // toggle that only rewrites a string list would look right in the editor
    // and do nothing in the product, which is the failure worth guarding.
    const tenant = { plan: "professional", role: "admin", addons: [] as string[] }
    const asModules = (features: string[]) => Object.fromEntries(features.map((f) => [f, true]))

    const off = ["crm", "sales"]
    const on = enableCapability(off, "workforce-hrm")

    expect(isTenantCapabilityEnabled("workforce-hrm", { ...tenant, features: on, modules: asModules(on) })).toBe(true)

    const revoked = disableCapability(on, "workforce-hrm")
    expect(
      isTenantCapabilityEnabled("workforce-hrm", { ...tenant, features: revoked, modules: asModules(revoked) }),
    ).toBe(false)
  })

  it("is rendered by the tenant editor as its own card", () => {
    const editor = source("src/app/admin/tenants/[id]/edit/page.tsx")
    expect(editor).toContain("CAPABILITY_SECTIONS")
    expect(editor).toContain("data-tenant-capability={capabilityId}")
    expect(editor).toContain("enableCapability(f.features, capabilityId)")
    expect(editor).toContain("disableCapability(f.features, capabilityId)")
    // Separate card, not folded into the module count.
    expect(editor).toContain('t("tenants.capabilities")')
    expect(editor).toContain("countEnabledModules(form.features)")
  })
})
