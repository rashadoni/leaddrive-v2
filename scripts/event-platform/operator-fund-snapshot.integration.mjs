// Real existing Fund tables/migrations, no Kafka or consumer execution.
import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { collectFundRecoveryDatabaseSnapshot } from './operator-fund-snapshot.mjs'
import { fixtureSql, fixtureDatabase, quoteFixture as q } from './operator-postgres-client.fixture.mjs'
const reducerPath=process.env.LD_OPERATOR_REDUCER_MODULE
assert.ok(reducerPath?.startsWith(process.env.RUNNER_TEMP + '/'),'CI-owned compiled canonical reducer required')
const { reduceFundBalance }=await import(reducerPath)
assert.equal(typeof reduceFundBalance,'function')
const admin=sql=>fixtureSql('control_test_admin',sql)
const read=(scope=expected,hooks={})=>collectFundRecoveryDatabaseSnapshot(fixtureDatabase('op_fund_reader',hooks),scope,reduceFundBalance)
const rejected=promise=>assert.rejects(promise,{message:'FUND_RECOVERY_SNAPSHOT_INVALID'})
await admin(`CREATE ROLE event_app LOGIN INHERIT NOSUPERUSER NOBYPASSRLS PASSWORD 'operator-fixture-only';
 CREATE ROLE event_migrator LOGIN INHERIT NOSUPERUSER BYPASSRLS PASSWORD 'operator-fixture-only';
 GRANT event_app TO event_migrator;
 GRANT USAGE,CREATE ON SCHEMA public TO event_app,event_migrator;
 CREATE ROLE op_fund_reader LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB NOREPLICATION PASSWORD 'operator-fixture-only';`)
await fixtureSql('event_app',await readFile(new URL('../ci/fixtures/fund-shadow/base.sql',import.meta.url),'utf8'))
for(const migration of ['20260901090000_event_platform_foundation','20260901100000_fund_event_source_pilot','20260906120000_projection_replay_control_plane']) {
 await fixtureSql('event_migrator',await readFile(new URL(`../../prisma/migrations/${migration}/migration.sql`,import.meta.url),'utf8'))
}
const buildId=randomUUID(),foreignBuild=randomUUID()
const expected={organizationId:'org-a',buildId,buildKey:'operator-snapshot',projectionVersion:2,codeSha:'a'.repeat(40),expectedReaderRole:'op_fund_reader',environment:'staging',fundIds:['fund-a','fund-a2']}
await admin(`INSERT INTO organizations(id,name) VALUES('org-a','Synthetic A'),('org-b','Synthetic B');
 INSERT INTO funds(id,"organizationId",name,currency,"currentBalance") VALUES
 ('fund-a','org-a','Synthetic A','AZN',0.0000),('fund-a2','org-a','Synthetic A2','USD',50.1234),('fund-b','org-b','Synthetic B','EUR',999.0000);`)
