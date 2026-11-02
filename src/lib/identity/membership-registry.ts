import { createHash, randomUUID } from "node:crypto"
import type { Prisma } from "@prisma/client"
import { assertIdentityRequestId, assertIdentityScope, assertStagedApplicationGrant, IdentityRegistryError } from "./contract"
import { withIdentityAdministrator, withIdentityAdministratorInTransaction, type IdentityAdministrator } from "./administrator"
import { withRegistryTransaction, type IdentityActor, type RegistryClient } from "./registry"
import type { IdentityMobileApplication } from "./mobile-session-contract"

export type StagedActorReview = { userId: string; actorId: string; expectedAccountVersion: number; reviewReference: string; requestId: string }
export type StagedMembershipPlan = { userId: string; actorId: string; application: IdentityMobileApplication; status: "ACTIVE" | "REVOKED";
  expectedAccountVersion: number; expectedMembershipVersion: number; expectedGrantVersion: number; requestId: string }
const metadata = { mode: "SHADOW" as const, authenticationChanged: false as const }
const digest = (value: unknown[]) => createHash("sha256").update(JSON.stringify(value)).digest("hex")
const revision = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value > 0 && value <= 2_147_483_647
function exact(input: object, names: string[]) {
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).length !== names.length || names.some(name => !Object.hasOwn(input, name))) throw new IdentityRegistryError("IDENTITY_MEMBERSHIP_INPUT_INVALID")
}
async function subject(tx: Prisma.TransactionClient, organizationId: string, userId: string, requireActive: boolean) {
  const [user] = await tx.$queryRaw<Array<{ id: string; isActive: boolean; anonymizedAt: Date | null }>>`SELECT id, "isActive", "anonymizedAt" FROM users WHERE "organizationId" = ${organizationId} AND id = ${userId} FOR SHARE`
  if (!user || (requireActive && (!user.isActive || user.anonymizedAt))) throw new IdentityRegistryError("IDENTITY_SUBJECT_UNAVAILABLE")
  const account = await tx.identityAccount.findUnique({ where: { organizationId_userId: { organizationId, userId } }, select: { version: true, cutoverAt: true } })
  if (!account) throw new IdentityRegistryError("IDENTITY_STAGE_REQUIRED")
  if (account.cutoverAt) throw new IdentityRegistryError("IDENTITY_ALREADY_AUTHORITATIVE")
  return account
}
async function ownedActor(tx: Prisma.TransactionClient, organizationId: string, userId: string, actorId: string) {
  const [actor] = await tx.$queryRaw<Array<{ id: string; userId: string | null; status: string }>>`SELECT id, "userId", status FROM mtm_agents WHERE "organizationId" = ${organizationId} AND id = ${actorId} FOR SHARE`
  if (!actor || actor.userId !== userId || actor.status !== "ACTIVE") throw new IdentityRegistryError("IDENTITY_ACTOR_UNAVAILABLE")
  const links = await tx.mtmAgent.findMany({ where: { organizationId, userId }, select: { id: true }, take: 2 })
  if (links.length !== 1 || links[0].id !== actorId) throw new IdentityRegistryError("IDENTITY_LEGACY_LINK_AMBIGUOUS")
}
async function advance(tx: Prisma.TransactionClient, organizationId: string, userId: string, version: number) {
  if (version >= 2_147_483_647) throw new IdentityRegistryError("IDENTITY_VERSION_EXHAUSTED")
  const changed = await tx.identityAccount.updateMany({ where: { organizationId, userId, version, cutoverAt: null }, data: { version: version + 1 } })
  if (changed.count !== 1) throw new IdentityRegistryError("IDENTITY_ACCOUNT_STALE")
  return version + 1
}

/**
 * Explicit administrator reconciliation decision, not phone matching or an
 * automatic enrollment side effect. The server must show the reviewed actor/
 * person and bind reviewReference to that decision before calling this service.
 * Ownership is permanent; correction/replacement needs separate reconciliation,
 * never reassignment of an old actor/history/queue to another person.
 */
