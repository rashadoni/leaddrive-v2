import { createHash } from "node:crypto"
import type { Prisma } from "@prisma/client"
import { z } from "zod"
import { withIdentityAdministrator, type IdentityAdministrator } from "./administrator"
import { IdentityRegistryError, normalizeIdentityPhone, type IdentityApplication } from "./contract"
import { stageIdentityAccountInTransaction, planIdentityApplicationInTransaction, reserveIdentityPhoneInTransaction, type RegistryClient } from "./registry"
import { reviewIdentityActorInTransaction, planIdentityMembershipInTransaction } from "./membership-registry"
import { issueSelfBootstrapProofInTransaction, consumeStagedPhoneProofWithSetup, setStagedIdentityCredential,
  phoneProofContext, phoneProofKeyFor, type PhoneProofKeyResolver, type SharedPasswordPolicy } from "./phone-proof-registry"
import { phoneProofAttemptHash, type PhoneProofKey } from "./phone-proof"
import { credentialSetupHint } from "./credential-setup"
import { activateReviewedIdentityInTransaction, type IdentityActivationPlan } from "./activation"
import { assertIdentityActivationRuntime } from "./activation-runtime"
import { isIdentityAuthExplicitlyEnabled, readIdentityMobileTenantPolicy } from "./tenant-policy"
import type { IdentitySelfBootstrapConflict } from "./self-bootstrap-conflict"
export class IdentitySelfBootstrapConflictError extends IdentityRegistryError {
  constructor(readonly conflicts: IdentitySelfBootstrapConflict[]) { super("IDENTITY_SELF_BOOTSTRAP_PHONE_CONFLICT") }
}
const unavailable = (reason = "UNAVAILABLE") => new IdentityRegistryError(`IDENTITY_SELF_BOOTSTRAP_${reason}`)
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex")
export const IdentitySelfBootstrapRequest = z.object({ phone: z.string().min(7).max(40), sourceRevision: z.string().regex(/^[a-f0-9]{64}$/), requestId: z.string().uuid() }).strict()

