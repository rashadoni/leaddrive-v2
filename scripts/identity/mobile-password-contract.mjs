/** Actual staged enrollment -> canonical login, only in the admitted CI fixture. */
import assert from "node:assert/strict"
import bcrypt from "bcryptjs"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { passwordPolicyError } from "../password-policy.mjs"

export async function checkCanonicalPasswordLogin({ admin, writer, actor, other, build, checks, phase }) {
  phase("CANONICAL_PASSWORD_MODULE_IMPORTS")
  const module = name => import(pathToFileURL(resolve(build, `${name}.js`)).href)
  const { authenticateIdentityMobilePassword: login } = await module("mobile-password-auth")
  const { stageIdentityAccount: stage, planStagedApplicationGrant: grant, reserveStagedIdentityPhone: reserve } = await module("registry")
  const { reviewStagedIdentityActor: review, planStagedIdentityMembership: member } = await module("membership-registry")
  const { issueStagedPhoneProof: issue, consumeStagedPhoneProofWithSetup: consume, setStagedIdentityCredential: setPassword } = await module("phone-proof-registry")
  const { openPhoneProofDelivery: open } = await module("phone-proof")
  const { readIdentityMobileTenantPolicy: policy, IDENTITY_AUTH_SETTING_KEY: flagKey } = await module("tenant-policy")
  const { resolveIdentityMobileSession: resolveSession } = await module("mobile-session-resolver")
  const { ATTENDANCE_FEATURE_SETTING_KEY: timeKey } = await import(pathToFileURL(resolve(build, "../mtm/attendance-feature.js")).href)
  const key = { purpose: "IDENTITY_MOBILE_SESSION", id: "synthetic-password-session", material: new Uint8Array(32).fill(43) }
  const otpKey = { id: "synthetic-password-proof", material: new Uint8Array(32).fill(41) }
  const keyRing = id => id === key.id ? key : null, otpRing = id => id === otpKey.id ? otpKey : null
  const legacyPassword = "Legacy!NotCanonical47", legacyHash = await bcrypt.hash(legacyPassword, 12)
  const phone = "+994551122334", passwordA = "Synthetic!CanonicalA47", passwordB = "Synthetic!CanonicalB48", passwordC = "Synthetic!CanonicalC49"
  async function settings(organizationId) {
    await admin.organization.update({ where: { id: organizationId }, data: { modules: { personnel: true, "route-field": true }, features: [], addons: [], plan: "starter" }, select: { id: true } })
    for (const [key, value] of [[flagKey, { version: 1, enabled: true }], [timeKey, true]]) await admin.mtmSetting.upsert({ where: { organizationId_key: { organizationId, key } }, create: { organizationId, key, value }, update: { value }, select: { id: true } })
  }
  async function enroll(principal, suffix, selectedPhone, password) {
    const org = principal.organizationId, userId = `password-user-${suffix}`, actorId = `password-actor-${suffix}`
    await admin.$executeRawUnsafe('INSERT INTO users (id,"organizationId","isActive",role,phone,"passwordHash") VALUES ($1,$2,true,\'viewer\',$3,$4)', userId, org, selectedPhone, legacyHash)
    await admin.$executeRawUnsafe('INSERT INTO mtm_agents (id,"organizationId","userId",role,status,"attendanceParticipant",phone,"passwordHash") VALUES ($1,$2,$3,\'AGENT\',\'ACTIVE\',false,$4,$5)', actorId, org, userId, selectedPhone, legacyHash)
    let version = (await stage(writer, principal, { userId, requestId: `password-stage-${suffix}` })).accountVersion
    version = (await review(writer, principal, { userId, actorId, expectedAccountVersion: version, reviewReference: `password-explicit-review-${suffix}`, requestId: `password-review-${suffix}` })).accountVersion
    for (const [application, role] of [["TIME", "EMPLOYEE"], ["ROUTE_FIELD", "AGENT"]]) {
      version = (await grant(writer, principal, { userId, application, role, status: "ACTIVE", expectedAccountVersion: version, expectedGrantVersion: 0, requestId: `password-grant-${suffix}-${application}` })).accountVersion
      version = (await member(writer, principal, { userId, actorId, application, status: "ACTIVE", expectedAccountVersion: version, expectedGrantVersion: 1, expectedMembershipVersion: 0, requestId: `password-member-${suffix}-${application}` })).accountVersion
    }
    const reservation = await reserve(writer, principal, { userId, phone: selectedPhone, expectedAccountVersion: version, expectedCredentialEpoch: 1, requestId: `password-reserve-${suffix}` })
    const proof = await issue(writer, principal, { userId, reservationId: reservation.reservationId, expectedAccountVersion: version, expectedCredentialEpoch: 1, requestId: `password-issue-${suffix}` }, otpKey)
    const p = await admin.identityPhoneProof.findUniqueOrThrow({ where: { id: proof.proofId } })
    const context = { organizationId: org, userId, reservationId: p.reservationId, challengeId: p.id, normalizedPhone: p.normalizedPhone,
      accountVersion: p.accountVersion, credentialEpoch: p.credentialEpoch, createdAt: p.createdAt.toISOString(), expiresAt: p.expiresAt.toISOString() }
    const code = open(context, p, otpKey, new Date())
    const admitted = await consume(writer, org, { proofId: p.id, code, requestId: `password-confirm-${suffix}` }, otpRing)
    assert.equal(admitted.status, "CONFIRMED")
    await setPassword(writer, org, { setupToken: admitted.setupToken, password, requestId: `password-set-${suffix}` }, otpRing, passwordPolicyError)
    // Test-only approved cutover assumption. No operator/migration API is invoked.
    await admin.identityAccount.update({ where: { organizationId_userId: { organizationId: org, userId } }, data: { cutoverAt: new Date(), credentialEpoch: { increment: 1 }, version: { increment: 1 } }, select: { userId: true } })
    return { organizationId: org, userId, actorId }
  }
  await settings(actor.organizationId); await settings(other.organizationId)
  const a = await enroll(actor, "a", phone, passwordA), b = await enroll(other, "b", phone, passwordB)
  const c = await enroll(actor, "c", "+994551122337", passwordC)
  const attempt = (org, password, application = "TIME", client = writer, selectedPhone = phone) => login(client, org, { phone: selectedPhone, password, application }, key)
  const verify = (result, application = "TIME") => resolveSession(writer, result.token, application, keyRing, policy)

  phase("CANONICAL_PASSWORD_ONE_PERSON_TWO_APPS_AND_SAME_PHONE_OTHER_COMPANY")
  const time = await attempt(a.organizationId, passwordA), field = await attempt(a.organizationId, passwordA, "ROUTE_FIELD"), beta = await attempt(b.organizationId, passwordB)
  assert.equal(time.context.userId, a.userId); assert.equal(time.context.actorId, a.actorId); assert.equal(time.context.role, "EMPLOYEE")
  assert.equal(field.context.userId, a.userId); assert.equal(field.context.actorId, a.actorId); assert.equal(field.context.role, "AGENT")
  assert.equal(beta.context.userId, b.userId); assert.equal(beta.context.organizationId, b.organizationId)
  assert.equal((await verify(time)).userId, a.userId); assert.equal((await verify(field, "ROUTE_FIELD")).userId, a.userId)
  assert.equal(await attempt(b.organizationId, passwordA), null)
  assert.equal(await admin.identityApplicationGrant.count({ where: { organizationId: a.organizationId, userId: a.userId, application: "CRM" } }), 0)
  checks.push("real_staged_proof_credential_and_canonical_password_login_admit_same_person_in_two_apps_and_isolate_same_phone_other_tenant")

  phase("CANONICAL_PASSWORD_NEVER_FALLS_BACK_TO_VALID_LEGACY_CREDENTIALS")
  assert.equal(await attempt(a.organizationId, legacyPassword), null)
  assert.equal(await attempt(a.organizationId, "wrong-password"), null)
  assert.equal(await attempt(a.organizationId, passwordA, "CRM"), null)
  assert.equal(await attempt(a.organizationId, passwordA, "TIME", writer, "+994551122335"), null)
  assert.equal(await login(writer, a.organizationId, { phone, password: passwordA, application: "TIME", userId: b.userId }, key), null)
  assert.equal(await login(writer, a.organizationId, { phone, password: "X".repeat(73), application: "TIME" }, key), null)
  const legacyPhone = "+994551122336"
  await admin.$executeRawUnsafe('INSERT INTO users (id,"organizationId","isActive",role,phone,"passwordHash") VALUES ($1,$2,true,\'viewer\',$3,$4)', "password-user-legacy", a.organizationId, legacyPhone, legacyHash)
  await admin.$executeRawUnsafe('INSERT INTO mtm_agents (id,"organizationId","userId",role,status,"attendanceParticipant",phone,"passwordHash") VALUES ($1,$2,$3,\'AGENT\',\'ACTIVE\',false,$4,$5)', "password-actor-legacy", a.organizationId, "password-user-legacy", legacyPhone, legacyHash)
  assert.equal(await attempt(a.organizationId, legacyPassword, "ROUTE_FIELD", writer, legacyPhone), null)
  checks.push("canonical_login_refuses_wrong_staged_legacy_only_or_old_card_password_without_user_actor_email_fallback")

  phase("CANONICAL_LOGIN_RECHECKS_ACTUAL_APP_RIGHTS_AND_LICENSE")
  await admin.identityApplicationGrant.update({ where: { organizationId_userId_application: { organizationId: a.organizationId, userId: a.userId, application: "TIME" } }, data: { status: "REVOKED", version: 2 } })
  assert.equal(await attempt(a.organizationId, passwordA), null)
  assert.notEqual(await attempt(a.organizationId, passwordA, "ROUTE_FIELD"), null)
  await admin.identityApplicationGrant.update({ where: { organizationId_userId_application: { organizationId: a.organizationId, userId: a.userId, application: "TIME" } }, data: { status: "ACTIVE", version: 3 } })
  await admin.organization.update({ where: { id: a.organizationId }, data: { modules: { personnel: false, "route-field": true } }, select: { id: true } })
  assert.equal(await attempt(a.organizationId, passwordA), null)
  assert.notEqual(await attempt(a.organizationId, passwordA, "ROUTE_FIELD"), null)
  await settings(a.organizationId)
  const legacy = await admin.$queryRawUnsafe('SELECT role,"attendanceParticipant","passwordHash" FROM mtm_agents WHERE id=$1', a.actorId)
  assert.deepEqual(legacy[0], { role: "AGENT", attendanceParticipant: false, passwordHash: legacyHash })
  checks.push("canonical_password_success_requires_current_app_grant_member_license_without_crm_or_legacy_role_mutation")

  phase("CANONICAL_PASSWORD_ROTATION_DURING_COMPARISON_REFUSES_OLD_PROOF")
  const nextPassword = "Synthetic!CanonicalA50", nextHash = await bcrypt.hash(nextPassword, 12)
  let reads = 0
  const rotating = { $transaction: async (work, options) => {
    const result = await writer.$transaction(work, options)
    if (++reads === 1) await admin.identityAccount.update({ where: { organizationId_userId: { organizationId: a.organizationId, userId: a.userId } }, data: { passwordHash: nextHash, credentialEpoch: { increment: 1 }, version: { increment: 1 } } })
    return result
  } }
  assert.equal(await attempt(a.organizationId, passwordA, "TIME", rotating), null)
  assert.equal(reads, 2)
  assert.equal(await attempt(a.organizationId, passwordA), null)
  const current = await attempt(a.organizationId, nextPassword); assert.equal(current.context.userId, a.userId)
  checks.push("password_login_rereads_hash_and_epoch_after_bcrypt_and_refuses_concurrent_credential_change")

  phase("CANONICAL_PHONE_REASSIGNMENT_DURING_COMPARISON_NEVER_ADOPTS_OLD_ACTOR")
  let phoneReads = 0
  const reassigned = { $transaction: async (work, options) => {
    const result = await writer.$transaction(work, options)
    if (++phoneReads === 1) await admin.$transaction(async tx => {
      await tx.identityPhoneClaim.deleteMany({ where: { organizationId: a.organizationId, userId: { in: [a.userId, c.userId] } } })
      const owner = await tx.identityAccount.findUniqueOrThrow({ where: { organizationId_userId: { organizationId: c.organizationId, userId: c.userId } } })
      await tx.identityPhoneClaim.create({ data: { organizationId: c.organizationId, userId: c.userId, normalizedPhone: phone, accountVersion: owner.version, verifiedAt: new Date() } })
    })
    return result
  } }
  // Synthetic trusted reassignment, not a claim-change API/ownership proof test.
  assert.equal(await attempt(a.organizationId, nextPassword, "TIME", reassigned), null)
  assert.equal(phoneReads, 2); assert.equal(await verify(current), null)
  assert.equal(await attempt(a.organizationId, nextPassword), null)
  const newOwner = await attempt(c.organizationId, passwordC)
  assert.equal(newOwner.context.userId, c.userId); assert.equal(newOwner.context.actorId, c.actorId)
  assert.notEqual(newOwner.context.actorId, a.actorId)
  const oldBinding = await admin.identityActorBinding.findUniqueOrThrow({ where: { organizationId_actorId: { organizationId: a.organizationId, actorId: a.actorId } } })
  assert.equal(oldBinding.userId, a.userId)
  assert.notEqual(await attempt(b.organizationId, passwordB), null)
  checks.push("login_claim_race_rejects_old_password_and_actor_adoption_while_other_company_same_phone_stays_independent")
}
