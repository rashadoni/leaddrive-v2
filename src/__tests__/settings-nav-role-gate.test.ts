import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import {
  accessibleNavItems, isNavPathRoleBlocked, navItems, orgFromSession, type OrgNavContext,
} from "@/lib/nav-items"
import { checkPermission, type Role } from "@/lib/permissions"
import { resolveTenantLandingPath } from "@/lib/tenant-landing"
import {
  USER_HIDEABLE_MODULE_IDS, applyUserModuleMask, effectiveHiddenModules,
} from "@/lib/user-module-access"

// Reported by the owner on Zeytun Pharma, 2026-10-02: a manager who had been
// left with the Route & Field module alone still had the whole Settings block
// in the menu, and /settings/users drew Edit / Reset password / Delete on her
// colleagues. The module mask was working — `settings` is deliberately not
// hideable — and nothing else was looking at the role. No mocks here: the real
// navItems, the real role matrix and the real mask.

const TENANT = {
  plan: "enterprise",
  addons: [] as string[],
  modules: {
    crm: true, sales: true, marketing: true, support: true, finance: true,
    analytics: true, omnichannel: true, mtm: true, settings: true, ai: true, voip: true,
  } as Record<string, boolean>,
}

/** The session user exactly as the JWT callback builds it for this person. */
function sessionUser(role: Role, storedHidden: readonly string[] = []) {
  const hiddenModules = effectiveHiddenModules(role, storedHidden)
  return {
    plan: TENANT.plan,
    addons: TENANT.addons,
    role,
    hiddenModules,
    modules: applyUserModuleMask(TENANT, hiddenModules),
  }
}

const navFor = (role: Role, storedHidden: readonly string[] = []): OrgNavContext =>
  orgFromSession(sessionUser(role, storedHidden))

const settingsHrefs = (org: OrgNavContext) =>
  accessibleNavItems(org).filter((item) => item.group === "Settings").map((item) => item.href)

const ROUTE_AND_FIELD_ONLY = USER_HIDEABLE_MODULE_IDS.filter((id) => id !== "mtm")

describe("Settings menu follows the role, not only the tenant module", () => {
  it("a manager left with Route & Field alone gets nothing of Settings but her own notifications", () => {
    const org = navFor("manager", ROUTE_AND_FIELD_ONLY)
    const groups = [...new Set(accessibleNavItems(org).map((item) => item.group))]

    expect(groups).toEqual(["Route & Field", "Settings"])
    expect(settingsHrefs(org)).toEqual(["/settings/notifications"])
  })

  it("an unrestricted manager keeps the audit journal and nothing that administers the organization", () => {
    expect(settingsHrefs(navFor("manager"))).toEqual(["/settings/audit-log", "/settings/notifications"])
  })

  it.each(["sales", "support", "ticketing"] as const)("%s sees only personal notifications", (role) => {
    expect(settingsHrefs(navFor(role))).toEqual(["/settings/notifications"])
  })

  it("an organization-defined role, which the matrix denies everything, gets no administration page", () => {
    const org = orgFromSession({ ...sessionUser("manager"), role: "regional-lead" })
    expect(settingsHrefs(org)).toEqual(["/settings/notifications"])
  })

  it("an admin still sees the entire block", () => {
    const all = navItems.filter((item) => item.group === "Settings").map((item) => item.href)
    expect(all.length).toBeGreaterThan(15)
    expect(settingsHrefs(navFor("admin"))).toEqual(all)
  })

  it("an admin is never narrowed by a stored mask, the audit journal included", () => {
    expect(settingsHrefs(navFor("admin", ROUTE_AND_FIELD_ONLY))).toContain("/settings/audit-log")
  })

  it("a viewer reads the configuration but is not offered the admin-only pages", () => {
    const hrefs = settingsHrefs(navFor("viewer"))
    expect(hrefs).toContain("/settings/organization")
    expect(hrefs).toContain("/settings/users")
    for (const adminOnly of [
      "/settings/billing", "/settings/roles", "/settings/security", "/settings/api-keys", "/settings/voip",
    ]) {
      expect(hrefs).not.toContain(adminOnly)
    }
  })

  it("the audit journal is withheld from anyone a module was hidden from", () => {
    expect(settingsHrefs(navFor("manager", ["finance"]))).not.toContain("/settings/audit-log")
    expect(settingsHrefs(navFor("viewer", ["finance"]))).not.toContain("/settings/audit-log")
  })
})

describe("Settings pages refuse by URL what the menu withholds", () => {
  const restricted = navFor("manager", ROUTE_AND_FIELD_ONLY)

  it("blocks the administration pages for a manager", () => {
    for (const path of [
      "/settings/users", "/settings/organization", "/settings/smtp-settings", "/settings/workflows",
      "/settings/workflows/templates", "/settings/api-keys", "/settings/roles", "/marketplace",
    ]) {
      expect([path, isNavPathRoleBlocked(restricted, path)]).toEqual([path, true])
    }
  })

  it("blocks the audit journal for a restricted manager and opens it for an unrestricted one", () => {
    expect(isNavPathRoleBlocked(restricted, "/settings/audit-log")).toBe(true)
    expect(isNavPathRoleBlocked(navFor("manager"), "/settings/audit-log")).toBe(false)
  })

  it("leaves the person's own notifications, the hub and unlisted pages alone", () => {
    for (const path of ["/settings/notifications", "/settings", "/profile", "/mtm/map"]) {
      expect([path, isNavPathRoleBlocked(restricted, path)]).toEqual([path, false])
    }
  })

  it("blocks nothing for an admin", () => {
    const admin = navFor("admin")
    const blocked = navItems.map((item) => item.href).filter((href) => isNavPathRoleBlocked(admin, href))
    expect(blocked).toEqual([])
  })

  it("does not turn a hidden menu entry outside Settings into a refused page", () => {
    // Workforce admits people through per-person grants the role matrix does
    // not know about: its menu rule hides, the API decides.
    const manager = navFor("manager")
    expect(accessibleNavItems(manager).some((item) => item.href === "/workforce/configuration")).toBe(false)
    expect(isNavPathRoleBlocked(manager, "/workforce/configuration")).toBe(false)
  })
})

