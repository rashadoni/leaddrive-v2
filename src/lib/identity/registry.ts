import { createHash, randomUUID } from "node:crypto"
import type { Prisma, PrismaClient } from "@prisma/client"
import { assertIdentityRequestId, assertIdentityScope, compareIdentityShadow, IdentityRegistryError, type IdentityApplication, type IdentityGrantStatus } from "./contract.js"

type RegistryClient = Pick<PrismaClient, "$transaction">
export type IdentityActor = { organizationId: string; userId: string }

/** Callers derive actor from authenticated server context, never a request body. */
async function withRegistryTransaction<T>(client: RegistryClient, actor: IdentityActor, readOnly: boolean, work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  assertIdentityScope(actor.organizationId, actor.userId)
  return client.$transaction(async tx => {
    if (readOnly) await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY")
    await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '5s'")
    await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '3s'")
    await tx.$queryRaw`SELECT set_config('app.org_id', ${actor.organizationId}, true), set_config('app.rls_bypass', 'off', true)`
    if (!readOnly) {
      // One fixed lock order across all future claim/account writers: tenant first.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'identity-registry:' + actor.organizationId}, 0))`
    }
    const principal = await tx.user.findFirst({ where: { organizationId: actor.organizationId, id: actor.userId, isActive: true, anonymizedAt: null }, select: { role: true } })
    const company = await tx.organization.findFirst({ where: { id: actor.organizationId, isActive: true }, select: { id: true } })
    if (!company || !principal || !["admin", "superadmin"].includes(principal.role)) throw new IdentityRegistryError("IDENTITY_ADMIN_REQUIRED")
    return work(tx)
  }, { isolationLevel: readOnly ? "RepeatableRead" : "ReadCommitted", timeout: 15_000, maxWait: 5_000 })
}

/**
 * Explicit staging of an existing User, not registration or activation.
 * Never copies credentials/phone, creates an actor, or enables an application.
 * No HTTP/login path calls this additive service in stage 1.
 */
export async function stageIdentityAccount(client: RegistryClient, actor: IdentityActor, input: { userId: string; requestId: string }) {
  assertIdentityScope(actor.organizationId, input.userId)
  assertIdentityRequestId(input.requestId)
  const requestHash = createHash("sha256").update(JSON.stringify([1, "ACCOUNT_STAGED", actor.organizationId, actor.userId, input.userId])).digest("hex")
  return withRegistryTransaction(client, actor, false, async tx => {
    const event = await tx.identityEvent.findUnique({ where: { organizationId_requestId: { organizationId: actor.organizationId, requestId: input.requestId } }, select: { requestHash: true, accountVersion: true } })
    if (event) {
      if (event.requestHash !== requestHash) throw new IdentityRegistryError("IDENTITY_REQUEST_REUSED")
      return { status: "STAGED" as const, accountVersion: event.accountVersion, replayed: true, authenticationChanged: false as const }
    }
    const user = await tx.user.findFirst({ where: { organizationId: actor.organizationId, id: input.userId, isActive: true, anonymizedAt: null }, select: { id: true } })
    if (!user) throw new IdentityRegistryError("IDENTITY_SUBJECT_UNAVAILABLE")
    const agents = await tx.mtmAgent.findMany({ where: { organizationId: actor.organizationId, userId: user.id }, select: { id: true }, take: 2 })
    if (agents.length > 1) throw new IdentityRegistryError("IDENTITY_LEGACY_LINK_AMBIGUOUS")
    const key = { organizationId: actor.organizationId, userId: user.id }
    const existing = await tx.identityAccount.findUnique({ where: { organizationId_userId: key }, select: { version: true, cutoverAt: true } })
    if (existing?.cutoverAt) throw new IdentityRegistryError("IDENTITY_ALREADY_AUTHORITATIVE")
    const account = existing ?? await tx.identityAccount.create({ data: key, select: { version: true } })
    await tx.identityEvent.create({ data: { id: randomUUID(), ...key, actorUserId: actor.userId, requestId: input.requestId, requestHash, action: "ACCOUNT_STAGED", accountVersion: account.version } })
    return { status: "STAGED" as const, accountVersion: account.version, replayed: false, authenticationChanged: false as const }
  })
}

/** Consistent private comparison; its result is never an authorization decision. */
export async function readIdentityShadow(client: RegistryClient, actor: IdentityActor, userId: string) {
  assertIdentityScope(actor.organizationId, userId)
  return withRegistryTransaction(client, actor, true, async tx => {
    const user = await tx.user.findFirst({ where: { organizationId: actor.organizationId, id: userId, isActive: true, anonymizedAt: null }, select: { phone: true } })
    if (!user) throw new IdentityRegistryError("IDENTITY_SUBJECT_UNAVAILABLE")
    const account = await tx.identityAccount.findUnique({ where: { organizationId_userId: { organizationId: actor.organizationId, userId } }, select: {
      version: true, phoneClaim: { select: { normalizedPhone: true } }, grants: { select: { application: true, status: true, role: true, version: true } },
    } })
    const agents = await tx.mtmAgent.findMany({ where: { organizationId: actor.organizationId, userId }, select: { phone: true }, take: 2 })
    return compareIdentityShadow({ account, canonicalPhone: account?.phoneClaim?.normalizedPhone ?? null, userPhone: user.phone,
      agentPhones: agents.map(agent => agent.phone), grants: (account?.grants ?? []).map(grant => ({ ...grant, application: grant.application as IdentityApplication, status: grant.status as IdentityGrantStatus })) })
  })
}
