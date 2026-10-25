/** Only called inside the admitted disposable PostgreSQL foundation fixture. */
import assert from "node:assert/strict"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import bcrypt from "bcryptjs"
import { passwordPolicyError } from "../password-policy.mjs"

export async function checkPhoneProofTransactions({ admin, writer, failing, actor, other, build, checks, phase }) {
  phase("PROOF_TRANSACTION_MODULE_IMPORTS")
  const { stageIdentityAccount, reserveStagedIdentityPhone, readIdentityShadow } = await import(pathToFileURL(resolve(build, "registry.js")).href)
  const { issueStagedPhoneProof: issue, consumeStagedPhoneProof: consume, cancelStagedPhoneReservation: cancel,
    expireStagedPhoneProofs: expire, claimStagedPhoneProofDelivery: lease, recordStagedPhoneProofDelivery: record,
    consumeStagedPhoneProofWithSetup: consumeWithSetup, setStagedIdentityCredential: setCredential } = await import(pathToFileURL(resolve(build, "phone-proof-registry.js")).href)
  const { openPhoneProofDelivery } = await import(pathToFileURL(resolve(build, "phone-proof.js")).href)
  const { dispatchStagedPhoneProof: dispatch } = await import(pathToFileURL(resolve(build, "phone-proof-dispatch.js")).href)
  const org = actor.organizationId, key = { id: "synthetic-worker-key", material: new Uint8Array(32).fill(13) }
  const resolveKey = id => id === key.id ? key : null
  let counter = 0
  async function setup(label, principal = actor) {
    const userId = `proof-user-${label}`, phone = `+9945599${String(++counter).padStart(5, "0")}`
    await admin.$executeRawUnsafe('INSERT INTO users (id, "organizationId", "isActive", role, phone, "passwordHash") VALUES ($1,$2,true,$3,$4,$5)', userId, org, "viewer", "+994559988777", "legacy-untouched")
    await stageIdentityAccount(writer, principal, { userId, requestId: `proof-stage-${label}` })
    const reservation = await reserveStagedIdentityPhone(writer, principal, { userId, phone, expectedAccountVersion: 1, expectedCredentialEpoch: 1, requestId: `proof-reserve-${label}` })
    const input = { userId, reservationId: reservation.reservationId, expectedAccountVersion: 1, expectedCredentialEpoch: 1, requestId: `proof-issue-${label}` }
    return { userId, phone, input }
  }
  const proofRow = proofId => admin.identityPhoneProof.findUniqueOrThrow({ where: { id: proofId } })
  const outboxRow = proofId => admin.identityPhoneProofOutbox.findUniqueOrThrow({ where: { organizationId_proofId: { organizationId: org, proofId } } })
  async function secret(proofId) {
    const p = await proofRow(proofId)
    const frozen = { organizationId: p.organizationId, userId: p.userId, reservationId: p.reservationId, challengeId: p.id,
      normalizedPhone: p.normalizedPhone, accountVersion: p.accountVersion, credentialEpoch: p.credentialEpoch, createdAt: p.createdAt.toISOString(), expiresAt: p.expiresAt.toISOString() }
    return openPhoneProofDelivery(frozen, p, key, new Date())
  }
  const attempt = (proofId, code, requestId) => consume(writer, org, { proofId, code, requestId }, resolveKey)
  const account = userId => admin.identityAccount.findUniqueOrThrow({ where: { organizationId_userId: { organizationId: org, userId } } })

  phase("PROOF_ISSUE_AUTHORIZATION_AND_ATOMIC_QUEUE")
  const good = await setup("good")
  await assert.rejects(issue(writer, { ...actor, userId: "identity-user-a2" }, good.input, key), /IDENTITY_ADMIN_REQUIRED/)
  await assert.rejects(issue(writer, other, good.input, key), /IDENTITY_SUBJECT_UNAVAILABLE/)
  await assert.rejects(issue(writer, actor, { ...good.input, expectedCredentialEpoch: 2 }, key), /IDENTITY_PROOF_STALE/)
  await assert.rejects(issue(writer, actor, { ...good.input, phone: good.phone }, key), /IDENTITY_PROOF_INPUT_INVALID/)
  const issued = await issue(writer, actor, good.input, key)
  assert.equal(issued.authenticationChanged, false); assert.equal(issued.status, "PENDING")
  assert.equal(JSON.stringify(issued).includes(good.phone), false)
  assert.equal((await outboxRow(issued.proofId)).status, "PENDING")
  assert.equal((await issue(writer, actor, good.input, key)).replayed, true)
  await assert.rejects(issue(writer, actor, { ...good.input, requestId: "too-soon-resend" }, key), /IDENTITY_PROOF_RESEND_LATER/)
  assert.equal(await admin.identityPhoneClaim.count({ where: { organizationId: org, userId: good.userId } }), 0)
  checks.push("proof_issue_requires_current_admin_versions_and_atomically_queues_only_encrypted_delivery")

  phase("PROOF_ATTEMPT_LIMIT_AND_REPLAY_ORACLE")
  const bad = await setup("attempts"), badProof = await issue(writer, actor, bad.input, key), correct = await secret(badProof.proofId)
  const wrong = correct === "000000" ? "111111" : "000000"
  assert.equal((await attempt(badProof.proofId, wrong, "wrong-first")).status, "INVALID")
  assert.equal((await attempt(badProof.proofId, wrong, "wrong-first")).replayed, true)
  await assert.rejects(attempt(badProof.proofId, "not-a-code", "wrong-first"), /IDENTITY_REQUEST_REUSED/)
  await assert.rejects(attempt(badProof.proofId, correct, "wrong-first"), /IDENTITY_REQUEST_REUSED/)
  assert.equal((await proofRow(badProof.proofId)).attempts, 1)
  for (let n = 2; n <= 5; n++) assert.equal((await attempt(badProof.proofId, wrong, `wrong-${n}`)).status, "INVALID")
  const locked = await proofRow(badProof.proofId)
  assert.equal(locked.status, "LOCKED"); assert.equal(locked.attempts, 5); assert.equal(locked.deliveryCiphertext, null)
  assert.equal((await attempt(badProof.proofId, correct, "correct-after-lock")).status, "INVALID")
  assert.equal((await account(bad.userId)).credentialEpoch, 1)
  checks.push("wrong_attempts_commit_max_five_and_changed_retry_cannot_become_code_oracle")

  phase("PROOF_DELIVERY_IS_NOT_POSSESSION")
  // A client knows proofId, but cannot preplant a system audit receipt using
  // the old predictable namespace and block a private lease/provider outcome.
  const interferenceCode = await secret(issued.proofId)
  const interferenceWrong = interferenceCode === "000000" ? "111111" : "000000"
  assert.equal((await attempt(issued.proofId, interferenceWrong, `delivery-lease:${issued.proofId}`)).status, "INVALID")
  const jobs = await Promise.all([lease(writer, org, issued.proofId), lease(writer, org, issued.proofId)])
  assert.equal(jobs.filter(Boolean).length, 1)
  const job = jobs.find(Boolean), code = openPhoneProofDelivery(job.context, job.sealed, key, new Date())
  const sent = { proofId: issued.proofId, leaseToken: job.leaseToken, outcome: "SENT", providerMessageId: "synthetic-provider-receipt" }
  await assert.rejects(record(writer, org, { ...sent, leaseToken: "00000000-0000-4000-8000-000000000000" }), /IDENTITY_PROOF_DELIVERY_REFUSED/)
  assert.equal((await attempt(issued.proofId, interferenceWrong, `delivery-receipt:${issued.proofId}`)).status, "INVALID")
  assert.equal((await record(writer, org, sent)).replayed, false)
  assert.equal((await record(writer, org, sent)).replayed, true)
  await assert.rejects(record(writer, org, { ...sent, providerMessageId: "changed-receipt" }), /IDENTITY_REQUEST_REUSED/)
  assert.equal(await lease(writer, org, issued.proofId), null)
  assert.equal(await admin.identityPhoneClaim.count({ where: { organizationId: org, userId: good.userId } }), 0)
  checks.push("delivery_has_one_private_lease_idempotent_capability_receipt_and_never_proves_possession")

  phase("PROOF_CONFIRMATION_ATOMIC_AND_SINGLE_USE")
  const old = await admin.identityPhoneClaim.create({ data: { organizationId: org, userId: good.userId, normalizedPhone: "+994559988776", accountVersion: 1, verifiedAt: new Date() } })
  const results = await Promise.all([attempt(issued.proofId, code, "correct-once"), attempt(issued.proofId, code, "correct-once")])
  assert.equal(results.every(r => r.status === "CONFIRMED"), true)
  assert.equal(results.filter(r => !r.replayed).length, 1)
  assert.equal((await attempt(issued.proofId, code, "second-consumption")).status, "INVALID")
  const confirmed = await proofRow(issued.proofId), changed = await account(good.userId)
  assert.equal(confirmed.status, "CONFIRMED"); assert.equal(confirmed.deliveryCiphertext, null)
  assert.equal(changed.version, 2); assert.equal(changed.credentialEpoch, 2); assert.equal(changed.passwordHash, null); assert.equal(changed.cutoverAt, null)
  const claims = await admin.identityPhoneClaim.findMany({ where: { organizationId: org, userId: good.userId } })
  assert.equal(claims.length, 1); assert.equal(claims[0].normalizedPhone, good.phone); assert.notEqual(claims[0].id, old.id)
  await assert.rejects(admin.identityEvent.create({ data: { id: "duplicate-proof-confirmation", organizationId: org, userId: good.userId, actorUserId: good.userId,
    requestId: "duplicate-proof-confirmation", requestHash: "b".repeat(64), action: "PHONE_CONFIRMED", accountVersion: 2, credentialEpoch: 2,
    proofId: issued.proofId, claimId: claims[0].id, normalizedPhone: good.phone } }), error => error?.code === "P2002")
  assert.equal(await admin.identityPhoneReservation.count({ where: { id: good.input.reservationId } }), 0)
  const legacy = await admin.$queryRawUnsafe('SELECT phone, "passwordHash", role FROM users WHERE id = $1', good.userId)
  assert.deepEqual(legacy[0], { phone: "+994559988777", passwordHash: "legacy-untouched", role: "viewer" })
  assert.equal(await admin.identityApplicationGrant.count({ where: { organizationId: org, userId: good.userId } }), 0)
  assert.equal((await cancel(writer, actor, { userId: good.userId, reservationId: good.input.reservationId, expectedAccountVersion: 2, requestId: "cancel-consumed" })).status, "ABSENT")
  assert.equal(await admin.identityPhoneClaim.count({ where: { organizationId: org, userId: good.userId } }), 1)
  checks.push("single_use_confirmation_replaces_claim_and_epochs_atomically_without_legacy_password_role_or_grant_change")

  phase("PROOF_STALE_SCOPE_AND_AUTHORITY")
  const stale = await setup("stale"), staleProof = await issue(writer, actor, stale.input, key), staleCode = await secret(staleProof.proofId)
  assert.equal((await consume(writer, other.organizationId, { proofId: staleProof.proofId, code: staleCode, requestId: "cross-tenant-proof" }, resolveKey)).status, "INVALID")
  await admin.identityAccount.update({ where: { organizationId_userId: { organizationId: org, userId: stale.userId } }, data: { credentialEpoch: 2 } })
  assert.equal((await attempt(staleProof.proofId, staleCode, "stale-epoch-proof")).status, "INVALID")
  assert.equal((await proofRow(staleProof.proofId)).status, "SUPERSEDED")
  const staleVersion = await setup("version"), versionProof = await issue(writer, actor, staleVersion.input, key), versionCode = await secret(versionProof.proofId)
  await assert.rejects(consume(writer, org, { proofId: versionProof.proofId, code: versionCode, requestId: "missing-server-key" }, () => null), /IDENTITY_PROOF_KEY_UNAVAILABLE/)
  assert.equal((await proofRow(versionProof.proofId)).attempts, 0)
  await admin.identityAccount.update({ where: { organizationId_userId: { organizationId: org, userId: staleVersion.userId } }, data: { version: 2 } })
  assert.equal(await lease(writer, org, versionProof.proofId), null)
  assert.equal((await attempt(versionProof.proofId, versionCode, "stale-account-version")).status, "INVALID")
  const revoked = await setup("revoked"), revokedProof = await issue(writer, actor, revoked.input, key), revokedCode = await secret(revokedProof.proofId)
  await admin.$executeRawUnsafe("UPDATE users SET role = 'manager' WHERE id = $1", actor.userId)
  try {
    await assert.rejects(attempt(revokedProof.proofId, revokedCode, "revoked-issuer-consume"), /IDENTITY_PROOF_AUTHORITY_UNAVAILABLE/)
    await assert.rejects(lease(writer, org, revokedProof.proofId), /IDENTITY_PROOF_AUTHORITY_UNAVAILABLE/)
  } finally { await admin.$executeRawUnsafe("UPDATE users SET role = 'admin' WHERE id = $1", actor.userId) }
  await admin.$executeRawUnsafe('UPDATE organizations SET "isActive" = false WHERE id = $1', org)
  try { await assert.rejects(attempt(revokedProof.proofId, revokedCode, "inactive-company-consume"), /IDENTITY_COMPANY_UNAVAILABLE/) }
  finally { await admin.$executeRawUnsafe('UPDATE organizations SET "isActive" = true WHERE id = $1', org) }
  await admin.$executeRawUnsafe('UPDATE users SET "isActive" = false WHERE id = $1', revoked.userId)
  try { await assert.rejects(attempt(revokedProof.proofId, revokedCode, "inactive-subject-consume"), /IDENTITY_SUBJECT_UNAVAILABLE/) }
  finally { await admin.$executeRawUnsafe('UPDATE users SET "isActive" = true WHERE id = $1', revoked.userId) }
  checks.push("proof_consumption_rechecks_tenant_current_epoch_issuer_company_and_subject")

  phase("PROOF_CANCELLATION_AND_LATE_DELIVERY")
  const cancelled = await setup("cancelled"), cancelledProof = await issue(writer, actor, cancelled.input, key), cancelCode = await secret(cancelledProof.proofId)
  const cancelJob = await lease(writer, org, cancelledProof.proofId)
  const cancelInput = { userId: cancelled.userId, reservationId: cancelled.input.reservationId, expectedAccountVersion: 1, requestId: "cancel-pending" }
  assert.equal((await cancel(writer, actor, cancelInput)).status, "CANCELLED")
  assert.equal((await cancel(writer, actor, cancelInput)).replayed, true)
  assert.equal((await attempt(cancelledProof.proofId, cancelCode, "cancelled-code")).status, "INVALID")
  assert.equal((await record(writer, org, { proofId: cancelledProof.proofId, leaseToken: cancelJob.leaseToken, outcome: "SENT", providerMessageId: "late-synthetic-ack" })).recorded, true)
  assert.equal((await outboxRow(cancelledProof.proofId)).status, "SUPERSEDED")
  assert.equal((await outboxRow(cancelledProof.proofId)).outcome, "SENT_AFTER_CLOSE")
  assert.equal((await proofRow(cancelledProof.proofId)).deliveryCiphertext, null)
  assert.equal(await lease(writer, org, cancelledProof.proofId), null)
  assert.equal(await admin.identityPhoneClaim.count({ where: { organizationId: org, userId: cancelled.userId } }), 0)
  checks.push("explicit_cancellation_scrubs_secret_and_late_delivery_cannot_reopen_or_claim")

  phase("PROOF_UNCERTAIN_SEND_IS_NEVER_RETRIED")
  const uncertain = await setup("uncertain"), uncertainProof = await issue(writer, actor, uncertain.input, key)
  const uncertainJob = await lease(writer, org, uncertainProof.proofId)
  await admin.identityPhoneProofOutbox.update({ where: { organizationId_proofId: { organizationId: org, proofId: uncertainProof.proofId } }, data: { leaseUntil: new Date(Date.now() - 1000) } })
  assert.equal(await lease(writer, org, uncertainProof.proofId), null)
  assert.equal((await outboxRow(uncertainProof.proofId)).status, "UNCERTAIN")
  assert.equal(await lease(writer, org, uncertainProof.proofId), null)
  await record(writer, org, { proofId: uncertainProof.proofId, leaseToken: uncertainJob.leaseToken, outcome: "UNCERTAIN", providerMessageId: null })
  assert.equal((await outboxRow(uncertainProof.proofId)).attempts, 1)
  checks.push("expired_or_ambiguous_delivery_lease_is_not_requeued")

  phase("PROOF_AUDIT_FAILURE_ROLLS_BACK_EVERY_SECURITY_WRITE")
  const rollback = await setup("rollback")
  await assert.rejects(issue(failing, actor, rollback.input, key), /SYNTHETIC_AUDIT_FAILURE/)
  assert.equal(await admin.identityPhoneProof.count({ where: { organizationId: org, userId: rollback.userId } }), 0)
  const rollbackProof = await issue(writer, actor, rollback.input, key), rollbackCode = await secret(rollbackProof.proofId)
  const badCode = rollbackCode === "000000" ? "111111" : "000000"
  await assert.rejects(consume(failing, org, { proofId: rollbackProof.proofId, code: badCode, requestId: "rollback-wrong" }, resolveKey), /SYNTHETIC_AUDIT_FAILURE/)
  assert.equal((await proofRow(rollbackProof.proofId)).attempts, 0)
  const rollbackOld = await admin.identityPhoneClaim.create({ data: { organizationId: org, userId: rollback.userId, normalizedPhone: "+994559988775", accountVersion: 1, verifiedAt: new Date() } })
  await assert.rejects(consume(failing, org, { proofId: rollbackProof.proofId, code: rollbackCode, requestId: "rollback-correct" }, resolveKey), /SYNTHETIC_AUDIT_FAILURE/)
  assert.equal((await account(rollback.userId)).version, 1)
  assert.equal((await account(rollback.userId)).credentialEpoch, 1)
  assert.equal((await proofRow(rollbackProof.proofId)).status, "PENDING")
  const rollbackClaims = await admin.identityPhoneClaim.findMany({ where: { organizationId: org, userId: rollback.userId } })
  assert.deepEqual(rollbackClaims.map(row => row.id), [rollbackOld.id])
  assert.equal(await admin.identityPhoneReservation.count({ where: { id: rollback.input.reservationId } }), 1)
  await assert.rejects(lease(failing, org, rollbackProof.proofId), /SYNTHETIC_AUDIT_FAILURE/)
  assert.equal((await outboxRow(rollbackProof.proofId)).attempts, 0)
  const rollbackJob = await lease(writer, org, rollbackProof.proofId)
  await assert.rejects(record(failing, org, { proofId: rollbackProof.proofId, leaseToken: rollbackJob.leaseToken, outcome: "SENT", providerMessageId: "rollback-ack" }), /SYNTHETIC_AUDIT_FAILURE/)
  assert.equal((await outboxRow(rollbackProof.proofId)).status, "LEASED")
  await assert.rejects(cancel(failing, actor, { userId: rollback.userId, reservationId: rollback.input.reservationId, expectedAccountVersion: 1, requestId: "rollback-cancel" }), /SYNTHETIC_AUDIT_FAILURE/)
  assert.equal((await proofRow(rollbackProof.proofId)).status, "PENDING")
  assert.notEqual((await proofRow(rollbackProof.proofId)).deliveryCiphertext, null)
  checks.push("proof_issue_attempt_confirmation_lease_receipt_and_cancel_all_roll_back_on_audit_failure")

  phase("PROOF_RESEND_SUPERSEDES_AND_CANCEL_CONFIRM_RACE")
  const resend = await setup("resend"), firstProof = await issue(writer, actor, resend.input, key)
  await admin.$executeRawUnsafe('UPDATE identity_phone_proofs SET "createdAt" = now() - interval \'2 minutes\', "expiresAt" = now() + interval \'7 minutes\' WHERE id = $1', firstProof.proofId)
  const secondProof = await issue(writer, actor, { ...resend.input, requestId: "explicit-resend" }, key)
  assert.notEqual(secondProof.proofId, firstProof.proofId)
  assert.equal((await proofRow(firstProof.proofId)).status, "SUPERSEDED")
  assert.equal((await proofRow(firstProof.proofId)).deliveryCiphertext, null)
  assert.equal((await outboxRow(firstProof.proofId)).status, "SUPERSEDED")
  const race = await setup("race"), raceProof = await issue(writer, actor, race.input, key), raceCode = await secret(raceProof.proofId)
  const raced = await Promise.allSettled([
    attempt(raceProof.proofId, raceCode, "race-confirm"),
    cancel(writer, actor, { userId: race.userId, reservationId: race.input.reservationId, expectedAccountVersion: 1, requestId: "race-cancel" }),
  ])
  const confirmedRace = raced[0].status === "fulfilled" && raced[0].value.status === "CONFIRMED"
  assert.equal(await admin.identityPhoneClaim.count({ where: { organizationId: org, userId: race.userId } }), confirmedRace ? 1 : 0)
  assert.equal((await proofRow(raceProof.proofId)).status, confirmedRace ? "CONFIRMED" : "SUPERSEDED")
  assert.equal(raced[0].status, "fulfilled")
  if (confirmedRace) { assert.equal(raced[1].status, "rejected"); assert.equal(raced[1].reason.code, "IDENTITY_ACCOUNT_STALE") }
  else { assert.equal(raced[0].value.status, "INVALID"); assert.equal(raced[1].status, "fulfilled") }
  checks.push("explicit_resend_supersedes_old_secret_and_confirmation_cancellation_race_has_one_outcome")

  phase("PRIVATE_DISPATCH_INTEGRATES_ACTUAL_OUTBOX_WITH_ONE_SYNTHETIC_TRANSPORT")
  const dispatchSubject = await setup("dispatch"), dispatchProof = await issue(writer, actor, dispatchSubject.input, key)
  let transportCalls = 0, transportedCode = null
  const dispatcher = {
    claim: (organizationId, proofId) => lease(writer, organizationId, proofId),
    record: (organizationId, receipt) => record(writer, organizationId, receipt), resolveKey,
    send: async input => {
      assert.equal(input.to, dispatchSubject.phone); assert.equal(input.signal.aborted, false)
      transportCalls++; transportedCode = input.code
      return { status: "SENT", providerMessageId: "synthetic-dispatch-id" }
    },
  }
  const dispatchResults = await Promise.all([dispatch(org, dispatchProof.proofId, dispatcher), dispatch(org, dispatchProof.proofId, dispatcher)])
  assert.deepEqual(dispatchResults.map(row => row.status).sort(), ["SENT", "SKIPPED"])
  assert.equal(transportCalls, 1)
  assert.equal((await outboxRow(dispatchProof.proofId)).attempts, 1)
  assert.equal((await outboxRow(dispatchProof.proofId)).status, "SENT")
  assert.equal(await admin.identityPhoneClaim.count({ where: { organizationId: org, userId: dispatchSubject.userId } }), 0)
  assert.equal((await dispatch(org, dispatchProof.proofId, dispatcher)).status, "SKIPPED")
  assert.equal(transportCalls, 1)
  assert.equal((await attempt(dispatchProof.proofId, transportedCode, "dispatch-possession-confirm")).status, "CONFIRMED")
  checks.push("actual_private_outbox_dispatch_uses_one_synthetic_transport_and_ack_is_not_possession")

  phase("CREDENTIAL_SETUP_REQUIRES_CURRENT_POSSESSION_AND_IS_SINGLE_USE")
  const credential = await setup("credential"), credentialProof = await issue(writer, actor, credential.input, key), credentialCode = await secret(credentialProof.proofId)
  const possession = { proofId: credentialProof.proofId, code: credentialCode, requestId: "credential-confirm" }
  const admitted = await consumeWithSetup(writer, org, possession, resolveKey)
  assert.equal(admitted.status, "CONFIRMED"); assert.equal(typeof admitted.setupToken, "string")
  assert.equal((await consumeWithSetup(writer, org, possession, resolveKey)).setupToken, admitted.setupToken)
  const password = "Synthetic!Credential47"
  const credentialInput = { setupToken: admitted.setupToken, password, requestId: "credential-set-once" }
  await assert.rejects(setCredential(writer, other.organizationId, credentialInput, resolveKey, passwordPolicyError), /IDENTITY_SETUP_EXPIRED/)
  await assert.rejects(setCredential(writer, org, { ...credentialInput, password: "weak" }, resolveKey, passwordPolicyError), /IDENTITY_PASSWORD_WEAK/)
  await assert.rejects(setCredential(writer, org, { ...credentialInput, setupToken: admitted.setupToken + "=" }, resolveKey, passwordPolicyError), /IDENTITY_SETUP_EXPIRED/)
  const credentialResults = await Promise.all([
    setCredential(writer, org, credentialInput, resolveKey, passwordPolicyError),
    setCredential(writer, org, credentialInput, resolveKey, passwordPolicyError),
  ])
  assert.equal(credentialResults.filter(row => !row.replayed).length, 1)
  const storedCredential = await account(credential.userId)
  assert.equal(storedCredential.version, 3); assert.equal(storedCredential.credentialEpoch, 3)
  assert.equal(await bcrypt.compare(password, storedCredential.passwordHash), true)
  assert.equal(await bcrypt.getRounds(storedCredential.passwordHash), 12)
  await assert.rejects(setCredential(writer, org, { ...credentialInput, password: "Synthetic!Credential48" }, resolveKey, passwordPolicyError), /IDENTITY_REQUEST_REUSED/)
  await assert.rejects(setCredential(writer, org, { ...credentialInput, requestId: "credential-spent-token" }, resolveKey, passwordPolicyError), /IDENTITY_SETUP_EXPIRED/)
  assert.equal((await consumeWithSetup(writer, org, possession, resolveKey)).status, "INVALID")
  const credentialLegacy = await admin.$queryRawUnsafe('SELECT phone, "passwordHash", role FROM users WHERE id = $1', credential.userId)
  assert.deepEqual(credentialLegacy[0], { phone: "+994559988777", passwordHash: "legacy-untouched", role: "viewer" })
  assert.equal(await admin.identityApplicationGrant.count({ where: { organizationId: org, userId: credential.userId } }), 0)
  assert.equal(storedCredential.cutoverAt, null)
  const credentialEvent = await admin.identityEvent.findUniqueOrThrow({ where: { organizationId_requestId: { organizationId: org, requestId: credentialInput.requestId } } })
  assert.equal(JSON.stringify(credentialEvent).includes(password), false)
  assert.equal(JSON.stringify(credentialEvent).includes(storedCredential.passwordHash), false)
  assert.equal(JSON.stringify(credentialEvent).includes(admitted.setupToken), false)
  await assert.rejects(admin.identityEvent.create({ data: { ...credentialEvent, id: "duplicate-credential-effect", requestId: "duplicate-credential-effect" } }), error => error?.code === "P2002")
  checks.push("possession_bound_setup_sets_only_staged_cost12_credential_once_with_keyed_replay_and_no_grants_or_legacy_change")

  phase("CREDENTIAL_SETUP_AUDIT_ROLLBACK_AND_STALE_AUTHORITY")
  const credentialRollback = await setup("credential-rollback"), credentialRollbackProof = await issue(writer, actor, credentialRollback.input, key)
  const credentialRollbackCode = await secret(credentialRollbackProof.proofId)
  const rollbackAdmission = await consumeWithSetup(writer, org, { proofId: credentialRollbackProof.proofId, code: credentialRollbackCode, requestId: "credential-rollback-confirm" }, resolveKey)
  const rollbackCredentialInput = { setupToken: rollbackAdmission.setupToken, password, requestId: "credential-rollback-write" }
  await assert.rejects(setCredential(failing, org, rollbackCredentialInput, resolveKey, passwordPolicyError), /SYNTHETIC_AUDIT_FAILURE/)
  const unchangedCredential = await account(credentialRollback.userId)
  assert.equal(unchangedCredential.passwordHash, null); assert.equal(unchangedCredential.version, 2); assert.equal(unchangedCredential.credentialEpoch, 2)
  await admin.$executeRawUnsafe("UPDATE users SET role = 'manager' WHERE id = $1", actor.userId)
  try { await assert.rejects(setCredential(writer, org, rollbackCredentialInput, resolveKey, passwordPolicyError), /IDENTITY_PROOF_AUTHORITY_UNAVAILABLE/) }
  finally { await admin.$executeRawUnsafe("UPDATE users SET role = 'admin' WHERE id = $1", actor.userId) }
  await admin.identityAccount.update({ where: { organizationId_userId: { organizationId: org, userId: credentialRollback.userId } }, data: { credentialEpoch: 3 } })
  await assert.rejects(setCredential(writer, org, rollbackCredentialInput, resolveKey, passwordPolicyError), /IDENTITY_SETUP_EXPIRED/)
  assert.equal((await account(credentialRollback.userId)).passwordHash, null)
  checks.push("credential_setup_refuses_revoked_or_stale_authority_and_failed_audit_rolls_back_hash_and_epochs")

  phase("PROOF_EXPIRY_REPLAY_HAS_FIXED_DEADLINE")
  const expired = await setup("expired"), expiredProof = await issue(writer, actor, expired.input, key), expiredCode = await secret(expiredProof.proofId)
  await admin.$executeRawUnsafe('UPDATE identity_phone_proofs SET "createdAt" = now() - interval \'11 minutes\', "expiresAt" = now() - interval \'1 minute\' WHERE id = $1', expiredProof.proofId)
  assert.equal((await attempt(expiredProof.proofId, expiredCode, "expired-consume")).status, "INVALID")
  assert.equal((await proofRow(expiredProof.proofId)).status, "EXPIRED")
  assert.equal((await issue(writer, actor, expired.input, key)).expiresAt, expiredProof.expiresAt)
  const swept = await setup("swept"), sweptProof = await issue(writer, actor, swept.input, key)
  await admin.$executeRawUnsafe('UPDATE identity_phone_proofs SET "createdAt" = now() - interval \'11 minutes\', "expiresAt" = now() - interval \'1 minute\' WHERE id = $1', sweptProof.proofId)
  assert.equal((await expire(writer, org, 1)).expired, 1)
  assert.equal((await proofRow(sweptProof.proofId)).status, "EXPIRED")
  assert.equal((await proofRow(sweptProof.proofId)).deliveryCiphertext, null)
  assert.equal((await outboxRow(sweptProof.proofId)).status, "EXPIRED")
  checks.push("database_expiry_closes_and_scrubs_proof_without_extending_immutable_deadline")

  phase("CONVERTED_ISSUER_CANNOT_REUSE_LEGACY_ADMIN_ROLE_FOR_STAGING")
  const issuerId = "proof-converted-admin", converted = { organizationId: org, userId: issuerId }
  await admin.$executeRaw`INSERT INTO users (id,"organizationId","isActive",role) VALUES (${issuerId},${org},true,'admin')`
  await stageIdentityAccount(writer, actor, { userId: issuerId, requestId: "proof-stage-converted-admin" })
  const pending = await setup("issuer-marker-pending", converted)
  const pendingProof = await issue(writer, converted, pending.input, key), pendingCode = await secret(pendingProof.proofId)
  const confirmedSubject = await setup("issuer-marker-confirmed", converted)
  const confirmedProof = await issue(writer, converted, confirmedSubject.input, key)
  const capability = await consumeWithSetup(writer, org, { proofId: confirmedProof.proofId, code: await secret(confirmedProof.proofId), requestId: "proof-before-issuer-marker" }, resolveKey)
  assert.equal(typeof capability.setupToken, "string")
  const pendingBefore = await proofRow(pendingProof.proofId), outboxBefore = await outboxRow(pendingProof.proofId)
  const confirmedBefore = await account(confirmedSubject.userId)
  await admin.identityAccount.update({ where: { organizationId_userId: { organizationId: org, userId: issuerId } },
    data: { cutoverAt: new Date(), passwordHash: "!fixture-converted-issuer", version: 2, credentialEpoch: 2 } })
  await assert.rejects(stageIdentityAccount(writer, converted, { userId: pending.userId, requestId: "converted-issuer-stage-refusal" }), /IDENTITY_CANONICAL_ADMIN_CONTEXT_REQUIRED/)
  await assert.rejects(readIdentityShadow(writer, converted, pending.userId), /IDENTITY_CANONICAL_ADMIN_CONTEXT_REQUIRED/)
  await assert.rejects(issue(writer, converted, pending.input, key), /IDENTITY_CANONICAL_ADMIN_CONTEXT_REQUIRED/)
  checks.push("converted_admin_legacy_role_cannot_stage_read_or_issue_even_idempotent_proof_without_canonical_crm_context")

  phase("CONVERTED_ISSUER_REVOKES_OLD_ADMIN_PROOF_DELIVERY_CONFIRM_AND_SETUP")
  await assert.rejects(lease(writer, org, pendingProof.proofId), /IDENTITY_PROOF_AUTHORITY_UNAVAILABLE/)
  await assert.rejects(consume(writer, org, { proofId: pendingProof.proofId, code: pendingCode, requestId: "converted-issuer-confirm-refusal" }, resolveKey), /IDENTITY_PROOF_AUTHORITY_UNAVAILABLE/)
  await assert.rejects(setCredential(writer, org, { setupToken: capability.setupToken, password: "Synthetic!IssuerCredential47", requestId: "converted-issuer-credential-refusal" }, resolveKey, passwordPolicyError), /IDENTITY_PROOF_AUTHORITY_UNAVAILABLE/)
  assert.deepEqual(await proofRow(pendingProof.proofId), pendingBefore)
  assert.deepEqual(await outboxRow(pendingProof.proofId), outboxBefore)
  assert.deepEqual(await account(confirmedSubject.userId), confirmedBefore)
  assert.equal((await readIdentityShadow(writer, actor, pending.userId)).authenticationChanged, false)
  checks.push("issuer_cutover_blocks_private_delivery_correct_pending_code_and_valid_setup_atomically_without_changing_subject_or_outbox")
}
