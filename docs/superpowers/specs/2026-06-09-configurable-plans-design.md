# Configurable Plans + Wizard Scaffolding Customization — Design Spec

- **Date:** 2026-06-09
- **Status:** Draft v2 (Codex-reviewed; awaiting user review → implementation plan)
- **Author:** Developer (Claude) + User (Rashad)
- **Reviewers:** Codex (GPT) architecture review — findings incorporated (see §13)

## 1. Goal

Two related capabilities for superadmins:

1. **Configurable plans (Phase 1):** Make tenant tier-plans (currently the hardcoded
   `TENANT_PLANS` const: `starter`/`professional`/`enterprise`) **editable and
   extensible from the superadmin UI** — including adding brand-new tariffs (e.g.
   `pharma`) — instead of requiring a code edit + redeploy.
2. **Wizard scaffolding customization (Phase 2):** Let the operator **customize the
   seeded scaffolding** (pipeline stages, task types, event types, currencies) directly
   in the tenant-creation wizard, instead of only applying fixed `DEFAULT_*` constants.

Both ship together; plans are tested first.

## 2. Background / current state (verified by audit)

- **Plans are provisioning templates, NOT the (only) runtime gate.** `modules.ts:156-162`
  says the authoritative access gate is `Organization.features` → `org.modules`. BUT the
  audit found the runtime picture is messier than that comment implies (see §2.1).
- **Active provisioning template** = `TENANT_PLANS` (`src/lib/tenant-plans.ts`);
  `getPlanDefaults(plan)` → `{maxUsers, maxContacts, features[], addons[]}`; sole caller is
  `provisionTenant()` (`src/lib/tenant-provisioning.ts:68`).
- **Pre-existing plan-concept overlap (do NOT add a 4th concept):**
  - `TENANT_PLANS` (tenant-plans.ts) — active provisioning template. **← move to DB.**
  - `LEGACY_PLANS` / `PLANS` (modules.ts:51-85) — `@deprecated`. Leave, but see §2.1.
  - `USER_TIERS` / `TIER_ORDER` (modules.ts), `PLAN_TIERS` (plan-config.ts) — pricing/tier model. Out of scope.
  - `SubscriptionPlan` (schema.prisma:6841) — org-scoped **billing**. Different concept. Leave as-is.
- **Feature catalog** = `MODULE_REGISTRY` (modules.ts:16-48) — but `TENANT_PLANS.features` also
  contains NON-module flags (`whatsapp`, `complaints_register`) not in `MODULE_REGISTRY` (see §2.2).
- **The 5 scaffolding entities are already fully manageable in-tenant** post-provisioning
  (CRUD API + settings UI). Phase 2 adds only *create-time* customization.

### 2.1 Plan-name coupling blast radius (MUST audit — Codex P5/P8 + extra)

Introducing arbitrary plan keys will hit code that looks up behavior **by plan name**.
All of these must be audited and made to rely on **materialized `Organization` fields**
(`features`/`addons`/`maxUsers`/`maxContacts`), not plan-name lookups, OR explicitly
handle unknown keys safely:

| File | Coupling | Risk with a custom plan |
|---|---|---|
| `src/app/api/v1/admin/tenants/route.ts:91` | `validPlans = ["starter","professional","enterprise"]` → 400 | **API rejects new tariffs outright.** Must validate against active `PlanTemplate`. |
| `src/lib/plan-limits.ts:11` | `PLANS[plan]?.limits; if (!planLimits) return 0` | **Unknown plan → 0 user/contact limit → blocks all creation.** Must read `Organization.maxUsers/maxContacts`. |
| `src/lib/plan-config.ts:137,191` | `canAccessModule(plan,…)`, `isSidebarItemAccessible(plan,…)` | Sidebar/module access keyed off plan name → custom plan may lose nav. Must key off `features`/`addons`. |
| `src/lib/tenant-provisioning.ts:146` | `plan === "enterprise"` seeds MTM agent | Custom plan with `addons:["mtm"]` gets MTM access but no agent (Codex P4). Key off effective modules. |
| `src/app/admin/tenants/new/page.tsx:46,85,89` | wizard inits `form.features` from `TENANT_PLANS.starter`; `handlePlanChange` does `TENANT_PLANS[plan as TenantPlan]` | custom key → `undefined`, defaults silently don't load. Migrate to the DB plan list (§9b); drop the `as TenantPlan` cast. (Architect) |
| `src/app/api/v1/admin/tenants/route.ts:126` | `PLAN_LABELS[organization.plan as TenantPlan]` (welcome email) | custom key absent from `PLAN_LABELS` → falls through to raw slug. Resolve via `PlanTemplate.name`. (Architect) |
| `src/lib/nav-items.ts`, `entitlement-process/types.ts`, `account-engagement/types.ts`, `marketing-data.ts`, `ai/route.ts`, `plan-requests/route.ts` | literal plan-name branches | audit each; default-safe for unknown keys. |

**Guiding principle:** a custom plan is just a *named bundle of `features`/`addons`/limits*
that gets materialized onto `Organization` at provisioning. No runtime code may assume the
plan name is one of the three legacy values.

