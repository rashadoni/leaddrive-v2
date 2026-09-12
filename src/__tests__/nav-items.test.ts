import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import {
  accessibleNavItems, navItems, matchNavItem, activeNavBase, groupLauncherStyle, GROUP_LAUNCHER_STYLE, NAV_GROUP_ORDER,
} from "@/lib/nav-items"
import { SIDEBAR_SECTIONS, TOGGLEABLE_MODULES, countEnabledModules, enableAllModules, clearAllModules } from "@/lib/admin-sidebar-catalog"
import { MODULE_REGISTRY, type ModuleId } from "@/lib/modules"
import { canAccessModule } from "@/lib/plan-config"

// Pure permission-gate logic shared by the sidebar, App Launcher, Cmd+K
// palette, and dashboard Quick Access strip. No mocks — exercises the real
// navItems array + hasModule.
describe("accessibleNavItems", () => {
  it("superadmin sees every item except tenant-capability, feature-, and addon-gated ones", () => {
    // MC-T4: the addon gate (ai/voip) applies on the showAll path too —
    // mirrors `feature` behavior. With no addons on the org, the 6 ai/voip
    // items are hidden even for superadmin.
    const res = accessibleNavItems({ plan: "enterprise", role: "superadmin" })
    const expected = navItems.filter((i) => !i.tenantCapability && !i.feature && !i.addon && !i.capability)
    expect(res.length).toBe(expected.length)
    // spans every vertical, including MTM + industry clouds
    expect(res.some((i) => i.module === "mtm")).toBe(true)
    expect(res.some((i) => i.module === "health")).toBe(true)
    // addon items appear once the org carries the flags
    const withAddons = accessibleNavItems({
      plan: "enterprise",
      role: "superadmin",
      modules: { ai: true, voip: true },
    })
    expect(withAddons.some((i) => i.href === "/ai-command-center")).toBe(true)
    expect(withAddons.some((i) => i.href === "/support/voip")).toBe(true)
  })

  it("superadmin is still subject to feature flags (complaints hidden unless enabled)", () => {
    const without = accessibleNavItems({ plan: "enterprise", role: "superadmin" })
    expect(without.some((i) => i.href === "/complaints")).toBe(false)

    const withFeat = accessibleNavItems({
      plan: "enterprise",
      role: "superadmin",
      modules: { complaints_register: true },
    })
    expect(withFeat.some((i) => i.href === "/complaints")).toBe(true)
  })

  it("tier plan without the mtm module hides all Route & Field items", () => {
    const res = accessibleNavItems({
      plan: "tier-5",
      role: "viewer",
      modules: { core: true, deals: true, leads: true, tasks: true },
    })
    expect(res.every((i) => i.module !== "mtm")).toBe(true)
    // alwaysOn/core + listed modules still visible
    expect(res.some((i) => i.href === "/dashboard")).toBe(true)
    expect(res.some((i) => i.href === "/deals")).toBe(true)
  })

  it("gates Route & Field navigation by route-field independently from workforce-hrm", () => {
    const routesOnly = accessibleNavItems({
      plan: "enterprise",
      role: "manager",
      modules: { "route-field": true },
    }).map((item) => item.href)
    expect(routesOnly).toContain("/mtm/routes")
    expect(routesOnly).toContain("/mtm/visits")
    expect(routesOnly).toContain("/mtm/alerts")
    expect(routesOnly).toContain("/mtm/leaderboard")
    expect(routesOnly).toContain("/mtm/activity")
    expect(routesOnly).toContain("/mtm/reports")
    expect(routesOnly).not.toContain("/mtm/operations")
    expect(routesOnly).not.toContain("/mtm/promotions")
    expect(routesOnly).not.toContain("/mtm/settings")

    const workforceOnly = accessibleNavItems({
      plan: "enterprise",
      role: "manager",
      modules: { "workforce-hrm": true },
    }).map((item) => item.href)
    expect(workforceOnly).not.toContain("/mtm/routes")
    expect(workforceOnly).not.toContain("/mtm/visits")

    const fullFieldSuite = accessibleNavItems({
      plan: "enterprise",
      role: "manager",
      modules: { "route-field": true, "workforce-hrm": true },
    }).map((item) => item.href)
    expect(fullFieldSuite).toContain("/mtm/routes")
    expect(fullFieldSuite).toContain("/mtm/visits")
  })

  it("keeps legacy mtm navigation during the entitlement compatibility window", () => {
    const legacy = accessibleNavItems({
      plan: "enterprise",
      role: "manager",
      modules: { mtm: true },
    }).map((item) => item.href)

    expect(legacy).toContain("/mtm/routes")
    expect(legacy).toContain("/mtm/operations")
  })

  it("feature-gated item respects org.modules[feature] for a non-superadmin", () => {
    const base = { plan: "tier-25", role: "manager", modules: { core: true, tickets: true } }
    expect(accessibleNavItems(base).some((i) => i.href === "/complaints")).toBe(false)

    const withFeat = accessibleNavItems({
      ...base,
      modules: { core: true, tickets: true, complaints_register: true },
    })
    expect(withFeat.some((i) => i.href === "/complaints")).toBe(true)
  })

  it("keeps Workforce navigation independent from Route & Field in all four tenant modes", () => {
    const workforceHrefs = ["/workforce", "/workforce/timesheet", "/workforce/requests"]
    const hasEveryWorkforcePage = (modules: Record<string, boolean>) => {
      const hrefs = accessibleNavItems({ plan: "enterprise", role: "manager", modules }).map((item) => item.href)
      return workforceHrefs.every((href) => hrefs.includes(href))
    }

    expect(hasEveryWorkforcePage({ "workforce-hrm": true })).toBe(true) // HRM-only
    expect(hasEveryWorkforcePage({ mtm: true, "workforce-hrm": false })).toBe(false) // Routes-only
    expect(hasEveryWorkforcePage({ mtm: true, "workforce-hrm": true })).toBe(true) // Both
    expect(hasEveryWorkforcePage({ mtm: false, "workforce-hrm": false })).toBe(false) // Neither

    const hrmOnly = accessibleNavItems({ plan: "enterprise", role: "manager", modules: { "workforce-hrm": true } })
    expect(hrmOnly.some((item) => item.href === "/mtm")).toBe(false)
    const routesOnly = accessibleNavItems({ plan: "enterprise", role: "manager", modules: { mtm: true, "workforce-hrm": false } })
    expect(routesOnly.some((item) => item.href === "/mtm")).toBe(true)
  })

  it("shows Workforce configuration only to tenant administrators", () => {
    const manager = accessibleNavItems({
      plan: "enterprise",
      role: "manager",
      modules: { "workforce-hrm": true },
    })
    const administrator = accessibleNavItems({
      plan: "enterprise",
      role: "admin",
      modules: { "workforce-hrm": true },
    })

    expect(manager.some((item) => item.href === "/workforce/configuration")).toBe(false)
    expect(administrator.some((item) => item.href === "/workforce/configuration")).toBe(true)
  })

  it("gates conversation analytics on VoIP independently from Support", () => {
    const voipOnly = accessibleNavItems({
      plan: "enterprise",
      role: "manager",
      modules: { voip: true, support: false },
    })
    const insights = voipOnly.find((i) => i.href === "/voip/insights")
    expect(insights?.module).toBe("voip")
    expect(insights?.group).toBe("VoIP")

    const supportOnly = accessibleNavItems({
      plan: "enterprise",
      role: "manager",
      modules: { support: true, voip: false },
    })
    expect(supportOnly.some((i) => i.href === "/voip/insights")).toBe(false)
  })

  it("a legacy-named plan no longer force-shows base modules (paid-gate fix)", () => {
    // Pre-fix, plan="starter" forced paid modules into the sidebar regardless
    // of features. Now `modules` (features) is authoritative for every plan.
    // MC-T4 group catalog: legacy `core` expands to the `crm` GROUP. The legacy
    // starter bundle is ["core","deals","leads","tasks"] (core never shipped
    // alone — see LEGACY_PLANS), and after the Sales carve-out `deals`/`leads`
    // expand to the `sales` GROUP. So a real legacy starter still sees both
    // Dashboard (crm) and Deals (sales) via step-3b expansion — no transition
    // shim needed (the `crm⇒sales` shim was removed once tenants were backfilled).
    // Groups the org was never granted stay hidden regardless of the plan name.
    const org = { plan: "starter", role: "viewer", modules: { core: true, deals: true, leads: true, tasks: true } }
    expect(accessibleNavItems(org).some((i) => i.href === "/dashboard")).toBe(true)  // crm via legacy core
    expect(accessibleNavItems(org).some((i) => i.href === "/deals")).toBe(true)      // sales via legacy deals
    expect(accessibleNavItems(org).some((i) => i.href === "/campaigns")).toBe(false) // marketing not granted
    expect(accessibleNavItems(org).some((i) => i.href === "/mtm")).toBe(false)       // mtm not granted
  })

  it("keeps CRM-only tenants out of the Marketing sidebar group", () => {
    const items = accessibleNavItems({
      plan: "starter",
      role: "admin",
      modules: { crm: true, support: true, settings: true, marketing: false },
    })

    expect(items.some((item) => item.group === "Marketing")).toBe(false)
    expect(items.find((item) => item.href === "/cdp/insights")?.group).toBe("CRM")
    expect(items.find((item) => item.href === "/cdp/merge-queue")?.group).toBe("CRM")
  })
})

