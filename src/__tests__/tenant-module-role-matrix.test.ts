/**
 * Every module × every role × every shape a tenant's module record takes on
 * prod — the full grid behind «Настройки всегда включены» (2026-11-06).
 *
 * Biznesdoktor was saved in the tenant editor with Settings off, and its admin
 * had no Settings block: no Users, no «Голос». Making Settings always-on fixed
 * that one cell. This grid is here so the fix is not checked on one tenant and
 * one role: for each cell it asks the four places that decide what a person
 * gets — the menu, the page guard of the dashboard layout, the API's module
 * gate, and the landing page after sign-in — and requires them to agree.
 *
 * Nothing is mocked that decides access: nav-items, modules, permissions,
 * tenant-landing and moduleAccessDenial are the real ones. Only prisma and
 * next-auth are stubbed, so api-auth can load.
 */
import { describe, it, expect, vi } from "vitest"

vi.mock("@/lib/prisma", () => ({ prisma: {}, logAudit: vi.fn() }))
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))

import {
  navItems,
  accessibleNavItems,
  isNavItemEnabled,
  isNavPathRoleBlocked,
  matchNavItem,
  navItemPathname,
  type NavItem,
  type OrgNavContext,
} from "@/lib/nav-items"
import { hasModule, GROUP_MODULE_IDS, ADDON_FLAG_IDS, MODULE_REGISTRY, type ModuleId } from "@/lib/modules"
import { checkPermission, MODULES, PERMISSION_MODULE_TO_MODULE_ID, type Action } from "@/lib/permissions"
import { resolveTenantLandingPath } from "@/lib/tenant-landing"
import { moduleAccessDenial } from "@/lib/api-auth"

const TOGGLED: ModuleId[] = [...GROUP_MODULE_IDS, ...ADDON_FLAG_IDS]

// Every role the code knows, plus "member": Biznesdoktor has two users with it
// on prod, and it is not in the Role type — the grid must say what they get.
const ROLES = ["superadmin", "admin", "manager", "sales", "support", "ticketing", "viewer", "reviewer", "member"] as const

type Org = { label: string; plan: string; addons: string[]; modules: Record<string, boolean> }

const allTo = (value: boolean) => Object.fromEntries(TOGGLED.map((m) => [m, value]))

/** The record exactly as it sits on prod for Biznesdoktor (2026-11-06). */
const BIZNESDOKTOR: Org = {
  label: "Biznesdoktor as on prod",
  plan: "starter",
  addons: [],
  modules: {
    ai: true, crm: true, mtm: false, voip: true, media: false, sales: true,
    energy: false, health: false, social: true, finance: false, loyalty: false,
    support: true, settings: false, analytics: false, contracts: true,
    insurance: false, marketing: true, omnichannel: true, "public-sector": false,
  },
}

const ORGS: Org[] = [
  BIZNESDOKTOR,
  { label: "every module on", plan: "enterprise", addons: [], modules: allTo(true) },
  { label: "every module saved off", plan: "starter", addons: [], modules: allTo(false) },
  { label: "empty record (Clear All)", plan: "starter", addons: [], modules: {} },
  // One tenant per module, everything else explicitly OFF — Settings too, as
  // the editor writes it. This is where a module leaking into another, or
  // Settings disappearing, would show.
  ...TOGGLED.filter((m) => m !== "settings").map((m) => ({
    label: `only ${m}`,
    plan: "starter",
    addons: [] as string[],
    modules: { ...allTo(false), [m]: true },
  })),
]

function ctx(org: Org, role: string): OrgNavContext {
  return { plan: org.plan, addons: org.addons, modules: org.modules, role }
}

/** The dashboard layout's guard, as layout.tsx computes it for a URL. */
function pageRefused(org: OrgNavContext, path: string): "module" | "role" | null {
  const pathname = navItemPathname(path)
  const item = matchNavItem(pathname)
  const moduleBlocked = org.role !== "superadmin" && !!item && !item.pageUngated && !isNavItemEnabled(org, item)
  if (moduleBlocked) return "module"
  return isNavPathRoleBlocked(org, pathname) ? "role" : null
}

/** A nav item whose visibility is decided by its group module alone. */
function plainModuleItem(item: NavItem): item is NavItem & { module: ModuleId } {
  return Boolean(item.module) && !item.feature && !item.addon && !item.capability
    && !item.tenantCapability && !item.orgSetting
}

const settingsItems = navItems.filter((item) => item.group === "Settings")

