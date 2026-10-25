import { createHash, randomUUID } from "node:crypto"
import { assertIdentityRequestId, assertIdentityScope, assertStagedApplicationGrant, IdentityRegistryError } from "./contract"
import { withIdentityAdministrator, type IdentityAdministrator } from "./administrator"
import type { RegistryClient } from "./registry"
import type { IdentityMobileApplication } from "./mobile-session-contract"
import { readIdentityMobileTenantPolicy } from "./tenant-policy"
import { isCanonicalIdentityPasswordHash } from "./canonical-password"

export type IdentityApplicationEnrollment = {
  userId: string; actorId: string; application: IdentityMobileApplication;
  role: string; status: "ACTIVE" | "REVOKED"; expectedAccountVersion: number;
  expectedGrantVersion: number; expectedMembershipVersion: number; requestId: string;
}
const fields = ["userId", "actorId", "application", "role", "status", "expectedAccountVersion", "expectedGrantVersion", "expectedMembershipVersion", "requestId"]
const revision = (value: number, minimum: number) => Number.isInteger(value) && value >= minimum && value < 2_147_483_647

/** Change one application's access atomically. Explicit reviewed actor ID only;
 * no phone-based adoption, credential change, new User or sibling grant write.
 * Until workflow state has its own app key, active modules use distinct actors
 * so Time cannot share Field's workday, installation admission or event queue. */
