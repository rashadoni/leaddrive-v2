import { describe, it, expect } from "vitest"
import fs from "node:fs"
import path from "node:path"
import {
  MODULE_REGISTRY, GROUP_MODULE_IDS, ADDON_FLAG_IDS,
  LEGACY_MODULE_MAP, INTENTIONALLY_UNGATED, hasModule, moduleRecordFromOrgFields,
  reconcileModulesWithFeatures, withRequiredModules,
} from "@/lib/modules"
import { CAPABILITY_GATED_PERMISSION_SCOPES, PERMISSION_MODULE_TO_MODULE_ID } from "@/lib/permissions"
import { navItems, accessibleNavItems } from "@/lib/nav-items"

describe("group-module registry", () => {
  it("has exactly the sidebar group-modules", () => {
    expect([...GROUP_MODULE_IDS].sort()).toEqual([
      "analytics", "contracts", "crm", "energy", "finance", "health",
      "insurance", "loyalty", "marketing", "media", "mtm", "omnichannel",
      "public-sector", "sales", "settings", "social", "support", "voip",
    ])
  })
  it("every group-module is in MODULE_REGISTRY and Support requires the shared customer base", () => {
    for (const g of GROUP_MODULE_IDS) {
      expect(MODULE_REGISTRY[g], g).toBeDefined()
      expect(MODULE_REGISTRY[g].requires).toEqual(g === "support" ? ["crm"] : [])
    }
  })
  it("normalizes Support into Support plus Основная without changing module keys", () => {
    expect(withRequiredModules(["support"])).toEqual(["support", "crm"])
    expect(reconcileModulesWithFeatures(["support"], {})).toMatchObject({ support: true, crm: true })
  })
  it("ai and voip are addon flags, also registry entries (gateable)", () => {
    expect([...ADDON_FLAG_IDS].sort()).toEqual(["ai", "voip"])
    expect(MODULE_REGISTRY.ai).toBeDefined()
    expect(MODULE_REGISTRY.voip).toBeDefined()
  })
  it("materialises modules from both Organization.features and Organization.modules", () => {
    expect(moduleRecordFromOrgFields({
      features: ["sales", "crm", "mtm"],
      modules: { mtm: false, sampleFeature: true },
    })).toEqual({
      sales: true,
      crm: true,
      mtm: false,
      sampleFeature: true,
    })
  })
  it("does not expose a Support-only tenant without its required customer base", () => {
    expect(moduleRecordFromOrgFields({
      features: ["support"],
      modules: { crm: false },
    })).toMatchObject({ support: true, crm: true })
  })
})

describe("hasModule: тумблер редактора главнее аддона", () => {
  // Жалоба владельца 2026-08-01: в редакторе выключили Omni-Channel, а группа
  // осталась в сайдбаре тенанта — её продолжал выдавать аддон `channels`
  // (дефолтный на планах professional/enterprise). Явный `false` пишет только
  // reconcileModulesWithFeatures, т.е. это сохранённое решение суперадмина.
  it("явный false отменяет грант аддон-бандла (channels → omnichannel)", () => {
    const org = {
      plan: "enterprise",
      addons: ["channels"],
      modules: reconcileModulesWithFeatures(["social", "settings"], {}),
    }
    expect(hasModule(org, "omnichannel")).toBe(false)
    expect(hasModule(org, "social")).toBe(true)
  })

  it("явный false отменяет и прямой module-id в addons", () => {
    const org = {
      plan: "enterprise",
      addons: ["mtm"],
      modules: reconcileModulesWithFeatures(["crm"], {}),
    }
    expect(hasModule(org, "mtm")).toBe(false)
  })

  it("тенант, ни разу не сохранённый в редакторе, гранты аддонов сохраняет", () => {
    // Нет ключа `omnichannel` вовсе (не false) → правило не применяется.
    const org = { plan: "professional", addons: ["channels"], modules: { core: true } }
    expect(hasModule(org, "omnichannel")).toBe(true)
  })

  it("включённый тумблер и аддон вместе — доступ есть", () => {
    const org = {
      plan: "enterprise",
      addons: ["channels"],
      modules: reconcileModulesWithFeatures(["omnichannel"], {}),
    }
    expect(hasModule(org, "omnichannel")).toBe(true)
  })

  it("AI остаётся кросс-модульным флагом, а VoIP — самостоятельным модулем", () => {
    const org = {
      plan: "enterprise",
      addons: ["ai", "voip"],
      modules: reconcileModulesWithFeatures(["crm", "voip"], {}),
    }
    expect(hasModule(org, "ai")).toBe(true)
    expect(hasModule(org, "voip")).toBe(true)
    expect(reconcileModulesWithFeatures(["crm"], {}).voip).toBe(false)
  })
})