describe.each(ORGS)("tenant: $label", (org) => {
  it("Settings is granted whatever the record says", () => {
    expect(hasModule(org, "settings")).toBe(true)
  })

  it("every other module is granted exactly as the record says", () => {
    if (!org.label.startsWith("only ") && org.label !== "every module saved off") return
    for (const m of TOGGLED) {
      if (m === "settings") continue
      expect(hasModule(org, m), m).toBe(org.modules[m] === true)
    }
  })

  describe.each(ROLES)("role %s", (role) => {
    const nav = ctx(org, role)
    const shown = accessibleNavItems(nav)

    it("the menu never offers a page the layout then refuses", () => {
      const refused = shown
        .filter((item) => matchNavItem(navItemPathname(item.href)) === item)
        .map((item) => [item.href, pageRefused(nav, item.href)])
        .filter(([, why]) => why !== null)
      expect(refused).toEqual([])
    })

    it("a Settings page is withheld only for the role, never for the module", () => {
      for (const item of settingsItems) {
        if (item.feature || item.addon || item.capability || item.tenantCapability) continue
        expect(isNavItemEnabled(nav, item), item.href).toBe(true)
        if (matchNavItem(navItemPathname(item.href)) !== item) continue
        expect(pageRefused(nav, item.href), item.href).not.toBe("module")
      }
    })

    it("a page of a switched-off module is closed in the menu AND by URL", () => {
      if (role === "superadmin") return // superadmin sees every module by design
      for (const item of navItems.filter(plainModuleItem)) {
        if (item.module === "settings" || hasModule(org, item.module)) continue
        expect(shown.includes(item), item.href).toBe(false)
        if (item.pageUngated || matchNavItem(navItemPathname(item.href)) !== item) continue
        expect(pageRefused(nav, item.href), item.href).toBe("module")
      }
    })

    it("lands on a page this person can open", () => {
      if (role === "superadmin") return
      // An outside reviewer gets no Settings at all (reviewer-access.ts); in a
      // tenant with no working module there is nothing for them to open, and
      // the resolver's last resort is /dashboard. Pre-existing, by design.
      if (role === "reviewer" && shown.length === 0) return
      const landing = resolveTenantLandingPath(nav)
      expect([landing, pageRefused(nav, landing)]).toEqual([landing, null])
    })
  })
})

describe("who reaches Settings → Users (where «Голос» is switched on)", () => {
  // viewer reads everything by wildcard — pre-existing, unchanged here.
  const EXPECTED: Record<(typeof ROLES)[number], boolean> = {
    superadmin: true, admin: true, viewer: true,
    manager: false, sales: false, support: false, ticketing: false, reviewer: false, member: false,
  }
  const users = navItems.find((item) => item.href === "/settings/users")!

  it.each(ORGS)("in tenant: $label", (org) => {
    for (const role of ROLES) {
      const nav = ctx(org, role)
      const got = { menu: accessibleNavItems(nav).includes(users), page: pageRefused(nav, "/settings/users") === null }
      expect([role, got]).toEqual([role, { menu: EXPECTED[role], page: EXPECTED[role] }])
    }
  })
})

describe("API module gate (moduleAccessDenial) agrees with the menu", () => {
  const ACTIONS: Action[] = ["read", "write", "delete", "admin"]
  // The gate translates a permission scope the way api-auth does.
  const gateOf = (scope: string) => PERMISSION_MODULE_TO_MODULE_ID[scope] ?? scope
  const settingsScopes = MODULES.filter((m) => gateOf(m) === "settings")

  it("knows which permission scopes are Settings", () => {
    expect(settingsScopes).toEqual(expect.arrayContaining(["settings", "users", "audit"]))
  })

  it.each(ORGS)("Settings scopes answer by role only — tenant: $label", (org) => {
    const orgContext = { plan: org.plan, addons: org.addons, modules: org.modules }
    for (const role of ROLES) for (const scope of settingsScopes) for (const action of ACTIONS) {
      const denial = moduleAccessDenial({ role: role as never, hiddenModules: [] }, orgContext, scope, action)
      expect([role, scope, action, denial === null]).toEqual([role, scope, action, checkPermission(role as never, scope, action)])
    }
  })

  it.each(ORGS.filter((org) => org.label.startsWith("only ")))("other scopes follow the module — tenant: $label", async (org) => {
    const orgContext = { plan: org.plan, addons: org.addons, modules: org.modules }
    for (const scope of MODULES) {
      const gateModule = gateOf(scope)
      if (gateModule === "settings" || !(gateModule in MODULE_REGISTRY)) continue
      if (!checkPermission("admin", scope, "read")) continue
      const denial = moduleAccessDenial({ role: "admin", hiddenModules: [] }, orgContext, scope, "read")
      const open = hasModule(orgContext, gateModule as ModuleId)
      expect([scope, denial === null]).toEqual([scope, open])
      if (!open) {
        expect(denial!.status).toBe(403)
        expect((await denial!.json()).message).toMatch(/is not enabled for your organization/)
      }
    }
  })
})
