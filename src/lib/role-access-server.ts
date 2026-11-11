/**
 * Server side of an organization's role rights (role-access.ts): a per-process
 * copy of each organization's map, filled from the organization row that
 * auth() re-reads on every request and requireAuth reads before its gate, and
 * read by `checkPermission` for the tenant of the request.
 *
 * Imported for its side effect by auth.ts and api-auth.ts, so every server
 * bundle that checks a right has the getter registered.
 */
import { getRlsContext } from "./rls-context"
import { readRoleAccess, registerRoleAccessGetter, type RoleAccessMap } from "./role-access"

const cache = globalThis as unknown as { __ldRoleAccessByOrg?: Map<string, RoleAccessMap> }
const byOrg: Map<string, RoleAccessMap> = cache.__ldRoleAccessByOrg ?? (cache.__ldRoleAccessByOrg = new Map())

/** Keep the organization's map as its row says now. */
export function rememberRoleAccess(orgId: string | null | undefined, settings: unknown): RoleAccessMap {
  const map = readRoleAccess(settings)
  if (orgId) byOrg.set(orgId, map)
  return map
}

/** The organization's map as last read, or null when this process has not read it yet. */
export function orgRoleAccess(orgId: string | null | undefined): RoleAccessMap | null {
  return orgId ? byOrg.get(orgId) ?? null : null
}

registerRoleAccessGetter(() => {
  try {
    return orgRoleAccess(getRlsContext()?.orgId)
  } catch {
    // No tenant storage to ask (a test double of rls-context): built-in rights.
    return null
  }
})