export async function reviewStagedIdentityActor(client: RegistryClient, actor: IdentityActor, input: StagedActorReview) {
  return reviewActor(client, actor, input)
}
export async function reviewIdentityActorByAdministrator(client: RegistryClient, actor: IdentityAdministrator, input: StagedActorReview) {
  return reviewActor(client, actor, input, actor)
}
async function reviewActor(client: RegistryClient, actor: IdentityActor, input: StagedActorReview, administrator?: IdentityAdministrator) {
  const work = reviewActorWork(actor, input)
  return administrator ? withIdentityAdministrator(client, administrator, work) : withRegistryTransaction(client, actor, false, work)
}
export async function reviewIdentityActorInTransaction(tx: Prisma.TransactionClient, actor: IdentityAdministrator, input: StagedActorReview) {
  return withIdentityAdministratorInTransaction(tx, actor, reviewActorWork(actor, input))
}
function reviewActorWork(actor: IdentityActor, input: StagedActorReview) {
  exact(input, ["userId", "actorId", "expectedAccountVersion", "reviewReference", "requestId"])
  assertIdentityScope(actor.organizationId, input.userId)
  for (const id of [input.actorId, input.reviewReference, input.requestId]) assertIdentityRequestId(id)
  if (!revision(input.expectedAccountVersion)) throw new IdentityRegistryError("IDENTITY_MEMBERSHIP_INPUT_INVALID")
  const requestHash = digest([1, "ACTOR_BINDING_REVIEWED", actor.organizationId, actor.userId, input.userId, input.actorId, input.expectedAccountVersion, input.reviewReference])
  return async (tx: Prisma.TransactionClient) => {
    const previous = await tx.identityEvent.findUnique({ where: { organizationId_requestId: { organizationId: actor.organizationId, requestId: input.requestId } } })
    if (previous) {
      if (previous.action !== "ACTOR_BINDING_REVIEWED" || previous.requestHash !== requestHash) throw new IdentityRegistryError("IDENTITY_REQUEST_REUSED")
      return { ...metadata, status: "REVIEWED" as const, actorId: input.actorId, accountVersion: previous.accountVersion, replayed: true }
    }
    const account = await subject(tx, actor.organizationId, input.userId, true)
    if (account.version !== input.expectedAccountVersion) throw new IdentityRegistryError("IDENTITY_ACCOUNT_STALE")
    const existing = await tx.identityActorBinding.findUnique({ where: { organizationId_actorId: { organizationId: actor.organizationId, actorId: input.actorId } } })
    if (existing) throw new IdentityRegistryError(existing.userId === input.userId ? "IDENTITY_ACTOR_ALREADY_REVIEWED" : "IDENTITY_ACTOR_BINDING_CONFLICT")
    await ownedActor(tx, actor.organizationId, input.userId, input.actorId)
    const accountVersion = await advance(tx, actor.organizationId, input.userId, account.version)
    const now = (await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`)[0].now
    await tx.identityActorBinding.create({ data: { organizationId: actor.organizationId, userId: input.userId, actorId: input.actorId,
      reviewedByUserId: actor.userId, reviewReference: input.reviewReference, accountVersion, reviewedAt: now, createdAt: now } })
    await tx.identityEvent.create({ data: { id: randomUUID(), organizationId: actor.organizationId, userId: input.userId, actorUserId: actor.userId,
      requestId: input.requestId, requestHash, action: "ACTOR_BINDING_REVIEWED", accountVersion, actorId: input.actorId, reviewReference: input.reviewReference, createdAt: now } })
    return { ...metadata, status: "REVIEWED" as const, actorId: input.actorId, accountVersion, replayed: false }
  }
}

/** Inactive mobile membership plan, never a grant/license or current HR enrollment. */
export async function planStagedIdentityMembership(client: RegistryClient, actor: IdentityActor, input: StagedMembershipPlan) {
  return planMembership(client, actor, input)
}
export async function planIdentityMembershipByAdministrator(client: RegistryClient, actor: IdentityAdministrator, input: StagedMembershipPlan) {
  return planMembership(client, actor, input, actor)
}
async function planMembership(client: RegistryClient, actor: IdentityActor, input: StagedMembershipPlan, administrator?: IdentityAdministrator) {
  const work = planMembershipWork(actor, input)
  return administrator ? withIdentityAdministrator(client, administrator, work) : withRegistryTransaction(client, actor, false, work)
}
export async function planIdentityMembershipInTransaction(tx: Prisma.TransactionClient, actor: IdentityAdministrator, input: StagedMembershipPlan) {
  return withIdentityAdministratorInTransaction(tx, actor, planMembershipWork(actor, input))
}
function planMembershipWork(actor: IdentityActor, input: StagedMembershipPlan) {
  exact(input, ["userId", "actorId", "application", "status", "expectedAccountVersion", "expectedMembershipVersion", "expectedGrantVersion", "requestId"])
  assertIdentityScope(actor.organizationId, input.userId); assertIdentityRequestId(input.actorId); assertIdentityRequestId(input.requestId)
  if (!["TIME", "ROUTE_FIELD"].includes(input.application) || !["ACTIVE", "REVOKED"].includes(input.status)
    || !revision(input.expectedAccountVersion) || !revision(input.expectedGrantVersion)
    || !(input.expectedMembershipVersion === 0 || revision(input.expectedMembershipVersion))) throw new IdentityRegistryError("IDENTITY_MEMBERSHIP_INPUT_INVALID")
  const requestHash = digest([1, "MEMBERSHIP_CHANGED", actor.organizationId, actor.userId, input.userId, input.actorId, input.application, input.status,
    input.expectedAccountVersion, input.expectedMembershipVersion, input.expectedGrantVersion])
  return async (tx: Prisma.TransactionClient) => {
    const previous = await tx.identityEvent.findUnique({ where: { organizationId_requestId: { organizationId: actor.organizationId, requestId: input.requestId } } })
    if (previous) {
      if (previous.action !== "MEMBERSHIP_CHANGED" || previous.requestHash !== requestHash || !previous.membershipVersion || !previous.membershipStatus) throw new IdentityRegistryError("IDENTITY_REQUEST_REUSED")
      return { ...metadata, status: "PLANNED" as const, application: input.application, actorId: input.actorId, membershipStatus: previous.membershipStatus,
        membershipVersion: previous.membershipVersion, accountVersion: previous.accountVersion, replayed: true }
    }
    const account = await subject(tx, actor.organizationId, input.userId, input.status === "ACTIVE")
    if (account.version !== input.expectedAccountVersion) throw new IdentityRegistryError("IDENTITY_ACCOUNT_STALE")
    const binding = await tx.identityActorBinding.findUnique({ where: { organizationId_actorId: { organizationId: actor.organizationId, actorId: input.actorId } } })
    if (!binding || binding.userId !== input.userId) throw new IdentityRegistryError("IDENTITY_ACTOR_BINDING_REQUIRED")
    const key = { organizationId: actor.organizationId, userId: input.userId, application: input.application }
    const grant = await tx.identityApplicationGrant.findUnique({ where: { organizationId_userId_application: key } })
    if (!grant || grant.version !== input.expectedGrantVersion) throw new IdentityRegistryError("IDENTITY_GRANT_STALE")
    if (input.status === "ACTIVE") {
      if (grant.status !== "ACTIVE") throw new IdentityRegistryError("IDENTITY_GRANT_REQUIRED")
      assertStagedApplicationGrant({ userId: input.userId, application: input.application, status: "ACTIVE", role: grant.role,
        expectedAccountVersion: account.version, expectedGrantVersion: grant.version, requestId: input.requestId })
      await ownedActor(tx, actor.organizationId, input.userId, input.actorId)
    }
    const existing = await tx.identityApplicationMembership.findUnique({ where: { organizationId_userId_application: key } })
    if (existing && existing.actorId !== input.actorId) throw new IdentityRegistryError("IDENTITY_MEMBERSHIP_ACTOR_REVIEW_REQUIRED")
    if ((existing?.version ?? 0) !== input.expectedMembershipVersion) throw new IdentityRegistryError("IDENTITY_MEMBERSHIP_STALE")
    if (input.expectedMembershipVersion >= 2_147_483_647) throw new IdentityRegistryError("IDENTITY_VERSION_EXHAUSTED")
    const membershipVersion = input.expectedMembershipVersion + 1
    const accountVersion = await advance(tx, actor.organizationId, input.userId, account.version)
    if (existing) {
      const changed = await tx.identityApplicationMembership.updateMany({ where: { ...key, actorId: input.actorId, version: existing.version }, data: { status: input.status, version: membershipVersion } })
      if (changed.count !== 1) throw new IdentityRegistryError("IDENTITY_MEMBERSHIP_STALE")
    } else await tx.identityApplicationMembership.create({ data: { ...key, actorId: input.actorId, status: input.status, version: membershipVersion } })
    await tx.identityEvent.create({ data: { id: randomUUID(), ...key, actorUserId: actor.userId, requestId: input.requestId, requestHash,
      action: "MEMBERSHIP_CHANGED", accountVersion, grantVersion: grant.version, actorId: input.actorId, membershipStatus: input.status, membershipVersion } })
    return { ...metadata, status: "PLANNED" as const, application: input.application, actorId: input.actorId,
      membershipStatus: input.status, membershipVersion, accountVersion, replayed: false }
  }
}
