/**
 * Process memory for the unwrapped per-organization data keys
 * (`tenant_data_keys`, loaded by `src/lib/crypto/tenant-data-keys.ts`).
 *
 * The column API (`encryptForTenant`, `softDecryptForTenantBound`, …) is
 * synchronous and is called from 19 routes, so it cannot fetch a key. Instead
 * the key ring of an organization is loaded where the tenant context is
 * entered (`requireAuth`/`getOrgId`/`getSession`, `runWithTenant`) and read
 * from here:
 *
 *   • a write uses the ring's current version when the ring is here (v2), and
 *     the HKDF-derived key otherwise (v1) — a write never fails for want of it;
 *   • a read of a v2 value without the ring throws
 *     `TenantDataKeyUnavailableError`. It never hands the stored string back as
 *     if it were plaintext: a route that saved that "plaintext" again would
 *     destroy the value.
 *
 * A ring is refreshed after `TENANT_DATA_KEY_REFRESH_MS` and dropped from use
 * after `TENANT_DATA_KEY_USABLE_MS`, so a request that loaded it keeps working
 * while it runs, and a key removed from the table leaves memory within twenty
 * minutes.
 *
 * Next standalone copies a module into every route chunk that imports it (the
 * 2026-06-11 incident in `rls-context.ts`): the rings live on `globalThis`, so
 * the chunk that loads a ring and the chunk that encrypts see the same one.
 */

export const TENANT_DATA_KEY_REFRESH_MS = 10 * 60_000
export const TENANT_DATA_KEY_USABLE_MS = 20 * 60_000

/** The keys one stored data key yields; neither ever leaves the process. */
export type TenantDataKeyMaterial = {
  /** AES-256-GCM key for PII column values (`v2:<version>:…`). */
  column: Buffer
  /** Tenant key for file envelopes with key id `d<version>`. */
  file: Buffer
}

export type TenantDataKeyRing = {
  loadedAt: number
  /** Version new values are written under; null when none is usable. */
  current: number | null
  keys: Map<number, TenantDataKeyMaterial>
}

/** Stable, non-sensitive: the organization's data key is not in this process. */
export class TenantDataKeyUnavailableError extends Error {
  readonly code = "TENANT_DATA_KEY_UNAVAILABLE"
  constructor() {
    super("TENANT_DATA_KEY_UNAVAILABLE")
    this.name = "TenantDataKeyUnavailableError"
  }
}

const globalForKeys = globalThis as unknown as { __tenantDataKeyRings?: Map<string, TenantDataKeyRing> }
const rings: Map<string, TenantDataKeyRing> =
  globalForKeys.__tenantDataKeyRings ?? (globalForKeys.__tenantDataKeyRings = new Map())

/** The organization's ring while it may still be used, else null. */
export function cachedTenantDataKeyRing(orgId: string, now = Date.now()): TenantDataKeyRing | null {
  const ring = rings.get(orgId)
  if (!ring) return null
  if (now - ring.loadedAt >= TENANT_DATA_KEY_USABLE_MS) {
    rings.delete(orgId)
    return null
  }
  return ring
}

/** True when the organization's ring is missing or due for a reload. */
export function tenantDataKeyRingNeedsRefresh(orgId: string, now = Date.now()): boolean {
  const ring = rings.get(orgId)
  return !ring || now - ring.loadedAt >= TENANT_DATA_KEY_REFRESH_MS
}

export function storeTenantDataKeyRing(orgId: string, ring: TenantDataKeyRing): void {
  rings.set(orgId, ring)
}

/** A value names a version this ring has not seen (written after it loaded): reload on next entry. */
export function markTenantDataKeyRingStale(orgId: string): void {
  const ring = rings.get(orgId)
  if (ring) ring.loadedAt = Math.min(ring.loadedAt, Date.now() - TENANT_DATA_KEY_REFRESH_MS)
}

/**
 * The key material of one version for a read. Throws when the ring is not in
 * this process or predates the version; null when the ring is current and the
 * version is not in it (a key that no longer exists).
 */
export function tenantDataKeyForRead(orgId: string, version: number): TenantDataKeyMaterial | null {
  const ring = cachedTenantDataKeyRing(orgId)
  if (!ring) throw new TenantDataKeyUnavailableError()
  const material = ring.keys.get(version)
  if (material) return material
  const newest = Math.max(0, ...ring.keys.keys())
  if (version > newest) {
    markTenantDataKeyRingStale(orgId)
    throw new TenantDataKeyUnavailableError()
  }
  return null
}

/** Current version and its key material for a write, or null (write v1). */
export function currentTenantDataKey(orgId: string): { version: number; material: TenantDataKeyMaterial } | null {
  if (typeof orgId !== "string" || orgId.length === 0) return null
  const ring = cachedTenantDataKeyRing(orgId)
  if (!ring || ring.current === null) return null
  const material = ring.keys.get(ring.current)
  return material ? { version: ring.current, material } : null
}

/** Tests only: forget one organization's ring, or all of them. */
export function forgetTenantDataKeyRings(orgId?: string): void {
  if (orgId === undefined) rings.clear()
  else rings.delete(orgId)
}
