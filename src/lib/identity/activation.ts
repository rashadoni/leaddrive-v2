import { createHash, randomUUID } from "node:crypto"
import { assertIdentityRequestId, assertIdentityScope, assertStagedApplicationGrant, IdentityRegistryError, normalizeIdentityPhone, type IdentityApplication } from "./contract"
import { withIdentityAdministrator, type IdentityAdministrator } from "./administrator"
import { assertIdentityActivationRuntime } from "./activation-runtime"
import { isCanonicalIdentityPasswordHash } from "./canonical-password"
import { revalidateIdentityProofAuthority } from "./proof-authority"
import { IDENTITY_AUTH_SETTING_KEY, isIdentityAuthExplicitlyEnabled, readIdentityMobileTenantPolicy } from "./tenant-policy"
import type { RegistryClient } from "./registry"
import { phonesMatch } from "../mtm/mobile-login-phone"
import { REVIEWER_ROLE } from "../reviewer-grant"

export type IdentityActivationPlan = { application: IdentityApplication; role: string | null; status: "ACTIVE" | "REVOKED";
  grantVersion: number; actorId: string | null; membershipVersion: number; membershipStatus: "ACTIVE" | "REVOKED" | null }
export type IdentityActivationInput = { userId: string; expectedAccountVersion: number; expectedCredentialEpoch: number;
  expectedContactRevision: number; credentialRequestId: string; reviewReference: string; requestId: string; applications: IdentityActivationPlan[] }
const revision = (value: number) => Number.isInteger(value) && value > 0 && value < 2_147_483_640
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const ordered = (plans: IdentityActivationPlan[]) => [...plans].sort((a, b) => a.application.localeCompare(b.application))

/** Explicit reviewed cutover of an existing staged person. This does not
 * create a User, infer ownership from a phone, copy a legacy password or grant
 * any application. All source credentials, marker and receipt commit together.
 * admitRuntime is a server dependency for disposable acceptance, never input. */
