import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import { navItems } from "@/lib/nav-items"
import {
  isMtmNavigationItemActive,
  MTM_ALL_NAVIGATION_HREFS,
  MTM_PRIMARY_NAVIGATION,
  MTM_TOOL_GROUPS,
} from "@/lib/mtm/navigation"

describe("MTM module navigation", () => {
  it("can render every primary pill in every language", () => {
    // The pill calls t(labelKey) with no fallback, so a key the messages do not
    // carry renders as the identifier itself. The type and the dictionaries are
    // two separate places saying the same thing, and they already drifted once:
    // T16 renamed "plan" to "routes" in all three locales and in the nav item,
    // and left the union type behind. Typecheck caught that one; this catches
    // the half typecheck cannot see — a key that compiles and has no text.
    const labelKeys = MTM_PRIMARY_NAVIGATION.map((item) => item.labelKey)
    expect(new Set(labelKeys).size).toBe(labelKeys.length)

    for (const locale of ["en", "ru", "az"] as const) {
      const messages = JSON.parse(readFileSync(resolve(`messages/${locale}.json`), "utf8"))
      const namespace = messages.mtmModuleNavigation as Record<string, unknown>
      const missing = labelKeys.filter((key) => typeof namespace?.[key] !== "string")
      expect(missing, `${locale}.json mtmModuleNavigation is missing`).toEqual([])
      // The old name must be gone, not merely unused: a leftover "plan" is how
      // the next reader concludes the rename was only half done.
      expect(namespace).not.toHaveProperty("plan")
    }
  })

  it("keeps the daily flow short and ordered", () => {
    expect(MTM_PRIMARY_NAVIGATION.map((item) => item.href)).toEqual([
      "/mtm",
      "/mtm/routes",
      "/mtm/map",
      "/mtm/visits",
      "/mtm/analytics",
    ])
  })

  it("keeps every existing MTM destination reachable exactly once", () => {
    const existingMtmHrefs = navItems
      .filter((item) => item.module === "mtm")
      .map((item) => item.href)

    expect(new Set(MTM_ALL_NAVIGATION_HREFS).size).toBe(MTM_ALL_NAVIGATION_HREFS.length)
    expect([...MTM_ALL_NAVIGATION_HREFS].sort()).toEqual(existingMtmHrefs.sort())
    expect(MTM_TOOL_GROUPS.flatMap((group) => group.items)).toHaveLength(12)
  })

  it("uses progressive groups that explain how secondary tools relate", () => {
    expect(MTM_TOOL_GROUPS.map((group) => [group.key, group.items.map((item) => item.href)])).toEqual([
      ["work", ["/mtm/tasks", "/mtm/promotions"]],
      ["reference", ["/mtm/customers", "/mtm/contacts", "/mtm/agents"]],
      ["control", ["/mtm/alerts", "/mtm/photos", "/mtm/operations"]],
      ["analytics", ["/mtm/reports", "/mtm/leaderboard", "/mtm/activity"]],
      ["administration", ["/mtm/settings"]],
    ])
  })

  it("does not keep Today active beside a child page", () => {
    expect(isMtmNavigationItemActive("/mtm", "/mtm")).toBe(true)
    expect(isMtmNavigationItemActive("/mtm", "/mtm/routes")).toBe(false)
    expect(isMtmNavigationItemActive("/mtm/routes", "/mtm/routes/route-1")).toBe(true)
  })

  it("keeps both primary and secondary touch targets at least 44px high", () => {
    const source = readFileSync(resolve("src/components/mtm/mtm-module-navigation.tsx"), "utf8")
    expect(source.match(/min-h-11/g)?.length).toBeGreaterThanOrEqual(3)
    expect(source).toContain('aria-current={active ? "page" : undefined}')
  })
})
