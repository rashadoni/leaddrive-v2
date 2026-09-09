export const GROUP_MODULE_IDS = [
  "crm", "sales", "contracts", "marketing", "loyalty", "omnichannel", "social",
  "voip", "support", "finance",
  "analytics", "mtm", "health", "insurance", "public-sector", "media",
  "energy", "settings",
] as const
export type GroupModuleId = (typeof GROUP_MODULE_IDS)[number]

/**
 * Group ids that did NOT exist in the LEGACY features vocabulary — their
 * presence in `org.modules` (as ANY boolean: `true` from features/backfill,
 * `false` only ever from reconcileModulesWithFeatures) proves the record was
 * written by the NEW catalog (backfill, admin chips, or reconcile), flipping
 * `hasModule` step 3b expansion OFF.
 * Ambiguous identity ids (contracts/loyalty/omnichannel/voip/mtm/health/insurance/
 * public-sector/media/energy existed as legacy module ids) are deliberately
 * excluded — see step 3b.
 *
 * `sales` and `social` are INTENTIONALLY EXCLUDED even though both are brand-new
 * ids: both get written into otherwise-legacy records — `sales` by
 * backfill-sales-module.mjs (or an admin toggling Sales on for a
 * not-yet-materialised tenant), `social` by the split backfill migration
 * 20260801090000_social_module_split, which appends it to EVERY record carrying
 * `omnichannel`. If either were a marker, writing it into e.g. `["core"]` →
 * `["core","sales"]` would flip expansion OFF and strand `core→crm` (and any
 * other legacy id) → the tenant silently loses CRM/marketing/etc. Keeping them
 * out of the marker set means such a record stays in expansion mode (legacy ids
 * still resolve) while the new id is granted explicitly by step 2. Materialised
 * records already carry `crm`, which IS a marker, so their toggles stay
 * authoritative regardless.
 */
export const NEW_VOCAB_GROUP_IDS = [
  "crm", "marketing", "support", "finance", "analytics", "settings",
] as const

export const ADDON_FLAG_IDS = ["ai", "voip"] as const
export type AddonFlagId = (typeof ADDON_FLAG_IDS)[number]

export type ModuleId = GroupModuleId | AddonFlagId | "sms-otp"

interface ModuleDefinition {
  name: string
  requires: ModuleId[]
  alwaysOn?: boolean
}

export const MODULE_REGISTRY: Record<ModuleId, ModuleDefinition> = {
  /* ── group-modules (mirror the sidebar groups 1:1) ── */
  // This is the shared customer base used by Support: companies, contacts and
  // client records. "Основная" makes that relationship clear in the tenant
  // picker without changing the stable `crm` entitlement key.
  crm:              { name: "Основная",            requires: [] },
  sales:            { name: "Sales",               requires: [] },
  contracts:        { name: "Contracts Control",   requires: [] },
  marketing:        { name: "Marketing",           requires: [] },
  loyalty:          { name: "Loyalty Program",     requires: [] },
  omnichannel:      { name: "Omni-Channel",        requires: [] },
  // Social Monitoring — own group-module since 2026-08-01. It used to ride on
  // `omnichannel`, which made the two sidebar groups share ONE admin toggle:
  // turning Communication off also killed Social Monitoring (and vice versa).
  social:           { name: "Social Monitoring",    requires: [] },
  // VoIP owns its post-call analytics group. The same id remains a paid
  // add-on flag so telephony surfaces can also be layered into other groups.
  voip:             { name: "VoIP / Telephony",     requires: [] },
  support:          { name: "Support",             requires: ["crm"] },
  finance:          { name: "Finance",             requires: [] },
  analytics:        { name: "Analytics",           requires: [] },
  mtm:              { name: "Route & Field (MTM)", requires: [] },
  health:           { name: "Health Cloud",        requires: [] },
  insurance:        { name: "Insurance Cloud",     requires: [] },
  "public-sector":  { name: "Public Sector Cloud", requires: [] },
  media:            { name: "Media Cloud",         requires: [] },
  energy:           { name: "Energy & Utilities",  requires: [] },
  settings:         { name: "Settings",            requires: [] },

  /* ── Cross-cutting add-on flags ── */
  ai:               { name: "Da Vinci AI",      requires: [] },
  "sms-otp":        { name: "SMS OTP (2FA)",    requires: [], alwaysOn: true },
}

