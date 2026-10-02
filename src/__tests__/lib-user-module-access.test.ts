import { describe, expect, it } from "vitest"
import { GROUP_MODULE_IDS, hasModule } from "@/lib/modules"
import { isTenantCapabilityEnabled } from "@/lib/tenant-capabilities"
import { accessibleNavItems } from "@/lib/nav-items"
import {
  applyUserModuleMask,
  effectiveHiddenModules,
  hideableIdForUngatedApiPath,
  moduleContextForUser,
  normalizeHiddenModules,
  parseHiddenModulesInput,
  tenantHideableModules,
  USER_HIDEABLE_MODULE_IDS,
} from "@/lib/user-module-access"

const allOn = Object.fromEntries(GROUP_MODULE_IDS.map((id) => [id, true]))
const org = (modules: Record<string, boolean> | undefined, addons: string[] = []) => ({
  plan: "enterprise",
  addons,
  modules,
})
const masked = (
  modules: Record<string, boolean> | undefined,
  hidden: string[],
  addons: string[] = [],
) => ({ plan: "enterprise", addons, modules: applyUserModuleMask(org(modules, addons), hidden) })

describe("the hideable catalog", () => {
  it("offers every sidebar group except Settings, plus Workforce HRM", () => {
    // The list is spelled out in user-module-access.ts; this is what keeps a
    // newly added group-module from being left un-hideable (and un-pinned).
    expect(USER_HIDEABLE_MODULE_IDS).toEqual([
      ...GROUP_MODULE_IDS.filter((id) => id !== "settings"),
      "workforce-hrm",
    ])
  })

  it("drops unknown ids, duplicates and non-arrays when reading a stored list", () => {
    expect(normalizeHiddenModules(["sales", "sales", "settings", "nope", 7])).toEqual(["sales"])
    expect(normalizeHiddenModules(null)).toEqual([])
    expect(normalizeHiddenModules("sales")).toEqual([])
  })

  it("rejects an unknown id on write instead of silently not applying it", () => {
    expect(parseHiddenModulesInput("sales", ["sales", "finance"])).toEqual(["sales", "finance"])
    expect(parseHiddenModulesInput("sales", ["salez"])).toBeNull()
    expect(parseHiddenModulesInput("sales", ["settings"])).toBeNull()
  })

  it("never restricts an admin, whatever is stored", () => {
    expect(effectiveHiddenModules("admin", ["sales"])).toEqual([])
    expect(effectiveHiddenModules("superadmin", ["sales"])).toEqual([])
    expect(parseHiddenModulesInput("admin", ["sales"])).toEqual([])
    expect(effectiveHiddenModules("manager", ["sales"])).toEqual(["sales"])
  })

  it("lists only what the tenant has", () => {
    expect(tenantHideableModules(org({ crm: true, sales: true, settings: true }))).toEqual(["crm", "sales"])
    // The historical `mtm` grant dual-reads as both field capabilities.
    expect(tenantHideableModules(org({ crm: true, mtm: true }))).toEqual(["crm", "mtm", "workforce-hrm"])
    // A Workforce-only tenant has HRM without Route & Field.
    expect(tenantHideableModules(org({ crm: true, "workforce-hrm": true }))).toEqual(["crm", "workforce-hrm"])
  })
})

