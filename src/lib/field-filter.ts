import { prisma } from "@/lib/prisma"
import { isAdmin } from "@/lib/constants"

// In-memory cache: orgId:roleId:entityType → { fieldName: access }
const permissionCache = new Map<string, { data: Record<string, string>; expiresAt: number }>()
const CACHE_TTL = 60_000 // 60 seconds

/**
 * The permission set could not be read. Not the same thing as "no restrictions
 * are configured", which is why it is an error rather than an empty map.
 */
export class FieldPermissionsUnavailableError extends Error {
  readonly code = "FIELD_PERMISSIONS_UNAVAILABLE"
  constructor(readonly entityType: string) {
    super(`Field permissions for ${entityType} could not be read`)
    this.name = "FieldPermissionsUnavailableError"
  }
}

async function readFieldPermissions(
  orgId: string,
  roleId: string,
  entityType: string,
): Promise<Record<string, string>> {
  const permissions = await prisma.fieldPermission.findMany({
    where: { organizationId: orgId, roleId, entityType },
  })
  const map: Record<string, string> = {}
  for (const p of permissions as Array<{ fieldName: string; access: string }>) {
    map[p.fieldName] = p.access
  }
  return map
}

/**
 * Field permissions for a WRITE (roadmap C1.9).
 *
 * `getFieldPermissions` below answers an unreadable table with an empty map,
 * which the rest of the code correctly reads as "nothing is restricted". On a
 * read path that is a tolerable default. On a write path it is the opposite of
 * the intended rule: a database blip would make every restricted field
 * editable, and — worse — the lenient loader used to cache that emptiness for
 * a minute, turning one bad second into sixty.
 *
 * So the write path gets its own loader. It shares the cache for successes
 * only, and a failure is raised, never stored.
 */
export async function requireFieldPermissions(
  orgId: string,
  roleId: string,
  entityType: string,
): Promise<Record<string, string>> {
  const cacheKey = `${orgId}:${roleId}:${entityType}`
  const cached = permissionCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) return cached.data

  let map: Record<string, string>
  try {
    map = await readFieldPermissions(orgId, roleId, entityType)
  } catch {
    throw new FieldPermissionsUnavailableError(entityType)
  }
  permissionCache.set(cacheKey, { data: map, expiresAt: Date.now() + CACHE_TTL })
  return map
}

export async function getFieldPermissions(
  orgId: string,
  roleId: string,
  entityType: string
): Promise<Record<string, string>> {
  const cacheKey = `${orgId}:${roleId}:${entityType}`
  const cached = permissionCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) return cached.data

  let permissions: any[] = []
  try {
    permissions = await prisma.fieldPermission.findMany({
      where: { organizationId: orgId, roleId, entityType },
    })
  } catch {
    // Read path: an unreadable table means no restrictions are applied, which
    // is the historical behaviour for list and detail responses. The failure is
    // deliberately NOT cached — poisoning the cache for a minute turned a
    // one-second blip into a sixty-second hole, and the write path above reads
    // the same cache.
    return {}
  }

  const map: Record<string, string> = {}
  for (const p of permissions) {
    map[p.fieldName] = p.access
  }

  permissionCache.set(cacheKey, { data: map, expiresAt: Date.now() + CACHE_TTL })
  return map
}

/**
 * Filter entity fields for GET responses.
 * Hidden fields are removed from the response.
 * Admin always sees everything.
 */
/**
 * Columns that must never leave the API, whatever the role and whatever the
 * per-entity field permissions say. Finding F-32 in
 * docs/isms/ISMS-02-gap-analysis.md.
 *
 * This list exists because the permission model below is
 * visible-unless-configured: a column nobody thought to configure is returned.
 * That default is right for business fields — a new custom field should show up
 * without an admin ticking a box — and wrong for credentials, which nobody adds
 * to a field-permission screen because they are not fields anyone edits.
 *
 * `portalVerificationToken` is the sharp one: it is the link a tenant's own
 * customer follows to set their portal password. Returning it to a CRM operator
 * hands them that customer's portal identity.
 */
const NEVER_RETURNED = new Set([
  "portalPasswordHash",
  "portalVerificationToken",
  "passwordHash",
  "totpSecret",
  "resetToken",
  "backupCodes",
  "twoFactorNonce",
  "calendarToken",
  "apiKey",
  "keyHash",
])

/**
 * Strips credential-bearing columns from any entity about to be serialised.
 * Applied before the admin short-circuit on purpose: an administrator is
 * entitled to every business field, not to a customer's password hash.
 */
export function stripNeverReturned<T extends Record<string, any>>(entity: T): Partial<T> {
  const safe: any = {}
  for (const [key, value] of Object.entries(entity)) {
    if (!NEVER_RETURNED.has(key)) safe[key] = value
  }
  return safe
}

export function filterEntityFields<T extends Record<string, any>>(
  entity: T,
  permissions: Record<string, string>,
  role: string
): Partial<T> {
  const entityWithoutSecrets = stripNeverReturned(entity)
  if (isAdmin(role)) return entityWithoutSecrets

  const filtered: any = {}
  for (const [key, value] of Object.entries(entityWithoutSecrets)) {
    const access = permissions[key]
    // No explicit permission → visible by default
    if (!access || access === "visible" || access === "editable") {
      filtered[key] = value
    }
    // access === "hidden" → skip field
  }
  return filtered
}

/**
 * Filter writable fields for POST/PUT requests.
 * Only "editable" fields (or fields without explicit permission) pass through.
 * Admin always writes everything.
 */
export function filterWritableFields(
  data: Record<string, any>,
  permissions: Record<string, string>,
  role: string
): Record<string, any> {
  if (isAdmin(role)) return data

  const filtered: any = {}
  for (const [key, value] of Object.entries(data)) {
    const access = permissions[key]
    if (!access || access === "editable") {
      filtered[key] = value
    }
    // "visible" or "hidden" → reject write
  }
  return filtered
}
