/**
 * The catalog of Settings sections an admin can tick for one person
 * (src/lib/settings-sections.ts) and what the menu and the page guard make of a
 * tick. The server side — routes letting exactly these through — is proved on
 * a real Postgres in settings-sections-postgres.test.ts.
 */
import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import {
  effectiveSettingsSections,
  normalizeSettingsSections,
  settingsGrantAllows,
  SETTINGS_SECTIONS,
} from "@/lib/settings-sections"
import { resolveModuleFromPath } from "@/lib/permissions"
import { accessibleNavItems, isNavPathRoleBlocked, navItems, type OrgNavContext } from "@/lib/nav-items"
import { settingsAccessOutcome } from "@/lib/user-access-summary"

const sales = (settingsSections: string[] = []): OrgNavContext => ({ plan: "enterprise", role: "sales", settingsSections })

describe("settings sections catalog", () => {
  it("names only sections whose every route answers to the settings scope", () => {
    // The KPI Arena config is read by everyone (the arena itself), so its path
    // maps to no scope; its writes name `settings` themselves (withRlsAuth).
    const NAMED_BY_ROUTE = new Set(["/api/v1/leaderboard/config"])
    for (const section of SETTINGS_SECTIONS) {
      for (const api of section.apis) {
        if (NAMED_BY_ROUTE.has(api)) {
          const source = readFileSync(path.join(process.cwd(), "src/app", api, "route.ts"), "utf8")
          expect(source.match(/withRlsAuth\("settings", "(write|delete)"/g)?.length, api).toBeGreaterThan(0)
          expect(source, api).not.toMatch(/withRlsAuth\("(?!settings")/)
        } else {
          expect(resolveModuleFromPath(api), api).toBe("settings")
        }
      }
    }
  })

  it("names only pages the menu lists under Settings, and none of the admin-only ones", () => {
    const settingsItems = navItems.filter((item) => item.group === "Settings")
    for (const section of SETTINGS_SECTIONS) {
      for (const page of section.pages) {
        const item = settingsItems.find((candidate) => candidate.href === page)
        expect(item, page).toBeDefined()
        expect(item!.allowedRoles, page).toBeUndefined()
      }
    }
    const closed = ["/settings/users", "/settings/roles", "/settings/security", "/settings/billing", "/settings/api-keys",
      "/settings/organization", "/settings/channels", "/settings/smtp-settings", "/settings/integrations",
      "/settings/custom-domains", "/settings/field-permissions", "/settings/ai-automation", "/settings/ai-spend"]
    for (const page of closed) {
      expect(SETTINGS_SECTIONS.some((section) => section.pages.some((p) => page === p || page.startsWith(p + "/"))), page).toBe(false)
    }
  })

  it("keeps known ids only, in catalog order, and none for admins or a reviewer", () => {
    expect(normalizeSettingsSections(["call-tasks", "users", "workflows", "workflows", 7])).toEqual(["workflows", "call-tasks"])
    expect(effectiveSettingsSections("sales", ["workflows"])).toEqual(["workflows"])
    for (const role of ["admin", "superadmin", "reviewer", null]) expect(effectiveSettingsSections(role, ["workflows"])).toEqual([])
  })

  it("lets a tick through for its own section's routes and the settings scope only", () => {
    const nazrin = { role: "sales", settingsSections: ["workflows"] }
    expect(settingsGrantAllows(nazrin, "/api/v1/workflows", "settings", "write")).toBe(true)
    expect(settingsGrantAllows(nazrin, "/api/v1/workflows/abc", "settings", "delete")).toBe(true)
    expect(settingsGrantAllows(nazrin, "/api/v1/workflows/templates", "settings", "read")).toBe(true)
    expect(settingsGrantAllows(nazrin, "/api/v1/workflowsx", "settings", "read")).toBe(false)
    expect(settingsGrantAllows(nazrin, "/api/v1/custom-fields", "settings", "write")).toBe(false)
    expect(settingsGrantAllows(nazrin, "/api/v1/workflows", "users", "write")).toBe(false)
    expect(settingsGrantAllows(nazrin, "/api/v1/workflows", "settings", "admin")).toBe(false)
    expect(settingsGrantAllows({ role: "reviewer", settingsSections: ["workflows"] }, "/api/v1/workflows", "settings", "read")).toBe(false)
  })
})

describe("a ticked section in the menu and the page guard", () => {
  it("adds the ticked section's pages to a sales person's menu and nothing else", () => {
    const before = accessibleNavItems(sales()).filter((item) => item.group === "Settings").map((item) => item.href)
    const after = accessibleNavItems(sales(["workflows"])).filter((item) => item.group === "Settings").map((item) => item.href)
    expect(after.filter((href) => !before.includes(href)).sort()).toEqual(["/settings/workflows", "/settings/workflows/templates"])
  })

  it("opens the ticked page by URL and keeps every other organization page refused", () => {
    expect(isNavPathRoleBlocked(sales(), "/settings/workflows")).toBe(true)
    expect(isNavPathRoleBlocked(sales(["workflows"]), "/settings/workflows")).toBe(false)
    expect(isNavPathRoleBlocked(sales(["workflows"]), "/settings/workflows/templates")).toBe(false)
    expect(isNavPathRoleBlocked(sales(["workflows"]), "/settings/users")).toBe(true)
    expect(isNavPathRoleBlocked(sales(["workflows"]), "/settings/custom-fields")).toBe(true)
  })

  it("names the ticked section on the user card's Settings row", () => {
    expect(settingsAccessOutcome("sales", [], ["workflows"]).pages).toEqual(["workflows", "workflowTemplates"])
    expect(settingsAccessOutcome("sales", []).pages).toEqual([])
    expect(settingsAccessOutcome("admin", [], ["workflows"]).outcome).toBe("full")
  })
})
