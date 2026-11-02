import { createHash, randomUUID } from "node:crypto"
import bcrypt from "bcryptjs"
import type { IdentityPhoneProof, Prisma } from "@prisma/client"
import { assertIdentityRequestId, IdentityRegistryError, normalizeIdentityPhone } from "./contract"
import type { RegistryClient } from "./registry"
import type { IdentityMobileApplication } from "./mobile-session-contract"
import { freezeIdentityRecoveryAuthority, parseIdentityRecoveryAuthority, identityRecoveryAuthorityHash, revalidateIdentityRecoveryAuthority } from "./recovery-authority"
import { sealPhoneProof, phoneProofAttemptHash, verifyPhoneProofCode, type PhoneProofKey } from "./phone-proof"
import { proofTransaction, phoneProofClock, phoneProofContext, lockedProof, phoneProofKeyFor, suppressPhoneProofs,
  type PhoneProofKeyResolver, type SharedPasswordPolicy } from "./phone-proof-registry"
import { credentialSetupHint, credentialSetupRequestHash, mintCredentialSetup, verifyCredentialSetup, type CredentialSetupContext } from "./credential-setup"

const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex")
const unavailable = () => new IdentityRegistryError("IDENTITY_RECOVERY_UNAVAILABLE")
function exact(value: object, names: string[]) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== names.length
    || names.some(name => !Object.hasOwn(value, name))) throw unavailable()
}
async function latest(tx: Prisma.TransactionClient, proof: IdentityPhoneProof) {
  const row = await tx.identityPhoneProof.findFirst({ where: { organizationId: proof.organizationId, userId: proof.userId, contextVersion: 3 },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { id: true } })
  if (row?.id !== proof.id) throw unavailable()
}
function authorityOf(proof: IdentityPhoneProof, application: IdentityMobileApplication) {
  const authority = parseIdentityRecoveryAuthority(proof.issuerAuthority)
  if (proof.contextVersion !== 3 || proof.issuedByUserId !== null || !authority || authority.application !== application
    || authority.organizationId !== proof.organizationId || authority.userId !== proof.userId
    || authority.accountVersion !== proof.accountVersion || authority.credentialEpoch !== proof.credentialEpoch
    || authority.contactRevision !== proof.contactRevision || authority.normalizedPhone !== proof.normalizedPhone) throw unavailable()
  return authority
}
function setupContext(proof: IdentityPhoneProof, application: IdentityMobileApplication): CredentialSetupContext {
  const authority = authorityOf(proof, application)
  if (proof.status !== "CONFIRMED" || !proof.usedAt) throw unavailable()
  return { version: 3, organizationId: proof.organizationId, userId: proof.userId, proofId: proof.id, claimId: authority.claimId,
    accountVersion: proof.accountVersion, credentialEpoch: proof.credentialEpoch, contactRevision: authority.contactRevision,
    authorityHash: identityRecoveryAuthorityHash(authority), confirmedAt: proof.usedAt.toISOString(), expiresAt: proof.expiresAt.toISOString() }
}

/** Called only after distributed IP/principal limits and trusted company routing.
 * A null result must share the HTTP response shape with a real challenge.
 * No user, claim, grant or membership is created from a submitted phone. */