describe("nav grouping", () => {
  it("uses AI Actions as the live Advisor route and keeps Da Vinci Center separate", () => {
    const advisorItem = navItems.find((i) => i.tKey === "aiActions")
    const centerItem = navItems.find((i) => i.href === "/ai-command-center")
    expect(advisorItem?.href).toBe("/ai/actions")
    expect(advisorItem?.module).toBe("analytics")
    expect(advisorItem?.addon).toBe("ai")
    expect(centerItem?.tKey).toBe("aiCenter")
    expect(centerItem?.addon).toBe("ai")
  })

  it("прячет юридический стол от ролей без scope `social-legal`", () => {
    // Модуль `social` у тенанта включён — но юридический контур admin-only,
    // и меню не должно вести менеджера на 403 (NavItem.permissionScope).
    const legalHref = "/social-monitoring?scope=all&view=legal"
    const org = (role: string) => ({ plan: "enterprise", role, modules: { social: true } })
    expect(accessibleNavItems(org("manager")).some((i) => i.href === legalHref)).toBe(false)
    expect(accessibleNavItems(org("sales")).some((i) => i.href === legalHref)).toBe(false)
    expect(accessibleNavItems(org("admin")).some((i) => i.href === legalHref)).toBe(true)
    expect(accessibleNavItems(org("superadmin")).some((i) => i.href === legalHref)).toBe(true)
    // остальные виды соцмониторинга менеджеру видны
    expect(accessibleNavItems(org("manager")).some((i) => i.href.includes("view=mentions"))).toBe(true)
  })

  it("gives Social Monitoring its own sidebar group with query-view hrefs", () => {
    const smItems = navItems.filter((i) => i.group === "Social Monitoring")
    // 12 видов одного роута /social-monitoring, гейт — СВОЙ модуль `social`
    // (2026-08-01): пока группа висела на omnichannel, админка рисовала обеим
    // группам один тумблер и Communication/соцмониторинг гасились вместе.
    expect(smItems.map((i) => i.href)).toEqual([
      "/social-monitoring?scope=all&view=overview",
      "/social-monitoring?view=monitors",
      "/social-monitoring?scope=all&view=mentions",
      "/social-monitoring?scope=all&view=replies",
      "/social-monitoring?scope=all&view=sources",
      "/social-monitoring?scope=all&view=scenarios",
      "/social-monitoring?scope=all&view=subjects",
      "/social-monitoring?scope=all&view=media",
      "/social-monitoring?scope=all&view=reports",
      "/social-monitoring?scope=all&view=agent",
      "/social-monitoring?scope=all&view=legal",
      "/social-monitoring?scope=all&view=settings",
    ])
    expect(smItems.every((i) => i.module === "social")).toBe(true)
    // Ни один пункт Communication не должен гейтиться на social и наоборот —
    // иначе тумблеры в админке снова слипнутся.
    expect(navItems.filter((i) => i.module === "social").every((i) => i.group === "Social Monitoring")).toBe(true)
    expect(navItems.filter((i) => i.group === "Communication").every((i) => i.module === "omnichannel")).toBe(true)
    // moduleToSection берёт группу ПЕРВОГО item'а модуля: omnichannel → /inbox
    // (Communication), social → обзор соцмониторинга.
    expect(navItems.find((i) => i.module === "omnichannel")?.group).toBe("Communication")
    expect(navItems.find((i) => i.module === "social")?.group).toBe("Social Monitoring")
  })

  it("resolves /social-monitoring by pathname despite query-параметризованные hrefs", () => {
    expect(matchNavItem("/social-monitoring")?.group).toBe("Social Monitoring")
    expect(matchNavItem("/social-monitoring")?.module).toBe("social")
  })

  it("keeps all 15 Support destinations in Work, Team, and Rules order", () => {
    const supportItems = navItems.filter((i) => i.group === "Support")
    const supportHrefs = supportItems.map((i) => i.href)
    expect(supportHrefs).toEqual([
      "/tickets",
      "/complaints",
      "/support/agent-desktop",
      "/support/voip",
      "/knowledge-base",
      "/support/skill-routing",
      "/support/calendar",
      "/settings/portal-users",
      "/settings/ticket-categories",
      "/settings/sla-policies",
      "/support/entitlements",
      "/settings/entitlement-templates",
      "/settings/escalation",
      "/settings/macros",
      "/support/ai-settings",
    ])
    expect(supportItems.map((item) => item.supportSection)).toEqual([
      "work", "work", "work", "work", "work",
      "team", "team", "team",
      "rules", "rules", "rules", "rules", "rules", "rules", "rules",
    ])
    // Telephony setup moved to the Settings group — owners looked for it there.
    expect(supportHrefs).not.toContain("/settings/voip")
    expect(navItems.find((i) => i.href === "/settings/voip")?.group).toBe("Settings")
    expect(new Set(supportHrefs).size).toBe(supportHrefs.length)
  })

  it("allows direct URLs for the ticket settings that live under settings routes", () => {
    const supportSettingsRoutes = [
      "/support/entitlements",
      "/support/skill-routing",
      "/settings/ticket-categories",
      "/settings/ticket-queues",
      "/settings/sla-policies",
      "/settings/entitlement-templates",
      "/settings/escalation",
      "/settings/macros",
      "/settings/portal-users",
    ]

    for (const href of supportSettingsRoutes) {
      expect(canAccessModule("tier-5", href), `${href} must stay in base Support access`).toBe(true)
    }
  })

  it("keeps Support AI settings behind the AI add-on", () => {
    expect(canAccessModule("tier-5", "/support/ai-settings", [])).toBe(false)
    expect(canAccessModule("tier-5", "/support/ai-settings", ["ai"])).toBe(true)
  })

  it("shows Support AI settings only to an authorized role with both modules", () => {
    const hrefs = (role: "admin" | "manager", modules: Record<string, boolean>) =>
      accessibleNavItems({ plan: "tier-25", role, modules }).map((item) => item.href)

    expect(hrefs("admin", { support: true, ai: true })).toContain("/support/ai-settings")
    expect(hrefs("manager", { support: true, ai: true })).not.toContain("/support/ai-settings")
    expect(hrefs("admin", { support: true })).not.toContain("/support/ai-settings")
    expect(hrefs("admin", { ai: true })).not.toContain("/support/ai-settings")
  })

  it("places all 9 contract items under the Contracts Control group (not CRM)", () => {
    // 7 operational + approval-rules + approval-delegates (config relocated from
    // Parametrlər into the contracts module's group).
    const contractItems = navItems.filter((i) => i.module === "contracts")
    expect(contractItems.length).toBe(9)
    for (const item of contractItems) {
      expect(item.group, `${item.href} must be in Contracts Control`).toBe("Contracts Control")
    }
  })

  it("Contracts Control includes Milestones and Analytics nav items (Slice 5d)", () => {
    const hrefs = navItems.filter((i) => i.module === "contracts").map((i) => i.href)
    expect(hrefs).toContain("/contracts/milestones")
    expect(hrefs).toContain("/contracts/analytics")
  })

  it("Sales then Contracts Control follow CRM in NAV_GROUP_ORDER", () => {
    const crmIdx = NAV_GROUP_ORDER.indexOf("CRM")
    const salesIdx = NAV_GROUP_ORDER.indexOf("Sales")
    const ccIdx = NAV_GROUP_ORDER.indexOf("Contracts Control")
    expect(crmIdx).toBeGreaterThanOrEqual(0)
    expect(salesIdx).toBe(crmIdx + 1)
    expect(ccIdx).toBe(salesIdx + 1)
  })
})

