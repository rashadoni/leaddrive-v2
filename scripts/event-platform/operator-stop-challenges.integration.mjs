// Real disposable PostgreSQL. Claims are synthetic; no worker/process/broker.
import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID,createHash} from 'node:crypto'
import {readFile} from 'node:fs/promises'
import {fixtureSql,quoteFixture as q} from './operator-postgres-client.fixture.mjs'
import {verifyOperatorRecoveryStop} from './operator-stop-evidence.mjs'
const admin=sql=>fixtureSql('control_test_admin',sql)
const owned=sql=>admin(`SET ROLE ld_kafka_control_owner;${sql}`)
const json=x=>`${q(JSON.stringify(x))}::jsonb`
const call=(login,fn,args)=>fixtureSql(login,`SELECT ld_kafka_operator.${fn}(${args});`)
const denied=p=>assert.rejects(p,/P0001/)
await admin(`CREATE ROLE ld_kafka_operator_observer NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB NOREPLICATION;
 CREATE ROLE op_stop_observer LOGIN PASSWORD 'operator-fixture-only' NOSUPERUSER NOBYPASSRLS;
 CREATE ROLE op_stop_other LOGIN PASSWORD 'operator-fixture-only' NOSUPERUSER NOBYPASSRLS;
 CREATE ROLE op_stop_foreign LOGIN PASSWORD 'operator-fixture-only' NOSUPERUSER NOBYPASSRLS;
 GRANT ld_kafka_operator_observer TO op_stop_observer,op_stop_other,op_stop_foreign;`)
await owned(`INSERT INTO ld_kafka_operator.identities(login_name,principal_id,organization_id,enabled,valid_until) VALUES
 ('op_stop_observer','observer-1','org-a',true,clock_timestamp()+interval '1 hour'),
 ('op_stop_other','observer-2','org-a',true,clock_timestamp()+interval '1 hour'),
 ('op_stop_foreign','observer-3','org-b',true,clock_timestamp()+interval '1 hour');`)
