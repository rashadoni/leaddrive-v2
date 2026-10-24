import type { Prisma } from "@prisma/client"
import { IdentityRegistryError } from "./contract.js"
import type { RegistryClient } from "./registry.js"
import { readVerifiedIdentityMobileClaims, type IdentitySessionKeyResolver } from "./mobile-session.js"
import { authorizeIdentityMobileSession, type IdentityMobileApplication, type IdentityMobileState } from "./mobile-session-contract.js"

/**
 * Fixed server policy, never body/header data. Read tenant rollout and the app's
 * actual license/settings through this transaction for a consistent snapshot.
 * No default enabled/license value and no network/provider call belongs here.
 */
export type IdentityMobileTenantPolicy = (tx: Prisma.TransactionClient, organizationId: string, application: IdentityMobileApplication) => Promise<{
  identityEnabled: boolean; licensed: boolean;
}>

async function transactionGuard(tx: Prisma.TransactionClient, organizationId: string) {
  const [guard] = await tx.$queryRaw<Array<{ now: Date; isolation: string; readOnly: string; organizationId: string; bypass: string }>>`
    SELECT clock_timestamp() AS now, current_setting('transaction_isolation') AS isolation,
      current_setting('transaction_read_only') AS "readOnly", current_setting('app.org_id', true) AS "organizationId",
      current_setting('app.rls_bypass', true) AS bypass`
  return guard?.isolation === "repeatable read" && guard.readOnly === "on" && guard.organizationId === organizationId && guard.bypass === "off" ? guard.now : null
}

/**
 * Inactive resolver, not wired to current API/middleware. Verify the actual
 * signature/profile BEFORE any tenant business query, then read fresh state
 * under READ ONLY/REPEATABLE READ with RLS bypass explicitly off. A staged
 * account or missing binding/membership can never fall back to legacy auth.
 * Writes must revalidate rights inside their own write transaction; this read
 * snapshot does not hold a privilege lock over a later business mutation.
 */
export async function resolveIdentityMobileSession(client: RegistryClient, token: string, application: IdentityMobileApplication,
  resolveKey: IdentitySessionKeyResolver, tenantPolicy: IdentityMobileTenantPolicy, serverNow = new Date()) {
  const claims = readVerifiedIdentityMobileClaims(token, application, resolveKey, serverNow)
  if (!claims) return null
  try {
    return await client.$transaction(async tx => {
      await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY")
      await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '5s'")
      await tx.$queryRaw`SELECT set_config('app.org_id', ${claims.organizationId}, true), set_config('app.rls_bypass', 'off', true)`
      if (!await transactionGuard(tx, claims.organizationId)) throw new IdentityRegistryError("IDENTITY_SESSION_CONTEXT_INVALID")
      const scope = { organizationId: claims.organizationId, userId: claims.sub }
      const appScope = { ...scope, application }
      const [company, person, account, claim, grant, membership] = await Promise.all([
        tx.organization.findFirst({ where: { id: claims.organizationId }, select: { id: true, isActive: true } }),
        tx.user.findFirst({ where: { organizationId: claims.organizationId, id: claims.sub }, select: { id: true, organizationId: true, isActive: true, anonymizedAt: true } }),
        tx.identityAccount.findUnique({ where: { organizationId_userId: scope }, select: { organizationId: true, userId: true, version: true, credentialEpoch: true, cutoverAt: true } }),
        tx.identityPhoneClaim.findUnique({ where: { organizationId_userId: scope }, select: { organizationId: true, userId: true, id: true } }),
        tx.identityApplicationGrant.findUnique({ where: { organizationId_userId_application: appScope }, select: { organizationId: true, userId: true, application: true, status: true, role: true, version: true } }),
        tx.identityApplicationMembership.findUnique({ where: { organizationId_userId_application: appScope }, select: { organizationId: true, userId: true, application: true, actorId: true, status: true, version: true } }),
      ])
      if (!company || !person || !account || !claim || !grant || !membership) return null
      const [binding, actor, policy] = await Promise.all([
        tx.identityActorBinding.findUnique({ where: { organizationId_actorId: { organizationId: claims.organizationId, actorId: membership.actorId } }, select: { organizationId: true, userId: true, actorId: true } }),
        tx.mtmAgent.findFirst({ where: { organizationId: claims.organizationId, id: membership.actorId }, select: { id: true, organizationId: true, userId: true, status: true } }),
        tenantPolicy(tx, claims.organizationId, application),
      ])
      if (!binding || !actor || grant.application !== application || membership.application !== application) return null
      const state: IdentityMobileState = { company: { ...company, identityMobileEnabled: policy.identityEnabled },
        person: { organizationId: person.organizationId, userId: person.id, isActive: person.isActive, anonymizedAt: person.anonymizedAt },
        account, claim, grant: { ...grant, application }, membership: { ...membership, application, active: membership.status === "ACTIVE" },
        binding: { ...binding, status: "REVIEWED" }, actor, license: { application, enabled: policy.licensed } }
      // End-of-read DB wall time, not a stale request timestamp or JWT clock.
      const now = await transactionGuard(tx, claims.organizationId)
      if (!now) throw new IdentityRegistryError("IDENTITY_SESSION_CONTEXT_INVALID")
      return authorizeIdentityMobileSession(claims, application, state, now)
    }, { isolationLevel: "RepeatableRead", timeout: 10_000, maxWait: 5_000 })
  } catch { return null }
}