describe("landing page after sign-in", () => {
  // "/" redirects to the first page the person can open. With every module
  // hidden, that used to be /settings/organization — a page of 403s.
  const everythingHidden = { ...sessionUser("manager", USER_HIDEABLE_MODULE_IDS), landingPath: undefined }

  it("never lands a person on a Settings page the layout would refuse", () => {
    const landing = resolveTenantLandingPath(everythingHidden)
    expect(landing).toBe("/settings/notifications")
    expect(isNavPathRoleBlocked(orgFromSession(everythingHidden), landing)).toBe(false)
  })

  it("the proxy hands the resolver the person's hidden modules", () => {
    const proxy = readFileSync("src/proxy.ts", "utf8")
    const call = proxy.slice(proxy.indexOf("resolveTenantLandingPath({"))
    expect(call.slice(0, call.indexOf("})"))).toContain("hiddenModules:")
  })
})

describe("the Settings block cannot drift back to module-only gating", () => {
  const settingsItems = navItems.filter((item) => item.group === "Settings")

  it("every item names who it is for; only the personal page is open to all", () => {
    const undeclared = settingsItems
      .filter((item) => !item.permissionScope && !item.allowedRoles)
      .map((item) => item.href)
    expect(undeclared).toEqual(["/settings/notifications"])
  })

  it("no role without `settings` read is offered a page scoped to it", () => {
    const leaks: string[] = []
    for (const role of ["manager", "sales", "support", "ticketing"] as const) {
      expect(checkPermission(role, "settings", "read")).toBe(false)
      for (const href of settingsHrefs(navFor(role))) {
        const item = settingsItems.find((candidate) => candidate.href === href)
        if (item?.permissionScope === "settings" || item?.allowedRoles) leaks.push(`${role}: ${href}`)
      }
    }
    expect(leaks).toEqual([])
  })

  it("the pages the proxy bounces non-admins from are admin-only in the menu too", () => {
    const proxy = readFileSync("src/proxy.ts", "utf8")
    const list = proxy.match(/const ADMIN_ONLY_SETTINGS = \[([^\]]+)\]/)
    const bounced = [...(list?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((match) => match[1])
    expect(bounced.length).toBeGreaterThan(0)

    const notAdminOnly = bounced.filter((href) => {
      const item = settingsItems.find((candidate) => candidate.href === href)
      return !item?.allowedRoles || item.allowedRoles.some((role) => role !== "admin" && role !== "superadmin")
    })
    expect(notAdminOnly).toEqual([])
  })

  it("every card on the /settings hub is a page the sidebar gates", () => {
    // The hub filters its cards through accessibleNavItems; a card whose href is
    // not a nav item would silently vanish for everyone.
    const hub = readFileSync("src/app/(dashboard)/settings/page.tsx", "utf8")
    const cards = [...hub.matchAll(/href: "(\/[^"]+)", hint:/g)].map((match) => match[1])
    expect(cards.length).toBeGreaterThan(10)
    expect(cards.filter((href) => !navItems.some((item) => item.href === href))).toEqual([])
    expect(hub).toContain("visibleSections.map(")
  })
})

// 2026-10-07: the finance APIs started checking the role (they had checked only
// that someone was signed in). The menu has to say the same thing the server
// does, or a sales rep keeps a "Finance overview" entry that opens a page made
// of refused requests.
describe("Finance pages follow the role the finance APIs are gated by", () => {
  const FINANCE_PAGES = ["/finance", "/profitability", "/settings/finance-notifications", "/settings/sales-forecast"]
  const hrefs = (role: Role) => accessibleNavItems(navFor(role)).map((item) => item.href)

  it.each(["sales", "support", "ticketing"] as const)("%s is not offered them and cannot open them by URL", (role) => {
    const org = navFor(role)
    expect(hrefs(role).filter((href) => FINANCE_PAGES.includes(href))).toEqual([])
    for (const path of FINANCE_PAGES) {
      expect([path, isNavPathRoleBlocked(org, path)]).toEqual([path, true])
    }
  })

  it.each(["manager", "viewer", "admin"] as const)("%s keeps all of them", (role) => {
    const org = navFor(role)
    expect(FINANCE_PAGES.filter((path) => !hrefs(role).includes(path))).toEqual([])
    for (const path of FINANCE_PAGES) {
      expect([path, isNavPathRoleBlocked(org, path)]).toEqual([path, false])
    }
  })

  it("sales and support keep what the matrix does give them in Finance: invoices", () => {
    expect(hrefs("sales")).toContain("/invoices")
    expect(hrefs("support")).toContain("/invoices")
    expect(isNavPathRoleBlocked(navFor("sales"), "/invoices")).toBe(false)
  })

  it("each entry names the scope its API is gated by", () => {
    const scopeOf = (href: string) => navItems.find((item) => item.href === href)?.permissionScope
    expect(FINANCE_PAGES.map(scopeOf)).toEqual(["finance", "profitability", "finance", "budgeting"])
    // …and the menu's answer is the server's: the same function, the same scope.
    for (const role of ["manager", "sales", "support", "ticketing", "viewer"] as const) {
      for (const href of FINANCE_PAGES) {
        expect([role, href, hrefs(role).includes(href)]).toEqual([role, href, checkPermission(role, scopeOf(href)!, "read")])
      }
    }
  })
})
