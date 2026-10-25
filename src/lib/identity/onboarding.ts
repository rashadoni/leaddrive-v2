import { createHash, randomUUID } from "node:crypto"
import type { Prisma } from "@prisma/client"
import { REVIEWER_ROLE } from "../reviewer-grant"
import type { RegistryClient } from "./registry"
import { withIdentityAdministrator, withIdentityAdministratorInTransaction, type IdentityAdministrator } from "./administrator"
import { assertIdentityRequestId, IdentityRegistryError, normalizeIdentityPhone } from "./contract"
import { freezeIdentityProofAuthority, identityProofAuthorityHash } from "./proof-authority"
import { IdentityOnboardingInput, orderedOnboardingPlans } from "./onboarding-contract"
import { assertOnboardingApplicationPlan, assertOnboardingProgress, revalidateOnboardingIntent } from "./onboarding-authority"
import { proofTransaction, phoneProofClock, phoneProofContext, phoneProofKeyFor, consumeStagedPhoneProofWithSetup, setStagedIdentityCredential,
  type PhoneProofKeyResolver, type SharedPasswordPolicy } from "./phone-proof-registry"
import { sealPhoneProof, phoneProofAttemptHash, type PhoneProofKey } from "./phone-proof"
import { credentialSetupHint } from "./credential-setup"
import { activateReviewedIdentityInTransaction } from "./activation"
import { IdentityTimeEnrollmentMetadata, type IdentityTimeEnrollmentRequest } from "./time-enrollment-contract"
import { assertIdentityActivationRuntime } from "./activation-runtime"

const unavailable = () => new IdentityRegistryError("IDENTITY_ONBOARDING_UNAVAILABLE")
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex")
async function assertSourcePhone(tx: Prisma.TransactionClient, organizationId: string, userId: string, phone: string) {
  const [conflict] = await tx.$queryRaw<Array<{ found: boolean }>>`SELECT EXISTS(
    SELECT 1 FROM users WHERE "organizationId"=${organizationId} AND phone IS NOT NULL AND
      ((id<>${userId} AND identity_legacy_phone_conflicts(phone,${phone})) OR (id=${userId} AND NOT identity_legacy_phone_conflicts(phone,${phone})))
    UNION ALL SELECT 1 FROM mtm_agents WHERE "organizationId"=${organizationId} AND phone IS NOT NULL AND
      (("userId" IS DISTINCT FROM ${userId} AND identity_legacy_phone_conflicts(phone,${phone})) OR ("userId"=${userId} AND NOT identity_legacy_phone_conflicts(phone,${phone})))
  ) AS found`
  const claim = await tx.identityPhoneClaim.findUnique({ where: { organizationId_normalizedPhone: { organizationId, normalizedPhone: phone } } })
  if (conflict.found || (claim && claim.userId !== userId)) throw unavailable()
}

/** Explicit review of a previously staged person and complete application plan.
 * No public caller can choose a User by phone, grant an app or create a card.
 * The first legacy administrator is separately bootstrapped with a live review;
 * a legacy cookie cannot create this durable delegated authority. */
export async function createIdentityOnboardingIntent(client: RegistryClient, administrator: IdentityAdministrator, raw: unknown) {
  return withIdentityAdministrator(client, administrator, tx => createIdentityOnboardingIntentInTransaction(tx, administrator, raw))
}

