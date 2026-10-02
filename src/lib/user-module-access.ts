import { hasModule, type GroupModuleId, type ModuleId } from "./modules"
import { isTenantCapabilityEnabled, type FieldTenantCapabilityId } from "./tenant-capabilities"

/**
 * Per-user module visibility: an admin can hide whole group-modules from one
 * person ("the pharmacy rep sees Route & Field and nothing else") without
 * turning them off for the tenant.
 *
 * It is a DENY list on the user row (`User.hiddenModules`) and it only ever
 * narrows. The tenant's own toggles stay the ceiling, the role matrix in
 * permissions.ts still decides read/write inside a visible module, and an empty
 * list is exactly the pre-existing behaviour — so a user nobody has restricted
 * goes through none of this.
 *
 * Deny rather than allow because Postgres arrays cannot be null: an allow list
 * would have to read "empty" as either "everything" (then unticking every box
 * silently grants it all) or "nothing" (then every existing user is locked out
 * on deploy).
 *
 * Pure data and functions on purpose (modules.ts and tenant-capabilities.ts are
 * too) — the Edge proxy, the Auth callbacks and client components all read it.
 */

/**
 * What an admin can hide: the sidebar's group-modules, plus Workforce HRM.
 *
 * HRM is the one entry that is not a group-module. It is a tenant capability
 * that used to travel inside `mtm` and is now sold apart from routes, with its
 * own sidebar group — so "hide Route & Field but keep the timesheet" has to be
 * expressible, and one `mtm` checkbox could not say it. Route & Field itself
 * keeps the `mtm` id: that is the toggle the superadmin's tenant editor shows.
 */
export const WORKFORCE_HIDEABLE_ID = "workforce-hrm"
export type UserHideableId = GroupModuleId | typeof WORKFORCE_HIDEABLE_ID

/**
 * `settings` is deliberately not hideable. Its scope is not only the settings
 * pages: currencies, custom fields and workflows resolve to it too
 * (LEGACY_MODULE_MAP), and every deal/contact form reads those. Hiding it would
 * break the forms of the modules that were left visible. What a non-admin may
 * do in Settings is already the role matrix's job.
 */
// Spelled out rather than derived from GROUP_MODULE_IDS: the auth layer reads
// this file on every request, and a derived list would make it evaluate
// modules.ts data at import time. lib-user-module-access.test.ts fails if the
// two ever disagree, so a new group-module cannot be forgotten here.
const HIDEABLE_GROUP_IDS = [
  "crm", "sales", "contracts", "marketing", "loyalty", "omnichannel", "social",
  "voip", "support", "finance",
  "analytics", "mtm", "health", "insurance", "public-sector", "media",
  "energy",
] as const satisfies readonly GroupModuleId[]

/** Every group-module the mask pins: the hideable ones and `settings`. */
const MASKED_GROUP_IDS: readonly GroupModuleId[] = [...HIDEABLE_GROUP_IDS, "settings"]

export const USER_HIDEABLE_MODULE_IDS: readonly UserHideableId[] = [
  ...HIDEABLE_GROUP_IDS,
  WORKFORCE_HIDEABLE_ID,
]

const HIDEABLE = new Set<string>(USER_HIDEABLE_MODULE_IDS)

/**
 * Admins are never restricted: the mask is something an admin sets, and an
 * admin who could hide modules from another admin (or from themselves) could
 * leave the tenant with nobody able to reach what was hidden. Superadmin
 * bypasses every module gate already.
 */
export function roleIgnoresModuleMask(role: string | null | undefined): boolean {
  return role === "admin" || role === "superadmin"
}

/** Anything that is not a known, hideable group-module id is dropped. */
export function normalizeHiddenModules(value: unknown): UserHideableId[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  for (const entry of value) {
    if (typeof entry === "string" && HIDEABLE.has(entry)) seen.add(entry)
  }
  return USER_HIDEABLE_MODULE_IDS.filter((id) => seen.has(id))
}

/**
 * Strict form for the write API: `null` when the input names anything that is
 * not hideable, so a typo is a 400 rather than a restriction that silently did
 * not apply. Always empty for an exempt role — storing a list an admin row
 * ignores would spring to life the day the person is demoted.
 */
export function parseHiddenModulesInput(role: string, value: readonly string[]): UserHideableId[] | null {
  if (value.some((entry) => !HIDEABLE.has(entry))) return null
  return effectiveHiddenModules(role, value)
}

/** The list that actually applies to this person — empty for exempt roles. */
export function effectiveHiddenModules(role: string | null | undefined, value: unknown): UserHideableId[] {
  return roleIgnoresModuleMask(role) ? [] : normalizeHiddenModules(value)
}

/** The hideable entry that owns a field capability. */
export function hideableIdForFieldCapability(capability: FieldTenantCapabilityId): UserHideableId {
  return capability === "route-field" ? "mtm" : WORKFORCE_HIDEABLE_ID
}

