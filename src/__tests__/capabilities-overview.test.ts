import { describe, expect, it } from "vitest"
import { CAPABILITIES_OVERVIEW_CATALOG, resolveCapabilitiesOverview } from "@/lib/capabilities-overview"
import { GROUP_MODULE_IDS } from "@/lib/modules"
import en from "../../messages/en.json"
import ru from "../../messages/ru.json"
import az from "../../messages/az.json"

const org = {
  plan: "enterprise",
  features: ["crm", "sales", "settings"],
  modules: { crm: true, sales: true, settings: true, mtm: false, omnichannel: false },
  addons: [],
  settings: {},
}
const admin = { role: "admin" as const }
const find = (overview: ReturnType<typeof resolveCapabilitiesOverview>, id: string) => overview.capabilities.find(item => item.id === id)!

describe("capabilities overview access", () => {
  it("covers every native module without offering withdrawn products or template installs", () => {
    expect(GROUP_MODULE_IDS.every(module => CAPABILITIES_OVERVIEW_CATALOG.some(item => item.module === module))).toBe(true)
    expect(CAPABILITIES_OVERVIEW_CATALOG.some(item => item.id.startsWith("workforce") || item.id.startsWith("attendance-") || item.id === "lead-scoring-rules")).toBe(false)
  })

  it("opens granted workspaces and does not create links for ungranted modules", () => {
    const overview = resolveCapabilitiesOverview(org, admin, 2)
    expect(find(overview, "sales")).toMatchObject({ status: "available", openHref: "/deals", setupHref: "/settings/pipelines" })
    expect(find(overview, "omnichannel")).toMatchObject({ status: "requires_access", openHref: null, setupHref: null })
    expect(overview.installedAppsCount).toBe(2)
  })

  it("retains legacy MTM access but respects a later explicit capability disable", () => {
    const legacy = { ...org, features: ["crm", "sales", "settings", "mtm"], modules: { crm: true, sales: true, settings: true, mtm: true } }
    expect(find(resolveCapabilitiesOverview(legacy, admin), "route-field").openHref).toBe("/mtm/routes")
    expect(find(resolveCapabilitiesOverview({ ...legacy, modules: { ...legacy.modules, "route-field": false } }, admin), "route-field")).toMatchObject({ status: "requires_access", openHref: null, setupHref: null })
  })

  it("never turns superadmin navigation bypass into a tenant entitlement", () => {
    const overview = resolveCapabilitiesOverview(org, { role: "superadmin" })
    expect(find(overview, "omnichannel")).toMatchObject({ status: "requires_access", openHref: null, setupHref: null })
  })

  it("respects per-user module restrictions and hides configuration actions from employees", () => {
    const overview = resolveCapabilitiesOverview(org, { role: "viewer", hiddenModules: ["sales"] })
    expect(find(overview, "sales")).toMatchObject({ status: "restricted", openHref: null, setupHref: null })
    expect(find(overview, "crm").openHref).not.toBeNull()
    expect(overview.canManage).toBe(false)
    expect(overview.capabilities.every(item => item.setupHref === null)).toBe(true)
  })

  it("keeps attendance opt-in and exposes only its existing settings to admins", () => {
    const personnel = { ...org, modules: { ...org.modules, personnel: true }, settings: { attendanceEnabled: false } }
    expect(find(resolveCapabilitiesOverview(personnel, admin), "personnel").openHref).toBe("/mtm/attendance/settings")
    expect(find(resolveCapabilitiesOverview(personnel, { role: "viewer" }), "personnel")).toMatchObject({ status: "restricted", openHref: null })
    const legacy = { ...personnel, modules: { ...personnel.modules, mtm: true } }
    expect(find(resolveCapabilitiesOverview(legacy, { role: "viewer" }), "personnel")).toMatchObject({ status: "restricted", openHref: null })
  })

  it("reports existing requests without inventing an approval or enabling access", () => {
    const pending = { ...org, settings: { marketplaceCapabilities: { requested: { "route-field": true } } } }
    expect(find(resolveCapabilitiesOverview(pending, admin), "route-field")).toMatchObject({ status: "requested", openHref: null, setupHref: null })
    expect(org.modules.mtm).toBe(false)
  })

  it("does not advertise industry products that the tenant does not have", () => {
    expect(resolveCapabilitiesOverview(org, admin).capabilities.some(item => item.goal === "industry")).toBe(false)
    expect(find(resolveCapabilitiesOverview({ ...org, modules: { ...org.modules, health: true } }, admin), "health").status).toBe("available")
  })

  it("provides complete customer-facing descriptions in every locale", () => {
    for (const messages of [en, ru, az]) {
      const copy = messages.capabilitiesPage
      for (const definition of CAPABILITIES_OVERVIEW_CATALOG) {
        const moduleCopy = copy.modules[definition.id as keyof typeof copy.modules]
        expect(moduleCopy.name.length).toBeGreaterThan(2)
        expect(moduleCopy.summary.length).toBeGreaterThan(10)
        expect(moduleCopy.benefits.length).toBeGreaterThan(0)
      }
    }
  })
})