for(const [type,amount,delta] of [['deposit','10.1234','10.1234'],['withdrawal','0.1234','-0.1234']]) {
 await admin(`BEGIN;INSERT INTO fund_transactions(id,"organizationId","fundId",type,amount) VALUES(${q(randomUUID())},'org-a','fund-a',${q(type)},${q(amount)}::numeric);
 UPDATE funds SET "currentBalance"="currentBalance"+${q(delta)}::numeric WHERE id='fund-a';COMMIT;`)
}
await admin(`UPDATE funds SET name='Synthetic renamed' WHERE id='fund-a';UPDATE funds SET "isActive"=false WHERE id='fund-a';UPDATE funds SET "isActive"=true WHERE id='fund-a';
 INSERT INTO projection_builds(id,"organizationId","projectionName","projectionVersion","buildKey","codeSha",mode)
 VALUES(${q(buildId)},'org-a','finance.fund-balance',2,'operator-snapshot',${q(expected.codeSha)},'shadow'),
 (${q(foreignBuild)},'org-b','finance.fund-balance',2,'foreign-snapshot',${q(expected.codeSha)},'shadow');
 UPDATE projection_builds SET status='running',"startedAt"=clock_timestamp() WHERE id IN (${q(buildId)},${q(foreignBuild)});
 INSERT INTO fund_balance_projections("organizationId","fundId","projectionVersion","buildKey",status,balance,currency,"aggregateVersion","lastEventId",evidence)
 SELECT a."organizationId",a."fundId",2,'operator-snapshot','shadow',a.balance,a.currency,a."aggregateVersion",a."lastEventId",
 jsonb_build_object('lastEventId',a."lastEventId"::text,'lastEventAt',(SELECT envelope->>'time' FROM event_outbox WHERE "eventId"=a."lastEventId"))
 FROM fund_balance_projections a WHERE a.status='active' AND a."organizationId"='org-a';
 INSERT INTO consumer_inbox("organizationId","consumerName","consumerVersion","eventId","eventType","payloadHash","sourceTopic","sourcePartition","sourceOffset")
 SELECT e."organizationId",${q(`fund-shadow:${buildId}`)},1,e.id,e."eventType",o."payloadHash",'ld.staging.finance.events.v1',0,row_number() OVER(ORDER BY e."aggregateId",e."aggregateVersion")-1
 FROM domain_events e JOIN event_outbox o ON o."eventId"=e.id AND o."organizationId"=e."organizationId" WHERE e."organizationId"='org-a';
 INSERT INTO projection_checkpoints("organizationId","buildId","sourceTopic","sourcePartition","sourceOffset","lastEventId")
 SELECT 'org-a',${q(buildId)},"sourceTopic",0,"sourceOffset","eventId" FROM consumer_inbox WHERE "consumerName"=${q(`fund-shadow:${buildId}`)} ORDER BY "sourceOffset" DESC OFFSET 1 LIMIT 1;
 ALTER TABLE funds ENABLE ROW LEVEL SECURITY;ALTER TABLE funds FORCE ROW LEVEL SECURITY;
 CREATE POLICY operator_snapshot_tenant ON funds USING("organizationId"=current_setting('app.org_id',true));
 GRANT USAGE ON SCHEMA public TO op_fund_reader;
 GRANT SELECT ON funds,domain_events,event_outbox,event_aggregate_heads,fund_balance_projections,projection_builds,projection_checkpoints,consumer_inbox,effect_outbox TO op_fund_reader;
 CREATE SEQUENCE public.operator_snapshot_probe;
 GRANT USAGE ON SEQUENCE public.operator_snapshot_probe TO op_fund_reader;`)
for(const table of ['funds','domain_events','event_outbox','event_aggregate_heads','effect_outbox']) {
 await admin(`CREATE POLICY operator_snapshot_scope ON ${table} AS RESTRICTIVE TO op_fund_reader USING("organizationId"='org-a');`)
}
await admin(`CREATE POLICY operator_snapshot_scope ON projection_builds AS RESTRICTIVE TO op_fund_reader USING("organizationId"='org-a' AND id=${q(buildId)}::uuid);
 CREATE POLICY operator_snapshot_scope ON projection_checkpoints AS RESTRICTIVE TO op_fund_reader USING("organizationId"='org-a' AND "buildId"=${q(buildId)}::uuid);
 CREATE POLICY operator_snapshot_scope ON consumer_inbox AS RESTRICTIVE TO op_fund_reader USING("organizationId"='org-a' AND "consumerName"=${q(`fund-shadow:${buildId}`)});
 CREATE POLICY operator_snapshot_scope ON fund_balance_projections AS RESTRICTIVE TO op_fund_reader USING("organizationId"='org-a' AND (status='active' AND "projectionVersion"=1 OR status='shadow' AND "projectionVersion"=2 AND "buildKey"='operator-snapshot'));`)
