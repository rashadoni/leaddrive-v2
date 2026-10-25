import { createHash, randomUUID } from "node:crypto"
import type { Prisma, PrismaClient } from "@prisma/client"
import { withIdentityAdministrator, type IdentityAdministrator } from "./administrator"
import { assertIdentityRequestId, assertIdentityScope, assertStagedApplicationGrant, assertStagedPhoneReservation, compareIdentityShadow, IdentityRegistryError, type IdentityApplication, type IdentityGrantStatus, type StagedApplicationGrantInput, type StagedPhoneReservationInput } from "./contract"

export type RegistryClient = Pick<PrismaClient, "$transaction">
export type IdentityActor = { organizationId: string; userId: string }

/** Callers derive actor from authenticated server context, never a request body. */
export async function withRegistryTransaction<T>(client: RegistryClient, actor: IdentityActor, readOnly: boolean, work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
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
    const principal = readOnly
      ? await tx.user.findFirst({ where: { organizationId: actor.organizationId, id: actor.userId, isActive: true, anonymizedAt: null }, select: { role: true } })
      : (await tx.$queryRaw<Array<{ role: string }>>`SELECT role FROM users WHERE "organizationId" = ${actor.organizationId} AND id = ${actor.userId} AND "isActive" AND "anonymizedAt" IS NULL FOR SHARE`)[0]
    const company = readOnly
      ? await tx.organization.findFirst({ where: { id: actor.organizationId, isActive: true }, select: { id: true } })
      : (await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM organizations WHERE id = ${actor.organizationId} AND "isActive" FOR SHARE`)[0]
    if (!company || !principal || !["admin", "superadmin"].includes(principal.role)) throw new IdentityRegistryError("IDENTITY_ADMIN_REQUIRED")
    const issuerAccount = await tx.identityAccount.findUnique({
      where: { organizationId_userId: { organizationId: actor.organizationId, userId: actor.userId } }, select: { cutoverAt: true },
    })
    // The staged API only knows a legacy server principal. A converted admin
    // needs a future CRM grant/session epoch contract; old User.role is not it.
    if (issuerAccount && issuerAccount.cutoverAt !== null) throw new IdentityRegistryError("IDENTITY_CANONICAL_ADMIN_CONTEXT_REQUIRED")
    return work(tx)
  }, { isolationLevel: readOnly ? "RepeatableRead" : "ReadCommitted", timeout: 15_000, maxWait: 5_000 })
}

/**
 * Explicit staging of an existing User, not registration or activation.
 * Never copies credentials/phone, creates an actor, or enables an application.
 * No HTTP/login path calls this additive service in stage 1.
 */
export async function stageIdentityAccount(client: RegistryClient, actor: IdentityActor, input: { userId: string; requestId: string }) {
  return stageAccount(client, actor, input)
}
export async function stageIdentityAccountByAdministrator(client: RegistryClient, actor: IdentityAdministrator, input: { userId: string; requestId: string }) {
  return stageAccount(client, actor, input, actor)
}
async function stageAccount(client: RegistryClient, actor: IdentityActor, input: { userId: string; requestId: string }, administrator?: IdentityAdministrator) {
  assertIdentityScope(actor.organizationId, input.userId)
  assertIdentityRequestId(input.requestId)
  const requestHash = createHash("sha256").update(JSON.stringify([1, "ACCOUNT_STAGED", actor.organizationId, actor.userId, input.userId])).digest("hex")
  const work = async (tx: Prisma.TransactionClient) => {
    const event = await tx.identityEvent.findUnique({ where: { organizationId_requestId: { organizationId: actor.organizationId, requestId: input.requestId } }, select: { requestHash: true, accountVersion: true } })
    if (event) {
      if (event.requestHash !== requestHash) throw new IdentityRegistryError("IDENTITY_REQUEST_REUSED")
      return { status: "STAGED" as const, accountVersion: event.accountVersion, replayed: true, authenticationChanged: false as const }
    }
    const [user] = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM users WHERE "organizationId" = ${actor.organizationId} AND id = ${input.userId} AND "isActive" AND "anonymizedAt" IS NULL FOR SHARE`
    if (!user) throw new IdentityRegistryError("IDENTITY_SUBJECT_UNAVAILABLE")
    const agents = await tx.mtmAgent.findMany({ where: { organizationId: actor.organizationId, userId: user.id }, select: { id: true }, take: 2 })
    if (agents.length > 1) throw new IdentityRegistryError("IDENTITY_LEGACY_LINK_AMBIGUOUS")
    const key = { organizationId: actor.organizationId, userId: user.id }
    const existing = await tx.identityAccount.findUnique({ where: { organizationId_userId: key }, select: { version: true, cutoverAt: true } })
    if (existing?.cutoverAt) throw new IdentityRegistryError("IDENTITY_ALREADY_AUTHORITATIVE")
    const account = existing ?? await tx.identityAccount.create({ data: key, select: { version: true } })
    await tx.identityEvent.create({ data: { id: randomUUID(), ...key, actorUserId: actor.userId, requestId: input.requestId, requestHash, action: "ACCOUNT_STAGED", accountVersion: account.version } })
    return { status: "STAGED" as const, accountVersion: account.version, replayed: false, authenticationChanged: false as const }
  }
  return administrator ? withIdentityAdministrator(client, administrator, work) : withRegistryTransaction(client, actor, false, work)
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

/**
 * Reconciliation plan for an already staged User. Cannot mutate an account
 * after cutover and never activates current CRM/mobile access. Live activation
 * will additionally require tenant entitlement, membership and auth rollout.
 */
export async function planStagedApplicationGrant(client: RegistryClient, actor: IdentityActor, input: StagedApplicationGrantInput) {
  assertIdentityScope(actor.organizationId, input.userId)
  assertStagedApplicationGrant(input)
  const requestHash = createHash("sha256").update(JSON.stringify([1, "GRANT_CHANGED", actor.organizationId, actor.userId,
    input.userId, input.application, input.status, input.role, input.expectedAccountVersion, input.expectedGrantVersion])).digest("hex")
  return withRegistryTransaction(client, actor, false, async tx => {
    const event = await tx.identityEvent.findUnique({ where: { organizationId_requestId: { organizationId: actor.organizationId, requestId: input.requestId } },
      select: { requestHash: true, accountVersion: true, action: true, grantVersion: true } })
    if (event) {
      if (event.requestHash !== requestHash || event.action !== "GRANT_CHANGED" || event.grantVersion === null) throw new IdentityRegistryError("IDENTITY_REQUEST_REUSED")
      return { mode: "SHADOW" as const, accountVersion: event.accountVersion, grantVersion: event.grantVersion, replayed: true, authenticationChanged: false as const }
    }
    const [user] = await tx.$queryRaw<Array<{ id: string; role: string }>>`SELECT id, role FROM users WHERE "organizationId" = ${actor.organizationId} AND id = ${input.userId} AND "isActive" AND "anonymizedAt" IS NULL FOR SHARE`
    if (!user) throw new IdentityRegistryError("IDENTITY_SUBJECT_UNAVAILABLE")
    if (input.application === "CRM" && input.status === "ACTIVE" && input.role !== user.role) throw new IdentityRegistryError("IDENTITY_CRM_ROLE_CHANGE_FORBIDDEN")
    const accountKey = { organizationId: actor.organizationId, userId: input.userId }
    const account = await tx.identityAccount.findUnique({ where: { organizationId_userId: accountKey }, select: { version: true, cutoverAt: true } })
    if (!account) throw new IdentityRegistryError("IDENTITY_STAGE_REQUIRED")
    if (account.cutoverAt) throw new IdentityRegistryError("IDENTITY_ALREADY_AUTHORITATIVE")
    if (account.version !== input.expectedAccountVersion) throw new IdentityRegistryError("IDENTITY_ACCOUNT_STALE")
    const grantKey = { ...accountKey, application: input.application }
    const current = await tx.identityApplicationGrant.findUnique({ where: { organizationId_userId_application: grantKey }, select: { version: true, role: true } })
    if ((current?.version ?? 0) !== input.expectedGrantVersion) throw new IdentityRegistryError("IDENTITY_GRANT_STALE")
    const role = input.status === "REVOKED" ? current?.role ?? input.role : input.role
    const grant = current
      ? await tx.identityApplicationGrant.update({ where: { organizationId_userId_application: grantKey }, data: { status: input.status, role, version: { increment: 1 } }, select: { version: true } })
      : await tx.identityApplicationGrant.create({ data: { ...grantKey, status: input.status, role }, select: { version: true } })
    const changed = await tx.identityAccount.updateMany({ where: { ...accountKey, version: input.expectedAccountVersion, cutoverAt: null }, data: { version: { increment: 1 } } })
    if (changed.count !== 1) throw new IdentityRegistryError("IDENTITY_ACCOUNT_STALE")
    const version = input.expectedAccountVersion + 1
    await tx.identityEvent.create({ data: { id: randomUUID(), ...accountKey, actorUserId: actor.userId, requestId: input.requestId, requestHash,
      action: "GRANT_CHANGED", accountVersion: version, application: input.application, grantStatus: input.status, grantRole: role, grantVersion: grant.version } })
    return { mode: "SHADOW" as const, accountVersion: version, grantVersion: grant.version, replayed: false, authenticationChanged: false as const }
  })
}

/**
 * Fixed ten-minute preparation for future proof-of-possession enrollment.
 * No endpoint calls it yet. In particular, it does not issue/accept an OTP,
 * confirm a phone, replace a legacy phone/password, or activate an app.
 * Future confirmation must lock and revalidate this same tenant and versions.
 */
export async function reserveStagedIdentityPhone(client: RegistryClient, actor: IdentityActor, input: StagedPhoneReservationInput) {
  return reservePhone(client, actor, input)
}
export async function reserveIdentityPhoneByAdministrator(client: RegistryClient, actor: IdentityAdministrator, input: StagedPhoneReservationInput) {
  return reservePhone(client, actor, input, actor)
}
async function reservePhone(client: RegistryClient, actor: IdentityActor, input: StagedPhoneReservationInput, administrator?: IdentityAdministrator) {
  assertIdentityScope(actor.organizationId, input.userId)
  const normalizedPhone = assertStagedPhoneReservation(input)
  const requestHash = createHash("sha256").update(JSON.stringify([1, "PHONE_RESERVED", actor.organizationId, actor.userId,
    input.userId, normalizedPhone, input.expectedAccountVersion, input.expectedCredentialEpoch])).digest("hex")
  const work = async (tx: Prisma.TransactionClient) => {
    const [user] = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM users WHERE "organizationId" = ${actor.organizationId} AND id = ${input.userId} AND "isActive" AND "anonymizedAt" IS NULL FOR SHARE`
    if (!user) throw new IdentityRegistryError("IDENTITY_SUBJECT_UNAVAILABLE")
    const accountKey = { organizationId: actor.organizationId, userId: input.userId }
    const account = await tx.identityAccount.findUnique({ where: { organizationId_userId: accountKey }, select: { version: true, credentialEpoch: true, cutoverAt: true } })
    if (!account) throw new IdentityRegistryError("IDENTITY_STAGE_REQUIRED")
    if (account.cutoverAt) throw new IdentityRegistryError("IDENTITY_ALREADY_AUTHORITATIVE")
    // Use the database's current wall clock after the tenant lock, never client time.
    const [clock] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`
    const now = clock.now
    const event = await tx.identityEvent.findUnique({ where: { organizationId_requestId: { organizationId: actor.organizationId, requestId: input.requestId } },
      select: { action: true, requestHash: true, accountVersion: true, reservationId: true, reservationExpiresAt: true } })
    if (event) {
      if (event.action !== "PHONE_RESERVED" || event.requestHash !== requestHash || !event.reservationId || !event.reservationExpiresAt) throw new IdentityRegistryError("IDENTITY_REQUEST_REUSED")
      const current = await tx.identityPhoneReservation.findFirst({ where: { ...accountKey, id: event.reservationId }, select: { expiresAt: true, normalizedPhone: true, expectedAccountVersion: true, expectedCredentialEpoch: true } })
      const status = event.reservationExpiresAt <= now || (current && current.expiresAt <= now) ? "EXPIRED" as const : !current ? "SUPERSEDED" as const
        : account.version !== input.expectedAccountVersion || account.credentialEpoch !== input.expectedCredentialEpoch
          || current.normalizedPhone !== normalizedPhone || current.expectedAccountVersion !== input.expectedAccountVersion || current.expectedCredentialEpoch !== input.expectedCredentialEpoch ? "STALE" as const : "RESERVED" as const
      return { mode: "SHADOW" as const, status, reservationId: event.reservationId, expiresAt: event.reservationExpiresAt.toISOString(), replayed: true, authenticationChanged: false as const }
    }
    if (account.version !== input.expectedAccountVersion) throw new IdentityRegistryError("IDENTITY_ACCOUNT_STALE")
    if (account.credentialEpoch !== input.expectedCredentialEpoch) throw new IdentityRegistryError("IDENTITY_CREDENTIAL_STALE")
    const claim = await tx.identityPhoneClaim.findUnique({ where: { organizationId_normalizedPhone: { organizationId: actor.organizationId, normalizedPhone } }, select: { id: true } })
    if (claim) throw new IdentityRegistryError("IDENTITY_PHONE_UNAVAILABLE")
    const actors = await tx.mtmAgent.findMany({ where: { organizationId: actor.organizationId, userId: user.id }, select: { id: true }, take: 2 })
    if (actors.length > 1) throw new IdentityRegistryError("IDENTITY_LEGACY_LINK_AMBIGUOUS")
    // Only expired rows blocking this person or number are cleaned; immutable
    // receipts retain their original deadline. Replaying an old request cannot renew it.
    await tx.identityPhoneReservation.deleteMany({ where: { organizationId: actor.organizationId, expiresAt: { lte: now }, OR: [{ userId: input.userId }, { normalizedPhone }] } })
    const busy = await tx.identityPhoneReservation.findFirst({ where: { organizationId: actor.organizationId, OR: [{ userId: input.userId }, { normalizedPhone }] }, select: { id: true } })
    if (busy) throw new IdentityRegistryError("IDENTITY_PHONE_RESERVATION_BUSY")
    const expiresAt = new Date(now.valueOf() + 600_000), id = randomUUID()
    await tx.identityPhoneReservation.create({ data: { id, ...accountKey, normalizedPhone, expectedAccountVersion: account.version,
      expectedCredentialEpoch: account.credentialEpoch, requestId: input.requestId, createdAt: now, expiresAt } })
    await tx.identityEvent.create({ data: { id: randomUUID(), ...accountKey, actorUserId: actor.userId, requestId: input.requestId,
      requestHash, action: "PHONE_RESERVED", accountVersion: account.version, normalizedPhone, reservationId: id, reservationExpiresAt: expiresAt, createdAt: now } })
    return { mode: "SHADOW" as const, status: "RESERVED" as const, reservationId: id, expiresAt: expiresAt.toISOString(), replayed: false, authenticationChanged: false as const }
  }
  return administrator ? withIdentityAdministrator(client, administrator, work) : withRegistryTransaction(client, actor, false, work)
}
