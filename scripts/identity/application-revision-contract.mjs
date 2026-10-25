/** Storage invariants in the already-admitted disposable CI database only. */
import assert from "node:assert/strict"

export async function checkApplicationRevisions({ admin, actor, checks, phase }) {
  const organizationId = actor.organizationId, userId = "revision-guard-user", actorId = "revision-guard-actor"
  await admin.$executeRawUnsafe('INSERT INTO users (id,"organizationId","isActive",role) VALUES ($1,$2,true,\'viewer\')', userId, organizationId)
  await admin.$executeRawUnsafe('INSERT INTO mtm_agents (id,"organizationId","userId",role,status,"attendanceParticipant") VALUES ($1,$2,$3,\'AGENT\',\'ACTIVE\',false)', actorId, organizationId, userId)
  await admin.identityAccount.create({ data: { organizationId, userId } })
  await admin.identityActorBinding.create({ data: { organizationId, userId, actorId, reviewedByUserId: actor.userId, reviewReference: "revision-guard-explicit-review", accountVersion: 1 } })
  for (const [application, role] of [["TIME", "EMPLOYEE"], ["ROUTE_FIELD", "AGENT"]]) {
    await admin.identityApplicationGrant.create({ data: { organizationId, userId, application, role, status: "ACTIVE" } })
    await admin.identityApplicationMembership.create({ data: { organizationId, userId, actorId, application, status: "ACTIVE" } })
  }
  const key = application => ({ organizationId_userId_application: { organizationId, userId, application } })
  const refused = work => assert.rejects(work, error => error?.meta?.code === "23514")
  // Identifiers/clauses below are fixed test source; all scope values are bound.
  const update = (table, clause) => admin.$executeRawUnsafe(`UPDATE ${table} SET ${clause} WHERE "organizationId"=$1 AND "userId"=$2 AND application='TIME'`, organizationId, userId)
  const grantsBefore = await admin.identityApplicationGrant.count(), membersBefore = await admin.identityApplicationMembership.count()

  phase("ACCOUNT_AUTHORITY_CANNOT_BE_DELETED_OR_RECREATED_WITH_OLD_EPOCH")
  const retained = "revision-guard-partial-account"
  await admin.$executeRaw`INSERT INTO users (id,"organizationId","isActive",role) VALUES (${retained},${organizationId},true,'viewer')`
  await admin.identityAccount.create({ data: { organizationId, userId: retained } })
  // No events/claim/grant/binding children: a FK failure cannot accidentally
  // prove retention. The account's own guard must reject even this shadow row.
  await refused(() => admin.$executeRaw`DELETE FROM identity_accounts WHERE "organizationId" = ${organizationId} AND "userId" = ${retained}`)
  await admin.identityAccount.update({ where: { organizationId_userId: { organizationId, userId: retained } }, data: {
    cutoverAt: new Date(), passwordHash: "!fixture-retained-authority", version: { increment: 1 }, credentialEpoch: { increment: 1 },
  } })
  const retainedKey = { organizationId_userId: { organizationId, userId: retained } }
  const before = await admin.identityAccount.findUniqueOrThrow({ where: retainedKey, select: { cutoverAt: true, credentialEpoch: true, version: true, passwordHash: true } })
  await refused(() => admin.$executeRaw`DELETE FROM identity_accounts WHERE "organizationId" = ${organizationId} AND "userId" = ${retained}`)
  assert.deepEqual(await admin.identityAccount.findUniqueOrThrow({ where: retainedKey, select: { cutoverAt: true, credentialEpoch: true, version: true, passwordHash: true } }), before)
  await assert.rejects(admin.identityAccount.create({ data: { organizationId, userId: retained, version: 1, credentialEpoch: 1 } }), error => error?.code === "P2002")
  // Bind the real statement trigger, then exercise it first in a fixed
  // complete FK table set. Even a broken guard is rolled back by the explicit
  // throw; an error from a child trigger cannot satisfy the expected message.
  const [truncate] = await admin.$queryRaw`SELECT count(*)::int AS count FROM pg_trigger
    WHERE tgrelid = 'identity_accounts'::regclass AND NOT tgisinternal AND tgenabled = 'O'
      AND tgname = 'identity_account_truncate_guard' AND (tgtype::int & 32) = 32
      AND tgfoid = 'identity_guard_account_revision()'::regprocedure`
  assert.equal(truncate.count, 1)
  await assert.rejects(admin.$transaction(async tx => {
    await tx.$executeRawUnsafe("TRUNCATE identity_accounts, identity_application_grants, identity_actor_bindings, identity_application_memberships, identity_phone_claims, identity_phone_reservations, identity_phone_proofs, identity_phone_proof_outbox, identity_events, identity_onboarding_intents")
    throw new Error("fixture-account-truncate-was-not-refused")
  }), error => error?.meta?.code === "23514" && String(error?.meta?.message).includes("IDENTITY_ACCOUNT_STATE_RETAINED"))
  assert.deepEqual(await admin.identityAccount.findUniqueOrThrow({ where: retainedKey, select: { cutoverAt: true, credentialEpoch: true, version: true, passwordHash: true } }), before)
  checks.push("database_account_authority_and_epochs_are_retained_even_without_child_rows_and_delete_recreate_or_truncate_cannot_restore_legacy_state")

  phase("GRANT_REVISIONS_CANNOT_ROLL_BACK_REACTIVATE_IN_PLACE_OR_BE_RECREATED")
  const grants = "identity_application_grants"
  await refused(() => update(grants, "status='REVOKED'"))
  await refused(() => update(grants, "role='REVIEWER'"))
  await refused(() => update(grants, `"userId"='revision-guard-other',version=version+1`))
  await refused(() => update(grants, "application='CRM',version=version+1"))
  await update(grants, "status=status,version=version")
  await update(grants, "status='REVOKED',version=2")
  await refused(() => update(grants, "status='ACTIVE'"))
  await update(grants, "status='ACTIVE',role='REVIEWER',version=3")
  await refused(() => update(grants, "version=1"))
  assert.equal((await admin.identityApplicationGrant.findUniqueOrThrow({ where: key("TIME") })).version, 3)
  assert.equal((await admin.identityApplicationGrant.findUniqueOrThrow({ where: key("ROUTE_FIELD") })).version, 1)
  await refused(() => admin.$executeRawUnsafe('DELETE FROM identity_application_grants WHERE "organizationId"=$1 AND "userId"=$2', organizationId, userId))
  await refused(() => admin.$executeRawUnsafe("TRUNCATE identity_application_grants CASCADE"))
  assert.equal(await admin.identityApplicationGrant.count(), grantsBefore)
  assert.equal(await admin.identityApplicationMembership.count(), membersBefore)
  checks.push("database_grants_require_new_versions_for_status_or_role_changes_and_refuse_rollback_scope_transfer_delete_or_truncate")

  phase("MEMBERSHIP_REVISIONS_AND_ORIGINAL_ACTOR_CANNOT_BE_REPLACED")
  const members = "identity_application_memberships"
  await refused(() => update(members, "status='REVOKED'"))
  await refused(() => update(members, `"actorId"='revision-guard-other-actor',version=version+1`))
  await refused(() => update(members, `"organizationId"='identity-company-b',version=version+1`))
  await refused(() => update(members, "application='ROUTE_FIELD',version=version+1"))
  await update(members, "status=status,version=version")
  await update(members, "status='REVOKED',version=2")
  await refused(() => update(members, "status='ACTIVE'"))
  await update(members, "status='ACTIVE',version=3")
  await refused(() => update(members, "version=1"))
  const current = await admin.identityApplicationMembership.findUniqueOrThrow({ where: key("TIME") })
  assert.equal(current.version, 3); assert.equal(current.actorId, actorId)
  assert.equal((await admin.identityApplicationMembership.findUniqueOrThrow({ where: key("ROUTE_FIELD") })).version, 1)
  await refused(() => admin.$executeRawUnsafe('DELETE FROM identity_application_memberships WHERE "organizationId"=$1 AND "userId"=$2', organizationId, userId))
  await refused(() => admin.$executeRawUnsafe("TRUNCATE identity_application_memberships"))
  assert.equal(await admin.identityApplicationGrant.count(), grantsBefore)
  assert.equal(await admin.identityApplicationMembership.count(), membersBefore)
  checks.push("database_membership_versions_and_original_actor_are_retained_without_reviving_old_versions_or_mutating_sibling_app")
}
