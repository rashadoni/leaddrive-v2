/** Actual legacy authority checks, only in the admitted synthetic fixture. */
import assert from "node:assert/strict"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"

export async function checkLegacyBoundary({ admin, writer, actor, other, build, checks, phase }) {
  const module = name => import(pathToFileURL(resolve(build, `${name}.js`)).href)
  const { readLegacyCredentialBoundary: boundary } = await module("legacy-credential-boundary")
  const { stageIdentityAccount: stage } = await module("registry")
  const { reviewStagedIdentityActor: review } = await module("membership-registry")
  const { IDENTITY_AUTH_SETTING_KEY: flagKey } = await module("tenant-policy")
  const org = actor.organizationId, userId = "legacy-boundary-user-a", actorId = "legacy-boundary-actor-a"
  const anotherId = "legacy-boundary-user-other", betaId = "legacy-boundary-user-b", orphanId = "legacy-boundary-orphan"
  for (const [id, organizationId] of [[userId, org], [anotherId, org], [betaId, other.organizationId]]) {
    await admin.$executeRawUnsafe('INSERT INTO users (id,"organizationId","isActive",role) VALUES ($1,$2,true,\'viewer\')', id, organizationId)
  }
  for (const [id, linked] of [[actorId, userId], [orphanId, null]]) {
    await admin.$executeRawUnsafe('INSERT INTO mtm_agents (id,"organizationId","userId",role,status,"attendanceParticipant") VALUES ($1,$2,$3,\'AGENT\',\'ACTIVE\',false)', id, org, linked)
  }
  const user = id => ({ kind: "USER", userId: id }), card = id => ({ kind: "ACTOR", actorId: id })
  const read = principal => boundary(writer, org, principal)

  phase("LEGACY_BOUNDARY_PRESERVES_UNCONVERTED_AND_SHADOW_PRINCIPALS")
  assert.equal(await read(user(userId)), "LEGACY"); assert.equal(await read(card(actorId)), "LEGACY")
  assert.equal(await read(card(orphanId)), "LEGACY") // Eligibility only, not a password/grant success.
  await stage(writer, actor, { userId, requestId: "legacy-boundary-stage" })
  await review(writer, actor, { userId, actorId, expectedAccountVersion: 1, requestId: "legacy-boundary-review", reviewReference: "legacy-boundary-explicit-review" })
  assert.equal(await read(user(userId)), "LEGACY"); assert.equal(await read(card(actorId)), "LEGACY")
  const inherited = { $transaction: (work, options) => writer.$transaction(async tx => {
    await tx.$queryRawUnsafe("SELECT set_config('app.rls_bypass','on',true)")
    return work(tx)
  }, options) }
  assert.equal(await boundary(inherited, org, card(actorId)), "LEGACY")
  assert.equal(await boundary(writer, other.organizationId, user(betaId)), "LEGACY")
  checks.push("legacy_authority_boundary_preserves_unconverted_and_shadow_user_actor_behavior_in_scoped_readonly_snapshot")

  phase("AUTHORITATIVE_MARKER_REFUSES_LEGACY_WITHOUT_FLAG_OR_MUTABLE_LINK_FALLBACK")
  // Test-only partial cutover assumption, not enrollment/authentication: no
  // claim/grants or usable password. Even incomplete authority must block old auth.
  await admin.identityAccount.update({ where: { organizationId_userId: { organizationId: org, userId } }, data: {
    passwordHash: "!synthetic-legacy-boundary-marker", cutoverAt: new Date(), version: { increment: 1 }, credentialEpoch: { increment: 1 },
  } })
  const flag = { organizationId_key: { organizationId: org, key: flagKey } }
  const original = await admin.mtmSetting.findUniqueOrThrow({ where: flag, select: { value: true } })
  try {
    for (const value of [false, { version: 1, enabled: true }, "true"]) {
      await admin.mtmSetting.update({ where: flag, data: { value }, select: { id: true } })
      assert.equal(await read(user(userId)), "MIGRATED"); assert.equal(await read(card(actorId)), "MIGRATED")
    }
  } finally { await admin.mtmSetting.update({ where: flag, data: { value: original.value }, select: { id: true } }) }
  await admin.$executeRawUnsafe('UPDATE mtm_agents SET "userId"=$1 WHERE id=$2', anotherId, actorId)
  assert.equal(await read(card(actorId)), "MIGRATED"); assert.equal(await read(user(anotherId)), "LEGACY")
  await admin.$executeRawUnsafe('UPDATE mtm_agents SET "userId"=NULL WHERE id=$1', actorId)
  assert.equal(await read(card(actorId)), "MIGRATED")
  const unreviewed = "legacy-boundary-unreviewed-actor"
  await admin.$executeRawUnsafe('INSERT INTO mtm_agents (id,"organizationId","userId",role,status,"attendanceParticipant") VALUES ($1,$2,$3,\'AGENT\',\'ACTIVE\',false)', unreviewed, org, userId)
  assert.equal(await read(card(unreviewed)), "MIGRATED")
  assert.equal(await boundary(writer, other.organizationId, user(betaId)), "LEGACY")
  assert.equal(await admin.identityApplicationGrant.count({ where: { organizationId: org, userId } }), 0)
  checks.push("irreversible_authority_blocks_legacy_after_flag_off_relink_unlink_or_new_unreviewed_card_without_changing_other_people_or_tenants")

  phase("LEGACY_BOUNDARY_DENIES_MISSING_INACTIVE_FOREIGN_INVALID_OR_FAILED_READ")
  assert.equal(await read(user("missing-boundary-user")), "UNAVAILABLE")
  assert.equal(await read(card("missing-boundary-actor")), "UNAVAILABLE")
  assert.equal(await boundary(writer, other.organizationId, card(actorId)), "UNAVAILABLE")
  assert.equal(await boundary(writer, other.organizationId, user(userId)), "UNAVAILABLE")
  await admin.$executeRawUnsafe('UPDATE users SET "isActive"=false WHERE id=$1', anotherId)
  assert.equal(await read(user(anotherId)), "UNAVAILABLE")
  await admin.$executeRawUnsafe("UPDATE mtm_agents SET status='INACTIVE' WHERE id=$1", orphanId)
  assert.equal(await read(card(orphanId)), "UNAVAILABLE")
  let opens = 0
  const unavailable = { $transaction: async () => { opens++; throw new Error("synthetic-boundary-private-error") } }
  assert.equal(await boundary(unavailable, org, user(userId)), "UNAVAILABLE"); assert.equal(opens, 1)
  opens = 0
  for (const principal of [{ kind: "OTHER", userId }, { kind: "USER", userId, actorId }, { kind: "USER", userId: "bad/id" }, null]) {
    assert.equal(await boundary(unavailable, org, principal), "UNAVAILABLE")
  }
  assert.equal(opens, 0)
  checks.push("legacy_boundary_never_treats_missing_inactive_foreign_invalid_context_or_database_failure_as_legacy_permission")
}