const fingerprint=()=>admin(`SELECT public.event_platform_jsonb_sha256(jsonb_build_object(
 'ledger',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM fund_transactions t),
 'events',(SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM domain_events e),
 'outbox',(SELECT jsonb_agg(to_jsonb(o) ORDER BY id) FROM event_outbox o),
 'heads',(SELECT jsonb_agg(to_jsonb(h) ORDER BY id) FROM event_aggregate_heads h),
 'funds',(SELECT jsonb_agg(to_jsonb(f) ORDER BY id) FROM funds f),
 'projections',(SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM fund_balance_projections p),
 'pointers',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM projection_activations a),
 'promotions',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM projection_promotion_events a),
 'inbox',(SELECT jsonb_agg(to_jsonb(i) ORDER BY id) FROM consumer_inbox i),
 'checkpoints',(SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM projection_checkpoints c),
 'effects',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM effect_outbox x)));`)
await test('initial lagging checkpoint refuses evidence; real guard rejects rewind and permits advance',async()=>{
 const before=await fingerprint();await rejected(read());assert.equal(await fingerprint(),before)
 await assert.rejects(admin(`UPDATE projection_checkpoints SET "sourceOffset"=4 WHERE "buildId"=${q(buildId)};`),/23514/)
 await admin(`UPDATE projection_checkpoints SET "sourceOffset"=6,"lastEventId"=(SELECT "eventId" FROM consumer_inbox WHERE "consumerName"=${q(`fund-shadow:${buildId}`)} ORDER BY "sourceOffset" DESC LIMIT 1) WHERE "buildId"=${q(buildId)};`)
})
await test('real migration tables + canonical reducer produce exact scoped snapshot, changing no rows',async()=>{
 const before=await fingerprint(),result=await read()
 assert.equal(result.source.length,2)
 assert.equal(result.source.find(s=>s.aggregateId==='fund-a').balance,'10.0000')
 assert.equal(result.source.find(s=>s.aggregateId==='fund-a').eventCount,'6')
 assert.equal(result.source.find(s=>s.aggregateId==='fund-a2').balance,'50.1234')
 assert.equal(result.checkpoints[0].lastOffset,'6');assert.equal(result.checkpoints[0].nextOffset,'7')
 assert.match(result.observedAt,/Z$/);assert.match(result.databaseSnapshot,/^\d+:\d+:/)
 assert.equal(result.brokerPositionsAuthenticated,false);assert.equal(result.externalEvidenceVerified,false)
 assert.equal(await fingerprint(),before)
 assert.equal(JSON.stringify(result).includes('Synthetic renamed'),false)
})
await test('tenant/build/key/code and expected role mismatch fail on actual restricted login',async()=>{
 for(const patch of [{organizationId:'org-b',buildId:foreignBuild},{buildId:foreignBuild},{buildKey:'wrong'},
  {codeSha:'b'.repeat(40)},{projectionVersion:3},{expectedReaderRole:'control_test_admin'},{environment:'other'},{fundIds:['fund-a']}]) await rejected(read({...expected,...patch}))
 await rejected(collectFundRecoveryDatabaseSnapshot(fixtureDatabase('control_test_admin'),{...expected,expectedReaderRole:'control_test_admin'},reduceFundBalance))
})
await test('partial outbox visibility cannot silently prove complete source history',async()=>{
 const id=await admin(`SELECT id::text FROM domain_events WHERE "aggregateId"='fund-a' ORDER BY "aggregateVersion" LIMIT 1;`)
 await admin(`CREATE POLICY operator_snapshot_partial ON event_outbox AS RESTRICTIVE TO op_fund_reader USING("eventId"<>${q(id)}::uuid);`)
 try{await rejected(read())}finally{await admin('DROP POLICY operator_snapshot_partial ON event_outbox;')}
})
await test('hidden entire aggregate is rejected against independently pinned Fund inventory',async()=>{
 const ids=(await admin(`SELECT id::text FROM domain_events WHERE "aggregateId"='fund-a';`)).split('\n').map(q).join(',')
 const policies={funds:"id<>'fund-a'",domain_events:'"aggregateId"<>\'fund-a\'',event_aggregate_heads:'"aggregateId"<>\'fund-a\'',
  event_outbox:`"eventId"::text NOT IN (${ids})`,consumer_inbox:`"eventId"::text NOT IN (${ids})`,fund_balance_projections:'"fundId"<>\'fund-a\''}
 for(const [table,condition] of Object.entries(policies))await admin(`CREATE POLICY operator_snapshot_hidden ON ${table} AS RESTRICTIVE TO op_fund_reader USING(${condition});`)
 try{await rejected(read())}finally{for(const table of Object.keys(policies))await admin(`DROP POLICY operator_snapshot_hidden ON ${table};`)}
})
await test('stale shadow balance or event version is rejected without a pointer write',async()=>{
 for(const mutation of ["balance=balance+0.0001",'"aggregateVersion"="aggregateVersion"-1']){
  await admin(`UPDATE fund_balance_projections SET ${mutation} WHERE "fundId"='fund-a' AND status='shadow';`)
  try{await rejected(read())}finally{await admin(`UPDATE fund_balance_projections s SET balance=a.balance,"aggregateVersion"=a."aggregateVersion" FROM fund_balance_projections a WHERE s."fundId"=a."fundId" AND s.status='shadow' AND a.status='active';`)}
 }
})
await test('matching money/version cannot conceal corrupted shadow timestamp evidence',async()=>{
 await admin(`UPDATE fund_balance_projections SET evidence=jsonb_set(evidence,'{lastEventAt}','"2000-01-01T00:00:00.000Z"'::jsonb) WHERE "fundId"='fund-a' AND status='shadow';`)
 try{await rejected(read())}finally{await admin(`UPDATE fund_balance_projections p SET evidence=jsonb_set(p.evidence,'{lastEventAt}',to_jsonb(o.envelope->>'time')) FROM event_outbox o WHERE p."lastEventId"=o."eventId" AND p."fundId"='fund-a' AND p.status='shadow';`)}
})
await test('actual transaction is READ ONLY even for a permitted sequence operation',async()=>{
 let readonly=false
 await rejected(read(expected,{afterQuery:async(sql,tx)=>{
  if(sql.includes('FROM pg_catalog.pg_roles')){
   try{await tx.$queryRawUnsafe("SELECT nextval('public.operator_snapshot_probe')")}catch(error){readonly=error.message.includes('25006');throw error}
  }
 }}))
 assert.equal(readonly,true)
 assert.equal(await admin('SELECT is_called FROM public.operator_snapshot_probe;'),'f')
})
await test('write-capable reader or missing FORCE RLS is rejected before evidence collection',async()=>{
 await admin('GRANT UPDATE ON fund_balance_projections TO op_fund_reader;')
 try{await rejected(read())}finally{await admin('REVOKE UPDATE ON fund_balance_projections FROM op_fund_reader;')}
 await admin('ALTER TABLE domain_events NO FORCE ROW LEVEL SECURITY;')
 try{await rejected(read())}finally{await admin('ALTER TABLE domain_events FORCE ROW LEVEL SECURITY;')}
})
await test('REPEATABLE READ keeps one snapshot across concurrent canonical writer; next collection sees stale shadow',async()=>{
 let changed=false
 const result=await read(expected,{afterQuery:async sql=>{
  if(sql.includes('FROM pg_catalog.pg_roles') && !changed){changed=true;await admin("UPDATE funds SET name='Synthetic concurrent name' WHERE id='fund-a';")}
 }})
 assert.equal(changed,true);assert.equal(result.source.find(s=>s.aggregateId==='fund-a').eventCount,'6')
 await rejected(read())
})

