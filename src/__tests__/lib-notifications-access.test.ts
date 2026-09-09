import { describe, it, expect } from "vitest"
import { roleCanRead, canNotifySection, canNotifyEntityType, accessibleSections } from "@/lib/notifications/access"
import { NAV_GROUP_ORDER } from "@/lib/nav-items"

// ----- canNotifyEntityType -----

describe("canNotifyEntityType", () => {
  // FIX A: per-entityType gate prevents sibling-module leaks
  // support has events:read but campaigns:[] → campaign entityType must be blocked
  const supportOrgAllModules = {
    role: "support" as const,
    plan: "enterprise",
    modules: {
      core: true, deals: true, leads: true, tasks: true, contracts: true,
      tickets: true, campaigns: true, invoices: true, budgeting: true,
      profitability: true, reports: true, omnichannel: true, voip: true,
      "knowledge-base": true, ai: true, events: true,
    } as Record<string, boolean>,
  }

  it("support role: campaign entityType → false (campaigns module on, but support has no campaigns:read)", () => {
    // CORE of FIX A: support.campaigns = [] → roleCanRead("support","campaigns") = false
    // canNotifyEntityType gates on the SPECIFIC module (campaigns), not the section (Marketing)
    // so even though support can access the Marketing section via events:read, campaign
    // notifications are blocked.
    expect(canNotifyEntityType(supportOrgAllModules, "campaign")).toBe(false)
  })

  it("support role: ticket entityType → true (tickets module on + support has tickets:read)", () => {
    expect(canNotifyEntityType(supportOrgAllModules, "ticket")).toBe(true)
  })

  it("support role: deal entityType → true (deals module on + support has deals:read)", () => {
    expect(canNotifyEntityType(supportOrgAllModules, "deal")).toBe(true)
  })

  it("admin role: campaign entityType → true (campaigns module on + admin has wildcard read)", () => {
    const adminOrg = { ...supportOrgAllModules, role: "admin" as const }
    expect(canNotifyEntityType(adminOrg, "campaign")).toBe(true)
  })

  it("returns false for unknown entityType (fail-closed)", () => {
    const adminOrg = { ...supportOrgAllModules, role: "admin" as const }
    expect(canNotifyEntityType(adminOrg, "unknown_entity_type")).toBe(false)
    expect(canNotifyEntityType(adminOrg, "social_mention_unmapped_future")).toBe(false)
  })

  it("social_mention: gated by the `social` module, independent of omnichannel", () => {
    // 2026-08-01 split: Social Monitoring has its own group-module, so inbox
    // (omnichannel) state no longer decides social-mention delivery either way.
    const orgSocialOnly = {
      role: "admin" as const,
      plan: "enterprise",
      modules: { ...supportOrgAllModules.modules, omnichannel: false, social: true } as Record<string, boolean>,
    }
    expect(canNotifyEntityType(orgSocialOnly, "social_mention")).toBe(true)
    const orgInboxOnly = {
      role: "admin" as const,
      plan: "enterprise",
      modules: { ...supportOrgAllModules.modules, omnichannel: true, social: false } as Record<string, boolean>,
    }
    expect(canNotifyEntityType(orgInboxOnly, "social_mention")).toBe(false)
  })

  it("social_mention доходит до manager и sales, но не до support", () => {
    // Все эмиттеры соц-алертов адресуют их admin+manager (spike-alerts.ts,
    // coverage-slo.ts, ai-auto-actions). До 2026-06-29 роуты соцмониторинга
    // ходили под scope `campaigns` (manager rw / sales read / support []), и
    // права на scope `social` восстановлены по этому же контракту.
    const withSocial = (role: "manager" | "sales" | "support") => ({
      role,
      plan: "enterprise",
      modules: { ...supportOrgAllModules.modules, social: true } as Record<string, boolean>,
    })
    expect(canNotifyEntityType(withSocial("manager"), "social_mention")).toBe(true)
    expect(canNotifyEntityType(withSocial("sales"), "social_mention")).toBe(true)
    expect(canNotifyEntityType(withSocial("support"), "social_mention")).toBe(false)
  })

  it("social_mention entityType → true when the social module is on + admin role", () => {
    const adminOrg = {
      ...supportOrgAllModules,
      role: "admin" as const,
      modules: { ...supportOrgAllModules.modules, social: true } as Record<string, boolean>,
    }
    expect(canNotifyEntityType(adminOrg, "social_mention")).toBe(true)
  })

  it("briefing entityType → false when ai module is off", () => {
    const orgNoAi = {
      role: "admin" as const,
      plan: "enterprise",
      modules: { ...supportOrgAllModules.modules, ai: false } as Record<string, boolean>,
    }
    expect(canNotifyEntityType(orgNoAi, "briefing")).toBe(false)
  })

  it("briefing entityType → true when ai module on + admin role", () => {
    const adminOrg = { ...supportOrgAllModules, role: "admin" as const }
    expect(canNotifyEntityType(adminOrg, "briefing")).toBe(true)
  })

  it("budget_plan: ORG gate is group-level — blocked only when the whole finance group is off", () => {
    // MC-T4 P2: budgeting:false alone no longer blocks — invoices/profitability
    // keep the finance GROUP granted via 3b expansion (group is the org-level
    // gating unit; fine granularity stays in the ROLE matrix).
    const orgNoBudget = {
      role: "admin" as const,
      plan: "enterprise",
      modules: { ...supportOrgAllModules.modules, budgeting: false } as Record<string, boolean>,
    }
    expect(canNotifyEntityType(orgNoBudget, "budget_plan")).toBe(true)
    // Org block applies when EVERY finance-mapped flag is off:
    const orgNoFinanceGroup = {
      role: "admin" as const,
      plan: "enterprise",
      modules: {
        ...supportOrgAllModules.modules,
        budgeting: false, invoices: false, profitability: false,
      } as Record<string, boolean>,
    }
    expect(canNotifyEntityType(orgNoFinanceGroup, "budget_plan")).toBe(false)
  })

  it("budget_plan entityType → true when budgeting module on + admin role", () => {
    const adminOrg = { ...supportOrgAllModules, role: "admin" as const }
    expect(canNotifyEntityType(adminOrg, "budget_plan")).toBe(true)
  })

  // MC-T4 P2 fix: ENTITY_TO_MODULE keeps LEGACY vocab (campaign → "campaigns"),
  // but a GROUP-ONLY org record ({marketing:true}, no legacy flags — exactly what
  // the backfill/admin chips write) has hasModule 3b expansion OFF (NEW-vocab
  // marker present), so the org gate must translate legacy → group id. The ROLE
  // gate stays on the fine legacy id (admin wildcard here isolates the ORG gate).
  it("group-only org record still delivers legacy-vocab entity kinds (org gate translates to group)", () => {
    // marketing group granted, NO legacy campaigns flag — post-backfill/edited tenant shape
    const ctx = {
      role: "admin" as const,
      plan: "enterprise",
      modules: { marketing: true, crm: true, settings: true } as Record<string, boolean>,
    }
    expect(canNotifyEntityType(ctx, "campaign")).toBe(true)
  })

  it("group-only org without the group still denies", () => {
    const ctx = {
      role: "admin" as const,
      plan: "enterprise",
      modules: { crm: true } as Record<string, boolean>,
    }
    expect(canNotifyEntityType(ctx, "campaign")).toBe(false)
  })
})

