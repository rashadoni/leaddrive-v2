import type { Prisma } from "@prisma/client"
import { assertIdentityScope, IdentityRegistryError } from "./contract"
import type { RegistryClient } from "./registry"
import { readLegacyCredentialBoundaryInTransaction, readLegacyCredentialMaintenanceBoundaryInTransaction, type LegacyCredentialPrincipal } from "./legacy-credential-boundary"

export type LegacyCredentialWriteResult<T> = { allowed: false } | { allowed: true; value: T }

async function assertWriteContext(tx: Prisma.TransactionClient, organizationId: string) {
  const [scope] = await tx.$queryRaw<Array<{ isolation: string; readOnly: string; organizationId: string; bypass: string }>>`
    SELECT current_setting('transaction_isolation') AS isolation, current_setting('transaction_read_only') AS "readOnly",
      current_setting('app.org_id', true) AS "organizationId", current_setting('app.rls_bypass', true) AS bypass`
  if (scope?.isolation !== "read committed" || scope.readOnly !== "off" || scope.organizationId !== organizationId || scope.bypass !== "off") {
    throw new IdentityRegistryError("IDENTITY_LEGACY_WRITE_CONTEXT_INVALID")
  }
}

/**
 * Internal credential-write fence, NOT authentication. Callers must authenticate,
 * authorize, validate the intended change and CAS the checked credential inside
 * work(tx). Use app tenant ALS around this function with the extended Prisma.
 * All canonical enrollment/cutover/claim writers must take this same tenant lock.
 * No provider/network calls or bcrypt work belong inside the bounded transaction.
 */
export async function withLegacyCredentialWrite<T>(client: RegistryClient, organizationId: string,
  principals: readonly LegacyCredentialPrincipal[], work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<LegacyCredentialWriteResult<T>> {
  return withLegacyCredentialFence(client, organizationId, principals, "SIGN_IN", work)
}

/** Maintenance fence only, never authentication/authorization. Callers retain
 * their own current admin/self-service proof, scope, credential CAS and audit.
 * Supports legitimate resets of disabled accounts without reactivating them.
 * The purpose is selected by server code; no request/body policy switch. */
export async function withLegacyCredentialMaintenance<T>(client: RegistryClient, organizationId: string,
  principals: readonly LegacyCredentialPrincipal[], work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<LegacyCredentialWriteResult<T>> {
  return withLegacyCredentialFence(client, organizationId, principals, "MAINTENANCE", work)
}

async function withLegacyCredentialFence<T>(client: RegistryClient, organizationId: string,
  principals: readonly LegacyCredentialPrincipal[], purpose: "SIGN_IN" | "MAINTENANCE",
  work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<LegacyCredentialWriteResult<T>> {
  if (!Array.isArray(principals) || principals.length < 1 || principals.length > 3) {
    throw new IdentityRegistryError("IDENTITY_LEGACY_WRITE_PRINCIPAL_INVALID")
  }
  for (const principal of principals) {
    if (!principal || typeof principal !== "object" || Array.isArray(principal) || Object.keys(principal).length !== 2
      || !Object.hasOwn(principal, "kind")) throw new IdentityRegistryError("IDENTITY_LEGACY_WRITE_PRINCIPAL_INVALID")
    const id = principal.kind === "USER" && Object.hasOwn(principal, "userId") ? principal.userId
      : principal.kind === "ACTOR" && Object.hasOwn(principal, "actorId") ? principal.actorId : null
    if (id === null) throw new IdentityRegistryError("IDENTITY_LEGACY_WRITE_PRINCIPAL_INVALID")
    assertIdentityScope(organizationId, id)
  }
  return client.$transaction(async tx => {
    await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '5s'")
    await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '3s'")
    await tx.$queryRaw`SELECT set_config('app.org_id', ${organizationId}, true), set_config('app.rls_bypass', 'off', true)`
    await assertWriteContext(tx, organizationId)
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'identity-registry:' + organizationId}, 0))`
    const [company] = await tx.$queryRaw<Array<{ id: string; isActive: boolean }>>`SELECT id, "isActive" FROM organizations WHERE id = ${organizationId} FOR SHARE`
    if (!company || (purpose === "SIGN_IN" && company.isActive !== true)) return { allowed: false } as const

    // Discover links, lock Users before actors (matching provisioning writers),
    // then verify links again under the actor locks. A racing relink refuses;
    // never extend the lock set after taking actor locks in the reverse order.
    const users = new Set<string>(), actors = new Map<string, string | null>()
    for (const principal of principals) {
      if (principal.kind === "USER") { users.add(principal.userId); continue }
      const actor = await tx.mtmAgent.findFirst({ where: { id: principal.actorId, organizationId }, select: { userId: true } })
      if (!actor) return { allowed: false } as const
      actors.set(principal.actorId, actor.userId)
      if (actor.userId) users.add(actor.userId)
      const binding = await tx.identityActorBinding.findUnique({ where: { organizationId_actorId: { organizationId, actorId: principal.actorId } }, select: { userId: true } })
      if (binding) users.add(binding.userId)
    }
    for (const userId of [...users].sort()) {
      const [user] = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM users WHERE "organizationId" = ${organizationId} AND id = ${userId} FOR SHARE`
      if (!user) return { allowed: false } as const
    }
    for (const actorId of [...actors.keys()].sort()) {
      const [actor] = await tx.$queryRaw<Array<{ userId: string | null }>>`SELECT "userId" FROM mtm_agents WHERE "organizationId" = ${organizationId} AND id = ${actorId} FOR UPDATE`
      if (!actor || actor.userId !== actors.get(actorId)) return { allowed: false } as const
    }
    const boundary = purpose === "SIGN_IN" ? readLegacyCredentialBoundaryInTransaction : readLegacyCredentialMaintenanceBoundaryInTransaction
    for (const principal of principals) {
      if (await boundary(tx, organizationId, principal) !== "LEGACY") return { allowed: false } as const
    }
    const value = await work(tx)
    await assertWriteContext(tx, organizationId) // Scope tampering must roll back the entire write.
    return { allowed: true, value } as const
  }, { isolationLevel: "ReadCommitted", timeout: 15_000, maxWait: 5_000 })
}