describe("applyUserModuleMask", () => {
  it("returns the tenant's record untouched for an unrestricted user", () => {
    const modules = { crm: true }
    expect(applyUserModuleMask(org(modules), [])).toBe(modules)
    expect(applyUserModuleMask(org(undefined), [])).toBeUndefined()
  })

  it("hides exactly the listed modules and keeps the rest", () => {
    const ctx = masked(allOn, ["sales", "finance"])
    expect(hasModule(ctx, "sales")).toBe(false)
    expect(hasModule(ctx, "finance")).toBe(false)
    const rest = GROUP_MODULE_IDS.filter((id) => id !== "sales" && id !== "finance")
    expect(rest.filter((id) => !hasModule(ctx, id))).toEqual([])
  })

  it("never grants a module the tenant does not have", () => {
    const ctx = masked({ crm: true, settings: true, sales: false }, ["finance"])
    expect(GROUP_MODULE_IDS.filter((id) => hasModule(ctx, id))).toEqual(["crm", "settings"])
  })

  it("beats an addon grant", () => {
    expect(hasModule(org({ crm: true }, ["voip"]), "voip")).toBe(true)
    expect(hasModule(masked({ crm: true }, ["voip"], ["voip"]), "voip")).toBe(false)
  })

  // A legacy-shaped record resolves its groups by expansion (core → crm,
  // tickets → support). Writing a lone `crm: false` would switch expansion off
  // and take Support away as well; the mask must pin what it did not hide.
  it("keeps a legacy-shaped tenant's other modules when one is hidden", () => {
    const legacy = { core: true, tickets: true, invoices: true }
    expect(hasModule(org(legacy), "support")).toBe(true)
    const ctx = masked(legacy, ["crm"])
    expect(hasModule(ctx, "crm")).toBe(false)
    expect(hasModule(ctx, "support")).toBe(true)
    expect(hasModule(ctx, "finance")).toBe(true)
  })

  it("keeps non-group keys such as feature flags", () => {
    const ctx = masked({ ...allOn, ai_smart_search: true }, ["sales"])
    expect(ctx.modules?.ai_smart_search).toBe(true)
  })

  describe("Route & Field and Workforce HRM", () => {
    const fieldTenant = { crm: true, mtm: true, settings: true }

    it("hiding Route & Field keeps HRM that was living on the mtm grant", () => {
      const ctx = masked(fieldTenant, ["mtm"])
      expect(isTenantCapabilityEnabled("route-field", ctx)).toBe(false)
      expect(isTenantCapabilityEnabled("workforce-hrm", ctx)).toBe(true)
      expect(hasModule(ctx, "mtm")).toBe(false)
    })

    it("hiding HRM keeps Route & Field", () => {
      const ctx = masked(fieldTenant, ["workforce-hrm"])
      expect(isTenantCapabilityEnabled("workforce-hrm", ctx)).toBe(false)
      expect(isTenantCapabilityEnabled("route-field", ctx)).toBe(true)
      expect(hasModule(ctx, "mtm")).toBe(true)
    })

    it("hiding both leaves neither", () => {
      const ctx = masked(fieldTenant, ["mtm", "workforce-hrm"])
      expect(isTenantCapabilityEnabled("route-field", ctx)).toBe(false)
      expect(isTenantCapabilityEnabled("workforce-hrm", ctx)).toBe(false)
    })

    it("does not hand a capability to a tenant that lacks it", () => {
      const ctx = masked({ crm: true, sales: true }, ["sales"])
      expect(isTenantCapabilityEnabled("route-field", ctx)).toBe(false)
      expect(isTenantCapabilityEnabled("workforce-hrm", ctx)).toBe(false)
    })
  })
})

describe("what the restricted user's menu shows", () => {
  const groupsFor = (hidden: string[]) => [
    ...new Set(
      accessibleNavItems({ ...masked({ ...allOn, mtm: true }, hidden), role: "sales" }).map((item) => item.group),
    ),
  ]

  it("drops the hidden groups from the sidebar and nothing else", () => {
    const before = groupsFor([])
    const after = groupsFor(["sales", "marketing", "mtm"])
    expect(before).toEqual(expect.arrayContaining(["Sales", "Marketing", "Route & Field", "HRM"]))
    expect(before.filter((group) => !after.includes(group))).toEqual(["Sales", "Marketing", "Route & Field"])
  })

  it("can leave a field rep with Route & Field alone", () => {
    const everythingElse = USER_HIDEABLE_MODULE_IDS.filter((id) => id !== "mtm")
    expect(groupsFor([...everythingElse]).filter((group) => group !== "Settings")).toEqual(["Route & Field"])
  })
})

describe("moduleContextForUser", () => {
  const context = { plan: "enterprise", addons: [] as string[], modules: { ...allOn } }

  it("is the tenant's context for an unrestricted caller", () => {
    expect(moduleContextForUser(context, {})).toBe(context)
    expect(moduleContextForUser(context, { hiddenModules: [] })).toBe(context)
  })

  it("switches the caller's hidden modules off", () => {
    const ctx = moduleContextForUser(context, { hiddenModules: ["sales"] })
    expect(hasModule(ctx, "sales")).toBe(false)
    expect(hasModule(ctx, "crm")).toBe(true)
    expect(hasModule(context, "sales")).toBe(true)
  })
})

// The proxy's tenant gate skips these namespaces, so the per-user check has to
// name them itself or a hidden module would stay readable by URL.
describe("hideableIdForUngatedApiPath", () => {
  it("maps the finance APIs outside /api/v1 and the Workforce namespace", () => {
    expect(hideableIdForUngatedApiPath("/api/finance/receivables")).toBe("finance")
    expect(hideableIdForUngatedApiPath("/api/budgeting/plans/1")).toBe("finance")
    expect(hideableIdForUngatedApiPath("/api/cost-model")).toBe("finance")
    expect(hideableIdForUngatedApiPath("/api/v1/workforce/timesheet")).toBe("workforce-hrm")
  })

  it("matches on a path-segment boundary only", () => {
    expect(hideableIdForUngatedApiPath("/api/financelike")).toBeNull()
    expect(hideableIdForUngatedApiPath("/api/v1/workforce-export")).toBeNull()
    expect(hideableIdForUngatedApiPath("/api/v1/deals")).toBeNull()
  })
})