export async function issueCanonicalRecovery(client: RegistryClient, organizationId: string,
  input: { phone: string; application: IdentityMobileApplication; requestId: string }, key: PhoneProofKey) {
  exact(input, ["phone", "application", "requestId"]); assertIdentityRequestId(input.requestId)
  const phone = normalizeIdentityPhone(input.phone)
  if (!phone) throw unavailable()
  return proofTransaction(client, organizationId, true, async tx => {
    const claim = await tx.identityPhoneClaim.findUnique({ where: { organizationId_normalizedPhone: { organizationId, normalizedPhone: phone } } })
    if (!claim) return null
    const authority = await freezeIdentityRecoveryAuthority(tx, organizationId, claim.userId, input.application)
    if (authority.claimId !== claim.id) throw unavailable()
    const now = await phoneProofClock(tx), requestHash = digest([3, "RECOVERY_ISSUED", organizationId, phone, input.application])
    const previous = await tx.identityEvent.findUnique({ where: { organizationId_requestId: { organizationId, requestId: input.requestId } } })
    if (previous) {
      if (previous.action !== "RECOVERY_ISSUED" || previous.requestHash !== requestHash || !previous.proofId) throw new IdentityRegistryError("IDENTITY_REQUEST_REUSED")
      const proof = await lockedProof(tx, organizationId, previous.proofId)
      if (!proof || proof.status !== "PENDING" || proof.expiresAt <= now) throw unavailable()
      await latest(tx, proof); await revalidateIdentityRecoveryAuthority(tx, proof.issuerAuthority, organizationId, proof.userId)
      return { proofId: proof.id, expiresAt: proof.expiresAt.toISOString() }
    }
    const last = await tx.identityPhoneProof.findFirst({ where: { organizationId, userId: claim.userId, contextVersion: 3 }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] })
    if (last && now.valueOf() - last.createdAt.valueOf() < 60_000) throw new IdentityRegistryError("IDENTITY_PROOF_RESEND_LATER")
    const reservation = await tx.identityPhoneReservation.findUnique({ where: { organizationId_userId: { organizationId, userId: claim.userId } } })
    if (reservation && reservation.normalizedPhone !== phone) throw unavailable()
    if (reservation) await tx.identityPhoneReservation.delete({ where: { id: reservation.id } })
    // A new challenge supersedes setup capabilities too, through latest().
    await tx.identityPhoneProof.updateMany({ where: { organizationId, userId: claim.userId, contextVersion: 3, status: "PENDING" }, data: { status: "SUPERSEDED", deliveryCiphertext: null } })
    await tx.identityPhoneProofOutbox.updateMany({ where: { organizationId, userId: claim.userId, status: { in: ["PENDING", "LEASED"] } }, data: { status: "SUPERSEDED" } })
    const proofId = randomUUID(), reservationId = randomUUID(), expiresAt = new Date(now.valueOf() + 600_000)
    await tx.identityPhoneReservation.create({ data: { id: reservationId, organizationId, userId: claim.userId, normalizedPhone: phone,
      expectedAccountVersion: authority.accountVersion, expectedCredentialEpoch: authority.credentialEpoch, requestId: input.requestId, createdAt: now, expiresAt } })
    const frozen = { version: 3 as const, organizationId, userId: claim.userId, reservationId, challengeId: proofId, normalizedPhone: phone,
      accountVersion: authority.accountVersion, credentialEpoch: authority.credentialEpoch, contactRevision: authority.contactRevision,
      authorityHash: identityRecoveryAuthorityHash(authority), createdAt: now.toISOString(), expiresAt: expiresAt.toISOString() }
    await tx.identityPhoneProof.create({ data: { id: proofId, organizationId, userId: claim.userId, issuedByUserId: null, reservationId, normalizedPhone: phone,
      contextVersion: 3, accountVersion: authority.accountVersion, credentialEpoch: authority.credentialEpoch, contactRevision: authority.contactRevision,
      issuerAuthority: authority as unknown as Prisma.InputJsonObject, createdAt: now, expiresAt, ...sealPhoneProof(frozen, key) } })
    await tx.identityPhoneProofOutbox.create({ data: { organizationId, userId: claim.userId, proofId, availableAt: now } })
    await tx.identityEvent.create({ data: { id: randomUUID(), organizationId, userId: claim.userId, actorUserId: null,
      action: "RECOVERY_ISSUED", requestId: input.requestId, requestHash, proofId, claimId: claim.id, application: input.application,
      accountVersion: authority.accountVersion, credentialEpoch: authority.credentialEpoch, contactRevision: authority.contactRevision, proofExpiresAt: expiresAt, createdAt: now } })
    return { proofId, expiresAt: expiresAt.toISOString() }
  })
}