export async function createIdentityOnboardingIntentInTransaction(tx: Prisma.TransactionClient, administrator: IdentityAdministrator, raw: unknown) {
  const parsed = IdentityOnboardingInput.safeParse(raw)
  if (!parsed.success || administrator.mode !== "CANONICAL") throw unavailable()
  const input = parsed.data, organizationId = administrator.organizationId, phone = normalizeIdentityPhone(input.phone)
  if (!phone) throw unavailable()
  return withIdentityAdministratorInTransaction(tx, administrator, async tx => {
    const authority = await freezeIdentityProofAuthority(tx, administrator)
    const requestHash = digest([1, organizationId, administrator.userId, { ...input, phone, applications: orderedOnboardingPlans(input.applications) }, identityProofAuthorityHash(authority)])
    const previous = await tx.identityOnboardingIntent.findUnique({ where: { organizationId_requestId: { organizationId, requestId: input.requestId } } })
    if (previous) {
      if (previous.requestHash !== requestHash) throw new IdentityRegistryError("IDENTITY_REQUEST_REUSED")
      return { intentId: previous.id, expiresAt: previous.expiresAt.toISOString(), status: previous.status, replayed: true }
    }
    await tx.$queryRaw`SELECT id FROM users WHERE "organizationId"=${organizationId} AND id=${input.userId} FOR SHARE`
    const person = await tx.user.findFirst({ where: { organizationId, id: input.userId, isActive: true, anonymizedAt: null }, select: { role: true } })
    const account = await tx.identityAccount.findUnique({ where: { organizationId_userId: { organizationId, userId: input.userId } } })
    if (!person || ["superadmin", REVIEWER_ROLE].includes(person.role) || !account || account.cutoverAt || account.version !== input.expectedAccountVersion
      || account.credentialEpoch !== input.expectedCredentialEpoch || account.contactRevision !== input.expectedContactRevision) throw unavailable()
    const cards = await tx.mtmAgent.findMany({ where: { organizationId, userId: input.userId }, select: { id: true }, take: 2 })
    if (cards.length > 1) throw new IdentityRegistryError("IDENTITY_LEGACY_LINK_AMBIGUOUS")
    await assertSourcePhone(tx, organizationId, input.userId, phone)
    const applications = await assertOnboardingApplicationPlan(tx, { organizationId, userId: input.userId, application: input.application, applications: input.applications, timeEnrollment: input.timeEnrollment ?? null })
    const now = await phoneProofClock(tx)
    await tx.identityOnboardingIntent.updateMany({ where: { organizationId, status: "ACTIVE", expiresAt: { lte: now }, OR: [{ userId: input.userId }, { normalizedPhone: phone }] }, data: { status: "EXPIRED" } })
    const intent = await tx.identityOnboardingIntent.create({ data: {
      id: randomUUID(), organizationId, userId: input.userId, issuedByUserId: administrator.userId, issuerAuthority: authority as unknown as Prisma.InputJsonObject,
      normalizedPhone: phone, application: input.application, applications, ...(input.timeEnrollment ? { timeEnrollment: input.timeEnrollment } : {}), accountVersion: account.version, credentialEpoch: account.credentialEpoch,
      contactRevision: account.contactRevision, issuedAccountVersion: account.version, issuedCredentialEpoch: account.credentialEpoch,
      requestId: input.requestId, requestHash, reviewReference: input.reviewReference, createdAt: now, expiresAt: new Date(now.valueOf() + 7 * 86_400_000),
    } })
    return { intentId: intent.id, expiresAt: intent.expiresAt.toISOString(), status: intent.status, replayed: false }
  })
}

/** Public composition calls this only after company selection and distributed
 * request limits. Resending uses the original frozen review; it cannot refresh
 * a revoked issuer, change the phone, choose rights, or extend the seven days. */
export async function issueIdentityOnboardingProof(client: RegistryClient, organizationId: string,
  input: { phone: string; application: "TIME" | "ROUTE_FIELD"; requestId: string }, key: PhoneProofKey) {
  assertIdentityRequestId(input.requestId)
  const phone = normalizeIdentityPhone(input.phone)
  if (!phone || !["TIME", "ROUTE_FIELD"].includes(input.application)) throw unavailable()
  return proofTransaction(client, organizationId, true, async tx => {
    const row = await tx.identityOnboardingIntent.findFirst({ where: { organizationId, normalizedPhone: phone, application: input.application, status: "ACTIVE" } })
    if (!row) return null
    const { intent, authority, account, now } = await revalidateOnboardingIntent(tx, organizationId, row.id)
    await assertOnboardingProgress(tx, intent, account)
    await assertSourcePhone(tx, organizationId, intent.userId, phone)
    const priorReceipt = await tx.identityEvent.findUnique({ where: { organizationId_requestId: { organizationId, requestId: input.requestId } } })
    const requestHash = digest([1, "ONBOARDING_PROOF", organizationId, intent.id, input.application, phone])
    if (priorReceipt) {
      if (priorReceipt.action !== "PHONE_PROOF_ISSUED" || priorReceipt.requestHash !== requestHash || priorReceipt.proofId !== intent.currentProofId) throw new IdentityRegistryError("IDENTITY_REQUEST_REUSED")
      return { proofId: priorReceipt.proofId!, intentId: intent.id, replayed: true }
    }
    const last = await tx.identityPhoneProof.findFirst({ where: { organizationId, userId: intent.userId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] })
    if (last && now.valueOf() - last.createdAt.valueOf() < 60_000) throw new IdentityRegistryError("IDENTITY_PROOF_RESEND_LATER")
    // Current-proof admission invalidates old CONFIRMED setup capabilities too.
    await tx.identityPhoneProof.updateMany({ where: { organizationId, userId: intent.userId, status: "PENDING" }, data: { status: "SUPERSEDED", deliveryCiphertext: null } })
    await tx.identityPhoneProofOutbox.updateMany({ where: { organizationId, userId: intent.userId, status: { in: ["PENDING", "LEASED"] } }, data: { status: "SUPERSEDED" } })
    await tx.identityPhoneReservation.deleteMany({ where: { organizationId, OR: [{ userId: intent.userId }, { normalizedPhone: phone, expiresAt: { lte: now } }] } })
    const reservationId = randomUUID(), proofId = randomUUID(), expiresAt = new Date(Math.min(now.valueOf() + 600_000, intent.expiresAt.valueOf()))
    await tx.identityPhoneReservation.create({ data: { id: reservationId, organizationId, userId: intent.userId, normalizedPhone: phone,
      expectedAccountVersion: account.version, expectedCredentialEpoch: account.credentialEpoch, requestId: input.requestId, createdAt: now, expiresAt } })
    const sealed = sealPhoneProof({ version: 2, organizationId, userId: intent.userId, normalizedPhone: phone, reservationId, challengeId: proofId,
      accountVersion: account.version, credentialEpoch: account.credentialEpoch, contactRevision: account.contactRevision,
      authorityHash: identityProofAuthorityHash(authority), createdAt: now.toISOString(), expiresAt: expiresAt.toISOString() }, key)
    await tx.identityPhoneProof.create({ data: { id: proofId, organizationId, userId: intent.userId, issuedByUserId: intent.issuedByUserId,
      onboardingIntentId: intent.id, contextVersion: 2, issuerAuthority: authority as unknown as Prisma.InputJsonObject, contactRevision: account.contactRevision,
      normalizedPhone: phone, reservationId, accountVersion: account.version, credentialEpoch: account.credentialEpoch, createdAt: now, expiresAt, ...sealed } })
    await tx.identityPhoneProofOutbox.create({ data: { organizationId, userId: intent.userId, proofId, availableAt: now } })
    await tx.identityOnboardingIntent.update({ where: { id: intent.id }, data: { currentProofId: proofId, issuedAccountVersion: account.version, issuedCredentialEpoch: account.credentialEpoch } })
    await tx.identityEvent.create({ data: { id: randomUUID(), organizationId, userId: intent.userId, actorUserId: intent.issuedByUserId,
      requestId: input.requestId, requestHash, action: "PHONE_PROOF_ISSUED", accountVersion: account.version, credentialEpoch: account.credentialEpoch,
      normalizedPhone: phone, reservationId, proofId, proofExpiresAt: expiresAt, createdAt: now } })
    return { proofId, intentId: intent.id, replayed: false }
  })
}

