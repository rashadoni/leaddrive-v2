/**
 * The catalog of Settings sections an admin can tick for one person
 * (src/lib/settings-sections.ts) and what the menu and the page guard make of a
 * tick. The server side — routes letting exactly these through — is proved on
 * a real Postgres in settings-sections-postgres.test.ts.
 */
import { describe, expect, it } from "vitest"
import {
  effectiveSettingsSections,
  normalizeSettingsSections,
  holdsSettingsSectionForPath,
  settingsGrantAllows,
  settingsSectionsForApiPath,
  SETTINGS_SECTIONS,
} from "@/lib/settings-sections"
import { resolveModuleFromPath } from "@/lib/permissions"
import { accessibleNavItems, isNavPathRoleBlocked, navItems, type OrgNavContext } from "@/lib/nav-items"
import { settingsAccessOutcome } from "@/lib/user-access-summary"

const sales = (settingsSections: string[] = []): OrgNavContext => ({ plan: "enterprise", role: "sales", settingsSections })

describe("settings sections catalog", () => {
  it("names for each section only routes that ask one of its scopes, or name their scope themselves", () => {
    for (const section of SETTINGS_SECTIONS) {
      for (const api of section.apis) {
        const resolved = resolveModuleFromPath(api)
        if (resolved !== null) expect(section.scopes, api).toContain(resolved)
      }
    }
  })

  it("puts the AI spend limits under both AI sections", () => {
    expect(settingsSectionsForApiPath("/api/v1/settings/ai-budget").map((section) => section.id).sort()).toEqual(["ai-automation", "ai-spend"])
  })

  it("names only pages the menu lists under Settings, and never one that hands out rights", () => {
    const settingsItems = navItems.filter((item) => item.group === "Settings")
    for (const section of SETTINGS_SECTIONS) {
      for (const page of section.pages) expect(settingsItems.some((item) => item.href === page), page).toBe(true)
    }
    const closed = ["/settings/users", "/settings/roles", "/settings/security", "/settings/billing", "/settings/api-keys", "/settings/field-permissions"]
    for (const page of closed) {
      expect(SETTINGS_SECTIONS.some((section) => section.pages.some((p) => page === p || page.startsWith(p + "/"))), page).toBe(false)
    }
    const closedApis = ["/api/v1/users", "/api/v1/users/u1", "/api/v1/roles", "/api/v1/api-keys", "/api/v1/settings/field-permissions",
      "/api/v1/settings/sharing-rules", "/api/v1/settings/customer-phone-privacy", "/api/v1/settings/roles", "/api/v1/whatsapp/send"]
    for (const api of closedApis) expect(settingsSectionsForApiPath(api), api).toEqual([])
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
    expect(settingsGrantAllows(nazrin, "/api/v1/workflows", "settings", "export")).toBe(false)
    expect(settingsGrantAllows({ role: "reviewer", settingsSections: ["workflows"] }, "/api/v1/workflows", "settings", "read")).toBe(false)
    // Channels' WhatsApp part answers to the inbox's scope; the section names it.
    expect(settingsGrantAllows({ role: "sales", settingsSections: ["channels"] }, "/api/v1/whatsapp/templates", "inbox", "read")).toBe(true)
    expect(settingsGrantAllows({ role: "sales", settingsSections: ["channels"] }, "/api/v1/whatsapp/send", "inbox", "write")).toBe(false)
  })

  it("answers the routes that check the admin role themselves: an admin, or the section's holder", () => {
    expect(holdsSettingsSectionForPath({ role: "admin" }, "/api/v1/settings/ai-keys")).toBe(true)
    expect(holdsSettingsSectionForPath({ role: "sales", settingsSections: ["ai-spend"] }, "/api/v1/settings/ai-keys")).toBe(true)
    expect(holdsSettingsSectionForPath({ role: "sales", settingsSections: ["ai-spend"] }, "/api/v1/settings/ai-budget")).toBe(true)
    expect(holdsSettingsSectionForPath({ role: "sales", settingsSections: ["ai-spend"] }, "/api/v1/settings/ai-delivery")).toBe(false)
    expect(holdsSettingsSectionForPath({ role: "sales", settingsSections: ["channels"] }, "/api/v1/settings/customer-phone-privacy")).toBe(false)
    expect(holdsSettingsSectionForPath({ role: "reviewer", settingsSections: ["channels"] }, "/api/v1/channels")).toBe(false)
  })
})

describe("a ticked section in the menu and the page guard", () => {
  it("adds the ticked section's pages to a sales person's menu and nothing else", () => {
    const before = accessibleNavItems(sales()).filter((item) => item.group === "Settings").map((item) => item.href)
    const after = accessibleNavItems(sales(["workflows"])).filter((item) => item.group === "Settings").map((item) => item.href)
    expect(after.filter((href) => !before.includes(href)).sort()).toEqual(["/settings/workflows", "/settings/workflows/templates"])
  })

  it("opens an admin-only page such as Channels, with its own pages, once ticked", () => {
    expect(isNavPathRoleBlocked(sales(), "/settings/channels")).toBe(true)
    expect(isNavPathRoleBlocked(sales(["channels"]), "/settings/channels")).toBe(false)
    expect(isNavPathRoleBlocked(sales(["channels"]), "/settings/channels/whatsapp")).toBe(false)
    expect(isNavPathRoleBlocked(sales(["channels"]), "/settings/api-keys")).toBe(true)
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
