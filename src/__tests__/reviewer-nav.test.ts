/**
 * The menu of an outside reviewer offers no settings page at all — the proxy
 * refuses every /settings and /admin path, so a visible entry is a dead link
 * (seen live on 2026-10-25: «Настройки» in the reviewer's sidebar).
 */
import { describe, expect, it } from "vitest"
import { accessibleNavItems, navItemPathname } from "@/lib/nav-items"
import { USER_HIDEABLE_MODULE_IDS } from "@/lib/user-module-access"

const modules = Object.fromEntries(
  ["crm", "sales", "contracts", "marketing", "support", "finance", "analytics", "mtm", "settings", "omnichannel"].map((id) => [id, true]),
)

function org(role: string, hiddenModules: string[] = []) {
  return { plan: "enterprise", addons: [], modules, role, hiddenModules }
}

describe("reviewer menu", () => {
  it("has no Settings group and no section's /settings or /admin entry", () => {
    const items = accessibleNavItems(org("reviewer", USER_HIDEABLE_MODULE_IDS.filter((id) => id !== "crm")))
    expect(items.length).toBeGreaterThan(0)
    expect(items.filter((item) => item.group === "Settings")).toEqual([])
    expect(items.map((item) => navItemPathname(item.href)).filter((path) => path.startsWith("/settings") || path.startsWith("/admin"))).toEqual([])
  })

  it("keeps the reviewer's own section", () => {
    const items = accessibleNavItems(org("reviewer", USER_HIDEABLE_MODULE_IDS.filter((id) => id !== "crm")))
    expect(items.some((item) => navItemPathname(item.href) === "/contacts")).toBe(true)
  })

  it("leaves a viewer's settings entries as they were", () => {
    expect(accessibleNavItems(org("viewer")).some((item) => item.group === "Settings")).toBe(true)
  })
})