// ----- roleCanRead -----

describe("roleCanRead", () => {
  it("superadmin can read any module (wildcard)", () => {
    expect(roleCanRead("superadmin", "deals")).toBe(true)
    expect(roleCanRead("superadmin", "campaigns")).toBe(true)
    expect(roleCanRead("superadmin", "totally-unknown")).toBe(true)
  })

  it("admin can read any module (wildcard)", () => {
    expect(roleCanRead("admin", "deals")).toBe(true)
    expect(roleCanRead("admin", "tickets")).toBe(true)
  })

  it("viewer can read any module (wildcard *)", () => {
    // viewer has "*": ["read"] in ROLE_PERMISSIONS
    expect(roleCanRead("viewer", "deals")).toBe(true)
    expect(roleCanRead("viewer", "tickets")).toBe(true)
    expect(roleCanRead("viewer", "campaigns")).toBe(true)
  })

  it("manager can read deals (explicit entry)", () => {
    expect(roleCanRead("manager", "deals")).toBe(true)
  })

  it("support can read deals (has deals:read in matrix)", () => {
    // ROLE_PERMISSIONS.support.deals = ["read"]
    expect(roleCanRead("support", "deals")).toBe(true)
  })

  it("support cannot read campaigns (empty array in matrix)", () => {
    // ROLE_PERMISSIONS.support.campaigns = [] — no read action
    expect(roleCanRead("support", "campaigns")).toBe(false)
  })

  it("sales cannot read campaigns via wildcard but can read explicitly via campaigns:read", () => {
    // ROLE_PERMISSIONS.sales.campaigns = ["read"]
    expect(roleCanRead("sales", "campaigns")).toBe(true)
  })

  it("support cannot read budgeting (no read in matrix for support)", () => {
    // ROLE_PERMISSIONS.support.budgeting = [] — no read
    expect(roleCanRead("support", "budgeting")).toBe(false)
  })

  it("falls back to true for ungated ModuleIds (core, workflows) — no permission-module mapping", () => {
    // "core" and "workflows" are in UNGATED_MODULE_IDS: they have no permission-module
    // in the ROLE_PERMISSIONS matrix and no bridge entry — so ALL roles can read them.
    expect(roleCanRead("manager", "core")).toBe(true)
    expect(roleCanRead("support", "core")).toBe(true)
    expect(roleCanRead("sales", "core")).toBe(true)
    expect(roleCanRead("manager", "workflows")).toBe(true)
  })

  // -------------------------------------------------------------------------
  // Bridge path: ModuleId vocab → permission-module vocab
  // These are the cases that would have FAILED under the old fallback-to-true.
  // -------------------------------------------------------------------------

  it("[BRIDGE] support cannot read quotes — no bridge entry, no matrix key → conservative deny", () => {
    // MAP-ONLY RE-GATE: PERMISSION_MODULE_TO_MODULE_ID now spreads
    // LEGACY_MODULE_MAP, whose values are GROUP ids only. "quotes" is a legacy
    // ModuleId (maps TO "crm"), never a map VALUE, so the inverse map has no
    // "quotes" key; "quotes" also has no ROLE_PERMISSIONS key → deny.
    // (Old mechanism was inverse "quotes"→["offers"], offers:[] — same result.)
    expect(roleCanRead("support", "quotes")).toBe(false)
  })

  it("[BRIDGE] support can read omnichannel (bridges to inbox: read,write in matrix)", () => {
    // "omnichannel" ModuleId → permission-module "inbox"
    // ROLE_PERMISSIONS.support.inbox = ["read","write"]
    // OLD behavior: "omnichannel" absent from matrix → fallback TRUE (correct but accidental)
    // NEW behavior: bridge → checkPermission("support","inbox","read") → TRUE (correct + explicit)
    expect(roleCanRead("support", "omnichannel")).toBe(true)
  })

  it("[BRIDGE] support reads group 'support' via member scopes (kb/tickets in matrix); bare legacy id denies", () => {
    // MAP-ONLY RE-GATE: "kb" now maps to group "support" (not "knowledge-base"),
    // so the inverse map keys the GROUP: "support" → [tickets, knowledge-base,
    // kb, portal]. Support role has kb:read,write + tickets:read → group grant.
    expect(roleCanRead("support", "support")).toBe(true)
    // "knowledge-base" is no longer a bridge target and has no matrix key →
    // conservative deny. Nav items re-tag to group ids in MC-T4, after which
    // this id never reaches roleCanRead from nav vocab.
    expect(roleCanRead("support", "knowledge-base")).toBe(false)
  })

  it("[BRIDGE] support can read energy (bridges to energy-utilities in matrix)", () => {
    // "energy" ModuleId → permission-module "energy-utilities"
    // ROLE_PERMISSIONS.support.energy-utilities = ["read","write"]
    expect(roleCanRead("support", "energy")).toBe(true)
  })

  it("[BRIDGE] superadmin can read any bridged module (wildcard)", () => {
    // Wildcard passes through checkPermission regardless of bridge
    expect(roleCanRead("superadmin", "omnichannel")).toBe(true)
    expect(roleCanRead("superadmin", "knowledge-base")).toBe(true)
    expect(roleCanRead("superadmin", "energy")).toBe(true)
    expect(roleCanRead("superadmin", "quotes")).toBe(true)
  })

  it("[BRIDGE] manager reads group 'crm' via member scopes (deals/offers in matrix); bare 'quotes' id denies", () => {
    // MAP-ONLY RE-GATE: "offers"/"quotes" map to group "crm", so the inverse
    // map keys the GROUP: "crm" → [core, deals, leads, tasks, quotes, offers,
    // projects, companies, contacts]. Manager has deals + offers read → grant.
    expect(roleCanRead("manager", "crm")).toBe(true)
    // "quotes" itself is no longer a bridge target and has no matrix key →
    // conservative deny (dead nav vocab after the MC-T4 re-tag).
    expect(roleCanRead("manager", "quotes")).toBe(false)
  })
})