// Inactive canary adapter proof shares only this disposable real-schema fixture.
const {readFundCanary}=await import('./operator-fund-canary-reader.mjs')
const retainedBuild=randomUUID()
const canaryScope={...expected,enabled:true,pointerVersion:'1',expectedReaderRole:'op_canary_reader'}
const canary=(scope=canaryScope,hooks={})=>readFundCanary(fixtureDatabase('op_canary_reader',hooks),scope)
const canaryRejected=p=>assert.rejects(p,{message:'FUND_CANARY_READ_INVALID'})
await admin(`CREATE ROLE op_canary_reader LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB NOREPLICATION PASSWORD 'operator-fixture-only';
 GRANT USAGE ON SCHEMA public TO op_canary_reader;
 GRANT SELECT ON projection_activations,projection_builds,fund_balance_projections TO op_canary_reader;
 CREATE POLICY operator_canary_scope ON projection_activations AS RESTRICTIVE TO op_canary_reader USING("organizationId"='org-a');
 CREATE POLICY operator_canary_scope ON projection_builds AS RESTRICTIVE TO op_canary_reader USING("organizationId"='org-a' AND id IN (${q(buildId)}::uuid,${q(retainedBuild)}::uuid));
 CREATE POLICY operator_canary_scope ON fund_balance_projections AS RESTRICTIVE TO op_canary_reader USING("organizationId"='org-a' AND status='shadow' AND "buildKey" IN ('operator-snapshot','operator-retained'));
 INSERT INTO projection_builds(id,"organizationId","projectionName","projectionVersion","buildKey","codeSha",mode)
 VALUES(${q(retainedBuild)},'org-a','finance.fund-balance',3,'operator-retained',${q(expected.codeSha)},'shadow');
 INSERT INTO fund_balance_projections("organizationId","fundId","projectionVersion","buildKey",status,balance,currency,"aggregateVersion","lastEventId",evidence)
 SELECT "organizationId","fundId",3,'operator-retained','shadow',balance,currency,"aggregateVersion","lastEventId",evidence
 FROM fund_balance_projections WHERE "organizationId"='org-a' AND status='shadow' AND "projectionVersion"=2;`)
