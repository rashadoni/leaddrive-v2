/** Real contact writes and proof consumption in the admitted disposable DB. */
import assert from "node:assert/strict"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { passwordPolicyError } from "../password-policy.mjs"

export async function checkContactRevision({ admin, writer, actor, build, checks, phase }) {
  const load = file => import(pathToFileURL(resolve(build, `${file}.js`)).href)
  const { stageIdentityAccount, reserveStagedIdentityPhone } = await load("registry")
  const { issueStagedPhoneProof, consumeStagedPhoneProofWithSetup, setStagedIdentityCredential } = await load("phone-proof-registry")
  const { openPhoneProofDelivery } = await load("phone-proof")
  const { withLegacyCredentialWrite } = await load("legacy-credential-write")
  const org = actor.organizationId, key = { id: "contact-fixture", material: new Uint8Array(32).fill(27) }
  const resolveKey = id => id === key.id ? key : null
  let counter = 0
  async function setup(label) {
    const userId = `contact-user-${label}`, actorId = `contact-actor-${label}`, phone = `+99455888${String(++counter).padStart(4, "0")}`
    await admin.$executeRaw`INSERT INTO users (id,"organizationId","isActive",role,phone,"passwordHash") VALUES (${userId},${org},true,'viewer',${phone},'!fixture-old-hash')`
    await admin.$executeRaw`INSERT INTO mtm_agents (id,"organizationId","userId",phone,role,status,"attendanceParticipant") VALUES (${actorId},${org},${userId},${phone},'EMPLOYEE','ACTIVE',true)`
    await stageIdentityAccount(writer, actor, { userId, requestId: `contact-stage-${label}` })
    const reservation = await reserveStagedIdentityPhone(writer, actor, { userId, phone, expectedAccountVersion: 1, expectedCredentialEpoch: 1, requestId: `contact-reserve-${label}` })
    const issued = await issueStagedPhoneProof(writer, actor, { userId, reservationId: reservation.reservationId, expectedAccountVersion: 1, expectedCredentialEpoch: 1, requestId: `contact-issue-${label}` }, key)
    const p = await admin.identityPhoneProof.findUniqueOrThrow({ where: { id: issued.proofId } })
    const context = { organizationId: org, userId, reservationId: p.reservationId, challengeId: p.id, normalizedPhone: p.normalizedPhone,
      accountVersion: p.accountVersion, credentialEpoch: p.credentialEpoch, createdAt: p.createdAt.toISOString(), expiresAt: p.expiresAt.toISOString() }
    const code = openPhoneProofDelivery(context, p, key, new Date())
    return { userId, actorId, phone, attempt: { proofId: p.id, code, requestId: `contact-consume-${label}` } }
  }
  const account = userId => admin.identityAccount.findUniqueOrThrow({ where: { organizationId_userId: { organizationId: org, userId } } })
  async function change(person, source, phone) {
    return withLegacyCredentialWrite(writer, org, [{ kind: "ACTOR", actorId: person.actorId }], tx => source === "user"
      ? tx.$executeRaw`UPDATE users SET phone=${phone} WHERE "organizationId"=${org} AND id=${person.userId}`
      : tx.$executeRaw`UPDATE mtm_agents SET phone=${phone} WHERE "organizationId"=${org} AND id=${person.actorId}`)
  }
  // Temporarily expand this disposable role only for these actual legacy writes.
  await admin.$executeRawUnsafe('GRANT UPDATE (phone,"passwordHash") ON users, mtm_agents TO identity_foundation_writer')
  try {
    for (const source of ["user", "actor"]) {
      phase(`CONTACT_${source.toUpperCase()}_AWAY_RETURN_REFUSES_OLD_CODE`)
      const person = await setup(`code-${source}`)
      await change(person, source, "+994558889999")
      await change(person, source, person.phone)
      const current = await account(person.userId)
      assert.equal(current.contactRevision, 3)
      assert.equal(current.version, 3)
      assert.equal(current.credentialEpoch, 3)
      const result = await consumeStagedPhoneProofWithSetup(writer, org, person.attempt, resolveKey)
      assert.notEqual(result.status, "CONFIRMED")
      assert.equal(await admin.identityPhoneClaim.count({ where: { organizationId: org, userId: person.userId } }), 0)
      await change(person, source, person.phone)
      assert.equal((await account(person.userId)).contactRevision, 3)
      checks.push(`contact_${source}_away_return_invalidates_subject_bound_code_and_identical_write_is_noop`)

      phase(`CONTACT_${source.toUpperCase()}_AWAY_RETURN_REFUSES_OLD_SETUP`)
      const confirmed = await setup(`setup-${source}`)
      const possession = await consumeStagedPhoneProofWithSetup(writer, org, confirmed.attempt, resolveKey)
      assert.equal(possession.status, "CONFIRMED")
      await change(confirmed, source, "+994558889998")
      await change(confirmed, source, confirmed.phone)
      await assert.rejects(setStagedIdentityCredential(writer, org, { setupToken: possession.setupToken, password: "Fictional!Contact482", requestId: `contact-setup-${source}` }, resolveKey, passwordPolicyError), /IDENTITY_SETUP_EXPIRED/)
      assert.equal((await account(confirmed.userId)).passwordHash, null)
      checks.push(`contact_${source}_away_return_invalidates_confirmed_setup_without_changing_legacy_password`)
    }

    for (const source of ["user", "actor"]) {
      phase(`STAGED_${source.toUpperCase()}_PASSWORD_RESET_INVALIDATES_CODE_AND_SETUP`)
      const table = source === "user" ? "users" : "mtm_agents"
      const reset = (person, value) => withLegacyCredentialWrite(writer, org, [{ kind: "ACTOR", actorId: person.actorId }], tx =>
        tx.$executeRawUnsafe(`UPDATE ${table} SET "passwordHash"=$1 WHERE "organizationId"=$2 AND id=$3`, value, org, source === "user" ? person.userId : person.actorId))
      const original = source === "user" ? "!fixture-old-hash" : null
      const pending = await setup(`password-code-${source}`)
      await reset(pending, "!fixture-reset-hash"); await reset(pending, original)
      const advanced = await account(pending.userId)
      assert.equal(advanced.version, 3); assert.equal(advanced.credentialEpoch, 3); assert.equal(advanced.contactRevision, 1)
      assert.notEqual((await consumeStagedPhoneProofWithSetup(writer, org, pending.attempt, resolveKey)).status, "CONFIRMED")
      await reset(pending, original)
      assert.equal((await account(pending.userId)).version, 3)
      const confirmed = await setup(`password-setup-${source}`)
      const possession = await consumeStagedPhoneProofWithSetup(writer, org, confirmed.attempt, resolveKey)
      assert.equal(possession.status, "CONFIRMED")
      await reset(confirmed, "!fixture-reset-hash"); await reset(confirmed, original)
      await assert.rejects(setStagedIdentityCredential(writer, org, { setupToken: possession.setupToken, password: "Fictional!Contact482", requestId: `password-reset-setup-${source}` }, resolveKey, passwordPolicyError), /IDENTITY_SETUP_EXPIRED/)
      assert.equal((await account(confirmed.userId)).passwordHash, null)
      checks.push(`staged_${source}_credential_away_return_invalidates_pending_code_and_confirmed_setup_without_claiming_new_contact`)
    }

    phase("STAGED_CREDENTIAL_AUDIT_FAILURE_ROLLS_BACK_LEGACY_PASSWORD")
    const credentialRollback = await setup("credential-rollback"), credentialBefore = await account(credentialRollback.userId)
    await admin.$executeRawUnsafe("ALTER TABLE identity_events ADD CONSTRAINT staged_credential_audit_refusal CHECK (\"userId\" <> 'contact-user-credential-rollback' OR action <> 'PERSON_LIFECYCLE_CHANGED')")
    try {
      await assert.rejects(admin.$executeRaw`UPDATE users SET "passwordHash"='!fixture-refused-reset' WHERE id=${credentialRollback.userId}`, error => error?.meta?.code === "23514")
      assert.deepEqual(await account(credentialRollback.userId), credentialBefore)
      assert.equal((await admin.user.findUniqueOrThrow({ where: { id: credentialRollback.userId }, select: { passwordHash: true } })).passwordHash, "!fixture-old-hash")
    } finally { await admin.$executeRawUnsafe('ALTER TABLE identity_events DROP CONSTRAINT staged_credential_audit_refusal') }
    checks.push("staged_credential_reset_revision_and_security_receipt_roll_back_together")

    phase("CONTACT_AUDIT_FAILURE_ROLLS_BACK_SOURCE_AND_REVISIONS")
    const rollback = await setup("rollback"), before = await account(rollback.userId)
    await admin.$executeRawUnsafe("ALTER TABLE identity_events ADD CONSTRAINT contact_fixture_audit_refusal CHECK (\"userId\" <> 'contact-user-rollback' OR \"contactRevision\" IS NULL)")
    try {
      await assert.rejects(change(rollback, "user", "+994558889997"), error => error?.meta?.code === "23514")
      assert.deepEqual(await account(rollback.userId), before)
      const [person] = await admin.$queryRaw`SELECT phone FROM users WHERE id=${rollback.userId}`
      assert.equal(person.phone, rollback.phone)
    } finally { await admin.$executeRawUnsafe('ALTER TABLE identity_events DROP CONSTRAINT contact_fixture_audit_refusal') }
    checks.push("contact_source_revision_and_security_receipt_commit_or_rollback_together")

    phase("CONTACT_CANONICAL_LEGACY_WRITE_AND_REVISION_ROLLBACK_REFUSED")
    await admin.identityAccount.update({ where: { organizationId_userId: { organizationId: org, userId: rollback.userId } }, data: {
      cutoverAt: new Date(), passwordHash: "!fixture-canonical-hash", version: { increment: 1 }, credentialEpoch: { increment: 1 },
    } })
    await assert.rejects(admin.$executeRaw`UPDATE users SET phone='+994558889997' WHERE id=${rollback.userId}`, error => error?.meta?.code === "23514")
    await assert.rejects(admin.$executeRaw`UPDATE mtm_agents SET phone='+994558889997' WHERE id=${rollback.actorId}`, error => error?.meta?.code === "23514")
    await assert.rejects(admin.$executeRaw`UPDATE identity_accounts SET "contactRevision"=2 WHERE "organizationId"=${org} AND "userId"=${rollback.userId}`, error => error?.meta?.code === "23514")
    await assert.rejects(admin.$executeRaw`UPDATE identity_accounts SET "contactRevision"=1 WHERE "organizationId"=${org} AND "userId"='contact-user-code-user'`, error => error?.meta?.code === "23514")
    checks.push("canonical_contact_cannot_be_changed_by_legacy_writer_or_revision_without_matching_epochs")
  } finally { await admin.$executeRawUnsafe('REVOKE UPDATE (phone,"passwordHash") ON users, mtm_agents FROM identity_foundation_writer') }
}
