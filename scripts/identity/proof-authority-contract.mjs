/** Canonical invitation authority on the admitted disposable PostgreSQL DB. */
import assert from "node:assert/strict"
import bcrypt from "bcryptjs"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { passwordPolicyError } from "../password-policy.mjs"

export async function checkProofAuthority({ admin, writer, failing, actor, build, checks, phase }) {
  const load = name => import(pathToFileURL(resolve(build, `${name}.js`)).href)
  const registry = await load("registry"), proof = await load("phone-proof-registry")
  const { openPhoneProofDelivery } = await load("phone-proof")
  const { identityProofAuthorityHash } = await load("proof-authority")
  const { authenticateIdentityCrmPassword: login } = await load("crm-session")
  const org = actor.organizationId, issuerId = "proof-v2-issuer", password = "Fictional!IssuerAuth482"
  const key = { id: "authority-fixture", material: new Uint8Array(32).fill(37) }, ring = id => id === key.id ? key : null
  const flagKey = { organizationId_key: { organizationId: org, key: "identityAuthV1" } }
  const originalFlag = await admin.mtmSetting.findUniqueOrThrow({ where: flagKey, select: { value: true } })
  const grantKey = { organizationId_userId_application: { organizationId: org, userId: issuerId, application: "CRM" } }
  const issuerAccount = { organizationId_userId: { organizationId: org, userId: issuerId } }
  let counter = 0
  async function authority() {
    const admitted = await login(writer, org, issuerId, password)
    assert.ok(admitted)
    return { organizationId: org, userId: issuerId, mode: "CANONICAL", claims: admitted.claims }
  }
  async function prepare(label) {
    const userId = `proof-v2-${label}`, phone = `+99455666${String(++counter).padStart(4, "0")}`
    await admin.$executeRaw`INSERT INTO users (id,"organizationId","isActive",role,phone,"passwordHash") VALUES (${userId},${org},true,'viewer',${phone},'!fixture-credential-disabled')`
    const administrator = await authority()
    await registry.stageIdentityAccountByAdministrator(writer, administrator, { userId, requestId: `${userId}-stage` })
    const reservation = await registry.reserveIdentityPhoneByAdministrator(writer, administrator, { userId, phone, expectedAccountVersion: 1, expectedCredentialEpoch: 1, requestId: `${userId}-reserve` })
    return { userId, reservationId: reservation.reservationId, expectedAccountVersion: 1, expectedCredentialEpoch: 1, requestId: `${userId}-issue` }
  }
  async function clearCode(proofId) {
    const row = await admin.identityPhoneProof.findUniqueOrThrow({ where: { id: proofId } })
    const context = { organizationId: org, userId: row.userId, reservationId: row.reservationId, challengeId: row.id,
      normalizedPhone: row.normalizedPhone, accountVersion: row.accountVersion, credentialEpoch: row.credentialEpoch,
      createdAt: row.createdAt.toISOString(), expiresAt: row.expiresAt.toISOString(), version: 2,
      authorityHash: identityProofAuthorityHash(row.issuerAuthority), contactRevision: row.contactRevision }
    return openPhoneProofDelivery(context, row, key, new Date())
  }
  try {
    await admin.mtmSetting.update({ where: flagKey, data: { value: { version: 1, enabled: true } } })
    await admin.$executeRaw`INSERT INTO users (id,"organizationId","isActive",role,"passwordHash") VALUES (${issuerId},${org},true,'viewer','!fixture-credential-disabled')`
    await admin.identityAccount.create({ data: { organizationId: org, userId: issuerId, cutoverAt: new Date(), passwordHash: await bcrypt.hash(password, 12) } })
    await admin.identityPhoneClaim.create({ data: { organizationId: org, userId: issuerId, normalizedPhone: "+994556660099", accountVersion: 1, verifiedAt: new Date() } })
    await admin.identityApplicationGrant.create({ data: { organizationId: org, userId: issuerId, application: "CRM", role: "admin", status: "ACTIVE" } })
    phase("CANONICAL_PROOF_V2_ISSUER_REVOKE_REACTIVATE_AND_IMMUTABILITY")
    const issuer = await authority(), input = await prepare("revoked")
    const issued = await proof.issueCanonicalAdministratorPhoneProof(writer, issuer, input, key)
    const code = await clearCode(issued.proofId)
    await assert.rejects(admin.identityPhoneProof.update({ where: { id: issued.proofId }, data: { contextVersion: 1 } }), /IDENTITY_PROOF_AUTHORITY_IMMUTABLE/)
    await admin.identityApplicationGrant.update({ where: grantKey, data: { status: "REVOKED", version: 2 } })
    await assert.rejects(proof.claimStagedPhoneProofDelivery(writer, org, issued.proofId), /IDENTITY_PROOF_AUTHORITY_UNAVAILABLE/)
    const attempt = { proofId: issued.proofId, code, requestId: "proof-v2-revoked-confirm" }
    await assert.rejects(proof.consumeStagedPhoneProofWithSetup(writer, org, attempt, ring), /IDENTITY_PROOF_AUTHORITY_UNAVAILABLE/)
    await admin.identityApplicationGrant.update({ where: grantKey, data: { status: "ACTIVE", version: 3 } })
    await assert.rejects(proof.consumeStagedPhoneProofWithSetup(writer, org, attempt, ring), /IDENTITY_PROOF_AUTHORITY_UNAVAILABLE/)
    const unspent = await admin.identityPhoneProof.findUniqueOrThrow({ where: { id: issued.proofId } })
    assert.equal(unspent.status, "PENDING"); assert.equal(unspent.attempts, 0)
    assert.equal(await admin.identityPhoneClaim.count({ where: { organizationId: org, userId: input.userId } }), 0)
    checks.push("canonical_proof_v2_cannot_dispatch_consume_or_revive_after_issuer_revoke_reactivate_and_context_is_immutable")

    phase("CANONICAL_PROOF_V2_SETUP_MFA_AWAY_RETURN_AND_FRESH_ISSUANCE")
    const second = await prepare("setup"), freshIssuer = await authority()
    const fresh = await proof.issueCanonicalAdministratorPhoneProof(writer, freshIssuer, second, key)
    const verified = await proof.consumeStagedPhoneProofWithSetup(writer, org, { proofId: fresh.proofId, code: await clearCode(fresh.proofId), requestId: "proof-v2-setup-confirm" }, ring)
    assert.equal(verified.status, "CONFIRMED"); assert.match(verified.setupToken, /^lds2\./)
    const before = await admin.identityAccount.findUniqueOrThrow({ where: issuerAccount })
    await admin.$executeRaw`UPDATE users SET "require2fa"=true WHERE id=${issuerId}`
    await admin.$executeRaw`UPDATE users SET "require2fa"=false WHERE id=${issuerId}`
    assert.equal((await admin.identityAccount.findUniqueOrThrow({ where: issuerAccount })).credentialEpoch, before.credentialEpoch + 2)
    await assert.rejects(proof.setStagedIdentityCredential(writer, org, { setupToken: verified.setupToken, password, requestId: "proof-v2-old-setup" }, ring, passwordPolicyError), /IDENTITY_PROOF_AUTHORITY_UNAVAILABLE/)
    const third = await prepare("fresh"), currentIssuer = await authority()
    await assert.rejects(proof.issueCanonicalAdministratorPhoneProof(failing, currentIssuer, third, key), /SYNTHETIC_AUDIT_FAILURE/)
    assert.equal(await admin.identityPhoneProof.count({ where: { organizationId: org, userId: third.userId } }), 0)
    const final = await proof.issueCanonicalAdministratorPhoneProof(writer, currentIssuer, third, key)
    const finalCode = await clearCode(final.proofId)
    const attempts = await Promise.allSettled(["a", "b"].map(suffix => proof.consumeStagedPhoneProofWithSetup(writer, org, { proofId: final.proofId, code: finalCode, requestId: `proof-v2-race-${suffix}` }, ring)))
    const successes = attempts.filter(row => row.status === "fulfilled" && row.value.status === "CONFIRMED")
    assert.equal(successes.length, 1)
    const credential = await proof.setStagedIdentityCredential(writer, org, { setupToken: successes[0].value.setupToken, password, requestId: "proof-v2-fresh-setup" }, ring, passwordPolicyError)
    assert.equal(credential.status, "CREDENTIAL_STAGED")
    checks.push("canonical_proof_v2_mfa_away_return_revokes_setup_and_fresh_authority_handles_audit_rollback_concurrent_confirmation_and_password_setup")
  } finally {
    await admin.mtmSetting.update({ where: flagKey, data: originalFlag })
  }
}
