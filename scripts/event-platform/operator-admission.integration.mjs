// Real PostgreSQL only. Never invoked by the legacy Kafka/CDC fixtures.
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { randomUUID, createHash } from 'node:crypto'
import { validateOperatorRecoveryEvidence } from './operator-recovery-evidence.mjs'

assert.equal(process.env.LD_OPERATOR_DISPOSABLE, '1', 'isolated fixture opt-in required')
assert.equal(process.env.PGDATABASE, 'kafka_operator_test', 'fixture database name required')
assert.ok(['127.0.0.1', 'localhost'].includes(process.env.PGHOST), 'loopback fixture only')
assert.equal(process.env.PGUSER, 'control_test_admin', 'fixture admin only')
const roles = ['op_requester', 'op_approver', 'op_other', 'op_foreign', 'op_controller', 'op_controller2', 'op_unknown']
const quote = value => `'${String(value).replaceAll("'", "''")}'`
const json = value => `${quote(JSON.stringify(value))}::jsonb`
function execute(login, input, onLine) {
  return new Promise((resolve, reject) => {
    const child = spawn('psql', ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1'], {
      env: { ...process.env, PGUSER: login, PGPASSWORD: 'operator-fixture-only', PGOPTIONS: '-c statement_timeout=10000 -c lock_timeout=5000' },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let stdout = '', stderr = ''
    const timer = setTimeout(() => { child.kill('SIGKILL') }, 15000)
    child.stdout.on('data', data => { stdout += data; onLine?.(stdout) })
    child.stderr.on('data', data => { stderr += data })
    child.once('error', error => { clearTimeout(timer); reject(error) })
    child.once('close', code => {
      clearTimeout(timer)
      if (code === 0) resolve(stdout.trim())
      else reject(new Error(stderr.includes('KAFKA_OPERATOR_ADMISSION_DENIED') ? 'KAFKA_OPERATOR_ADMISSION_DENIED' : `fixture SQL rejected (exit ${code}): ${stderr}`))
    })
    child.stdin.end(input)
  })
}
const admin = sql => execute('control_test_admin', sql)
const owned = sql => admin(`SET ROLE ld_kafka_control_owner; ${sql}`)
const call = (login, fn, args) => execute(login, `SELECT ld_kafka_operator.${fn}(${args});`)
const deny = operation => assert.rejects(operation, /KAFKA_OPERATOR_ADMISSION_DENIED/)

await admin(`
  CREATE EXTENSION pgcrypto;
  CREATE ROLE ld_kafka_control_owner NOLOGIN NOSUPERUSER NOBYPASSRLS;
  CREATE ROLE ld_kafka_operator_admitter NOLOGIN;
  CREATE ROLE ld_kafka_operator_controller NOLOGIN;
  GRANT CREATE ON DATABASE kafka_operator_test TO ld_kafka_control_owner;
  ${roles.map(role => `CREATE ROLE ${role} LOGIN PASSWORD 'operator-fixture-only' NOSUPERUSER NOBYPASSRLS INHERIT;`).join('\n')}
  GRANT ld_kafka_operator_admitter TO op_requester, op_approver, op_other, op_foreign, op_unknown;
  GRANT ld_kafka_operator_controller TO op_controller, op_controller2;
`)
await owned(await readFile(new URL('../../ops/event-platform/operator/admission.sql', import.meta.url), 'utf8'))
await owned(`INSERT INTO ld_kafka_operator.identities
  (login_name,principal_id,organization_id,may_request,may_approve,may_consume,enabled,valid_until) VALUES
  ('op_requester','person-1','org-a',true,true,false,true,clock_timestamp()+interval '1 hour'),
  ('op_approver','person-2','org-a',true,true,false,true,clock_timestamp()+interval '1 hour'),
  ('op_other','person-3','org-a',true,true,false,true,clock_timestamp()+interval '1 hour'),
  ('op_foreign','person-4','org-b',true,true,false,true,clock_timestamp()+interval '1 hour'),
  ('op_controller','service-1','org-a',false,false,true,true,clock_timestamp()+interval '1 hour'),
  ('op_controller2','service-2','org-a',false,false,true,true,clock_timestamp()+interval '1 hour');`)
function plan() {
  return { organizationId: 'org-a', buildId: randomUUID(), projectionName: 'finance.fund-balance',
    releaseSha: 'a'.repeat(40), artifactSha256: `sha256:${'b'.repeat(64)}`, environment: 'staging',
    clusterId: 'cluster-1', topicId: 'BBBBBBBBBBBBBBBBBBBBBA', groupId: 'ld.staging.finance.fund-shadow.v2.drill',
    action: 'shadow-rebuild', evidenceSha256: `sha256:${'c'.repeat(64)}`, expectedPointerVersion: '0' }
}
async function request(input = plan(), login = 'op_requester') {
  const id = randomUUID()
  const hash = await call(login, 'request', `${quote(id)},${json(input)},clock_timestamp()+interval '10 minutes'`)
  return { id, hash, plan: input }
}
const approve = q => call('op_approver', 'approve', `${quote(q.id)},${quote(q.hash)}`)
const consume = (q, login = 'op_controller', input = q.plan) => call(login, 'consume', `${quote(q.id)},${quote(q.hash)},${json(input)}`)
const current = (q, generation, login = 'op_controller') => call(login, 'assert_current', `${quote(q.id)},${quote(q.hash)},${generation}`)
const revoke = (q, login = 'op_controller') => call(login, 'revoke', `${quote(q.id)},${quote(q.hash)}`)

await test('separate real logins admit once, assert lease, settle and audit', async () => {
  const q = await request(); await approve(q)
  const inspected = JSON.parse(await call('op_approver', 'inspect', quote(q.id)))
  assert.deepEqual(inspected.plan, q.plan); assert.equal(inspected.planHash, q.hash)
  const generation = await consume(q); await current(q, generation)
  await deny(consume(q))
  await call('op_controller', 'settle', `${quote(q.id)},${quote(q.hash)},${generation}`)
  await deny(current(q, generation))
  assert.equal(await owned(`SELECT string_agg(transition,',' ORDER BY sequence) FROM ld_kafka_operator.audit WHERE request_id=${quote(q.id)};`), 'requested,approved,consumed,guarded,guarded,settled')
})
await test('self approval and SET ROLE cannot impersonate another authenticated login', async () => {
  const q = await request()
  await deny(call('op_requester', 'approve', `${quote(q.id)},${quote(q.hash)}`))
  await deny(execute('op_requester', `SET ROLE ld_kafka_operator_admitter; SELECT ld_kafka_operator.approve(${quote(q.id)},${quote(q.hash)});`))
})
await test('foreign tenant, unknown mapping and invalid plans rejected', async () => {
  await deny(request(plan(), 'op_foreign')); await deny(request(plan(), 'op_unknown'))
  const invalid = [ { ...plan(), organizationId: 'org-b' }, { ...plan(), approvedBy: 'person-2' },
    { ...plan(), action: 'offset-reset' }, { ...plan(), environment: 'prod;sql' },
    { ...plan(), artifactSha256: 'mutable' }, { ...plan(), buildId: 'not-a-build' } ]
  for (const input of invalid) await deny(request(input))
})
await test('approval cannot change hash; consume cannot change scope/build/artifact/evidence', async () => {
  const q = await request()
  await deny(call('op_approver', 'approve', `${quote(q.id)},${quote('0'.repeat(64))}`)); await approve(q)
  for (const key of Object.keys(q.plan)) await deny(consume(q, 'op_controller', { ...q.plan, [key]: 'different' }))
  await consume(q)
})
await test('unapproved request, duplicate approval and foreign inspection fail', async () => {
  const q = await request(); await deny(consume(q)); await approve(q); await deny(approve(q))
  await deny(call('op_foreign', 'inspect', quote(q.id)))
})
await test('direct table writes/reads, helper calls and role escalation denied', async () => {
  for (const login of ['op_requester', 'op_controller', 'op_unknown']) {
    await assert.rejects(execute(login, 'SELECT * FROM ld_kafka_operator.requests;'), /permission denied/)
    await assert.rejects(execute(login, "UPDATE ld_kafka_operator.identities SET enabled=true;"), /permission denied/)
    await assert.rejects(execute(login, "DELETE FROM ld_kafka_operator.audit;"), /permission denied/)
    await assert.rejects(execute(login, 'SET ROLE ld_kafka_control_owner;'), /permission denied/)
    await assert.rejects(call(login, 'identity', "'op_approver','org-a','approve'"), /permission denied/)
  }
})
await test('revocation before and after consume invalidates old token; no restart', async () => {
  const before = await request(); await approve(before); await revoke(before); await deny(consume(before))
  const q = await request(); await approve(q); const generation = await consume(q)
  await revoke(q, 'op_requester'); await deny(current(q, generation)); await deny(consume(q))
  const inspected = JSON.parse(await call('op_controller', 'inspect', quote(q.id)))
  assert.ok(BigInt(inspected.generation) > BigInt(generation))
})
await test('stale generation and different controller cannot use a consumed token', async () => {
  const q = await request(); await approve(q); const generation = await consume(q)
  await deny(current(q, BigInt(generation)+1n)); await deny(current(q, generation, 'op_controller2'))
})
await test('expired request/lease and revoked identities fail closed', async () => {
  const expired = await request(); await owned(`UPDATE ld_kafka_operator.requests SET expires_at=clock_timestamp()-interval '1 second' WHERE id=${quote(expired.id)};`)
  await deny(approve(expired))
  const q = await request(); await approve(q); const generation = await consume(q)
  await owned(`UPDATE ld_kafka_operator.requests SET lease_until=clock_timestamp()-interval '1 second' WHERE id=${quote(q.id)};`)
  await deny(current(q, generation))
  const disabled = await request(); await approve(disabled)
  await owned("UPDATE ld_kafka_operator.identities SET enabled=false WHERE login_name='op_approver';")
  try { await deny(consume(disabled)) } finally { await owned("UPDATE ld_kafka_operator.identities SET enabled=true WHERE login_name='op_approver';") }
})
await test('principal remapping cannot inherit historical admission', async () => {
  const q = await request(); await approve(q)
  await owned("UPDATE ld_kafka_operator.identities SET principal_id='replacement-2' WHERE login_name='op_approver';")
  try { await deny(consume(q)) } finally { await owned("UPDATE ld_kafka_operator.identities SET principal_id='person-2' WHERE login_name='op_approver';") }
})
await test('concurrent actual consume has exactly one winner', async () => {
  const q = await request(); await approve(q)
  const outcomes = await Promise.allSettled([consume(q), consume(q)])
  assert.equal(outcomes.filter(x => x.status === 'fulfilled').length, 1)
  assert.equal(outcomes.filter(x => x.status === 'rejected').length, 1)
  assert.equal(await owned(`SELECT count(*) FROM ld_kafka_operator.audit WHERE request_id=${quote(q.id)} AND transition='consumed';`), '1')
})
await test('SQL rollback also rolls back consume and audit, then permits one retry', async () => {
  const q = await request(); await approve(q)
  await execute('op_controller', `BEGIN; SELECT ld_kafka_operator.consume(${quote(q.id)},${quote(q.hash)},${json(q.plan)}); ROLLBACK;`)
  assert.equal(await owned(`SELECT count(*) FROM ld_kafka_operator.audit WHERE request_id=${quote(q.id)} AND transition='consumed';`), '0')
  await consume(q)
})
await test('assert-current holds request row through transaction settlement; revoke serializes', async () => {
  const q = await request(); await approve(q); const generation = await consume(q)
  let locked
  const ready = new Promise(resolve => { locked = resolve })
  const transaction = execute('op_controller', `BEGIN; SELECT ld_kafka_operator.assert_current(${quote(q.id)},${quote(q.hash)},${generation}); SELECT 'LOCKED'; SELECT pg_sleep(1); COMMIT;`, output => { if (output.includes('LOCKED')) locked() })
  // A transaction failure also wakes the waiter, so fixture errors cannot hang CI.
  await Promise.race([ready, transaction.then(() => { throw new Error('missing lock marker') })])
  const revocation = revoke(q)
  await Promise.all([transaction, revocation]); await deny(current(q, generation))
  assert.equal(JSON.parse(await call('op_controller', 'inspect', quote(q.id))).status, 'revoked')
})
await test('live capability revocation and controller principal remapping reject old token', async () => {
  const q = await request(); await approve(q); const generation = await consume(q)
  await admin('REVOKE ld_kafka_operator_admitter FROM op_approver;')
  try { await deny(current(q, generation)) } finally { await admin('GRANT ld_kafka_operator_admitter TO op_approver;') }
  await owned("UPDATE ld_kafka_operator.identities SET principal_id='replacement-service' WHERE login_name='op_controller';")
  try { await deny(current(q, generation)) } finally { await owned("UPDATE ld_kafka_operator.identities SET principal_id='service-1' WHERE login_name='op_controller';") }
})
await test('unsafe elevated login, expired identity and excessive request expiry denied', async () => {
  await admin('ALTER ROLE op_requester CREATEROLE;')
  try { await deny(request()) } finally { await admin('ALTER ROLE op_requester NOCREATEROLE;') }
  await owned("UPDATE ld_kafka_operator.identities SET valid_until=clock_timestamp()-interval '1 second' WHERE login_name='op_requester';")
  try { await deny(request()) } finally { await owned("UPDATE ld_kafka_operator.identities SET valid_until=clock_timestamp()+interval '1 hour' WHERE login_name='op_requester';") }
  await deny(call('op_requester','request',`${quote(randomUUID())},${json(plan())},clock_timestamp()+interval '1 day'`))
})
await test('public/unmapped login cannot execute controller functions or consume', async () => {
  const q = await request(); await approve(q)
  await assert.rejects(consume(q, 'op_unknown'), /permission denied/)
  await assert.rejects(call('op_requester', 'assert_current', `${quote(q.id)},${quote(q.hash)},0`), /permission denied/)
})

await test('deferred COMMIT rejects expired lease and rolls back settle plus audit', async () => {
  const q = await request(); await approve(q); const generation = await consume(q)
  await owned(`UPDATE ld_kafka_operator.requests SET lease_until=clock_timestamp()+interval '3 seconds' WHERE id=${quote(q.id)};`)
  await deny(execute('op_controller', `BEGIN; SELECT ld_kafka_operator.assert_current(${quote(q.id)},${quote(q.hash)},${generation}); SELECT ld_kafka_operator.settle(${quote(q.id)},${quote(q.hash)},${generation}); SELECT pg_sleep(4); COMMIT;`))
  assert.equal(await owned(`SELECT status FROM ld_kafka_operator.requests WHERE id=${quote(q.id)};`), 'consumed')
  assert.equal(await owned(`SELECT count(*) FROM ld_kafka_operator.audit WHERE request_id=${quote(q.id)} AND transition IN ('guarded','settled');`), '0')
})

// Entirely synthetic pointer/builds in a separate private fixture schema.
await owned(await readFile(new URL('../../ops/event-platform/operator/shadow-fixture.sql', import.meta.url), 'utf8'))
const initialBuild = randomUUID()
await owned(`INSERT INTO ld_operator_shadow_fixture.builds VALUES('org-a',${quote(initialBuild)},${quote('a'.repeat(40))},'promoted',true,clock_timestamp()+interval '1 hour'); INSERT INTO ld_operator_shadow_fixture.pointers VALUES('org-a',${quote(initialBuild)},1);`)
async function recovery(action = 'promote', targetId, overrides = {}) {
  const pointer = JSON.parse(await owned("SELECT json_build_object('buildId',build_id,'version',version::text) FROM ld_operator_shadow_fixture.pointers WHERE organization_id='org-a';"))
  const target = targetId ?? randomUUID()
  if (!targetId) await owned(`INSERT INTO ld_operator_shadow_fixture.builds VALUES('org-a',${quote(target)},${quote('a'.repeat(40))},'ready',true,clock_timestamp()+interval '1 hour');`)
  const input = { ...plan(), buildId: target, action, expectedPointerVersion: pointer.version, ...overrides }
  const observedAt = new Date().toISOString()
  const state = { aggregateId: 'fund-fixture', eventCount: '2', aggregateVersion: '2', historyHash: `sha256:${'d'.repeat(64)}`, stateHash: `sha256:${'e'.repeat(64)}`, balance: '25.000000', currency: 'AZN' }
  const receipt = { apiVersion: 'event-platform.leaddrive.io/v1', kind: 'OperatorRecoveryEvidence', ...input,
    previousBuildId: pointer.buildId, receiptId: `receipt-${randomUUID()}`, observedAt,
    soakStartedAt: new Date(Date.now()-120000).toISOString(), targetEffectsFenced: true, externalEffectAttempts: '0', unresolvedQuarantine: '0',
    stop: { intakeStopped: true, acksFenced: true, sqlSettled: true, childClosed: true, actualCloseReceiptId: 'synthetic-close' },
    sourceHistoryComplete: true, archiveVerified: true, restoreReceiptId: 'synthetic-restore', independentApprovalReceiptId: 'synthetic-approval',
    partitions: [{ partition: 0, historyStart: '0', replayStart: '0', frozenEndExclusive: '2', checkpointNext: '2', archiveNext: '2' }],
    source: [state], shadow: [{ ...state }],
    rollback: { retainedBuildId: target, compatibilityVerified: true, windowEndsAt: new Date(Date.now()+600000).toISOString(), writeFenceApplied: true } }
  // The evidence digest field is a pin in the plan, not recursively in bytes.
  delete receipt.evidenceSha256
  const raw = JSON.stringify(receipt)
  input.evidenceSha256 = `sha256:${createHash('sha256').update(raw).digest('hex')}`
  validateOperatorRecoveryEvidence(raw, { plan: input, now: new Date().toISOString(), maxAgeMs: 30000, minSoakMs: 60000, partitionCount: 1, previousBuildId: pointer.buildId })
  await owned(`INSERT INTO ld_operator_shadow_fixture.verified_evidence VALUES(${quote(input.evidenceSha256)},${quote(raw)},${json(input)},${quote(pointer.buildId)},clock_timestamp()+interval '1 minute');`)
  const q = await request(input); await approve(q); const generation = await consume(q)
  return { q, generation, target, previous: pointer.buildId }
}
const transition = f => execute('op_controller', `SELECT ld_operator_shadow_fixture.transition(${quote(f.q.id)},${quote(f.q.hash)},${f.generation});`)
const shadowPointer = () => owned("SELECT build_id::text || ':' || version::text FROM ld_operator_shadow_fixture.pointers WHERE organization_id='org-a';")
await test('verified evidence + admitted generation atomically promote, then roll back retained build', async () => {
  const promotion = await recovery(); assert.equal(await transition(promotion), '2')
  assert.equal(await shadowPointer(), `${promotion.target}:2`)
  await assert.rejects(transition(promotion), /KAFKA_OPERATOR_ADMISSION_DENIED/)
  const rollback = await recovery('rollback', initialBuild); assert.equal(await transition(rollback), '3')
  assert.equal(await shadowPointer(), `${initialBuild}:3`)
})
await test('racing admitted promotions against same pointer version have one winner', async () => {
  const first = await recovery(), second = await recovery()
  const results = await Promise.allSettled([transition(first), transition(second)])
  assert.equal(results.filter(r => r.status==='fulfilled').length,1)
  assert.equal(results.filter(r => r.status==='rejected').length,1)
})
await test('expired verified evidence, wrong target code and disabled effect fence refuse pointer change', async () => {
  for (const mutation of [
    f => owned(`UPDATE ld_operator_shadow_fixture.verified_evidence SET valid_until=clock_timestamp()-interval '1 second' WHERE digest=${quote(f.q.plan.evidenceSha256)};`),
    f => owned(`UPDATE ld_operator_shadow_fixture.builds SET code_sha=${quote('b'.repeat(40))} WHERE id=${quote(f.target)};`),
    f => owned(`UPDATE ld_operator_shadow_fixture.builds SET effects_fenced=false WHERE id=${quote(f.target)};`),
  ]) {
    const f = await recovery(); const before = await shadowPointer(); await mutation(f)
    await assert.rejects(transition(f), /SHADOW_TRANSITION_DENIED/); assert.equal(await shadowPointer(),before)
  }
})
await test('revoked token cannot promote even with verified manifest', async () => {
  const f = await recovery(); const before = await shadowPointer(); await revoke(f.q)
  await assert.rejects(transition(f), /KAFKA_OPERATOR_ADMISSION_DENIED/); assert.equal(await shadowPointer(),before)
})
await test('lease expiry at COMMIT rolls back pointer, transition event and settle', async () => {
  const f = await recovery(); const before = await shadowPointer()
  await owned(`UPDATE ld_kafka_operator.requests SET lease_until=clock_timestamp()+interval '3 seconds' WHERE id=${quote(f.q.id)};`)
  await deny(execute('op_controller', `BEGIN; SELECT ld_operator_shadow_fixture.transition(${quote(f.q.id)},${quote(f.q.hash)},${f.generation}); SELECT pg_sleep(4); COMMIT;`))
  assert.equal(await shadowPointer(),before)
  assert.equal(await owned(`SELECT count(*) FROM ld_operator_shadow_fixture.transitions WHERE request_id=${quote(f.q.id)};`),'0')
  assert.equal(await owned(`SELECT status FROM ld_kafka_operator.requests WHERE id=${quote(f.q.id)};`),'consumed')
})
await test('rollback with expired retention is refused, keeping current pointer', async () => {
  const currentId = (await shadowPointer()).split(':')[0]
  const target = currentId === initialBuild ? (await recovery()).target : initialBuild
  await owned(`UPDATE ld_operator_shadow_fixture.builds SET status='promoted',retained_until=clock_timestamp()-interval '1 second' WHERE id=${quote(target)};`)
  const f = await recovery('rollback',target); const before = await shadowPointer()
  await assert.rejects(transition(f), /SHADOW_TRANSITION_DENIED/); assert.equal(await shadowPointer(),before)
})
await test('controller cannot register its own evidence or directly change shadow pointer', async () => {
  await assert.rejects(execute('op_controller', 'UPDATE ld_operator_shadow_fixture.pointers SET version=99;'),/permission denied/)
  await assert.rejects(execute('op_controller', 'DELETE FROM ld_operator_shadow_fixture.verified_evidence;'),/permission denied/)
})
