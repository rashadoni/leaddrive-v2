# Tenant Capabilities + Marketplace Rollout Plan

## Goal

Make tenant module access, marketplace status, navigation, API gating, AI tools,
and industry add-ons read from one consistent capability model.

The marketplace must not duplicate the CRM or physically delete product code. It
should show what is included, enabled, hidden, demo-only, paid, requested, or
needs setup for the current tenant.

## Current Audit Findings

- Runtime module access is mainly controlled by `Organization.features`, which
  is materialized into `session.user.modules` and checked by `hasModule`.
- `Organization.addons` can also grant group modules through `ADDON_MODULES`.
- Navigation already derives visibility through `accessibleNavItems` and
  `hasModule`.
- API routes are gated through middleware and `requireAuth`, but some mobile or
  custom auth paths can bypass session-based middleware and must keep explicit
  module checks.
- Marketplace currently reads global `apps` rows plus tenant
  `AppInstallation` rows. Install records are persisted, but install actions are
  still not executed.
- Mars seed enables MTM with legacy feature keys (`core`, `deals`, `leads`,
  `reports`, `knowledge-base`, etc.) plus `mtm`. This relies on legacy expansion
  inside `hasModule`, so future tenant setup should prefer group keys (`crm`,
  `sales`, `analytics`, `support`, `settings`, `mtm`).

## Target Model

```text
Global capability catalog
  Native modules, add-ons, templates, connectors, industry modules

Tenant entitlements
  What the tenant is allowed to activate by plan, add-on, or contract

Tenant settings
  Enabled/hidden/demo/requested/setup state for this tenant

User role + permissions
  Who can open, configure, request, hide, or disable

Runtime surfaces
  Navigation, marketplace, API, AI tools, mobile, background jobs
```

## Capability Statuses

- `included`: native capability is part of the tenant's active CRM package.
- `enabled`: paid/add-on/template/connector is active.
- `hidden`: enabled but hidden from tenant navigation.
- `demo`: user may inspect value without enabling live behavior.
- `requested`: tenant requested access, awaiting LeadDrive/admin action.
- `requires_plan`: not available under the current plan/contract.
- `setup_required`: enabled but missing credentials/configuration.
- `disabled`: intentionally off; data remains preserved.

## Default Packaging

### Default / included CRM core

- CRM core: companies, contacts, products, boards, notifications, projects.
- Sales core: leads, deals, quotes, sequences, forecast, sales setup.
- Settings core: users, roles, security, audit, API keys, integrations.
- Basic dashboard/reporting where enabled by tenant package.
- Minimal AI audit logging when AI is used.

### Paid or contract-controlled add-ons

- Da Vinci AI advanced automation and recommendations.
- AI security monitoring, DLP/redaction, retention, SIEM export.
- WhatsApp Business API and advanced omnichannel routing.
- ERP/1C/SAP sync.
- Route & Field / MTM for field teams.
- Equipment and distributor packs.
- Industry clouds: health, insurance, public sector, media, energy.
- Finance/budgeting/profitability when sold separately.
- SSO/SAML/IP allowlist and advanced compliance features.

## Safe Enable / Disable Rules

- Never physically remove code or delete tenant business data from marketplace.
- Core modules should support hide/show, not destructive uninstall.
- Paid modules should soft-disable: hide UI, block new API actions, stop jobs,
  preserve historical data and audit.
- Integrations should disable outbound jobs/webhooks and keep credentials
  revocable.
- AI tools should not see disabled modules in their tool catalog.
- Mobile routes must use explicit tenant capability checks, not only browser
  middleware.

## Rollout Tasks

1. Audit all tenant access sources.
   - `Organization.features`
   - `Organization.addons`
   - `Organization.modules`
   - plan templates
   - marketplace apps/installations
   - navigation
   - API middleware and route-level guards
   - AI tool catalogs
   - mobile / MTM routes

2. Normalize capability vocabulary.
   - Prefer group keys for modules: `crm`, `sales`, `settings`, `mtm`, etc.
   - Keep legacy expansion only for old tenants and seeds.
   - Add tests for Mars-like legacy feature records.

3. Add a pure capability resolver.
   - Input: tenant plan, addons, modules, install rows, hidden/requested state.
   - Output: status, reason, owner module, allowed UI actions, safe disable mode.

