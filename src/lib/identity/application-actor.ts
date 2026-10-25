import { createHash, randomUUID } from "node:crypto"
import { assertIdentityRequestId, assertIdentityScope, assertStagedApplicationGrant, IdentityRegistryError } from "./contract"
import { withIdentityAdministrator, type IdentityAdministrator } from "./administrator"
import type { RegistryClient } from "./registry"
import type { IdentityMobileApplication } from "./mobile-session-contract"
import { readIdentityMobileTenantPolicy } from "./tenant-policy"

export type IdentityApplicationActorInput = {
  userId: string; application: IdentityMobileApplication; role: string;
  actorId: string | null; expectedAccountVersion: number; reviewReference: string; requestId: string;
}

/** An administrator explicitly selects a person, then either reviews that
 * person's existing card or creates a separate module card. Phone possession,
 * equal names and phone matches never authorize adopting someone else's card.
 * No grant, password, contact or historic workday is changed by this operation. */
export async function prepareIdentityApplicationActor(client: RegistryClient, actor: IdentityAdministrator, input: IdentityApplicationActorInput) {
  const fields = ["userId", "application", "role", "actorId", "expectedAccountVersion", "reviewReference", "requestId"] as const
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).length !== fields.length
    || fields.some(key => !Object.hasOwn(input, key)) || !["TIME", "ROUTE_FIELD"].includes(input.application)
    || !Number.isInteger(input.expectedAccountVersion) || input.expectedAccountVersion < 1 || input.expectedAccountVersion >= 2_147_483_647
    || (input.application === "TIME" && input.role !== "EMPLOYEE")) throw new IdentityRegistryError("IDENTITY_ACTOR_INPUT_INVALID")
  assertIdentityScope(actor.organizationId, input.userId)
  assertIdentityRequestId(input.reviewReference)
  if (input.actorId !== null) assertIdentityRequestId(input.actorId)
  assertStagedApplicationGrant({ ...input, status: "ACTIVE", expectedGrantVersion: 0 })
  const requestHash = createHash("sha256").update(JSON.stringify([1, "APPLICATION_ACTOR_PREPARED", actor.organizationId, actor.userId, ...fields.map(key => input[key])])).digest("hex")
  return withIdentityAdministrator(client, actor, async tx => {
    const scope = { organizationId: actor.organizationId, userId: input.userId }
    const receipt = await tx.identityEvent.findUnique({ where: { organizationId_requestId: { organizationId: scope.organizationId, requestId: input.requestId } } })
    if (receipt) {
      if (receipt.requestHash !== requestHash || receipt.action !== "ACTOR_BINDING_REVIEWED" || !receipt.actorId) throw new IdentityRegistryError("IDENTITY_REQUEST_REUSED")
      return { actorId: receipt.actorId, accountVersion: receipt.accountVersion, replayed: true }
    }
    const [person] = await tx.$queryRaw<Array<{ name: string }>>`SELECT name FROM users WHERE "organizationId"=${scope.organizationId} AND id=${scope.userId} AND "isActive" AND "anonymizedAt" IS NULL FOR SHARE`
    if (!person) throw new IdentityRegistryError("IDENTITY_SUBJECT_UNAVAILABLE")
    const account = await tx.identityAccount.findUnique({ where: { organizationId_userId: scope } })
    if (!account?.cutoverAt) throw new IdentityRegistryError("IDENTITY_ACTIVATION_REQUIRED")
    if (account.version !== input.expectedAccountVersion) throw new IdentityRegistryError("IDENTITY_ACCOUNT_STALE")
    const policy = await readIdentityMobileTenantPolicy(tx, scope.organizationId, input.application)
    if (!policy.identityEnabled || !policy.licensed) throw new IdentityRegistryError("IDENTITY_APPLICATION_DISABLED")
    const membership = await tx.identityApplicationMembership.findUnique({ where: { organizationId_userId_application: { ...scope, application: input.application } } })
    if (membership && membership.actorId !== input.actorId) throw new IdentityRegistryError("IDENTITY_MEMBERSHIP_ACTOR_REVIEW_REQUIRED")
    const actorId = input.actorId ?? randomUUID()
    if (input.actorId) {
      const [card] = await tx.$queryRaw<Array<{ userId: string | null; role: string; status: string }>>`SELECT "userId", role, status FROM mtm_agents WHERE "organizationId"=${scope.organizationId} AND id=${actorId} FOR SHARE`
      if (!card || card.userId !== scope.userId || card.status !== "ACTIVE") throw new IdentityRegistryError("IDENTITY_ACTOR_UNAVAILABLE")
      if (card.role !== input.role) throw new IdentityRegistryError("IDENTITY_ACTOR_APPLICATION_MISMATCH")
      const sibling = await tx.identityApplicationMembership.findFirst({ where: { organizationId: scope.organizationId, actorId, application: { not: input.application } } })
      if (sibling) throw new IdentityRegistryError("IDENTITY_SEPARATE_APPLICATION_ACTOR_REQUIRED")
    } else {
      // Even an inactive card requires explicit review; retries must not silently
      // manufacture another history when a previous card already exists.
      const existing = await tx.mtmAgent.findFirst({ where: { ...scope, role: input.application === "TIME" ? "EMPLOYEE" : { not: "EMPLOYEE" } }, select: { id: true } })
      if (existing) throw new IdentityRegistryError("IDENTITY_EXISTING_ACTOR_REVIEW_REQUIRED")
    }
    const bindingKey = { organizationId_actorId: { organizationId: scope.organizationId, actorId } }
    const binding = await tx.identityActorBinding.findUnique({ where: bindingKey })
    if (binding && binding.userId !== scope.userId) throw new IdentityRegistryError("IDENTITY_ACTOR_BINDING_CONFLICT")
    const accountVersion = account.version + 1
    const changed = await tx.identityAccount.updateMany({ where: { ...scope, version: account.version }, data: { version: accountVersion } })
    if (changed.count !== 1) throw new IdentityRegistryError("IDENTITY_ACCOUNT_STALE")
    if (!input.actorId) await tx.mtmAgent.create({ data: { id: actorId, ...scope, name: person.name,
      role: input.role as "EMPLOYEE" | "AGENT" | "SUPERVISOR" | "MANAGER" | "ADMIN", status: "ACTIVE",
      attendanceParticipant: input.application === "TIME", canPlanOwnRoutes: input.application === "ROUTE_FIELD", canSelfPublishRoutes: false } })
    if (!binding) await tx.identityActorBinding.create({ data: { ...scope, actorId, reviewedByUserId: actor.userId, reviewReference: input.reviewReference, accountVersion } })
    await tx.identityEvent.create({ data: { id: randomUUID(), ...scope, actorUserId: actor.userId, requestId: input.requestId,
      requestHash, action: "ACTOR_BINDING_REVIEWED", accountVersion, actorId, application: input.application, reviewReference: input.reviewReference } })
    return { actorId, accountVersion, replayed: false }
  })
}
