import { isNavItemRoleAllowed, navItems } from "./nav-items"
import { checkPermission, type Role } from "./permissions"
import { effectiveHiddenModules, type UserHideableId } from "./user-module-access"

/**
 * What ONE person ends up with, once their role and their module ticks are put
 * together — the answer the user card shows while an admin is still choosing.
 *
 * The two settings live side by side and neither explains the other: the role
 * table says "Manager — full access to Deals", the ticks say "Deals hidden",
 * and until this existed the only way to learn the outcome was to sign in as
 * the person. Everything here is asked of the functions enforcement itself uses
 * (`checkPermission`, `effectiveHiddenModules`, `isNavItemRoleAllowed`), so the
 * card cannot promise something the server will refuse.
 */

export type AccessLevel = "full" | "edit" | "view" | "none"

/**
 * What the server lets a role do in one permission scope, as one of the four
 * levels the role table shows. A role the engine does not know (a custom one)
 * is denied everything, which is what "none" in every row says.
 */
export function enforcedAccessLevel(roleId: string, scope: string): AccessLevel {
  const can = (action: "read" | "write" | "delete") => checkPermission(roleId as Role, scope, action)
  if (can("delete")) return "full"
  if (can("write")) return "edit"
  if (can("read")) return "view"
  return "none"
}

/**
 * The permission scopes a hideable module is made of — the same scopes the role
 * table on /settings/roles lists, grouped the way the API gate groups them
 * (PERMISSION_MODULE_TO_MODULE_ID). One tick hides them all; the role decides
 * each separately, which is why a module's outcome can be "it varies".
 * lib-user-access-summary.test.ts fails if a scope is filed under a module the
 * gate does not put it in.
 */
export const HIDEABLE_MODULE_SCOPES: Record<UserHideableId, readonly string[]> = {
  crm: ["companies", "contacts", "tasks", "projects"],
  sales: ["deals", "leads", "offers"],
  contracts: ["contracts"],
  marketing: ["campaigns", "journeys", "segments", "events"],
  loyalty: ["loyalty"],
  omnichannel: ["inbox"],
  social: ["social"],
  voip: ["voip"],
  support: ["tickets", "kb"],
  finance: ["invoices", "budgeting", "profitability", "pricing"],
  analytics: ["reports"],
  mtm: ["mtm"],
  health: ["health"],
  insurance: ["insurance"],
  "public-sector": ["public-sector"],
  media: ["media"],
  energy: ["energy-utilities"],
  "workforce-hrm": ["workforce"],
}

export interface ModuleAccessOutcome {
  id: UserHideableId
  /**
   * `hidden` — an admin unticked it for this person; `mixed` — visible, and the
   * role treats its scopes differently (see `parts`); otherwise the one level
   * every scope shares.
   */
  outcome: AccessLevel | "hidden" | "mixed"
  /** Scopes grouped by level, strongest first. Filled only for `mixed`. */
  parts: { level: AccessLevel; scopes: string[] }[]
}

const LEVEL_ORDER: readonly AccessLevel[] = ["full", "edit", "view", "none"]

export function moduleAccessOutcome(
  role: string,
  hiddenModules: readonly string[],
  id: UserHideableId,
): ModuleAccessOutcome {
  if (effectiveHiddenModules(role, hiddenModules).includes(id)) {
    return { id, outcome: "hidden", parts: [] }
  }
  const scopes = HIDEABLE_MODULE_SCOPES[id]
  const parts = LEVEL_ORDER
    .map((level) => ({ level, scopes: scopes.filter((scope) => enforcedAccessLevel(role, scope) === level) }))
    .filter((part) => part.scopes.length > 0)
  return parts.length === 1
    ? { id, outcome: parts[0].level, parts: [] }
    : { id, outcome: "mixed", parts }
}

export interface SettingsAccessOutcome {
  /**
   * `full` — administers the organization; `view` — reads its configuration
   * and changes nothing; `personal` — only their own notification preferences,
   * plus whatever `pages` names.
   */
  outcome: "full" | "view" | "personal"
  /** `nav` message keys of the Settings pages a `personal` person also gets. */
  pages: string[]
}

/**
 * Settings has no tick: the module carries currencies, custom fields and
 * workflows that every form reads, so it cannot be hidden. What a person gets
 * there is the role's doing alone — and, for the audit journal, of whether
 * anything was hidden from them.
 */
export function settingsAccessOutcome(role: string, hiddenModules: readonly string[]): SettingsAccessOutcome {
  if (checkPermission(role as Role, "settings", "write")) return { outcome: "full", pages: [] }
  if (checkPermission(role as Role, "settings", "read")) return { outcome: "view", pages: [] }
  const person = { plan: "", role, hiddenModules: effectiveHiddenModules(role, hiddenModules) }
  const pages = navItems
    .filter((item) => item.group === "Settings" && (item.permissionScope || item.allowedRoles))
    .filter((item) => isNavItemRoleAllowed(person, item))
    .map((item) => item.tKey)
  return { outcome: "personal", pages }
}
