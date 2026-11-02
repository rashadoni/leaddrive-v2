import assert from "node:assert/strict"
import { setTimeout as delay } from "node:timers/promises"

/** Disposable real PostgreSQL acceptance. No HTTP backdoor, provider or clock override. */
export async function checkIdentityOnboarding({ load, admin, writer, failing, issuer, runtime, checks, phase, passwordPolicyError }) {
  const onboarding = await load("onboarding"), registry = await load("registry"), membership = await load("membership-registry")
  const proof = await load("phone-proof-registry"), { openPhoneProofDelivery } = await load("phone-proof")
  const { authenticateIdentityMobilePassword: login } = await load("mobile-password-auth")
  const org = issuer.organizationId, application = "ROUTE_FIELD", password = "Fictional!Onboarding482"
  const key = { id: "onboarding-fixture", material: new Uint8Array(32).fill(66) }, ring = id => id === key.id ? key : null
  const signing = { purpose: "IDENTITY_MOBILE_SESSION", id: "onboarding-signing", material: new Uint8Array(32).fill(67) }
  let count = 0
  const account = userId => admin.identityAccount.findUniqueOrThrow({ where: { organizationId_userId: { organizationId: org, userId } } })
  async function fixture(label, addTime = false) {
    const userId = `onboarding-${label}`, actorId = `onboarding-card-${label}`, phone = `+99455776${String(++count).padStart(4, "0")}`
    await admin.$executeRaw`INSERT INTO users (id,"organizationId","isActive",role,phone,"passwordHash") VALUES (${userId},${org},true,'viewer',${phone},'!onboarding-legacy')`
    await admin.$executeRaw`INSERT INTO mtm_agents (id,"organizationId","userId",phone,role,status,"attendanceParticipant","passwordHash") VALUES (${actorId},${org},${userId},${phone},'AGENT','ACTIVE',false,'!onboarding-actor-legacy')`
    await registry.stageIdentityAccountByAdministrator(writer, issuer, { userId, requestId: `${userId}-stage` })
    await registry.planIdentityApplicationByAdministrator(writer, issuer, { userId, application, status: "ACTIVE", role: "AGENT", expectedAccountVersion: 1, expectedGrantVersion: 0, requestId: `${userId}-grant` })
    await membership.reviewIdentityActorByAdministrator(writer, issuer, { userId, actorId, expectedAccountVersion: 2, reviewReference: `${userId}-review`, requestId: `${userId}-binding` })
    await membership.planIdentityMembershipByAdministrator(writer, issuer, { userId, actorId, application, status: "ACTIVE", expectedAccountVersion: 3, expectedGrantVersion: 1, expectedMembershipVersion: 0, requestId: `${userId}-member` })
    const input = { userId, phone, application: addTime ? "TIME" : application,
      ...(addTime ? { timeEnrollment: { position: null, teamId: null, departmentId: null, hireDate: null } } : {}), expectedAccountVersion: 4, expectedCredentialEpoch: 1, expectedContactRevision: 1,
      applications: [{ application, role: "AGENT", status: "ACTIVE", grantVersion: 1, actorId, membershipVersion: 1, membershipStatus: "ACTIVE" }], reviewReference: `${userId}-review`, requestId: `${userId}-intent` }
    const review = await onboarding.createIdentityOnboardingIntent(writer, issuer, input)
    return { userId, actorId, phone, input, review }
  }
  async function issue(f, suffix = "issue") {
    const request = { phone: f.phone, application: f.input.application, requestId: `${f.userId}-${suffix}` }
    const issued = await onboarding.issueIdentityOnboardingProof(writer, org, request, key)
    assert.ok(issued)
    const row = await admin.identityPhoneProof.findUniqueOrThrow({ where: { id: issued.proofId } })
    const code = openPhoneProofDelivery(proof.phoneProofContext(row), row, key, new Date())
    const attempt = { proofId: row.id, phone: f.phone, application: f.input.application, code }
    return { request, issued, row, attempt }
  }
  const finish = (client, setupToken) => onboarding.finishIdentityOnboarding(client, org, { setupToken, password, application }, ring, passwordPolicyError, runtime)

  phase("ONBOARDING_REVIEW_AND_BOUND_POSSESSION")
  const f = await fixture("normal"), before = await account(f.userId)
  assert.equal((await onboarding.createIdentityOnboardingIntent(writer, issuer, f.input)).replayed, true)
  await assert.rejects(onboarding.createIdentityOnboardingIntent(writer, issuer, { ...f.input, phone: "+994557769998" }), /IDENTITY_REQUEST_REUSED/)
  await assert.rejects(onboarding.createIdentityOnboardingIntent(writer, issuer, { ...f.input, organizationId: "foreign" }), /IDENTITY_ONBOARDING_UNAVAILABLE/)
  const issued = await issue(f)
  assert.equal((await onboarding.issueIdentityOnboardingProof(writer, org, issued.request, key)).proofId, issued.row.id)
  await assert.rejects(onboarding.issueIdentityOnboardingProof(writer, org, { ...issued.request, requestId: "onboarding-too-fast" }, key), /IDENTITY_PROOF_RESEND_LATER/)
  await assert.rejects(onboarding.confirmIdentityOnboardingProof(writer, org, { ...issued.attempt, application: "TIME" }, ring), /IDENTITY_ONBOARDING_UNAVAILABLE/)
  await assert.rejects(onboarding.confirmIdentityOnboardingProof(writer, org, { ...issued.attempt, phone: "+994557769999" }, ring), /IDENTITY_ONBOARDING_UNAVAILABLE/)
  assert.equal(await proof.claimStagedPhoneProofDelivery(writer, "identity-company-b", issued.row.id), null)
  await assert.rejects(onboarding.confirmIdentityOnboardingProof(failing, org, issued.attempt, ring), /SYNTHETIC_AUDIT_FAILURE/)
  assert.deepEqual(await account(f.userId), before)
  const confirmed = await onboarding.confirmIdentityOnboardingProof(writer, org, issued.attempt, ring)
  assert.equal(confirmed.status, "CONFIRMED"); assert.ok(confirmed.setupToken.startsWith("lds2."))
  assert.equal((await onboarding.confirmIdentityOnboardingProof(writer, org, issued.attempt, ring)).setupToken, confirmed.setupToken)
  assert.equal((await account(f.userId)).cutoverAt, null)
  assert.equal(await login(writer, org, { phone: f.phone, application, password }, signing), null)
  checks.push("onboarding_review_is_explicit_immutable_tenant_app_phone_bound_and_possession_does_not_activate_a_session")

  phase("ONBOARDING_ATOMIC_CUTOVER_AND_COMPLETION")
  const completionFailure = { $transaction: (callback, options) => writer.$transaction(tx => callback(new Proxy(tx, { get(target, property) {
    if (property === "identityOnboardingIntent") return new Proxy(target.identityOnboardingIntent, { get(delegate, method) {
      if (method === "update") return async args => { if (args.data.status === "COMPLETED") throw new Error("SYNTHETIC_COMPLETION_FAILURE"); return delegate.update(args) }
      return typeof delegate[method] === "function" ? delegate[method].bind(delegate) : delegate[method]
    } })
    return typeof target[property] === "function" ? target[property].bind(target) : target[property]
  } })), options) }
  await assert.rejects(finish(completionFailure, confirmed.setupToken), /SYNTHETIC_COMPLETION_FAILURE/)
  assert.equal((await account(f.userId)).cutoverAt, null)
  assert.equal((await admin.user.findUniqueOrThrow({ where: { id: f.userId }, select: { passwordHash: true } })).passwordHash, "!onboarding-legacy")
  assert.equal((await admin.identityOnboardingIntent.findUniqueOrThrow({ where: { id: f.review.intentId } })).status, "ACTIVE")
  assert.equal(await admin.identityEvent.count({ where: { organizationId: org, userId: f.userId, action: "ACCOUNT_ACTIVATED" } }), 0)
  const done = await finish(writer, confirmed.setupToken)
  assert.equal(done.userId, f.userId)
  assert.ok((await account(f.userId)).cutoverAt)
  assert.equal((await admin.identityOnboardingIntent.findUniqueOrThrow({ where: { id: f.review.intentId } })).status, "COMPLETED")
  assert.deepEqual(await finish(writer, confirmed.setupToken), done)
  assert.ok(await login(writer, org, { phone: f.phone, application, password }, signing))
  assert.equal(await login(writer, org, { phone: f.phone, application: "TIME", password }, signing), null)
  assert.equal((await admin.mtmAgent.findUniqueOrThrow({ where: { id: f.actorId }, select: { passwordHash: true } })).passwordHash, null)
  assert.equal(await admin.identityApplicationGrant.count({ where: { organizationId: org, userId: f.userId, application: "CRM" } }), 0)
  checks.push("onboarding_final_audit_failure_rolls_back_cutover_and_legacy_retirement_then_safe_retry_activates_only_reviewed_app")

  phase("ONBOARDING_CANCEL_STALE_SOURCE_AND_RESEND")
  const cancelled = await fixture("cancel"), old = await issue(cancelled)
  const cancelledSetup = await onboarding.confirmIdentityOnboardingProof(writer, org, old.attempt, ring)
  await assert.rejects(onboarding.cancelIdentityOnboardingIntent(failing, issuer, cancelled.review.intentId, "cancel-failed-audit"), /SYNTHETIC_AUDIT_FAILURE/)
  assert.equal((await admin.identityOnboardingIntent.findUniqueOrThrow({ where: { id: cancelled.review.intentId } })).status, "ACTIVE")
  await onboarding.cancelIdentityOnboardingIntent(writer, issuer, cancelled.review.intentId, "cancel-reviewed")
  assert.equal((await onboarding.cancelIdentityOnboardingIntent(writer, issuer, cancelled.review.intentId, "cancel-reviewed")).status, "CANCELLED")
  await assert.rejects(finish(writer, cancelledSetup.setupToken), /IDENTITY_ONBOARDING_UNAVAILABLE/)
  await assert.rejects(proof.setStagedIdentityCredential(writer, org, { setupToken: cancelledSetup.setupToken, password, requestId: "cancel-direct-setup" }, ring, passwordPolicyError), /IDENTITY_ONBOARDING_UNAVAILABLE/)
  assert.equal(await proof.claimStagedPhoneProofDelivery(writer, org, old.row.id), null)
  const stale = await fixture("source-reset"), staleProof = await issue(stale)
  await admin.$executeRaw`UPDATE mtm_agents SET "passwordHash"='!onboarding-legacy-changed' WHERE id=${stale.actorId}`
  assert.equal((await onboarding.confirmIdentityOnboardingProof(writer, org, staleProof.attempt, ring)).status, "INVALID")
  await assert.rejects(onboarding.issueIdentityOnboardingProof(writer, org, { ...staleProof.request, requestId: "stale-resend" }, key), /IDENTITY_ONBOARDING_UNAVAILABLE/)
  const resend = await fixture("resend"), original = await issue(resend)
  const oldSetup = await onboarding.confirmIdentityOnboardingProof(writer, org, original.attempt, ring)
  await assert.rejects(admin.identityOnboardingIntent.update({ where: { id: resend.review.intentId }, data: { normalizedPhone: "+994557769997" } }))
  await assert.rejects(admin.identityPhoneProof.update({ where: { id: original.row.id }, data: { onboardingIntentId: null } }))
  // Actual elapsed cooldown, hosted only; do not weaken the clock or rewrite immutable proof context.
  await delay(Math.max(0, original.row.createdAt.valueOf() + 61_000 - Date.now()))
  const fresh = await issue(resend, "renew")
  await assert.rejects(finish(writer, oldSetup.setupToken), /IDENTITY_ONBOARDING_UNAVAILABLE/)
  const freshSetup = await onboarding.confirmIdentityOnboardingProof(writer, org, fresh.attempt, ring)
  assert.equal(freshSetup.status, "CONFIRMED")
  assert.notEqual(freshSetup.claimId, oldSetup.claimId)
  assert.equal((await finish(writer, freshSetup.setupToken)).userId, resend.userId)
  checks.push("onboarding_cancellation_blocks_confirmed_setup_source_reset_requires_review_and_resend_renews_only_own_staged_claim_without_extending_review")

  // New Time actor creation and HR audit rollback run in the full-schema actual
  // HTTP contract. This minimal snapshot fixture intentionally has no complete
  // MtmAgent insert model or HR tables; it cannot qualify that composition.

  phase("ONBOARDING_ISSUER_REVOKE_REACTIVATE")
  const revoked = await fixture("issuer-revoked"), revokedProof = await issue(revoked)
  const grantKey = { organizationId_userId_application: { organizationId: org, userId: issuer.userId, application: "CRM" } }
  const current = await admin.identityApplicationGrant.findUniqueOrThrow({ where: grantKey })
  await admin.identityApplicationGrant.update({ where: grantKey, data: { status: "REVOKED", version: current.version + 1 } })
  await admin.identityApplicationGrant.update({ where: grantKey, data: { status: "ACTIVE", version: current.version + 2 } })
  await assert.rejects(onboarding.confirmIdentityOnboardingProof(writer, org, revokedProof.attempt, ring), /IDENTITY_PROOF_AUTHORITY_UNAVAILABLE/)
  await assert.rejects(onboarding.issueIdentityOnboardingProof(writer, org, { ...revokedProof.request, requestId: "issuer-revoked-resend" }, key), /IDENTITY_PROOF_AUTHORITY_UNAVAILABLE/)
  checks.push("onboarding_stored_review_cannot_borrow_new_administrator_authority_after_revoke_reactivate")
}
