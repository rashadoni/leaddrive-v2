import type { Prisma } from "@prisma/client"
import { assertIdentityScope, IdentityRegistryError } from "./contract"
import { parseIdentityCrmClaims, readIdentityCrmAuthorityInTransaction, type IdentityCrmClaims } from "./crm-session"
import type { RegistryClient } from "./registry"

/** Internal server context after Auth.js cookie verification and MFA. Never
 * deserialize this value from an HTTP body or expose it in a public session. */
export type IdentityAdministrator = {
  organizationId: string; userId: string;
} & ({ mode: "LEGACY" } | { mode: "CANONICAL"; claims: IdentityCrmClaims })

/** Recheck authority before replay as well as mutation. The common tenant fence
 * orders grant/claim writers; row locks also serialize direct revocation and
 * person lifecycle changes. No network call or password hashing inside work. */
export async function withIdentityAdministrator<T>(client: RegistryClient, actor: IdentityAdministrator,
  work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return client.$transaction(tx => withIdentityAdministratorInTransaction(tx, actor, work),
    { isolationLevel: "ReadCommitted", timeout: 15_000, maxWait: 5_000 })
}

/** Reuses an existing transaction for atomic person/card/grant/HR operations.
 * It performs the same tenant fence and fresh administrator checks, including
 * before replay; callers cannot substitute a body-provided administrator. */
export async function withIdentityAdministratorInTransaction<T>(tx: Prisma.TransactionClient, actor: IdentityAdministrator,
  work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  assertIdentityScope(actor.organizationId, actor.userId)
  if (actor.mode !== "LEGACY" && actor.mode !== "CANONICAL") throw new IdentityRegistryError("IDENTITY_ADMIN_REQUIRED")
  const hint = actor.mode === "CANONICAL" ? parseIdentityCrmClaims(actor.claims) : null
  if (actor.mode === "CANONICAL" && (!hint || hint.organizationId !== actor.organizationId || hint.userId !== actor.userId)) {
    throw new IdentityRegistryError("IDENTITY_ADMIN_REQUIRED")
  }
  await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '5s'")
  await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '3s'")
  await tx.$queryRaw`SELECT set_config('app.org_id', ${actor.organizationId}, true), set_config('app.rls_bypass', 'off', true)`
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'identity-registry:' + actor.organizationId}, 0))`
  const [company] = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM organizations WHERE id=${actor.organizationId} AND "isActive" FOR SHARE`
  const [person] = await tx.$queryRaw<Array<{ role: string }>>`SELECT role FROM users WHERE "organizationId"=${actor.organizationId} AND id=${actor.userId} AND "isActive" AND "anonymizedAt" IS NULL FOR SHARE`
  if (!company || !person) throw new IdentityRegistryError("IDENTITY_ADMIN_REQUIRED")
  const [account] = await tx.$queryRaw<Array<{ cutoverAt: Date | null }>>`SELECT "cutoverAt" FROM identity_accounts WHERE "organizationId"=${actor.organizationId} AND "userId"=${actor.userId} FOR SHARE`
  if (actor.mode === "LEGACY") {
    if (account?.cutoverAt || !["admin", "superadmin"].includes(person.role)) throw new IdentityRegistryError("IDENTITY_ADMIN_REQUIRED")
  } else {
    await tx.$queryRaw`SELECT id FROM identity_phone_claims WHERE "organizationId"=${actor.organizationId} AND "userId"=${actor.userId} FOR SHARE`
    await tx.$queryRaw`SELECT version FROM identity_application_grants WHERE "organizationId"=${actor.organizationId} AND "userId"=${actor.userId} AND application='CRM' FOR SHARE`
    const current = await readIdentityCrmAuthorityInTransaction(tx, actor.organizationId, actor.userId)
    if (!current || current.role !== "admin" || !hint || current.claims.claimId !== hint.claimId
      || current.claims.credentialEpoch !== hint.credentialEpoch || current.claims.grantVersion !== hint.grantVersion) {
      throw new IdentityRegistryError("IDENTITY_ADMIN_REQUIRED")
    }
  }
  return work(tx)
}