export async function enrollIdentityApplication(client: RegistryClient, actor: IdentityAdministrator, input: IdentityApplicationEnrollment) {
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).length !== fields.length
    || fields.some(name => !Object.hasOwn(input, name)) || !["TIME", "ROUTE_FIELD"].includes(input.application)
    || !revision(input.expectedAccountVersion, 1) || !revision(input.expectedGrantVersion, 0)
    || !revision(input.expectedMembershipVersion, 0)) throw new IdentityRegistryError("IDENTITY_ENROLLMENT_INPUT_INVALID")
  assertIdentityScope(actor.organizationId, input.userId)
  assertIdentityRequestId(input.actorId)
  assertStagedApplicationGrant(input)
  const hash = createHash("sha256").update(JSON.stringify([1, "APPLICATION_ENROLLMENT", actor.organizationId, actor.userId,
    ...fields.map(name => input[name as keyof IdentityApplicationEnrollment])])).digest("hex")
  return withIdentityAdministrator(client, actor, async tx => {
    const scope = { organizationId: actor.organizationId, userId: input.userId }
    const key = { ...scope, application: input.application }
    const previous = await tx.identityEvent.findUnique({ where: { organizationId_requestId: { organizationId: actor.organizationId, requestId: input.requestId } } })
    if (previous) {
      if (previous.requestHash !== hash || previous.action !== "MEMBERSHIP_CHANGED" || previous.grantVersion === null || previous.membershipVersion === null) throw new IdentityRegistryError("IDENTITY_REQUEST_REUSED")
      return { accountVersion: previous.accountVersion, grantVersion: previous.grantVersion, membershipVersion: previous.membershipVersion, replayed: true }
    }
    const [person] = await tx.$queryRaw<Array<{ isActive: boolean; anonymizedAt: Date | null }>>`SELECT "isActive", "anonymizedAt" FROM users WHERE "organizationId"=${scope.organizationId} AND id=${scope.userId} FOR SHARE`
    if (!person || (input.status === "ACTIVE" && (!person.isActive || person.anonymizedAt))) throw new IdentityRegistryError("IDENTITY_SUBJECT_UNAVAILABLE")
    const account = await tx.identityAccount.findUnique({ where: { organizationId_userId: scope } })
    if (!account?.cutoverAt) throw new IdentityRegistryError("IDENTITY_ACTIVATION_REQUIRED")
    if (account.version !== input.expectedAccountVersion) throw new IdentityRegistryError("IDENTITY_ACCOUNT_STALE")
    const [card] = await tx.$queryRaw<Array<{ userId: string | null; status: string; role: string }>>`SELECT "userId", status, role FROM mtm_agents WHERE "organizationId"=${scope.organizationId} AND id=${input.actorId} FOR SHARE`
    const binding = await tx.identityActorBinding.findUnique({ where: { organizationId_actorId: { organizationId: scope.organizationId, actorId: input.actorId } } })
    if (!binding || binding.userId !== scope.userId) throw new IdentityRegistryError("IDENTITY_ACTOR_BINDING_REQUIRED")
    const grant = await tx.identityApplicationGrant.findUnique({ where: { organizationId_userId_application: key } })
    const membership = await tx.identityApplicationMembership.findUnique({ where: { organizationId_userId_application: key } })
    if ((grant?.version ?? 0) !== input.expectedGrantVersion) throw new IdentityRegistryError("IDENTITY_GRANT_STALE")
    if ((membership?.version ?? 0) !== input.expectedMembershipVersion) throw new IdentityRegistryError("IDENTITY_MEMBERSHIP_STALE")
    if (membership && membership.actorId !== input.actorId) throw new IdentityRegistryError("IDENTITY_MEMBERSHIP_ACTOR_REVIEW_REQUIRED")
    if (input.status === "ACTIVE") {
      const claim = await tx.identityPhoneClaim.findUnique({ where: { organizationId_userId: scope }, select: { id: true } })
      if (!claim || !isCanonicalIdentityPasswordHash(account.passwordHash)) throw new IdentityRegistryError("IDENTITY_VERIFIED_CREDENTIAL_REQUIRED")
      if (!card || card.userId !== scope.userId || card.status !== "ACTIVE") throw new IdentityRegistryError("IDENTITY_ACTOR_UNAVAILABLE")
      if ((input.application === "TIME" && (card.role !== "EMPLOYEE" || input.role !== "EMPLOYEE"))
        || (input.application === "ROUTE_FIELD" && (card.role === "EMPLOYEE" || card.role !== input.role))) throw new IdentityRegistryError("IDENTITY_ACTOR_APPLICATION_MISMATCH")
      const policy = await readIdentityMobileTenantPolicy(tx, scope.organizationId, input.application)
      if (!policy.identityEnabled || !policy.licensed) throw new IdentityRegistryError("IDENTITY_APPLICATION_DISABLED")
      const sibling = await tx.identityApplicationMembership.findFirst({ where: { organizationId: scope.organizationId, actorId: input.actorId, application: { not: input.application } } })
      if (sibling) throw new IdentityRegistryError("IDENTITY_SEPARATE_APPLICATION_ACTOR_REQUIRED")
    } else if (!grant || !membership) throw new IdentityRegistryError("IDENTITY_MEMBERSHIP_REQUIRED")
    const version = account.version + 1, grantVersion = input.expectedGrantVersion + 1, membershipVersion = input.expectedMembershipVersion + 1
    const advanced = await tx.identityAccount.updateMany({ where: { ...scope, version: account.version }, data: { version } })
    if (advanced.count !== 1) throw new IdentityRegistryError("IDENTITY_ACCOUNT_STALE")
    if (grant) await tx.identityApplicationGrant.update({ where: { organizationId_userId_application: key }, data: { role: input.role, status: input.status, version: grantVersion } })
    else await tx.identityApplicationGrant.create({ data: { ...key, role: input.role, status: input.status, version: grantVersion } })
    if (membership) await tx.identityApplicationMembership.update({ where: { organizationId_userId_application: key }, data: { status: input.status, version: membershipVersion } })
    else await tx.identityApplicationMembership.create({ data: { ...key, actorId: input.actorId, status: input.status, version: membershipVersion } })
    await tx.identityEvent.create({ data: { id: randomUUID(), ...scope, actorUserId: actor.userId, requestId: input.requestId, requestHash: hash,
      action: "MEMBERSHIP_CHANGED", accountVersion: version, application: input.application, actorId: input.actorId,
      grantStatus: input.status, grantRole: input.role, grantVersion, membershipStatus: input.status, membershipVersion } })
    return { accountVersion: version, grantVersion, membershipVersion, replayed: false }
  })
}
