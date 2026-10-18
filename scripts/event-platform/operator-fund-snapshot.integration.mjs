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
 INSERT INTO fund_balance_projections("organizationId","fundId","projectionVersion","buildKey",status,balance,currency,"aggregateVersion","lastEventId")
 SELECT "organizationId","fundId",2,'operator-snapshot','shadow',balance,currency,"aggregateVersion","lastEventId" FROM fund_balance_projections WHERE status='active' AND "organizationId"='org-a';
 INSERT INTO consumer_inbox("organizationId","consumerName","consumerVersion","eventId","eventType","payloadHash","sourceTopic","sourcePartition","sourceOffset")
 SELECT e."organizationId",${q(`fund-shadow:${buildId}`)},1,e.id,e."eventType",o."payloadHash",'ld.staging.finance.events.v1',0,row_number() OVER(ORDER BY e."aggregateId",e."aggregateVersion")-1
 FROM domain_events e JOIN event_outbox o ON o."eventId"=e.id AND o."organizationId"=e."organizationId" WHERE e."organizationId"='org-a';
 INSERT INTO projection_checkpoints("organizationId","buildId","sourceTopic","sourcePartition","sourceOffset","lastEventId")
 SELECT 'org-a',${q(buildId)},"sourceTopic",0,"sourceOffset","eventId" FROM consumer_inbox WHERE "consumerName"=${q(`fund-shadow:${buildId}`)} ORDER BY "sourceOffset" DESC LIMIT 1;
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
await test('real migration tables + canonical reducer produce exact scoped snapshot, changing no rows',async()=>{
 const before=await fingerprint(),result=await read()
 assert.equal(result.source.length,2)
 assert.equal(result.source.find(s=>s.aggregateId==='fund-a').balance,'10.0000')
 assert.equal(result.source.find(s=>s.aggregateId==='fund-a').eventCount,'6')
 assert.equal(result.source.find(s=>s.aggregateId==='fund-a2').balance,'50.1234')
 assert.equal(result.checkpoints[0].lastOffset,'6');assert.equal(result.checkpoints[0].nextOffset,'7')
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
await test('checkpoint offset is last-processed, not next; trailing checkpoint rejects',async()=>{
 await admin(`UPDATE projection_checkpoints SET "sourceOffset"=5 WHERE "buildId"=${q(buildId)};`)
 try{await rejected(read())}finally{await admin(`UPDATE projection_checkpoints SET "sourceOffset"=6 WHERE "buildId"=${q(buildId)};`)}
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
await test('REPEATABLE READ keeps one snapshot across concurrent canonical writer; next collection sees stale shadow',async()=>{
 let changed=false
 const result=await read(expected,{afterQuery:async sql=>{
  if(sql.includes('FROM pg_catalog.pg_roles') && !changed){changed=true;await admin("UPDATE funds SET name='Synthetic concurrent name' WHERE id='fund-a';")}
 }})
 assert.equal(changed,true);assert.equal(result.source.find(s=>s.aggregateId==='fund-a').eventCount,'6')
 await rejected(read())
})
