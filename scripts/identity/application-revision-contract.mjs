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