async function source(tx: Prisma.TransactionClient, actor: IdentityAdministrator, phone: string, explainConflict = false) {
  if (actor.mode !== "LEGACY") throw unavailable()
  const scope = { organizationId: actor.organizationId, userId: actor.userId }
  const [person] = await tx.$queryRaw<Array<{ name: string; role: string; phone: string | null; updatedAt: Date }>>`
    SELECT name,role,phone,"updatedAt" FROM users WHERE "organizationId"=${scope.organizationId} AND id=${scope.userId}
    AND "isActive" AND "anonymizedAt" IS NULL FOR SHARE`
  // Tenant administrators only: platform accounts have a separate lifecycle.
  if (person?.role !== "admin") throw unavailable("TENANT_ADMIN_REQUIRED")
  const flag = await tx.mtmSetting.findUnique({ where: { organizationId_key: { organizationId: scope.organizationId, key: "identityAuthV1" } }, select: { value: true } })
  if (!isIdentityAuthExplicitlyEnabled(flag?.value)) throw unavailable("TENANT_DISABLED")
  const account = await tx.identityAccount.findUnique({ where: { organizationId_userId: scope },
    select: { version: true, credentialEpoch: true, contactRevision: true, cutoverAt: true } })
  if (account?.cutoverAt) throw unavailable()
  const cards = await tx.$queryRaw<Array<{ id: string; name: string; role: string; status: string; phone: string | null; attendanceParticipant: boolean; attendanceExcluded: boolean; updatedAt: Date }>>`
    SELECT id,name,role,status,phone,"attendanceParticipant","attendanceExcluded","updatedAt" FROM mtm_agents
    WHERE "organizationId"=${scope.organizationId} AND "userId"=${scope.userId} ORDER BY id LIMIT 2 FOR SHARE`
  if (cards.length > 1 || cards.some(c => c.status !== "ACTIVE" || !["ADMIN", "MANAGER", "SUPERVISOR", "AGENT", "EMPLOYEE"].includes(c.role))) throw unavailable("CARD_REVIEW_REQUIRED")
  // An empty legacy optional phone is absent, just like NULL. It must not
  // block a first verified phone; nonempty mismatches still require review.
  const [collision] = await tx.$queryRaw<Array<{ otherOwner: boolean; ownMismatch: boolean }>>`SELECT
    EXISTS(SELECT 1 FROM users WHERE "organizationId"=${scope.organizationId} AND id<>${scope.userId}
      AND identity_legacy_phone_conflicts(phone,${phone})
      UNION ALL SELECT 1 FROM mtm_agents WHERE "organizationId"=${scope.organizationId} AND "userId" IS DISTINCT FROM ${scope.userId}
      AND identity_legacy_phone_conflicts(phone,${phone})) AS "otherOwner",
    EXISTS(SELECT 1 FROM users WHERE "organizationId"=${scope.organizationId} AND id=${scope.userId}
      AND NULLIF(phone,'') IS NOT NULL AND NOT identity_legacy_phone_conflicts(phone,${phone})
      UNION ALL SELECT 1 FROM mtm_agents WHERE "organizationId"=${scope.organizationId} AND "userId"=${scope.userId}
      AND NULLIF(phone,'') IS NOT NULL AND NOT identity_legacy_phone_conflicts(phone,${phone})) AS "ownMismatch"`
  const claim = await tx.identityPhoneClaim.findUnique({ where: { organizationId_normalizedPhone: { organizationId: scope.organizationId, normalizedPhone: phone } }, select: { userId: true } })
  if (collision.otherOwner || (claim && claim.userId !== scope.userId)) {
    if (!explainConflict) throw unavailable("PHONE_CONFLICT")
    // This runs only after the current tenant administrator and MFA checks.
    // Include hidden/inactive cards, but no phone, email, credential or grant.
    // Equal phone/name is diagnostic evidence, never permission to relink.
    const conflicts = await tx.$queryRaw<IdentitySelfBootstrapConflict[]>`SELECT * FROM (
      SELECT u.id,'crm'::text AS kind,left(u.name,200) AS name,
        (u."isActive" AND u."anonymizedAt" IS NULL) AS active,NULL::text AS "ownerName"
      FROM users u WHERE u."organizationId"=${scope.organizationId} AND u.id<>${scope.userId}
        AND (identity_legacy_phone_conflicts(u.phone,${phone}) OR EXISTS (
          SELECT 1 FROM identity_phone_claims c WHERE c."organizationId"=${scope.organizationId}
            AND c."userId"=u.id AND c."normalizedPhone"=${phone}))
      UNION ALL
      SELECT a.id,CASE WHEN a.role='EMPLOYEE' THEN 'time' ELSE 'field' END,
        left(a.name,200),(a.status='ACTIVE'),left(u.name,200)
      FROM mtm_agents a LEFT JOIN users u ON u."organizationId"=a."organizationId" AND u.id=a."userId"
      WHERE a."organizationId"=${scope.organizationId} AND a."userId" IS DISTINCT FROM ${scope.userId}
        AND identity_legacy_phone_conflicts(a.phone,${phone})
    ) matches ORDER BY kind,id LIMIT 6`
    throw new IdentitySelfBootstrapConflictError(conflicts)
  }
  if (collision.ownMismatch) throw unavailable("PHONE_MISMATCH")
  const applications: Array<{ application: IdentityApplication; role: string; actorId: string | null }> = [{ application: "CRM", role: "admin", actorId: null }]
  const card = cards[0]
  if (card && (card.role !== "EMPLOYEE" || (card.attendanceParticipant && !card.attendanceExcluded))) {
    const application = card.role === "EMPLOYEE" ? "TIME" : "ROUTE_FIELD"
    const policy = await readIdentityMobileTenantPolicy(tx, scope.organizationId, application)
    if (!policy.identityEnabled || !policy.licensed) throw unavailable("APPLICATION_UNAVAILABLE")
    applications.push({ application, role: card.role, actorId: card.id })
  }
  const grants = await tx.identityApplicationGrant.findMany({ where: scope, orderBy: { application: "asc" }, take: 4 })
  const members = await tx.identityApplicationMembership.findMany({ where: scope, orderBy: { application: "asc" }, take: 3 })
  const bindings = await tx.identityActorBinding.findMany({ where: scope, orderBy: { actorId: "asc" }, take: 2 })
  if (grants.some(g => !applications.some(p => p.application === g.application && p.role === g.role) || g.status !== "ACTIVE")
    || members.some(m => m.status !== "ACTIVE" || !applications.some(p => p.application === m.application && p.actorId === m.actorId))
    || bindings.some(b => b.actorId !== card?.id)
    || await tx.identityOnboardingIntent.findFirst({ where: { ...scope, status: "ACTIVE" }, select: { id: true } })) throw unavailable("STATE_REVIEW_REQUIRED")
  return { person, account, cards, applications, grants, members, bindings,
    revision: digest([1, scope, phone, person, cards, account, applications, grants, members, bindings]) }
}