export async function activateReviewedIdentity(client: RegistryClient, administrator: IdentityAdministrator, input: IdentityActivationInput,
  admitRuntime: () => Promise<string> = assertIdentityActivationRuntime) {
  const fields = ["userId", "expectedAccountVersion", "expectedCredentialEpoch", "expectedContactRevision", "credentialRequestId", "reviewReference", "requestId", "applications"]
  if (!input || typeof input !== "object" || Object.keys(input).length !== fields.length || fields.some(k => !Object.hasOwn(input, k))
    || ![input.expectedAccountVersion, input.expectedCredentialEpoch, input.expectedContactRevision].every(revision)
    || !Array.isArray(input.applications) || input.applications.length < 1 || input.applications.length > 3) throw new IdentityRegistryError("IDENTITY_ACTIVATION_INPUT_INVALID")
  assertIdentityScope(administrator.organizationId, input.userId)
  for (const id of [input.credentialRequestId, input.reviewReference, input.requestId]) assertIdentityRequestId(id)
  const planFields = ["application", "role", "status", "grantVersion", "actorId", "membershipVersion", "membershipStatus"]
  for (const plan of input.applications) {
    if (!plan || Object.keys(plan).length !== planFields.length || planFields.some(k => !Object.hasOwn(plan, k)) || !revision(plan.grantVersion)
      || !(plan.membershipVersion === 0 || revision(plan.membershipVersion)) || !["ACTIVE", "REVOKED", null].includes(plan.membershipStatus)) throw new IdentityRegistryError("IDENTITY_ACTIVATION_INPUT_INVALID")
    if (plan.actorId !== null) assertIdentityRequestId(plan.actorId)
    assertStagedApplicationGrant({ ...plan, userId: input.userId, expectedAccountVersion: input.expectedAccountVersion, expectedGrantVersion: plan.grantVersion, requestId: input.requestId })
  }
  if (new Set(input.applications.map(p => p.application)).size !== input.applications.length || !input.applications.some(p => p.status === "ACTIVE")) throw new IdentityRegistryError("IDENTITY_ACTIVATION_INPUT_INVALID")
  const submitted = input.applications.map(p => ({ application: p.application, role: p.role, status: p.status, grantVersion: p.grantVersion, actorId: p.actorId, membershipVersion: p.membershipVersion, membershipStatus: p.membershipStatus }))
  const artifactSha = await admitRuntime()
  if (!/^[a-f0-9]{40}$/.test(artifactSha)) throw new IdentityRegistryError("IDENTITY_ACTIVATION_RUNTIME_UNAVAILABLE")
  // A retry may use a newer compatible artifact; the original successful
  // receipt retains its SHA. Artifact version is not caller authorization.
  const requestHash = createHash("sha256").update(JSON.stringify([1, "ACCOUNT_ACTIVATED", administrator.organizationId, administrator.userId,
    ...fields.filter(k => k !== "applications").map(k => input[k as keyof IdentityActivationInput]), ordered(submitted)])).digest("hex")
  return withIdentityAdministrator(client, administrator, async tx => {
    const scope = { organizationId: administrator.organizationId, userId: input.userId }
    const previous = await tx.identityEvent.findUnique({ where: { organizationId_requestId: { organizationId: scope.organizationId, requestId: input.requestId } } })
    if (previous) {
      if (previous.action !== "ACCOUNT_ACTIVATED" || previous.requestHash !== requestHash) throw new IdentityRegistryError("IDENTITY_REQUEST_REUSED")
      return { status: "ACTIVE" as const, accountVersion: previous.accountVersion, credentialEpoch: previous.credentialEpoch!, replayed: true }
    }
    const [person] = await tx.$queryRaw<Array<{ role: string; phone: string | null }>>`SELECT role,phone FROM users WHERE "organizationId"=${scope.organizationId} AND id=${scope.userId} AND "isActive" AND "anonymizedAt" IS NULL FOR UPDATE`
    if (!person) throw new IdentityRegistryError("IDENTITY_SUBJECT_UNAVAILABLE")
    if (person.role === "superadmin" || person.role === REVIEWER_ROLE) throw new IdentityRegistryError("IDENTITY_PLATFORM_CONVERSION_FORBIDDEN")
    await tx.$queryRaw`SELECT "userId" FROM identity_accounts WHERE "organizationId"=${scope.organizationId} AND "userId"=${scope.userId} FOR UPDATE`
    const account = await tx.identityAccount.findUnique({ where: { organizationId_userId: scope } })
    if (!account || account.cutoverAt || account.version !== input.expectedAccountVersion || account.credentialEpoch !== input.expectedCredentialEpoch
      || account.contactRevision !== input.expectedContactRevision) throw new IdentityRegistryError("IDENTITY_ACTIVATION_STALE")
    if (!isCanonicalIdentityPasswordHash(account.passwordHash)) throw new IdentityRegistryError("IDENTITY_VERIFIED_CREDENTIAL_REQUIRED")
    const credential = await tx.identityEvent.findUnique({ where: { organizationId_requestId: { organizationId: scope.organizationId, requestId: input.credentialRequestId } } })
    if (!credential || credential.action !== "CREDENTIAL_STAGED" || credential.userId !== scope.userId || !credential.proofId || !credential.claimId
      || credential.accountVersion !== account.version || credential.credentialEpoch !== account.credentialEpoch) throw new IdentityRegistryError("IDENTITY_VERIFIED_CREDENTIAL_REQUIRED")
    await tx.$queryRaw`SELECT id FROM identity_phone_proofs WHERE "organizationId"=${scope.organizationId} AND id=${credential.proofId} FOR SHARE`
    const proof = await tx.identityPhoneProof.findFirst({ where: { ...scope, id: credential.proofId, status: "CONFIRMED" } })
    const now = (await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`)[0].now
    if (!proof || proof.expiresAt <= now) throw new IdentityRegistryError("IDENTITY_SETUP_EXPIRED")
    if (!proof.issuedByUserId || ![1, 2].includes(proof.contextVersion)) throw new IdentityRegistryError("IDENTITY_PROOF_AUTHORITY_UNAVAILABLE")
    if (proof.contextVersion === 2) await revalidateIdentityProofAuthority(tx, proof.issuerAuthority, scope.organizationId, proof.issuedByUserId)
    else if (administrator.mode !== "LEGACY" || proof.issuedByUserId !== administrator.userId) throw new IdentityRegistryError("IDENTITY_PROOF_AUTHORITY_UNAVAILABLE")
    await tx.$queryRaw`SELECT id FROM identity_phone_claims WHERE "organizationId"=${scope.organizationId} AND "userId"=${scope.userId} FOR SHARE`
    const claim = await tx.identityPhoneClaim.findUnique({ where: { organizationId_userId: scope } })
    if (!claim || claim.id !== credential.claimId || claim.normalizedPhone !== proof.normalizedPhone) throw new IdentityRegistryError("IDENTITY_ACTIVATION_STALE")
    const flag = await tx.mtmSetting.findUnique({ where: { organizationId_key: { organizationId: scope.organizationId, key: IDENTITY_AUTH_SETTING_KEY } }, select: { value: true } })
    if (!isIdentityAuthExplicitlyEnabled(flag?.value)) throw new IdentityRegistryError("IDENTITY_APPLICATION_DISABLED")
    const cards = await tx.$queryRaw<Array<{ id: string; phone: string | null; role: string; status: string; attendanceParticipant: boolean; attendanceExcluded: boolean }>>`SELECT id,phone,role,status,"attendanceParticipant","attendanceExcluded" FROM mtm_agents WHERE "organizationId"=${scope.organizationId} AND "userId"=${scope.userId} ORDER BY id LIMIT 2 FOR UPDATE`
    if (cards.length > 1) throw new IdentityRegistryError("IDENTITY_LEGACY_LINK_AMBIGUOUS")
    for (const number of [person.phone, ...cards.map(card => card.phone)]) {
      if (number && normalizeIdentityPhone(number) !== claim.normalizedPhone && !phonesMatch(number, claim.normalizedPhone)) throw new IdentityRegistryError("IDENTITY_SOURCE_CONTACT_REVIEW_REQUIRED")
    }
    for (const card of cards) {
      const binding = await tx.identityActorBinding.findUnique({ where: { organizationId_actorId: { organizationId: scope.organizationId, actorId: card.id } } })
      if (binding?.userId !== scope.userId) throw new IdentityRegistryError("IDENTITY_ACTOR_BINDING_REQUIRED")
    }
    // Possession cannot take a number still attached to another legacy person,
    // including a suspended one. These comparisons only refuse, never adopt.
    const [collision] = await tx.$queryRaw<Array<{ found: boolean }>>`SELECT EXISTS(
      SELECT 1 FROM users WHERE "organizationId"=${scope.organizationId} AND id<>${scope.userId}
        AND identity_legacy_phone_conflicts(phone,${claim.normalizedPhone})
      UNION ALL SELECT 1 FROM mtm_agents WHERE "organizationId"=${scope.organizationId} AND "userId" IS DISTINCT FROM ${scope.userId}
        AND identity_legacy_phone_conflicts(phone,${claim.normalizedPhone})
    ) AS found`
    if (collision.found) throw new IdentityRegistryError("IDENTITY_SOURCE_CONTACT_REVIEW_REQUIRED")
    await tx.$queryRaw`SELECT application FROM identity_application_grants WHERE "organizationId"=${scope.organizationId} AND "userId"=${scope.userId} ORDER BY application FOR SHARE`
    await tx.$queryRaw`SELECT application FROM identity_application_memberships WHERE "organizationId"=${scope.organizationId} AND "userId"=${scope.userId} ORDER BY application FOR SHARE`
    const grants = await tx.identityApplicationGrant.findMany({ where: scope, orderBy: { application: "asc" }, take: 4 })
    const memberships = await tx.identityApplicationMembership.findMany({ where: scope, take: 3 })
    const current = grants.map(grant => {
      const member = memberships.find(row => row.application === grant.application)
      return { application: grant.application as IdentityApplication, role: grant.role, status: grant.status as "ACTIVE" | "REVOKED", grantVersion: grant.version,
        actorId: member?.actorId ?? null, membershipVersion: member?.version ?? 0, membershipStatus: (member?.status ?? null) as "ACTIVE" | "REVOKED" | null }
    })
    // Fixed field projection makes object property order irrelevant to caller.
    if (!same(ordered(current), ordered(submitted))) throw new IdentityRegistryError("IDENTITY_APPLICATION_PLAN_STALE")
    const activeActors = new Set<string>()
    for (const plan of current.filter(p => p.status === "ACTIVE")) {
      if (plan.application === "CRM") {
        if (plan.role !== person.role || !["admin", "manager", "sales", "support", "ticketing", "viewer"].includes(plan.role ?? "")) throw new IdentityRegistryError("IDENTITY_CRM_ROLE_CHANGE_FORBIDDEN")
        continue
      }
      const card = cards.find(row => row.id === plan.actorId)
      if (!card || card.status !== "ACTIVE" || plan.membershipStatus !== "ACTIVE" || card.role !== plan.role
        || (plan.application === "TIME" && (card.role !== "EMPLOYEE" || !card.attendanceParticipant || card.attendanceExcluded))
        || (plan.application === "ROUTE_FIELD" && card.role === "EMPLOYEE")) throw new IdentityRegistryError("IDENTITY_ACTOR_APPLICATION_MISMATCH")
      if (activeActors.has(card.id)) throw new IdentityRegistryError("IDENTITY_SEPARATE_APPLICATION_ACTOR_REQUIRED")
      activeActors.add(card.id)
      const policy = await readIdentityMobileTenantPolicy(tx, scope.organizationId, plan.application)
      if (!policy.identityEnabled || !policy.licensed) throw new IdentityRegistryError("IDENTITY_APPLICATION_DISABLED")
    }
    // Old credential changes advance the staged epoch through DB triggers.
    // Read that resulting epoch before the final monotonic cutover stamp.
    await tx.$executeRaw`UPDATE users SET "passwordHash"='!identity:canonical-only',"passwordChangedAt"=${now} WHERE "organizationId"=${scope.organizationId} AND id=${scope.userId}`
    await tx.$executeRaw`UPDATE mtm_agents SET "passwordHash"=NULL WHERE "organizationId"=${scope.organizationId} AND "userId"=${scope.userId}`
    const retired = await tx.identityAccount.findUniqueOrThrow({ where: { organizationId_userId: scope } })
    if (retired.cutoverAt || retired.passwordHash !== account.passwordHash || retired.contactRevision !== account.contactRevision
      || !revision(retired.version) || !revision(retired.credentialEpoch)) throw new IdentityRegistryError("IDENTITY_ACTIVATION_STALE")
    const accountVersion = retired.version + 1, credentialEpoch = retired.credentialEpoch + 1
    await tx.identityAccount.update({ where: { organizationId_userId: scope }, data: { cutoverAt: now, version: accountVersion, credentialEpoch } })
    await tx.identityPhoneProof.updateMany({ where: { ...scope, status: "PENDING" }, data: { status: "SUPERSEDED", deliveryCiphertext: null } })
    await tx.identityPhoneProofOutbox.updateMany({ where: { ...scope, status: { in: ["PENDING", "LEASED"] } }, data: { status: "SUPERSEDED" } })
    await tx.identityEvent.create({ data: { id: randomUUID(), ...scope, actorUserId: administrator.userId, requestId: input.requestId, requestHash,
      action: "ACCOUNT_ACTIVATED", accountVersion, credentialEpoch, contactRevision: account.contactRevision, reviewReference: input.reviewReference,
      activationArtifactSha: artifactSha, proofId: proof.id, claimId: claim.id, createdAt: now } })
    return { status: "ACTIVE" as const, accountVersion, credentialEpoch, replayed: false }
  })
}
