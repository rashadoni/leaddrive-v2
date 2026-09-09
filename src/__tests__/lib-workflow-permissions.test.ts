import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import {
  checkPermission,
  resolveModuleFromPath,
  methodToAction,
  canRead,
  canWrite,
  canDelete,
  canExport,
  isAdmin,
  isSuperAdmin,
  requirePermission,
  PERMISSION_MODULE_TO_MODULE_ID,
} from "@/lib/permissions"
import { hasModule, MODULE_REGISTRY, getOrgModules } from "@/lib/modules"
import type { Role } from "@/lib/permissions"

// ─── permissions.ts ─────────────────────────────────────────

describe("checkPermission", () => {
  it("admin has all actions on any module via wildcard", () => {
    expect(checkPermission("admin", "companies", "read")).toBe(true)
    expect(checkPermission("admin", "companies", "write")).toBe(true)
    expect(checkPermission("admin", "companies", "delete")).toBe(true)
    expect(checkPermission("admin", "companies", "export")).toBe(true)
    expect(checkPermission("admin", "companies", "admin")).toBe(true)
  })

  it("superadmin has all actions on any module via wildcard", () => {
    expect(checkPermission("superadmin", "deals", "delete")).toBe(true)
    expect(checkPermission("superadmin", "settings", "admin")).toBe(true)
  })

  it("viewer can only read (wildcard read)", () => {
    expect(checkPermission("viewer", "deals", "read")).toBe(true)
    expect(checkPermission("viewer", "deals", "write")).toBe(false)
    expect(checkPermission("viewer", "deals", "delete")).toBe(false)
    expect(checkPermission("viewer", "deals", "export")).toBe(false)
  })

  it("контракт ролей на scope `social` — как у прежнего `campaigns`", () => {
    // Соцмониторинг ходил под `campaigns` до 2026-06-29; переключение роутов на
    // `omnichannel` (не ключ матрицы) нечаянно сделало модуль admin-only, хотя
    // алерты соцмониторинга адресуются admin+manager. Восстановленный контракт:
    expect(checkPermission("manager", "social", "read")).toBe(true)
    expect(checkPermission("manager", "social", "write")).toBe(true)
    expect(checkPermission("sales", "social", "read")).toBe(true)
    expect(checkPermission("sales", "social", "write")).toBe(false)
    expect(checkPermission("support", "social", "read")).toBe(false)
    expect(checkPermission("ticketing", "social", "read")).toBe(false)
    // wildcard-роли не меняются
    expect(checkPermission("admin", "social", "write")).toBe(true)
    expect(checkPermission("viewer", "social", "read")).toBe(true)
    expect(checkPermission("viewer", "social", "write")).toBe(false)
    // delete нигде не выдаётся — мутации соцмониторинга это write
    expect(checkPermission("manager", "social", "delete")).toBe(false)
  })

  it("юридический стол соцмониторинга — отдельный admin-only scope", () => {
    // `social-legal` намеренно не ключ ROLE_PERMISSIONS: юридический контур
    // (дела/кандидаты/доказательства/согласования) появился в admin-only период
    // и остаётся за админами, тогда как повседневная работа с упоминаниями идёт
    // по `social`.
    expect(checkPermission("manager", "social-legal", "read")).toBe(false)
    expect(checkPermission("manager", "social-legal", "write")).toBe(false)
    expect(checkPermission("sales", "social-legal", "read")).toBe(false)
    expect(checkPermission("support", "social-legal", "read")).toBe(false)
    expect(checkPermission("admin", "social-legal", "write")).toBe(true)
    expect(checkPermission("superadmin", "social-legal", "write")).toBe(true)
    // тенантный гейт при этом прежний — бридж ведёт на группу-модуль `social`
    expect(PERMISSION_MODULE_TO_MODULE_ID["social-legal"]).toBe("social")
  })

  it("manager can read+write+delete companies but not admin", () => {
    expect(checkPermission("manager", "companies", "read")).toBe(true)
    expect(checkPermission("manager", "companies", "write")).toBe(true)
    expect(checkPermission("manager", "companies", "delete")).toBe(true)
    expect(checkPermission("manager", "companies", "admin")).toBe(false)
  })

  it("sales can write deals but cannot export companies", () => {
    expect(checkPermission("sales", "deals", "write")).toBe(true)
    expect(checkPermission("sales", "companies", "export")).toBe(false)
  })

  it("support can write tickets and delete them", () => {
    expect(checkPermission("support", "tickets", "write")).toBe(true)
    expect(checkPermission("support", "tickets", "delete")).toBe(true)
  })

  it("support cannot access leads at all", () => {
    expect(checkPermission("support", "leads", "read")).toBe(false)
    expect(checkPermission("support", "leads", "write")).toBe(false)
  })

  it("sales has no access to settings", () => {
    expect(checkPermission("sales", "settings", "read")).toBe(false)
    expect(checkPermission("sales", "settings", "write")).toBe(false)
  })

  it("returns false for unknown role", () => {
    expect(checkPermission("unknown" as Role, "companies", "read")).toBe(false)
  })
})

