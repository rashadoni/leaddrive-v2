import assert from "node:assert/strict"

/** Real disposable PG, actual crypto and cost12 credentials; never a provider. */
export async function checkCanonicalRecovery({ load, admin, writer, failing, org, prepare, activate, administrator, runtime, checks, phase, passwordPolicyError }) {
  const { issueCanonicalRecovery: issue, confirmCanonicalRecovery: confirm, resetCanonicalPassword: reset } = await load("canonical-recovery")
  const { phoneProofContext, claimStagedPhoneProofDelivery: lease, consumeStagedPhoneProofWithSetup: stagedConfirm, setStagedIdentityCredential: stagedSetup } = await load("phone-proof-registry")
  const { openPhoneProofDelivery } = await load("phone-proof")
  const { authenticateIdentityMobilePassword: login } = await load("mobile-password-auth")
  const key = { id: "recovery-fixture", material: new Uint8Array(32).fill(64) }, resolve = id => id === key.id ? key : null
  const signing = { purpose: "IDENTITY_MOBILE_SESSION", id: "recovery-signing", material: new Uint8Array(32).fill(65) }
  const password = "Fictional!Recovered482", application = "ROUTE_FIELD"
  async function fixture(label) {
    const subject = await prepare(`recovery-${label}`)
    await activate(writer, administrator, subject.input, runtime)
    const request = { phone: subject.phone, application, requestId: `recovery-${label}-issue` }
    const issued = await issue(writer, org, request, key)
    assert.ok(issued)
    const row = await admin.identityPhoneProof.findUniqueOrThrow({ where: { id: issued.proofId } })
    assert.equal(row.issuedByUserId, null)
    const code = openPhoneProofDelivery(phoneProofContext(row), row, key, new Date())
    const attempt = { proofId: row.id, application, requestId: `recovery-${label}-confirm`, code }
    return { subject, request, issued, row, code, attempt }
  }
  const account = userId => admin.identityAccount.findUniqueOrThrow({ where: { organizationId_userId: { organizationId: org, userId } } })
  phase("CANONICAL_RECOVERY_POSSESSION_RESET_AND_AUDIT_ROLLBACK")
  const f = await fixture("normal"), before = await account(f.subject.input.userId)
  assert.deepEqual(await issue(writer, org, f.request, key), f.issued)
  await assert.rejects(issue(writer, org, { ...f.request, requestId: "recovery-too-soon" }, key), /IDENTITY_PROOF_RESEND_LATER/)
  await assert.rejects(confirm(writer, org, { ...f.attempt, application: "TIME" }, resolve), /IDENTITY_RECOVERY_UNAVAILABLE/)
  assert.equal((await stagedConfirm(writer, org, { proofId: f.row.id, requestId: "recovery-not-invitation", code: f.code }, resolve)).status, "INVALID")
  const leased = await lease(writer, org, f.row.id)
  assert.ok(leased); assert.equal(openPhoneProofDelivery(leased.context, leased.sealed, key, new Date()), f.code)
  assert.equal(await lease(writer, org, f.row.id), null)
  await assert.rejects(confirm(failing, org, f.attempt, resolve), /SYNTHETIC_AUDIT_FAILURE/)
  assert.equal((await admin.identityPhoneProof.findUniqueOrThrow({ where: { id: f.row.id } })).status, "PENDING")
  const possession = await confirm(writer, org, f.attempt, resolve)
  assert.ok(possession.setupToken.startsWith("lds3."))
  assert.deepEqual(await confirm(writer, org, f.attempt, resolve), possession)
  assert.deepEqual(await account(f.subject.input.userId), before)
  await assert.rejects(stagedSetup(writer, org, { setupToken: possession.setupToken, password, requestId: "recovery-not-staged" }, resolve, passwordPolicyError), /IDENTITY_SETUP_EXPIRED/)
  const change = { setupToken: possession.setupToken, application, password, requestId: "recovery-normal-password" }
  await assert.rejects(reset(failing, org, change, resolve, passwordPolicyError), /SYNTHETIC_AUDIT_FAILURE/)
  assert.deepEqual(await account(f.subject.input.userId), before)
  const done = await reset(writer, org, change, resolve, passwordPolicyError)
  assert.equal(done.credentialEpoch, before.credentialEpoch + 1)
  assert.equal((await reset(writer, org, change, resolve, passwordPolicyError)).replayed, true)
  await assert.rejects(reset(writer, org, { ...change, password: "Different!Password482" }, resolve, passwordPolicyError), /IDENTITY_REQUEST_REUSED/)
  assert.ok(await login(writer, org, { phone: f.subject.phone, password, application }, signing))
  assert.equal(await login(writer, org, { phone: f.subject.phone, password: "Fictional!Activation482", application }, signing), null)
  assert.equal(await login(writer, org, { phone: f.subject.phone, password, application: "TIME" }, signing), null)
  assert.equal((await admin.user.findUniqueOrThrow({ where: { id: f.subject.input.userId }, select: { passwordHash: true } })).passwordHash, "!identity:canonical-only")
  assert.equal((await admin.mtmAgent.findUniqueOrThrow({ where: { id: f.subject.actorId }, select: { passwordHash: true } })).passwordHash, null)
  checks.push("canonical_recovery_requires_possession_has_one_delivery_lease_atomic_audit_and_common_password_reset_without_legacy_restoration_or_implicit_app_grant")

  phase("CANONICAL_RECOVERY_LIMITS_REVOKE_AND_CONCURRENT_RESET")
  const wrong = await fixture("attempts"), wrongCode = wrong.code === "000000" ? "000001" : "000000"
  for (let i = 0; i < 5; i++) {
    const input = { ...wrong.attempt, requestId: `recovery-wrong-${i}`, code: wrongCode }
    assert.equal(await confirm(writer, org, input, resolve), null)
    assert.equal(await confirm(writer, org, input, resolve), null)
    await assert.rejects(confirm(writer, org, { ...input, code: wrong.code }, resolve), /IDENTITY_REQUEST_REUSED/)
  }
  assert.equal(await confirm(writer, org, wrong.attempt, resolve), null)
  assert.equal((await admin.identityPhoneProof.findUniqueOrThrow({ where: { id: wrong.row.id } })).attempts, 5)
  const revoked = await fixture("revoke")
  const setup = await confirm(writer, org, revoked.attempt, resolve)
  const grantKey = { organizationId_userId_application: { organizationId: org, userId: revoked.subject.input.userId, application } }
  await admin.identityApplicationGrant.update({ where: grantKey, data: { status: "REVOKED", version: 2 } })
  await admin.identityApplicationGrant.update({ where: grantKey, data: { status: "ACTIVE", version: 3 } })
  await assert.rejects(reset(writer, org, { ...change, setupToken: setup.setupToken, requestId: "recovery-revoked-password" }, resolve, passwordPolicyError), /IDENTITY_RECOVERY_UNAVAILABLE/)
  const racing = await fixture("race"), capability = await confirm(writer, org, racing.attempt, resolve)
  const results = await Promise.allSettled(["a", "b"].map(suffix => reset(writer, org, { ...change, setupToken: capability.setupToken, requestId: `recovery-race-${suffix}` }, resolve, passwordPolicyError)))
  assert.equal(results.filter(row => row.status === "fulfilled").length, 1)
  assert.equal(await admin.identityEvent.count({ where: { organizationId: org, proofId: racing.row.id, action: "CREDENTIAL_CHANGED" } }), 1)
  checks.push("canonical_recovery_spends_five_attempts_without_replay_oracle_refuses_revoke_reactivate_and_parallel_password_changes_have_one_winner")
}
