// Actual existing Fund migrations from preceding hosted fixture. No Kafka,
// consumer, replay or business activation. Only this disposable DB gets guards.
import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {readFile} from 'node:fs/promises'
import {fixtureSql,fixtureConnection,quoteFixture as q} from './operator-postgres-client.fixture.mjs'
const admin=sql=>fixtureSql('control_test_admin',sql)
const owned=sql=>admin(`SET ROLE ld_kafka_control_owner;${sql}`)
const call=(login,fn,args)=>fixtureSql(login,`SELECT ld_kafka_operator.${fn}(${args});`)
const json=value=>`${q(JSON.stringify(value))}::jsonb`
const denied=p=>assert.rejects(p,/P0001/)
async function admitted(action='promote') {
 const id=randomUUID(),plan={organizationId:'org-a',buildId:randomUUID(),projectionName:'finance.fund-balance',releaseSha:'a'.repeat(40),artifactSha256:`sha256:${'b'.repeat(64)}`,environment:'staging',clusterId:'cluster-1',topicId:'BBBBBBBBBBBBBBBBBBBBBA',groupId:'ld.staging.finance.fund-shadow.v2.drill',action,evidenceSha256:`sha256:${'c'.repeat(64)}`,expectedPointerVersion:'3'}
 const hash=await call('op_requester','request',`${q(id)},${json(plan)},clock_timestamp()+interval '10 minutes'`)
 await call('op_approver','approve',`${q(id)},${q(hash)}`)
 const generation=await call('op_controller','consume',`${q(id)},${q(hash)},${json(plan)}`)
 return {id,hash,generation,plan}
}
const args=f=>`${q(f.id)},${q(f.hash)},${f.generation}`
const acquire=f=>call('op_controller','acquire_source_barrier',args(f))
const writer=(org,sql)=>fixtureSql('event_app',`BEGIN;SELECT set_config('app.org_id',${q(org)},true);${sql};COMMIT;`)
const rename=(org,id,name)=>writer(org,`UPDATE funds SET name=${q(name)} WHERE id=${q(id)}`)
const fingerprint=()=>admin(`SELECT public.event_platform_jsonb_sha256(jsonb_build_object(
 'funds',(SELECT jsonb_agg(to_jsonb(f) ORDER BY id) FROM funds f WHERE "organizationId"='org-a'),
 'ledger',(SELECT jsonb_agg(to_jsonb(f) ORDER BY id) FROM fund_transactions f WHERE "organizationId"='org-a'),
 'events',(SELECT jsonb_agg(to_jsonb(f) ORDER BY id) FROM domain_events f WHERE "organizationId"='org-a'),
 'outbox',(SELECT jsonb_agg(to_jsonb(f) ORDER BY id) FROM event_outbox f WHERE "organizationId"='org-a'),
 'heads',(SELECT jsonb_agg(to_jsonb(f) ORDER BY id) FROM event_aggregate_heads f WHERE "organizationId"='org-a'),
 'projections',(SELECT jsonb_agg(to_jsonb(f) ORDER BY id) FROM fund_balance_projections f WHERE "organizationId"='org-a')));`)