/** Legacy/scope id → group-module. Illustrative prose lives in the spec; the
 *  totality test (lib-module-catalog-totality.test.ts, created in a later task
 *  of this plan/branch) is the completeness guarantee. */
export const LEGACY_MODULE_MAP: Record<string, GroupModuleId> = {
  // `core`/companies/contacts/tasks/projects stay CRM (shared relationship core);
  // deals/leads/quotes/offers moved to the dedicated `sales` group-module. This
  // map drives BOTH legacy-record expansion (hasModule 3b) AND the live API gate
  // (PERMISSION_MODULE_TO_MODULE_ID → middleware + requireAuth), so changing the
  // target here re-gates /deals, /leads, /quotes, /sequences, /territories,
  // /sales-quotas (and their sub-routes) onto `sales` in lock-step with the nav.
  core: "crm", deals: "sales", leads: "sales", tasks: "crm", quotes: "sales",
  offers: "sales", projects: "crm", companies: "crm", contacts: "crm",
  campaigns: "marketing", events: "marketing", journeys: "marketing",
  segments: "marketing", loyalty: "loyalty", "account-engagement": "marketing",
  omnichannel: "omnichannel", inbox: "omnichannel",
  // Identity entry, not a legacy alias: it puts `social` into
  // PERMISSION_MODULE_TO_MODULE_ID, which is what api-auth translates the
  // /api/v1/social scope through and what notifications/access.ts inverts to
  // resolve the module back to a role-matrix key.
  social: "social",
  voip: "voip",
  // Юридический контур соцмониторинга — свой permission-scope (admin-only), но
  // тот же тенантный модуль: бридж оставляет модульный гейт на `social`.
  "social-legal": "social",
  tickets: "support", "knowledge-base": "support", kb: "support", portal: "support",
  invoices: "finance", budgeting: "finance", profitability: "finance",
  pricing: "finance", payments: "finance", subscriptions: "finance", finance: "finance",
  reports: "analytics",
  workflows: "settings", "custom-fields": "settings", currencies: "settings",
  audit: "settings", users: "settings", settings: "settings",
  inventory: "mtm", "energy-utilities": "energy",
}

/** Scopes that stay module-UNGATED on purpose (nav-less backend verticals +
 *  action-string artifacts in requireAuth call sites). Anything not
 *  mapped/identity/here = CI failure in the totality test (created in a later
 *  task of this plan/branch).
 *
 *  EXCEPTION worth naming: `data-cloud` (CDP — `/api/v1/calculated-insights` +
 *  `/api/v1/identity-merge-queue`) is the one entry here that DOES have nav items.
 *  That is deliberate, not an oversight: CDP is FREE base infrastructure, so its
 *  API stays open to every tenant and its nav (Customer Insights + Merge Queue)
 *  is gated on the base `crm` module — NOT the paid `marketing` add-on (see
 *  nav-items.ts). Decision 2026-06-20: CDP = free base; nav + API agree (both free). */
export const INTENTIONALLY_UNGATED = new Set<string>([
  "commerce", "data-cloud", "education", "financial-services",
  "nonprofit", "revenue-recognition", "tpm",
  "read", "write", "delete", // action strings as scope args (read seen today; write/delete defensive)
])

/**
 * Legacy plan definitions — kept for backward compatibility with existing orgs.
 * `modules` arrays are HISTORY data in the pre-group (legacy id) vocabulary —
 * typed `string[]` on purpose after the union narrowed to the group catalog.
 * Runtime gating never reads them (hasModule is org.modules/addons-driven);
 * the only live consumer is plan-limits.ts, which uses `limits` exclusively.
 */