describe("reconcileModulesWithFeatures (editor is authoritative for module visibility)", () => {
  it("forces every group-module key to mirror features", () => {
    // Editor saved features = [omnichannel] only; every other group-module → false.
    const result = reconcileModulesWithFeatures(["omnichannel"], {})
    expect(result.omnichannel).toBe(true)
    for (const g of GROUP_MODULE_IDS) {
      if (g !== "omnichannel") expect(result[g], g).toBe(false)
    }
  })

  it("turns OFF a group-module the modules column still grants (the brandprotection bug)", () => {
    // Advisor Suite wrote crm/sales/settings into the modules column; the
    // superadmin then cleared features down to omnichannel. Reconcile must flip
    // the stale grants off.
    const staleColumn = { crm: true, sales: true, settings: true, marketing: true, analytics: true, support: true }
    const reconciled = reconcileModulesWithFeatures(["omnichannel", "social_brand_protection_only"], staleColumn)
    expect(reconciled.crm).toBe(false)
    expect(reconciled.sales).toBe(false)
    expect(reconciled.settings).toBe(false)
    expect(reconciled.omnichannel).toBe(true)

    // End-to-end: hasModule over the reconciled record hides the stale groups.
    const org = { plan: "enterprise", modules: reconciled }
    expect(hasModule(org, "omnichannel")).toBe(true)
    expect(hasModule(org, "crm")).toBe(false)
    expect(hasModule(org, "sales")).toBe(false)
  })

  it("preserves non-group keys (capability-entitlement module ids)", () => {
    const result = reconcileModulesWithFeatures(["crm"], { sampleFeature: true, some_entitlement: true, sales: true })
    expect(result.crm).toBe(true)
    expect(result.sales).toBe(false)         // group-module, not in features → off
    expect(result.sampleFeature).toBe(true)  // non-group key preserved
    expect(result.some_entitlement).toBe(true)
  })

  it("accepts a JSON-string features value and a null modules column", () => {
    const result = reconcileModulesWithFeatures(JSON.stringify(["crm", "finance"]), null)
    expect(result.crm).toBe(true)
    expect(result.finance).toBe(true)
    expect(result.omnichannel).toBe(false)
  })

  it("is idempotent — re-reconciling an already-reconciled column is a no-op", () => {
    const once = reconcileModulesWithFeatures(["crm", "omnichannel"], { legacyKey: true })
    const twice = reconcileModulesWithFeatures(["crm", "omnichannel"], once)
    expect(twice).toEqual(once)
  })

  it("pins the record group-shaped: preserved legacy column keys cannot re-grant a disabled group", () => {
    // Capability grants copy the whole activation-day features array into the
    // modules column, so historic legacy ids (core/tickets/reports) may sit
    // there as true. A reconciled record with ALL six new-vocab markers OFF
    // must NOT re-enter step-3b expansion and resurrect those groups — the
    // explicit `false` markers written by reconcile pin it group-shaped.
    const staleColumn = { core: true, tickets: true, reports: true, crm: true, support: true }
    const reconciled = reconcileModulesWithFeatures(["omnichannel"], staleColumn)
    // Legacy keys are preserved (non-group ids)…
    expect(reconciled.core).toBe(true)
    expect(reconciled.tickets).toBe(true)
    // …but grant nothing: markers are present as booleans → expansion OFF.
    const org = { plan: "enterprise", modules: reconciled }
    expect(hasModule(org, "crm")).toBe(false)      // NOT re-granted via legacy `core`
    expect(hasModule(org, "support")).toBe(false)  // NOT re-granted via legacy `tickets`
    expect(hasModule(org, "analytics")).toBe(false) // NOT re-granted via legacy `reports`
    expect(hasModule(org, "omnichannel")).toBe(true)
  })

  it("full auth-chain shape: merged features+reconciled column yields exactly the toggled groups", () => {
    // Simulate token.modules materialisation for the brandprotection tenant
    // post-repair: features still carries social/AI flags, the column is
    // reconciled with preserved stale legacy keys.
    const reconciled = reconcileModulesWithFeatures(
      ["omnichannel", "social_brand_protection_only", "ai_auto_social_reply"],
      { crm: true, sales: true, settings: true, core: true },
    )
    const merged = moduleRecordFromOrgFields({
      features: ["omnichannel", "social_brand_protection_only", "ai_auto_social_reply"],
      modules: reconciled,
    })
    const org = { plan: "enterprise", modules: merged }
    for (const g of GROUP_MODULE_IDS) {
      expect(hasModule(org, g), g).toBe(g === "omnichannel")
    }
  })
})