export async function reviewIdentitySelfBootstrap(client: RegistryClient, actor: IdentityAdministrator, rawPhone: string) {
  const phone = normalizeIdentityPhone(rawPhone)
  if (!phone) throw unavailable("PHONE_INVALID")
  return withIdentityAdministrator(client, actor, async tx => {
    const current = await source(tx, actor, phone, true)
    return { name: current.person.name, phone, sourceRevision: current.revision, applications: current.applications.map(p => ({ application: p.application, role: p.role })) }
  })
}

/** A ten-minute live self-review, never a delayed legacy administrator invitation.
 * All callers must first authenticate the actual current cookie and complete MFA. */
export async function requestIdentitySelfBootstrap(client: RegistryClient, actor: IdentityAdministrator, raw: unknown, key: PhoneProofKey,
  admitRuntime: () => Promise<string> = assertIdentityActivationRuntime) {
  const parsed = IdentitySelfBootstrapRequest.safeParse(raw)
  if (!parsed.success || actor.mode !== "LEGACY") throw unavailable()
  await admitRuntime()
  const input = parsed.data, phone = normalizeIdentityPhone(input.phone)
  if (!phone) throw unavailable("PHONE_INVALID")
  const requestId = `bootstrap-issue:${input.requestId}`
  const reserveRequest = `bootstrap-reserve:${digest([1, actor.organizationId, actor.userId, { ...input, phone }])}`
  return withIdentityAdministrator(client, actor, async tx => {
    const scope = { organizationId: actor.organizationId, userId: actor.userId }
    const previous = await tx.identityEvent.findUnique({ where: { organizationId_requestId: { organizationId: scope.organizationId, requestId } } })
    if (previous) {
      const reservation = await tx.identityEvent.findFirst({ where: { ...scope, requestId: reserveRequest, action: "PHONE_RESERVED", reservationId: previous.reservationId } })
      const proof = previous.proofId ? await tx.identityPhoneProof.findFirst({ where: { ...scope, id: previous.proofId, issuedByUserId: actor.userId, contextVersion: 1 } }) : null
      if (!reservation || !proof || previous.userId !== actor.userId || previous.normalizedPhone !== phone) throw new IdentityRegistryError("IDENTITY_REQUEST_REUSED")
      return { proofId: proof.id, expiresAt: proof.expiresAt.toISOString(), replayed: true }
    }
    const current = await source(tx, actor, phone)
    if (current.revision !== input.sourceRevision) throw unavailable()
    const now = (await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`)[0].now
    const last = await tx.identityPhoneProof.findFirst({ where: scope, orderBy: { createdAt: "desc" } })
    if (last && now.valueOf() - last.createdAt.valueOf() < 60_000) throw new IdentityRegistryError("IDENTITY_PROOF_RESEND_LATER")
    let version = current.account?.version ?? (await stageIdentityAccountInTransaction(tx, actor, { userId: actor.userId, requestId: `bootstrap-stage:${input.requestId}` })).accountVersion
    const card = current.cards[0]
    if (card && !current.bindings.some(b => b.actorId === card.id)) {
      version = (await reviewIdentityActorInTransaction(tx, actor, { userId: actor.userId, actorId: card.id, expectedAccountVersion: version,
        reviewReference: reserveRequest, requestId: `bootstrap-binding:${input.requestId}` })).accountVersion
    }
    for (const plan of current.applications) {
      let grantVersion = current.grants.find(g => g.application === plan.application)?.version
      if (!grantVersion) {
        const grant = await planIdentityApplicationInTransaction(tx, actor, { userId: actor.userId, application: plan.application, role: plan.role, status: "ACTIVE",
          expectedAccountVersion: version, expectedGrantVersion: 0, requestId: `bootstrap-grant:${plan.application}:${input.requestId}` })
        version = grant.accountVersion; grantVersion = grant.grantVersion
      }
      if (plan.actorId && plan.application !== "CRM" && !current.members.some(m => m.application === plan.application)) {
        version = (await planIdentityMembershipInTransaction(tx, actor, { userId: actor.userId, actorId: plan.actorId, application: plan.application,
          status: "ACTIVE", expectedAccountVersion: version, expectedMembershipVersion: 0, expectedGrantVersion: grantVersion,
          requestId: `bootstrap-member:${plan.application}:${input.requestId}` })).accountVersion
      }
    }
    const account = await tx.identityAccount.findUniqueOrThrow({ where: { organizationId_userId: scope } })
    // Supersede only this person's pending reservation; receipts are retained.
    await tx.identityPhoneProof.updateMany({ where: { ...scope, status: "PENDING" }, data: { status: "SUPERSEDED", deliveryCiphertext: null } })
    await tx.identityPhoneProofOutbox.updateMany({ where: { ...scope, status: { in: ["PENDING", "LEASED"] } }, data: { status: "SUPERSEDED" } })
    await tx.identityPhoneReservation.deleteMany({ where: scope })
    const reservation = await reserveIdentityPhoneInTransaction(tx, actor, { userId: actor.userId, phone, expectedAccountVersion: version,
      expectedCredentialEpoch: account.credentialEpoch, requestId: reserveRequest })
    const proof = await issueSelfBootstrapProofInTransaction(tx, actor, { userId: actor.userId, reservationId: reservation.reservationId,
      expectedAccountVersion: version, expectedCredentialEpoch: account.credentialEpoch, requestId }, key)
    return { proofId: proof.proofId, expiresAt: proof.expiresAt, replayed: proof.replayed }
  })
}

async function selfProof(tx: Prisma.TransactionClient, actor: IdentityAdministrator, proofId: string) {
  if (actor.mode !== "LEGACY") throw unavailable()
  const scope = { organizationId: actor.organizationId, userId: actor.userId }
  const proof = await tx.identityPhoneProof.findFirst({ where: { ...scope, id: proofId, issuedByUserId: actor.userId, contextVersion: 1, onboardingIntentId: null } })
  const event = await tx.identityEvent.findFirst({ where: { ...scope, proofId, action: "PHONE_PROOF_ISSUED", requestId: { startsWith: "bootstrap-issue:" } } })
  if (!proof || !event) throw unavailable()
  await source(tx, actor, proof.normalizedPhone)
  return proof
}
export async function confirmIdentitySelfBootstrap(client: RegistryClient, actor: IdentityAdministrator, proofId: string, code: string, resolve: PhoneProofKeyResolver) {
  const requestId = await withIdentityAdministrator(client, actor, async tx => {
    const proof = await selfProof(tx, actor, proofId)
    return `bootstrap-confirm:${phoneProofAttemptHash(phoneProofContext(proof), phoneProofKeyFor(proof, resolve), "self-confirm", code)}`
  })
  return consumeStagedPhoneProofWithSetup(client, actor.organizationId, { proofId, code, requestId }, resolve)
}
export async function finishIdentitySelfBootstrap(client: RegistryClient, actor: IdentityAdministrator,
  input: { setupToken: string; password: string }, resolve: PhoneProofKeyResolver, policy: SharedPasswordPolicy,
  admitRuntime: () => Promise<string> = assertIdentityActivationRuntime) {
  const hint = credentialSetupHint(input.setupToken)
  if (!hint || !input.setupToken.startsWith("lds1.")) throw unavailable()
  const artifactSha = await admitRuntime()
  await withIdentityAdministrator(client, actor, tx => selfProof(tx, actor, hint.proofId))
  const requestId = `bootstrap-password:${digest(input.setupToken)}`
  await setStagedIdentityCredential(client, actor.organizationId, { ...input, requestId }, resolve, policy)
  return withIdentityAdministrator(client, actor, async tx => {
    const proof = await selfProof(tx, actor, hint.proofId)
    const current = await source(tx, actor, proof.normalizedPhone)
    if (!current.account) throw unavailable()
    const applications: IdentityActivationPlan[] = current.grants.map(g => {
      const member = current.members.find(m => m.application === g.application)
      return { application: g.application as IdentityApplication, role: g.role, status: g.status as "ACTIVE", grantVersion: g.version,
        actorId: member?.actorId ?? null, membershipVersion: member?.version ?? 0, membershipStatus: member ? "ACTIVE" : null }
    })
    return activateReviewedIdentityInTransaction(tx, actor, { userId: actor.userId, expectedAccountVersion: current.account.version,
      expectedCredentialEpoch: current.account.credentialEpoch, expectedContactRevision: current.account.contactRevision,
      credentialRequestId: requestId, reviewReference: `self-bootstrap:${proof.id}`, requestId: `bootstrap-activate:${proof.id}`, applications }, artifactSha)
  })
}
