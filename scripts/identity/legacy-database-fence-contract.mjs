import assert from "node:assert/strict"
import { setTimeout as delay } from "node:timers/promises"

/** Exercise unmodified legacy SQL, rather than the guarded service wrapper. */
export async function checkLegacyDatabaseFence({ admin, writer, actor, other, checks, phase }) {
  phase("DATABASE_LEGACY_CREDENTIAL_AND_PHONE_FENCE")
  const org = actor.organizationId, userId = "database-fence-person", cardId = "database-fence-card"
  const phone = "+994558811223", scope = { organizationId: org, userId }
  await admin.$executeRaw`INSERT INTO users (id,"organizationId","isActive",role,"passwordHash",phone) VALUES (${userId},${org},true,'viewer','!old-fixture',${phone})`
  await admin.$executeRaw`INSERT INTO mtm_agents (id,"organizationId","userId",role,status,"passwordHash",phone) VALUES (${cardId},${org},${userId},'AGENT','ACTIVE','!old-fixture',${phone})`
  await admin.identityAccount.create({ data: scope })
  await admin.identityPhoneClaim.create({ data: { ...scope, normalizedPhone: phone, accountVersion: 1, verifiedAt: new Date() } })
  await admin.$executeRawUnsafe('GRANT UPDATE ("passwordHash", phone) ON users, mtm_agents TO identity_foundation_writer')
  const scoped = work => writer.$transaction(async tx => {
    await tx.$queryRaw`SELECT set_config('app.org_id', ${org}, true), set_config('app.rls_bypass', 'off', true)`
    return work(tx)
  }, { timeout: 15_000 })
  try {
    // Staging is still compatible with old writes. No implicit conversion.
    await scoped(tx => tx.$executeRaw`UPDATE users SET "passwordHash"='!shadow-fixture' WHERE id=${userId} AND "organizationId"=${org}`)
    await admin.identityAccount.update({ where: { organizationId_userId: scope }, data: {
      cutoverAt: new Date(), passwordHash: "!canonical-fixture", version: { increment: 1 }, credentialEpoch: { increment: 1 },
    } })
    for (const table of ["users", "mtm_agents"]) {
      const id = table === "users" ? userId : cardId
      await assert.rejects(scoped(tx => tx.$executeRawUnsafe(`UPDATE ${table} SET "passwordHash"=$1 WHERE id=$2 AND "organizationId"=$3`, "!restored-old-password", id, org)), /IDENTITY_CANONICAL_CREDENTIAL_REQUIRED/)
      await scoped(tx => tx.$executeRawUnsafe(`UPDATE ${table} SET "passwordHash"="passwordHash",phone=phone WHERE id=$1 AND "organizationId"=$2`, id, org))
    }
    const addUser = (id, tenant, number) => admin.$executeRaw`INSERT INTO users (id,"organizationId","isActive",role,"passwordHash",phone) VALUES (${id},${tenant},true,'viewer','!new-fixture',${number})`
    for (const number of [phone, "+994 (55) 881-12-23", "0558811223"]) {
      await assert.rejects(addUser("database-fence-conflict", org, number), /IDENTITY_CANONICAL_PHONE_RESERVED/)
    }
    await addUser("database-fence-other-tenant", other.organizationId, phone)
    await addUser("database-fence-unclaimed", org, "+994558811224")
    await assert.rejects(scoped(tx => tx.$executeRaw`UPDATE users SET phone=${phone} WHERE id='database-fence-unclaimed' AND "organizationId"=${org}`), /IDENTITY_CANONICAL_PHONE_RESERVED/)
    await assert.rejects(admin.$executeRaw`INSERT INTO mtm_agents (id,"organizationId","userId",role,status,"passwordHash") VALUES ('database-fence-new-password',${org},${userId},'EMPLOYEE','ACTIVE','!independent-password')`, /IDENTITY_CANONICAL_CREDENTIAL_REQUIRED/)
    await admin.$executeRaw`INSERT INTO mtm_agents (id,"organizationId","userId",role,status) VALUES ('database-fence-new-card',${org},${userId},'EMPLOYEE','ACTIVE')`
    assert.equal((await admin.user.findUniqueOrThrow({ where: { id: userId }, select: { passwordHash: true } })).passwordHash, "!shadow-fixture")
    checks.push("database_refuses_old_password_restoration_and_canonical_phone_allocation_but_allows_shadow_other_tenant_and_credentialless_card")

    phase("DATABASE_LEGACY_INSERT_SERIALIZES_WITH_CUTOVER")
    const racing = "database-fence-racing", racingPhone = "+994558811225"
    await addUser(racing, org, racingPhone)
    await admin.identityAccount.create({ data: { organizationId: org, userId: racing } })
    await admin.identityPhoneClaim.create({ data: { organizationId: org, userId: racing, normalizedPhone: racingPhone, accountVersion: 1, verifiedAt: new Date() } })
    let unlock, started, connection
    const release = new Promise(resolve => { unlock = resolve })
    const entered = new Promise(resolve => { started = resolve })
    const pid = new Promise(resolve => { connection = resolve })
    const conversion = admin.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'identity-registry:' + org}, 0))`
      await tx.identityAccount.update({ where: { organizationId_userId: { organizationId: org, userId: racing } }, data: {
        cutoverAt: new Date(), passwordHash: "!canonical-fixture", version: { increment: 1 }, credentialEpoch: { increment: 1 },
      } })
      started(); await release
    }, { timeout: 15_000 })
    conversion.catch(() => started())
    await entered
    const insertion = admin.$transaction(async tx => {
      connection((await tx.$queryRaw`SELECT pg_backend_pid() AS pid`)[0].pid)
      return tx.$executeRaw`INSERT INTO mtm_agents (id,"organizationId","userId",role,status,"passwordHash") VALUES ('database-fence-race-card',${org},${racing},'AGENT','ACTIVE','!racing-password')`
    }, { timeout: 15_000 })
    const refused = assert.rejects(insertion, /IDENTITY_CANONICAL_CREDENTIAL_REQUIRED/)
    try {
      const blockedPid = await pid
      let blocked = false
      for (let i = 0; i < 80 && !blocked; i++) {
        blocked = (await admin.$queryRaw`SELECT EXISTS(SELECT 1 FROM pg_locks WHERE pid=${blockedPid} AND locktype='advisory' AND NOT granted) AS blocked`)[0].blocked
        if (!blocked) await delay(25)
      }
      assert.equal(blocked, true)
    } finally { unlock(); await conversion; await refused }
    assert.equal(await admin.mtmAgent.count({ where: { id: "database-fence-race-card" } }), 0)
    checks.push("database_password_only_card_insert_waits_for_cutover_and_cannot_reintroduce_legacy_credential")
  } finally {
    await admin.$executeRawUnsafe('REVOKE UPDATE ("passwordHash", phone) ON users, mtm_agents FROM identity_foundation_writer')
  }
}
