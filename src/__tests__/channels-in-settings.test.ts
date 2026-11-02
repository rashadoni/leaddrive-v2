import { describe, expect, it } from "vitest"
import { accessibleNavItems, isNavPathRoleBlocked, matchNavItem, navItems, type OrgNavContext } from "@/lib/nav-items"
import { resolveModuleFromPath } from "@/lib/permissions"

// Owner, 2026-10-26: «каналы могут использоваться в разных модулях, поэтому лучше их добавить в параметры. И
// телеграм также объединить — он в параметрах отдельно стоит». Channels moved from Omni-channel to Settings for
// every tenant; the employees' Telegram bot became a card inside the channel catalog. No mocks: the real menu,
// the real path→module map the proxy gates on.

/** A field-sales tenant: no Omni-channel inbox at all. */
const fieldOnly = (role: string): OrgNavContext => ({
  plan: "enterprise",
  addons: [],
  role,
  modules: { crm: true, sales: true, mtm: true, settings: true },
})

const hrefs = (org: OrgNavContext) => accessibleNavItems(org).map((item) => item.href)

describe("Channels in Settings", () => {
  it("shows Channels under Settings to an admin of a tenant without Omni-channel", () => {
    const item = navItems.find((candidate) => candidate.href === "/settings/channels")
    expect(item?.group).toBe("Settings")
    expect(hrefs(fieldOnly("admin"))).toContain("/settings/channels")
    // The inbox itself stays Omni-channel's.
    expect(hrefs(fieldOnly("admin"))).not.toContain("/inbox")
  })

  it("keeps Channels an admin page: a manager neither sees it nor opens it by URL", () => {
    expect(hrefs(fieldOnly("manager"))).not.toContain("/settings/channels")
    expect(isNavPathRoleBlocked(fieldOnly("manager"), "/settings/channels")).toBe(true)
    expect(isNavPathRoleBlocked(fieldOnly("admin"), "/settings/channels")).toBe(false)
  })

  it("has no separate Telegram-bot menu entry; its screen is guarded as part of Channels", () => {
    expect(navItems.some((item) => item.href === "/settings/telegram-bot")).toBe(false)
    expect(matchNavItem("/settings/channels/telegram-staff")?.href).toBe("/settings/channels")
    expect(isNavPathRoleBlocked(fieldOnly("manager"), "/settings/channels/telegram-staff")).toBe(true)
    expect(isNavPathRoleBlocked(fieldOnly("admin"), "/settings/channels/telegram-staff")).toBe(false)
  })

  it("lets the proxy's module gate pass the channels API for a tenant without Omni-channel", () => {
    // The proxy maps a path to a module and refuses it when the tenant lacks that module; `inbox` meant omnichannel.
    expect(resolveModuleFromPath("/api/v1/channels")).toBe("settings")
    expect(resolveModuleFromPath("/api/v1/channels/whatsapp/embedded-signup")).toBe("settings")
    expect(resolveModuleFromPath("/api/v1/inbox")).toBe("inbox")
  })
})
