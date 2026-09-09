# Sidebar-Aligned Module Catalog — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the cross-cutting ~28-id `MODULE_REGISTRY` with 14 group-modules that mirror the sidebar groups 1:1 (all toggleable) + `ai`/`voip` cross-cutting add-on flags — with zero access loss for live tenants.

**Architecture:** Map-only re-gate: routes keep their permission-scope strings; `PERMISSION_MODULE_TO_MODULE_ID` is extended so every live scope resolves to a group-module (the gate at `api-auth.ts:409-411` is `MAP[scope] ?? scope` → `in MODULE_REGISTRY`). Backward compat = legacy→group expansion inside `hasModule` (active only for "legacy-shaped" tenant records) + an add-only backfill (universal `crm`+`settings`). Correctness is guaranteed by a **CI totality test** that programmatically enumerates the full gate-scope universe and fails on any unclassified scope.

**Tech Stack:** Next.js 16 (App Router), Prisma 6 + PostgreSQL, Vitest, TypeScript.

**Spec:** `docs/superpowers/specs/2026-06-09-sidebar-aligned-module-catalog-design.md` (v3, architect: sound-to-plan).

---

## Compile-safety strategy (read first)

`ModuleId` is consumed by `nav-items.ts` (~70 items), `modules.ts` maps, and tests. To keep **every intermediate commit compiling**:

1. **Task 1** introduces the 14 group ids + keeps the legacy ids in the `ModuleId` union (`GroupModuleId | LegacyModuleId | AddonFlagId`).
2. Tasks 2–8 migrate consumers.
3. **Task 12** narrows `ModuleId` to `GroupModuleId | AddonFlagId | "sms-otp"` and deletes legacy entries — `tsc` then mechanically finds any straggler.

## Key invariants (the implementer must not violate)

- **No route file edits for gating.** The 409 `requireAuth` scope strings stay as-is (they are also API-key scopes). Only `PERMISSION_MODULE_TO_MODULE_ID` changes.
- **Expansion applies only to legacy-shaped records:** if `org.modules` contains ANY group-module id, expansion is OFF for that org (otherwise toggling a group off would be undone by expansion from leftover legacy ids).
- **Backfill is add-only + idempotent** (dry-run by default, `--execute` to write), mirroring `scripts/backfill-base-modules.mjs`.
- **`requires: []` for all 14 groups** (no cascade — matches the all-toggleable decision). `sms-otp` stays `alwaysOn`.

## File structure

**Modify:** `src/lib/modules.ts` (registry, maps, `hasModule`), `src/lib/permissions.ts` (translation map; export `ROUTE_MODULE_MAP` if not already), `src/lib/nav-items.ts` (re-tag + `addon` field + gate), `src/lib/plan-catalog.ts` (catalogs), `scripts/seed-plan-templates.mjs` (fresh-install seed values), `src/app/admin/tenants/new/page.tsx` + `src/app/admin/tenants/[id]/edit/page.tsx` (soft warning).
**Create:** `src/__tests__/lib-module-catalog.test.ts` (registry+hasModule), `src/__tests__/lib-module-catalog-totality.test.ts` (THE invariant), `scripts/backfill-group-modules.mjs`, `scripts/migrate-plan-templates-group-modules.mjs`.

---

### Task 1: Group-module registry + widened union (compiles everywhere)

**Files:** Modify: `src/lib/modules.ts:1-48` · Test: `src/__tests__/lib-module-catalog.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/__tests__/lib-module-catalog.test.ts
import { describe, it, expect } from "vitest"
import { MODULE_REGISTRY, GROUP_MODULE_IDS, ADDON_FLAG_IDS } from "@/lib/modules"

describe("group-module registry", () => {
  it("has exactly the 14 sidebar group-modules", () => {
    expect([...GROUP_MODULE_IDS].sort()).toEqual([
      "analytics", "contracts", "crm", "energy", "finance", "health",
      "insurance", "marketing", "media", "mtm", "omnichannel",
      "public-sector", "settings", "support",
    ])
  })
  it("every group-module is in MODULE_REGISTRY with requires: []", () => {
    for (const g of GROUP_MODULE_IDS) {
      expect(MODULE_REGISTRY[g], g).toBeDefined()
      expect(MODULE_REGISTRY[g].requires).toEqual([])
    }
  })
  it("ai and voip are addon flags, also registry entries (gateable)", () => {
    expect([...ADDON_FLAG_IDS].sort()).toEqual(["ai", "voip"])
    expect(MODULE_REGISTRY.ai).toBeDefined()
    expect(MODULE_REGISTRY.voip).toBeDefined()
  })
})
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run src/__tests__/lib-module-catalog.test.ts` → FAIL (`GROUP_MODULE_IDS` not exported).

- [ ] **Step 3: Implement in `modules.ts`** — ADD (do not yet delete legacy entries):