4. Wire marketplace read model.
   - Show `Included`, `Enabled`, `Hidden`, `Demo`, `Requires plan`,
     `Requested`, `Setup required`.
   - Replace ordinary "Install" with "View demo" or "Request access" unless
     the tenant admin is allowed to activate the item.

5. Wire tenant admin controls.
   - Admin can enable/hide only entitlements already granted to the tenant.
   - LeadDrive superadmin grants paid/enterprise entitlements.

6. Wire navigation.
   - Keep `accessibleNavItems` as the module gate.
   - Add visibility override only after capability resolver tests are stable.

7. Wire API and AI.
   - API must block disabled modules even if a route is manually opened.
   - AI tool catalogs must filter by the same capability status.

8. Add install executor later.
   - Create custom fields, event subscriptions, webhook subscriptions, and
     settings in a transaction.
   - Record created resources for rollback/disable.
   - Store secrets in named credentials or encrypted storage, not app config.

9. Backfill and verify production tenants.
   - Audit Mars first.
   - Backfill legacy features to group keys where safe.
   - Verify menu, API, AI, and mobile behavior for Mars plus one regular tenant.

## First Development Slice

This slice intentionally avoids schema changes and live UI mutations.

- Add `src/lib/tenant-capabilities.ts`.
- Add tests for included modules, MTM/Mars legacy records, marketplace
  installation states, and role-based actions.
- Keep existing `hasModule` semantics as the source of truth for module access.
- Use the resolver as a read model before wiring admin/marketplace writes.

## Second Development Slice

This slice keeps the same no-migration boundary, but adds safe write paths.

- Normalize marketplace capability reads from both `Organization.features` and
  `Organization.modules`, so tenants like Mars do not look disabled when legacy
  feature records are still present.
- Add `/api/v1/settings/capabilities`:
  - `GET` returns resolved tenant capability states.
  - `PATCH` supports only `request_access`, `hide`, and `show`.
  - It never changes `plan`, `addons`, `features`, or `modules`.
- Block direct `POST /api/v1/apps/[id]/install` for capability-managed apps.
  Customers must request access instead of self-installing paid/demo modules.
- Wire marketplace request/hide/show buttons to the safe settings endpoint.
- Add `scripts/audit-tenant-capabilities.mjs` for read-only tenant diagnostics:
  `node scripts/audit-tenant-capabilities.mjs --slug=mars --json`.

## Remaining Implementation Tasks

- Extend explicit runtime guards to every future paid capability, background
  job, webhook, and connector.
- Turn static capability demo pages into richer, data-backed guided demos where
  the product needs stronger sales proof.
- Add install executors and rollback records for template/connector apps.
- Run the audit script against Mars and one normal tenant, then backfill only
  the confirmed legacy-module gaps.

## Third Development Slice

This slice adds the LeadDrive-side approval path without enabling customer
self-install.

- Add `/api/v1/admin/tenants/[id]/capabilities` for superadmins:
  - `GET` shows the tenant's resolved capability states.
  - `PATCH { action: "approve" }` grants only entitlement-backed capabilities
    by updating `Organization.features` and `Organization.modules`.
  - `PATCH { action: "reject_request" }` clears the request flag without
    changing entitlements.
- Approval refuses connector/template apps that only have `appSlug` until the
  install executor and rollback records exist.
- Extend the audit helper:
  - `node scripts/audit-tenant-capabilities.mjs --find=mars`
  - `node scripts/audit-tenant-capabilities.mjs --slug=<tenant> --json`

## Fourth Development Slice

This slice makes the workflow usable for superadmins and adds the first
runtime enforcement pass.

- Add a tenant-detail capability panel under `/admin/tenants/[id]`:
  - requested capabilities can be approved or rejected by superadmins;
  - enabled/included capabilities are visible with status and reason;
  - app-only capabilities remain blocked until install executors exist.
- Add `/marketplace/demo/[id]` so customers can inspect value without live
  activation.
- Wire marketplace `View demo` separately from `Request access`.
- Filter AI write/read tools by tenant modules after wildcard or agent defaults
  are resolved, so disabled Sales/Support/Finance tools are not exposed to the
  model.