export async function confirmCanonicalRecovery(client: RegistryClient, organizationId: string,
  input: { proofId: string; application: IdentityMobileApplication; requestId: string; code: string }, resolve: PhoneProofKeyResolver) {
  exact(input, ["proofId", "application", "requestId", "code"]); assertIdentityRequestId(input.proofId); assertIdentityRequestId(input.requestId)
  if (typeof input.code !== "string" || input.code.length > 64) throw unavailable()
  return proofTransaction(client, organizationId, true, async tx => {
    const proof = await lockedProof(tx, organizationId, input.proofId)
    if (!proof) return null
    const authority = authorityOf(proof, input.application)
    await latest(tx, proof); await revalidateIdentityRecoveryAuthority(tx, authority, organizationId, proof.userId)
    const now = await phoneProofClock(tx)
    if (now < proof.createdAt || now >= proof.expiresAt) { await suppressPhoneProofs(tx, organizationId, [proof.id], "EXPIRED"); return null }
    const key = phoneProofKeyFor(proof, resolve), frozen = phoneProofContext(proof)
    const requestHash = phoneProofAttemptHash(frozen, key, input.requestId, input.code)
    const prior = await tx.identityEvent.findUnique({ where: { organizationId_requestId: { organizationId, requestId: input.requestId } } })
    if (prior) {
      if (prior.requestHash !== requestHash || prior.proofId !== proof.id || !["RECOVERY_CONFIRMED", "PHONE_PROOF_REJECTED"].includes(prior.action)) throw new IdentityRegistryError("IDENTITY_REQUEST_REUSED")
      return prior.action === "RECOVERY_CONFIRMED" ? { setupToken: mintCredentialSetup(setupContext(proof, input.application), key, now), userId: proof.userId } : null
    }
    if (proof.status !== "PENDING" || proof.usedAt || proof.attempts >= 5) return null
    const reservation = await tx.identityPhoneReservation.findFirst({ where: { organizationId, userId: proof.userId, id: proof.reservationId } })
    if (!reservation || reservation.expiresAt <= now || reservation.normalizedPhone !== proof.normalizedPhone
      || reservation.expectedAccountVersion !== authority.accountVersion || reservation.expectedCredentialEpoch !== authority.credentialEpoch) throw unavailable()
    if (!verifyPhoneProofCode(frozen, { keyId: proof.keyId, codeHash: proof.codeHash, deliveryCiphertext: proof.deliveryCiphertext ?? "" }, key, input.code, now)) {
      const attempts = proof.attempts + 1
      await tx.identityPhoneProof.update({ where: { id: proof.id }, data: { attempts, ...(attempts >= 5 ? { status: "LOCKED", deliveryCiphertext: null } : {}) } })
      if (attempts >= 5) await suppressPhoneProofs(tx, organizationId, [proof.id], "SUPERSEDED")
      await tx.identityEvent.create({ data: { id: randomUUID(), organizationId, userId: proof.userId, actorUserId: null, requestId: input.requestId, requestHash,
        action: "PHONE_PROOF_REJECTED", accountVersion: authority.accountVersion, credentialEpoch: authority.credentialEpoch, proofId: proof.id,
        proofAttempt: attempts, proofOutcome: "INVALID_CODE", createdAt: now } })
      return null // Commit the spent attempt.
    }
    const confirmed = await tx.identityPhoneProof.update({ where: { id: proof.id }, data: { status: "CONFIRMED", usedAt: now, deliveryCiphertext: null } })
    await tx.identityPhoneReservation.delete({ where: { id: reservation.id } })
    await suppressPhoneProofs(tx, organizationId, [proof.id], "SUPERSEDED")
    await tx.identityEvent.create({ data: { id: randomUUID(), organizationId, userId: proof.userId, actorUserId: proof.userId,
      action: "RECOVERY_CONFIRMED", requestId: input.requestId, requestHash, proofId: proof.id, claimId: authority.claimId, application: input.application,
      accountVersion: authority.accountVersion, credentialEpoch: authority.credentialEpoch, contactRevision: authority.contactRevision, createdAt: now } })
    // Possession changes no claim, password, rights or session yet.
    return { setupToken: mintCredentialSetup(setupContext(confirmed, input.application), key, now), userId: proof.userId }
  })
}

