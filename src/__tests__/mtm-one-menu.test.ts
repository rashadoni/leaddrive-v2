import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import { accessibleNavItems, navItems } from "@/lib/nav-items"
import { isMtmNavigationItemActive } from "@/lib/mtm/navigation"

// Owner, 2026-11-01: one MTM menu — the left one. The audit found the same
// destinations in three places at once (the sidebar group, six tabs above every
// page, and the «All MTM tools» popover), and on a page that was not one of the
// six tabs nothing at the top was lit, so nobody could tell where they were.

const source = (path: string) => readFileSync(resolve(path), "utf8")
const routeField = navItems.filter((item) => item.group === "Route & Field")

describe("MTM: one menu", () => {
  it("draws no second menu above the pages", () => {
    expect(existsSync(resolve("src/components/mtm/mtm-module-navigation.tsx"))).toBe(false)
    const layout = source("src/app/(dashboard)/mtm/layout.tsx")
    expect(layout).not.toMatch(/Navigation|<nav\b/)
    for (const locale of ["en", "ru", "az"] as const) {
      expect(JSON.parse(source(`messages/${locale}.json`))).not.toHaveProperty("mtmModuleNavigation")
    }
  })

  it("orders the sidebar as the working day goes, in five parts", () => {
    const parts: [string, string[]][] = []
    for (const item of routeField) {
      const last = parts.at(-1)
      if (last?.[0] === item.mtmSection) last[1].push(item.href)
      else parts.push([item.mtmSection ?? "", [item.href]])
    }
    expect(parts).toEqual([
      ["daily", ["/mtm", "/mtm/routes", "/mtm/calendar", "/mtm/map", "/mtm/visits", "/mtm/tasks", "/mtm/promotions"]],
      ["reference", ["/mtm/customers", "/mtm/contacts", "/mtm/agents", "/mtm/products"]],
      ["control", ["/mtm/alerts", "/mtm/photos", "/mtm/operations"]],
      ["results", ["/mtm/analytics", "/mtm/reports", "/mtm/leaderboard", "/mtm/activity"]],
      ["administration", ["/mtm/access", "/mtm/settings"]],
    ])
  })

  it("separates the parts with a line in the sidebar, not a nested level", () => {
    const sidebar = source("src/components/sidebar.tsx")
    expect(sidebar).toContain("item.mtmSection !== items[index - 1].mtmSection")
    expect(sidebar).toContain('data-testid="sidebar-section-divider"')
  })

  it("offers Access & permissions to a CRM administrator only", () => {
    // The page links employee cards to logins — administrator work, and its API
    // refuses anyone else. A menu entry the page then refuses is a broken promise.
    const org = (role: string) => ({ plan: "enterprise", role, modules: { mtm: true, "route-field": true } })
    const hrefs = (role: string) => accessibleNavItems(org(role)).map((item) => item.href)
    expect(hrefs("admin")).toContain("/mtm/access")
    expect(hrefs("superadmin")).toContain("/mtm/access")
    for (const role of ["manager", "sales", "support"]) {
      expect([role, hrefs(role).includes("/mtm/access")]).toEqual([role, false])
    }
  })

  it("does not keep Today active beside a child page", () => {
    expect(isMtmNavigationItemActive("/mtm", "/mtm")).toBe(true)
    expect(isMtmNavigationItemActive("/mtm", "/mtm/routes")).toBe(false)
    expect(isMtmNavigationItemActive("/mtm/routes", "/mtm/routes/route-1")).toBe(true)
  })
})