await test('canary actual restricted reader denies missing activation without fallback',async()=>{
 const before=await fingerprint();await canaryRejected(canary());assert.equal(await fingerprint(),before)
})
// All promotion writes below are test seed through unchanged production guards,
// not the authenticated operational controller or recovery approval proof.
await admin(`UPDATE projection_builds SET status='running',"startedAt"=clock_timestamp() WHERE id=${q(retainedBuild)};
 UPDATE projection_builds SET status='verifying' WHERE id IN (${q(buildId)},${q(retainedBuild)});
 UPDATE projection_builds SET status='ready',"completedAt"=clock_timestamp() WHERE id IN (${q(buildId)},${q(retainedBuild)});
 UPDATE projection_builds SET status='promoted',"promotedAt"=clock_timestamp() WHERE id IN (${q(buildId)},${q(retainedBuild)});
 BEGIN;
 INSERT INTO projection_promotion_events("organizationId","projectionName","targetBuildId",action,"requestKey","requestedBy","approvedBy","evidenceHash","resultingPointerVersion")
 VALUES('org-a','finance.fund-balance',${q(buildId)},'promote','canary-seed','fixture-requester','fixture-approver',repeat('a',64),1);
 INSERT INTO projection_activations("organizationId","projectionName","activeBuildId") VALUES('org-a','finance.fund-balance',${q(buildId)});
 COMMIT;`)