### 2.2 Catalog reconciliation (prerequisite — Codex P1)

`TENANT_PLANS` uses keys that the naive validation (`⊆ MODULE_REGISTRY` / addon catalog)
would **reject**, so the seed of existing plans would fail. Before building the editor/validation:
- **FEATURE_CATALOG** = `MODULE_REGISTRY` keys **∪** the extra feature flags actually used
  (`whatsapp`, `complaints_register`, …). Enumerate them from `TENANT_PLANS` + any `features`
  checks in code. The plan editor toggles + validates against THIS catalog.
- **ADDON_CATALOG** = union of `ADDON_MODULES` ∪ `PAID_ADDONS` ∪ `SEPARATE_SUBSCRIPTIONS` keys
  **∪** `voip` (used as an addon in `TENANT_PLANS.enterprise` but absent from those maps).
- Define both as single exported constants; existing seed data must pass validation against them.
- **Enumerate-and-freeze (Architect):** add a unit test asserting every `TENANT_PLANS.*.features`/`addons` value ∈ the catalog, so future drift fails CI rather than at seed time.

## 3. Scope

**In scope:** Phase 1 (PlanTemplate model + superadmin CRUD UI/API + DB-backed
`getPlanDefaults` + DB-driven plan validation + wizard reads DB + migration/seed +
catalog reconciliation + plan-name-coupling audit/fixes); Phase 2 (optional custom
scaffolding in `provisionTenant` + wizard editors).

**Non-goals:** touching the access semantics of `hasModule`/`Organization.features` (we make
*callers* safe, we don't change the gate's meaning); `LEGACY_PLANS`/`USER_TIERS`/`SubscriptionPlan`;
price/billing on plans (B2B, no public pricing); auto retro-apply of plan edits (see §8);
new CRUD for the 5 entities (already exists).

## 4. Approach (Variant A — chosen)

Global `PlanTemplate` table + superadmin CRUD; runtime reads from DB with a **bounded**
fallback (§7). `PlanTemplate` replaces the role of `TENANT_PLANS` (retained as seed source +
legacy-only fallback). Rejected: (B) JSON-blob config (fragile, off-convention);
(C) reuse `SubscriptionPlan`/`LEGACY_PLANS` (semantic mismatch, worsens tangle).

## 5. Data model

```prisma
model PlanTemplate {
  id          String   @id @default(cuid())
  key         String   @unique            // slug; immutable after create; stored in Organization.plan
  name        String
  description String?
  features    String[] @default([])        // validated against FEATURE_CATALOG (§2.2)
  addons      String[] @default([])        // validated against ADDON_CATALOG (§2.2)
  maxUsers    Int      @default(3)         // -1 = unlimited
  maxContacts Int      @default(500)       // -1 = unlimited
  isActive    Boolean  @default(true)
  sortOrder   Int      @default(0)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@index([isActive, sortOrder])           // Codex S1
  @@map("plan_templates")
}
```

`Organization.plan` stays a `String` (no FK) to preserve snapshot semantics and avoid a
breaking migration — **but** add `@@index([plan])` on `Organization` (additive) for the
in-use / delete-guard query (Codex S1/P7).

## 6. API (`/api/v1/admin/plans`) + provisioning API change

All gated by `requireSuperAdmin`; every mutation audit-logged (`logAudit`).
- `GET` — list (active + inactive); wizard filters to active.
- `POST` — create; validate `key` slug+unique, `features ⊆ FEATURE_CATALOG`, `addons ⊆ ADDON_CATALOG`, limits int ≥ -1.
- `PATCH /[id]` — update all but `key`.
- `DELETE /[id]` — **atomic guard** (Codex P7): inside a transaction, re-check `Organization` where `plan == key`; if any → 409 (suggest deactivate); else delete. Prefer deactivation (`isActive=false`) as the default operator action.
- **`POST /api/v1/admin/tenants` change (Codex P3/P5):** replace the hardcoded `validPlans`
  array with a lookup that the submitted plan exists AND `isActive` in `PlanTemplate`; reject otherwise.

## 7. Provisioning changes

### 7a. `getPlanDefaults` → async, DB-backed, **bounded** fallback (Codex P2/P3)
```
async getPlanDefaults(key):
  1. row = PlanTemplate where key AND isActive
  2. if row → return {maxUsers,maxContacts,features,addons}
  3. else if key ∈ {starter,professional,enterprise} → TENANT_PLANS[key]  // legacy/rollout safety only
  4. else → THROW `Unknown or inactive plan "<key>"`                       // do NOT silently default to starter
```
Becomes `async`; sole caller is `provisionTenant` (already async) — verified, zero client callers.

### 7b. MTM agent seeding off effective modules, not plan name (Codex P4)
Replace `features.includes("mtm") || input.plan === "enterprise"` with: expand `addons` →
modules via `ADDON_MODULES`, union with `features`, and seed the MTM agent iff the effective
module set includes `mtm`.

