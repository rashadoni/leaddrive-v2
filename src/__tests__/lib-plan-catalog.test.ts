import { describe, it, expect } from "vitest"
import { FEATURE_CATALOG, ADDON_CATALOG, isKnownFeature, isKnownAddon } from "@/lib/plan-catalog"
import { TENANT_PLANS } from "@/lib/tenant-plans"

describe("plan-catalog", () => {
  it("every TENANT_PLANS feature is in FEATURE_CATALOG (drift guard)", () => {
    for (const plan of Object.values(TENANT_PLANS)) {
      for (const f of plan.features) expect(FEATURE_CATALOG).toContain(f)
    }
  })
  it("every TENANT_PLANS addon is in ADDON_CATALOG (drift guard)", () => {
    for (const plan of Object.values(TENANT_PLANS)) {
      for (const a of plan.addons) expect(ADDON_CATALOG).toContain(a)
    }
  })
  it("validators reject unknown keys", () => {
    expect(isKnownFeature("crm")).toBe(true)
    // Narrow-union: legacy fine-grained ids left the registry, so they are no
    // longer valid PLAN-TEMPLATE features (tenant Organization.features may
    // still carry them as data — hasModule's 3b expansion handles that).
    expect(isKnownFeature("deals")).toBe(false)
    expect(isKnownFeature("nope")).toBe(false)
    expect(isKnownAddon("ai")).toBe(true)
    expect(isKnownAddon("nope")).toBe(false)
  })
  // Regression pin (MC-T6): the catalogs derive from MODULE_REGISTRY/addon maps,
  // which now carry the group-module vocabulary. If a later refactor drops the
  // group ids from either source, plan validation would start rejecting
  // group-shaped PlanTemplate rows — this test fails first.
  it("FEATURE_CATALOG covers groups + flags; ADDON_CATALOG covers bundles + flags", () => {
    for (const g of ["crm", "marketing", "loyalty", "finance", "settings"]) expect(FEATURE_CATALOG).toContain(g)
    for (const f of ["whatsapp", "complaints_register"]) expect(FEATURE_CATALOG).toContain(f)
    for (const a of ["ai", "voip", "channels", "finance", "mtm", "marketing", "loyalty"]) expect(ADDON_CATALOG).toContain(a)
  })
})