await test('canary reads real promoted pointer and exact decimals without changing business tables',async()=>{
 const before=await fingerprint(),result=await canary()
 assert.equal(result.pointerVersion,'1');assert.equal(result.funds.length,2)
 assert.equal(result.funds[0].balance,'10.0000');assert.equal(result.funds[1].balance,'50.1234')
 assert.equal(await fingerprint(),before)
})
await test('canary rejects tenant/build/code/key/version/inventory and login mismatches',async()=>{
 for(const patch of [{enabled:false},{organizationId:'org-b'},{buildId:foreignBuild},{pointerVersion:'2'},
 {codeSha:'b'.repeat(40)},{buildKey:'wrong'},{projectionVersion:3},{fundIds:['fund-a']},{expectedReaderRole:'event_app'}]) await canaryRejected(canary({...canaryScope,...patch}))
 await canaryRejected(readFundCanary(fixtureDatabase('control_test_admin'),{...canaryScope,expectedReaderRole:'control_test_admin'}))
})
await test('canary hidden rows, write grant and missing FORCE RLS fail closed',async()=>{
 await admin(`CREATE POLICY operator_canary_hidden ON fund_balance_projections AS RESTRICTIVE TO op_canary_reader USING("fundId"<>'fund-a');`)
 try{await canaryRejected(canary())}finally{await admin('DROP POLICY operator_canary_hidden ON fund_balance_projections;')}
 await admin('GRANT UPDATE ON projection_activations TO op_canary_reader;')
 try{await canaryRejected(canary())}finally{await admin('REVOKE UPDATE ON projection_activations FROM op_canary_reader;')}
 await admin('ALTER TABLE projection_activations NO FORCE ROW LEVEL SECURITY;')
 try{await canaryRejected(canary())}finally{await admin('ALTER TABLE projection_activations FORCE ROW LEVEL SECURITY;')}
})
await admin('GRANT USAGE ON SEQUENCE public.operator_snapshot_probe TO op_canary_reader;')
await test('canary genuine READ ONLY aborts attempted write and never returns on failed commit',async()=>{
 let readonly=false
 await canaryRejected(canary(canaryScope,{afterQuery:async(sql,tx)=>{
  if(sql.includes('FROM pg_catalog.pg_roles')) {
   try{await tx.$queryRawUnsafe("SELECT nextval('public.operator_snapshot_probe')")}catch(error){readonly=error.message.includes('25006');throw error}
  }
 }}))
 // A sequence grant makes the failure specifically READ ONLY, not permissions.
 assert.equal(readonly,true)
 await canaryRejected(canary(canaryScope,{beforeCommit:async()=>{throw new Error('private failure')}}))
})
const movePointer=(target,previous,version,key)=>admin(`BEGIN;
 INSERT INTO projection_promotion_events("organizationId","projectionName","targetBuildId","previousBuildId",action,"requestKey","requestedBy","approvedBy","evidenceHash","resultingPointerVersion")
 VALUES('org-a','finance.fund-balance',${q(target)},${q(previous)},'rollback',${q(key)},'fixture-requester','fixture-approver',repeat('b',64),${version});
 UPDATE projection_activations SET "activeBuildId"=${q(target)},"activationVersion"=${version} WHERE "organizationId"='org-a' AND "activationVersion"=${version-1};COMMIT;`)
await test('canary concurrent real rollback keeps original snapshot; next read rejects stale opt-in',async()=>{
 let changed=false
 const result=await canary(canaryScope,{afterQuery:async sql=>{
  if(sql.includes('FROM pg_catalog.pg_roles')&&!changed){changed=true;await movePointer(retainedBuild,buildId,2,'canary-rollback')}
 }})
 assert.equal(changed,true);assert.equal(result.pointerVersion,'1');assert.equal(result.buildId,buildId)
 await canaryRejected(canary())
 const retainedScope={...canaryScope,buildId:retainedBuild,buildKey:'operator-retained',projectionVersion:3,pointerVersion:'2'}
 const retained=await canary(retainedScope);assert.equal(retained.buildId,retainedBuild)
 await movePointer(buildId,retainedBuild,3,'canary-return')
 await canaryRejected(canary(retainedScope))
 assert.equal((await canary({...canaryScope,pointerVersion:'3'})).buildId,buildId)
})
await test('actual promoted checkpoint guard refuses continuation: lifecycle remains open',async()=>{
 await assert.rejects(admin(`UPDATE projection_checkpoints SET "sourceOffset"=7 WHERE "buildId"=${q(buildId)};`),/23514/)
})
await test('canary freezes authorized inventory before asynchronous database access',async()=>{
 const scope={...canaryScope,pointerVersion:'3',fundIds:[...canaryScope.fundIds]}
 const result=await canary(scope,{afterQuery:async sql=>{
  if(sql.includes('FROM pg_catalog.pg_roles')){scope.organizationId='org-b';scope.fundIds.length=0}
 }})
 assert.equal(result.organizationId,'org-a');assert.equal(result.funds.length,2)
})
