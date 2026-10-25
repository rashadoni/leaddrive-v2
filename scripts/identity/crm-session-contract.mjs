/** Canonical CRM authority in the admitted real restricted PostgreSQL fixture. */
import assert from "node:assert/strict"
import bcrypt from "bcryptjs"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"

export async function checkCanonicalCrmSession({ admin, writer, actor, other, build, checks, phase }) {
  const module = name => import(pathToFileURL(resolve(build, `${name}.js`)).href)
  const { authenticateIdentityCrmPassword: login, resolveIdentityCrmSession: session } = await module("crm-session")
  const { IDENTITY_AUTH_SETTING_KEY: flagKey } = await module("tenant-policy")
  const org = actor.organizationId, userId = "canonical-crm-auth-person", shadowId = "canonical-crm-shadow-person"
  const commonPassword = "Synthetic!CommonCrm47", newPassword = "Synthetic!ChangedCommon48", oldPassword = "Synthetic!OldLegacy49"
  const commonHash = await bcrypt.hash(commonPassword, 12), newHash = await bcrypt.hash(newPassword, 12)
  const legacyHash = await bcrypt.hash(oldPassword, 4)
  const scope = { organizationId: org, userId }, grantKey = { organizationId_userId_application: { ...scope, application: "CRM" } }
  const flag = { organizationId_key: { organizationId: org, key: flagKey } }
  const originalFlag = await admin.mtmSetting.findUniqueOrThrow({ where: flag, select: { value: true } })
  const originalCompany = await admin.organization.findUniqueOrThrow({ where: { id: org }, select: { isActive: true } })
  try {
    await admin.organization.update({ where: { id: org }, data: { isActive: true } })
    await admin.mtmSetting.update({ where: flag, data: { value: { version: 1, enabled: true } } })
    await admin.$executeRaw`INSERT INTO users (id,"organizationId","isActive",role,"passwordHash") VALUES (${userId},${org},true,'viewer',${legacyHash})`
    await admin.identityAccount.create({ data: { ...scope, cutoverAt: new Date(), passwordHash: commonHash } })
    const claim = await admin.identityPhoneClaim.create({ data: { ...scope, normalizedPhone: "+994507778899", accountVersion: 1, verifiedAt: new Date() } })

    phase("CANONICAL_CRM_REQUIRES_EXPLICIT_GRANT_AND_SHARED_CREDENTIAL")
    assert.equal(await login(writer, org, userId, commonPassword), null)
    await admin.identityApplicationGrant.create({ data: { ...scope, application: "CRM", status: "ACTIVE", role: "viewer" } })
    const admitted = await login(writer, org, userId, commonPassword)
    assert.ok(admitted)
    assert.equal(admitted.role, "viewer"); assert.equal(admitted.claims.claimId, claim.id)
    assert.deepEqual(await session(writer, org, userId, admitted.claims), admitted)
    assert.equal(await login(writer, org, userId, oldPassword), null)
    assert.equal(JSON.stringify(admitted).includes(commonHash), false)
    assert.equal(JSON.stringify(admitted).includes(commonPassword), false)
    // A stale legacy role never substitutes for the canonical CRM grant role.
    await admin.$executeRaw`UPDATE users SET role='admin' WHERE id=${userId}`
    assert.equal((await session(writer, org, userId, admitted.claims)).role, "viewer")
    await admin.$executeRaw`UPDATE users SET role='viewer' WHERE id=${userId}`
    checks.push("canonical_crm_requires_explicit_crm_grant_and_shared_hash_never_legacy_password_or_role_and_returns_no_credential_material")

    phase("CANONICAL_CRM_SIBLING_GRANT_ISOLATION_AND_CRM_VERSION_REVOCATION")
    await admin.identityApplicationGrant.create({ data: { ...scope, application: "TIME", status: "ACTIVE", role: "EMPLOYEE" } })
    await admin.identityAccount.update({ where: { organizationId_userId: scope }, data: { version: { increment: 1 } } })
    assert.deepEqual(await session(writer, org, userId, admitted.claims), admitted)
    await admin.identityApplicationGrant.update({ where: grantKey, data: { role: "admin", version: 2 } })
    assert.equal(await session(writer, org, userId, admitted.claims), null)
    const promoted = await login(writer, org, userId, commonPassword)
    assert.ok(promoted)
    assert.equal(promoted.role, "admin"); assert.equal(promoted.claims.grantVersion, 2)
    // This result is private password/authority proof, not a completed MFA session.
    assert.equal(Object.hasOwn(promoted, "mfaVerified"), false)
    checks.push("canonical_crm_survives_sibling_account_cas_version_but_crm_grant_version_requires_new_authentication_not_automatic_promotion")

    phase("CANONICAL_CRM_COMMON_PASSWORD_AND_POST_COMPARE_EPOCH_RACE")
    await admin.identityAccount.update({ where: { organizationId_userId: scope }, data: { passwordHash: newHash, credentialEpoch: { increment: 1 }, version: { increment: 1 } } })
    assert.equal(await session(writer, org, userId, promoted.claims), null)
    assert.equal(await login(writer, org, userId, commonPassword), null)
    assert.ok(await login(writer, org, userId, newPassword))
    let snapshots = 0
    const raced = { $transaction: async (work, options) => {
      if (++snapshots === 2) await admin.identityAccount.update({ where: { organizationId_userId: scope }, data: { credentialEpoch: { increment: 1 }, version: { increment: 1 } } })
      return writer.$transaction(work, options)
    } }
    assert.equal(await login(raced, org, userId, newPassword), null); assert.equal(snapshots, 2)
    checks.push("canonical_crm_shared_password_rotation_and_actual_between_snapshot_epoch_race_refuse_old_password_or_stale_login_proof")

    phase("CANONICAL_CRM_FLAG_LIFECYCLE_AND_PLATFORM_REFUSAL")
    const current = await login(writer, org, userId, newPassword)
    assert.ok(current)
    for (const value of [false, "true", { version: 1, enabled: true, extra: true }]) {
      await admin.mtmSetting.update({ where: flag, data: { value } })
      assert.equal(await session(writer, org, userId, current.claims), null)
    }
    await admin.mtmSetting.update({ where: flag, data: { value: { version: 1, enabled: true } } })
    await admin.organization.update({ where: { id: org }, data: { isActive: false } })
    assert.equal(await session(writer, org, userId, current.claims), null)
    await admin.organization.update({ where: { id: org }, data: { isActive: true } })
    await admin.$executeRaw`UPDATE users SET role='superadmin' WHERE id=${userId}`
    assert.equal(await session(writer, org, userId, current.claims), null)
    await admin.$executeRaw`UPDATE users SET role='reviewer' WHERE id=${userId}`
    assert.equal(await session(writer, org, userId, current.claims), null)
    await admin.$executeRaw`UPDATE users SET role='viewer',"isActive"=false WHERE id=${userId}`
    assert.equal(await session(writer, org, userId, current.claims), null)
    await admin.$executeRaw`UPDATE users SET "isActive"=true WHERE id=${userId}`
    assert.equal(await session(writer, org, userId, current.claims), null)
    assert.ok(await login(writer, org, userId, newPassword))
    checks.push("canonical_crm_exact_opt_in_lifecycle_and_no_platform_or_reviewer_conversion_are_fresh_and_reactivation_does_not_revive_old_epoch")

    phase("CANONICAL_CRM_REVOKED_GRANT_SHADOW_AND_FOREIGN_SCOPE")
    const fresh = await login(writer, org, userId, newPassword)
    assert.ok(fresh)
    await admin.identityApplicationGrant.update({ where: grantKey, data: { status: "REVOKED", role: null, version: 3 } })
    assert.equal(await session(writer, org, userId, fresh.claims), null)
    assert.equal(await login(writer, org, userId, newPassword), null)
    await admin.$executeRaw`INSERT INTO users (id,"organizationId","isActive",role,"passwordHash") VALUES (${shadowId},${org},true,'viewer',${legacyHash})`
    await admin.identityAccount.create({ data: { organizationId: org, userId: shadowId, passwordHash: commonHash } })
    await admin.identityPhoneClaim.create({ data: { organizationId: org, userId: shadowId, normalizedPhone: "+994507778898", accountVersion: 1, verifiedAt: new Date() } })
    await admin.identityApplicationGrant.create({ data: { organizationId: org, userId: shadowId, application: "CRM", status: "ACTIVE", role: "viewer" } })
    assert.equal(await login(writer, org, shadowId, commonPassword), null)
    assert.equal(await login(writer, other.organizationId, userId, newPassword), null)
    assert.equal(await session(writer, other.organizationId, userId, fresh.claims), null)
    checks.push("canonical_crm_revoked_grant_shadow_credential_or_other_tenant_cannot_authorize_or_restore_legacy_mode")

    phase("CANONICAL_CRM_ERRORS_AND_PRIVATE_HINT_TAMPERING")
    await admin.identityApplicationGrant.update({ where: grantKey, data: { status: "ACTIVE", role: "viewer", version: 4 } })
    const restored = await login(writer, org, userId, newPassword)
    assert.ok(restored)
    assert.equal(await session(writer, org, userId, fresh.claims), null)
    assert.deepEqual(await session(writer, org, userId, restored.claims), restored)
    const unavailable = { $transaction: async () => { throw new Error("synthetic unavailable") } }
    assert.equal(await login(unavailable, org, userId, newPassword), null)
    assert.equal(await session(unavailable, org, userId, restored.claims), null)
    assert.equal(await session(writer, org, userId, { ...restored.claims, role: "admin" }), null)
    assert.equal(await session(writer, org, userId, { ...restored.claims, credentialEpoch: restored.claims.credentialEpoch + 1 }), null)
    checks.push("canonical_crm_database_failure_or_tampered_private_claims_never_supply_authority")
  } finally {
    await admin.mtmSetting.update({ where: flag, data: { value: originalFlag.value } })
    await admin.organization.update({ where: { id: org }, data: originalCompany })
  }
}
