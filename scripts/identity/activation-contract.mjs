import { checkIdentityOnboarding } from "./onboarding-contract.mjs"
import { checkCanonicalRecovery } from "./recovery-contract.mjs"
import assert from "node:assert/strict"
import bcrypt from "bcryptjs"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { passwordPolicyError } from "../password-policy.mjs"

export async function checkIdentityActivation({ admin, writer, failing, actor, other, build, checks, phase }) {
  const load = name => import(pathToFileURL(resolve(build, `${name}.js`)).href)
  const registry = await load("registry"), membership = await load("membership-registry"), proof = await load("phone-proof-registry")
  const { activateReviewedIdentity: activate } = await load("activation")
  const { openPhoneProofDelivery } = await load("phone-proof")
  const { identityProofAuthorityHash } = await load("proof-authority")
  const { authenticateIdentityCrmPassword: crmLogin } = await load("crm-session")
  const { authenticateIdentityMobilePassword: mobileLogin } = await load("mobile-password-auth")
  const { identityCrmSeatUserWhere } = await load("crm-seat-policy")
  const org = actor.organizationId, administrator = { ...actor, mode: "LEGACY" }
  const key = { id: "activation-proof", material: new Uint8Array(32).fill(61) }, ring = id => id === key.id ? key : null
  const signing = { purpose: "IDENTITY_MOBILE_SESSION", id: "activation-mobile", material: new Uint8Array(32).fill(62) }
  const password = "Fictional!Activation482", runtime = async () => process.env.IDENTITY_CONTRACT_HEAD_SHA
  const flagKey = { organizationId_key: { organizationId: org, key: "identityAuthV1" } }
  const originalFlag = await admin.mtmSetting.findUniqueOrThrow({ where: flagKey, select: { value: true } })
  const originalCompany = await admin.organization.findUniqueOrThrow({ where: { id: org }, select: { modules: true } })
  let count = 0
  async function prepare(label, issuer = administrator) {
    const userId = `activation-${label}`, actorId = `activation-card-${label}`, phone = `+99455777${String(++count).padStart(4, "0")}`
    await admin.$executeRaw`INSERT INTO users (id,"organizationId","isActive",role,phone,"passwordHash") VALUES (${userId},${org},true,'viewer',${phone},'!legacy-user-fixture')`
    await admin.$executeRaw`INSERT INTO mtm_agents (id,"organizationId","userId",phone,role,status,"attendanceParticipant","passwordHash") VALUES (${actorId},${org},${userId},${phone},'AGENT','ACTIVE',false,'!legacy-card-fixture')`
    const base = { userId, requestId: `activation-${label}` }
    await registry.stageIdentityAccountByAdministrator(writer, issuer, { ...base, requestId: `${base.requestId}-stage` })
    await registry.planIdentityApplicationByAdministrator(writer, issuer, { ...base, application: "ROUTE_FIELD", status: "ACTIVE", role: "AGENT", expectedAccountVersion: 1, expectedGrantVersion: 0, requestId: `${base.requestId}-grant` })
    await membership.reviewIdentityActorByAdministrator(writer, issuer, { ...base, actorId, expectedAccountVersion: 2, reviewReference: `${base.requestId}-review`, requestId: `${base.requestId}-binding` })
    await membership.planIdentityMembershipByAdministrator(writer, issuer, { ...base, actorId, application: "ROUTE_FIELD", status: "ACTIVE", expectedAccountVersion: 3, expectedGrantVersion: 1, expectedMembershipVersion: 0, requestId: `${base.requestId}-member` })
    const reservation = await registry.reserveIdentityPhoneByAdministrator(writer, issuer, { ...base, phone, expectedAccountVersion: 4, expectedCredentialEpoch: 1, requestId: `${base.requestId}-reserve` })
    const issue = issuer.mode === "CANONICAL" ? proof.issueCanonicalAdministratorPhoneProof : proof.issueStagedPhoneProof
    const issued = await issue(writer, issuer, { ...base, reservationId: reservation.reservationId, expectedAccountVersion: 4, expectedCredentialEpoch: 1, requestId: `${base.requestId}-issue` }, key)
    const row = await admin.identityPhoneProof.findUniqueOrThrow({ where: { id: issued.proofId } })
    const frozen = { organizationId: org, userId, reservationId: row.reservationId, challengeId: row.id, normalizedPhone: phone, accountVersion: 4, credentialEpoch: 1, createdAt: row.createdAt.toISOString(), expiresAt: row.expiresAt.toISOString(),
      ...(row.contextVersion === 2 ? { version: 2, authorityHash: identityProofAuthorityHash(row.issuerAuthority), contactRevision: row.contactRevision } : {}) }
    const possession = await proof.consumeStagedPhoneProofWithSetup(writer, org, { proofId: row.id, code: openPhoneProofDelivery(frozen, row, key, new Date()), requestId: `${base.requestId}-confirm` }, ring)
    assert.equal(possession.status, "CONFIRMED")
    const credentialRequestId = `${base.requestId}-credential`
    const staged = await proof.setStagedIdentityCredential(writer, org, { setupToken: possession.setupToken, password, requestId: credentialRequestId }, ring, passwordPolicyError)
    return { phone, actorId, input: { userId, expectedAccountVersion: staged.accountVersion, expectedCredentialEpoch: staged.credentialEpoch,
      expectedContactRevision: 1, credentialRequestId, reviewReference: `${base.requestId}-activation-review`, requestId: `${base.requestId}-activate`,
      applications: [{ application: "ROUTE_FIELD", role: "AGENT", status: "ACTIVE", grantVersion: 1, actorId, membershipVersion: 1, membershipStatus: "ACTIVE" }] } }
  }
  const account = userId => admin.identityAccount.findUniqueOrThrow({ where: { organizationId_userId: { organizationId: org, userId } } })
  await admin.$executeRawUnsafe('GRANT UPDATE ("passwordHash","passwordChangedAt") ON users TO identity_foundation_writer')
  await admin.$executeRawUnsafe('GRANT UPDATE ("passwordHash") ON mtm_agents TO identity_foundation_writer')
  try {
    await admin.mtmSetting.update({ where: flagKey, data: { value: { version: 1, enabled: true } } })
    await admin.organization.update({ where: { id: org }, data: { modules: { personnel: true, "route-field": true } }, select: { id: true } })
    phase("REVIEWED_ACTIVATION_ATOMIC_CREDENTIAL_RETIREMENT")
    const subject = await prepare("normal"), before = await account(subject.input.userId)
    await assert.rejects(activate(writer, administrator, subject.input, async () => { throw new Error("RUNTIME_REFUSED") }), /RUNTIME_REFUSED/)
    await assert.rejects(activate(writer, { ...other, mode: "LEGACY" }, subject.input, runtime), /IDENTITY_SUBJECT_UNAVAILABLE/)
    await assert.rejects(activate(writer, administrator, { ...subject.input, applications: [{ ...subject.input.applications[0], grantVersion: 2 }] }, runtime), /IDENTITY_APPLICATION_PLAN_STALE/)
    await assert.rejects(activate(failing, administrator, subject.input, runtime), /SYNTHETIC_AUDIT_FAILURE/)
    assert.deepEqual(await account(subject.input.userId), before)
    assert.equal((await admin.user.findUniqueOrThrow({ where: { id: subject.input.userId }, select: { passwordHash: true } })).passwordHash, "!legacy-user-fixture")
    assert.equal((await admin.mtmAgent.findUniqueOrThrow({ where: { id: subject.actorId }, select: { passwordHash: true } })).passwordHash, "!legacy-card-fixture")
    const activated = await activate(writer, administrator, subject.input, runtime)
    assert.equal(activated.status, "ACTIVE")
    assert.ok((await account(subject.input.userId)).cutoverAt)
    assert.equal((await admin.user.findUniqueOrThrow({ where: { id: subject.input.userId }, select: { passwordHash: true } })).passwordHash, "!identity:canonical-only")
    assert.equal((await admin.mtmAgent.findUniqueOrThrow({ where: { id: subject.actorId }, select: { passwordHash: true } })).passwordHash, null)
    assert.equal(await admin.user.count({ where: { AND: [{ id: subject.input.userId }, identityCrmSeatUserWhere(org)] } }), 0)
    assert.ok(await mobileLogin(writer, org, { phone: subject.phone, password, application: "ROUTE_FIELD" }, signing))
    assert.equal(await mobileLogin(writer, org, { phone: subject.phone, password, application: "TIME" }, signing), null)
    assert.equal((await activate(writer, administrator, subject.input, runtime)).replayed, true)
    await assert.rejects(admin.$executeRaw`UPDATE users SET "passwordHash"='!old-login-restored' WHERE id=${subject.input.userId}`, /IDENTITY_CANONICAL_CREDENTIAL_REQUIRED/)
    const event = await admin.identityEvent.findUniqueOrThrow({ where: { organizationId_requestId: { organizationId: org, requestId: subject.input.requestId } } })
    assert.equal(event.activationArtifactSha, await runtime()); assert.equal(event.reviewReference, subject.input.reviewReference)
    checks.push("reviewed_cutover_retires_both_legacy_credentials_atomically_preserves_actor_and_common_password_and_allocates_no_implicit_crm_or_time_access")

    phase("REVIEWED_ACTIVATION_SOURCE_RESET_AND_CONCURRENT_CONFIRMATION")
    const stale = await prepare("source-reset")
    await admin.$executeRaw`UPDATE mtm_agents SET "passwordHash"='!fresh-legacy-reset' WHERE id=${stale.actorId}`
    await assert.rejects(activate(writer, administrator, stale.input, runtime), /IDENTITY_ACTIVATION_STALE/)
    assert.equal((await account(stale.input.userId)).cutoverAt, null)
    const racing = await prepare("race")
    const outcomes = await Promise.allSettled(["a", "b"].map(suffix => activate(writer, administrator, { ...racing.input, requestId: `${racing.input.requestId}-${suffix}` }, runtime)))
    assert.equal(outcomes.filter(row => row.status === "fulfilled").length, 1)
    assert.equal(await admin.identityEvent.count({ where: { organizationId: org, userId: racing.input.userId, action: "ACCOUNT_ACTIVATED" } }), 1)
    checks.push("legacy_source_reset_cancels_staged_cutover_and_parallel_distinct_activation_has_one_winner")

    phase("CANONICAL_ADMIN_REVIEWED_ONBOARDING_WITH_LEGACY_VIEWER_ROLE")
    const issuerId = "activation-canonical-admin"
    await admin.$executeRaw`INSERT INTO users (id,"organizationId","isActive",role,"passwordHash") VALUES (${issuerId},${org},true,'viewer','!disabled-legacy')`
    await admin.identityAccount.create({ data: { organizationId: org, userId: issuerId, cutoverAt: new Date(), passwordHash: await bcrypt.hash(password, 12) } })
    await admin.identityPhoneClaim.create({ data: { organizationId: org, userId: issuerId, normalizedPhone: "+994557779999", accountVersion: 1, verifiedAt: new Date() } })
    const issuerGrant = { organizationId_userId_application: { organizationId: org, userId: issuerId, application: "CRM" } }
    await admin.identityApplicationGrant.create({ data: { organizationId: org, userId: issuerId, application: "CRM", role: "admin", status: "ACTIVE" } })
    const admitted = await crmLogin(writer, org, issuerId, password)
    assert.ok(admitted)
    const issuer = { organizationId: org, userId: issuerId, mode: "CANONICAL", claims: admitted.claims }
    const invited = await prepare("canonical-issuer", issuer)
    assert.equal((await activate(writer, issuer, invited.input, runtime)).status, "ACTIVE")
    await checkIdentityOnboarding({ load, admin, writer, failing, issuer, runtime, checks, phase, passwordPolicyError })
    const afterOnboardingGrant = await admin.identityApplicationGrant.findUniqueOrThrow({ where: issuerGrant })
    await admin.identityApplicationGrant.update({ where: issuerGrant, data: { status: "REVOKED", version: afterOnboardingGrant.version + 1 } })
    await assert.rejects(activate(writer, issuer, invited.input, runtime), /IDENTITY_ADMIN_REQUIRED/)
    assert.ok((await account(invited.input.userId)).cutoverAt)
    checks.push("canonical_administrator_can_review_plan_prove_and_activate_without_legacy_role_and_revocation_denies_replay")

    await checkCanonicalRecovery({ load, admin, writer, failing, org, prepare, activate, administrator, runtime, checks, phase, passwordPolicyError })

  } finally {
    await admin.mtmSetting.update({ where: flagKey, data: originalFlag })
    await admin.organization.update({ where: { id: org }, data: originalCompany, select: { id: true } })
    await admin.$executeRawUnsafe('REVOKE UPDATE ("passwordHash","passwordChangedAt") ON users FROM identity_foundation_writer')
    await admin.$executeRawUnsafe('REVOKE UPDATE ("passwordHash") ON mtm_agents FROM identity_foundation_writer')
  }
}