// The admin tenant-editor module catalog is DERIVED from navItems
// (src/lib/admin-sidebar-catalog.ts) so it can never silently drift from the
// real sidebar. These lock that invariant — they would have caught the old
// hand-maintained array that omitted social-monitoring/surveys/loyalty/etc.
describe("admin sidebar catalog (derived — no drift from navItems)", () => {
  it("renders the expected sidebar groups, in nav order", () => {
    // Explicit expected list (NOT re-derived from navItems) so this catches a
    // real IA regression — a group silently added, removed, or reordered —
    // rather than just a bug in the catalog's own .map.
    expect(SIDEBAR_SECTIONS.map((s) => s.group)).toEqual([
      "CRM", "Sales", "Contracts Control", "Marketing", "Loyalty Program", "Communication", "Social Monitoring", "VoIP", "Support", "Finance", "Analytics",
      "Route & Field", "Health Cloud", "Insurance Cloud", "Public Sector",
      "Media Cloud", "Energy & Utilities", "Settings",
    ])
  })

  it("includes every module-gated navItems href (capability-only pages use the capability panel)", () => {
    const catalogHrefs = new Set(SIDEBAR_SECTIONS.flatMap((s) => s.items.map((i) => i.href)))
    const missing = navItems.filter((i) => i.module).map((i) => i.href).filter((h) => !catalogHrefs.has(h))
    expect(missing).toEqual([])
    expect(catalogHrefs.has("/workforce")).toBe(false)
  })

  it("gives Communication and Social Monitoring one INDEPENDENT toggle each", () => {
    // Регрессия владельца (2026-08-01): обе группы гейтились на `omnichannel`,
    // админка рисует по тумблеру на УНИКАЛЬНЫЙ moduleId секции — выходило два
    // тумблера одного флага, выключение любого гасило обе группы.
    const moduleIdsOf = (group: string) => [
      ...new Set(SIDEBAR_SECTIONS.find((s) => s.group === group)!.items.map((i) => i.moduleId)),
    ]
    expect(moduleIdsOf("Communication")).toEqual(["omnichannel"])
    expect(moduleIdsOf("Social Monitoring")).toEqual(["social"])
  })

  it("hides exactly one of the two groups when the other module is off", () => {
    const org = (modules: Record<string, boolean>) => ({ plan: "enterprise", role: "manager", modules })
    const socialOnly = accessibleNavItems(org({ social: true }))
    expect(socialOnly.some((i) => i.group === "Social Monitoring")).toBe(true)
    expect(socialOnly.some((i) => i.group === "Communication")).toBe(false)

    const inboxOnly = accessibleNavItems(org({ omnichannel: true }))
    expect(inboxOnly.some((i) => i.href === "/inbox")).toBe(true)
    expect(inboxOnly.some((i) => i.group === "Social Monitoring")).toBe(false)
  })

  it("surfaces Social Monitoring as its own catalog section", () => {
    const sm = SIDEBAR_SECTIONS.find((s) => s.group === "Social Monitoring")
    expect(sm?.items.some((i) => i.href === "/social-monitoring?scope=all&view=overview")).toBe(true)
    // Из Communication одиночный пункт исчез — виды переехали в свою группу.
    const comm = SIDEBAR_SECTIONS.find((s) => s.group === "Communication")
    expect(comm?.items.some((i) => i.href.startsWith("/social-monitoring"))).toBe(false)
  })

  it("surfaces all loyalty routes under the Loyalty Program catalog section", () => {
    const loyalty = SIDEBAR_SECTIONS.find((s) => s.group === "Loyalty Program")
    expect(loyalty?.items.map((i) => i.href)).toEqual([
      "/loyalty/builder",
      "/loyalty/dashboard",
      "/loyalty/pos",
      "/loyalty/tiers",
      "/loyalty/earn-rules",
      "/loyalty/promo-codes",
    ])
    expect(loyalty?.items.every((i) => i.moduleId === "loyalty")).toBe(true)
  })

  it("every toggleable module is a real, non-core module", () => {
    for (const m of TOGGLEABLE_MODULES) {
      expect(m).not.toBe("core")
      expect(MODULE_REGISTRY[m as ModuleId]).toBeDefined()
    }
  })

  // The admin editor's "{count} of {total} modules enabled" numerator must count
  // only real toggleable modules — `Organization.features` also carries add-on
  // flags (ai/voip/sms-otp), AI-automation keys (ai_auto_*) and social flags
  // (social_*), so a raw `features.length` produced the "19 of 16" overcount a
  // Communication-only brandprotection tenant hit.
  describe("countEnabledModules (admin editor numerator)", () => {
    it("counts only toggleable modules, never exceeding the total", () => {
      // A Communication-only tenant seeded with social/AI feature flags — the
      // exact shape that rendered "19 of 16".
      const features = [
        "omnichannel",
        "ai_auto_social_reply",
        "ai_auto_social_reply_shadow",
        "ai_auto_social_triage_shadow",
        "social_brand_protection_only",
        "sms-otp", "voip", "ai",
      ]
      const count = countEnabledModules(features)
      expect(count).toBe(2) // `omnichannel` + standalone `voip`; `ai` stays cross-cutting
      expect(count).toBeLessThanOrEqual(TOGGLEABLE_MODULES.length)
    })

    it("counts every module when all are enabled, and dedupes repeats", () => {
      expect(countEnabledModules([...TOGGLEABLE_MODULES])).toBe(TOGGLEABLE_MODULES.length)
      // Duplicate entries in the JSON column must not inflate the numerator.
      expect(countEnabledModules(["crm", "crm", "sales"])).toBe(2)
    })

    it("is zero for an empty or module-less features array", () => {
      expect(countEnabledModules([])).toBe(0)
      expect(countEnabledModules(["social_brand_protection_only", "ai_auto_triage"])).toBe(0)
    })
  })

  // The "Select all" / "Clear all" bulk buttons in the Active Modules card must
  // scope to the toggleable modules and PRESERVE every other feature flag —
  // AI-automation keys, extra-feature flags and social flags all co-host the
  // same `features` array and are managed by other UI. The old buttons replaced
  // the whole array (`[...TOGGLEABLE_MODULES]` / `[]`), silently wiping them.
  describe("enableAllModules / clearAllModules (bulk buttons preserve non-module flags)", () => {
    const nonModuleFlags = [
      "ai_auto_social_reply",
      "ai_auto_triage_shadow",
      "complaints_register",
      "social_brand_protection_only",
      "sms-otp",
    ]

    it("enableAllModules turns on every toggleable module and keeps other flags", () => {
      const result = enableAllModules(["omnichannel", ...nonModuleFlags])
      for (const m of TOGGLEABLE_MODULES) expect(result).toContain(m)
      for (const f of nonModuleFlags) expect(result).toContain(f)
      expect(countEnabledModules(result)).toBe(TOGGLEABLE_MODULES.length)
      // No duplicate `omnichannel` even though it was already present.
      expect(result.filter((f) => f === "omnichannel")).toHaveLength(1)
    })

    it("clearAllModules turns off every module but keeps other flags", () => {
      const result = clearAllModules([...TOGGLEABLE_MODULES, ...nonModuleFlags])
      expect(countEnabledModules(result)).toBe(0)
      expect(result).toEqual(nonModuleFlags)
    })

    it("round-trips: clear then enable restores modules without losing flags", () => {
      const start = ["crm", "omnichannel", ...nonModuleFlags]
      const cleared = clearAllModules(start)
      const reEnabled = enableAllModules(cleared)
      expect(countEnabledModules(reEnabled)).toBe(TOGGLEABLE_MODULES.length)
      for (const f of nonModuleFlags) expect(reEnabled).toContain(f)
    })
  })
})

