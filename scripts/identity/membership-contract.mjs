/** Runs only within the already-admitted disposable foundation database. */
import assert from "node:assert/strict"
import { checkIdentityResolver } from "./mobile-session-resolver-contract.mjs"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"

export async function checkMembershipTransactions({ admin, writer, failing, actor, other, build, checks, phase }) {
  phase("MEMBERSHIP_TRANSACTION_IMPORTS")
  const { reviewStagedIdentityActor: review, planStagedIdentityMembership: member } = await import(pathToFileURL(resolve(build, "membership-registry.js")).href)
  const { stageIdentityAccount, planStagedApplicationGrant: grant } = await import(pathToFileURL(resolve(build, "registry.js")).href)
  const org = actor.organizationId
  async function setup(label) {
    const userId = `membership-user-${label}`, actorId = `membership-actor-${label}`
    await admin.$executeRawUnsafe('INSERT INTO users (id,"organizationId","isActive",role,"passwordHash") VALUES ($1,$2,true,\'viewer\',\'legacy-untouched\')', userId, org)
    await admin.$executeRawUnsafe('INSERT INTO mtm_agents (id,"organizationId","userId",role,status,"attendanceParticipant") VALUES ($1,$2,$3,\'AGENT\',\'ACTIVE\',false)', actorId, org, userId)
    await stageIdentityAccount(writer, actor, { userId, requestId: `membership-stage-${label}` })
    return { userId, actorId, expectedAccountVersion: 1, reviewReference: `explicit-review-${label}`, requestId: `actor-review-${label}` }
  }
  const account = userId => admin.identityAccount.findUniqueOrThrow({ where: { organizationId_userId: { organizationId: org, userId } } })
  const currentMember = (userId, application) => admin.identityApplicationMembership.findUniqueOrThrow({ where: { organizationId_userId_application: { organizationId: org, userId, application } } })

  phase("EXPLICIT_ACTOR_REVIEW_AUTHORIZATION_AND_IDEMPOTENCY")
  const base = await setup("base")
  await assert.rejects(review(writer, { ...actor, userId: "identity-user-a2" }, base), /IDENTITY_ADMIN_REQUIRED/)
  await assert.rejects(review(writer, other, base), /IDENTITY_SUBJECT_UNAVAILABLE/)
  await assert.rejects(review(writer, actor, { ...base, actorId: "identity-agent-b" }), /IDENTITY_ACTOR_UNAVAILABLE/)
  await assert.rejects(review(writer, actor, { ...base, expectedAccountVersion: 2 }), /IDENTITY_ACCOUNT_STALE/)
  await assert.rejects(review(writer, actor, { ...base, phone: "+994550001122" }), /IDENTITY_MEMBERSHIP_INPUT_INVALID/)
  const reviewed = await Promise.all([review(writer, actor, base), review(writer, actor, base)])
  assert.equal(reviewed.filter(row => !row.replayed).length, 1)
  assert.equal((await account(base.userId)).version, 2)
  assert.equal(reviewed.every(row => row.authenticationChanged === false), true)
  await assert.rejects(review(writer, actor, { ...base, reviewReference: "different-review" }), /IDENTITY_REQUEST_REUSED/)
  await assert.rejects(review(writer, actor, { ...base, expectedAccountVersion: 2, requestId: "duplicate-reviewed-actor" }), /IDENTITY_ACTOR_ALREADY_REVIEWED/)
  checks.push("actor_review_is_explicit_admin_scoped_version_bound_and_idempotent_without_phone_matching")

  phase("ACTOR_REVIEW_ROLLBACK_AND_AMBIGUITY")
  const rollback = await setup("rollback")
  await assert.rejects(review(failing, actor, rollback), /SYNTHETIC_AUDIT_FAILURE/)
  assert.equal((await account(rollback.userId)).version, 1)
  assert.equal(await admin.identityActorBinding.count({ where: { organizationId: org, actorId: rollback.actorId } }), 0)
  const ambiguous = await setup("ambiguous")
  await admin.$executeRawUnsafe('INSERT INTO mtm_agents (id,"organizationId","userId",role,status,"attendanceParticipant") VALUES ($1,$2,$3,\'AGENT\',\'ACTIVE\',false)', "second-ambiguous-actor", org, ambiguous.userId)
  await assert.rejects(review(writer, actor, ambiguous), /IDENTITY_LEGACY_LINK_AMBIGUOUS/)
  assert.equal(await admin.identityActorBinding.count({ where: { organizationId: org, userId: ambiguous.userId } }), 0)
  checks.push("failed_review_audit_rolls_back_binding_revision_and_ambiguous_actors_are_never_adopted")

  phase("TWO_INDEPENDENT_MEMBERSHIPS_REQUIRE_REVIEWED_OWNERSHIP_AND_GRANTS")
  const time = { userId: base.userId, actorId: base.actorId, application: "TIME", status: "ACTIVE", expectedAccountVersion: 2, expectedMembershipVersion: 0, expectedGrantVersion: 1, requestId: "membership-time" }
  await assert.rejects(member(writer, actor, { ...time, application: "CRM" }), /IDENTITY_MEMBERSHIP_INPUT_INVALID/)
  await assert.rejects(member(writer, actor, { ...time, userId: rollback.userId, actorId: rollback.actorId, expectedAccountVersion: 1 }), /IDENTITY_ACTOR_BINDING_REQUIRED/)
  await assert.rejects(member(writer, actor, time), /IDENTITY_GRANT_STALE/)
  const grantInput = { userId: base.userId, application: "TIME", status: "ACTIVE", role: "EMPLOYEE", expectedAccountVersion: 2, expectedGrantVersion: 0, requestId: "membership-time-grant" }
  await grant(writer, actor, grantInput)
  time.expectedAccountVersion = 3
  await assert.rejects(member(writer, { ...actor, userId: "identity-user-a2" }, time), /IDENTITY_ADMIN_REQUIRED/)
  await assert.rejects(member(writer, actor, { ...time, expectedGrantVersion: 2 }), /IDENTITY_GRANT_STALE/)
  await assert.rejects(member(writer, actor, { ...time, expectedAccountVersion: 2 }), /IDENTITY_ACCOUNT_STALE/)
  const timeResult = await member(writer, actor, time)
  assert.equal(timeResult.membershipVersion, 1); assert.equal(timeResult.accountVersion, 4)
  assert.equal((await member(writer, actor, time)).replayed, true)
  await assert.rejects(member(writer, actor, { ...time, status: "REVOKED" }), /IDENTITY_REQUEST_REUSED/)
  await grant(writer, actor, { ...grantInput, application: "ROUTE_FIELD", role: "AGENT", expectedAccountVersion: 4, requestId: "membership-field-grant" })
  const field = { ...time, application: "ROUTE_FIELD", expectedAccountVersion: 5, requestId: "membership-field" }
  await member(writer, actor, field)
  const memberships = await admin.identityApplicationMembership.findMany({ where: { organizationId: org, userId: base.userId } })
  assert.equal(memberships.length, 2); assert.equal(memberships.every(row => row.actorId === base.actorId && row.status === "ACTIVE"), true)
  assert.equal(await admin.identityApplicationGrant.count({ where: { organizationId: org, userId: base.userId, application: "CRM" } }), 0)
  const legacy = await admin.$queryRawUnsafe('SELECT role,"attendanceParticipant","userId" FROM mtm_agents WHERE id=$1', base.actorId)
  assert.deepEqual(legacy[0], { role: "AGENT", attendanceParticipant: false, userId: base.userId })
  assert.equal((await account(base.userId)).passwordHash, null)
  checks.push("one_reviewed_actor_has_independent_time_field_membership_plans_without_crm_hr_role_or_credential_mutation")

  phase("MEMBERSHIP_REACTIVATION_ADVANCES_ONLY_ITS_OWN_VERSION")
  const revoke = { ...time, status: "REVOKED", expectedAccountVersion: 6, expectedMembershipVersion: 1, requestId: "membership-time-revoke" }
  assert.equal((await member(writer, actor, revoke)).membershipVersion, 2)
  assert.equal((await currentMember(base.userId, "ROUTE_FIELD")).version, 1)
  assert.equal((await currentMember(base.userId, "ROUTE_FIELD")).status, "ACTIVE")
  const reactivate = { ...time, expectedAccountVersion: 7, expectedMembershipVersion: 2, requestId: "membership-time-reactivate" }
  assert.equal((await member(writer, actor, reactivate)).membershipVersion, 3)
  assert.equal((await member(writer, actor, time)).membershipVersion, 1)
  assert.equal((await currentMember(base.userId, "TIME")).version, 3)
  assert.equal((await account(base.userId)).credentialEpoch, 1)
  checks.push("membership_revoke_reactivate_is_monotonic_without_revoking_sibling_or_reviving_old_version")

  phase("MEMBERSHIP_AUDIT_FAILURE_AND_CONCURRENT_CAS")
  const revokeCurrent = { ...revoke, expectedAccountVersion: 8, expectedMembershipVersion: 3, requestId: "membership-audit-failure" }
  await assert.rejects(member(failing, actor, revokeCurrent), /SYNTHETIC_AUDIT_FAILURE/)
  assert.equal((await account(base.userId)).version, 8)
  assert.equal((await currentMember(base.userId, "TIME")).version, 3)
  const raced = await Promise.allSettled(["a", "b"].map(suffix => member(writer, actor, { ...revokeCurrent, requestId: `membership-race-${suffix}` })))
  assert.equal(raced.filter(row => row.status === "fulfilled").length, 1)
  assert.equal(raced.filter(row => row.status === "rejected" && row.reason?.code === "IDENTITY_ACCOUNT_STALE").length, 1)
  const same = { ...time, expectedAccountVersion: 9, expectedMembershipVersion: 4, requestId: "membership-identical-race" }
  const sameResult = await Promise.all([member(writer, actor, same), member(writer, actor, same)])
  assert.equal(sameResult.filter(row => !row.replayed).length, 1)
  assert.equal((await account(base.userId)).version, 10)
  assert.equal((await currentMember(base.userId, "TIME")).version, 5)
  checks.push("membership_audit_failure_rolls_back_and_parallel_changes_have_one_revision")

  phase("LEGACY_ACTOR_RELINK_CANNOT_TRANSFER_REVIEWED_HISTORY")
  await admin.$executeRawUnsafe('UPDATE mtm_agents SET "userId"=$1 WHERE id=$2', rollback.userId, base.actorId)
  await assert.rejects(review(writer, actor, { ...rollback, actorId: base.actorId, requestId: "attempt-history-transfer" }), /IDENTITY_ACTOR_BINDING_CONFLICT/)
  await assert.rejects(member(writer, actor, { ...time, expectedAccountVersion: 10, expectedMembershipVersion: 5, requestId: "stale-actor-enable" }), /IDENTITY_ACTOR_UNAVAILABLE/)
  await member(writer, actor, { ...revoke, expectedAccountVersion: 10, expectedMembershipVersion: 5, requestId: "revoke-relinked-actor" })
  await admin.$executeRawUnsafe('UPDATE users SET "isActive"=false WHERE id=$1', base.userId)
  await member(writer, actor, { ...field, status: "REVOKED", expectedAccountVersion: 11, expectedMembershipVersion: 1, requestId: "revoke-inactive-person" })
  assert.equal((await account(base.userId)).version, 12)
  const binding = await admin.identityActorBinding.findUniqueOrThrow({ where: { organizationId_actorId: { organizationId: org, actorId: base.actorId } } })
  assert.equal(binding.userId, base.userId)
  assert.equal(await admin.identityApplicationMembership.count({ where: { organizationId: org, userId: rollback.userId } }), 0)
  await admin.$executeRawUnsafe('UPDATE mtm_agents SET "userId"=$1 WHERE id=$2', base.userId, base.actorId)
  await admin.$executeRawUnsafe('UPDATE users SET "isActive"=true WHERE id=$1', base.userId)
  await admin.identityAccount.update({ where: { organizationId_userId: { organizationId: org, userId: base.userId } }, data: { passwordHash: "synthetic-existing-credential-fixture", cutoverAt: new Date() } })
  await assert.rejects(member(writer, actor, { ...revoke, expectedAccountVersion: 12, expectedMembershipVersion: 6, requestId: "membership-after-cutover" }), /IDENTITY_ALREADY_AUTHORITATIVE/)
  checks.push("relinked_actor_never_transfers_history_revocation_remains_possible_and_staging_refuses_cutover")
  await checkIdentityResolver({ admin, writer, build, actor, userId: base.userId, actorId: base.actorId, otherUserId: rollback.userId, checks, phase })
}
