# Sidebar-Aligned Module Catalog — Design Spec

- **Date:** 2026-06-09
- **Status:** Draft v3 (architect-reviewed ×3, sound-to-plan; awaiting user review → writing-plans → implementation)
- **Author:** Developer (Claude) + User (Rashad)
- **Branch:** `feat/module-catalog`
- **Reviewers:** Architect (evidence-grade) — findings incorporated (see §11)

## 1. Goal

Replace the cross-cutting, coarse module catalog (`MODULE_REGISTRY`, ~28 ids that don't line up with what users see) with a catalog that mirrors the **sidebar groups 1:1** — so the superadmin module toggles (wizard + tenant-edit) match the actual product navigation, nothing is missed, and gating is comprehensible.

One module per sidebar group (14, all toggleable) + two cross-cutting paid add-on flags (`ai`, `voip`).

## 2. Background / current state (verified against code)

- **Toggles** come from `MODULE_REGISTRY` (`src/lib/modules.ts`). The wizard (`/admin/tenants/new`) + tenant-edit build chips from it.
- **Materialization:** `Organization.features` (JSON) → `org.modules` (auth JWT callback, `auth.ts`) → `hasModule(org, id)`.
- **Two distinct gate axes (KEY nuance the v1 spec missed):**
  1. **Nav gating** (`nav-items.ts`): each item has `module: ModuleId`; `accessibleNavItems` filters by `hasModule`. Superadmin gets `showAll` (verified, `nav-items.ts:269`).
  2. **API gating** (`requireAuth(req, scope, action)` in **478** call sites; **409** pass an explicit scope arg): the 2nd arg is a **permission-scope name**, NOT a `ModuleId`. It's translated via `PERMISSION_MODULE_TO_MODULE_ID` (`permissions.ts`: only `kb→knowledge-base`, `inbox→omnichannel`, `energy-utilities→energy`, `offers→quotes`) then gated **only `if (gateModule in MODULE_REGISTRY)`** (`api-auth.ts:409-411`). **Consequence: any scope NOT in `MODULE_REGISTRY` is silently UNGATED at the module level today** (it still has role/permission checks, just no module gate).
- **Distinct requireAuth scopes today** (post-translation) and their gate status:
  - **Gated** (in registry): `contracts`(58), `tasks`(22), `public-sector`(22), `insurance`(22), `campaigns`(22), `health`(20), `media`(19), `energy`(19), `ai`(18), `omnichannel`(15), `core`(8), `tickets`(4), `deals`(4), `leads`(3), `events`(3), `reports`(1), `quotes`(1), `invoices`(1).
  - **UNGATED today** (NOT in registry → pass through): **`settings`(78)**, `loyalty`(17), `payments`(12), `commerce`(10), `subscriptions`(8), `nonprofit`(6), `finance`(5), `contacts`(4), `tpm`(3), `companies`(2), `account-engagement`(1), `data-cloud`(1).
- **Reclassification (v1 spec was wrong):** `settings`/`loyalty`/`payments`/`subscriptions`/`finance`/`contacts`/`companies` are **live route scopes**, merely module-ungated today — NOT "dead". Likely-dead/backend-only: `commerce`, `nonprofit`, `tpm`, `data-cloud` (no sidebar, confirm before removing).
- **Already 1:1 group==module:** `contracts`, `mtm`, `health`, `insurance`, `public-sector`, `media`, `energy`.
- **Registry ids with NO sidebar group / special:** `sms-otp` (alwaysOn), `portal`, `journeys`, `currencies`, `custom-fields`, `workflows` — must be explicitly assigned a group target (or kept) or the totality test (§6) fails. `ERP` is a dead `GROUP_LAUNCHER_STYLE` key (no nav items) — not a 15th group.

## 3. Target model (user-approved)

**14 group-modules — 1 per sidebar group (`NAV_GROUP_ORDER`), ALL toggleable:**

| # | id | Sidebar group | Folds in (current ids/items) |
|---|---|---|---|
| 1 | `crm` | CRM | core, deals, leads(list), tasks(boards), quotes, projects, products, notifications, **contacts/companies scopes** |
| 2 | `contracts` | Müqavilə Nəzarəti | contracts (1:1) |
| 3 | `marketing` | Marketinq | campaigns, **loyalty**, ai-scoring/journeys/sequences (was `leads`), **events** ⚠️ |
| 4 | `omnichannel` | Omni-Channel | omnichannel(inbox×4), ai/actions*, social-monitoring (was `campaigns`) |
| 5 | `support` | Dəstək | tickets(+complaints), voip*, knowledge-base |
| 6 | `finance` | Maliyyə | invoices, budgeting, profitability, pricing, **payments, subscriptions, `finance` scope** |
| 7 | `analytics` | Analitika | reports, forecast (was `deals`), ai-command-center* |
| 8 | `mtm` | Marşrut & Sahə | mtm (1:1) |
| 9–13 | `health`/`insurance`/`public-sector`/`media`/`energy` | Industry Clouds | 1:1 each |
| 14 | `settings` | Parametrlər | **`settings` scope (78 routes!)**, workflows, task-templates, quotas/territories, ai-automation*, pipelines, users, integrations, api-keys, macros, field-permissions |

⚠️ **`events`** is its own base-plan module today (`BASE_PLAN_MODULES`); folding into `marketing` is a real gating change for base/starter tenants — handled by the backfill (§5) granting `marketing` to anyone who had `events`.

**2 cross-cutting add-on flags** (`ai`, `voip`) — gate their specific items regardless of group (an item under group X also requires the flag). Modeled as a new `NavItem.addon?: "ai" | "voip"` field (decision: a dedicated field, NOT overloading `feature`, to keep "group membership" and "paid add-on" orthogonal).

**All 14 toggleable incl. `crm`/`settings`** — bounded by superadmin `showAll` (operator can always re-enable from `/admin`) + a soft non-blocking warning on uncheck.

## 4. Changes (work breakdown)

1. **`modules.ts`** — `MODULE_REGISTRY` = the 14 group-modules; `ai`/`voip` add-on flags. Decide `requires` deps (§10). Remap `ADDON_MODULES`/`PAID_ADDONS`/`SEPARATE_SUBSCRIPTIONS`.
2. **`nav-items.ts`** — re-tag every item's `module` to its group-module; add `addon: "ai"|"voip"` to AI/VoIP items.
3. **API gating — keep permission-scope names, change the MAP, not the routes.** Do NOT rename the 2nd `requireAuth` arg per route (those scope strings are also API-key scope strings in `permissions.ts MODULES` — renaming breaks issued API keys). Instead, **extend `PERMISSION_MODULE_TO_MODULE_ID`** so every live route scope maps to its group-module (e.g. `settings→settings`, `loyalty→marketing`, `payments→finance`, `subscriptions→finance`, `finance→finance`, `contacts→crm`, `companies→crm`, `campaigns→marketing`, `tasks→crm`, `deals→crm`, `leads→crm`, `events→marketing`, `reports→analytics`, `invoices→finance`, `quotes→crm`, `tickets→support`, `kb→support`, `omnichannel→omnichannel`, `inbox→omnichannel`, …). Remove gating for confirmed-dead scopes (`commerce`/`nonprofit`/`tpm`/`data-cloud`) or map if live.
   - **CRITICAL — the ungated→gated flip:** scopes currently absent from the registry (`settings`,`loyalty`,`payments`,`subscriptions`,`finance`,`contacts`,`companies`,…) are ungated today. Mapping them to a group-module that IS in the registry makes them **gated** → a tenant lacking that group gets 403 on those routes. Mitigated by §5's universal backfill (every tenant gets `crm`+`settings` at minimum; finance/marketing groups granted from prior nav-module access).
4. **`PlanTemplate` (DB)** — re-seed `starter`/`professional`/`enterprise` features/addons to group-module + add-on ids. Wizard/edit auto-render the 14 + ai/voip. Update `plan-catalog.ts` `FEATURE_CATALOG`/`ADDON_CATALOG`.

## 5. Backward compatibility — load-bearing, no tenant loses access

**Complete gate-scope universe — BOTH gate surfaces (architect v2 finding).** Effective scope = `requireAuth` arg `?? resolveModuleFromPath(pathname)` → `PERMISSION_MODULE_TO_MODULE_ID[x] ?? x` → gated only `if (… in MODULE_REGISTRY)`. So the universe = `keys(MODULE_REGISTRY)` ∪ `{explicit requireAuth args}` ∪ **`{every distinct ROUTE_MODULE_MAP value}`** ∪ `{navItems[].module}` — **43 distinct `ROUTE_MODULE_MAP` values** incl. the previously-unenumerated `segments`, `audit`, `pricing`, `users`, `inventory`, `commerce`, `data-cloud`, `education`, `financial-services`, `nonprofit`, `revenue-recognition`, `tpm`.

**Safe-by-default rule (prevents accidental flips):** every scope is EITHER (a) **mapped** to a group-module → becomes gated → MUST be backfill-covered; OR (b) in an explicit **`INTENTIONALLY_UNGATED`** allowlist → stays ungated (status quo, no flip). A scope in neither = CI failure (§6). **Identity case:** a scope whose name already equals a group-module id (or translates to one via `PERMISSION_MODULE_TO_MODULE_ID`) counts as (a) mapped — covers the 1:1 ids `contracts`/`mtm`/`health`/`insurance`/`public-sector`/`media`/`energy` (+ `energy-utilities→energy`). Adding a group-module that matches a previously-ungated scope is the only thing that flips access — so it only happens via (a), never silently.

- **Scope→group (live, in-nav):** `pricing/payments/subscriptions/invoices/budgeting/profitability/finance→finance`; `segments/loyalty/campaigns/events/journeys/account-engagement→marketing`; `audit/users/settings/currencies/custom-fields/workflows→settings`; `inventory→mtm`; `core/companies/contacts/deals/leads/tasks/quotes/projects→crm`; `reports→analytics`; `tickets/kb/portal→support`; `inbox→omnichannel`; `ai→ai`(addon); `voip→voip`(addon). **This list is illustrative, NOT the normative source.** The authoritative guarantee is the **§6 CI totality test**: the implementer derives the map programmatically over the full universe (`MODULE_REGISTRY` ∪ explicit `requireAuth` args ∪ all 43 `ROUTE_MODULE_MAP` values ∪ `navItems[].module`), and CI **fails** if ANY scope is unclassified (mapped / identity / `INTENTIONALLY_UNGATED`). So an id missing from this prose (e.g. `core`; `quotes` — the live ModuleId, reached both directly and via the `offers` permission-scope that translates to `quotes`) is caught by the test, not silently shipped. The totality test MUST apply `PERMISSION_MODULE_TO_MODULE_ID` BEFORE the membership check (else raw alias route-values `offers`/`kb`/`inbox`/`energy-utilities` read as false-unclassified), with a test-case per alias.
- **`INTENTIONALLY_UNGATED`** (nav-less backend verticals — stay ungated unless confirmed live in the plan): `commerce`, `data-cloud`, `education`, `financial-services`, `nonprofit`, `revenue-recognition`, `tpm`.
- **`hasModule` legacy-expansion (safety net):** same assignment map; `hasModule(org, group)` true if `org.modules[group]` OR any legacy id mapping to `group` is set → live tenants keep access with zero data change, no access-loss window.
- **Add-only backfill** (`scripts/backfill-group-modules.mjs`, idempotent, mirrors `backfill-base-modules.mjs`): per tenant add group-modules implied by current `features` via the map, PLUS **universal `crm`+`settings`** (were ungated → everyone had them), **`finance`** for invoices/budgeting/profitability/pricing tenants, **`marketing`** for campaigns/events. Preserve `ai`/`voip`/`whatsapp`/`complaints_register`.
3. **Ordering:** expansion layer ships WITH the registry change (no access-loss window before the backfill runs). Backfill then materializes ids for cleanliness.

## 6. Testing (acceptance gates)

- **Totality invariant (blocking):** assert every scope in the FULL universe — `keys(MODULE_REGISTRY)` ∪ `{explicit requireAuth args}` ∪ **`{every distinct ROUTE_MODULE_MAP value}`** ∪ `{navItems[].module}` (post-`PERMISSION_MODULE_TO_MODULE_ID`) — is EITHER mapped to a group-module OR in `INTENTIONALLY_UNGATED`. CI-fails on ANY unclassified scope → no silent access-loss AND no accidental flip. (Must enumerate `ROUTE_MODULE_MAP` values, not just explicit args — the v2 hole.)
- **Ungated-flip guard (blocking):** for every scope newly registry-gated post-change, assert the backfill grants its group-module to all tenants that currently reach it (universal for `crm`/`settings`; derived for `finance`/`marketing`/etc.).
- **Nav coverage:** every `navItems[].module` ∈ the 14 group-modules; AI/VoIP items carry `addon`.
- **`hasModule` legacy-expansion** unit tests (tenant `["campaigns"]` → `hasModule(org,"marketing")` true; `["invoices"]` → `finance` true; every tenant → `crm`,`settings` true post-backfill).
- **E2E (throwaway tenant):** provision with only `marketing`+`mtm` → exactly those sidebar groups + their API routes authorize; settings/CRM still work (universal); a legacy `["campaigns"]` tenant still sees Marketing.

## 7. Rollout / migration order

1. Ship code (new registry + total `LEGACY_MODULE_MAP` expansion in `hasModule` + extended `PERMISSION_MODULE_TO_MODULE_ID` + re-tagged nav + PlanTemplate re-seed). Expansion layer keeps live tenants working on deploy.
2. No schema change (features are JSON). `migrate deploy` harmless.
3. Run `scripts/backfill-group-modules.mjs` per server (incl. universal `crm`+`settings`). Idempotent, add-only.
4. Deploy to confirmed target(s) per `clients/registry.json` (deploy-ask-target).

## 8. Risks & confidence (decision-stress-test, Tier 0)

- **Contrarian:** the ungated→gated flip on `settings`(78)/`finance`/`loyalty`/`payments` is the real landmine — a missed mapping or a tenant missing `settings` = mass 403. → Mitigated by the **totality + ungated-flip tests as blocking invariants** + universal `crm`/`settings` backfill + expansion safety net.
- **First-principles:** module == the unit users perceive (sidebar group); align the gate axis to the nav axis.
- **Reality:** 409 route scopes + full-tenant feature migration. Expansion-layer + add-only backfill = non-destructive, reversible (revert registry → legacy scopes ungate again).
- **Confidence: Medium-Low** until the §6 totality test exists — the correctness rests entirely on the map being total. Strongly favor subagent-driven implementation guarded by the totality test, and a **Codex second opinion on `LEGACY_MODULE_MAP` + `PERMISSION_MODULE_TO_MODULE_ID` completeness** before deploy.

## 9. Decisions locked

- 1 module = 1 sidebar group (14), all toggleable. ✅
- `ai`, `voip` = add-on flags via new `NavItem.addon` field. ✅
- API gating: **map-only** (extend `PERMISSION_MODULE_TO_MODULE_ID`), do NOT rename route scope strings (preserves API-key scopes). ✅
- Backward-compat: total `LEGACY_MODULE_MAP` expansion + add-only backfill incl. universal `crm`+`settings`. ✅
- Implementation = separate cycle (writing-plans → subagent-driven).

## 10. Open items for the implementation plan

- `requires` deps per group-module + cascade semantics if `marketing`/`analytics`/`finance` `requires: ["crm"]` (interacts with all-toggleable).
- Confirm `commerce`/`nonprofit`/`tpm`/`data-cloud` are dead (grep their routes) → remove gating vs map.
- Group targets for registry ids `portal`, `journeys`, `currencies`, `custom-fields`, `workflows` (proposal: journeys→marketing, currencies/custom-fields/portal/workflows→settings or crm — decide).
- i18n: reuse existing sidebar group translation keys for the 14 chip labels so wizard == menu.
- Soft-warning copy when `crm`/`settings` unchecked in wizard/edit.

## 11. Architect review — findings incorporated (v1→v2)

- Route count `~273`→ **478 total / 409 with scope arg** (§2).
- Added the **`PERMISSION_MODULE_TO_MODULE_ID` translation + `in MODULE_REGISTRY` ungated-if-absent** semantics (§2) and the **map-only re-gate** strategy preserving API-key scopes (§4.3).
- **`LEGACY_MODULE_MAP` made total + a test invariant** (§5/§6) — v1's hand-picked subset leaked.
- **Reclassified `settings`/`loyalty`/`payments`/`subscriptions`/`finance` as live** (not dead); flagged the **ungated→gated flip** + universal `crm`/`settings` backfill (§2/§3/§5).
- Flagged **`events`** regating for base tenants; added **`portal`/`journeys`/`currencies`/`custom-fields`/`workflows`/`sms-otp`** to map; noted **`ERP`** dead launcher key (§2/§10).
- Confidence lowered to **Medium-Low** pending the totality test (§8).

**v2→v3 (architect delta review):**
- **Totality set now covers BOTH gate surfaces** — added `resolveModuleFromPath`/`ROUTE_MODULE_MAP` (43 values); v2 only counted explicit `requireAuth` args, so `segments`/`audit`/`pricing`/`users`/`inventory` + the nav-less verticals were unenumerated (§5/§6).
- Added the **safe-by-default map-or-`INTENTIONALLY_UNGATED` rule** so no scope flips silently; CI-fails on any unclassified scope.
- **Slotted the live unassigned scopes:** `pricing→finance` (flip now backfill-covered), `segments→marketing`, `audit→settings`, `users→settings`, `inventory→mtm`.
- Listed nav-less verticals (`commerce/data-cloud/education/financial-services/nonprofit/revenue-recognition/tpm`) as `INTENTIONALLY_UNGATED` pending plan-phase grep-confirm.