describe("matchNavItem", () => {
  it("resolves an exact route to its own item", () => {
    expect(matchNavItem("/mtm/map")?.href).toBe("/mtm/map")
  })

  it("resolves a deep sub-route to the longest matching module prefix", () => {
    // /deals/123 → /deals (not "/")
    expect(matchNavItem("/deals/123")?.href).toBe("/deals")
    // /mtm/visits/999 falls back to /mtm/visits (longest prefix), not /mtm
    expect(matchNavItem("/mtm/visits/999")?.href).toBe("/mtm/visits")
  })

  it("gates the unlinked /inbox/v2 screen under the omnichannel module via prefix", () => {
    // /inbox/v2 has no nav item of its own, so the (dashboard) layout's direct-URL
    // module guard relies on it resolving to /inbox (omnichannel). If a future
    // /inbox/v2/* nav item changes this, the access gate would silently move.
    const m = matchNavItem("/inbox/v2")
    expect(m?.href).toBe("/inbox")
    expect(m?.module).toBe("omnichannel")
  })

  it("returns undefined for an unknown route", () => {
    expect(matchNavItem("/nonexistent-xyz")).toBeUndefined()
  })
})

describe("groupLauncherStyle", () => {
  it("returns the chip/icon/dot classes for a known group", () => {
    const s = groupLauncherStyle("CRM")
    expect(s).toEqual(GROUP_LAUNCHER_STYLE.CRM)
    expect(s.chip).toMatch(/^bg-/)
    expect(s.icon).toMatch(/^text-/)
    expect(s.dot).toMatch(/^bg-/)
  })

  it("falls back to neutral tokens for an unknown group", () => {
    const s = groupLauncherStyle("No Such Group")
    expect(s).toEqual({ chip: "bg-muted", icon: "text-muted-foreground", dot: "bg-muted-foreground" })
  })

  it("defines a launcher style for every group used by navItems", () => {
    const groups = new Set(navItems.map((i) => i.group))
    for (const g of groups) {
      expect(GROUP_LAUNCHER_STYLE[g], `missing launcher style for group "${g}"`).toBeDefined()
    }
  })
})