### 7c. `provisionTenant` optional custom scaffolding (Phase 2)
Extend `TenantInput` with optional `pipelineStages?`/`taskTypes?`/`eventTypes?`/`currencies?`;
use provided arrays if present, else current `DEFAULT_*`/inline. Fully backward-compatible.

## 8. Semantics & decisions

- **Snapshot, not retro-apply (user-approved):** editing a `PlanTemplate` affects only FUTURE
  provisioning; existing tenants keep materialized `Organization` values. The `/admin/plans`
  UI must state this explicitly (Codex P6). Optional manual propagation later via the existing
  `scripts/backfill-plan-features.mjs` pattern — out of scope.
- **Delete guard:** atomic; in-use plans deactivate, not delete.
- **Bounded fallback:** only legacy keys fall back; unknown/inactive hard-fail.

## 9. UI

### 9a. `/admin/plans` (new superadmin page)
List (name, key, #features, limits, active badge, sortOrder) + "Add plan". Editor: name,
key (create-only), description, feature toggles from **FEATURE_CATALOG**, addon toggles from
**ADDON_CATALOG**, maxUsers/maxContacts (with "unlimited" = -1 affordance), isActive, sortOrder.
A note: "changes apply to newly-provisioned tenants only." Follow existing admin/settings conventions; add to admin nav.

### 9b. New-tenant wizard
- Plan dropdown + defaults from `GET /api/v1/admin/plans` (active) instead of `TENANT_PLANS`.
- Phase 2: editable collapsible sections (stages/task types/event types/currencies) pre-filled
  with `DEFAULT_*`; reuse `ConfigTypeSection`-style row editors; pass arrays to provisioning API.

## 10. Migration + rollout

1. Migration: create `plan_templates`; add `@@index([plan])` on `organizations`.
2. **Idempotent + non-destructive seed (Codex S5):** upsert the 3 legacy plans **only if the
   key is absent** — never overwrite an operator-edited prod template on redeploy.
3. Deploy: on EACH box (shared + every per-client server), run `prisma migrate deploy` **first**, then the idempotent seed — the seed depends on `plan_templates` existing, so never run it before the migration (avoids a "table-missing" race on a slow per-client deploy). Seed is idempotent per-server.
4. Backward compatible — empty table → legacy fallback for the 3 known keys.

## 11. Testing

- **Unit:** `getPlanDefaults` (DB hit / legacy fallback / **unknown-key throws**); plan CRUD
  (auth, slug/feature/addon validation, atomic delete-in-use guard); tenants-API plan validation
  against active `PlanTemplate`; MTM seeding for an `addons:["mtm"]` plan; `provisionTenant` with
  and without custom scaffolding; `plan-limits`/`plan-config` behavior for a custom plan
  (must NOT zero-out limits or drop nav).
- **Manual E2E (throwaway tenant — NOT zeytunpharm, or local):** create `pharma` tariff in
  `/admin/plans` → appears in wizard → provision a test tenant on it → verify
  `Organization.features/addons/maxUsers/maxContacts` match → login shows correct nav, no zero-limit
  block → custom stages/currencies landed → delete-guard + deactivate behave.

## 12. Risks & confidence (decision-stress-test, Tier 0)

- **Contrarian:** 4th plan concept / hidden plan-name coupling → mitigated: `PlanTemplate`
  replaces `TENANT_PLANS`; §2.1 audit neutralizes plan-name lookups.
- **First-principles:** plan = named bundle materialized onto Organization; runtime keys off materialized fields.
- **Reality:** prod schema migration + critical provisioning path → additive, bounded fallback, audit consumers, test on throwaway tenant, `migrate deploy` on deploy.
- **Confidence: Medium** (was Medium-High pre-Codex; lowered because §2.1 coupling makes the
  real scope larger than the headline feature). Reversible/additive. Codex review incorporated.

## 13. Codex review — findings incorporated

Verbatim review archived in the session. Verified + folded in:
- **P1** catalog mismatch → §2.2 FEATURE_CATALOG/ADDON_CATALOG reconciliation (prerequisite).
- **P2** broad fallback → §7a bounded fallback (legacy keys only).
- **P3** inactive+fallback → §6 tenants-API validates against active `PlanTemplate`.
- **P4** MTM keyed off plan name → §7b effective-modules.
- **P5** API hardcodes 3 plans → §6 DB-driven validation (verified `route.ts:91`).
- **P6** snapshot ambiguity → §9a UI copy.
- **P7** delete-guard race → §6 atomic transactional guard + `@@index([plan])`.
- **P8** plan-limits zero trap → §2.1 audit; read materialized limits (verified `plan-limits.ts:11`).
- **Extra (Claude):** `plan-config.ts` `canAccessModule`/`isSidebarItemAccessible` also key off plan name → §2.1.
- **Suggestions** S1 (indexes), S5 (non-destructive seed), Phase-2 validation (S7) folded into §5/§10/§11.

**Codex verdict:** "directionally sound, but needs changes before implementation, mainly around
fallback semantics, catalog validation, MTM behavior, and removing remaining hardcoded plan
assumptions." → All addressed in v2 above.