// ----- canNotifySection -----

describe("canNotifySection", () => {
  // Helper: full org with all modules enabled
  const fullOrg = {
    role: "admin" as const,
    plan: "enterprise",
    modules: {
      core: true,
      deals: true,
      leads: true,
      tasks: true,
      contracts: true,
      tickets: true,
      campaigns: true,
      invoices: true,
      budgeting: true,
      profitability: true,
      reports: true,
      omnichannel: true,
      voip: true,
      "knowledge-base": true,
      ai: true,
      mtm: true,
      health: true,
      insurance: true,
      "public-sector": true,
      media: true,
      energy: true,
    },
  }

  it("admin + full org → CRM section accessible", () => {
    expect(canNotifySection(fullOrg, "CRM")).toBe(true)
  })

  it("admin + full org → Support section accessible", () => {
    expect(canNotifySection(fullOrg, "Support")).toBe(true)
  })

  it("admin + full org → Marketing section accessible", () => {
    expect(canNotifySection(fullOrg, "Marketing")).toBe(true)
  })

  it("Marketing section stays hidden when the marketing module is off", () => {
    const orgWithoutMarketing = { ...fullOrg, modules: { ...fullOrg.modules, campaigns: false } }
    // campaigns-backed nav items → hasModule returns false → section inaccessible
    // EXCEPT for leads-backed items (ai-scoring/journeys/sequences) which are in Marketing too
    // leads module is still true → those items pass hasModule
    // manager/admin has leads:read → roleCanRead true
    // So Marketing may still be true if leads is on — let's test with no leads either
    const orgNoMarketing = {
      ...fullOrg,
      modules: { ...fullOrg.modules, campaigns: false, leads: false },
    }
    // events module also in Marketing — check events
    const orgNoMarketingModules = {
      ...fullOrg,
      modules: {
        ...fullOrg.modules,
        campaigns: false,
        leads: false,
        events: false,
      },
    }
    // CDP insights/merge-queue are free CRM-backed items, but they now live in
    // the CRM section. A CRM-only tenant must not get a misleading Marketing
    // notification section merely because CDP is available.
    expect(canNotifySection(orgNoMarketingModules, "Marketing")).toBe(false)
    expect(canNotifySection(orgNoMarketingModules, "CRM")).toBe(true)
  })

  it("org WITHOUT tickets module → Support section not accessible", () => {
    const orgNoTickets = {
      ...fullOrg,
      modules: {
        ...fullOrg.modules,
        tickets: false,
        voip: false,
        "knowledge-base": false,
      },
    }
    expect(canNotifySection(orgNoTickets, "Support")).toBe(false)
  })

  it("support role + deals module on → CRM accessible (support has deals:read)", () => {
    const supportOrg = { ...fullOrg, role: "support" as const }
    // support has deals:["read"] in the matrix
    expect(canNotifySection(supportOrg, "CRM")).toBe(true)
  })

  it("support role + marketing off sees CDP through CRM, not Marketing", () => {
    const supportOrg = {
      role: "support" as const,
      plan: "enterprise",
      modules: {
        ...fullOrg.modules,
        campaigns: false,
        leads: false,
        events: false,
      },
    }
    expect(canNotifySection(supportOrg, "Marketing")).toBe(false)
    expect(canNotifySection(supportOrg, "CRM")).toBe(true)
  })

  it("support role + campaigns ON → Marketing section accessible via group (events:read), campaign DELIVERY still blocked", () => {
    const supportOrg = {
      role: "support" as const,
      plan: "enterprise",
      modules: { ...fullOrg.modules, campaigns: true, leads: false, events: false },
    }
    // MC-T4 re-tag: every Marketing nav item carries the GROUP id "marketing".
    // hasModule grants it via legacy expansion (campaigns → marketing), and
    // roleCanRead(support, "marketing") grants via the group's member scopes —
    // support has events:["read"] and events live IN the Marketing group, so
    // the section toggle is legitimately visible (1 группа = 1 модуль: events
    // can no longer be org-disabled separately from the group).
    expect(canNotifySection(supportOrg, "Marketing")).toBe(true)
    // The finer-grained DELIVERY gate keeps the original guarantee: support
    // has campaigns:[] → campaign notifications stay blocked per-entityType.
    expect(canNotifyEntityType(supportOrg, "campaign")).toBe(false)
  })

  it("superadmin + any module on → all org-enabled sections accessible", () => {
    const saOrg = { ...fullOrg, role: "superadmin" as const }
    expect(canNotifySection(saOrg, "CRM")).toBe(true)
    expect(canNotifySection(saOrg, "Support")).toBe(true)
    expect(canNotifySection(saOrg, "Marketing")).toBe(true)
    expect(canNotifySection(saOrg, "Finance")).toBe(true)
  })

  it("superadmin BYPASSES hasModule → sees sections even when the org lacks the module (matches launcher showAll)", () => {
    // superadmin (platform owner) gets the same see-all bypass the app launcher
    // gives (accessibleNavItems showAll). A vertical the org doesn't subscribe to
    // (e.g. health) must still be accessible for superadmin so notification
    // settings stay consistent with the launcher. Non-superadmin stays gated.
    const saNoModules = { role: "superadmin" as const, plan: "starter", modules: {} as Record<string, boolean> }
    expect(canNotifySection(saNoModules, "Health Cloud")).toBe(true)
    expect(canNotifySection(saNoModules, "Insurance Cloud")).toBe(true)
    expect(canNotifySection(saNoModules, "Finance")).toBe(true)
    expect(canNotifyEntityType(saNoModules, "health_patient")).toBe(true)
    expect(canNotifyEntityType(saNoModules, "invoice")).toBe(true)
    // contrast: a non-superadmin admin with the module OFF is still blocked
    const adminNoModules = { role: "admin" as const, plan: "enterprise", modules: {} as Record<string, boolean> }
    expect(canNotifySection(adminNoModules, "Health Cloud")).toBe(false)
    expect(canNotifyEntityType(adminNoModules, "health_patient")).toBe(false)
  })

  // -------------------------------------------------------------------------
  // Bridge-path regression tests: these would have passed under the old
  // fallback-to-true but now correctly go through the permission-module vocab.
  // -------------------------------------------------------------------------

  it("[BRIDGE] CRM section accessible via the crm GROUP (legacy core expands); Clear-All grants nothing", () => {
    // MC-T4 re-tag: CRM nav items carry the GROUP id "crm" (not alwaysOn
    // "core" anymore). A legacy-shaped record with core:true grants the group
    // via 3b expansion (core → crm); roleCanRead(manager, "crm") grants via
    // the group's member scopes (deals/offers/companies… read).
    const coreOnlyOrg = {
      role: "manager" as const,
      plan: "enterprise",
      modules: { core: true } as Record<string, boolean>,
    }
    expect(canNotifySection(coreOnlyOrg, "CRM")).toBe(true)
    // Saved-empty modules ({} = superadmin Clear All) now grants NO section:
    // no nav module is alwaysOn after the re-tag — paid gating is authoritative.
    const clearedOrg = {
      role: "manager" as const,
      plan: "enterprise",
      modules: {} as Record<string, boolean>,
    }
    expect(canNotifySection(clearedOrg, "CRM")).toBe(false)
  })

  it("[BRIDGE] Communication section: support + omnichannel ON → accessible (inbox:read in matrix)", () => {
    // "omnichannel" ModuleId bridges to permission-module "inbox".
    // ROLE_PERMISSIONS.support.inbox = ["read","write"] → TRUE.
    // Under old fallback: also TRUE (accidentally). Now: explicitly wired via bridge.
    // Verifies the bridge path fires and correctly grants access.
    const supportComm = {
      role: "support" as const,
      plan: "enterprise",
      modules: { omnichannel: true } as Record<string, boolean>,
    }
    expect(canNotifySection(supportComm, "Communication")).toBe(true)
  })

  it("[BRIDGE] Support section: support + knowledge-base ON → accessible via group vocab", () => {
    // Nav re-tag (MC-T4): Support nav items now carry the GROUP module id
    // "support". The legacy-shaped org record ("knowledge-base": true, no
    // NEW-vocab group ids) keeps hasModule's 3b expansion ON, so
    // hasModule(org, "support") grants via knowledge-base → support; and
    // roleCanRead(support, "support") grants via the inverse map's member
    // scopes (kb:read,write + tickets:read). → section accessible.
    const supportKB = {
      role: "support" as const,
      plan: "enterprise",
      modules: { "knowledge-base": true } as Record<string, boolean>,
    }
    expect(canNotifySection(supportKB, "Support")).toBe(true)
    // The group-vocab role path the re-tag relies on:
    expect(roleCanRead("support", "support")).toBe(true)
  })

  it("[BRIDGE] quotes id denies for every non-wildcard role; the grant lives on group 'crm'", () => {
    // MAP-ONLY RE-GATE: "offers" maps to group "crm", so "quotes" has no
    // inverse-map entry and no ROLE_PERMISSIONS key → conservative deny for
    // all non-wildcard roles (dead nav vocab after the MC-T4 re-tag).
    expect(roleCanRead("support", "quotes")).toBe(false)
    expect(roleCanRead("manager", "quotes")).toBe(false)
    // The manager grant moved to the group id: inverse "crm" → [core, deals,
    // …, quotes, offers, …]; manager has deals/offers read → TRUE. Support
    // also reads the crm GROUP via deals:["read"] — per-entity gating
    // (canNotifyEntityType) stays the finer-grained delivery gate.
    expect(roleCanRead("manager", "crm")).toBe(true)
    expect(roleCanRead("support", "crm")).toBe(true)
  })
})