describe("requirePermission", () => {
  it("throws for denied permission", () => {
    expect(() => requirePermission("viewer", "deals", "write")).toThrow("Permission denied")
  })

  it("does not throw for allowed permission", () => {
    expect(() => requirePermission("admin", "deals", "write")).not.toThrow()
  })
})

describe("convenience helpers", () => {
  it("canRead / canWrite / canDelete / canExport", () => {
    expect(canRead("sales", "deals")).toBe(true)
    expect(canWrite("sales", "deals")).toBe(true)
    expect(canDelete("sales", "deals")).toBe(true)
    expect(canExport("sales", "deals")).toBe(false)
  })

  it("isAdmin / isSuperAdmin", () => {
    expect(isAdmin("admin")).toBe(true)
    expect(isAdmin("superadmin")).toBe(true)
    expect(isAdmin("manager")).toBe(false)
    expect(isSuperAdmin("superadmin")).toBe(true)
    expect(isSuperAdmin("admin")).toBe(false)
  })
})

// ─── resolveModuleFromPath ──────────────────────────────────

describe("resolveModuleFromPath", () => {
  it("exact match: /api/v1/companies -> companies", () => {
    expect(resolveModuleFromPath("/api/v1/companies")).toBe("companies")
  })

  it("exact match: /api/v1/deals -> deals", () => {
    expect(resolveModuleFromPath("/api/v1/deals")).toBe("deals")
  })

  it("prefix match: /api/v1/projects/123/tasks -> projects", () => {
    expect(resolveModuleFromPath("/api/v1/projects/123/tasks")).toBe("projects")
  })

  it("maps settings-related routes to settings module", () => {
    expect(resolveModuleFromPath("/api/v1/workflows")).toBe("settings")
    expect(resolveModuleFromPath("/api/v1/custom-fields")).toBe("settings")
    expect(resolveModuleFromPath("/api/v1/sla-policies")).toBe("settings")
  })

  it("maps AI routes to ai module", () => {
    expect(resolveModuleFromPath("/api/v1/ai")).toBe("ai")
    expect(resolveModuleFromPath("/api/v1/ai-configs")).toBe("ai")
    expect(resolveModuleFromPath("/api/v1/ai-sessions/abc")).toBe("ai")
  })

  it("maps the newly-added paid-module routes (closes API-key scope + central-gate skip)", () => {
    // Previously unmapped → resolveModuleFromPath returned null → BOTH the
    // API-key scope check (api-auth.ts) and the central middleware gate
    // (middleware.ts) silently skipped them. Each value matches the route's nav
    // module. A future removal of any entry fails this test.
    expect(resolveModuleFromPath("/api/v1/complaints")).toBe("tickets")
    expect(resolveModuleFromPath("/api/v1/ticket-macros")).toBe("tickets")
    expect(resolveModuleFromPath("/api/v1/escalation-rules")).toBe("tickets")
    expect(resolveModuleFromPath("/api/v1/email-log")).toBe("campaigns")
    expect(resolveModuleFromPath("/api/v1/email-templates")).toBe("campaigns")
    expect(resolveModuleFromPath("/api/v1/campaign-roi")).toBe("campaigns")
    expect(resolveModuleFromPath("/api/v1/surveys")).toBe("campaigns")
    // ("/api/v1/pages" removed with the unused landing-page builder — 200031d.)
    // Social monitoring has its OWN nav group and module since the 2026-08-01
    // split — the API map must match the nav module, so it resolves to `social`
    // (identity bridge), not to the inbox's `omnichannel`.
    expect(resolveModuleFromPath("/api/v1/social")).toBe("social")
    expect(PERMISSION_MODULE_TO_MODULE_ID["social"]).toBe("social")
    expect(PERMISSION_MODULE_TO_MODULE_ID["inbox"]).toBe("omnichannel")
    expect(resolveModuleFromPath("/api/v1/sequences")).toBe("leads")
    expect(resolveModuleFromPath("/api/v1/lead-scoring")).toBe("leads")
    expect(resolveModuleFromPath("/api/v1/lead-rules")).toBe("leads")
    expect(resolveModuleFromPath("/api/v1/territories")).toBe("deals")
    expect(resolveModuleFromPath("/api/v1/sales-quotas")).toBe("deals")
    expect(resolveModuleFromPath("/api/v1/task-templates")).toBe("tasks")
    expect(resolveModuleFromPath("/api/v1/kb-categories")).toBe("kb")
    expect(resolveModuleFromPath("/api/v1/quotes")).toBe("offers")
    expect(resolveModuleFromPath("/api/v1/ticket-queues")).toBe("tickets")
    expect(resolveModuleFromPath("/api/v1/proactive-alerts")).toBe("ai")
    expect(resolveModuleFromPath("/api/v1/ai-feedback")).toBe("ai")
    expect(resolveModuleFromPath("/api/v1/ai-observations")).toBe("ai")
    expect(resolveModuleFromPath("/api/v1/ai-shadow-actions")).toBe("ai")
    expect(resolveModuleFromPath("/api/v1/prediction-models")).toBe("ai")
    expect(resolveModuleFromPath("/api/v1/content-scores")).toBe("ai")
    // prefix match for sub-paths
    expect(resolveModuleFromPath("/api/v1/complaints/123")).toBe("tickets")
    expect(resolveModuleFromPath("/api/v1/email-templates/abc/send")).toBe("campaigns")
  })

  it("a social-only tenant passes the full /api/v1/social gate chain", () => {
    // Regression history: the map said `campaigns` (→ marketing), then `inbox`
    // (→ omnichannel). Since the 2026-08-01 split the social surface gates on
    // its OWN module, so a tenant with ONLY `social` enabled — the whole point
    // of splitting the toggles — must pass the middleware chain.
    const org = { plan: "enterprise", modules: { social: true } }
    const resolved = resolveModuleFromPath("/api/v1/social/mentions")
    expect(resolved).toBe("social")
    const gateModule = PERMISSION_MODULE_TO_MODULE_ID[resolved!] ?? resolved!
    expect(hasModule(org, gateModule as any)).toBe(true)
    expect(hasModule(org, "omnichannel")).toBe(false)
  })

  it("leaves the shared OAuth connect subtree unresolved (either module may use it)", () => {
    // The Meta/TikTok/YouTube connect flow is entered BOTH from /settings/channels
    // (inbox DMs) and from social monitoring. Pinning it to either module would
    // 403 the other one's tenants, so the path resolves to no module at all and
    // the start routes enforce an either-module entitlement themselves
    // (src/lib/social/oauth-access.ts).
    for (const path of [
      "/api/v1/social/oauth/facebook/start",
      "/api/v1/social/oauth/instagram/start",
      "/api/v1/social/oauth/tiktok/start",
      "/api/v1/social/oauth/facebook/callback",
    ]) {
      expect(resolveModuleFromPath(path), path).toBeNull()
    }
    // …while everything else under /api/v1/social still resolves to `social`.
    expect(resolveModuleFromPath("/api/v1/social/oauth-something-else")).toBe("social")
  })

  it("every paid-route gate-module bridges into MODULE_REGISTRY (no silent session-gate skip)", () => {
    // The session module-gate (middleware.ts + api-auth.ts) only fires when the
    // *bridged* module is a real ModuleId: `bridge[resolved] ?? resolved` must be
    // in MODULE_REGISTRY. A permissions.Module that is neither a ModuleId nor
    // bridged (the `offers`→`quotes` class) silently skips the gate while the
    // API-key scope check still passes — this asserts the gate path too.
    const paidRoutes = [
      "/api/v1/complaints", "/api/v1/ticket-macros", "/api/v1/ticket-queues",
      "/api/v1/escalation-rules", "/api/v1/email-log", "/api/v1/email-templates",
      "/api/v1/campaign-roi", "/api/v1/surveys", "/api/v1/social",
      "/api/v1/sequences", "/api/v1/lead-scoring", "/api/v1/lead-rules",
      "/api/v1/territories", "/api/v1/sales-quotas", "/api/v1/task-templates",
      "/api/v1/kb-categories", "/api/v1/quotes", "/api/v1/proactive-alerts",
      "/api/v1/ai-feedback", "/api/v1/ai-observations", "/api/v1/ai-shadow-actions",
      "/api/v1/prediction-models", "/api/v1/content-scores",
    ]
    for (const path of paidRoutes) {
      const resolved = resolveModuleFromPath(path)
      expect(resolved, `${path} must resolve to a module`).toBeTruthy()
      const gateModule = PERMISSION_MODULE_TO_MODULE_ID[resolved!] ?? resolved!
      expect(
        gateModule in MODULE_REGISTRY,
        `${path} → "${resolved}" → "${gateModule}" must be a real ModuleId so the session gate fires`,
      ).toBe(true)
    }
  })

  it("requires AI write permission for shadow action review mutations", () => {
    const source = readFileSync("src/app/api/v1/ai-shadow-actions/route.ts", "utf8")
    expect(source).toContain('export const GET = withRlsAuth("ai", "read"')
    expect(source).toContain('export const PATCH = withRlsAuth("ai", "write"')
  })

  it("requires AI write permission to queue Advisor actions", () => {
    const source = readFileSync("src/app/api/v1/ai/advisor/actions/route.ts", "utf8")
    expect(source).toContain('export const POST = withRlsAuth("ai", "write"')
  })

  it("returns null for unknown path", () => {
    expect(resolveModuleFromPath("/api/v1/unknown")).toBeNull()
    expect(resolveModuleFromPath("/random")).toBeNull()
  })
})

