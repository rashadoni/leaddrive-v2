import { createHash, randomUUID } from "node:crypto"
import bcrypt from "bcryptjs"
import { credentialSetupHint, credentialSetupRequestHash, mintCredentialSetup, verifyCredentialSetup, type CredentialSetupContext } from "./credential-setup.js"
import type { IdentityPhoneProof, Prisma } from "@prisma/client"
import { assertIdentityRequestId, assertIdentityScope, IdentityRegistryError } from "./contract.js"
import { phoneProofAttemptHash, sealPhoneProof, verifyPhoneProofCode, type PhoneProofContext, type PhoneProofKey, type SealedPhoneProof } from "./phone-proof.js"
import { withRegistryTransaction, type RegistryClient, type IdentityActor } from "./registry.js"

export type StagedProofIssue = { userId: string; reservationId: string; expectedAccountVersion: number; expectedCredentialEpoch: number; requestId: string }
export type StagedProofAttempt = { proofId: string; requestId: string; code: string }
/** Server-owned, tenant-scoped key ring. Never populate it from request data. */
export type PhoneProofKeyResolver = (keyId: string) => PhoneProofKey | null
const digest = (input: unknown[]) => createHash("sha256").update(JSON.stringify(input)).digest("hex")
const metadata = { mode: "SHADOW" as const, authenticationChanged: false as const }