```typescript
export const GROUP_MODULE_IDS = [
  "crm", "contracts", "marketing", "omnichannel", "support", "finance",
  "analytics", "mtm", "health", "insurance", "public-sector", "media",
  "energy", "settings",
] as const
export type GroupModuleId = (typeof GROUP_MODULE_IDS)[number]

export const ADDON_FLAG_IDS = ["ai", "voip"] as const
export type AddonFlagId = (typeof ADDON_FLAG_IDS)[number]

// Transitional: legacy ids stay in the union until Task 12 narrows it.
export type LegacyModuleId =
  | "core" | "deals" | "leads" | "tasks" | "quotes" | "invoices"
  | "tickets" | "knowledge-base" | "portal" | "campaigns" | "journeys"
  | "workflows" | "profitability" | "budgeting" | "reports" | "currencies"
  | "custom-fields" | "events" | "projects"
export type ModuleId = GroupModuleId | AddonFlagId | "sms-otp" | LegacyModuleId
```

Rewrite `MODULE_REGISTRY` to contain: the 14 groups (names = English sidebar labels: `CRM`, `Contracts Control`, `Marketing`, `Omni-Channel`, `Support`, `Finance`, `Analytics`, `Route & Field (MTM)`, `Health Cloud`, `Insurance Cloud`, `Public Sector Cloud`, `Media Cloud`, `Energy & Utilities`, `Settings`), each `{ requires: [] }`; plus `ai: { name: "Da Vinci AI", requires: [] }`, `voip: { name: "VoIP / Telephony", requires: [] }`, `sms-otp: { name: "SMS OTP (2FA)", requires: [], alwaysOn: true }`. **Keep the legacy entries for now** (they'll be deleted in Task 12) so `Record<ModuleId, ModuleDefinition>` stays total. Update `ADDON_MODULES` to `{ ai: ["ai"], voip: ["voip"], channels: ["omnichannel"], finance: ["finance"], mtm: ["mtm"], marketing: ["marketing"] }`; `PAID_ADDONS`/`SEPARATE_SUBSCRIPTIONS` moduleIds likewise (`finance: ["finance"]`, industry clouds unchanged — identity ids). Replace `BASE_PLAN_MODULES` with `["crm", "contracts", "marketing", "analytics", "settings", "support"]` (old base list mapped through the legacy map; `events` was base → `marketing` included) and update its doc comment.

- [ ] **Step 4: Run** `npx vitest run src/__tests__/lib-module-catalog.test.ts && npx tsc --noEmit` → PASS / clean (legacy ids still valid everywhere).
- [ ] **Step 5: Commit** — `git add src/lib/modules.ts src/__tests__/lib-module-catalog.test.ts && git commit -m "feat(modules): 14 group-modules + addon flags (transitional union)"`

---

### Task 2: `LEGACY_MODULE_MAP` + `INTENTIONALLY_UNGATED` + `hasModule` expansion

**Files:** Modify: `src/lib/modules.ts` (after the registry) · Test: append to `src/__tests__/lib-module-catalog.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
import { LEGACY_MODULE_MAP, INTENTIONALLY_UNGATED, hasModule } from "@/lib/modules"

describe("LEGACY_MODULE_MAP + expansion", () => {
  it("maps every legacy id to a group", () => {
    expect(LEGACY_MODULE_MAP.campaigns).toBe("marketing")
    expect(LEGACY_MODULE_MAP.core).toBe("crm")
    expect(LEGACY_MODULE_MAP.invoices).toBe("finance")
    expect(LEGACY_MODULE_MAP.workflows).toBe("settings")
    expect(LEGACY_MODULE_MAP.events).toBe("marketing")
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
  it("INTENTIONALLY_UNGATED holds the nav-less backend verticals", () => {
    for (const s of ["commerce", "data-cloud", "education", "financial-services", "nonprofit", "revenue-recognition", "tpm"]) {
      expect(INTENTIONALLY_UNGATED.has(s), s).toBe(true)
    }
  })
})
```

- [ ] **Step 2: Run to verify FAIL** — `npx vitest run src/__tests__/lib-module-catalog.test.ts`

- [ ] **Step 3: Implement in `modules.ts`**

```typescript
/** Legacy/scope id → group-module. Illustrative prose lives in the spec; the
 *  totality test (lib-module-catalog-totality.test.ts) is the completeness guarantee. */
export const LEGACY_MODULE_MAP: Record<string, GroupModuleId> = {
  core: "crm", deals: "crm", leads: "crm", tasks: "crm", quotes: "crm",
  offers: "crm", projects: "crm", companies: "crm", contacts: "crm",
  campaigns: "marketing", events: "marketing", journeys: "marketing",
  segments: "marketing", loyalty: "marketing", "account-engagement": "marketing",
  omnichannel: "omnichannel", inbox: "omnichannel",
  tickets: "support", "knowledge-base": "support", kb: "support", portal: "support",
  invoices: "finance", budgeting: "finance", profitability: "finance",
  pricing: "finance", payments: "finance", subscriptions: "finance", finance: "finance",
  reports: "analytics",
  workflows: "settings", "custom-fields": "settings", currencies: "settings",
  audit: "settings", users: "settings", settings: "settings",
  inventory: "mtm", "energy-utilities": "energy",
}

/** Scopes that stay module-UNGATED on purpose (nav-less backend verticals +
 *  action-string artifacts). Anything not mapped/identity/here = CI failure. */
export const INTENTIONALLY_UNGATED = new Set<string>([
  "commerce", "data-cloud", "education", "financial-services",
  "nonprofit", "revenue-recognition", "tpm",
  "read", "write", "delete", // action strings appearing as scope args — see Task 5
])
```

In `hasModule`, insert between steps 3 and 4:

```typescript
  // 3b. Legacy-shaped record (pre-group-catalog tenant): expand legacy ids to
  //     their group. Active ONLY when no group id is present — once a tenant is
  //     backfilled/saved with group ids, toggles are authoritative (no re-grant).
  if (org.modules && !NEW_VOCAB_GROUP_IDS.some((g) => org.modules![g] === true)) {
    for (const [legacy, group] of Object.entries(LEGACY_MODULE_MAP)) {
      if (group === moduleId && org.modules[legacy] === true) return true
    }
  }
```

> **HARDENING (applied during execution, T2 quality review):** the group-shaped guard uses `NEW_VOCAB_GROUP_IDS = ["crm","marketing","support","finance","analytics","settings"]` (group ids ABSENT from the legacy features vocabulary), NOT all `GROUP_MODULE_IDS`. Reason: ambiguous identity ids (`contracts`, `omnichannel`, `mtm`, industry clouds) were written into `features` by OLD backfills as legacy module ids — treating them as group-shaped markers would disable expansion for every pre-backfill tenant (old base list included `contracts`) and cause mass access loss in the deploy→backfill window. Regression tests cover both directions.

- [ ] **Step 4: Run** `npx vitest run src/__tests__/lib-module-catalog.test.ts && npx tsc --noEmit` → PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(modules): legacy->group expansion + intentionally-ungated allowlist"`

---

### Task 3: Extend `PERMISSION_MODULE_TO_MODULE_ID` (map-only re-gate)

**Files:** Modify: `src/lib/permissions.ts:140-145` · Test: append to `src/__tests__/lib-module-catalog.test.ts`
**Downstream consumers (verify, do not edit unless broken):** `src/lib/api-auth.ts:409` (the gate), `src/middleware.ts:628` (**Edge runtime** — the map must stay importable from Edge: keep it in a PURE module with zero Node/Prisma imports; `modules.ts` is pure today — if extracting to `src/lib/module-map.ts`, keep it dependency-free and typed `Record<string, GroupModuleId>`), `src/lib/notifications/access.ts:48` (builds the INVERSE map ModuleId→scopes — after extension each group id gains multiple scope keys; run `npx vitest run src/__tests__ -t notification` and any access tests to confirm no regression).

- [ ] **Step 1: Failing test**

```typescript
import { PERMISSION_MODULE_TO_MODULE_ID } from "@/lib/permissions"

describe("scope→group translation", () => {
  it("routes' permission scopes resolve to group-modules", () => {
    const m = PERMISSION_MODULE_TO_MODULE_ID as Record<string, string>
    expect(m["settings"]).toBe("settings")
    expect(m["loyalty"]).toBe("marketing")
    expect(m["payments"]).toBe("finance")
    expect(m["pricing"]).toBe("finance")
    expect(m["segments"]).toBe("marketing")
    expect(m["audit"]).toBe("settings")
    expect(m["core"]).toBe("crm")
    expect(m["kb"]).toBe("support")          // pre-existing alias, new target
    expect(m["inbox"]).toBe("omnichannel")
    expect(m["energy-utilities"]).toBe("energy")
    expect(m["offers"]).toBe("crm")          // CPQ permission-scope
  })
})
```

- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** — replace the 4-entry map with the full scope→group map. Source of truth: spread `LEGACY_MODULE_MAP` (import from `modules.ts` — it already contains every live scope) and override nothing:

```typescript
import { LEGACY_MODULE_MAP } from "./modules"
export const PERMISSION_MODULE_TO_MODULE_ID: Record<string, ModuleId> =
  { ...LEGACY_MODULE_MAP }
```
(If a circular-import issue arises (`modules.ts` ↔ `permissions.ts`), move `LEGACY_MODULE_MAP` into a new tiny `src/lib/module-map.ts` imported by both — keep one source of truth either way.)
Also: `export` `ROUTE_MODULE_MAP` if it isn't exported (the totality test needs it).

- [ ] **Step 4: Run** test + `npx tsc --noEmit` → PASS. The gate at `api-auth.ts:409` now resolves `settings`/`loyalty`/`payments`/… to group-modules — they become gated; expansion (Task 2) + backfill (Task 8) keep tenants authorized.
- [ ] **Step 5: Commit** — `git commit -am "feat(permissions): full scope->group translation (map-only re-gate)"`

---

### Task 4: Re-tag nav items + `addon` field + gate

**Files:** Modify: `src/lib/nav-items.ts` · Test: append tests

- [ ] **Step 1: Failing tests**

```typescript
import { navItems, accessibleNavItems } from "@/lib/nav-items"
import { GROUP_MODULE_IDS } from "@/lib/modules"

describe("nav re-tag", () => {
  it("every nav item is tagged with a group-module", () => {
    for (const i of navItems) expect([...GROUP_MODULE_IDS]).toContain(i.module)
  })
  it("AI/VoIP items carry the addon flag", () => {
    const aiItem = navItems.find((i) => i.href === "/ai-command-center")!
    expect(aiItem.module).toBe("analytics"); expect(aiItem.addon).toBe("ai")
    const voipItem = navItems.find((i) => i.href === "/support/voip")!
    expect(voipItem.module).toBe("support"); expect(voipItem.addon).toBe("voip")
  })
  it("addon gating: analytics without ai hides ai-command-center", () => {
    const org = { plan: "x", modules: { analytics: true } }
    const hrefs = accessibleNavItems(org).map((i) => i.href)
    expect(hrefs).toContain("/reports")
    expect(hrefs).not.toContain("/ai-command-center")
  })
})
```

- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement**
  - `NavItem`: add `addon?: "ai" | "voip"`.
  - Re-tag every item to its **group's** module (group → module name): CRM→`crm`, Contracts Control→`contracts`, Marketing→`marketing`, Communication→`omnichannel`, Support→`support`, Finance→`finance`, Analytics→`analytics`, Route & Field→`mtm`, clouds→identity, Settings→`settings`. Exceptions by **meaning**, not group: `/social-monitoring` (Communication group) → `module: "marketing"` stays per spec? **No** — per the approved 1:1 model it takes its GROUP's module: `omnichannel`. Re-tag it `omnichannel`. `/forecast*` (Analytics) → `analytics`. `/ai-scoring`, `/journeys`, `/sequences` (Marketing) → `marketing`. Settings items `quotas`/`territories`/`task-templates`/`ai-automation` → `settings` (+`addon:"ai"` on ai-automation).
  - Add `addon: "ai"` to `/ai/actions`, `/ai-command-center`, `/settings/ai-automation`; `addon: "voip"` to `/support/voip`, `/voip/insights`, `/settings/voip`.
  - In `accessibleNavItems`, add the addon gate for non-superadmin AND superadmin paths consistent with `feature`:
    ```typescript
    const addonEnabled = (i: NavItem) => !i.addon || hasModule(org, i.addon)
    return showAll
      ? navItems.filter((i) => featureEnabled(i.feature) && addonEnabled(i))
      : navItems.filter((i) => hasModule(org, i.module) && featureEnabled(i.feature) && addonEnabled(i))
    ```
    (Superadmin keeps seeing group items via `showAll`; addon flags still apply so the menu reflects what the tenant bought — matches current `feature` behavior.)
- [ ] **Step 4: Run** tests + `npx tsc --noEmit` → PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(nav): re-tag items to group-modules + ai/voip addon gating"`

---

### Task 5: THE totality invariant test (CI guarantee)

**Files:** Create: `src/__tests__/lib-module-catalog-totality.test.ts`

- [ ] **Step 1: Write the test (it should PASS now; its job is to fail FOREVER AFTER on any unclassified scope)**

```typescript
import { describe, it, expect } from "vitest"
import fs from "node:fs"
import path from "node:path"
import { navItems } from "@/lib/nav-items"
import { MODULE_REGISTRY, GROUP_MODULE_IDS, ADDON_FLAG_IDS, LEGACY_MODULE_MAP, INTENTIONALLY_UNGATED } from "@/lib/modules"
import { PERMISSION_MODULE_TO_MODULE_ID, ROUTE_MODULE_MAP } from "@/lib/permissions"

const GROUPS = new Set<string>(GROUP_MODULE_IDS)
const FLAGS = new Set<string>([...ADDON_FLAG_IDS, "sms-otp"])

/** A scope counts as classified iff: translates (pre-membership!) to a group/flag,
 *  is itself a group/flag (identity), or is intentionally ungated. */
function classified(scope: string): boolean {
  const translated = (PERMISSION_MODULE_TO_MODULE_ID as Record<string, string>)[scope] ?? scope
  if (GROUPS.has(translated) || FLAGS.has(translated)) return true
  if (INTENTIONALLY_UNGATED.has(scope)) return true
  return false
}

function explicitRequireAuthScopes(): Set<string> {
  const root = path.resolve(__dirname, "../app/api")
  const out = new Set<string>()
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.name.endsWith(".ts")) {
        const src = fs.readFileSync(p, "utf8")
        for (const m of src.matchAll(/requireAuth\(\s*[\w.]+\s*,\s*"([a-z0-9-]+)"/g)) out.add(m[1])
      }
    }
  }
  walk(root)
  return out
}

describe("module-catalog totality (blocking invariant)", () => {
  it("every scope in the full gate universe is classified", () => {
    const universe = new Set<string>([
      ...Object.keys(MODULE_REGISTRY),
      ...Object.values(ROUTE_MODULE_MAP as Record<string, string>),
      ...explicitRequireAuthScopes(),
      ...navItems.map((i) => i.module as string),
    ])
    const unclassified = [...universe].filter((s) => !classified(s)).sort()
    expect(unclassified, `Unclassified scopes: ${unclassified.join(", ")} — map them in LEGACY_MODULE_MAP or add to INTENTIONALLY_UNGATED`).toEqual([])
  })
  it("alias translation happens BEFORE membership (one case per alias)", () => {
    for (const [alias, target] of [["kb", "support"], ["inbox", "omnichannel"], ["energy-utilities", "energy"], ["offers", "crm"]] as const) {
      expect((PERMISSION_MODULE_TO_MODULE_ID as Record<string, string>)[alias]).toBe(target)
    }
  })
})
```

- [ ] **Step 2: Run** `npx vitest run src/__tests__/lib-module-catalog-totality.test.ts`. If `unclassified` is non-empty, **do not weaken the test** — add the real ids to `LEGACY_MODULE_MAP` (live) or `INTENTIONALLY_UNGATED` (nav-less/dead; grep first: `grep -rn "requireAuth(req, \"<id>\"" src/app/api`). Iterate until green.

> **Note:** the fs-scan also captures scopes from JSDoc comments and action-strings (`requireAuth(req, "read")` style) — `read`/`write`/`delete` are pre-seeded in `INTENTIONALLY_UNGATED`. A future comment-only or action-only "scope" will surface here and demand an explicit allowlist entry — that's intended (forces a human look), not a test bug.
- [ ] **Step 3: Commit** — `git add src/__tests__/lib-module-catalog-totality.test.ts && git commit -m "test(modules): totality invariant over the full gate universe"`

---

### Task 6: Plan catalogs (`plan-catalog.ts`) for the new ids

**Files:** Modify: `src/lib/plan-catalog.ts` · Test: `src/__tests__/lib-plan-catalog.test.ts` (exists; extend)

- [ ] **Step 1: Failing test (append)**

```typescript
it("FEATURE_CATALOG = 14 groups + legacy flags; ADDON_CATALOG covers bundles + flags", () => {
  for (const g of ["crm", "marketing", "finance", "settings"]) expect(FEATURE_CATALOG).toContain(g)
  for (const f of ["whatsapp", "complaints_register"]) expect(FEATURE_CATALOG).toContain(f)
  for (const a of ["ai", "voip", "channels", "finance", "mtm", "marketing"]) expect(ADDON_CATALOG).toContain(a)
})
```

- [ ] **Step 2: Run → FAIL** (registry keys changed under it). **Step 3:** `FEATURE_CATALOG = [...Object.keys(MODULE_REGISTRY), "whatsapp", "complaints_register"]` (registry now = groups + flags + transitional legacy until Task 12 — after Task 12 it's exactly groups+flags+sms-otp; keep the drift test green at both points). `ADDON_CATALOG` unchanged shape (`ADDON_MODULES` keys ∪ bundles ∪ "voip" already covered by ADDON_MODULES now).
- [ ] **Step 4: Run** plan-catalog tests + tsc → PASS. **Step 5: Commit.**

---### Task 7: PlanTemplate migration script (3 seeded tariffs) + seed update

**Files:** Create: `scripts/migrate-plan-templates-group-modules.mjs` · Modify: `scripts/seed-plan-templates.mjs`

- [ ] **Step 1: Write the migration script** (idempotent, dry-run default — updates the 3 legacy tariff rows to group ids; custom operator-created plans are translated too via the same map):

```javascript
// scripts/migrate-plan-templates-group-modules.mjs
// Translate PlanTemplate.features legacy ids -> group-module ids (add-only union,
// legacy ids retained for rollback; UI shows only registry ids). Dry-run default.
// Usage: node scripts/migrate-plan-templates-group-modules.mjs [--execute]
import { PrismaClient } from "@prisma/client"
const prisma = new PrismaClient()

const MAP = { core:"crm", deals:"crm", leads:"crm", tasks:"crm", quotes:"crm", projects:"crm",
  campaigns:"marketing", events:"marketing", journeys:"marketing",
  invoices:"finance", budgeting:"finance", profitability:"finance",
  tickets:"support", "knowledge-base":"support", portal:"support",
  reports:"analytics", workflows:"settings", "custom-fields":"settings", currencies:"settings",
  omnichannel:"omnichannel" } // flags (whatsapp, complaints_register, ai, voip) pass through

async function main() {
  const execute = process.argv.includes("--execute")
  console.log(`[migrate-plan-templates] mode=${execute ? "EXECUTE" : "DRY-RUN"}`)
  const plans = await prisma.planTemplate.findMany()
  for (const p of plans) {
    const groups = p.features.map((f) => MAP[f]).filter(Boolean)
    const target = [...new Set([...p.features, ...groups])]
    if (target.length === p.features.length) { console.log(`  ok ${p.key}`); continue }
    console.log(`  PATCH ${p.key}: +[${target.filter((t) => !p.features.includes(t)).join(", ")}]`)
    if (execute) await prisma.planTemplate.update({ where: { id: p.id }, data: { features: target } })
  }
}
main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
```

- [ ] **Step 2: Update `scripts/seed-plan-templates.mjs`** LEGACY array for fresh installs (decision — defaults, operator can edit in `/admin/plans`):
  - starter: `features: ["crm", "settings"]`, addons `[]`
  - professional: `features: ["crm", "contracts", "marketing", "omnichannel", "support", "finance", "analytics", "settings", "whatsapp", "complaints_register"]`, addons `["ai", "channels"]`
  - enterprise: `features: [all 14 groups, "whatsapp", "complaints_register"]`, addons `["ai", "channels", "finance", "mtm", "voip"]`
- [ ] **Step 3: Verify** `node --check scripts/migrate-plan-templates-group-modules.mjs && node --check scripts/seed-plan-templates.mjs` → both parse. (No local DB — execution happens at rollout.)
- [ ] **Step 4: Commit.**

---

### Task 8: Tenant backfill script

**Files:** Create: `scripts/backfill-group-modules.mjs`

- [ ] **Step 1: Write it** (mirror `backfill-base-modules.mjs` structure: dry-run/`--execute`, add-only, idempotent):

```javascript
// scripts/backfill-group-modules.mjs
// Add group-module ids to every tenant's features per the legacy map, PLUS:
//   - universal: crm + settings (those scopes were ungated -> everyone had access)
//   - finance  : if any of invoices/budgeting/profitability/pricing
//   - marketing: if any of campaigns/events
// Add-only union; legacy ids retained (hasModule expansion turns OFF once a
// group id is present, so toggles become authoritative after this runs).
// Usage: node scripts/backfill-group-modules.mjs [--execute]
import { PrismaClient } from "@prisma/client"
const prisma = new PrismaClient()

const MAP = { core:"crm", deals:"crm", leads:"crm", tasks:"crm", quotes:"crm", projects:"crm",
  companies:"crm", contacts:"crm",
  campaigns:"marketing", events:"marketing", journeys:"marketing", segments:"marketing", loyalty:"marketing",
  omnichannel:"omnichannel", inbox:"omnichannel",
  tickets:"support", "knowledge-base":"support", kb:"support", portal:"support",
  invoices:"finance", budgeting:"finance", profitability:"finance", pricing:"finance",
  payments:"finance", subscriptions:"finance",
  reports:"analytics", workflows:"settings", "custom-fields":"settings", currencies:"settings",
  mtm:"mtm", health:"health", insurance:"insurance", "public-sector":"public-sector",
  media:"media", energy:"energy", contracts:"contracts" }

const parse = (f) => { try { const v = typeof f === "string" ? JSON.parse(f) : f; return Array.isArray(v) ? v : [] } catch { return [] } }

async function main() {
  const execute = process.argv.includes("--execute")
  console.log(`[backfill-group-modules] mode=${execute ? "EXECUTE" : "DRY-RUN"}`)
  const orgs = await prisma.organization.findMany({ select: { id: true, slug: true, features: true } })
  let touched = 0
  for (const org of orgs) {
    const cur = parse(org.features)
    const groups = new Set(["crm", "settings"])                       // universal
    for (const f of cur) if (MAP[f]) groups.add(MAP[f])
    const target = [...new Set([...cur, ...groups])]
    const missing = target.filter((f) => !cur.includes(f))
    if (!missing.length) { console.log(`  ok ${org.slug}`); continue }
    console.log(`  PATCH ${org.slug}: +[${missing.join(", ")}]`)
    touched++
    if (execute) await prisma.organization.update({ where: { id: org.id }, data: { features: target } })
  }
  console.log(`[backfill-group-modules] done; ${touched} patched`)
}
main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
```

- [ ] **Step 2:** `node --check scripts/backfill-group-modules.mjs` → parses. **Step 3: Commit.**

> **Note (pre-backfill edits are fine):** a tenant edited in `/admin` BEFORE this backfill runs saves chips built from the new `MODULE_REGISTRY` → writes group ids → T2's expansion flips OFF for that org early. Safe by design (the operator chose the chips explicitly); the backfill is NOT the only group-id writer.

---

### Task 9: Wizard/edit soft warning (crm/settings off) — labels auto-update

**Files:** Modify: `src/app/admin/tenants/new/page.tsx`, `src/app/admin/tenants/[id]/edit/page.tsx`

- [ ] **Step 1:** Both pages already render chips from `MODULE_REGISTRY` (auto-shows the 14 + flags after Task 1/12). Add below the chips grid in BOTH pages:

```tsx
{(!form.features.includes("crm") || !form.features.includes("settings")) && (
  <p className="text-xs text-amber-600">
    ⚠ CRM/Settings are core groups — tenant users lose those sections when disabled.
    Superadmin can always re-enable from this panel.
  </p>
)}
```
(In the edit page the state variable holding features may be named differently — adapt to its existing state name; the condition logic is identical.)

- [ ] **Step 2:** `npx tsc --noEmit` → clean. **Step 3: Commit.**

---

### Task 10: Sweep stale module-id references in existing tests/code

- [ ] **Step 1:** `grep -rn "\"campaigns\"\|\"knowledge-base\"\|\"budgeting\"\|\"profitability\"" src/__tests__ src/lib src/components --include="*.ts" --include="*.tsx" | grep -v "LEGACY\|MAP\|backfill"` — for each hit decide: test fixture → update to group id; runtime logic → must go through `hasModule`/maps (no direct legacy checks left).
- [ ] **Step 2:** `npx vitest run` (full suite) — fix fallout (typical: nav-gating tests asserting old module ids; `getOrgModules` consumers). Expected pre-existing failure allowed: `api-offers.test.ts` jsPDF (environmental, known).
- [ ] **Step 3: Commit** — `git commit -am "test(modules): migrate fixtures to group-module ids"`

---

### Task 11: Auth/api-auth integration checks

- [ ] **Step 1: Append integration-style unit test** (mock prisma; assert the 409-route gate path works end-to-end for a re-gated scope):

```typescript
// in src/__tests__/lib-module-catalog.test.ts
import { MODULE_REGISTRY } from "@/lib/modules"
import { PERMISSION_MODULE_TO_MODULE_ID } from "@/lib/permissions"
it("re-gated scope resolves into the registry (gate actually fires)", () => {
  const gate = (scope: string) => (PERMISSION_MODULE_TO_MODULE_ID as any)[scope] ?? scope
  for (const s of ["settings", "loyalty", "payments", "pricing", "segments", "audit"]) {
    expect(gate(s) in MODULE_REGISTRY, s).toBe(true)
  }
  for (const s of ["commerce", "tpm", "nonprofit"]) {
    expect(gate(s) in MODULE_REGISTRY, s).toBe(false)   // stays ungated by design
  }
})
```

- [ ] **Step 2: Run + commit.**

---

### Task 12: Narrow the union (delete legacy registry entries)

**Files:** Modify: `src/lib/modules.ts`

- [ ] **Step 1:** Change `export type ModuleId = GroupModuleId | AddonFlagId | "sms-otp"` (drop `LegacyModuleId` from the union; keep the type exported for the map's keys typing if needed as plain string). Delete the legacy entries from `MODULE_REGISTRY`.
- [ ] **Step 2:** `npx tsc --noEmit` — **every straggler surfaces here**; fix each by re-tagging to a group id (no suppressions).
- [ ] **Step 3:** `npx vitest run` full suite → green (modulo known jsPDF). **Step 4: Commit** — `git commit -am "feat(modules)!: narrow ModuleId to group catalog"`

---

### Task 13: Full verification + rollout (deploy-time, with user confirmation)

- [ ] **Step 1:** `npx tsc --noEmit && npx vitest run` → clean (known jsPDF exception).
- [ ] **Step 2:** `npx next build --webpack 2>&1 | tail -5` → success.
- [ ] **Step 3: Rollout order (per server; ASK USER for target first — deploy-ask-target rule):**
  1. Merge branch → `main`, push (CI auto-deploy: build + `prisma migrate deploy` — no schema change here, harmless).
  2. **Immediately after deploy:** `node scripts/backfill-group-modules.mjs --execute` (expansion layer covers the gap; backfill makes toggles authoritative).
  3. `node scripts/migrate-plan-templates-group-modules.mjs --execute` (tariffs show group toggles).
  4. Smoke: `/api/v1/ping` → ok; login as a tenant user → sidebar unchanged vs pre-deploy; `/admin/plans` chips show 14 groups; toggle a group off on a throwaway tenant → section disappears for its users, stays visible to superadmin.
- [ ] **Step 4: E2E checklist (throwaway tenant):** provision with only `marketing`+`mtm` → exactly Marketing + Route&Field appear (+ CRM/Settings only if granted); a legacy-shaped tenant (features=`["campaigns"]`, no groups) still sees Marketing; disabling `crm` on a group-shaped tenant sticks (expansion off).

---

## Self-review (done against the spec)

- **Spec coverage:** §3 model → T1/T4; §4.1-.2 → T1/T2/T4; §4.3 map-only → T3 (+T11 verification); §4.4 → T6/T7; §5 compat → T2 (expansion incl. legacy-shaped-only rule) + T8 (universal crm/settings, finance/marketing predicates); §6 tests → T5 (totality + alias-pre-translation + per-alias cases), T2/T4/T11 units, T13 E2E; §7 rollout → T13; §10 opens resolved in-plan: `requires: []` (no cascade), `INTENTIONALLY_UNGATED` for the 7 verticals + action-string artifacts (T2/T5 force the grep-confirm), `NavItem.addon` field (T4), warning copy (T9); i18n AZ labels deliberately deferred (English registry names now — noted, non-blocking).
- **Placeholder scan:** none; every code step has real code; the two "adapt to existing state name" notes are bounded local lookups, not designs.
- **Type consistency:** `GROUP_MODULE_IDS`/`ADDON_FLAG_IDS`/`LEGACY_MODULE_MAP`/`INTENTIONALLY_UNGATED` defined T1/T2, consumed T3/T5/T6/T11/T12 with identical names; widened-then-narrowed `ModuleId` keeps every commit compiling.
- **Deviation from spec (declared):** spec §3 kept `/social-monitoring` gated by marketing while sitting in Communication; the approved 1:1 model (user: "дробим так", 1 группа = 1 модуль) wins → re-tagged `omnichannel` (T4). Flagged for user review.
- **Architect plan-review (2026-06-09) resolutions:** (1) "phantom `plan-catalog.ts`" — FALSE POSITIVE: the file exists on this branch (created by configurable-plans, deployed); the architect grepped a stale checkout. T6 valid as written. (2) `middleware.ts:628` (Edge) + `notifications/access.ts:48` consumers added to T3. (3) Pre-backfill `/admin`-edit note added to T8; comment/action-scope note added to T5. (4) AZ i18n for the 14 chip labels recorded in `memory/deferred_findings.md` [P3].

---

## Rollout runbook (executed at deploy time)

> Status at branch close (MC-T13, 2026-06-10): code + scripts verified locally —
> `tsc --noEmit` 0 errors; full `vitest run` 9903 passed / 5 failed (all 5 are the
> pre-existing env baseline: 4 FB/IG OAuth-state + 1 api-offers jsPDF); production
> `next build --webpack` succeeds. NOTHING DEPLOYED YET. Per the deploy-ask-target
> rule, confirm the target with the user before every step below.

### Order of operations (per server)

Two databases exist (see `clients/registry.json`):
- **Shared box `13.140.132.245`** — one DB serves the `leaddrive`, `zeytunpharm`,
  `afigroup`, `mars` tenants → ONE run of each script covers all four.
- **Fanum `187.124.189.139`** (Fanum Tech, separate DB) → repeat deploy + both
  scripts there separately.

1. **Merge → push `main`** — CI auto-deploys (build + `prisma migrate deploy`;
   this branch has NO schema change, so migrate is a no-op). Standalone-build
   gotchas (static copy, Prisma engine) are already handled by
   `scripts/server-deploy.sh`.
2. **IMMEDIATELY after the deploy lands, per server:**
   `node scripts/backfill-group-modules.mjs --execute`
   (dry-run first if cautious: same command without `--execute`).
   Until it runs, tenants are safe anyway — `hasModule` step 3b expands
   legacy-shaped `features` records to their groups, so sidebars stay intact in
   the deploy→backfill window. The backfill is what makes admin toggles
   authoritative (adds group ids; add-only, idempotent, rollback-safe).
3. **Then, per server:**
   `node scripts/migrate-plan-templates-group-modules.mjs --execute`
   — rewrites PlanTemplate.features to group vocabulary so `/admin/plans`
   and the tenant wizard offer group chips.
4. **Smoke (per server):**
   - `curl -s https://<domain>/api/v1/ping` → `{"ok":true,"db":"ok"}`.
   - Log in as a tenant user → sidebar sections UNCHANGED vs pre-deploy.
   - `/admin/plans` → plan chips show the 14 group ids (+ whatsapp /
     complaints_register extras), no legacy fine-grained chips.
   - Throwaway tenant: toggle a group off in `/admin/tenants/<id>/edit` →
     section disappears for its users, stays visible to superadmin; toggle
     back on → returns. (Group-shaped record ⇒ expansion off ⇒ toggles stick.)
5. **Fanum separately:** repeat steps 1-4 against `187.124.189.139`
   (deploy via `bash scripts/client.sh deploy fanum`, then run both scripts
   on that box — its DB is independent of the shared box).

### Known transient effect (expected, self-healing)

**Wizard warning before the plan-template migration (step 3):** the MC-T9
amber warning fires in `/admin/tenants/new` + `/admin/tenants/<id>/edit`
whenever `crm`/`settings` are missing from the form's features. Between
deploy (step 1) and the plan-template migration (step 3), DB PlanTemplate
rows still carry LEGACY ids — a wizard pre-filled from such a template lacks
the `crm`/`settings` GROUP ids, so every new-tenant form shows the core-group
warning. Harmless: the superadmin can click the chips in place, and the
warning disappears for good once step 3 rewrites the templates. (Existing
tenants are unaffected — step 2 gives them the universal `crm`+`settings`
floor.)
