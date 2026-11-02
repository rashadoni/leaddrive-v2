/** Actual write/cutover races in the admitted disposable PostgreSQL fixture. */
import assert from "node:assert/strict"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { setTimeout as delay } from "node:timers/promises"

export async function checkLegacyWrites({ admin, writer, actor, other, build, checks, phase }) {
  const { withLegacyCredentialWrite: fence, withLegacyCredentialMaintenance: maintain } = await import(pathToFileURL(resolve(build, "legacy-credential-write.js")).href)
  const org = actor.organizationId, subjects = new Map()
  const deferred = () => {
    let resolve, reject
    const promise = new Promise((done, fail) => { resolve = done; reject = fail })
    const timer = setTimeout(() => reject(new Error("Legacy write race barrier timed out")), 8_000)
    timer.unref()
    promise.then(() => clearTimeout(timer), () => clearTimeout(timer))
    return { promise, resolve, reject }
  }
  const tenantLock = tx => tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'identity-registry:' + org}, 0))`
  const marker = (tx, userId) => tx.identityAccount.update({ where: { organizationId_userId: { organizationId: org, userId } }, data: {
    cutoverAt: new Date(), passwordHash: "!fixture-canonical-write", version: { increment: 1 }, credentialEpoch: { increment: 1 },
  } })
  const cutover = (userId, work) => admin.$transaction(async tx => {
    await tenantLock(tx)
    await tx.$queryRaw`SELECT id FROM users WHERE "organizationId" = ${org} AND id = ${userId} FOR SHARE`
    await marker(tx, userId)
    if (work) await work(tx)
  }, { isolationLevel: "ReadCommitted", timeout: 15_000 })
  const current = id => admin.mtmAgent.findFirstOrThrow({ where: { organizationId: org, id }, select: { passwordHash: true, userId: true } })
  const card = actorId => [{ kind: "ACTOR", actorId }]
  async function blocked(pid) {
    for (let attempt = 0; attempt < 80; attempt++) {
      const [state] = await admin.$queryRaw`SELECT EXISTS(SELECT 1 FROM pg_locks WHERE pid = ${pid} AND locktype = 'advisory' AND NOT granted) AS blocked`
      if (state.blocked) return
      await delay(25)
    }
    assert.fail("Expected transaction to wait for the common advisory lock")
  }
  // Temporarily grant just the credential column in this private scratch DB.
  // Existing tenant SELECT/UPDATE policies and NOBYPASSRLS remain unchanged.
  await admin.$executeRawUnsafe('GRANT UPDATE ("passwordHash") ON mtm_agents, users TO identity_foundation_writer')
  try {
    for (const name of ["normal", "writer-first", "cutover-first"]) {
      const userId = `legacy-write-user-${name}`, actorId = `legacy-write-actor-${name}`
      await admin.$executeRawUnsafe('INSERT INTO users (id,"organizationId","isActive",role) VALUES ($1,$2,true,\'viewer\')', userId, org)
      await admin.$executeRawUnsafe('INSERT INTO mtm_agents (id,"organizationId","userId",role,status,"attendanceParticipant","passwordHash") VALUES ($1,$2,$3,\'AGENT\',\'ACTIVE\',false,\'!fixture-old\')', actorId, org, userId)
      await admin.identityAccount.create({ data: { organizationId: org, userId } })
      subjects.set(name, { userId, actorId })
    }
    const normal = subjects.get("normal")
    const write = (actorId, value, work) => fence(writer, org, card(actorId), async tx => {
      // The minimal admitted fixture deliberately has no Prisma @updatedAt
      // column. Exercise a real bound credential CAS without inventing one.
      const count = await tx.$executeRaw`UPDATE mtm_agents SET "passwordHash" = ${value}
        WHERE "organizationId" = ${org} AND id = ${actorId} AND "passwordHash" = '!fixture-old'`
      if (work) await work(tx)
      return count
    })

    phase("LEGACY_WRITE_SCOPE_RLS_AND_ATOMIC_ROLLBACK")
    const before = await current(normal.actorId)
    await assert.rejects(write(normal.actorId, "!fixture-rollback", async () => { throw new Error("fixture-audit-failed") }), /fixture-audit-failed/)
    assert.deepEqual(await current(normal.actorId), before)
    phase("LEGACY_WRITE_SCOPE_TAMPERING_ROLLBACK")
    await assert.rejects(write(normal.actorId, "!fixture-scope-rollback", tx => tx.$queryRaw`SELECT set_config('app.rls_bypass', 'on', true)`), /IDENTITY_LEGACY_WRITE_CONTEXT_INVALID/)
    assert.deepEqual(await current(normal.actorId), before)
    phase("LEGACY_WRITE_FOREIGN_TENANT_REFUSAL")
    let called = false
    assert.deepEqual(await fence(writer, other.organizationId, card(normal.actorId), async () => { called = true }), { allowed: false })
    assert.equal(called, false)
    phase("LEGACY_WRITE_INHERITED_BYPASS_CLEARED")
    const inherited = { $transaction: (work, options) => writer.$transaction(async tx => {
      await tx.$queryRaw`SELECT set_config('app.rls_bypass', 'on', true)`
      return work(tx)
    }, options) }
    assert.deepEqual(await fence(inherited, org, card(normal.actorId), async tx => {
      const [scope] = await tx.$queryRaw`SELECT current_setting('app.rls_bypass') AS bypass`
      return scope.bypass
    }), { allowed: true, value: "off" })
    phase("LEGACY_WRITE_MALFORMED_INPUT_BEFORE_TRANSACTION")
    let transactions = 0
    const unused = { $transaction: () => { transactions++; throw new Error("must not start") } }
    await assert.rejects(fence(unused, org, [], async () => {}), /IDENTITY_LEGACY_WRITE_PRINCIPAL_INVALID/)
    await assert.rejects(fence(unused, org, [{ kind: "USER", userId: normal.userId, extra: true }], async () => {}), /IDENTITY_LEGACY_WRITE_PRINCIPAL_INVALID/)
    assert.equal(transactions, 0)
    phase("LEGACY_WRITE_POSITIVE_CREDENTIAL_CAS")
    assert.deepEqual(await write(normal.actorId, "!fixture-new"), { allowed: true, value: 1 })
    checks.push("legacy_write_fence_enforces_actual_tenant_scope_and_rolls_back_callback_failure_or_scope_tampering")

    phase("LEGACY_WRITER_FIRST_SERIALIZES_CANONICAL_CUTOVER")
    const first = subjects.get("writer-first"), entered = deferred(), release = deferred(), cutoverPid = deferred()
    const writing = write(first.actorId, "!fixture-before-cutover", async () => { entered.resolve(); await release.promise })
    writing.catch(entered.reject)
    await entered.promise
    const converting = admin.$transaction(async tx => {
      const [connection] = await tx.$queryRaw`SELECT pg_backend_pid() AS pid`
      cutoverPid.resolve(connection.pid)
      await tenantLock(tx)
      await tx.$queryRaw`SELECT id FROM users WHERE "organizationId" = ${org} AND id = ${first.userId} FOR SHARE`
      await marker(tx, first.userId)
    }, { isolationLevel: "ReadCommitted", timeout: 15_000 })
    converting.catch(cutoverPid.reject)
    try { await blocked(await cutoverPid.promise) } finally { release.resolve() }
    assert.deepEqual(await writing, { allowed: true, value: 1 }); await converting
    assert.deepEqual(await write(first.actorId, "!fixture-too-late"), { allowed: false })
    assert.equal((await current(first.actorId)).passwordHash, "!fixture-before-cutover")
    checks.push("legacy_writer_before_cutover_commits_first_and_no_later_legacy_write_passes")

    phase("CANONICAL_CUTOVER_FIRST_REFUSES_WAITING_LEGACY_WRITER")
    const second = subjects.get("cutover-first"), marked = deferred(), finish = deferred(), waitingPid = deferred()
    const convertingFirst = cutover(second.userId, async () => { marked.resolve(); await finish.promise })
    convertingFirst.catch(marked.reject)
    await marked.promise
    const observedWriter = { $transaction: (work, options) => writer.$transaction(async tx => {
      const [connection] = await tx.$queryRaw`SELECT pg_backend_pid() AS pid`
      waitingPid.resolve(connection.pid)
      return work(tx)
    }, options) }
    let wrote = false
    const writingSecond = fence(observedWriter, org, card(second.actorId), async tx => {
      wrote = true
      return tx.$executeRaw`UPDATE mtm_agents SET "passwordHash" = '!fixture-forbidden' WHERE "organizationId" = ${org} AND id = ${second.actorId}`
    })
    writingSecond.catch(waitingPid.reject)
    try { await blocked(await waitingPid.promise) } finally { finish.resolve() }
    await convertingFirst
    assert.deepEqual(await writingSecond, { allowed: false }); assert.equal(wrote, false)
    assert.equal((await current(second.actorId)).passwordHash, "!fixture-old")
    checks.push("canonical_cutover_before_waiting_legacy_write_refuses_callback_and_preserves_old_credential")

    phase("CANONICAL_REVIEWED_OWNER_AND_NEW_AUTOLINK_TARGET_REFUSE_WRITES")
    // Explicit original binding is retained even after the mutable link changes.
    await admin.identityActorBinding.create({ data: { organizationId: org, userId: first.userId, actorId: normal.actorId,
      reviewedByUserId: actor.userId, accountVersion: 1, reviewReference: "synthetic-reviewed-owner" } })
    let targetWork = false
    assert.deepEqual(await fence(writer, org, card(normal.actorId), async () => { targetWork = true }), { allowed: false })
    const orphan = "legacy-write-orphan"
    await admin.$executeRawUnsafe('INSERT INTO mtm_agents (id,"organizationId",role,status,"attendanceParticipant") VALUES ($1,$2,\'AGENT\',\'ACTIVE\',false)', orphan, org)
    assert.deepEqual(await fence(writer, org, [...card(orphan), { kind: "USER", userId: first.userId }], async () => { targetWork = true }), { allowed: false })
    assert.equal(targetWork, false)
    checks.push("legacy_write_refuses_immutable_canonical_owner_and_explicit_new_link_target")

    phase("LEGACY_MAINTENANCE_DISABLED_PRINCIPAL_WITHOUT_SIGNIN_OR_REACTIVATION")
    const maintainedUser = "legacy-maintenance-user", maintainedActor = "legacy-maintenance-actor"
    await admin.$executeRaw`INSERT INTO users (id,"organizationId","isActive",role,"passwordHash") VALUES (${maintainedUser},${org},false,'viewer','!fixture-disabled-old')`
    await admin.$executeRaw`INSERT INTO mtm_agents (id,"organizationId","userId",role,status,"attendanceParticipant","passwordHash") VALUES (${maintainedActor},${org},${maintainedUser},'AGENT','INACTIVE',false,'!fixture-disabled-old')`
    await admin.identityAccount.create({ data: { organizationId: org, userId: maintainedUser } })
    let unexpectedAdmission = false
    assert.deepEqual(await fence(writer, org, card(maintainedActor), async () => { unexpectedAdmission = true }), { allowed: false })
    const principal = [{ kind: "USER", userId: maintainedUser }]
    assert.deepEqual(await fence(writer, org, principal, async () => { unexpectedAdmission = true }), { allowed: false })
    assert.equal(unexpectedAdmission, false)
    assert.deepEqual(await maintain(writer, org, card(maintainedActor), tx => tx.$executeRaw`UPDATE mtm_agents SET "passwordHash" = '!fixture-disabled-new' WHERE "organizationId" = ${org} AND id = ${maintainedActor}`), { allowed: true, value: 1 })
    const originalCompany = await admin.organization.findUniqueOrThrow({ where: { id: org }, select: { isActive: true } })
    try {
      await admin.organization.update({ where: { id: org }, data: { isActive: false }, select: { id: true } })
      assert.deepEqual(await maintain(writer, org, principal, tx => tx.$executeRaw`UPDATE users SET "passwordHash" = '!fixture-disabled-new' WHERE "organizationId" = ${org} AND id = ${maintainedUser}`), { allowed: true, value: 1 })
      const [disabled] = await admin.$queryRaw`SELECT "isActive", "passwordHash" FROM users WHERE id = ${maintainedUser}`
      assert.equal(disabled.isActive, false); assert.equal(disabled.passwordHash, "!fixture-disabled-new")
      assert.equal((await admin.mtmAgent.findFirstOrThrow({ where: { id: maintainedActor }, select: { status: true } })).status, "INACTIVE")
      checks.push("legacy_maintenance_preserves_disabled_user_actor_and_company_without_admitting_signin_or_reactivating_any_principal")

      phase("LEGACY_MAINTENANCE_CANONICAL_OR_ANONYMIZED_PRINCIPAL_REFUSAL")
      await admin.$executeRaw`UPDATE users SET "anonymizedAt" = now() WHERE id = ${maintainedUser}`
      assert.deepEqual(await maintain(writer, org, principal, async () => { unexpectedAdmission = true }), { allowed: false })
      await admin.$executeRaw`UPDATE users SET "anonymizedAt" = NULL WHERE id = ${maintainedUser}`
      await assert.rejects(maintain(writer, org, principal, async tx => {
        await tx.$executeRaw`UPDATE users SET "passwordHash" = '!fixture-maintenance-rollback' WHERE "organizationId" = ${org} AND id = ${maintainedUser}`
        throw new Error("fixture-maintenance-audit-failed")
      }), /fixture-maintenance-audit-failed/)
      await cutover(maintainedUser)
      assert.deepEqual(await maintain(writer, org, principal, async () => { unexpectedAdmission = true }), { allowed: false })
      assert.deepEqual(await maintain(writer, org, card(maintainedActor), async () => { unexpectedAdmission = true }), { allowed: false })
      assert.equal(unexpectedAdmission, false)
      assert.equal((await admin.$queryRaw`SELECT "passwordHash" FROM users WHERE id = ${maintainedUser}`)[0].passwordHash, "!fixture-disabled-new")
      checks.push("legacy_maintenance_refuses_canonical_or_anonymized_ownership_even_when_disabled_and_rolls_back_failed_credential_work")
    } finally {
      await admin.organization.update({ where: { id: org }, data: { isActive: originalCompany.isActive }, select: { id: true } })
    }
  } finally {
    await admin.$executeRawUnsafe('REVOKE UPDATE ("passwordHash") ON mtm_agents, users FROM identity_foundation_writer')
  }
}