export const LEGACY_PLANS = {
  starter: {
    modules: ["core", "deals", "leads", "tasks"] as string[],
    limits: { users: 3, contacts: 500 },
    price: 9,
  },
  business: {
    modules: [
      "core", "deals", "leads", "tasks", "contracts", "tickets",
      "knowledge-base",
    ] as string[],
    limits: { users: 10, contacts: 2500 },
    price: 19,
  },
  professional: {
    modules: [
      "core", "deals", "leads", "tasks", "contracts", "invoices", "tickets",
      "knowledge-base", "campaigns", "omnichannel", "reports",
      "workflows", "currencies", "events", "projects",
      "budgeting", "profitability",
    ] as string[],
    limits: { users: 25, contacts: 10000 },
    price: 29,
  },
  enterprise: {
    modules: [...Object.keys(MODULE_REGISTRY)] as string[],
    limits: { users: -1, contacts: -1 },
    price: 59,
  },
} as const

/** @deprecated Use USER_TIERS instead */
export const PLANS = LEGACY_PLANS

export type PlanId = keyof typeof LEGACY_PLANS

/* ─── New user-tier pricing model ─── */

export const USER_TIERS = {
  "tier-5":     { maxUsers: 5,  price: 550,  pricePerUser: 110, discount: 0 },
  "tier-10":    { maxUsers: 10, price: 990,  pricePerUser: 99,  discount: 10 },
  "tier-25":    { maxUsers: 25, price: 2200, pricePerUser: 88,  discount: 20 },
  "tier-50":    { maxUsers: 50, price: 3850, pricePerUser: 77,  discount: 30 },
  "enterprise": { maxUsers: -1, price: -1,   pricePerUser: -1,  discount: -1 },
} as const

export type UserTierId = keyof typeof USER_TIERS

export const TIER_ORDER: UserTierId[] = ["tier-5", "tier-10", "tier-25", "tier-50", "enterprise"]

/**
 * Group-modules included in every base plan.
 *
 * Derived from the OLD base list mapped through the legacy→group map:
 * core/deals/leads/tasks/quotes/custom-fields/currencies/projects → `crm`,
 * contracts → `contracts`, events → `marketing` (so Marketing IS in base),
 * reports → `analytics`, workflows → `settings`,
 * knowledge-base/tickets → `support`.
 *
 * Consumed ONLY by the transient `org.modules === undefined` fallback in
 * `hasModule` (pre-materialisation JWTs). NOTE: the legacy
 * scripts/backfill-base-modules.mjs still mirrors the OLD legacy-id base list —
 * that script is frozen (add-only, intentionally NOT re-synced to group ids);
 * group-id backfill lives in scripts/backfill-group-modules.mjs (plan Task 8).
 */
export const BASE_PLAN_MODULES: ModuleId[] = [
  "crm", "sales", "contracts", "marketing", "analytics", "settings", "support",
]

/** Add-on and subscription module mappings */
export const ADDON_MODULES: Record<string, ModuleId[]> = {
  ai:        ["ai"],
  voip:      ["voip"],
  channels:  ["omnichannel"],
  finance:   ["finance"],
  mtm:       ["mtm"],
  marketing: ["marketing"],
  loyalty:   ["loyalty"],
}

export const PAID_ADDONS = {
  ai:        { id: "ai",        name: "Da Vinci AI", moduleIds: ["ai"] as ModuleId[] },
  channels:  { id: "channels",  name: "Channels",    moduleIds: ["omnichannel"] as ModuleId[] },
  marketing: { id: "marketing", name: "Marketing",   moduleIds: ["marketing"] as ModuleId[] },
  loyalty:   { id: "loyalty",   name: "Loyalty Program", moduleIds: ["loyalty"] as ModuleId[] },
} as const