// ─── methodToAction ─────────────────────────────────────────

describe("methodToAction", () => {
  it("GET -> read", () => {
    expect(methodToAction("GET")).toBe("read")
  })

  it("POST -> write", () => {
    expect(methodToAction("POST")).toBe("write")
  })

  it("PUT -> write", () => {
    expect(methodToAction("PUT")).toBe("write")
  })

  it("PATCH -> write", () => {
    expect(methodToAction("PATCH")).toBe("write")
  })

  it("DELETE -> delete", () => {
    expect(methodToAction("DELETE")).toBe("delete")
  })

  it("handles lowercase input", () => {
    expect(methodToAction("get")).toBe("read")
    expect(methodToAction("post")).toBe("write")
  })

  it("unknown method defaults to read", () => {
    expect(methodToAction("OPTIONS")).toBe("read")
  })
})

// ─── modules.ts — hasModule ─────────────────────────────────

describe("hasModule", () => {
  it("sms-otp is always on regardless of plan", () => {
    expect(hasModule({ plan: "starter" }, "sms-otp")).toBe(true)
    expect(hasModule({ plan: "tier-5" }, "sms-otp")).toBe(true)
  })

  // New tier-based plans — BASE fallback yields the 6 base GROUP modules
  it("tier-5 includes base plan group-modules", () => {
    expect(hasModule({ plan: "tier-5" }, "crm")).toBe(true)
    expect(hasModule({ plan: "tier-5" }, "contracts")).toBe(true)
    expect(hasModule({ plan: "tier-5" }, "marketing")).toBe(true)
    expect(hasModule({ plan: "tier-5" }, "analytics")).toBe(true)
    expect(hasModule({ plan: "tier-5" }, "settings")).toBe(true)
    expect(hasModule({ plan: "tier-5" }, "support")).toBe(true)
  })

  it("tier-5 without addons does NOT include ai", () => {
    expect(hasModule({ plan: "tier-5" }, "ai")).toBe(false)
  })

  it("tier-10 with ai addon unlocks ai module", () => {
    expect(hasModule({ plan: "tier-10", addons: ["ai"] }, "ai")).toBe(true)
  })

  it("tier-25 with finance addon unlocks the finance GROUP", () => {
    // Group catalog: the finance addon grants the `finance` group-module —
    // fine-grained legacy ids (invoices/budgeting/profitability) are no longer
    // the gating unit.
    const org = { plan: "tier-25" as string, addons: ["finance"] }
    expect(hasModule(org, "finance")).toBe(true)
    expect(hasModule(org, "mtm")).toBe(false) // unrelated group stays off
  })

  it("org.modules override enables arbitrary module", () => {
    expect(hasModule({ plan: "tier-5", modules: { mtm: true } }, "mtm")).toBe(true)
  })

  // Authoritative-modules semantic: `Organization.features` (materialised into
  // `org.modules`) is source-of-truth for EVERY plan — the plan name no longer
  // grants modules at runtime. Anything not explicitly true is OFF, even base
  // modules like "deals". ONLY a fully-undefined `modules` (a pre-backfill JWT)
  // falls back to BASE_PLAN_MODULES; `{}` is authoritative-empty.
  describe("hasModule — authoritative org.modules for all plans", () => {
    it("explicit modules object disables base modules not listed", () => {
      // Admin saved features=[whatsapp,ai] only — even base groups must be off.
      // (whatsapp/ai are not in LEGACY_MODULE_MAP, so 3b expansion grants nothing.)
      const org = { plan: "enterprise" as string, modules: { whatsapp: true, ai: true } }
      expect(hasModule(org, "crm")).toBe(false)
      expect(hasModule(org, "support")).toBe(false)
      expect(hasModule(org, "finance")).toBe(false)
    })

    it("explicit modules respects what IS listed", () => {
      // Group-vocab record (crm/marketing are NEW-vocab markers → 3b is off).
      const org = { plan: "enterprise" as string, modules: { crm: true, marketing: true } }
      expect(hasModule(org, "crm")).toBe(true)
      expect(hasModule(org, "marketing")).toBe(true)
      expect(hasModule(org, "support")).toBe(false)
    })

    it("alwaysOn module (sms-otp) survives even with restrictive modules", () => {
      const org = { plan: "enterprise" as string, modules: { whatsapp: true } }
      expect(hasModule(org, "sms-otp")).toBe(true)    // alwaysOn
    })

    it("addons still grant modules even when features array is restrictive", () => {
      const org = { plan: "enterprise" as string, modules: { whatsapp: true }, addons: ["ai", "mtm"] }
      // ai unlocked via addon despite not being in modules
      expect(hasModule(org, "ai")).toBe(true)
      expect(hasModule(org, "mtm")).toBe(true)
      // base group still hidden because not in modules and not in any addon
      expect(hasModule(org, "crm")).toBe(false)
    })

    it("empty modules object is authoritative-empty (Clear All saved)", () => {
      // Admin clicked "Clear All" in /admin/tenants/<id>/edit — features=[],
      // org.modules={}. Only alwaysOn + addon-granted modules survive.
      const org = { plan: "enterprise" as string, modules: {} }
      expect(hasModule(org, "sms-otp")).toBe(true)  // alwaysOn
      expect(hasModule(org, "crm")).toBe(false)     // explicitly cleared
      expect(hasModule(org, "support")).toBe(false)
    })

    it("Clear All survives even if addons are populated — only addon modules", () => {
      const org = { plan: "enterprise" as string, modules: {}, addons: ["ai"] }
      expect(hasModule(org, "ai")).toBe(true)       // via addon
      expect(hasModule(org, "crm")).toBe(false)     // not in modules, not in addons
    })

    it("missing modules object falls back to plan defaults (legacy JWT)", () => {
      // No `modules` key at all — JWT predates the column or hasn't been
      // refreshed since the backfill ran. Apply BASE_PLAN_MODULES defaults.
      const org = { plan: "tier-25" as string }
      expect(hasModule(org, "crm")).toBe(true)
      expect(hasModule(org, "ai")).toBe(false)
    })

    it("explicit false in modules is treated as not-enabled (=== true check)", () => {
      // hasModule uses `=== true`, so `false` and missing are equivalent.
      // Pins this behaviour so a future revert to truthy-check doesn't slip in.
      const org = { plan: "enterprise" as string, modules: { crm: false, marketing: true } }
      expect(hasModule(org, "crm")).toBe(false)
      expect(hasModule(org, "marketing")).toBe(true)
    })
  })

  // Legacy-named plans: the plan NAME no longer grants modules — `org.modules`
  // (Organization.features) is authoritative for EVERY plan. These pin the
  // paid-gate bug fix and the transient undefined-modules fallback.
  describe("hasModule — authoritative for legacy-named plans too (paid-gate fix)", () => {
    it("THE BUG FIX: a tenant whose features exclude a base group hides it", () => {
      // Old code forced LEGACY_PLANS.starter modules ON regardless of features —
      // that was the bug. Now features decides. `settings` is a NEW-vocab group
      // marker, so legacy 3b expansion is off and the record is authoritative.
      const org = { plan: "starter" as string, modules: { settings: true } }
      expect(hasModule(org, "settings")).toBe(true)
      expect(hasModule(org, "crm")).toBe(false)     // NOT in features → hidden
      expect(hasModule(org, "support")).toBe(false)
    })

    it("a populated LEGACY-shaped record expands to its groups (3b) on a legacy plan", () => {
      // Pre-catalog tenant record (no NEW-vocab marker) → step 3b expands each
      // legacy id to its group until the backfill rewrites the record.
      const org = { plan: "professional" as string, modules: { core: true, deals: true, invoices: true } }
      expect(hasModule(org, "crm")).toBe(true)         // core/deals → crm
      expect(hasModule(org, "finance")).toBe(true)     // invoices → finance
      expect(hasModule(org, "mtm")).toBe(false)        // nothing maps to mtm
      expect(hasModule(org, "marketing")).toBe(false)  // no campaigns/events in features
    })

    it("undefined modules (pre-backfill JWT) falls back to BASE_PLAN_MODULES on ANY plan", () => {
      // Transient compat path until the next token rotation re-materialises a
      // real `modules` record (post-backfill). Same for legacy + new-tier.
      for (const plan of ["starter", "business", "professional", "enterprise", "tier-25"]) {
        expect(hasModule({ plan }, "crm")).toBe(true)       // crm ∈ BASE
        expect(hasModule({ plan }, "support")).toBe(true)   // support ∈ BASE
        expect(hasModule({ plan }, "marketing")).toBe(true) // marketing ∈ BASE (group catalog folds events in)
        expect(hasModule({ plan }, "mtm")).toBe(false)      // mtm ∉ BASE
        expect(hasModule({ plan }, "ai")).toBe(false)       // ai ∉ BASE
      }
    })

    it("addons grant their module group on any plan, independent of features", () => {
      expect(hasModule({ plan: "starter", modules: {}, addons: ["ai"] }, "ai")).toBe(true)
      expect(hasModule({ plan: "starter", modules: {}, addons: ["mtm"] }, "mtm")).toBe(true)
      // Finance addon unlocks the finance GROUP via ADDON_MODULES.
      expect(hasModule({ plan: "starter", modules: {}, addons: ["finance"] }, "finance")).toBe(true)
      expect(hasModule({ plan: "starter", modules: {}, addons: ["finance"] }, "crm")).toBe(false)
      // Marketing addon → marketing group (the paid Marketing tier, 2026-06-03).
      expect(hasModule({ plan: "starter", modules: {}, addons: ["marketing"] }, "marketing")).toBe(true)
      expect(hasModule({ plan: "starter", modules: {}, addons: ["marketing"] }, "crm")).toBe(false)
      // Direct module-id in `addons` (e.g. a billing-only addon like voip) must
      // still grant the module even without an ADDON_MODULES bundle mapping —
      // the old gate did this on legacy plans, so removing it would regress.
      expect(hasModule({ plan: "starter", modules: {}, addons: ["voip"] }, "voip")).toBe(true)
    })
  })
})