describe("navDesc coverage (every launcher tile has a hint)", () => {
  const en = JSON.parse(readFileSync("messages/en.json", "utf8")) as { navDesc?: Record<string, string> }

  it("every nav item has an English description", () => {
    const missing = navItems.filter((i) => !en.navDesc?.[i.tKey]).map((i) => i.tKey)
    expect(missing).toEqual([])
  })

  it("has no orphan descriptions (every navDesc key maps to a nav item)", () => {
    const tKeys = new Set(navItems.map((i) => i.tKey))
    const orphans = Object.keys(en.navDesc ?? {}).filter((k) => !tKeys.has(k))
    expect(orphans).toEqual([])
  })
})

// Which single item a URL selects. Guards the "two selected destinations"
// regression: a landing page (`/settings`, `/mtm`) is a path-prefix of its own
// children, so a plain prefix test lights the hub AND the child at once.
describe("activeNavBase — one selected destination", () => {
  const all = accessibleNavItems({ plan: "enterprise", role: "superadmin", modules: { mtm: true } })

  it("a child page selects the child, not the settings hub", () => {
    // /settings is a strict prefix of /settings/users — longest wins.
    expect(activeNavBase(all, "/settings/users")).toBe("/settings/users")
  })

  it("the /settings hub is no longer a menu entry", () => {
    // The hub page still exists as an overview, but every destination it used
    // to be the only door to now has its own sidebar item, so it was dropped
    // from the menu. Nothing in the sidebar can select it.
    expect(navItems.some((i) => i.href === "/settings")).toBe(false)
    expect(activeNavBase(all, "/settings")).toBe("")
  })

  it("the eight ex-hub-only settings pages each have their own item now", () => {
    // These lived ONLY as cards on /settings, which forced a second stop.
    const promoted = [
      "/settings/organization", "/settings/billing", "/settings/roles",
      "/settings/security", "/settings/audit-log", "/settings/custom-fields",
      "/settings/notifications", "/settings/custom-domains",
    ]
    for (const href of promoted) {
      expect(navItems.some((i) => i.href === href), `${href} missing from nav`).toBe(true)
      expect(activeNavBase(all, href)).toBe(href)
    }
  })

  it("every settings child resolves to exactly one item, never the hub plus a child", () => {
    // Drawn from `all`, not navItems: addon-gated children (/settings/voip)
    // are absent from this context, and an item nobody renders must not be
    // asserted to win the match.
    const children = all.filter(
      (i) => i.href.startsWith("/settings/") && !i.href.includes("?"),
    )
    expect(children.length).toBeGreaterThan(5)
    for (const child of children) {
      expect(activeNavBase(all, child.href)).toBe(child.href)
    }
  })

  it("an addon-gated child the org lacks selects nothing, not an unrendered item", () => {
    // /settings/voip is addon:"voip" — hidden without the add-on. Since the
    // /settings hub left the menu there is no ancestor to fall back to, so the
    // sidebar simply highlights nothing. What must NOT happen is selecting an
    // item the sidebar never rendered.
    expect(navItems.some((i) => i.href === "/settings/voip")).toBe(true)
    expect(all.some((i) => i.href === "/settings/voip")).toBe(false)
    expect(activeNavBase(all, "/settings/voip")).toBe("")

    const withVoip = accessibleNavItems({ plan: "enterprise", role: "superadmin", modules: { voip: true } })
    expect(activeNavBase(withVoip, "/settings/voip")).toBe("/settings/voip")
  })

  it("/mtm stays exact-only — it never wins a child URL", () => {
    expect(activeNavBase(all, "/mtm")).toBe("/mtm")
    expect(activeNavBase(all, "/mtm/map")).toBe("/mtm/map")
    // Detail route under a child: the child wins, not the module landing page.
    expect(activeNavBase(all, "/mtm/map/123")).toBe("/mtm/map")
  })

  it("the dashboard root never prefix-matches another route", () => {
    expect(activeNavBase(all, "/deals")).toBe("/deals")
  })

  it("returns empty for a URL no item covers", () => {
    expect(activeNavBase(all, "/nonexistent-route-xyz")).toBe("")
  })

  it("ignores items the org cannot see, so a rendered item still wins", () => {
    // Org without the `settings` module: /settings/users is not rendered, so
    // its URL must select nothing. (Other /settings/* items survive here —
    // /settings/pipelines belongs to the base `sales` module — but none of them
    // is an ancestor of /settings/users, so none may win it.)
    const limited = accessibleNavItems({ plan: "enterprise", role: "admin", modules: { crm: true } })
    expect(limited.some((i) => i.href === "/settings/users")).toBe(false)
    expect(activeNavBase(limited, "/settings/users")).toBe("")
  })
})

// The owner hit this as "why does the Parameters module contain Parameters".
// It was not a one-off: Finance and Loyalty Program had the same collision.
// A module landing page must not be labelled identically to its own group —
// the sidebar then renders the same word twice, one indented under the other.
describe("no nav item is named after its own group", () => {
  const en = JSON.parse(readFileSync("messages/en.json", "utf8"))
  const az = JSON.parse(readFileSync("messages/az.json", "utf8"))
  const ru = JSON.parse(readFileSync("messages/ru.json", "utf8"))

  it.each([["en", en], ["az", az], ["ru", ru]])("%s", (_loc, msgs) => {
    const groups = msgs.nav.groups ?? msgs.groups ?? {}
    const collisions = navItems
      .filter((i) => {
        const g = groups[i.group]
        const label = msgs.nav[i.tKey]
        return g && label && g.trim().toLowerCase() === label.trim().toLowerCase()
      })
      .map((i) => `${i.href} ("${msgs.nav[i.tKey]}") == group "${i.group}"`)
    expect(collisions).toEqual([])
  })
})