await owned(await readFile(new URL('../../ops/event-platform/operator/source-barrier.sql',import.meta.url),'utf8'))
await test('missing guard installation fails closed before claiming a source barrier',async()=>{
 const f=await admitted();await denied(acquire(f))
 assert.equal(await owned(`SELECT count(*) FROM ld_kafka_operator.source_barriers WHERE request_id=${q(f.id)};`),'0')
})
await admin(await readFile(new URL('../../ops/event-platform/operator/source-barrier-fixture-attach.sql',import.meta.url),'utf8'))
await test('incomplete, disabled or conditional trigger profile refuses barrier acquisition',async()=>{
 for(const [change,restore] of [
 ['ALTER TABLE funds DISABLE TRIGGER kafka_source_row_guard;','ALTER TABLE funds ENABLE ALWAYS TRIGGER kafka_source_row_guard;'],
 ['ALTER TABLE event_outbox ENABLE TRIGGER kafka_source_row_guard;','ALTER TABLE event_outbox ENABLE ALWAYS TRIGGER kafka_source_row_guard;'],
 ['ALTER TABLE fund_balance_projections DISABLE TRIGGER kafka_source_truncate_guard;','ALTER TABLE fund_balance_projections ENABLE ALWAYS TRIGGER kafka_source_truncate_guard;'],
 ['DROP TRIGGER kafka_source_row_guard ON funds;CREATE TRIGGER kafka_source_row_guard BEFORE INSERT OR UPDATE OR DELETE ON funds FOR EACH ROW WHEN (pg_trigger_depth()>=0) EXECUTE FUNCTION ld_kafka_operator.source_write_guard();ALTER TABLE funds ENABLE ALWAYS TRIGGER kafka_source_row_guard;',
 'DROP TRIGGER kafka_source_row_guard ON funds;CREATE TRIGGER kafka_source_row_guard BEFORE INSERT OR UPDATE OR DELETE ON funds FOR EACH ROW EXECUTE FUNCTION ld_kafka_operator.source_write_guard();ALTER TABLE funds ENABLE ALWAYS TRIGGER kafka_source_row_guard;'],
 ['CREATE TABLE public.operator_barrier_child () INHERITS (public.funds);','DROP TABLE public.operator_barrier_child;']]) {
  const f=await admitted();await admin(change);try{await denied(acquire(f))}finally{await admin(restore)}
 }
})
await test('exact tenant barrier rejects existing/new Fund, ledger and shadow writes; another tenant proceeds',async()=>{
 const f=await admitted(),connection=fixtureConnection('op_controller')
 const before=await fingerprint()
 try{
  const handle=JSON.parse(await connection.command(`BEGIN;SELECT ld_kafka_operator.acquire_source_barrier(${args(f)});`))
  assert.equal(handle.organizationId,'org-a');assert.equal(handle.generation,f.generation);assert.equal(typeof handle.transactionId,'string')
  await denied(rename('org-a','fund-a','Synthetic blocked'))
  await denied(writer('org-a',`INSERT INTO funds(id,"organizationId",name,currency,"currentBalance") VALUES(${q(randomUUID())},'org-a','Synthetic blocked new','AZN',0)`))
  await denied(writer('org-a',`INSERT INTO fund_transactions(id,"organizationId","fundId",type,amount) VALUES(${q(randomUUID())},'org-a','fund-a','deposit',1);UPDATE funds SET "currentBalance"="currentBalance"+1 WHERE id='fund-a'`))
  await denied(writer('org-a',`UPDATE fund_balance_projections SET balance=balance WHERE "organizationId"='org-a' AND "fundId"='fund-a' AND "projectionVersion"=2`))
  await rename('org-b','fund-b','Synthetic other tenant proceeds')
  assert.equal(await admin("SELECT name FROM funds WHERE id='fund-b';"),'Synthetic other tenant proceeds')
  assert.equal(await fingerprint(),before)
  await connection.command(`SELECT ld_kafka_operator.assert_source_barrier(${args(f)});COMMIT;`)
 }finally{await connection.close()}
 await rename('org-a','fund-a','Synthetic after barrier commit')
 assert.notEqual(await fingerprint(),before)
})
await test('an already active writer prevents barrier acquisition, then commit permits it',async()=>{
 const f=await admitted(),connection=fixtureConnection('event_app')
 try{
  await connection.command(`BEGIN;SELECT set_config('app.org_id','org-a',true);UPDATE funds SET name='Synthetic writer holding source' WHERE id='fund-a';`)
  await denied(acquire(f))
  await connection.command('COMMIT;')
 }finally{await connection.close()}
 assert.equal(JSON.parse(await acquire(f)).requestId,f.id)
})
await test('barrier handle cannot cross transaction or savepoint rollback boundary',async()=>{
 const f=await admitted();await acquire(f)
 await denied(call('op_controller','assert_source_barrier',args(f)))
 const g=await admitted(),connection=fixtureConnection('op_controller')
 try{
  await connection.command(`BEGIN;SAVEPOINT barrier_start;SELECT ld_kafka_operator.acquire_source_barrier(${args(g)});ROLLBACK TO SAVEPOINT barrier_start;`)
  await denied(connection.command(`SELECT ld_kafka_operator.assert_source_barrier(${args(g)});`))
 }finally{await connection.close()}
 assert.equal(await owned(`SELECT count(*) FROM ld_kafka_operator.source_barriers WHERE request_id=${q(g.id)};`),'0')
 await rename('org-a','fund-a','Synthetic after savepoint rollback')
})
await test('only current promote/rollback controller in read committed can acquire; no business privileges follow',async()=>{
 for(const action of ['stop','shadow-rebuild']){const f=await admitted(action);await denied(acquire(f))}
 const f=await admitted()
 await denied(call('op_controller2','acquire_source_barrier',args(f)))
 await denied(fixtureSql('op_controller',`BEGIN ISOLATION LEVEL REPEATABLE READ;SELECT ld_kafka_operator.acquire_source_barrier(${args(f)});COMMIT;`))
 await denied(fixtureSql('op_controller',`BEGIN READ ONLY;SELECT ld_kafka_operator.acquire_source_barrier(${args(f)});COMMIT;`))
 await assert.rejects(call('op_requester','acquire_source_barrier',args(f)),/42501/)
 await assert.rejects(fixtureSql('op_controller','SELECT * FROM ld_kafka_operator.source_barriers;'),/42501/)
 await assert.rejects(fixtureSql('op_controller',"UPDATE funds SET name='forbidden' WHERE id='fund-a';"),/42501/)
 const g=await admitted('rollback');assert.equal(JSON.parse(await acquire(g)).requestId,g.id)
 await call('op_controller','revoke',`${q(f.id)},${q(f.hash)}`);await denied(acquire(f))
})
await test('ALWAYS guards survive replica mode and truncate attempts fail closed',async()=>{
 const f=await admitted(),connection=fixtureConnection('op_controller')
 try{
  await connection.command(`BEGIN;SELECT ld_kafka_operator.acquire_source_barrier(${args(f)});`)
  await denied(admin("BEGIN;SET LOCAL session_replication_role=replica;UPDATE funds SET name='Synthetic replica bypass attempt' WHERE id='fund-a';COMMIT;"))
  await denied(admin('TRUNCATE fund_balance_projections;'))
  await connection.command('ROLLBACK;')
 }finally{await connection.close()}
 await rename('org-a','fund-a','Synthetic after explicit rollback')
})
await test('lease expiry at final COMMIT rolls back staged barrier and audit, and releases writer fence',async()=>{
 const f=await admitted(),connection=fixtureConnection('op_controller')
 await owned(`UPDATE ld_kafka_operator.requests SET lease_until=clock_timestamp()+interval '3 seconds' WHERE id=${q(f.id)};`)
 let staged=false
 try{
  const handle=JSON.parse(await connection.command(`BEGIN;SELECT ld_kafka_operator.acquire_source_barrier(${args(f)});`))
  staged=handle.kind==='FundSourceBarrierHandle'
  await connection.command('SELECT pg_sleep(4);')
  await denied(connection.command('COMMIT;'))
 }finally{await connection.close()}
 assert.equal(staged,true,'barrier must actually acquire before final COMMIT denial')
 assert.equal(await owned(`SELECT count(*) FROM ld_kafka_operator.source_barriers WHERE request_id=${q(f.id)};`),'0')
 assert.equal(await owned(`SELECT count(*) FROM ld_kafka_operator.audit WHERE request_id=${q(f.id)} AND transition='source-barrier-acquired';`),'0')
 await rename('org-a','fund-a','Synthetic after expired barrier rollback')
})
