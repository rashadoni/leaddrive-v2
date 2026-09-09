import { ALL_ROLES } from "./permissions"

/**
 * Single source of truth for the organization role catalog.
 *
 * Historically the role list was duplicated, divergently, across several
 * places (PUT /users/[id] accepted admin|manager|agent|viewer, POST /users
 * accepted admin|manager|sales|support|viewer and silently coerced anything
 * else to "sales", and settings/roles shipped 8 built-ins). That divergence is
 * why a user assigned the built-in "marketing" role could not be edited — the
 * dropdown offered a role the write API rejected.
 */
export interface RoleConfig {
  id: string
  name: string
  color: string
  isSystem: boolean
}

/**
 * The roles the roles-management UI (settings/roles) ships with when an org has
 * not customized its list. This is the CATALOG shown in the role dropdown.
 * `isSystem` roles cannot be deleted from the UI.
 *
 * Kept deliberately equal to the ENFORCE-ABLE roles (== getAssignableRoleIds()).
 * Earlier this catalog also shipped agent/marketing/finance/service_desk, but
 * those have no entry in ROLE_PERMISSIONS (lib/permissions.ts) so they resolve
 * to deny-all (403 everywhere) — offering them in the dropdown only produced
 * users who were silently locked out. They were removed and `support` (which
 * IS enforced) was added. Wiring org settings.permissions into enforcement so
 * custom/extended roles can be reinstated is tracked in
 * memory/deferred_findings.md. All six are isSystem so the catalog cannot
 * drift back out of sync with enforcement via the delete-role UI.
 * `ticketing` is intentionally narrower than `support`: it can work tickets
 * and ticket-scoped call recordings, but it has no Inbox or global VoIP access.
 */
export const DEFAULT_ROLES: RoleConfig[] = [
  { id: "admin", name: "Admin", color: "red", isSystem: true },
  { id: "manager", name: "Manager", color: "blue", isSystem: true },
  { id: "sales", name: "Sales", color: "emerald", isSystem: true },
  { id: "support", name: "Support", color: "cyan", isSystem: true },
  { id: "ticketing", name: "Ticketing agent", color: "orange", isSystem: true },
  { id: "viewer", name: "Viewer", color: "gray", isSystem: true },
]

/**
 * Role IDs that may actually be ASSIGNED to a user today.
 *
 * A role is assignable only if the permission engine enforces it — i.e. it has
 * an entry in ROLE_PERMISSIONS (== ALL_ROLES, see lib/permissions.ts).
 * `superadmin` is excluded: it is a platform-level role and a tenant admin must
 * never be able to mint one via the user-management UI (privilege escalation).
 *
 * The default catalog (DEFAULT_ROLES) is kept equal to this set, so default
 * orgs never offer a non-assignable role. An org that SAVED a custom role list
 * (settings.roles) may still contain extended/custom roles; those resolve to
 * **deny-all** in checkPermission() (requireAuth → 403 on every request)
 * because the org's settings.permissions matrix is NOT consulted at enforcement
 * time, so GET /settings/roles flags them `assignable:false` and the user
 * dropdown hides them. Wiring settings.permissions into enforcement (to allow
 * custom/extended roles) is a separate, security-sensitive change tracked in
 * memory/deferred_findings.md.
 *
 * Callers always allow KEEPING a user's current role unchanged, so existing
 * users on an extended role can still be edited and migrated to a working role.
 */
export function getAssignableRoleIds(): Set<string> {
  return new Set(ALL_ROLES.filter((r) => r !== "superadmin"))
}
