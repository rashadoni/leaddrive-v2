# Notification Preferences + Role-Gated Delivery — Design Spec (2026-06-06)

## Goal
Per-user control over which notifications produce **active popups** (browser push + in-app toast),
organized by the app's own **13 module sections**, with a hard **access gate**: a user who cannot
access a section (by role **and** org-feature) receives **no notification** from it (not even in the
list) and sees its toggle **disabled**.

## Decisions (locked with user, 2026-06-06)
1. **Granularity:** categories (= nav sections) **+ expand** to individual event types.
2. **Scope:** both the preferences system **and** coverage expansion — phased, foundation first.
3. **Preference gate:** gates only the **active popups** (browser push + in-app toast). The persistent
   in-app list stays complete **for accessible sections**.
4. **Access gate:** **role-matrix AND org-feature** (stricter than the launcher, which filters by
   feature only). No access → **no notification at all** (filtered from the list) + **disabled toggle**.

## Foundation (reused, not reinvented)
- **Module registry (source of truth):** `src/lib/nav-items.ts` → `navItems[]` (shape
  `{ module, href, icon, tKey, group, feature? }`) + `NAV_GROUP_ORDER` (the 13 sections, in order).
- **Org-feature gate:** `hasModule(org, moduleId)` — `src/lib/modules.ts`.
- **Role matrix:** `ROLE_PERMISSIONS[role][module] → Action[]` — `src/lib/permissions.ts`
  (roles: superadmin/admin/manager/sales/support/viewer; `"*"` wildcard exists).
- **Prefs storage:** `UserPreference.data` JSON column — **no migration**.
- **Settings hub:** `src/app/(dashboard)/settings/page.tsx` → new `/settings/notifications`.

## Architecture

### Taxonomy + mapping — `src/lib/notifications/taxonomy.ts`
- `ENTITY_TO_MODULE: Record<string, ModuleId>` — `task→tasks`, `deal→deals`, `lead→leads`,
  `contact→contacts`, `company→companies`, `ticket→tickets`, `contract→contracts`,
  `campaign→campaigns`, `invoice→invoices`, … (extended in Phase 2).
- `moduleToSection(moduleId)` — group lookup in `navItems`.
- `deriveSection(entityType)` = `moduleToSection(ENTITY_TO_MODULE[entityType])`; unknown → `null`.
- `NOTIFICATION_TYPES` — per-section list of concrete current event types (drives the expand UI):
  CRM: `task.created`, `task.completed`, `deal.won`, `deal.lost`, `deal.stage`, `lead.created`,
  `lead.converted`, `contact.created`, `company.created`; Support: `ticket.created`,
  `ticket.comment`; Marketing: `campaign.sent`. (Phase 2 appends.)

### Access predicate — `src/lib/notifications/access.ts`
- `roleCanRead(role, moduleId)` = `perms["*"]?.includes("read") || perms[moduleId]?.includes("read")`
  (superadmin/admin always true; module absent from matrix → fall back to feature-only).
- `canNotifySection(ctx: {role, modules}, section)` = ∃ module in `section` such that
  `hasModule(ctx, module) && roleCanRead(role, module)`.
- `accessibleSections(ctx)` — the set of sections the user may be notified about.

### Preference gate — `src/lib/notifications/prefs.ts`
- `NotificationPrefs = { [section]: { push: boolean; types?: Record<string, boolean> } }`.
- `shouldPush(prefs, section, type)` = `(prefs[section]?.push ?? DEFAULT_FOR[section]) &&
  (prefs[section]?.types?.[type] ?? true)`.
- `DEFAULT_PREFS` — push on for important sections (CRM, Support), off elsewhere (tunable).

### Delivery gates
- **Read gate** (`GET /api/v1/notifications`): drop notifications whose `deriveSection(entityType)`
  ∉ `accessibleSections(session)`. Session already carries `role` + `modules` (no extra query).
- **Push gate** (`createNotification` push block → helper
  `resolvePushDecision(orgId, recipientUserId, entityType, type)`): fetch recipient role + org
  modules + prefs; push only if `canNotifySection(recipient) && shouldPush(prefs)`. Best-effort.
- **Toast gate** (`notification-bell.tsx`): fetch prefs; toast only pref-enabled (list already
  read-gated, so inaccessible never reaches the bell).

### API — `/api/v1/users/me/notification-preferences`
- **GET** → `{ sections: [{ key, accessible, push, types: [{ key, enabled }] }] }`; `accessible`
  computed from the session → UI disables where false.
- **PUT** → validate toggle keys ∈ accessible sections (reject writes to inaccessible sections);
  persist to `UserPreference.data.notificationPreferences`.

### Settings UI — `/settings/notifications`
- One row per section (NAV_GROUP_ORDER, only sections that emit notifications): localized label +
  short description + a **push Switch**; **disabled + greyed + tooltip** "no access to this section"
  when `!accessible`; expand chevron → per-type switches.
- A "Notifications" card on the settings hub linking here. i18n en/ru/az.

## Phase 1 — Foundation (current events)
- **T1 (lib, TDD):** taxonomy + access + prefs helpers + unit tests (write tests first).
- **T2 (backend):** prefs GET/PUT API + read-gate + `resolvePushDecision` wired into
  `createNotification`.
- **T3 (frontend):** `/settings/notifications` UI + settings card + bell toast-gate + i18n.

## Phase 2 — Coverage expansion (after Phase 1 verified)
Add `createNotification(+push, gated)` to the gap modules — Finance (invoice paid / payment failed /
dunning), CPQ (quote sent/accepted/rejected), Orders, Surveys, Loyalty, Communications,
Support-extras (complaints / SLA / calls), and the 5 industry clouds (Health/Insurance/Public
Sector/Media/Energy). Each new event maps to a section → auto-covered by the gates from Phase 1.

## Verification
- Unit tests (TDD) on taxonomy/access/prefs.
- Live prod test: a low-access role sees **disabled** toggles + **no** notifications from inaccessible
  sections; toggling an accessible section's push off → no push.
- **Codex code review at the end** (user-requested).

## Out of scope (this iteration)
- Quiet hours / digest batching.
- Per-individual-notification (vs per-type) granularity.