function exact(input: object, names: string[]) {
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).length !== names.length || names.some(name => !Object.hasOwn(input, name))) throw new IdentityRegistryError("IDENTITY_PROOF_INPUT_INVALID")
}
function version(value: number) { return Number.isInteger(value) && value > 0 && value <= 2_147_483_647 }
function context(row: IdentityPhoneProof): PhoneProofContext {
  return { organizationId: row.organizationId, userId: row.userId, reservationId: row.reservationId, challengeId: row.id, normalizedPhone: row.normalizedPhone,
    accountVersion: row.accountVersion, credentialEpoch: row.credentialEpoch, createdAt: row.createdAt.toISOString(), expiresAt: row.expiresAt.toISOString() }
}
async function clock(tx: Prisma.TransactionClient) { return (await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`)[0].now }
async function subject(tx: Prisma.TransactionClient, organizationId: string, userId: string) {
  const [person] = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM users WHERE "organizationId" = ${organizationId} AND id = ${userId} AND "isActive" AND "anonymizedAt" IS NULL FOR SHARE`
  if (!person) throw new IdentityRegistryError("IDENTITY_SUBJECT_UNAVAILABLE")
  const account = await tx.identityAccount.findUnique({ where: { organizationId_userId: { organizationId, userId } }, select: { version: true, credentialEpoch: true, cutoverAt: true } })
  if (!account) throw new IdentityRegistryError("IDENTITY_STAGE_REQUIRED")
  if (account.cutoverAt) throw new IdentityRegistryError("IDENTITY_ALREADY_AUTHORITATIVE")
  const links = await tx.mtmAgent.findMany({ where: { organizationId, userId }, select: { id: true }, take: 2 })
  if (links.length > 1) throw new IdentityRegistryError("IDENTITY_LEGACY_LINK_AMBIGUOUS")
  return account
}
/** No authorization by itself: proof and delivery methods apply their own guard inside this transaction. */
async function proofTransaction<T>(client: RegistryClient, organizationId: string, activeCompany: boolean, work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  assertIdentityScope(organizationId, "phone-proof")
  return client.$transaction(async tx => {
    await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '5s'")
    await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '3s'")
    await tx.$queryRaw`SELECT set_config('app.org_id', ${organizationId}, true), set_config('app.rls_bypass', 'off', true)`
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'identity-registry:' + organizationId}, 0))`
    const [company] = await tx.$queryRaw<Array<{ isActive: boolean }>>`SELECT "isActive" FROM organizations WHERE id = ${organizationId} FOR SHARE`
    if (!company || (activeCompany && !company.isActive)) throw new IdentityRegistryError("IDENTITY_COMPANY_UNAVAILABLE")
    return work(tx)
  }, { isolationLevel: "ReadCommitted", timeout: 15_000, maxWait: 5_000 })
}
async function issuer(tx: Prisma.TransactionClient, proof: IdentityPhoneProof) {
  const [admin] = await tx.$queryRaw<Array<{ role: string }>>`SELECT role FROM users WHERE "organizationId" = ${proof.organizationId} AND id = ${proof.issuedByUserId} AND "isActive" AND "anonymizedAt" IS NULL FOR SHARE`
  if (!admin || !["admin", "superadmin"].includes(admin.role)) throw new IdentityRegistryError("IDENTITY_PROOF_AUTHORITY_UNAVAILABLE")
}
async function suppress(tx: Prisma.TransactionClient, organizationId: string, proofIds: string[], status: "EXPIRED" | "SUPERSEDED") {
  if (!proofIds.length) return
  await tx.identityPhoneProof.updateMany({ where: { organizationId, id: { in: proofIds }, status: "PENDING" }, data: { status, deliveryCiphertext: null } })
  await tx.identityPhoneProofOutbox.updateMany({ where: { organizationId, proofId: { in: proofIds }, status: { in: ["PENDING", "LEASED"] } }, data: { status } })
}

/** Atomically queue an encrypted proof for an existing staged reservation. No transport call or plaintext response. */
export async function issueStagedPhoneProof(client: RegistryClient, actor: IdentityActor, input: StagedProofIssue, key: PhoneProofKey) {
  exact(input, ["userId", "reservationId", "expectedAccountVersion", "expectedCredentialEpoch", "requestId"])
  assertIdentityScope(actor.organizationId, input.userId); assertIdentityRequestId(input.reservationId); assertIdentityRequestId(input.requestId)
  if (!version(input.expectedAccountVersion) || !version(input.expectedCredentialEpoch)) throw new IdentityRegistryError("IDENTITY_PROOF_INPUT_INVALID")
  const requestHash = digest([1, "PHONE_PROOF_ISSUED", actor.organizationId, actor.userId, input.userId, input.reservationId, input.expectedAccountVersion, input.expectedCredentialEpoch])
  return withRegistryTransaction(client, actor, false, async tx => {
    const account = await subject(tx, actor.organizationId, input.userId), now = await clock(tx)
    const event = await tx.identityEvent.findUnique({ where: { organizationId_requestId: { organizationId: actor.organizationId, requestId: input.requestId } } })
    if (event) {
      if (event.action !== "PHONE_PROOF_ISSUED" || event.requestHash !== requestHash || !event.proofId || !event.proofExpiresAt) throw new IdentityRegistryError("IDENTITY_REQUEST_REUSED")
      const existing = await tx.identityPhoneProof.findFirst({ where: { id: event.proofId, organizationId: actor.organizationId, userId: input.userId } })
      const status = !existing || event.proofExpiresAt <= now ? "EXPIRED" : existing.status === "PENDING" && (account.version !== existing.accountVersion || account.credentialEpoch !== existing.credentialEpoch) ? "STALE" : existing.status
      return { ...metadata, status, proofId: event.proofId, expiresAt: event.proofExpiresAt.toISOString(), replayed: true }
    }
    if (account.version !== input.expectedAccountVersion || account.credentialEpoch !== input.expectedCredentialEpoch) throw new IdentityRegistryError("IDENTITY_PROOF_STALE")
    const reservation = await tx.identityPhoneReservation.findFirst({ where: { organizationId: actor.organizationId, userId: input.userId, id: input.reservationId } })
    if (!reservation || reservation.expiresAt <= now) throw new IdentityRegistryError("IDENTITY_PHONE_RESERVATION_EXPIRED")
    if (reservation.expectedAccountVersion !== account.version || reservation.expectedCredentialEpoch !== account.credentialEpoch) throw new IdentityRegistryError("IDENTITY_PROOF_STALE")
    if (await tx.identityPhoneClaim.findUnique({ where: { organizationId_normalizedPhone: { organizationId: actor.organizationId, normalizedPhone: reservation.normalizedPhone } } })) throw new IdentityRegistryError("IDENTITY_PHONE_UNAVAILABLE")
    const previous = await tx.identityPhoneProof.findMany({ where: { organizationId: actor.organizationId, reservationId: reservation.id }, orderBy: { createdAt: "desc" }, take: 20 })
    if (previous[0] && now.valueOf() - previous[0].createdAt.valueOf() < 60_000) throw new IdentityRegistryError("IDENTITY_PROOF_RESEND_LATER")
    await suppress(tx, actor.organizationId, previous.map(row => row.id), "SUPERSEDED")
    const id = randomUUID(), expiresAt = new Date(Math.min(reservation.expiresAt.valueOf(), now.valueOf() + 600_000))
    const frozen: PhoneProofContext = { organizationId: actor.organizationId, userId: input.userId, reservationId: reservation.id, challengeId: id,
      normalizedPhone: reservation.normalizedPhone, accountVersion: account.version, credentialEpoch: account.credentialEpoch, createdAt: now.toISOString(), expiresAt: expiresAt.toISOString() }
    const sealed = sealPhoneProof(frozen, key)
    await tx.identityPhoneProof.create({ data: { id, organizationId: actor.organizationId, userId: input.userId, issuedByUserId: actor.userId, reservationId: reservation.id,
      normalizedPhone: reservation.normalizedPhone, accountVersion: account.version, credentialEpoch: account.credentialEpoch, createdAt: now, expiresAt, ...sealed } })
    await tx.identityPhoneProofOutbox.create({ data: { organizationId: actor.organizationId, userId: input.userId, proofId: id, availableAt: now } })
    await tx.identityEvent.create({ data: { id: randomUUID(), organizationId: actor.organizationId, userId: input.userId, actorUserId: actor.userId, requestId: input.requestId,
      requestHash, action: "PHONE_PROOF_ISSUED", accountVersion: account.version, credentialEpoch: account.credentialEpoch, normalizedPhone: reservation.normalizedPhone,
      reservationId: reservation.id, proofId: id, proofExpiresAt: expiresAt, createdAt: now } })
    return { ...metadata, status: "PENDING", proofId: id, expiresAt: expiresAt.toISOString(), replayed: false }
  })
}

async function lockedProof(tx: Prisma.TransactionClient, organizationId: string, id: string) {
  return (await tx.$queryRaw<IdentityPhoneProof[]>`SELECT * FROM identity_phone_proofs WHERE "organizationId" = ${organizationId} AND id = ${id} FOR UPDATE`)[0] ?? null
}
function keyFor(proof: IdentityPhoneProof, resolve: PhoneProofKeyResolver) {
  const key = resolve(proof.keyId)
  if (!key || key.id !== proof.keyId) throw new IdentityRegistryError("IDENTITY_PROOF_KEY_UNAVAILABLE")
  return key
}
const invalid = (replayed = false) => ({ ...metadata, status: "INVALID" as const, replayed })

/**
 * Internal pre-cutover proof consumption, not authentication. HTTP composition
 * must rate-limit first and select the organization/key ring on the server.
 * A successful phone proof changes only the inactive registry; no password,
 * legacy phone, application grant, MFA or session is issued/changed here.
 */
export async function consumeStagedPhoneProof(client: RegistryClient, organizationId: string, input: StagedProofAttempt, resolve: PhoneProofKeyResolver) {
  exact(input, ["proofId", "requestId", "code"])
  assertIdentityRequestId(input.proofId); assertIdentityRequestId(input.requestId)
  if (typeof input.code !== "string" || input.code.length > 64) throw new IdentityRegistryError("IDENTITY_PROOF_INPUT_INVALID")
  return proofTransaction(client, organizationId, true, async tx => {
    const proof = await lockedProof(tx, organizationId, input.proofId)
    if (!proof) return invalid()
    const account = await subject(tx, organizationId, proof.userId)
    await issuer(tx, proof)
    const now = await clock(tx)
    if (now >= proof.expiresAt || now < proof.createdAt) {
      await suppress(tx, organizationId, [proof.id], "EXPIRED")
      return invalid()
    }
    const key = keyFor(proof, resolve), frozen = context(proof)
    // Compute a keyed payload identity, not correctness, before receipt lookup.
    // Every changed retry gets the same reuse error, including the correct code.
    const requestHash = phoneProofAttemptHash(frozen, key, input.requestId, input.code)
    const event = await tx.identityEvent.findUnique({ where: { organizationId_requestId: { organizationId, requestId: input.requestId } } })
    if (event) {
      if (event.requestHash !== requestHash || event.userId !== proof.userId || event.proofId !== proof.id
        || !["PHONE_PROOF_REJECTED", "PHONE_CONFIRMED"].includes(event.action)) throw new IdentityRegistryError("IDENTITY_REQUEST_REUSED")
      if (event.action === "PHONE_PROOF_REJECTED") return invalid(true)
      const currentClaim = await tx.identityPhoneClaim.findUnique({ where: { organizationId_userId: { organizationId, userId: proof.userId } }, select: { id: true } })
      if (!event.claimId || !event.credentialEpoch || currentClaim?.id !== event.claimId || account.version !== event.accountVersion || account.credentialEpoch !== event.credentialEpoch) return invalid(true)
      return { ...metadata, status: "CONFIRMED" as const, claimId: event.claimId, accountVersion: event.accountVersion, credentialEpoch: event.credentialEpoch, replayed: true }
    }
    if (proof.status !== "PENDING" || proof.attempts >= 5 || proof.usedAt) return invalid()
    const reservation = await tx.identityPhoneReservation.findFirst({ where: { organizationId, userId: proof.userId, id: proof.reservationId } })
    if (!reservation || reservation.expiresAt <= now || reservation.normalizedPhone !== proof.normalizedPhone
      || reservation.expectedAccountVersion !== proof.accountVersion || reservation.expectedCredentialEpoch !== proof.credentialEpoch
      || account.version !== proof.accountVersion || account.credentialEpoch !== proof.credentialEpoch) {
      await suppress(tx, organizationId, [proof.id], "SUPERSEDED")
      return invalid()
    }
    const stored: SealedPhoneProof = { keyId: proof.keyId, codeHash: proof.codeHash, deliveryCiphertext: proof.deliveryCiphertext ?? "" }
    if (!verifyPhoneProofCode(frozen, stored, key, input.code, now)) {
      const attempts = proof.attempts + 1, locked = attempts >= 5
      const changed = await tx.identityPhoneProof.updateMany({ where: { organizationId, userId: proof.userId, id: proof.id, status: "PENDING", attempts: proof.attempts },
        data: { attempts, status: locked ? "LOCKED" : "PENDING", ...(locked ? { deliveryCiphertext: null } : {}) } })
      if (changed.count !== 1) throw new IdentityRegistryError("IDENTITY_PROOF_STALE")
      if (locked) await suppress(tx, organizationId, [proof.id], "SUPERSEDED")
      await tx.identityEvent.create({ data: { id: randomUUID(), organizationId, userId: proof.userId, actorUserId: null, requestId: input.requestId, requestHash,
        action: "PHONE_PROOF_REJECTED", accountVersion: account.version, credentialEpoch: account.credentialEpoch, proofId: proof.id,
        proofAttempt: attempts, proofOutcome: "INVALID_CODE", createdAt: now } })
      // Return from the transaction: throwing here would roll back the spent try.
      return invalid()
    }
    if (await tx.identityPhoneClaim.findUnique({ where: { organizationId_normalizedPhone: { organizationId, normalizedPhone: proof.normalizedPhone } }, select: { id: true } })) throw new IdentityRegistryError("IDENTITY_PHONE_UNAVAILABLE")
    if (account.version >= 2_147_483_647 || account.credentialEpoch >= 2_147_483_647) throw new IdentityRegistryError("IDENTITY_VERSION_EXHAUSTED")
    const oldClaim = await tx.identityPhoneClaim.findUnique({ where: { organizationId_userId: { organizationId, userId: proof.userId } }, select: { id: true } })
    const nextVersion = account.version + 1, nextEpoch = account.credentialEpoch + 1, claimId = randomUUID()
    const advanced = await tx.identityAccount.updateMany({ where: { organizationId, userId: proof.userId, version: proof.accountVersion, credentialEpoch: proof.credentialEpoch, cutoverAt: null },
      data: { version: nextVersion, credentialEpoch: nextEpoch } })
    if (advanced.count !== 1) throw new IdentityRegistryError("IDENTITY_PROOF_STALE")
    if (oldClaim) await tx.identityPhoneClaim.delete({ where: { organizationId_userId: { organizationId, userId: proof.userId } } })
    await tx.identityPhoneClaim.create({ data: { id: claimId, organizationId, userId: proof.userId, normalizedPhone: proof.normalizedPhone, accountVersion: nextVersion, verifiedAt: now } })
    const used = await tx.identityPhoneProof.updateMany({ where: { organizationId, userId: proof.userId, id: proof.id, status: "PENDING", attempts: proof.attempts, codeHash: proof.codeHash },
      data: { status: "CONFIRMED", usedAt: now, deliveryCiphertext: null } })
    if (used.count !== 1) throw new IdentityRegistryError("IDENTITY_PROOF_STALE")
    const removed = await tx.identityPhoneReservation.deleteMany({ where: { organizationId, userId: proof.userId, id: proof.reservationId, normalizedPhone: proof.normalizedPhone,
      expectedAccountVersion: proof.accountVersion, expectedCredentialEpoch: proof.credentialEpoch } })
    if (removed.count !== 1) throw new IdentityRegistryError("IDENTITY_PROOF_STALE")
    const pending = await tx.identityPhoneProof.findMany({ where: { organizationId, userId: proof.userId, status: "PENDING" }, select: { id: true }, take: 100 })
    await suppress(tx, organizationId, [proof.id, ...pending.map(row => row.id)], "SUPERSEDED")
    await tx.identityEvent.create({ data: { id: randomUUID(), organizationId, userId: proof.userId, actorUserId: proof.userId, requestId: input.requestId, requestHash,
      action: "PHONE_CONFIRMED", accountVersion: nextVersion, credentialEpoch: nextEpoch, normalizedPhone: proof.normalizedPhone, reservationId: proof.reservationId,
      proofId: proof.id, proofExpiresAt: proof.expiresAt, previousClaimId: oldClaim?.id ?? null, claimId, createdAt: now } })
    return { ...metadata, status: "CONFIRMED" as const, claimId, accountVersion: nextVersion, credentialEpoch: nextEpoch, replayed: false }
  })
}

/** Explicit admin cancellation; it never releases a confirmed phone claim. */
export async function cancelStagedPhoneReservation(client: RegistryClient, actor: IdentityActor, input: { userId: string; reservationId: string; expectedAccountVersion: number; requestId: string }) {
  exact(input, ["userId", "reservationId", "expectedAccountVersion", "requestId"])
  assertIdentityScope(actor.organizationId, input.userId); assertIdentityRequestId(input.reservationId); assertIdentityRequestId(input.requestId)
  if (!version(input.expectedAccountVersion)) throw new IdentityRegistryError("IDENTITY_PROOF_INPUT_INVALID")
  const requestHash = digest([1, "PHONE_RESERVATION_CANCELLED", actor.organizationId, actor.userId, input.userId, input.reservationId, input.expectedAccountVersion])
  return withRegistryTransaction(client, actor, false, async tx => {
    const account = await subject(tx, actor.organizationId, input.userId)
    const event = await tx.identityEvent.findUnique({ where: { organizationId_requestId: { organizationId: actor.organizationId, requestId: input.requestId } } })
    if (event) {
      if (event.action !== "PHONE_RESERVATION_CANCELLED" || event.requestHash !== requestHash) throw new IdentityRegistryError("IDENTITY_REQUEST_REUSED")
      return { ...metadata, status: "CANCELLED" as const, replayed: true }
    }
    if (account.version !== input.expectedAccountVersion) throw new IdentityRegistryError("IDENTITY_ACCOUNT_STALE")
    const reservation = await tx.identityPhoneReservation.findFirst({ where: { organizationId: actor.organizationId, userId: input.userId, id: input.reservationId } })
    if (!reservation) return { ...metadata, status: "ABSENT" as const, replayed: false }
    const proofs = await tx.identityPhoneProof.findMany({ where: { organizationId: actor.organizationId, userId: input.userId, reservationId: reservation.id, status: "PENDING" }, select: { id: true }, take: 100 })
    await suppress(tx, actor.organizationId, proofs.map(row => row.id), "SUPERSEDED")
    await tx.identityPhoneReservation.deleteMany({ where: { organizationId: actor.organizationId, userId: input.userId, id: reservation.id } })
    await tx.identityEvent.create({ data: { id: randomUUID(), organizationId: actor.organizationId, userId: input.userId, actorUserId: actor.userId,
      requestId: input.requestId, requestHash, action: "PHONE_RESERVATION_CANCELLED", accountVersion: account.version, credentialEpoch: account.credentialEpoch,
      reservationId: reservation.id, reservationExpiresAt: reservation.expiresAt } })
    return { ...metadata, status: "CANCELLED" as const, replayed: false }
  })
}

/** Server worker only. Database time and a bounded batch, never client time. */
export async function expireStagedPhoneProofs(client: RegistryClient, organizationId: string, limit = 100) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new IdentityRegistryError("IDENTITY_PROOF_INPUT_INVALID")
  return proofTransaction(client, organizationId, false, async tx => {
    const now = await clock(tx)
    const rows = await tx.identityPhoneProof.findMany({ where: { organizationId, status: "PENDING", expiresAt: { lte: now } }, select: { id: true }, orderBy: [{ expiresAt: "asc" }, { id: "asc" }], take: limit })
    await suppress(tx, organizationId, rows.map(row => row.id), "EXPIRED")
    return { ...metadata, expired: rows.length }
  })
}

/** Private delivery work item: never serialize it through a public endpoint. */
export type StagedProofDelivery = {
  proofId: string; leaseToken: string; leaseUntil: string;
  context: PhoneProofContext; sealed: SealedPhoneProof;
}

/**
 * Trusted server worker only. Exactly one lease permits an external attempt.
 * A lost/expired lease is uncertain, never automatically queued a second time.
 * The transport must enforce leaseUntil before sending and must not retry a
 * provider request after an ambiguous outcome. No transport runs in this unit.
 */
export async function claimStagedPhoneProofDelivery(client: RegistryClient, organizationId: string, proofId: string): Promise<StagedProofDelivery | null> {
  assertIdentityRequestId(proofId)
  return proofTransaction(client, organizationId, true, async tx => {
    const proof = await lockedProof(tx, organizationId, proofId)
    if (!proof) return null
    const row = await tx.identityPhoneProofOutbox.findUnique({ where: { organizationId_proofId: { organizationId, proofId } } })
    if (!row) return null
    const now = await clock(tx)
    if (row.status === "LEASED" && row.leaseUntil && row.leaseUntil <= now) {
      await tx.identityPhoneProofOutbox.update({ where: { organizationId_proofId: { organizationId, proofId } },
        data: { status: "UNCERTAIN", outcome: "LEASE_EXPIRED", settledAt: now } })
      return null
    }
    if (row.status !== "PENDING" || row.attempts !== 0 || row.availableAt > now) return null
    if (proof.status !== "PENDING" || !proof.deliveryCiphertext) return null
    if (now >= proof.expiresAt || now < proof.createdAt) { await suppress(tx, organizationId, [proofId], "EXPIRED"); return null }
    const account = await subject(tx, organizationId, proof.userId)
    await issuer(tx, proof)
    const reservation = await tx.identityPhoneReservation.findFirst({ where: { organizationId, userId: proof.userId, id: proof.reservationId } })
    if (!reservation || reservation.expiresAt <= now || reservation.normalizedPhone !== proof.normalizedPhone
      || reservation.expectedAccountVersion !== proof.accountVersion || reservation.expectedCredentialEpoch !== proof.credentialEpoch
      || account.version !== proof.accountVersion || account.credentialEpoch !== proof.credentialEpoch) {
      await suppress(tx, organizationId, [proofId], "SUPERSEDED"); return null
    }
    const leaseToken = randomUUID(), leaseUntil = new Date(Math.min(now.valueOf() + 30_000, proof.expiresAt.valueOf()))
    const changed = await tx.identityPhoneProofOutbox.updateMany({ where: { organizationId, proofId, status: "PENDING", attempts: 0 },
      data: { status: "LEASED", attempts: 1, leaseToken, leaseUntil } })
    if (changed.count !== 1) throw new IdentityRegistryError("IDENTITY_PROOF_STALE")
    await tx.identityEvent.create({ data: { id: randomUUID(), organizationId, userId: proof.userId, actorUserId: null,
      requestId: `delivery-lease:${digest([leaseToken])}`, requestHash: digest([1, "PHONE_DELIVERY_LEASED", organizationId, proofId, leaseToken]),
      action: "PHONE_DELIVERY_LEASED", accountVersion: proof.accountVersion, credentialEpoch: proof.credentialEpoch,
      proofId, proofOutcome: "LEASED", createdAt: now } })
    return { proofId, leaseToken, leaseUntil: leaseUntil.toISOString(), context: context(proof),
      sealed: { keyId: proof.keyId, codeHash: proof.codeHash, deliveryCiphertext: proof.deliveryCiphertext } }
  })
}

export type StagedProofDeliveryReceipt = {
  proofId: string; leaseToken: string; outcome: "SENT" | "FAILED" | "UNCERTAIN"; providerMessageId: string | null;
}
/**
 * Server-owned lease capability only. A provider acknowledgement records
 * provenance; it never confirms possession or reopens a closed proof/outbox.
 * Receipts may arrive after authority revocation/cancellation/consumption.
 */
export async function recordStagedPhoneProofDelivery(client: RegistryClient, organizationId: string, input: StagedProofDeliveryReceipt) {
  exact(input, ["proofId", "leaseToken", "outcome", "providerMessageId"])
  assertIdentityRequestId(input.proofId)
  if (typeof input.leaseToken !== "string" || input.leaseToken.length !== 36 || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(input.leaseToken)
    || !["SENT", "FAILED", "UNCERTAIN"].includes(input.outcome)
    || (input.providerMessageId !== null && (typeof input.providerMessageId !== "string" || input.providerMessageId.length < 1 || input.providerMessageId.length > 300 || /[^\x21-\x7e]/.test(input.providerMessageId)))
    || (input.outcome === "SENT" && !input.providerMessageId)
    || (input.outcome !== "SENT" && input.providerMessageId !== null)) throw new IdentityRegistryError("IDENTITY_PROOF_INPUT_INVALID")
  const requestHash = digest([1, "PHONE_DELIVERY_RECORDED", organizationId, input.proofId, input.leaseToken, input.outcome, input.providerMessageId])
  return proofTransaction(client, organizationId, false, async tx => {
    const proof = await lockedProof(tx, organizationId, input.proofId)
    const row = await tx.identityPhoneProofOutbox.findUnique({ where: { organizationId_proofId: { organizationId, proofId: input.proofId } } })
    if (!proof || !row || row.attempts !== 1 || row.leaseToken !== input.leaseToken) throw new IdentityRegistryError("IDENTITY_PROOF_DELIVERY_REFUSED")
    const requestId = `delivery-receipt:${digest([input.leaseToken])}`
    const previous = await tx.identityEvent.findUnique({ where: { organizationId_requestId: { organizationId, requestId } } })
    if (previous) {
      if (previous.action !== "PHONE_DELIVERY_RECORDED" || previous.requestHash !== requestHash) throw new IdentityRegistryError("IDENTITY_REQUEST_REUSED")
      return { ...metadata, recorded: true as const, replayed: true }
    }
    const now = await clock(tx)
    const closed = proof.status !== "PENDING" || now >= proof.expiresAt || ["EXPIRED", "SUPERSEDED"].includes(row.status)
    const outcome = closed ? `${input.outcome}_AFTER_CLOSE` : input.outcome
    await tx.identityPhoneProofOutbox.update({ where: { organizationId_proofId: { organizationId, proofId: proof.id } }, data: {
      status: closed ? (row.status === "EXPIRED" ? "EXPIRED" : "SUPERSEDED") : input.outcome,
      outcome, providerMessageId: input.providerMessageId, settledAt: now } })
    if (now >= proof.expiresAt) await suppress(tx, organizationId, [proof.id], "EXPIRED")
    await tx.identityEvent.create({ data: { id: randomUUID(), organizationId, userId: proof.userId, actorUserId: null, requestId, requestHash,
      action: "PHONE_DELIVERY_RECORDED", accountVersion: proof.accountVersion, credentialEpoch: proof.credentialEpoch,
      proofId: proof.id, proofOutcome: outcome, createdAt: now } })
    return { ...metadata, recorded: true as const, replayed: false }
  })
}


async function setupState(tx: Prisma.TransactionClient, organizationId: string, proofId: string) {
  const proof = await lockedProof(tx, organizationId, proofId)
  if (!proof || proof.status !== "CONFIRMED" || !proof.usedAt) throw new IdentityRegistryError("IDENTITY_SETUP_EXPIRED")
  const account = await subject(tx, organizationId, proof.userId)
  await issuer(tx, proof)
  const confirmation = await tx.identityEvent.findFirst({ where: { organizationId, userId: proof.userId, proofId, action: "PHONE_CONFIRMED" } })
  if (!confirmation?.claimId || !confirmation.credentialEpoch) throw new IdentityRegistryError("IDENTITY_SETUP_EXPIRED")
  const currentClaim = await tx.identityPhoneClaim.findUnique({ where: { organizationId_userId: { organizationId, userId: proof.userId } }, select: { id: true } })
  const frozen: CredentialSetupContext = { organizationId, userId: proof.userId, proofId, claimId: confirmation.claimId,
    accountVersion: confirmation.accountVersion, credentialEpoch: confirmation.credentialEpoch,
    confirmedAt: proof.usedAt.toISOString(), expiresAt: proof.expiresAt.toISOString() }
  return { proof, account, currentClaim, frozen, now: await clock(tx) }
}

/**
 * The only public-service composition allowed to mint setup capability: first
 * verify the submitted possession code, then recheck its immutable confirmation.
 * A lost response can replay the same code/request without extending expiry.
 * The returned capability is not a mobile/CRM session and never bypasses MFA.
 */
export async function consumeStagedPhoneProofWithSetup(client: RegistryClient, organizationId: string, input: StagedProofAttempt, resolve: PhoneProofKeyResolver) {
  const result = await consumeStagedPhoneProof(client, organizationId, input, resolve)
  if (result.status !== "CONFIRMED") return result
  return proofTransaction(client, organizationId, true, async tx => {
    const state = await setupState(tx, organizationId, input.proofId)
    if (state.currentClaim?.id !== result.claimId || state.account.version !== result.accountVersion || state.account.credentialEpoch !== result.credentialEpoch) throw new IdentityRegistryError("IDENTITY_SETUP_EXPIRED")
    const setupToken = mintCredentialSetup(state.frozen, keyFor(state.proof, resolve), state.now)
    return { ...result, setupToken, expiresAt: state.frozen.expiresAt }
  })
}

export type StagedCredentialInput = { setupToken: string; password: string; requestId: string }
export type SharedPasswordPolicy = (password: string) => string | null
/**
 * Internal staged credential write, not login/reset of live credentials.
 * `policy` is the server's shared passwordPolicyError, never request data.
 * Hashing is bounded bcrypt cost12 outside the tenant transaction. Both the
 * initial and final transactions validate capability/current authority; an
 * immutable keyed receipt makes identical retries safe despite bcrypt's salt.
 */
export async function setStagedIdentityCredential(client: RegistryClient, organizationId: string, input: StagedCredentialInput,
  resolve: PhoneProofKeyResolver, policy: SharedPasswordPolicy) {
  exact(input, ["setupToken", "password", "requestId"])
  assertIdentityRequestId(input.requestId)
  if (typeof input.password !== "string" || input.password.length > 72 || Buffer.byteLength(input.password, "utf8") > 72) throw new IdentityRegistryError("IDENTITY_PASSWORD_WEAK")
  const hint = credentialSetupHint(input.setupToken)
  if (!hint) throw new IdentityRegistryError("IDENTITY_SETUP_EXPIRED")
  if (policy(input.password)) throw new IdentityRegistryError("IDENTITY_PASSWORD_WEAK")
  const verify = async (tx: Prisma.TransactionClient) => {
    const state = await setupState(tx, organizationId, hint.proofId)
    const key = keyFor(state.proof, resolve)
    if (hint.keyId !== key.id || !verifyCredentialSetup(state.frozen, key, input.setupToken, state.now)) throw new IdentityRegistryError("IDENTITY_SETUP_EXPIRED")
    const requestHash = credentialSetupRequestHash(state.frozen, key, input.requestId, input.password)
    const previous = await tx.identityEvent.findUnique({ where: { organizationId_requestId: { organizationId, requestId: input.requestId } } })
    if (previous) {
      if (previous.action !== "CREDENTIAL_STAGED" || previous.requestHash !== requestHash || previous.proofId !== state.proof.id || previous.userId !== state.proof.userId) throw new IdentityRegistryError("IDENTITY_REQUEST_REUSED")
      if (state.currentClaim?.id !== previous.claimId || state.account.version !== previous.accountVersion || state.account.credentialEpoch !== previous.credentialEpoch) throw new IdentityRegistryError("IDENTITY_SETUP_EXPIRED")
      return { done: { ...metadata, status: "CREDENTIAL_STAGED" as const, accountVersion: previous.accountVersion, credentialEpoch: previous.credentialEpoch, replayed: true }, state, requestHash }
    }
    if (state.currentClaim?.id !== state.frozen.claimId || state.account.version !== state.frozen.accountVersion || state.account.credentialEpoch !== state.frozen.credentialEpoch) throw new IdentityRegistryError("IDENTITY_SETUP_EXPIRED")
    if (state.account.version >= 2_147_483_647 || state.account.credentialEpoch >= 2_147_483_647) throw new IdentityRegistryError("IDENTITY_VERSION_EXHAUSTED")
    return { done: null, state, requestHash }
  }
  const admitted = await proofTransaction(client, organizationId, true, verify)
  if (admitted.done) return admitted.done
  const passwordHash = await bcrypt.hash(input.password, 12)
  return proofTransaction(client, organizationId, true, async tx => {
    const current = await verify(tx)
    if (current.done) return current.done
    const { state, requestHash } = current
    const nextVersion = state.account.version + 1, nextEpoch = state.account.credentialEpoch + 1
    const changed = await tx.identityAccount.updateMany({ where: { organizationId, userId: state.proof.userId, cutoverAt: null,
      version: state.frozen.accountVersion, credentialEpoch: state.frozen.credentialEpoch }, data: { passwordHash, version: nextVersion, credentialEpoch: nextEpoch } })
    if (changed.count !== 1) throw new IdentityRegistryError("IDENTITY_SETUP_EXPIRED")
    const pending = await tx.identityPhoneProof.findMany({ where: { organizationId, userId: state.proof.userId, status: "PENDING" }, select: { id: true }, take: 100 })
    await suppress(tx, organizationId, pending.map(row => row.id), "SUPERSEDED")
    await tx.identityEvent.create({ data: { id: randomUUID(), organizationId, userId: state.proof.userId, actorUserId: state.proof.userId,
      requestId: input.requestId, requestHash, action: "CREDENTIAL_STAGED", accountVersion: nextVersion, credentialEpoch: nextEpoch,
      proofId: state.proof.id, claimId: state.frozen.claimId, createdAt: state.now } })
    return { ...metadata, status: "CREDENTIAL_STAGED" as const, accountVersion: nextVersion, credentialEpoch: nextEpoch, replayed: false }
  })
}
