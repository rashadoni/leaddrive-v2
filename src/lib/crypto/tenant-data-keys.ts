/**
 * Per-organization data keys: load, create on first use, keep in memory.
 *
 * Owner decision 2026-10-22 ("вариант 3", no KMS, no Vault): each organization
 * has its own random data key, stored in `tenant_data_keys` wrapped by the
 * master key (`wrapTenantDataKey` in `tenant-pii-encryption.ts`), with
 * versions. The unwrapped keys live only in process memory
 * (`tenant-data-key-cache.ts`), for the synchronous column API.
 *
 * • `preloadTenantDataKeys(orgId)` — called where the tenant context is
 *   entered. Never throws: when the ring cannot be loaded, writes fall back to
 *   v1 and v2 reads fail loudly, and the next entry tries again after a pause.
 * • `ensureTenantDataKeys(orgId)` — for paths that must have the key (the
 *   v1 → v2 sweep, a file or credential read outside a request). Throws.
 *
 * Creation is race-safe: the first version is inserted with
 * `ON CONFLICT DO NOTHING` on (organizationId, version) and the table is read
 * back, so two processes that race both end up with the one row that won.
 * A new version is created only when the organization has no active key at
 * all; an active key wrapped by another master key is an error, never a reason
 * to mint a replacement (data written under the old one would be stranded).
 *
 * Queries run in the organization's own RLS scope, whatever the caller's
 * context: `tenant_data_keys` is under FORCE RLS like every tenant table.
 */
import { logOperationalFailure } from "@/lib/telemetry/operational-failure"
import { prisma } from "@/lib/prisma"
import { rlsStorage } from "@/lib/rls-context"
import {
  generateTenantDataKey,
  isTenantPiiMasterKeyConfigured,
  tenantDataKeyMaterial,
  tenantMasterKeyId,
  unwrapTenantDataKey,
  wrapTenantDataKey,
} from "@/lib/crypto/tenant-pii-encryption"
import {
  cachedTenantDataKeyRing,
  forgetTenantDataKeyRings,
  recordTenantDataKeyLoad,
  storeTenantDataKeyRing,
  tenantDataKeyPreloadDue,
  tenantDataKeyRingNeedsRefresh,
  TenantDataKeyUnavailableError,
  type TenantDataKeyMaterial,
  type TenantDataKeyRing,
} from "@/lib/crypto/tenant-data-key-cache"

type StoredKey = {
  version: number
  wrappedKey: string
  masterKeyId: string
  retiredAt: Date | null
}

const globalForLoads = globalThis as unknown as {
  __tenantDataKeyLoads?: Map<string, Promise<TenantDataKeyRing>>
}
const inflight: Map<string, Promise<TenantDataKeyRing>> =
  globalForLoads.__tenantDataKeyLoads ?? (globalForLoads.__tenantDataKeyLoads = new Map())

function readKeys(orgId: string): Promise<StoredKey[]> {
  return prisma.tenantDataKey.findMany({
    where: { organizationId: orgId },
    orderBy: { version: "asc" },
    select: { version: true, wrappedKey: true, masterKeyId: true, retiredAt: true },
  })
}

async function createVersion(orgId: string, version: number): Promise<void> {
  const dataKey = generateTenantDataKey()
  try {
    const wrapped = wrapTenantDataKey(orgId, version, dataKey)
    await prisma.tenantDataKey.createMany({
      data: [{ organizationId: orgId, version, wrappedKey: wrapped.wrappedKey, masterKeyId: wrapped.masterKeyId }],
      skipDuplicates: true,
    })
  } finally {
    dataKey.fill(0)
  }
}

async function loadRing(orgId: string): Promise<TenantDataKeyRing> {
  // `tenantDataKeyLoad` tells runWithTenant not to preload from inside the load.
  return rlsStorage.run({ orgId, tenantDataKeyLoad: true }, async () => {
    let rows = await readKeys(orgId)
    if (!rows.some((row) => row.retiredAt === null)) {
      await createVersion(orgId, (rows.at(-1)?.version ?? 0) + 1)
      rows = await readKeys(orgId)
    }

    const masterKeyId = tenantMasterKeyId()
    const keys = new Map<number, TenantDataKeyMaterial>()
    let current: number | null = null
    for (const row of rows) {
      if (row.masterKeyId !== masterKeyId) continue
      const dataKey = unwrapTenantDataKey(orgId, row.version, row.masterKeyId, row.wrappedKey)
      try {
        keys.set(row.version, tenantDataKeyMaterial(orgId, dataKey))
      } finally {
        dataKey.fill(0)
      }
      if (row.retiredAt === null) current = row.version
    }
    const active = rows.filter((row) => row.retiredAt === null)
    if (active.length > 0 && current !== active.at(-1)!.version) {
      throw new Error("tenant data key: the active key is wrapped by another master key")
    }
    return { loadedAt: Date.now(), current, keys }
  })
}

/**
 * Load the organization's key ring into memory (creating its first key when
 * it has none). Throws when the master key is missing, the table cannot be
 * read, or the active key cannot be unwrapped.
 */
export async function ensureTenantDataKeys(orgId: string): Promise<void> {
  if (typeof orgId !== "string" || orgId.length === 0) throw new TenantDataKeyUnavailableError()
  if (!tenantDataKeyRingNeedsRefresh(orgId)) return
  if (!isTenantPiiMasterKeyConfigured()) throw new TenantDataKeyUnavailableError()
  let load = inflight.get(orgId)
  if (!load) {
    load = loadRing(orgId).finally(() => inflight.delete(orgId))
    inflight.set(orgId, load)
  }
  try {
    storeTenantDataKeyRing(orgId, await load)
    recordTenantDataKeyLoad(orgId, false)
  } catch (error) {
    recordTenantDataKeyLoad(orgId, true)
    // A ring loaded earlier stays usable until it ages out.
    if (cachedTenantDataKeyRing(orgId)) return
    throw error
  }
}

/**
 * Best-effort load at tenant-context entry. Never throws and never blocks a
 * request on a recent failure; logs the failure kind only.
 */
export async function preloadTenantDataKeys(orgId: string): Promise<void> {
  try {
    if (typeof orgId !== "string" || orgId.length === 0) return
    if (!tenantDataKeyPreloadDue(orgId)) return
    if (!isTenantPiiMasterKeyConfigured()) return
    await ensureTenantDataKeys(orgId)
  } catch {
    logOperationalFailure("tenant-data-key-load", "warn")
  }
}

/** Tests only: a fresh process — no rings in memory, no recorded failures. */
export function resetTenantDataKeyLoadState(): void {
  forgetTenantDataKeyRings()
}