// ----- accessibleSections -----

describe("accessibleSections", () => {
  it("returns only items in NAV_GROUP_ORDER", () => {
    const ctx = {
      role: "admin" as const,
      plan: "enterprise",
      modules: { deals: true, tickets: true, campaigns: true } as Record<string, boolean>,
    }
    const sections = accessibleSections(ctx)
    for (const s of sections) {
      expect(NAV_GROUP_ORDER).toContain(s)
    }
  })

  it("admin with all modules on gets a superset of CRM + Support + Marketing", () => {
    const ctx = {
      role: "admin" as const,
      plan: "enterprise",
      modules: {
        core: true, deals: true, leads: true, tasks: true, contracts: true,
        tickets: true, campaigns: true, invoices: true, budgeting: true,
        profitability: true, reports: true, omnichannel: true, voip: true,
        "knowledge-base": true,
      } as Record<string, boolean>,
    }
    const sections = accessibleSections(ctx)
    expect(sections).toContain("CRM")
    expect(sections).toContain("Support")
    expect(sections).toContain("Marketing")
    expect(sections).toContain("Finance")
    expect(sections).toContain("Analytics")
  })

  it("viewer: empty modules → NO sections; legacy core → CRM only (group expansion)", () => {
    // MC-T4 re-tag: nav items carry group ids and none is alwaysOn — a
    // saved-empty record ({} = Clear All) grants nothing, even for viewer
    // (viewer's *:read wildcard passes the ROLE gate but not the ORG gate).
    const cleared = {
      role: "viewer" as const,
      plan: "enterprise",
      modules: {} as Record<string, boolean>,
    }
    expect(accessibleSections(cleared)).toEqual([])
    // Legacy-shaped record: core → crm via 3b expansion → CRM section only.
    const ctx = {
      role: "viewer" as const,
      plan: "enterprise",
      modules: { core: true } as Record<string, boolean>,
    }
    const sections = accessibleSections(ctx)
    expect(sections).toContain("CRM")
    // No support-mapped module → Support not accessible
    expect(sections).not.toContain("Support")
  })

  it("order preserves NAV_GROUP_ORDER", () => {
    const ctx = {
      role: "admin" as const,
      plan: "enterprise",
      modules: {
        core: true, deals: true, tickets: true, campaigns: true,
        invoices: true, budgeting: true, reports: true,
      } as Record<string, boolean>,
    }
    const sections = accessibleSections(ctx)
    // verify relative order matches NAV_GROUP_ORDER
    const indices = sections.map((s) => NAV_GROUP_ORDER.indexOf(s))
    for (let i = 1; i < indices.length; i++) {
      expect(indices[i]).toBeGreaterThan(indices[i - 1])
    }
  })
})
