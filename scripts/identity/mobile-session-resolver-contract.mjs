/** Only invoked from the admitted synthetic foundation fixture, never a CLI. */
import assert from "node:assert/strict"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"

export async function checkIdentityResolver({ admin, writer, build, actor, userId, actorId, otherUserId, checks, phase }) {
  phase("AUTHORITATIVE_RESOLVER_IMPORTS")
  const { issueIdentityMobileSession: issue } = await import(pathToFileURL(resolve(build, "mobile-session.js")).href)
  const { resolveIdentityMobileSession: authenticate } = await import(pathToFileURL(resolve(build, "mobile-session-resolver.js")).href)
  const org = actor.organizationId, scope = { organizationId: org, userId }
  const key = { purpose: "IDENTITY_MOBILE_SESSION", id: "synthetic-resolver-key", material: new Uint8Array(32).fill(31) }
  const keyRing = id => id === key.id ? key : null
  const accountKey = { organizationId_userId: scope }
  const memberKey = application => ({ organizationId_userId_application: { ...scope, application } })
  // Synthetic post-auth/cutover fixture, not a password-login test or rollout.
  const account = await admin.identityAccount.findUniqueOrThrow({ where: accountKey })
  const claim = await admin.identityPhoneClaim.create({ data: { ...scope, normalizedPhone: "+994558812345", accountVersion: account.version, verifiedAt: new Date() } })
  await admin.identityApplicationMembership.update({ where: memberKey("TIME"), data: { status: "ACTIVE", version: 7 } })
  await admin.identityApplicationMembership.update({ where: memberKey("ROUTE_FIELD"), data: { status: "ACTIVE", version: 3 } })
  let accountVersion = account.version, credentialEpoch = account.credentialEpoch, timeVersion = 7, fieldGrantVersion = 1
  function fixtureState(application) {
    return { company: { id: org, isActive: true, identityMobileEnabled: true }, person: { ...scope, isActive: true, anonymizedAt: null },
      account: { ...scope, version: accountVersion, credentialEpoch, cutoverAt: account.cutoverAt }, claim: { ...scope, id: claim.id },
      grant: { ...scope, application, status: "ACTIVE", role: application === "TIME" ? "EMPLOYEE" : "AGENT", version: application === "TIME" ? 1 : fieldGrantVersion },
      membership: { ...scope, application, actorId, active: true, version: application === "TIME" ? timeVersion : 3 },
      binding: { ...scope, actorId, status: "REVIEWED" }, actor: { ...scope, id: actorId, status: "ACTIVE" }, license: { application, enabled: true } }
  }
  const token = application => issue(fixtureState(application), application, key, new Date())
  let policyMode = "enabled", policyCalls = 0
  const policy = async (tx, organizationId, application) => {
    const [guard] = await tx.$queryRawUnsafe("SELECT current_setting('transaction_isolation') AS isolation,current_setting('transaction_read_only') AS ro,current_setting('app.org_id',true) AS org,current_setting('app.rls_bypass',true) AS bypass")
    assert.deepEqual(guard, { isolation: "repeatable read", ro: "on", org, bypass: "off" })
    assert.equal(organizationId, org); assert.ok(["TIME", "ROUTE_FIELD"].includes(application)); policyCalls++
    if (policyMode === "error") throw new Error("synthetic-private-policy-error-not-for-output")
    if (policyMode === "write") await tx.$executeRawUnsafe('UPDATE identity_accounts SET version=version+1 WHERE "organizationId"=$1 AND "userId"=$2', org, userId)
    if (policyMode === "bypass") await tx.$queryRawUnsafe("SELECT set_config('app.rls_bypass','on',true)")
    return { identityEnabled: policyMode !== "disabled", licensed: policyMode !== "time-unlicensed" || application !== "TIME" }
  }
  const auth = (jwt, application = "TIME", client = writer) => authenticate(client, jwt, application, keyRing, policy)

  phase("RESOLVER_CHECKS_CRYPTO_BEFORE_BUSINESS_AND_SCOPES_READ_SNAPSHOT")
  const timeToken = token("TIME"), fieldToken = token("ROUTE_FIELD")
  let opens = 0
  const mustNotOpen = { $transaction: async () => { opens++; throw new Error("UNVERIFIED_TRANSACTION_OPENED") } }
  assert.equal(await auth("lds1.key.proof.signature", "TIME", mustNotOpen), null)
  assert.equal(await auth(timeToken, "ROUTE_FIELD", mustNotOpen), null)
  const parts = timeToken.split("."); parts[2] = (parts[2][0] === "A" ? "B" : "A") + parts[2].slice(1)
  assert.equal(await auth(parts.join("."), "TIME", mustNotOpen), null); assert.equal(opens, 0)
  assert.equal((await auth(timeToken)).role, "EMPLOYEE")
  assert.equal((await auth(fieldToken, "ROUTE_FIELD")).role, "AGENT")
  // Match prisma.ts's interactive wrapper ordering: set_config precedes callback.
  // The resolver must still enforce READ ONLY and replace any inherited bypass.
  const preconfigured = { $transaction: (work, options) => writer.$transaction(async tx => {
    await tx.$queryRawUnsafe("SELECT set_config('app.rls_bypass','on',true)")
    return work(tx)
  }, options) }
  assert.equal((await auth(timeToken, "TIME", preconfigured)).actorId, actorId)
  assert.ok(policyCalls >= 3)
  checks.push("real_jwt_resolver_verifies_before_database_and_enforces_readonly_repeatable_tenant_snapshot_even_after_inherited_bypass")

  phase("RESOLVER_FIXED_POLICY_AND_READONLY_FAIL_CLOSED")
  policyMode = "time-unlicensed"; assert.equal(await auth(timeToken), null); assert.notEqual(await auth(fieldToken, "ROUTE_FIELD"), null)
  policyMode = "disabled"; assert.equal(await auth(timeToken), null)
  policyMode = "error"; assert.equal(await auth(timeToken), null)
  policyMode = "write"; assert.equal(await auth(timeToken), null)
  assert.equal((await admin.identityAccount.findUniqueOrThrow({ where: accountKey })).version, accountVersion)
  policyMode = "bypass"; assert.equal(await auth(timeToken), null)
  policyMode = "enabled"
  await admin.identityAccount.update({ where: accountKey, data: { cutoverAt: null } })
  assert.equal(await auth(timeToken), null)
  await admin.identityAccount.update({ where: accountKey, data: { cutoverAt: account.cutoverAt } })
  assert.notEqual(await auth(timeToken), null)
  checks.push("resolver_has_no_implicit_license_rollout_legacy_or_unsafe_transaction_fallback")

  phase("RESOLVER_READS_CURRENT_INDEPENDENT_MEMBERSHIP_AND_GRANT")
  await admin.identityApplicationMembership.update({ where: memberKey("TIME"), data: { status: "REVOKED", version: 8 } })
  await admin.identityAccount.update({ where: accountKey, data: { version: ++accountVersion } })
  assert.equal(await auth(timeToken), null); assert.notEqual(await auth(fieldToken, "ROUTE_FIELD"), null)
  timeVersion = 9
  await admin.identityApplicationMembership.update({ where: memberKey("TIME"), data: { status: "ACTIVE", version: timeVersion } })
  await admin.identityAccount.update({ where: accountKey, data: { version: ++accountVersion } })
  assert.equal(await auth(timeToken), null)
  const freshTime = token("TIME"); assert.notEqual(await auth(freshTime), null)
  await admin.identityApplicationGrant.update({ where: memberKey("ROUTE_FIELD"), data: { status: "REVOKED", version: 2 } })
  assert.equal(await auth(fieldToken, "ROUTE_FIELD"), null); assert.notEqual(await auth(freshTime), null)
  fieldGrantVersion = 3
  await admin.identityApplicationGrant.update({ where: memberKey("ROUTE_FIELD"), data: { status: "ACTIVE", version: fieldGrantVersion } })
  assert.equal(await auth(fieldToken, "ROUTE_FIELD"), null)
  const freshField = token("ROUTE_FIELD"); assert.notEqual(await auth(freshField, "ROUTE_FIELD"), null)
  checks.push("actual_resolver_revokes_only_changed_app_and_never_revives_old_membership_or_grant_tokens")

  phase("RESOLVER_CREDENTIAL_AND_REVIEWED_ACTOR_OWNERSHIP")
  await admin.identityAccount.update({ where: accountKey, data: { credentialEpoch: ++credentialEpoch, version: ++accountVersion } })
  assert.equal(await auth(freshTime), null); assert.equal(await auth(freshField, "ROUTE_FIELD"), null)
  const currentTime = token("TIME"); assert.notEqual(await auth(currentTime), null)
  await admin.$executeRawUnsafe('UPDATE mtm_agents SET "userId"=$1 WHERE id=$2', otherUserId, actorId)
  assert.equal(await auth(currentTime), null)
  await admin.$executeRawUnsafe('UPDATE mtm_agents SET "userId"=$1 WHERE id=$2', userId, actorId)
  assert.notEqual(await auth(currentTime), null)
  await admin.$executeRawUnsafe('UPDATE users SET "isActive"=false WHERE id=$1', userId)
  assert.equal(await auth(currentTime), null)
  await admin.$executeRawUnsafe('UPDATE users SET "isActive"=true WHERE id=$1', userId)
  const binding = await admin.identityActorBinding.findUniqueOrThrow({ where: { organizationId_actorId: { organizationId: org, actorId } } })
  assert.equal(binding.userId, userId)
  checks.push("actual_resolver_revokes_shared_credential_epoch_and_refuses_stale_actor_link_or_inactive_person_without_history_transfer")
}