export async function confirmIdentityOnboardingProof(client: RegistryClient, organizationId: string,
  input: { proofId: string; phone: string; application: "TIME" | "ROUTE_FIELD"; code: string }, resolve: PhoneProofKeyResolver) {
  const requestId = await proofTransaction(client, organizationId, true, async tx => {
    const proof = await tx.identityPhoneProof.findFirst({ where: { organizationId, id: input.proofId } })
    if (!proof?.onboardingIntentId || proof.contextVersion !== 2 || proof.normalizedPhone !== normalizeIdentityPhone(input.phone)) throw unavailable()
    const { intent } = await revalidateOnboardingIntent(tx, organizationId, proof.onboardingIntentId)
    if (intent.currentProofId !== proof.id || intent.application !== input.application) throw unavailable()
    return `onboarding-confirm:${phoneProofAttemptHash(phoneProofContext(proof), phoneProofKeyFor(proof, resolve), "http-confirm", input.code)}`
  })
  return consumeStagedPhoneProofWithSetup(client, organizationId, { proofId: input.proofId, code: input.code, requestId }, resolve)
}

/** Server-owned HR transaction adapter. It is never supplied by an HTTP body;
 * the actual Time enrollment service repeats administrator checks and persists
 * all metadata/history under the same transaction. */
export type CompleteIdentityTimeEnrollment = (tx: Prisma.TransactionClient, administrator: IdentityAdministrator, input: IdentityTimeEnrollmentRequest) => Promise<{ agentId: string }>

/** Setup writes only a staged hash. The subsequent cutover and closing of the
 * exact review commit together. A returned subject is NOT a login/session;
 * callers must still obtain a fresh application-scoped password login. */