export async function resetCanonicalPassword(client: RegistryClient, organizationId: string,
  input: { setupToken: string; application: IdentityMobileApplication; password: string; requestId: string }, resolve: PhoneProofKeyResolver, policy: SharedPasswordPolicy) {
  exact(input, ["setupToken", "application", "password", "requestId"]); assertIdentityRequestId(input.requestId)
  if (typeof input.password !== "string" || input.password.length > 72 || Buffer.byteLength(input.password, "utf8") > 72 || policy(input.password)) throw new IdentityRegistryError("IDENTITY_PASSWORD_WEAK")
  const hint = credentialSetupHint(input.setupToken)
  if (!hint || !input.setupToken.startsWith("lds3.")) throw unavailable()
  const verify = async (tx: Prisma.TransactionClient) => {
    const proof = await lockedProof(tx, organizationId, hint.proofId)
    if (!proof) throw unavailable()
    const authority = authorityOf(proof, input.application), frozen = setupContext(proof, input.application)
    await latest(tx, proof)
    const now = await phoneProofClock(tx), key = phoneProofKeyFor(proof, resolve)
    if (key.id !== hint.keyId || !verifyCredentialSetup(frozen, key, input.setupToken, now)) throw unavailable()
    const requestHash = credentialSetupRequestHash(frozen, key, input.requestId, input.password)
    const prior = await tx.identityEvent.findUnique({ where: { organizationId_requestId: { organizationId, requestId: input.requestId } } })
    if (prior && (prior.action !== "CREDENTIAL_CHANGED" || prior.requestHash !== requestHash || prior.proofId !== proof.id || prior.userId !== proof.userId)) throw new IdentityRegistryError("IDENTITY_REQUEST_REUSED")
    const current = await freezeIdentityRecoveryAuthority(tx, organizationId, proof.userId, input.application)
    const expected = prior ? { ...authority, accountVersion: prior.accountVersion, credentialEpoch: prior.credentialEpoch! } : authority
    if (identityRecoveryAuthorityHash(current) !== identityRecoveryAuthorityHash(expected)) throw unavailable()
    if (!prior && (current.accountVersion >= 2_147_483_647 || current.credentialEpoch >= 2_147_483_647)) throw new IdentityRegistryError("IDENTITY_VERSION_EXHAUSTED")
    return { proof, authority, requestHash, prior, now }
  }
  const first = await proofTransaction(client, organizationId, true, verify)
  if (first.prior) return { userId: first.proof.userId, credentialEpoch: first.prior.credentialEpoch!, replayed: true }
  const passwordHash = await bcrypt.hash(input.password, 12)
  return proofTransaction(client, organizationId, true, async tx => {
    const state = await verify(tx)
    if (state.prior) return { userId: state.proof.userId, credentialEpoch: state.prior.credentialEpoch!, replayed: true }
    const { authority, proof } = state, nextVersion = authority.accountVersion + 1, nextEpoch = authority.credentialEpoch + 1
    const changed = await tx.identityAccount.updateMany({ where: { organizationId, userId: proof.userId, cutoverAt: { not: null },
      version: authority.accountVersion, credentialEpoch: authority.credentialEpoch, contactRevision: authority.contactRevision },
      data: { passwordHash, version: nextVersion, credentialEpoch: nextEpoch } })
    if (changed.count !== 1) throw unavailable()
    await tx.identityEvent.create({ data: { id: randomUUID(), organizationId, userId: proof.userId, actorUserId: proof.userId,
      action: "CREDENTIAL_CHANGED", requestId: input.requestId, requestHash: state.requestHash, proofId: proof.id, claimId: authority.claimId, application: input.application,
      accountVersion: nextVersion, credentialEpoch: nextEpoch, contactRevision: authority.contactRevision, createdAt: state.now } })
    return { userId: proof.userId, credentialEpoch: nextEpoch, replayed: false }
  })
}