describe("LEGACY_MODULE_MAP + expansion", () => {
  it("maps every legacy id to a group", () => {
    expect(LEGACY_MODULE_MAP.campaigns).toBe("marketing")
    expect(LEGACY_MODULE_MAP.core).toBe("crm")
    expect(LEGACY_MODULE_MAP.invoices).toBe("finance")
    expect(LEGACY_MODULE_MAP.workflows).toBe("settings")
    expect(LEGACY_MODULE_MAP.events).toBe("marketing")
    expect(LEGACY_MODULE_MAP.loyalty).toBe("loyalty")
    expect(LEGACY_MODULE_MAP.reports).toBe("analytics")
    expect(LEGACY_MODULE_MAP["knowledge-base"]).toBe("support")
  })
  it("legacy-shaped org: campaigns grants marketing (expansion ON)", () => {
    const org = { plan: "professional", modules: { campaigns: true } }
    expect(hasModule(org, "marketing")).toBe(true)
  })
  it("group-shaped org: expansion OFF — toggling a group off sticks", () => {
    // has a group id → expansion disabled; leftover legacy id must NOT re-grant
    const org = { plan: "professional", modules: { finance: true, campaigns: true } }
    expect(hasModule(org, "marketing")).toBe(false)
    expect(hasModule(org, "finance")).toBe(true)
  })
  it("ambiguous identity ids (contracts/omnichannel) do NOT flip an org group-shaped", () => {
    // Real pre-backfill tenant: old backfill wrote legacy module ids incl. `contracts`
    // (old base list) and `omnichannel` (professional). Expansion must stay ON.
    const org = { plan: "professional", modules: { core: true, contracts: true, omnichannel: true, campaigns: true } }
    expect(hasModule(org, "crm")).toBe(true)        // via legacy core
    expect(hasModule(org, "marketing")).toBe(true)  // via legacy campaigns
    expect(hasModule(org, "support")).toBe(false)   // no legacy support-mapped id present
  })
  it("an explicit FALSE new-vocab marker (reconciled record) also flips group-shaped", () => {
    // `crm: false` can only be written by reconcileModulesWithFeatures — legacy
    // writers and features-materialisation only produce `true`. Presence of the
    // boolean is the marker, so a reconciled record with every marker toggled
    // OFF still keeps expansion disabled (toggles stick).
    const org = { plan: "professional", modules: { crm: false, campaigns: true } }
    expect(hasModule(org, "marketing")).toBe(false) // legacy id must not re-grant
    expect(hasModule(org, "crm")).toBe(false)
  })
  it("a NEW-vocab group id (crm) flips the org group-shaped (toggles stick)", () => {
    const org = { plan: "professional", modules: { crm: true, campaigns: true } }
    expect(hasModule(org, "marketing")).toBe(false) // leftover legacy id must not re-grant
  })
  it("`sales` is NOT a new-vocab marker — adding it to a legacy record never strands legacy expansion", () => {
    // Regression: backfill-sales-module.mjs (and an admin Sales toggle) write
    // `sales` into otherwise-legacy records. If `sales` were a new-vocab marker,
    // `["core","campaigns","sales"]` would flip expansion OFF and lose crm+marketing.
    const org = { plan: "professional", modules: { core: true, campaigns: true, sales: true } }
    expect(hasModule(org, "sales")).toBe(true)      // explicit grant
    expect(hasModule(org, "crm")).toBe(true)        // core→crm STILL expands
    expect(hasModule(org, "marketing")).toBe(true)  // campaigns→marketing STILL expands
  })
  it("INTENTIONALLY_UNGATED holds the nav-less backend verticals", () => {
    for (const s of ["commerce", "data-cloud", "education", "financial-services", "nonprofit", "revenue-recognition", "tpm"]) {
      expect(INTENTIONALLY_UNGATED.has(s), s).toBe(true)
    }
  })
})

describe("scope→group translation", () => {
  it("routes' permission scopes resolve to group-modules", () => {
    const m = PERMISSION_MODULE_TO_MODULE_ID as Record<string, string>
    expect(m["settings"]).toBe("settings")
    expect(m["loyalty"]).toBe("loyalty")
    expect(m["payments"]).toBe("finance")
    expect(m["pricing"]).toBe("finance")
    expect(m["segments"]).toBe("marketing")
    expect(m["audit"]).toBe("settings")
    expect(m["core"]).toBe("crm")
    expect(m["kb"]).toBe("support")
    expect(m["inbox"]).toBe("omnichannel")
    expect(m["energy-utilities"]).toBe("energy")
    // deals/leads/quotes/offers moved from crm → the dedicated sales group-module
    expect(m["offers"]).toBe("sales")
    expect(m["deals"]).toBe("sales")
    expect(m["leads"]).toBe("sales")
  })
})