export const SEPARATE_SUBSCRIPTIONS = {
  finance:        { id: "finance",        name: "Finance Suite",          moduleIds: ["finance"] as ModuleId[] },
  social:         { id: "social",         name: "Social Monitoring",       moduleIds: ["social"] as ModuleId[] },
  mtm:            { id: "mtm",            name: "Field Teams (MTM)",       moduleIds: ["mtm"] as ModuleId[] },
  health:         { id: "health",         name: "Health Cloud",            moduleIds: ["health"] as ModuleId[] },
  insurance:      { id: "insurance",      name: "Insurance Cloud",         moduleIds: ["insurance"] as ModuleId[] },
  "public-sector":{ id: "public-sector", name: "Public Sector Cloud",     moduleIds: ["public-sector"] as ModuleId[] },
  media:          { id: "media",          name: "Media Cloud",             moduleIds: ["media"] as ModuleId[] },
  energy:         { id: "energy",         name: "Energy & Utilities Cloud", moduleIds: ["energy"] as ModuleId[] },
} as const

interface OrgModuleContext {
  plan: string
  addons?: string[]
  modules?: Record<string, boolean>
}

/**
 * The value carried by a `prefix:value` feature flag, or null.
 *
 * Some settings are stored as flags that carry a value — which board sales work
 * lands on, how many days an undated promise gets. They live in the same array
 * as plain on/off flags because that array is what every tenant-config path
 * already reads and writes atomically. This reader is shared so the parsing
 * rule (first match wins, empty suffix is no value) stays in one place.
 */
export function featureFlagValue(features: unknown, prefix: string): string | null {
  const flag = featureFlagsToArray(features).find((value) => value.startsWith(prefix))
  const suffix = flag?.slice(prefix.length)
  return suffix && suffix.length > 0 ? suffix : null
}

export function featureFlagsToArray(features: unknown): string[] {
  let values: unknown[] = []
  if (Array.isArray(features)) {
    values = features
  } else if (typeof features === "string") {
    try {
      const parsed = JSON.parse(features || "[]")
      if (Array.isArray(parsed)) values = parsed
    } catch {
      values = []
    }
  }

  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    if (typeof value === "string" && !seen.has(value)) {
      seen.add(value)
      result.push(value)
    }
  }
  return result
}

/**
 * Add every transitive module dependency to an entitlement list.
 *
 * Module keys stay stable (`crm`, `support`, …); this only normalizes the
 * persisted feature set so direct API calls and the tenant editor follow the
 * same dependency contract as the creation wizard.
 */
export function withRequiredModules(features: unknown): string[] {
  const resolved = featureFlagsToArray(features)
  const included = new Set(resolved)

  for (let index = 0; index < resolved.length; index += 1) {
    const moduleId = resolved[index] as ModuleId
    const definition = MODULE_REGISTRY[moduleId]
    if (!definition) continue

    for (const requiredId of definition.requires) {
      if (included.has(requiredId)) continue
      included.add(requiredId)
      resolved.push(requiredId)
    }
  }

  return resolved
}

function booleanModuleRecord(value: unknown): Record<string, boolean> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  const result: Record<string, boolean> = {}
  for (const [key, enabled] of Object.entries(value)) {
    if (typeof enabled === "boolean") result[key] = enabled
  }
  return result
}

export function moduleRecordFromOrgFields(fields: {
  features?: unknown
  modules?: unknown
}): Record<string, boolean> {
  const modules: Record<string, boolean> = {}
  for (const feature of withRequiredModules(fields.features)) {
    modules[feature] = true
  }
  const merged = {
    ...modules,
    ...booleanModuleRecord(fields.modules),
  }

  // A stale materialized map may still contain `{ support: true, crm: false }`
  // from before this dependency existed. Do not preserve that impossible state
  // in a session: Support cannot work without the companies and clients held
  // by the base module.
  const enabledModuleIds = Object.entries(merged)
    .filter(([moduleId, enabled]) => enabled && moduleId in MODULE_REGISTRY)
    .map(([moduleId]) => moduleId)
  for (const requiredModuleId of withRequiredModules(enabledModuleIds)) {
    if (requiredModuleId in MODULE_REGISTRY) merged[requiredModuleId] = true
  }

  return merged
}

