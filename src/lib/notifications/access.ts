/**
 * Notification access predicates — pure functions, no DB, no React.
 *
 * Gates which sections a given user (role + org-feature) may receive
 * notifications from. Stricter than the nav launcher which filters by feature
 * only: here BOTH the org-feature gate (hasModule) AND the role-matrix read
 * check must pass.
 */
import { type Role, checkPermission, PERMISSION_MODULE_TO_MODULE_ID } from "@/lib/permissions"
import { hasModule, LEGACY_MODULE_MAP } from "@/lib/modules"
import { isNavItemEnabled, navItems, NAV_GROUP_ORDER } from "@/lib/nav-items"
import type { Module } from "@/lib/permissions"
import { ENTITY_TO_MODULE } from "@/lib/notifications/taxonomy"

// ---------------------------------------------------------------------------
// Context type
// ---------------------------------------------------------------------------

/**
 * Structural subset of OrgModuleContext (modules.ts) + role.
 * We re-declare the minimal shape here rather than importing the unexported
 * OrgModuleContext so this module stays dependency-safe.
 */
export interface NotificationAccessCtx {
  role: Role
  plan?: string
  addons?: string[]
  modules?: Record<string, boolean>
}

// ---------------------------------------------------------------------------
// MODULE_ID_TO_PERMISSION_MODULES
// ---------------------------------------------------------------------------

/**
 * Inverted form of PERMISSION_MODULE_TO_MODULE_ID.
 *
 * PERMISSION_MODULE_TO_MODULE_ID maps permission-module vocab → ModuleId
 * (e.g., "inbox" → "omnichannel", "kb" → "knowledge-base").
 * This inverse maps ModuleId → permission-module keys that resolve to it
 * (e.g., "omnichannel" → ["inbox"], "knowledge-base" → ["kb"]).
 *
 * Used by roleCanRead to gate nav items (which carry ModuleId) against the
 * ROLE_PERMISSIONS matrix (which is keyed by permission-module vocab).
 */
const MODULE_ID_TO_PERMISSION_MODULES: Record<string, string[]> = (() => {
  const result: Record<string, string[]> = {}
  for (const [permModule, moduleId] of Object.entries(PERMISSION_MODULE_TO_MODULE_ID)) {
    if (!result[moduleId]) result[moduleId] = []
    result[moduleId].push(permModule)
  }
  return result
})()

// ---------------------------------------------------------------------------
// roleCanRead
// ---------------------------------------------------------------------------

/**
 * True if the role may read the given ModuleId using the ROLE_PERMISSIONS
 * matrix (permission-module vocab) via checkPermission.
 *
 * Resolution order:
 * 1. Wildcard "*" entry includes "read" (superadmin, admin, viewer) — handled
 *    inside checkPermission.
 * 2. ModuleId is a direct permission-module key → checkPermission(role, moduleId, "read").
 * 3. ModuleId appears as a value in PERMISSION_MODULE_TO_MODULE_ID → resolve
 *    to its permission-module key(s) via the inverted map and check ANY.
 *    (e.g., "omnichannel" → "inbox", "knowledge-base" → "kb", "energy" → "energy-utilities",
 *    "quotes" → "offers")
 * 4. ModuleId maps to zero permission-modules (e.g., "core", "workflows") →
 *    fall back to true (no role-gate applies; feature-only gate is sufficient).
 *
 * This mirrors the exact logic the API auth gate uses (api-auth.ts:385
 * calls resolveModuleFromPath then checkPermission) but operates on ModuleId
 * (nav-items vocab) rather than route paths.
 */
export function roleCanRead(role: Role, moduleId: string): boolean {
  // Step 1+2: Try direct match in permission-module vocab first.
  // checkPermission handles wildcard internally.
  // We only call it directly if the moduleId is a known permission-module
  // (i.e., it exists as a key in the matrix — same vocab as Module type).
  // Attempt the direct lookup: if moduleId is a Module, checkPermission works.
  // We detect this by checking MODULE_ID_TO_PERMISSION_MODULES doesn't own it
  // AND the key isn't in the inverted map, meaning it's likely a direct match.

  // Step 3: Check if this ModuleId maps to bridged permission-module(s).
  const bridged = MODULE_ID_TO_PERMISSION_MODULES[moduleId]
  if (bridged && bridged.length > 0) {
    // ModuleId is a target of the bridge (e.g., "omnichannel" → ["inbox"]).
    // Check ANY mapped permission-module — if any grants read, return true.
    return bridged.some((pm) => checkPermission(role, pm as Module, "read"))
  }

  // Step 2: ModuleId is NOT a bridge target — treat as a direct permission-module
  // key (e.g., "deals", "campaigns", "tickets", "inbox", "kb" — the permission vocab).
  // checkPermission handles wildcard + explicit matrix lookup.
  // If moduleId is absent from the matrix entirely, checkPermission returns false for
  // non-wildcard roles. That is correct for cases where a new permission-module was
  // added to the matrix: the result is deny (conservative). But for ModuleIds that
  // are genuinely not role-gated at all (no matrix key, no bridge target, e.g.
  // "core", "workflows"), we fall back to true so the section is never falsely blocked.
  //
  // Distinguish: does this ModuleId appear anywhere in the matrix as a key?
  // We detect via checkPermission on a known non-wildcard role — but that is expensive.
  // Simpler: check the known set of ModuleIds that have no permission-module mapping.
  // These are: "core", "workflows", and any future ModuleId without a matrix entry.
  // Since we can't enumerate all future ones, we use a conservative allowlist of
  // KNOWN ungated ModuleIds and fall back to true for them; everything else uses
  // checkPermission (which will deny if not in matrix — safe default).
  const UNGATED_MODULE_IDS = new Set(["core", "workflows"])
  if (UNGATED_MODULE_IDS.has(moduleId)) {
    return true
  }

  // For all other ModuleIds (deals, campaigns, tickets, leads, tasks, contracts,
  // invoices, budgeting, profitability, reports, voip, ai, projects, events, mtm,
  // health, insurance, public-sector, media, etc.) — direct permission-module lookup.
  return checkPermission(role, moduleId as Module, "read")
}