describe("nav re-tag", () => {
  it("every nav item is tagged with a group-module or a dedicated capability", () => {
    for (const i of navItems) {
      if (i.module) expect([...GROUP_MODULE_IDS], i.href).toContain(i.module)
      else expect(i.capability, i.href).toBeDefined()
    }
  })
  it("AI/VoIP items carry the addon flag", () => {
    for (const href of ["/ai/actions", "/ai-command-center"]) {
      const aiItem = navItems.find((i) => i.href === href)!
      expect(aiItem.module).toBe("analytics")
      expect(aiItem.addon).toBe("ai")
    }
    const voipItem = navItems.find((i) => i.href === "/support/voip")!
    expect(voipItem.module).toBe("support")
    expect(voipItem.addon).toBe("voip")
  })
  it("addon gating: analytics without ai hides AI routes", () => {
    const org = { plan: "x", modules: { analytics: true } }
    const hrefs = accessibleNavItems(org).map((i) => i.href)
    expect(hrefs).toContain("/reports")
    expect(hrefs).not.toContain("/ai/actions")
    expect(hrefs).not.toContain("/ai-command-center")
  })
  it("Advisor Center does not require the Omni-Channel module", () => {
    const hrefs = accessibleNavItems({ plan: "x", modules: { analytics: true, ai: true } }).map((i) => i.href)
    expect(hrefs).toContain("/ai/actions")
    expect(hrefs).toContain("/ai-command-center")
    expect(hrefs).not.toContain("/inbox")
  })
  it("marketing group no longer includes loyalty routes", () => {
    const org = { plan: "x", modules: { marketing: true } }
    const hrefs = accessibleNavItems(org).map((i) => i.href)
    for (const h of ["/campaigns", "/segments", "/surveys", "/journeys", "/events"]) {
      expect(hrefs, h).toContain(h)
    }
    expect(hrefs).not.toContain("/loyalty/dashboard")
    expect(hrefs).not.toContain("/inbox") // omnichannel group not granted
  })
  it("loyalty group shows every loyalty section", () => {
    const org = { plan: "x", modules: { loyalty: true } }
    const hrefs = accessibleNavItems(org).map((i) => i.href)
    for (const h of ["/loyalty/builder", "/loyalty/dashboard", "/loyalty/tiers", "/loyalty/earn-rules", "/loyalty/promo-codes", "/loyalty/pos"]) {
      expect(hrefs, h).toContain(h)
    }
    expect(hrefs).not.toContain("/campaigns")
  })
})

describe("gate integration (MC-T11)", () => {
  it("re-gated scope resolves into the registry (gate actually fires)", () => {
    // Mirror of the api-auth.ts / middleware.ts gate condition: the session
    // module-gate only fires when `bridge[scope] ?? scope` is a real registry
    // id. Re-gated scopes MUST land in the registry; intentionally-ungated
    // scopes MUST NOT (so the gate keeps skipping them by design).
    const gate = (scope: string) => (PERMISSION_MODULE_TO_MODULE_ID as Record<string, string>)[scope] ?? scope
    for (const s of ["settings", "loyalty", "payments", "pricing", "segments", "audit"]) {
      expect(gate(s) in MODULE_REGISTRY, s).toBe(true)
    }
    for (const s of ["commerce", "tpm", "nonprofit"]) {
      expect(gate(s) in MODULE_REGISTRY, s).toBe(false) // stays ungated by design
    }
    expect(CAPABILITY_GATED_PERMISSION_SCOPES.has("workforce")).toBe(true)
  })
})

describe("backfill script drift guard (MC-T11)", () => {
  it("scripts/backfill-group-modules.mjs MAP is a superset of LEGACY_MODULE_MAP", () => {
    // The backfill script inlines its own copy of the legacy→group map (it
    // can't import TS). If modules.ts gains/changes a mapping and the script
    // copy is not updated, tenants would be backfilled with a stale vocabulary.
    // Parse the script's `const MAP = { ... }` literal and assert every
    // LEGACY_MODULE_MAP entry is present with the SAME group value.
    const src = fs.readFileSync(
      path.join(process.cwd(), "scripts", "backfill-group-modules.mjs"),
      "utf8",
    )
    const literal = src.match(/const MAP = \{([\s\S]*?)\n\}/)
    expect(literal, "const MAP = { ... } literal must exist in the script").toBeTruthy()

    const scriptMap: Record<string, string> = {}
    const pair = /(?:"([^"]+)"|([A-Za-z_$][A-Za-z0-9_$]*))\s*:\s*"([^"]+)"/g
    for (const m of literal![1].matchAll(pair)) {
      scriptMap[m[1] ?? m[2]] = m[3]
    }
    // Sanity: the regex actually extracted a real map (37 lib keys + identity extras).
    expect(Object.keys(scriptMap).length).toBeGreaterThanOrEqual(
      Object.keys(LEGACY_MODULE_MAP).length,
    )

    for (const [legacy, group] of Object.entries(LEGACY_MODULE_MAP)) {
      expect(scriptMap[legacy], `script MAP missing/diverged for "${legacy}"`).toBe(group)
    }
  })
})