/**
 * Reconcile the `Organization.modules` JSON column against an authoritative
 * `features` list, returning the new column value.
 *
 * The superadmin tenant editor (`/admin/tenants/[id]/edit`) edits `features`
 * ONLY, but `hasModule` gates on the MERGE of `features` and this column (see
 * `moduleRecordFromOrgFields`). So a group-module written into `modules` by
 * Advisor Suite activation or a capability grant keeps being granted — and stays
 * visible in the tenant's sidebar — even after the superadmin toggles it OFF in
 * the editor, which the editor cannot express because it never writes this
 * column. Forcing every GROUP-module key to mirror `features` (while PRESERVING
 * non-group keys such as capability-entitlement module ids) makes `features`
 * authoritative for module visibility, honouring the `hasModule` contract.
 *
 * Non-group keys are kept untouched: a capability entitlement may legitimately
 * grant a module id that has no editor toggle, and clearing it here would revoke
 * a paid grant the superadmin never saw. Preserved LEGACY ids can't re-grant
 * their group either: writing all 16 group keys (including explicit `false`)
 * pins the record as NEW-catalog-shaped, so `hasModule` step 3b expansion is
 * permanently OFF for reconciled records (the marker test accepts any boolean).
 */
export function reconcileModulesWithFeatures(
  features: unknown,
  existingModules: unknown,
): Record<string, boolean> {
  const featureSet = new Set(withRequiredModules(features))
  const result = booleanModuleRecord(existingModules)
  for (const groupId of GROUP_MODULE_IDS) {
    result[groupId] = featureSet.has(groupId)
  }
  return result
}

/**
 * Whether a tenant may access a module. `org.modules` — materialised from
 * `Organization.features` by the auth callback — is the AUTHORITATIVE source of
 * truth for EVERY plan: a superadmin toggle in /admin/tenants/<id>/edit writes
 * `features`, which becomes `org.modules`, which gates here. The plan NAME no
 * longer grants modules at runtime; plans/addons are provisioning templates
 * that seed `features`/`addons` (see tenant-provisioning + backfill scripts).
 *
 * This is the single paid-feature gate consumed by nav (`accessibleNavItems`)
 * AND the API layer (`requireAuth` → 403), so it must be authoritative — any
 * "always true" plan-default branch here silently leaks paid modules.
 */