// ---------------------------------------------------------------------------
// canNotifyEntityType
// ---------------------------------------------------------------------------

/**
 * True iff the user may receive notifications for the given entityType.
 *
 * Stricter than canNotifySection: gates on the SPECIFIC module the entityType
 * maps to, not the section's existential OR across all sibling modules.
 * This prevents sibling-module leaks (e.g. support has events:read but not
 * campaigns:read → canNotifyEntityType("campaign") is false even though both
 * "event" and "campaign" share the Marketing section).
 *
 * Use this for DELIVERY (read-gate + push-gate).
 * Use canNotifySection for UI/prefs-API (which section toggles to show/enable).
 *
 * Returns false for unknown entityTypes (fail-closed).
 */
export function canNotifyEntityType(ctx: NotificationAccessCtx, entityType: string): boolean {
  const moduleId = ENTITY_TO_MODULE[entityType]
  if (!moduleId) return false // unknown entityType → fail-closed
  // ORG gate runs on GROUP vocabulary (MC-T4 P2 fix): ENTITY_TO_MODULE keeps the
  // legacy ids ("campaign" → "campaigns"), but a group-only org record
  // ({marketing:true}, no legacy flags — what the backfill/admin chips write) has
  // hasModule's 3b expansion OFF (NEW-vocab marker present), so the bare legacy id
  // would silently deny delivery. Translate legacy → group for the ORG gate only;
  // identity/group ids and addon flags (ai/voip) fall through unchanged. Legacy-
  // shaped records keep working: 3b expansion grants the group from legacy flags.
  const orgModuleId = LEGACY_MODULE_MAP[moduleId] ?? moduleId
  // superadmin bypasses the org-feature gate — mirrors accessibleNavItems' `showAll`
  // in nav-items.ts (superadmin manages the whole platform, sees every module).
  // Non-superadmin must have the org module enabled.
  const orgAccess =
    ctx.role === "superadmin" ||
    hasModule(
      { plan: ctx.plan ?? "", addons: ctx.addons, modules: ctx.modules },
      orgModuleId
    )
  // ROLE gate stays on the FINE legacy id — per-entity granularity preserved
  // (e.g. support: events:read but campaigns:[] → campaign delivery still denied).
  return orgAccess && roleCanRead(ctx.role, moduleId)
}

// ---------------------------------------------------------------------------
// canNotifySection
// ---------------------------------------------------------------------------

/**
 * True iff there exists at least one navItem in `section` such that:
 *   - hasModule(ctx, item.module) — org-feature gate
 *   - roleCanRead(ctx.role, item.module) — role-matrix read gate (uses permission-module vocab)
 *
 * Both conditions must hold for at least one item (AND-gate per item, OR
 * across items in the section). superadmin resolves the role gate via wildcard
 * AND skips the hasModule gate (see body) — so it sees every section,
 * consistent with the app launcher's `showAll`.
 */
export function canNotifySection(ctx: NotificationAccessCtx, section: string): boolean {
  const sectionItems = navItems.filter((i) => i.group === section)
  return sectionItems.some((item) => {
    // superadmin bypasses the org-feature gate — mirrors accessibleNavItems'
    // `showAll = role === "superadmin"` in nav-items.ts, so the notification
    // settings stay consistent with the app launcher. Non-superadmin requires
    // the org to actually have the module (modules[] is authoritative; the
    // empty-string plan fallback is harmless — hasModule never reads plan).
    const orgAccess =
      ctx.role === "superadmin" ||
      isNavItemEnabled(
        { plan: ctx.plan ?? "", addons: ctx.addons, modules: ctx.modules, role: ctx.role },
        item,
      )
    const permissionScope = item.permissionScope ?? item.module
    return typeof permissionScope === "string" && permissionScope.length > 0 &&
      orgAccess && roleCanRead(ctx.role, permissionScope)
  })
}

// ---------------------------------------------------------------------------
// accessibleSections
// ---------------------------------------------------------------------------

/**
 * Returns the ordered subset of NAV_GROUP_ORDER sections the user can be
 * notified about (both org-feature and role-matrix pass for at least one
 * module in the section).
 */
export function accessibleSections(ctx: NotificationAccessCtx): string[] {
  return NAV_GROUP_ORDER.filter((section) => canNotifySection(ctx, section))
}