export async function finishIdentityOnboarding(client: RegistryClient, organizationId: string,
  input: { setupToken: string; password: string; application: "TIME" | "ROUTE_FIELD" }, resolve: PhoneProofKeyResolver, policy: SharedPasswordPolicy,
  admitRuntime: () => Promise<string> = assertIdentityActivationRuntime, completeTime?: CompleteIdentityTimeEnrollment) {
  const hint = credentialSetupHint(input.setupToken)
  if (!hint || !input.setupToken.startsWith("lds2.")) throw unavailable()
  const artifactSha = await admitRuntime()
  const selected = await proofTransaction(client, organizationId, true, async tx => {
    const proof = await tx.identityPhoneProof.findFirst({ where: { organizationId, id: hint.proofId } })
    if (!proof?.onboardingIntentId || proof.contextVersion !== 2) throw unavailable()
    const intent = await tx.identityOnboardingIntent.findFirst({ where: { organizationId, id: proof.onboardingIntentId, userId: proof.userId, currentProofId: proof.id, application: input.application } })
    if (!intent) throw unavailable()
    if (intent.status === "COMPLETED") return { intent, complete: true }
    await revalidateOnboardingIntent(tx, organizationId, intent.id)
    return { intent, complete: false }
  })
  const subject = { userId: selected.intent.userId, phone: selected.intent.normalizedPhone }
  if (selected.complete) return subject // The HTTP composition must authenticate the supplied password afresh.
  if (selected.intent.timeEnrollment && !completeTime) throw unavailable()
  const requestId = `onboarding-password:${createHash("sha256").update(input.setupToken).digest("hex")}`
  await setStagedIdentityCredential(client, organizationId, { setupToken: input.setupToken, password: input.password, requestId }, resolve, policy)
  return proofTransaction(client, organizationId, true, async tx => {
    const { intent, authority, account, applications, now } = await revalidateOnboardingIntent(tx, organizationId, selected.intent.id)
    if (intent.currentProofId !== hint.proofId || intent.application !== input.application) throw unavailable()
    await assertOnboardingProgress(tx, intent, account)
    const activated = await activateReviewedIdentityInTransaction(tx, authority.administrator, { userId: intent.userId, expectedAccountVersion: account.version,
      expectedCredentialEpoch: account.credentialEpoch, expectedContactRevision: account.contactRevision, credentialRequestId: requestId,
      reviewReference: intent.reviewReference, requestId: `onboarding-activate:${intent.id}`, applications }, artifactSha)
    if (intent.timeEnrollment) {
      const metadata = IdentityTimeEnrollmentMetadata.parse(intent.timeEnrollment)
      if (!completeTime) throw unavailable()
      const claim = await tx.identityPhoneClaim.findUniqueOrThrow({ where: { organizationId_userId: { organizationId, userId: intent.userId } } })
      const completed = await completeTime(tx, authority.administrator, { ...metadata, userId: intent.userId, expectedClaimId: claim.id,
        expectedAccountVersion: activated.accountVersion, requestId: intent.id })
      const timeKey = { organizationId_userId_application: { organizationId, userId: intent.userId, application: "TIME" } }
      const grant = await tx.identityApplicationGrant.findUnique({ where: timeKey })
      const member = await tx.identityApplicationMembership.findUnique({ where: timeKey })
      if (!completed?.agentId || grant?.status !== "ACTIVE" || grant.role !== "EMPLOYEE" || member?.status !== "ACTIVE" || member.actorId !== completed.agentId) throw unavailable()
    }
    await tx.identityOnboardingIntent.update({ where: { id: intent.id }, data: { status: "COMPLETED", completedAt: now } })
    return subject
  })
}

/** Any currently authenticated administrator may cancel a review. Its stored
 * issuer cannot be replaced to make a cancelled/stale invitation usable again. */
export async function cancelIdentityOnboardingIntent(client: RegistryClient, administrator: IdentityAdministrator, intentId: string, requestId: string) {
  assertIdentityRequestId(intentId); assertIdentityRequestId(requestId)
  return withIdentityAdministrator(client, administrator, async tx => {
    const organizationId = administrator.organizationId
    const intent = await tx.identityOnboardingIntent.findFirst({ where: { organizationId, id: intentId } })
    if (!intent || intent.status !== "ACTIVE") throw unavailable()
    const account = await tx.identityAccount.findUniqueOrThrow({ where: { organizationId_userId: { organizationId, userId: intent.userId } } })
    await tx.identityOnboardingIntent.update({ where: { id: intent.id }, data: { status: "CANCELLED" } })
    await tx.identityPhoneProof.updateMany({ where: { organizationId, onboardingIntentId: intent.id, status: "PENDING" }, data: { status: "SUPERSEDED", deliveryCiphertext: null } })
    await tx.identityPhoneProofOutbox.updateMany({ where: { organizationId, proof: { onboardingIntentId: intent.id }, status: { in: ["PENDING", "LEASED"] } }, data: { status: "SUPERSEDED" } })
    await tx.identityEvent.create({ data: { id: randomUUID(), organizationId, userId: intent.userId, actorUserId: administrator.userId,
      requestId, requestHash: digest([1, "ONBOARDING_CANCELLED", intent.id, administrator.userId]), action: "ONBOARDING_CANCELLED",
      accountVersion: account.version, credentialEpoch: account.credentialEpoch, reviewReference: intent.reviewReference } })
    return { status: "CANCELLED" as const }
  })
}
