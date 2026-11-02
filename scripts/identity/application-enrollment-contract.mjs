/** Live grant transaction acceptance in the admitted disposable PostgreSQL DB. */
import assert from "node:assert/strict"
import bcrypt from "bcryptjs"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"

export async function checkApplicationEnrollment({ admin, writer, failing, actor, other, build, checks, phase }) {
  const module = name => import(pathToFileURL(resolve(build, `${name}.js`)).href)
  const { enrollIdentityApplication: enroll } = await module("application-enrollment")
  const { authenticateIdentityCrmPassword: crmLogin } = await module("crm-session")
  const { authenticateIdentityMobilePassword: mobileLogin } = await module("mobile-password-auth")
  const { resolveIdentityMobileSession: resolveSession } = await module("mobile-session-resolver")
  const { readIdentityMobileTenantPolicy: policy, IDENTITY_AUTH_SETTING_KEY } = await module("tenant-policy")
  const org = actor.organizationId, userId = "enrollment-person", adminId = "enrollment-admin"
  const phone = "+994552221101", password = "Fictional!Enrollment482", hash = await bcrypt.hash(password, 12)
  const signing = { purpose: "IDENTITY_MOBILE_SESSION", id: "enrollment-fixture", material: new Uint8Array(32).fill(49) }
  const ring = id => id === signing.id ? signing : null
  const originalCompany = await admin.organization.findUniqueOrThrow({ where: { id: org }, select: { modules: true, isActive: true } })
  const flagKey = { organizationId_key: { organizationId: org, key: IDENTITY_AUTH_SETTING_KEY } }
  const originalFlag = await admin.mtmSetting.findUniqueOrThrow({ where: flagKey, select: { value: true } })
  const attendanceKey = { organizationId_key: { organizationId: org, key: "attendanceEnabled" } }
  const originalAttendance = await admin.mtmSetting.findUnique({ where: attendanceKey, select: { value: true } })
  const accountKey = { organizationId_userId: { organizationId: org, userId } }
  const appKey = application => ({ organizationId_userId_application: { organizationId: org, userId, application } })
  const credential = () => admin.identityAccount.findUniqueOrThrow({ where: accountKey, select: { version: true, passwordHash: true, credentialEpoch: true } })
  try {
    await admin.organization.update({ where: { id: org }, data: { modules: { personnel: true, "route-field": true }, isActive: true }, select: { id: true } })
    await admin.mtmSetting.update({ where: flagKey, data: { value: { version: 1, enabled: true } } })
    await admin.mtmSetting.upsert({ where: attendanceKey, create: { organizationId: org, key: "attendanceEnabled", value: true }, update: { value: true } })
    for (const [id, selectedPhone] of [[userId, phone], [adminId, "+994552221102"]]) {
      await admin.$executeRaw`INSERT INTO users (id,"organizationId","isActive",role,"passwordHash") VALUES (${id},${org},true,'viewer','!fixture-old-credential')`
      await admin.identityAccount.create({ data: { organizationId: org, userId: id, cutoverAt: new Date(), passwordHash: hash } })
      await admin.identityPhoneClaim.create({ data: { organizationId: org, userId: id, normalizedPhone: selectedPhone, accountVersion: 1, verifiedAt: new Date() } })
    }
    await admin.identityApplicationGrant.create({ data: { organizationId: org, userId: adminId, application: "CRM", role: "admin", status: "ACTIVE" } })
    const proof = await crmLogin(writer, org, adminId, password)
    assert.ok(proof)
    const issuer = { organizationId: org, userId: adminId, mode: "CANONICAL", claims: proof.claims }
    for (const [actorId, role] of [["enrollment-time", "EMPLOYEE"], ["enrollment-field", "AGENT"]]) {
      await admin.$executeRaw`INSERT INTO mtm_agents (id,"organizationId","userId",role,status,"attendanceParticipant") VALUES (${actorId},${org},${userId},${role},'ACTIVE',${role === "EMPLOYEE"})`
      await admin.identityActorBinding.create({ data: { organizationId: org, userId, actorId, reviewedByUserId: adminId, reviewReference: `explicit-${actorId}`, accountVersion: 1 } })
    }
    const input = { userId, actorId: "enrollment-field", application: "ROUTE_FIELD", role: "AGENT", status: "ACTIVE",
      expectedAccountVersion: 1, expectedGrantVersion: 0, expectedMembershipVersion: 0, requestId: "enrollment-field-enable" }
    phase("CANONICAL_ADMIN_GRANT_WITH_OLD_VIEWER_ROLE_AND_EXPLICIT_REVIEWED_ACTORS")
    await assert.rejects(enroll(writer, { ...other, mode: "LEGACY" }, input), /IDENTITY_SUBJECT_UNAVAILABLE/)
    await assert.rejects(enroll(writer, { organizationId: org, userId: adminId, mode: "LEGACY" }, input), /IDENTITY_ADMIN_REQUIRED/)
    assert.equal((await enroll(writer, issuer, input)).accountVersion, 2)
    const time = { ...input, actorId: "enrollment-time", application: "TIME", role: "EMPLOYEE", expectedAccountVersion: 2, requestId: "enrollment-time-enable" }
    await assert.rejects(enroll(writer, issuer, { ...time, actorId: "enrollment-field", requestId: "enrollment-wrong-card" }), /IDENTITY_ACTOR_APPLICATION_MISMATCH/)
    await admin.mtmSetting.update({ where: attendanceKey, data: { value: false } })
    await assert.rejects(enroll(writer, issuer, { ...time, requestId: "enrollment-disabled-time" }), /IDENTITY_APPLICATION_DISABLED/)
    assert.equal((await credential()).version, 2)
    assert.equal(await admin.identityApplicationGrant.count({ where: { organizationId: org, userId, application: "TIME" } }), 0)
    await admin.mtmSetting.update({ where: attendanceKey, data: { value: true } })
    assert.equal((await enroll(writer, issuer, time)).accountVersion, 3)
    assert.equal((await enroll(writer, issuer, time)).replayed, true)
    await assert.rejects(enroll(writer, issuer, { ...time, status: "REVOKED" }), /IDENTITY_REQUEST_REUSED/)
    assert.equal(await admin.identityApplicationGrant.count({ where: { organizationId: org, userId, application: "CRM" } }), 0)
    const fieldLogin = await mobileLogin(writer, org, { phone, password, application: "ROUTE_FIELD" }, signing)
    const timeLogin = await mobileLogin(writer, org, { phone, password, application: "TIME" }, signing)
    assert.equal(fieldLogin.context.userId, userId); assert.equal(timeLogin.context.userId, userId)
    assert.equal(fieldLogin.context.actorId, "enrollment-field"); assert.equal(timeLogin.context.actorId, "enrollment-time")
    assert.equal(await resolveSession(writer, fieldLogin.token, "TIME", ring, policy), null)
    checks.push("canonical_admin_with_legacy_viewer_role_enrolls_one_person_in_two_modules_with_distinct_actors_shared_password_and_no_crm_access")

    phase("LIVE_APP_REVOCATION_PRESERVES_SIBLING_LOGIN_AND_COMMON_CREDENTIAL")
    const revoke = { ...time, status: "REVOKED", expectedAccountVersion: 3, expectedGrantVersion: 1, expectedMembershipVersion: 1, requestId: "enrollment-time-revoke" }
    await enroll(writer, issuer, revoke)
    assert.equal(await resolveSession(writer, timeLogin.token, "TIME", ring, policy), null)
    assert.ok(await resolveSession(writer, fieldLogin.token, "ROUTE_FIELD", ring, policy))
    assert.deepEqual(await credential(), { version: 4, passwordHash: hash, credentialEpoch: 1 })
    checks.push("live_time_revocation_leaves_field_session_and_common_password_unchanged")

    phase("LIVE_ADMIN_REVOCATION_REFUSES_IDEMPOTENT_REPLAY_AND_STALE_CONTEXT")
    const adminGrant = { organizationId_userId_application: { organizationId: org, userId: adminId, application: "CRM" } }
    await admin.identityApplicationGrant.update({ where: adminGrant, data: { status: "REVOKED", version: 2 } })
    await assert.rejects(enroll(writer, issuer, time), /IDENTITY_ADMIN_REQUIRED/)
    await admin.identityApplicationGrant.update({ where: adminGrant, data: { status: "ACTIVE", version: 3 } })
    await assert.rejects(enroll(writer, issuer, time), /IDENTITY_ADMIN_REQUIRED/)
    issuer.claims = (await crmLogin(writer, org, adminId, password)).claims
    checks.push("revoked_or_reactivated_administrator_cannot_replay_a_previous_grant_with_stale_authority")

    phase("LIVE_ENROLLMENT_AUDIT_ROLLBACK_AND_CONCURRENT_REVISION")
    const restore = { ...time, expectedAccountVersion: 4, expectedGrantVersion: 2, expectedMembershipVersion: 2, requestId: "enrollment-time-restore" }
    await assert.rejects(enroll(failing, issuer, restore), /SYNTHETIC_AUDIT_FAILURE/)
    assert.deepEqual(await credential(), { version: 4, passwordHash: hash, credentialEpoch: 1 })
    assert.equal((await admin.identityApplicationGrant.findUniqueOrThrow({ where: appKey("TIME") })).status, "REVOKED")
    const concurrent = await Promise.allSettled(["a", "b"].map(suffix => enroll(writer, issuer, { ...restore, requestId: `enrollment-race-${suffix}` })))
    assert.equal(concurrent.filter(row => row.status === "fulfilled").length, 1)
    assert.equal(concurrent.filter(row => row.status === "rejected" && row.reason?.code === "IDENTITY_ACCOUNT_STALE").length, 1)
    assert.equal((await admin.identityApplicationGrant.findUniqueOrThrow({ where: appKey("ROUTE_FIELD") })).version, 1)
    assert.equal(await resolveSession(writer, timeLogin.token, "TIME", ring, policy), null)
    assert.ok(await resolveSession(writer, fieldLogin.token, "ROUTE_FIELD", ring, policy))
    checks.push("live_enrollment_audit_failure_rolls_back_both_access_rows_and_concurrent_changes_do_not_revive_old_tokens")
  } finally {
    await admin.organization.update({ where: { id: org }, data: originalCompany, select: { id: true } })
    await admin.mtmSetting.update({ where: flagKey, data: originalFlag })
    if (originalAttendance) await admin.mtmSetting.update({ where: attendanceKey, data: originalAttendance })
    else await admin.mtmSetting.delete({ where: attendanceKey })
  }
}