await owned(await readFile(new URL('../../ops/event-platform/operator/stop-challenges.sql',import.meta.url),'utf8'))
async function admitted(action='stop') {
 const id=randomUUID(),plan={organizationId:'org-a',buildId:randomUUID(),projectionName:'finance.fund-balance',releaseSha:'a'.repeat(40),artifactSha256:`sha256:${'b'.repeat(64)}`,environment:'staging',clusterId:'cluster-1',topicId:'BBBBBBBBBBBBBBBBBBBBBA',groupId:'ld.staging.finance.fund-shadow.v2.drill',action,evidenceSha256:`sha256:${'c'.repeat(64)}`,expectedPointerVersion:'2'}
 const hash=await call('op_requester','request',`${q(id)},${json(plan)},clock_timestamp()+interval '10 minutes'`)
 await call('op_approver','approve',`${q(id)},${q(hash)}`)
 const generation=await call('op_controller','consume',`${q(id)},${q(hash)},${json(plan)}`)
 return {id,hash,generation,plan}
}
const issue=(f,observer='op_stop_observer',expiry="clock_timestamp()+interval '45 seconds'",login='op_controller')=>call(login,'issue_stop_challenge',`${q(f.id)},${q(f.hash)},${f.generation},${q(f.challengeId)},'worker-a',${q(observer)},${expiry}`)
async function challenged() {
 const f={...await admitted(),challengeId:randomUUID()}
 f.challenge=JSON.parse(await issue(f));return f
}
function receipt(f) {
 const time=new Date().toISOString()
 return {apiVersion:'event-platform.leaddrive.io/v1',kind:'WorkerStopReceipt',...f.plan,
 receiptId:f.challengeId,challengeId:f.challengeId,requestId:f.id,generation:f.generation,
 workerInstanceId:'worker-a',observerId:'observer-1',termination:'closed',inFlightSql:'0',pendingAcks:'0',activeChildren:'0',
 requestedAt:time,intakeStoppedAt:time,ackFencedAt:time,sqlSettledAt:time,checkpointObservedAt:time,childClosedAt:time,observedAt:time,
 partitions:[{partition:0,checkpointNext:'9007199254740993'}]}
}
const record=(f,r=receipt(f),login='op_stop_observer')=>call(login,'record_stop_receipt',`${q(f.challengeId)},${json(r)}`)
const consume=(f,hash,login='op_controller')=>call(login,'consume_stop_challenge',`${q(f.challengeId)},${q(hash)}`)
const read=f=>call('op_controller','read_stop_receipt',q(f.challengeId))
const used=f=>owned(`SELECT consumed_at IS NOT NULL FROM ld_kafka_operator.stop_challenges WHERE id=${q(f.challengeId)};`)
await test('authenticated observer, actual read-only readback, gate, single consumption and settlement compose',async()=>{
 const f=await challenged(),r=receipt(f),hash=await record(f,r)
 const recoveryPlan={...f.plan,action:'promote'};delete recoveryPlan.evidenceSha256
 const state={aggregateId:'fund-a',eventCount:'1',aggregateVersion:'1',historyHash:`sha256:${'d'.repeat(64)}`,stateHash:`sha256:${'e'.repeat(64)}`,balance:'10.0000',currency:'AZN'}
 const manifest={apiVersion:'event-platform.leaddrive.io/v1',kind:'OperatorRecoveryEvidence',...recoveryPlan,previousBuildId:randomUUID(),receiptId:'synthetic-recovery',observedAt:new Date().toISOString(),soakStartedAt:new Date(Date.now()-120000).toISOString(),targetEffectsFenced:true,externalEffectAttempts:'0',unresolvedQuarantine:'0',stop:{intakeStopped:true,acksFenced:true,sqlSettled:true,childClosed:true,actualCloseReceiptId:f.challengeId},sourceHistoryComplete:true,archiveVerified:true,restoreReceiptId:'synthetic-restore',independentApprovalReceiptId:'synthetic-approval',source:[state],shadow:[{...state}],partitions:[{partition:0,historyStart:'0',replayStart:'0',frozenEndExclusive:r.partitions[0].checkpointNext,checkpointNext:r.partitions[0].checkpointNext,archiveNext:r.partitions[0].checkpointNext}]}
 const raw=JSON.stringify(manifest);recoveryPlan.evidenceSha256=`sha256:${createHash('sha256').update(raw).digest('hex')}`
 const result=await verifyOperatorRecoveryStop(raw,{plan:recoveryPlan,now:new Date().toISOString(),maxAgeMs:60000,minSoakMs:60000,partitionCount:1,previousBuildId:manifest.previousBuildId,stop:{receiptId:f.challengeId,challengeId:f.challengeId,requestId:f.id,generation:f.generation,workerInstanceId:'worker-a',observerId:'observer-1'}},async id=>JSON.parse(await fixtureSql('op_controller',`BEGIN READ ONLY;SELECT ld_kafka_operator.read_stop_receipt(${q(id)});COMMIT;`)))
 assert.equal(result.receiptId,f.challengeId)
 await fixtureSql('op_controller',`BEGIN;SELECT ld_kafka_operator.consume_stop_challenge(${q(f.challengeId)},${q(hash)});SELECT ld_kafka_operator.settle(${q(f.id)},${q(f.hash)},${f.generation});COMMIT;`)
 assert.equal(await used(f),'t');await denied(consume(f,hash))
 assert.equal(await owned(`SELECT recorded_at>=created_at AND consumed_at>=recorded_at FROM ld_kafka_operator.stop_challenges WHERE id=${q(f.challengeId)};`),'t')
 assert.equal(await owned(`SELECT string_agg(transition||':'||actor,',' ORDER BY sequence) FROM ld_kafka_operator.audit WHERE request_id=${q(f.id)} AND transition LIKE 'stop-%';`),'stop-challenge-issued:op_controller,stop-receipt-recorded:op_stop_observer,stop-challenge-consumed:op_controller')
})
await test('only exact stop action, controller, observer tenant and bounded expiry can issue',async()=>{
 const f={...await admitted('promote'),challengeId:randomUUID()};await denied(issue(f))
 const s={...await admitted(),challengeId:randomUUID()}
 await denied(issue(s,'op_stop_foreign'));await denied(issue(s,'op_requester'))
 await denied(issue(s,'op_stop_observer',"clock_timestamp()+interval '2 minutes'"))
 await denied(issue(s,'op_stop_observer',"clock_timestamp()-interval '1 second'"))
 await denied(issue(s,'op_stop_observer',"clock_timestamp()+interval '45 seconds'",'op_controller2'))
})
await test('observer login isolation prevents self-registration, impersonation and direct table access',async()=>{
 const f=await challenged()
 await denied(record(f,receipt(f),'op_stop_other'));await denied(record(f,receipt(f),'op_stop_foreign'))
 await assert.rejects(record(f,receipt(f),'op_controller'),/42501/)
 for(const login of ['op_stop_observer','op_controller','op_requester']) await assert.rejects(fixtureSql(login,'SELECT * FROM ld_kafka_operator.stop_challenges;'),/42501/)
 await assert.rejects(fixtureSql('op_stop_observer','SET ROLE ld_kafka_control_owner;'),/42501/)
 await assert.rejects(call('op_stop_observer','read_stop_receipt',q(f.challengeId)),/42501/)
 await denied(fixtureSql('op_stop_other',`SET ROLE ld_kafka_operator_observer;SELECT ld_kafka_operator.record_stop_receipt(${q(f.challengeId)},${json(receipt(f))});`))
})
await test('receipt scope, identity, chronology, zero counts and partition shape are enforced',async()=>{
 const f=await challenged()
 for(const mutate of [r=>r.organizationId='org-b',r=>r.buildId=randomUUID(),r=>r.groupId='wrong',r=>r.topicId='wrong',r=>r.expectedPointerVersion=2,r=>r.generation='0',r=>r.workerInstanceId='other',r=>r.challengeId=randomUUID(),r=>r.observerId='observer-2',r=>r.inFlightSql='1',r=>r.pendingAcks=0,r=>r.activeChildren='1',r=>r.termination='stopping',r=>r.requestedAt='2000-01-01T00:00:00.000Z',r=>r.childClosedAt='2100-01-01T00:00:00.000Z',r=>r.partitions=[],r=>r.partitions.push({...r.partitions[0]}),r=>r.partitions[0].partition=128,r=>r.partitions[0].checkpointNext=5,r=>r.partitions[0].checkpointNext='9223372036854775808']) {
  const r=receipt(f);mutate(r);await denied(record(f,r))
 }
 const hash=await record(f);assert.match(hash,/^[a-f0-9]{64}$/);await denied(record(f))
 await denied(consume(f,'0'.repeat(64)));assert.equal(await used(f),'f')
})
await test('missing receipt and wrong controller cannot consume or read; one challenge per lease',async()=>{
 const f=await challenged();await denied(read(f));await denied(consume(f,'a'.repeat(64)))
 const hash=await record(f)
 await denied(consume(f,hash,'op_controller2'));await denied(call('op_controller2','read_stop_receipt',q(f.challengeId)))
 await assert.rejects(issue({...f,challengeId:randomUUID()}),/23505/)
})
await test('two concurrent consumption attempts have exactly one winner',async()=>{
 const f=await challenged(),hash=await record(f)
 const results=await Promise.allSettled([consume(f,hash),consume(f,hash)])
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1)
 assert.match(results.find(r=>r.status==='rejected').reason.message,/P0001/)
 assert.equal(await used(f),'t')
})
await test('observer role revoke, principal remap, elevation and operator-capability mixing deny old evidence',async()=>{
 const f=await challenged(),hash=await record(f)
 for(const [change,restore] of [
 ['REVOKE ld_kafka_operator_observer FROM op_stop_observer;','GRANT ld_kafka_operator_observer TO op_stop_observer;'],
 ["SET ROLE ld_kafka_control_owner;UPDATE ld_kafka_operator.identities SET principal_id='replacement-observer' WHERE login_name='op_stop_observer';","SET ROLE ld_kafka_control_owner;UPDATE ld_kafka_operator.identities SET principal_id='observer-1' WHERE login_name='op_stop_observer';"],
 ['ALTER ROLE op_stop_observer CREATEROLE;','ALTER ROLE op_stop_observer NOCREATEROLE;'],
 ['GRANT ld_kafka_operator_admitter TO op_stop_observer;','REVOKE ld_kafka_operator_admitter FROM op_stop_observer;'],
 ["SET ROLE ld_kafka_control_owner;UPDATE ld_kafka_operator.identities SET enabled=false WHERE login_name='op_stop_observer';","SET ROLE ld_kafka_control_owner;UPDATE ld_kafka_operator.identities SET enabled=true WHERE login_name='op_stop_observer';"],
 ["SET ROLE ld_kafka_control_owner;UPDATE ld_kafka_operator.identities SET valid_until=clock_timestamp()-interval '1 second' WHERE login_name='op_stop_observer';","SET ROLE ld_kafka_control_owner;UPDATE ld_kafka_operator.identities SET valid_until=clock_timestamp()+interval '1 hour' WHERE login_name='op_stop_observer';"]]) {
  await admin(change);try{await denied(read(f));await denied(consume(f,hash))}finally{await admin(restore)}
 }
 assert.equal(await used(f),'f')
})
await test('revoked admission and expired challenge cannot accept saved receipt',async()=>{
 const f=await challenged(),hash=await record(f)
 await call('op_controller','revoke',`${q(f.id)},${q(f.hash)}`);await denied(consume(f,hash))
 const g=await challenged(),h=await record(g)
 await owned(`UPDATE ld_kafka_operator.stop_challenges SET expires_at=clock_timestamp()-interval '1 second' WHERE id=${q(g.challengeId)};`)
 await denied(consume(g,h));await denied(read(g));assert.equal(await used(g),'f')
})
await test('deferred final challenge expiry rolls back staged consumption and settle',async()=>{
 const f=await challenged(),hash=await record(f)
 await owned(`UPDATE ld_kafka_operator.stop_challenges SET expires_at=clock_timestamp()+interval '3 seconds' WHERE id=${q(f.challengeId)};`)
 // Successful statements produce the marker before sleeping. Early failure
 // cannot satisfy this test: finalization itself must reject and roll back.
 const {spawn}=await import('node:child_process');let staged=false
 const result=await new Promise(resolve=>{
  const child=spawn('psql',['-X','-qAt','-v','ON_ERROR_STOP=1'],{env:{...process.env,PGUSER:'op_controller',PGPASSWORD:'operator-fixture-only',PGOPTIONS:'-c statement_timeout=10000'},stdio:['pipe','pipe','pipe']})
  let out='',err='';const timer=setTimeout(()=>child.kill('SIGKILL'),15000)
  child.stdout.on('data',b=>{out+=b;staged=out.includes('STOP_ACCEPT_STAGED')});child.stderr.on('data',b=>{err+=b})
  child.once('error',()=>{clearTimeout(timer);resolve({code:-1,err:'spawn failed'})});child.once('close',code=>{clearTimeout(timer);resolve({code,err})})
  child.stdin.end(`BEGIN;SELECT ld_kafka_operator.consume_stop_challenge(${q(f.challengeId)},${q(hash)});SELECT ld_kafka_operator.settle(${q(f.id)},${q(f.hash)},${f.generation});SELECT 'STOP_ACCEPT_STAGED';SELECT pg_sleep(4);COMMIT;`)
 })
 assert.equal(staged,true);assert.notEqual(result.code,0);assert.match(result.err,/KAFKA_STOP_CHALLENGE_DENIED/)
 assert.equal(await used(f),'f');assert.equal(await owned(`SELECT status FROM ld_kafka_operator.requests WHERE id=${q(f.id)};`),'consumed')
})