export function hasModule(org: OrgModuleContext, moduleId: ModuleId): boolean {
  // 1. Always-on modules (core CRM, sms-otp) are never gateable.
  if (MODULE_REGISTRY[moduleId]?.alwaysOn) return true

  // 2. Authoritative allow: the tenant's enabled `features` (→ org.modules).
  //    `{}` (Clear All / saved-empty) correctly grants nothing here.
  if (org.modules?.[moduleId] === true) return true

  // 2b. Authoritative DENY: the superadmin toggled this module OFF in the
  //     tenant editor. An explicit `false` can only be written by
  //     reconcileModulesWithFeatures — legacy writers only ever wrote `true`,
  //     and features-array materialisation only produces `true` (the same fact
  //     step 3b's marker test relies on). So it means "an admin SAVED the
  //     editor with this module off", and that must beat the addon path below.
  //
  //     Without this, an addon silently re-granted what the toggle turned off:
  //     `channels` (a default addon on the professional/enterprise plans) kept
  //     the whole Communication group in a tenant's sidebar after the superadmin
  //     had switched Omni-Channel off — the toggle looked broken (owner report,
  //     2026-08-01). Addons stay in `addons` as the BILLING record; they simply
  //     no longer override an explicit editor decision. Tenants never saved
  //     through the editor carry no explicit `false`, so their addon grants are
  //     untouched.
  if (org.modules?.[moduleId] === false) return false

  // 3. Add-on grants (superadmin-controlled, authoritative like `features`):
  //    (a) a module id listed DIRECTLY in `addons` (e.g. "voip", "mtm") — the
  //    old gate granted these on legacy plans; (b) a module granted by an addon
  //    BUNDLE via ADDON_MODULES (e.g. "finance" → invoices/budgeting/
  //    profitability). Keep BOTH so no tenant with a module-id in `addons`
  //    loses access when the plan-name override is removed.
  if (org.addons) {
    if (org.addons.includes(moduleId)) return true
    for (const addon of org.addons) {
      if (ADDON_MODULES[addon]?.includes(moduleId)) return true
    }
  }

  // 3b. Legacy-shaped record (pre-group-catalog tenant): expand legacy ids to
  //     their group. Active ONLY until the record carries a NEW-vocabulary group
  //     id — once a tenant is backfilled/saved with group ids, toggles are
  //     authoritative (no re-grant). CRITICAL: the markers are ONLY the 6 ids
  //     that did NOT exist in the legacy features vocabulary; ambiguous identity
  //     ids (`contracts`/`omnichannel`/`mtm`/industry clouds) were written into
  //     `features` by OLD backfills as legacy module ids, so their presence must
  //     NOT disable expansion — otherwise every pre-backfill tenant (old base
  //     list included `contracts`) would lose crm/settings access in the
  //     deploy→backfill window.
  //     The marker test is PRESENCE of a boolean, not `=== true`: an explicit
  //     `false` can only come from the reconciled `modules` column
  //     (reconcileModulesWithFeatures — legacy writers only ever wrote `true`,
  //     and features-array materialisation only produces `true`), so a record
  //     carrying e.g. `crm: false` was definitively written by the NEW catalog
  //     and its toggles must stick. Without this, a reconciled tenant with all
  //     six markers toggled OFF would re-enter expansion mode and any historic
  //     legacy id preserved in the column (`core`/`tickets`/`reports`…) would
  //     silently resurrect its group.
  if (org.modules && !NEW_VOCAB_GROUP_IDS.some((g) => typeof org.modules![g] === "boolean")) {
    for (const [legacy, group] of Object.entries(LEGACY_MODULE_MAP)) {
      if (group === moduleId && org.modules[legacy] === true) return true
    }
  }

  // (The `crm ⇒ sales` transition shim that bridged the deploy→backfill window
  //  was removed 2026-06-14 once every shared-box tenant carried an explicit
  //  `sales` in `Organization.features` (backfill-sales-module.mjs). `sales` is
  //  now an independently-toggleable group-module; new tenants get it via the
  //  plan defaults. Legacy-shaped records still resolve it via step 3b because
  //  `sales` is intentionally NOT a NEW_VOCAB marker. NB: any box that newly
  //  deploys the Sales code MUST run the backfill BEFORE serving traffic — there
  //  is no longer a runtime bridge.)

  // 4. Transient back-compat ONLY: a JWT issued before the `token.modules`
  //    materialisation existed has `org.modules === undefined` (NOT `{}`). To
  //    avoid hiding base modules mid-session, fall back to BASE_PLAN_MODULES
  //    until the next token rotation re-materialises a real record. The v3
  //    backfill (scripts/backfill-base-modules.mjs) writes each tenant's
  //    effective module set into `features` BEFORE this ships, so once every
  //    active session has rotated this branch is effectively dead.
  if (org.modules === undefined && BASE_PLAN_MODULES.includes(moduleId)) return true

  return false
}

export function requireModule(moduleId: ModuleId) {
  return (org: OrgModuleContext) => {
    if (!hasModule(org, moduleId)) {
      throw new Error(
        `Module "${MODULE_REGISTRY[moduleId].name}" is not enabled. Upgrade your plan or add it as an add-on.`
      )
    }
  }
}

export function getOrgModules(org: OrgModuleContext): ModuleId[] {
  return (Object.keys(MODULE_REGISTRY) as ModuleId[]).filter((m) =>
    hasModule(org, m)
  )
}