/**
 * The hideable entry that owns an API gate module (a permission scope already
 * bridged through PERMISSION_MODULE_TO_MODULE_ID). `workforce` is the one scope
 * that is capability-gated rather than mapped to a group-module.
 */
export function hideableIdForGateModule(gateModule: string): string {
  return gateModule === "workforce" ? WORKFORCE_HIDEABLE_ID : gateModule
}

interface OrgModuleFields {
  plan: string
  addons?: string[]
  modules?: Record<string, boolean>
}

/**
 * Which hideable entries this tenant actually has — the list an admin is
 * offered. Route & Field counts as present through either its capability key or
 * the historical `mtm` grant, the same dual-read the navigation uses.
 */
export function tenantHideableModules(org: OrgModuleFields): UserHideableId[] {
  return USER_HIDEABLE_MODULE_IDS.filter((id) => {
    if (id === "mtm") return isTenantCapabilityEnabled("route-field", org) || hasModule(org, "mtm")
    if (id === WORKFORCE_HIDEABLE_ID) return isTenantCapabilityEnabled("workforce-hrm", org)
    return hasModule(org, id as ModuleId)
  })
}

/**
 * The tenant's module record as this user should see it.
 *
 * Every group-module is written out as an explicit boolean rather than only
 * flipping the hidden ones to `false`. A lone `false` would not be enough, and
 * could do harm: on a legacy-shaped record, writing `crm: false` flips
 * `hasModule`'s legacy expansion off (crm is a new-vocabulary marker) and would
 * silently take away modules the admin never touched. Resolving each group
 * through `hasModule` first and pinning the answer keeps every other module
 * exactly as it was, and the explicit `false` beats an addon grant.
 *
 * The two field capabilities are resolved BEFORE the groups are pinned, for the
 * same reason: both dual-read the historical `mtm` grant, so pinning `mtm` to
 * false would take Workforce HRM away from someone who was only meant to lose
 * the routes. A capability that survives the mask but was living on that legacy
 * grant gets its own key written; one that is hidden gets an explicit `false`,
 * which the capability resolver treats as off whatever else is set.
 *
 * Other non-group keys (addon flags, entitlements, feature flags) pass through
 * untouched.
 */
export function applyUserModuleMask(
  org: OrgModuleFields,
  hidden: readonly string[],
): Record<string, boolean> | undefined {
  if (hidden.length === 0) return org.modules
  const hiddenSet = new Set(hidden)
  const capabilities = (["route-field", "workforce-hrm"] as const).map((capability) => ({
    capability,
    enabled: isTenantCapabilityEnabled(capability, org),
    hidden: hiddenSet.has(hideableIdForFieldCapability(capability)),
  }))

  const result: Record<string, boolean> = { ...(org.modules ?? {}) }
  for (const id of MASKED_GROUP_IDS) {
    result[id] = !hiddenSet.has(id) && hasModule(org, id)
  }
  for (const { capability, enabled, hidden: capabilityHidden } of capabilities) {
    if (!enabled) continue
    result[capability] = !capabilityHidden
  }
  return result
}

/**
 * The module context for surfaces that answer ONE PERSON out of several modules
 * at once — the assistants and their tools. Takes the tenant's context (from
 * `getOrgModuleContext`) and returns it with the modules an admin hid from the
 * caller switched off, so what the assistant may read for this request cannot
 * be wider than what the person's own menu shows.
 *
 * Org-level decisions (who gets a notification, whether a channel may send)
 * keep the unmasked context: one person's restriction must not change what the
 * organization does.
 */
export function moduleContextForUser<T extends OrgModuleFields & { modules: Record<string, boolean> }>(
  org: T,
  auth: { hiddenModules?: readonly string[] },
): T {
  const hidden = auth.hiddenModules ?? []
  if (hidden.length === 0) return org
  return { ...org, modules: applyUserModuleMask(org, hidden) ?? org.modules }
}

/**
 * API namespaces that the proxy's tenant module gate does not cover, mapped to
 * the hideable entry that owns them. That gate only looks at `/api/v1/*` paths
 * whose scope bridges to a group-module, which leaves out the finance APIs
 * living outside `/api/v1` and the capability-gated Workforce namespace (most
 * of whose routes authenticate through a session wrapper, not requireAuth).
 * The per-user check has to name them, or "hidden" would mean "hidden from the
 * menu" for these.
 */
const UNGATED_API_PREFIXES: ReadonlyArray<readonly [string, UserHideableId]> = [
  ["/api/v1/workforce", WORKFORCE_HIDEABLE_ID],
  ["/api/finance", "finance"],
  ["/api/budgeting", "finance"],
  ["/api/cost-model", "finance"],
]

export function hideableIdForUngatedApiPath(pathname: string): UserHideableId | null {
  for (const [prefix, id] of UNGATED_API_PREFIXES) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) return id
  }
  return null
}
