/**
 * An organization's own AI provider keys (`tenant_ai_credentials`).
 *
 * The key is sealed with the organization's data key, bound to this table
 * and column; it is read back only here, only to make a call, and never
 * returned to a screen — `keyHint` (last four characters) is what a screen
 * shows. Every read and write runs in the organization's own tenant context,
 * so FORCE RLS answers for nobody else.
 */
import { prisma } from "@/lib/prisma"
import { runWithTenant } from "@/lib/rls-context"
import { decryptForTenantBound, encryptForTenantBound } from "@/lib/crypto/tenant-pii-encryption"
import type { AiProvider } from "./features"

const TABLE = "tenant_ai_credentials"
const COLUMN = "secret"

/** What one process remembers about an organization, for a minute. */
type Access = { secret: string | null; platformAllowed: boolean }
const CACHE_MS = 60_000
const cache = new Map<string, { at: number; access: Access }>()
const cacheKey = (orgId: string, provider: AiProvider) => `${orgId}|${provider}`

/**
 * The organization's key for the provider (or null) and whether it may fall
 * back to the platform's. Other processes (jobs, phone line) see a change
 * within a minute.
 */
export async function tenantAiAccess(orgId: string, provider: AiProvider, now = Date.now()): Promise<Access> {
  const hit = cache.get(cacheKey(orgId, provider))
  if (hit && now - hit.at < CACHE_MS) return hit.access
  const access = await runWithTenant(orgId, async () => {
    const [org, row] = await Promise.all([
      prisma.organization.findUnique({ where: { id: orgId }, select: { aiPlatformKey: true } }),
      prisma.tenantAiCredential.findUnique({
        where: { organizationId_provider: { organizationId: orgId, provider } },
        select: { secret: true },
      }),
    ])
    return {
      secret: row ? decryptForTenantBound(orgId, TABLE, COLUMN, row.secret) : null,
      // A missing column (an older row in a test double) reads as the default.
      platformAllowed: org?.aiPlatformKey !== false,
    }
  })
  cache.set(cacheKey(orgId, provider), { at: now, access })
  return access
}

export function forgetTenantAiAccess(orgId?: string): void {
  if (!orgId) return cache.clear()
  for (const key of cache.keys()) if (key.startsWith(`${orgId}|`)) cache.delete(key)
}

export function keyHint(secret: string): string {
  return `…${secret.trim().slice(-4)}`
}

/** Save (or replace) the organization's key for a provider. */
export async function saveTenantAiCredential(input: {
  orgId: string
  provider: AiProvider
  secret: string
  userId?: string | null
  status?: "ok" | "invalid" | "unchecked"
  lastError?: string | null
}): Promise<{ keyHint: string; status: string }> {
  const secret = input.secret.trim()
  if (!secret) throw new Error("saveTenantAiCredential: empty key")
  const status = input.status ?? "unchecked"
  const hint = keyHint(secret)
  // Sealed inside the tenant scope: entering it loads the organization's data
  // key, so the key is written under it (v2), not under the derived v1 key.
  await runWithTenant(input.orgId, () => {
    const fields = {
      secret: encryptForTenantBound(input.orgId, TABLE, COLUMN, secret),
      keyHint: hint,
      status,
      lastCheckedAt: status === "unchecked" ? null : new Date(),
      lastError: input.lastError ?? null,
    }
    return prisma.tenantAiCredential.upsert({
      where: { organizationId_provider: { organizationId: input.orgId, provider: input.provider } },
      create: { organizationId: input.orgId, provider: input.provider, createdBy: input.userId ?? null, ...fields },
      update: fields,
    })
  })
  forgetTenantAiAccess(input.orgId)
  return { keyHint: hint, status }
}

export async function deleteTenantAiCredential(orgId: string, provider: AiProvider): Promise<void> {
  await runWithTenant(orgId, () => prisma.tenantAiCredential.deleteMany({ where: { organizationId: orgId, provider } }))
  forgetTenantAiAccess(orgId)
}

/** What a settings screen may show: provider, hint and state — never the key. */
export async function listTenantAiCredentials(orgId: string) {
  return runWithTenant(orgId, () => prisma.tenantAiCredential.findMany({
    where: { organizationId: orgId },
    select: { provider: true, keyHint: true, status: true, lastCheckedAt: true, lastError: true, updatedAt: true },
    orderBy: { provider: "asc" },
  }))
}
