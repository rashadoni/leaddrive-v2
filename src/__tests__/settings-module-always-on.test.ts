import { describe, it, expect } from "vitest"
import { hasModule } from "@/lib/modules"
import { navItems, isNavItemEnabled, isNavItemRoleAllowed } from "@/lib/nav-items"
import { TENANT_MODULE_CONTROLS, TENANT_MODULE_SECTIONS } from "@/lib/admin-sidebar-catalog"

// Biznesdoktor on prod, 2026-11-06: saved in the tenant editor with Settings
// off. Its admin (bdadmin) had no Settings block, so no «Пользователи» and no
// «Голос» switch — the voice assistant could not be turned on from inside the
// tenant at all. This is that organisation's module record as stored.
const BIZNESDOKTOR = {
  plan: "starter",
  addons: [] as string[],
  modules: {
    ai: true, crm: true, mtm: false, voip: true, media: false, sales: true,
    energy: false, health: false, social: true, finance: false, loyalty: false,
    support: true, settings: false, analytics: false, contracts: true,
    insurance: false, marketing: true, omnichannel: true, "public-sector": false,
  },
}

const usersPage = navItems.find((item) => item.href === "/settings/users")

describe("Settings is always on for a tenant", () => {
  it("survives an explicit settings:false saved by the tenant editor", () => {
    expect(hasModule(BIZNESDOKTOR, "settings")).toBe(true)
    expect(hasModule({ plan: "starter", addons: [], modules: {} }, "settings")).toBe(true)
  })

  it("shows Settings → Users to that tenant's admin", () => {
    expect(usersPage).toBeDefined()
    const org = { ...BIZNESDOKTOR, role: "admin" }
    expect(isNavItemEnabled(org, usersPage!)).toBe(true)
    expect(isNavItemRoleAllowed(org, usersPage!)).toBe(true)
  })

  // viewer reads every page by wildcard — unchanged, and not this fix's business.
  it("still keeps the users page from roles that may not manage people", () => {
    for (const role of ["member", "sales", "support"]) {
      expect(isNavItemRoleAllowed({ ...BIZNESDOKTOR, role }, usersPage!), role).toBe(false)
    }
  })

  it("other modules switched off in the editor stay off", () => {
    expect(hasModule(BIZNESDOKTOR, "finance")).toBe(false)
    expect(hasModule(BIZNESDOKTOR, "analytics")).toBe(false)
  })

  it("the tenant editor offers no Settings switch that would do nothing", () => {
    expect(TENANT_MODULE_CONTROLS.some((control) => control.id === "settings")).toBe(false)
    for (const section of TENANT_MODULE_SECTIONS) {
      for (const item of section.items) expect(item.control.id, item.href).not.toBe("settings")
    }
  })
})
