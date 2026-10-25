/** Only invoked from the admitted synthetic foundation fixture, never a CLI. */
import assert from "node:assert/strict"
import { checkRealTenantPolicy } from "./tenant-policy-contract.mjs"
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
  let accountVersion = account.version, credentialEpoch = account.credentialEpoch, timeVersion = 7, fieldMemberVersion = 3, fieldGrantVersion = 1
  function fixtureState(application) {
    return { company: { id: org, isActive: true, identityMobileEnabled: true }, person: { ...scope, isActive: true, anonymizedAt: null },
      account: { ...scope, version: accountVersion, credentialEpoch, cutoverAt: account.cutoverAt }, claim: { ...scope, id: claim.id },
      grant: { ...scope, application, status: "ACTIVE", role: application === "TIME" ? "EMPLOYEE" : "AGENT", version: application === "TIME" ? 1 : fieldGrantVersion },
      membership: { ...scope, application, actorId, active: true, version: application === "TIME" ? timeVersion : fieldMemberVersion },
      binding: { ...scope, actorId, status: "REVIEWED" }, actor: { ...scope, id: actorId, status: "ACTIVE" }, license: { application, enabled: true } }
  }
  const token = application => issue(fixtureState(application), application, key, new Date())
  let policyMode = "enabled", policyCalls = 0
  const policy = async (tx, organizationId, application) => {
    const [guard] = await tx.$queryRawUnsafe("SELECT current_setting('transaction_isolation') AS isolation,current_setting('transaction_read_only') AS ro,current_setting('app.org_id',true) AS org,current_setting('app.rls_bypass',true) AS bypass")
    assert.deepEqual(guard, { isolation: "repeatable read", ro: "on", org, bypass: "off" })
    assert.equal(organizationId, org); assert.ok(["TIME", "ROUTE_FIELD"].includes(application)); policyCalls++
    if (policyMode === "error") throw new Error("synthetic-private-policy-error-not-for-output")
    if (policyMode === "readwrite") {
      await tx.$executeRawUnsafe("SET TRANSACTION READ WRITE")
      await tx.$executeRawUnsafe('UPDATE identity_accounts SET version=version+1 WHERE "organizationId"=$1 AND "userId"=$2', org, userId)
    }
    if (policyMode === "write") await tx.$executeRawUnsafe('UPDATE identity_accounts SET version=version+1 WHERE "organizationId"=$1 AND "userId"=$2', org, userId)
    if (policyMode === "bypass") await tx.$queryRawUnsafe("SELECT set_config('app.rls_bypass','on',true)")
    return { identityEnabled: policyMode !== "disabled", licensed: policyMode !== "time-unlicensed" || application !== "TIME" }
  }
  const auth = (jwt, application = "TIME", client = writer) => authenticate(client, jwt, application, keyRing, policy)

  phase("ACCOUNT_SECURITY_REVISIONS_AND_AUTHORITY_NEVER_ROLL_BACK")
  const refused = work => assert.rejects(work, error => error?.meta?.code === "23514")
  await refused(() => admin.$executeRawUnsafe('UPDATE identity_accounts SET version=version-1 WHERE "organizationId"=$1 AND "userId"=$2', org, userId))
  await refused(() => admin.$executeRawUnsafe('UPDATE identity_accounts SET "credentialEpoch"="credentialEpoch"-1 WHERE "organizationId"=$1 AND "userId"=$2', org, userId))
  await refused(() => admin.$executeRawUnsafe('UPDATE identity_accounts SET "cutoverAt"=NULL WHERE "organizationId"=$1 AND "userId"=$2', org, userId))
  await refused(() => admin.$executeRawUnsafe('UPDATE identity_accounts SET "passwordHash"=$1 WHERE "organizationId"=$2 AND "userId"=$3', "synthetic-refused-hash", org, userId))
  await refused(() => admin.$executeRawUnsafe('UPDATE identity_accounts SET "cutoverAt"=now(),"passwordHash"=$1 WHERE "organizationId"=$2 AND "userId"=$3', "synthetic-refused-cutover", org, "identity-user-a10"))
  checks.push("database_refuses_account_epoch_revision_rollback_or_authority_hash_change_without_new_epoch")

  // Dedicated NOLOGIN/NOBYPASSRLS fixture role, not a wider snapshot/staging
  // writer. It has only the columns needed for real lifecycle/RLS tests.
  await admin.$executeRawUnsafe("CREATE ROLE identity_lifecycle_operator NOLOGIN NOSUPERUSER NOBYPASSRLS")
  await admin.$executeRawUnsafe("GRANT USAGE ON SCHEMA public TO identity_lifecycle_operator")
  await admin.$executeRawUnsafe("GRANT SELECT ON users,mtm_agents,identity_accounts,identity_application_grants,identity_application_memberships TO identity_lifecycle_operator")
  // The database legacy-write fence must also inspect the immutable original
  // owner during a direct relink; this role still cannot mutate that binding.
  await admin.$executeRawUnsafe('GRANT SELECT ("organizationId","actorId","userId") ON identity_actor_bindings TO identity_lifecycle_operator')
  await admin.$executeRawUnsafe('GRANT UPDATE ("isActive","anonymizedAt","passwordChangedAt") ON users TO identity_lifecycle_operator')
  await admin.$executeRawUnsafe('GRANT UPDATE ("userId",status) ON mtm_agents TO identity_lifecycle_operator')
  await admin.$executeRawUnsafe('GRANT UPDATE (version,"credentialEpoch","updatedAt") ON identity_accounts TO identity_lifecycle_operator')
  await admin.$executeRawUnsafe('GRANT UPDATE (version,"updatedAt") ON identity_application_memberships TO identity_lifecycle_operator')
  await admin.$executeRawUnsafe("GRANT INSERT ON identity_events TO identity_lifecycle_operator")
  await admin.$executeRawUnsafe(`CREATE POLICY identity_fixture_lifecycle_user ON users FOR UPDATE TO identity_lifecycle_operator USING ("organizationId"=current_setting('app.org_id',true)) WITH CHECK ("organizationId"=current_setting('app.org_id',true))`)
  await admin.$executeRawUnsafe(`CREATE POLICY identity_fixture_lifecycle_actor ON mtm_agents FOR UPDATE TO identity_lifecycle_operator USING ("organizationId"=current_setting('app.org_id',true)) WITH CHECK ("organizationId"=current_setting('app.org_id',true))`)
  const lifecycle = work => admin.$transaction(async tx => {
    await tx.$executeRawUnsafe("SET LOCAL ROLE identity_lifecycle_operator")
    await tx.$queryRawUnsafe("SELECT set_config('app.org_id',$1,true),set_config('app.rls_bypass','off',true)", org)
    return work(tx)
  })
  await admin.$executeRawUnsafe(`CREATE FUNCTION identity_fixture_reject_lifecycle_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF current_setting('app.identity_contract_reject_lifecycle',true)='on' AND NEW.action IN ('PERSON_LIFECYCLE_CHANGED','ACTOR_LIFECYCLE_CHANGED') THEN
      RAISE EXCEPTION 'IDENTITY_SYNTHETIC_LIFECYCLE_AUDIT_FAILURE' USING ERRCODE='23514';
    END IF; RETURN NEW; END $$`)
  await admin.$executeRawUnsafe('CREATE TRIGGER identity_fixture_lifecycle_audit_failure BEFORE INSERT ON identity_events FOR EACH ROW EXECUTE FUNCTION identity_fixture_reject_lifecycle_audit()')

  phase("AUTHORITATIVE_LIFECYCLE_AUDIT_FAILURE_IS_ATOMIC")
  await refused(() => lifecycle(async tx => {
    await tx.$queryRawUnsafe("SELECT set_config('app.identity_contract_reject_lifecycle','on',true)")
    await tx.$executeRawUnsafe('UPDATE users SET "isActive"=false WHERE id=$1', userId)
  }))
  assert.equal((await admin.$queryRawUnsafe('SELECT "isActive" FROM users WHERE id=$1', userId))[0].isActive, true)
  assert.equal((await admin.identityAccount.findUniqueOrThrow({ where: accountKey })).credentialEpoch, credentialEpoch)
  await refused(() => lifecycle(async tx => {
    await tx.$queryRawUnsafe("SELECT set_config('app.identity_contract_reject_lifecycle','on',true)")
    await tx.$executeRawUnsafe("UPDATE mtm_agents SET status='INACTIVE' WHERE id=$1", actorId)
  }))
  assert.equal((await admin.identityApplicationMembership.findUniqueOrThrow({ where: memberKey("TIME") })).version, timeVersion)
  assert.equal((await admin.$queryRawUnsafe('SELECT status FROM mtm_agents WHERE id=$1', actorId))[0].status, "ACTIVE")
  assert.equal(await lifecycle(tx => tx.$executeRawUnsafe('UPDATE users SET "isActive"=false WHERE id=$1', "identity-user-b")), 0)
  checks.push("scoped_authoritative_lifecycle_audit_failure_rolls_back_person_actor_and_security_revisions")

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
  policyMode = "readwrite"; assert.equal(await auth(timeToken), null)
  assert.equal((await admin.identityAccount.findUniqueOrThrow({ where: accountKey })).version, accountVersion)
  policyMode = "bypass"; assert.equal(await auth(timeToken), null)
  policyMode = "enabled"
  const stagedUser = "identity-user-a10", stagedActor = "binding-agent-a10"
  const stagedClaim = await admin.identityPhoneClaim.create({ data: { organizationId: org, userId: stagedUser, normalizedPhone: "+994558812346", accountVersion: 1, verifiedAt: new Date() } })
  const stagedState = fixtureState("TIME")
  for (const row of [stagedState.person, stagedState.account, stagedState.claim, stagedState.grant, stagedState.membership, stagedState.binding, stagedState.actor]) row.userId = stagedUser
  Object.assign(stagedState.account, { version: 1, credentialEpoch: 1, cutoverAt: new Date() })
  stagedState.claim.id = stagedClaim.id; stagedState.grant.version = 1
  Object.assign(stagedState.membership, { actorId: stagedActor, version: 1 }); stagedState.binding.actorId = stagedActor; stagedState.actor.id = stagedActor
  // A test-only mis-signed authoritative assumption cannot override the real
  // staged database row. No immutable cutover is cleared to run this test.
  const stagedToken = issue(stagedState, "TIME", key, new Date())
  assert.equal(await auth(stagedToken), null)
  assert.notEqual(await auth(timeToken), null)
  checks.push("resolver_has_no_implicit_license_rollout_legacy_or_unsafe_transaction_fallback")

  await checkRealTenantPolicy({ admin, writer, build, org, timeToken, fieldToken, keyRing, checks, phase })

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
  await lifecycle(tx => tx.$executeRawUnsafe('UPDATE mtm_agents SET "userId"=$1 WHERE id=$2', otherUserId, actorId))
  assert.equal(await auth(currentTime), null)
  await lifecycle(tx => tx.$executeRawUnsafe('UPDATE mtm_agents SET "userId"=$1 WHERE id=$2', userId, actorId))
  assert.equal(await auth(currentTime), null)
  timeVersion += 2; fieldMemberVersion += 2
  assert.equal((await admin.identityApplicationMembership.findUniqueOrThrow({ where: memberKey("TIME") })).version, timeVersion)
  const afterRelink = token("TIME"); assert.notEqual(await auth(afterRelink), null)
  await lifecycle(tx => tx.$executeRawUnsafe("UPDATE mtm_agents SET status='INACTIVE' WHERE id=$1", actorId))
  assert.equal(await auth(afterRelink), null)
  await lifecycle(tx => tx.$executeRawUnsafe("UPDATE mtm_agents SET status='ACTIVE' WHERE id=$1", actorId))
  assert.equal(await auth(afterRelink), null)
  timeVersion += 2; fieldMemberVersion += 2
  assert.equal((await admin.identityApplicationMembership.findUniqueOrThrow({ where: memberKey("ROUTE_FIELD") })).version, fieldMemberVersion)
  const afterActorRestore = token("TIME"); assert.notEqual(await auth(afterActorRestore), null)
  await lifecycle(tx => tx.$executeRawUnsafe('UPDATE users SET "isActive"=false WHERE id=$1', userId))
  assert.equal(await auth(afterActorRestore), null)
  await lifecycle(tx => tx.$executeRawUnsafe('UPDATE users SET "isActive"=true WHERE id=$1', userId))
  assert.equal(await auth(afterActorRestore), null)
  const restoredAccount = await admin.identityAccount.findUniqueOrThrow({ where: accountKey })
  assert.equal(restoredAccount.credentialEpoch, credentialEpoch + 2)
  credentialEpoch = restoredAccount.credentialEpoch; accountVersion = restoredAccount.version
  const afterPersonRestore = token("TIME"); assert.notEqual(await auth(afterPersonRestore), null)
  phase("EXISTING_LOGOUT_ALL_MARKER_REVOKES_BOTH_CANONICAL_APPS_MONOTONICALLY")
  const beforeLogoutField = token("ROUTE_FIELD")
  const beforeLogout = await admin.identityAccount.findUniqueOrThrow({ where: accountKey })
  const auditCount = () => admin.identityEvent.count({ where: { ...scope, action: "PERSON_LIFECYCLE_CHANGED" } })
  const beforeLogoutEvents = await auditCount()
  const logoutAt = new Date("2026-01-01T00:00:00.000Z")
  await refused(() => lifecycle(async tx => {
    await tx.$queryRawUnsafe("SELECT set_config('app.identity_contract_reject_lifecycle','on',true)")
    await tx.$executeRawUnsafe('UPDATE users SET "passwordChangedAt"=$1 WHERE id=$2', logoutAt, userId)
  }))
  assert.equal((await admin.$queryRawUnsafe('SELECT "passwordChangedAt" FROM users WHERE id=$1', userId))[0].passwordChangedAt, null)
  assert.equal((await admin.identityAccount.findUniqueOrThrow({ where: accountKey })).credentialEpoch, credentialEpoch)
  assert.equal(await auditCount(), beforeLogoutEvents)
  await lifecycle(tx => tx.$executeRawUnsafe('UPDATE users SET "passwordChangedAt"=$1 WHERE id=$2', logoutAt, userId))
  assert.equal(await auth(afterPersonRestore), null); assert.equal(await auth(beforeLogoutField, "ROUTE_FIELD"), null)
  const afterLogout = await admin.identityAccount.findUniqueOrThrow({ where: accountKey })
  assert.equal(afterLogout.credentialEpoch, credentialEpoch + 1); assert.equal(afterLogout.version, accountVersion + 1)
  assert.equal(afterLogout.passwordHash, beforeLogout.passwordHash)
  assert.equal(await auditCount(), beforeLogoutEvents + 1)
  assert.equal((await admin.identityApplicationMembership.findUniqueOrThrow({ where: memberKey("TIME") })).version, timeVersion)
  assert.equal((await admin.identityApplicationMembership.findUniqueOrThrow({ where: memberKey("ROUTE_FIELD") })).version, fieldMemberVersion)
  credentialEpoch = afterLogout.credentialEpoch; accountVersion = afterLogout.version
  const afterLogoutTime = token("TIME"), afterLogoutField = token("ROUTE_FIELD")
  assert.notEqual(await auth(afterLogoutTime), null); assert.notEqual(await auth(afterLogoutField, "ROUTE_FIELD"), null)
  await lifecycle(tx => tx.$executeRawUnsafe('UPDATE users SET "passwordChangedAt"=$1 WHERE id=$2', logoutAt, userId))
  assert.equal((await admin.identityAccount.findUniqueOrThrow({ where: accountKey })).credentialEpoch, credentialEpoch)
  assert.notEqual(await auth(afterLogoutTime), null)
  assert.equal(await auditCount(), beforeLogoutEvents + 1)
  await lifecycle(tx => tx.$executeRawUnsafe('UPDATE users SET "passwordChangedAt"=$1 WHERE id=$2', new Date("2025-01-01T00:00:00.000Z"), userId))
  assert.equal(await auth(afterLogoutTime), null); assert.equal(await auth(afterLogoutField, "ROUTE_FIELD"), null)
  const afterBackdate = await admin.identityAccount.findUniqueOrThrow({ where: accountKey })
  assert.equal(afterBackdate.credentialEpoch, ++credentialEpoch); assert.equal(afterBackdate.version, ++accountVersion)
  const afterBackdateTime = token("TIME"), afterBackdateField = token("ROUTE_FIELD")
  assert.notEqual(await auth(afterBackdateTime), null); assert.notEqual(await auth(afterBackdateField, "ROUTE_FIELD"), null)
  await lifecycle(tx => tx.$executeRawUnsafe('UPDATE users SET "passwordChangedAt"=NULL WHERE id=$1', userId))
  assert.equal(await auth(afterBackdateTime), null); assert.equal(await auth(afterBackdateField, "ROUTE_FIELD"), null)
  const afterClear = await admin.identityAccount.findUniqueOrThrow({ where: accountKey })
  assert.equal(afterClear.credentialEpoch, ++credentialEpoch); assert.equal(afterClear.version, ++accountVersion)
  assert.equal(await auditCount(), beforeLogoutEvents + 3)
  assert.equal(await auth(afterPersonRestore), null)
  const stagedBefore = await admin.identityAccount.findUniqueOrThrow({ where: { organizationId_userId: { organizationId: org, userId: stagedUser } } })
  await lifecycle(tx => tx.$executeRawUnsafe('UPDATE users SET "passwordChangedAt"=$1 WHERE id=$2', logoutAt, stagedUser))
  const stagedAfter = await admin.identityAccount.findUniqueOrThrow({ where: { organizationId_userId: { organizationId: org, userId: stagedUser } } })
  assert.equal(stagedAfter.version, stagedBefore.version + 1); assert.equal(stagedAfter.credentialEpoch, stagedBefore.credentialEpoch + 1)
  assert.equal(stagedAfter.passwordHash, stagedBefore.passwordHash)
  assert.equal(stagedAfter.cutoverAt, null)
  checks.push("existing_logout_all_marker_revokes_both_apps_atomically_without_password_or_membership_change_and_cannot_revive_old_sessions")
  const beforeAnonymization = token("TIME"); assert.notEqual(await auth(beforeAnonymization), null)
  await lifecycle(tx => tx.$executeRawUnsafe('UPDATE users SET "anonymizedAt"=now() WHERE id=$1', userId))
  assert.equal(await auth(beforeAnonymization), null)
  const binding = await admin.identityActorBinding.findUniqueOrThrow({ where: { organizationId_actorId: { organizationId: org, actorId } } })
  assert.equal(binding.userId, userId)
  checks.push("actual_resolver_revokes_shared_credentials_and_lifecycle_reactivation_never_revives_old_person_or_actor_sessions")
}