describe("getOrgModules", () => {
  it("returns groups + flags (registry-driven superset) for enterprise with all addons", () => {
    const mods = getOrgModules({ plan: "enterprise", addons: ["ai", "finance", "channels", "mtm"] })
    // BASE fallback groups + addon-granted groups/flags. Superset assertion —
    // robust to the transitional legacy registry entries (removed at the
    // narrow-union task) without churning this test again.
    for (const m of ["crm", "contracts", "marketing", "analytics", "settings", "support",
                     "finance", "omnichannel", "mtm", "ai", "sms-otp"]) {
      expect(mods, m).toContain(m)
    }
    expect(mods).not.toContain("health") // industry clouds are never default
    expect(mods).not.toContain("voip")   // no voip addon on this org
  })

  it("returns base groups + addon modules for tier plan", () => {
    const mods = getOrgModules({ plan: "tier-5", addons: ["ai", "finance"] })
    expect(mods).toContain("ai")
    expect(mods).toContain("finance")
    expect(mods).not.toContain("mtm")
  })
})

describe("MODULE_REGISTRY structure", () => {
  it("every module has a name and requires array", () => {
    for (const [, def] of Object.entries(MODULE_REGISTRY)) {
      expect(def.name).toBeTruthy()
      expect(Array.isArray(def.requires)).toBe(true)
    }
  })

  it("sms-otp is marked as alwaysOn", () => {
    expect(MODULE_REGISTRY["sms-otp"].alwaysOn).toBe(true)
  })
})
