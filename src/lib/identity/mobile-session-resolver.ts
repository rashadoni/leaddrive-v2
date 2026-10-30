import type { Prisma } from "@prisma/client"
import { assertIdentityScope, IdentityRegistryError } from "./contract"
import type { RegistryClient } from "./registry"
import { readVerifiedIdentityMobileClaims, type IdentitySessionKeyResolver } from "./mobile-session"
import { authorizeIdentityMobileSession, type IdentityMobileApplication, type IdentityMobileState } from "./mobile-session-contract"

/** Fixed server policy; read actual rollout/license through this same transaction. */
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
/** Internal read scope, not authentication. Never return its private value from an endpoint. */
export async function withIdentityMobileReadSnapshot<T>(client: RegistryClient, organizationId: string, work: (tx: Prisma.TransactionClient) => Promise<T>) {
  assertIdentityScope(organizationId, "mobile-read")
  return client.$transaction(async tx => {
    await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY")
    await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '5s'")
    await tx.$queryRaw`SELECT set_config('app.org_id', ${organizationId}, true), set_config('app.rls_bypass', 'off', true)`
    if (!await transactionGuard(tx, organizationId)) throw new IdentityRegistryError("IDENTITY_SESSION_CONTEXT_INVALID")
    const value = await work(tx), now = await transactionGuard(tx, organizationId)
    if (!now) throw new IdentityRegistryError("IDENTITY_SESSION_CONTEXT_INVALID")
    return { value, now }
  }, { isolationLevel: "RepeatableRead", timeout: 10_000, maxWait: 5_000 })
}
/** Private data loading only; callers still need actual JWT/password authentication. */
export async function readIdentityMobileState(tx: Prisma.TransactionClient, organizationId: string, userId: string,
  application: IdentityMobileApplication, tenantPolicy: IdentityMobileTenantPolicy): Promise<IdentityMobileState | null> {
  const scope = { organizationId, userId }, appScope = { ...scope, application }
  const [company, person, account, claim, grant, membership] = await Promise.all([
    tx.organization.findFirst({ where: { id: organizationId }, select: { id: true, isActive: true } }),
    tx.user.findFirst({ where: { organizationId, id: userId }, select: { id: true, organizationId: true, isActive: true, anonymizedAt: true } }),
    tx.identityAccount.findUnique({ where: { organizationId_userId: scope }, select: { organizationId: true, userId: true, version: true, credentialEpoch: true, cutoverAt: true } }),
    tx.identityPhoneClaim.findUnique({ where: { organizationId_userId: scope }, select: { organizationId: true, userId: true, id: true } }),
    tx.identityApplicationGrant.findUnique({ where: { organizationId_userId_application: appScope }, select: { organizationId: true, userId: true, application: true, status: true, role: true, version: true } }),
    tx.identityApplicationMembership.findUnique({ where: { organizationId_userId_application: appScope }, select: { organizationId: true, userId: true, application: true, actorId: true, status: true, version: true } }),
  ])
  if (!company || !person || !account || !claim || !grant || !membership) return null
  const [binding, actor, policy] = await Promise.all([
    tx.identityActorBinding.findUnique({ where: { organizationId_actorId: { organizationId, actorId: membership.actorId } }, select: { organizationId: true, userId: true, actorId: true } }),
    tx.mtmAgent.findFirst({ where: { organizationId, id: membership.actorId }, select: { id: true, organizationId: true, userId: true, status: true, fieldDeletedAt: true } }),
    tenantPolicy(tx, organizationId, application),
  ])
  if (application === "ROUTE_FIELD" && actor?.fieldDeletedAt) return null
  if (!binding || !actor || grant.application !== application || membership.application !== application) return null
  return { company: { ...company, identityMobileEnabled: policy.identityEnabled },
    person: { organizationId: person.organizationId, userId: person.id, isActive: person.isActive, anonymizedAt: person.anonymizedAt },
    account, claim, grant: { ...grant, application }, membership: { ...membership, application, active: membership.status === "ACTIVE" },
    binding: { ...binding, status: "REVIEWED" }, actor, license: { application, enabled: policy.licensed } }
}
/**
 * Inactive resolver. Verify crypto before any business query, then load a fresh
 * scoped state snapshot. No cache/legacy fallback. Business writes must check
 * rights again inside their own write transaction; this read holds no later lock.
 */
export async function resolveIdentityMobileSession(client: RegistryClient, token: string, application: IdentityMobileApplication,
  resolveKey: IdentitySessionKeyResolver, tenantPolicy: IdentityMobileTenantPolicy, serverNow = new Date()) {
  const claims = readVerifiedIdentityMobileClaims(token, application, resolveKey, serverNow)
  if (!claims) return null
  try {
    const snapshot = await withIdentityMobileReadSnapshot(client, claims.organizationId,
      tx => readIdentityMobileState(tx, claims.organizationId, claims.sub, application, tenantPolicy))
    return snapshot.value ? authorizeIdentityMobileSession(claims, application, snapshot.value, snapshot.now) : null
  } catch { return null }
}
