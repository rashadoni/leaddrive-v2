// ISOLATED COMPOSITION PROOF. Actual schema/reducer; physical receipts and
// operational observations/signatures are synthetic, not runtime wiring.
import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID,createHash} from 'node:crypto'
import {readFile} from 'node:fs/promises'
import {fixtureSql,fixtureConnection,fixtureDatabase,quoteFixture as q} from './operator-postgres-client.fixture.mjs'
import {collectFundRecoveryDatabaseSnapshot} from './operator-fund-snapshot.mjs'
import {validateOperatorRecoveryEvidence} from './operator-recovery-evidence.mjs'
import {createFundEvidenceVerifier} from './operator-fund-verifier.mjs'
import {signedFundAttestations} from './operator-fund-verifier.fixture.mjs'
const modulePath=process.env.LD_OPERATOR_REDUCER_MODULE
assert.ok(modulePath?.startsWith(process.env.RUNNER_TEMP+'/'))
const {reduceFundBalance}=await import(modulePath)
const admin=sql=>fixtureSql('control_test_admin',sql)
const owned=sql=>admin(`SET ROLE ld_kafka_control_owner;${sql}`)
const json=x=>`${q(JSON.stringify(x))}::jsonb`
const call=(login,fn,args)=>fixtureSql(login,`SELECT ld_kafka_operator.${fn}(${args});`)
const denied=p=>assert.rejects(p,/P0001/)
await owned(await readFile(new URL('../../ops/event-platform/operator/fund-transition-fixture.sql',import.meta.url),'utf8'))
await admin(`GRANT USAGE ON SCHEMA public TO ld_kafka_control_owner;
 GRANT SELECT ON funds,fund_transactions,domain_events,event_outbox,event_aggregate_heads,fund_balance_projections,projection_builds,projection_checkpoints,consumer_inbox,effect_outbox,projection_activations,projection_promotion_events TO ld_kafka_control_owner;
 GRANT UPDATE ON projection_builds,projection_activations TO ld_kafka_control_owner;
 GRANT SELECT ON projection_builds,projection_promotion_events TO ld_kafka_operator_controller;
 GRANT UPDATE ("effectsFenced") ON projection_builds TO ld_kafka_operator_controller;
 CREATE POLICY operator_final_deferred_target ON projection_builds AS RESTRICTIVE TO ld_kafka_operator_controller
 USING("projectionName"='finance.fund-balance' AND ld_kafka_operator.fund_guard_scope("organizationId",id)) WITH CHECK("projectionName"='finance.fund-balance' AND ld_kafka_operator.fund_guard_scope("organizationId",id));
 CREATE POLICY operator_final_deferred_event ON projection_promotion_events AS RESTRICTIVE TO ld_kafka_operator_controller
 USING("projectionName"='finance.fund-balance' AND ld_kafka_operator.fund_guard_scope("organizationId","targetBuildId","requestKey")) WITH CHECK("projectionName"='finance.fund-balance' AND ld_kafka_operator.fund_guard_scope("organizationId","targetBuildId","requestKey"));
 GRANT INSERT ON projection_promotion_events TO ld_kafka_control_owner;
 CREATE ROLE op_final_reader LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB NOREPLICATION PASSWORD 'operator-fixture-only';
 GRANT USAGE ON SCHEMA public,ld_kafka_operator TO op_final_reader;
 GRANT SELECT ON funds,fund_transactions,domain_events,event_outbox,event_aggregate_heads,fund_balance_projections,projection_builds,projection_checkpoints,consumer_inbox,effect_outbox TO op_final_reader;
 GRANT EXECUTE ON FUNCTION ld_kafka_operator.fund_material_hash(text,uuid) TO op_final_reader;
 ALTER TABLE fund_transactions ENABLE ROW LEVEL SECURITY;ALTER TABLE fund_transactions FORCE ROW LEVEL SECURITY;
 CREATE POLICY operator_final_ledger_tenant ON fund_transactions USING("organizationId"=current_setting('app.org_id',true));`)
for(const table of ['funds','fund_transactions','domain_events','event_outbox','event_aggregate_heads','effect_outbox']) await admin(`CREATE POLICY operator_final_tenant ON ${table} AS RESTRICTIVE TO op_final_reader USING("organizationId"='org-a');`)
for(const table of ['consumer_inbox','projection_checkpoints','effect_outbox']) await admin(`CREATE TRIGGER kafka_source_row_guard BEFORE INSERT OR UPDATE OR DELETE ON ${table} FOR EACH ROW EXECUTE FUNCTION ld_kafka_operator.source_write_guard();
 CREATE TRIGGER kafka_source_truncate_guard BEFORE TRUNCATE ON ${table} FOR EACH STATEMENT EXECUTE FUNCTION ld_kafka_operator.source_write_guard();
 ALTER TABLE ${table} ENABLE ALWAYS TRIGGER kafka_source_row_guard;ALTER TABLE ${table} ENABLE ALWAYS TRIGGER kafka_source_truncate_guard;`)
await admin(`CREATE ROLE ld_kafka_operator_verifier NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB NOREPLICATION;
 CREATE ROLE op_final_verifier LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB NOREPLICATION PASSWORD 'operator-fixture-only';
 GRANT ld_kafka_operator_verifier TO op_final_verifier;`)
await owned(`INSERT INTO ld_kafka_operator.identities(login_name,principal_id,organization_id,enabled,valid_until)
 VALUES('op_final_verifier','fund-verifier-1','org-a',true,clock_timestamp()+interval '1 hour');`)
await owned(await readFile(new URL('../../ops/event-platform/operator/fund-evidence-registry.sql',import.meta.url),'utf8'))
let version=20
async function seed() {
 const id=randomUUID(),key=`final-${id}`,v=++version
 await admin(`INSERT INTO projection_builds(id,"organizationId","projectionName","projectionVersion","buildKey","codeSha",mode) VALUES(${q(id)},'org-a','finance.fund-balance',${v},${q(key)},repeat('a',40),'shadow');
 UPDATE projection_builds SET status='running',"startedAt"=clock_timestamp() WHERE id=${q(id)};
 INSERT INTO fund_balance_projections("organizationId","fundId","projectionVersion","buildKey",status,balance,currency,"aggregateVersion","lastEventId",evidence)
 SELECT a."organizationId",a."fundId",${v},${q(key)},'shadow',a.balance,a.currency,a."aggregateVersion",a."lastEventId",jsonb_build_object('lastEventId',a."lastEventId"::text,'lastEventAt',(SELECT envelope->>'time' FROM event_outbox WHERE "eventId"=a."lastEventId")) FROM fund_balance_projections a WHERE a."organizationId"='org-a' AND a.status='active' AND a."projectionVersion"=1;
 INSERT INTO consumer_inbox("organizationId","consumerName","consumerVersion","eventId","eventType","payloadHash","sourceTopic","sourcePartition","sourceOffset")
 SELECT e."organizationId",${q(`fund-shadow:${id}`)},1,e.id,e."eventType",o."payloadHash",'ld.staging.finance.events.v1',0,row_number() OVER(ORDER BY e."aggregateId",e."aggregateVersion")-1
 FROM domain_events e JOIN event_outbox o ON o."eventId"=e.id AND o."organizationId"=e."organizationId" WHERE e."organizationId"='org-a' AND e."aggregateType"='fund';
 INSERT INTO projection_checkpoints("organizationId","buildId","sourceTopic","sourcePartition","sourceOffset","lastEventId") SELECT 'org-a',${q(id)},"sourceTopic",0,"sourceOffset","eventId" FROM consumer_inbox WHERE "consumerName"=${q(`fund-shadow:${id}`)} ORDER BY "sourceOffset" DESC LIMIT 1;
 UPDATE fund_balance_projections s SET evidence=s.evidence||jsonb_build_object('adapterVersion',1,'buildId',${q(id)},'codeSha',repeat('a',40),'sourceTopic',i."sourceTopic",'sourcePartition',i."sourcePartition",'lastSourceOffset',i."sourceOffset"::text)
 FROM consumer_inbox i WHERE s."organizationId"=i."organizationId" AND s."lastEventId"=i."eventId" AND i."consumerName"=${q(`fund-shadow:${id}`)} AND s."projectionVersion"=${v} AND s."buildKey"=${q(key)};
 UPDATE projection_builds SET status='verifying' WHERE id=${q(id)};
 UPDATE projection_builds SET status='ready',"completedAt"=clock_timestamp() WHERE id=${q(id)};`)
 return {id,key,version:v}
}
async function readerScope(target) {
 const conditions={projection_builds:`id=${q(target.id)}::uuid`,projection_checkpoints:`"buildId"=${q(target.id)}::uuid`,consumer_inbox:`"consumerName"=${q(`fund-shadow:${target.id}`)}`,fund_balance_projections:`(status='active' AND "projectionVersion"=1 OR "projectionVersion"=${target.version} AND "buildKey"=${q(target.key)})`}
 for(const [table,condition] of Object.entries(conditions)) await admin(`DROP POLICY IF EXISTS operator_final_scope ON ${table};CREATE POLICY operator_final_scope ON ${table} AS RESTRICTIVE TO op_final_reader USING("organizationId"='org-a' AND ${condition});`)
}
const pointer=async()=>JSON.parse(await admin(`SELECT json_build_object('id',"activeBuildId",'version',"activationVersion"::text) FROM projection_activations WHERE "organizationId"='org-a' AND "projectionName"='finance.fund-balance';`))
async function prepared(target,action='promote',options={}) {
 target ??= await seed()
 await readerScope(target)
 const inventory=JSON.parse(await admin(`SELECT json_agg(id ORDER BY id) FROM funds WHERE "organizationId"='org-a';`))
 let materialHash
 const snapshot=await collectFundRecoveryDatabaseSnapshot(fixtureDatabase('op_final_reader',{afterQuery:async(sql,tx)=>{
  if(sql.includes('AS snapshot')) materialHash=(await tx.$queryRawUnsafe('SELECT ld_kafka_operator.fund_material_hash($1,$2::uuid) AS hash','org-a',target.id))[0].hash
 }}),{organizationId:'org-a',buildId:target.id,buildKey:target.key,projectionVersion:target.version,codeSha:'a'.repeat(40),expectedReaderRole:'op_final_reader',environment:'staging',fundIds:inventory},reduceFundBalance)
 const previous=await pointer(),id=randomUUID()
 const plan={organizationId:'org-a',buildId:target.id,projectionName:'finance.fund-balance',releaseSha:'a'.repeat(40),artifactSha256:`sha256:${'b'.repeat(64)}`,environment:'staging',clusterId:'cluster-1',topicId:'BBBBBBBBBBBBBBBBBBBBBA',groupId:'ld.staging.finance.fund-shadow.v2.drill',action,expectedPointerVersion:previous.version}
 const manifest={apiVersion:'event-platform.leaddrive.io/v1',kind:'OperatorRecoveryEvidence',...plan,previousBuildId:previous.id,receiptId:`synthetic-${id}`,observedAt:new Date().toISOString(),soakStartedAt:new Date(Date.now()-120000).toISOString(),targetEffectsFenced:true,externalEffectAttempts:'0',unresolvedQuarantine:'0',stop:{intakeStopped:true,acksFenced:true,sqlSettled:true,childClosed:true,actualCloseReceiptId:'synthetic-close'},sourceHistoryComplete:true,archiveVerified:true,restoreReceiptId:'synthetic-restore',independentApprovalReceiptId:'synthetic-approval',source:snapshot.source,shadow:snapshot.shadow,partitions:snapshot.checkpoints.map(c=>({partition:c.partition,historyStart:'0',replayStart:'0',frozenEndExclusive:c.nextOffset,checkpointNext:c.nextOffset,archiveNext:c.nextOffset})),rollback:{retainedBuildId:target.id,compatibilityVerified:true,windowEndsAt:new Date(Date.now()+3600000).toISOString(),writeFenceApplied:true}}
 const raw=JSON.stringify(manifest);plan.evidenceSha256=`sha256:${createHash('sha256').update(raw).digest('hex')}`
 validateOperatorRecoveryEvidence(raw,{plan,now:new Date().toISOString(),maxAgeMs:60000,minSoakMs:60000,partitionCount:snapshot.checkpoints.length,previousBuildId:previous.id})
 const hash=await call('op_requester','request',`${q(id)},${json(plan)},clock_timestamp()+interval '10 minutes'`)
 await call('op_approver','approve',`${q(id)},${q(hash)}`)
 const generation=await call('op_controller','consume',`${q(id)},${q(hash)},${json(plan)}`)
 const context={...JSON.parse(await call('op_final_verifier','read_fund_verification_request',q(id))),maxAgeMs:60000,minSoakMs:60000,partitionCount:snapshot.checkpoints.length,retainedUntil:new Date(Date.now()+3600000).toISOString()}
 const signing=signedFundAttestations(context,materialHash,new Date().toISOString())
 for(const key of Object.values(signing.keys))await owned(`INSERT INTO ld_kafka_operator.fund_provenance_keys(organization_id,gate,key_id,principal_id,public_key_hash,valid_from,valid_until,enabled) VALUES('org-a',${q(key.gate)},${q(key.keyId)},${q(key.principalId)},${q(createHash('sha256').update(key.publicKeyPem).digest('hex'))},${q(key.validFrom)},${q(key.validUntil)},true);`)
 let registration
 const verifier=createFundEvidenceVerifier({readContext:async()=>context,readManifest:async()=>raw,
 readSnapshot:async()=>({snapshot,materialHash}),readAttestation:async gate=>signing.packets[gate],readKey:async gate=>signing.keys[gate],clock:()=>new Date().toISOString(),
 register:async row=>{registration=row;if(!options.skipRegistration)await register(row)}})
 await verifier(id)
 return {id,hash,generation,plan,target,previous,materialHash,registration,signing}
}
const registrationArgs=r=>`${q(r.requestId)},${q(r.planHash)},${r.generation},${q(r.raw)},${q(r.materialHash)},${q(r.previousBuildId)},${q(r.validUntil)},${q(r.retainedUntil)},${q(r.provenanceHash)},${q(r.provenanceRaw)}`
const register=(row,login='op_final_verifier')=>call(login,'register_fund_evidence',registrationArgs(row))
const args=f=>`${q(f.id)},${q(f.hash)},${f.generation}`
const apply=f=>fixtureSql('op_controller',`BEGIN;SET LOCAL statement_timeout='5s';SET LOCAL lock_timeout='2s';SELECT set_config('app.org_id',${q(f.plan.organizationId)},true);SELECT ld_kafka_operator.acquire_source_barrier(${args(f)});SELECT ld_kafka_operator.apply_fund_transition(${args(f)});COMMIT;`,{sanitizedDiagnostics:true})
await test('canonical proof + frozen material + authenticated actual pointer promotion and retained rollback',async()=>{
 const promoted=await prepared();await apply(promoted)
 assert.equal((await pointer()).id,promoted.target.id)
 assert.equal((await pointer()).version,String(BigInt(promoted.previous.version)+1n))
 assert.equal(await owned(`SELECT status FROM ld_kafka_operator.requests WHERE id=${q(promoted.id)};`),'settled')
 assert.equal(await admin(`SELECT "requestedBy"||':'||"approvedBy" FROM projection_promotion_events WHERE "requestKey"=${q(promoted.id)};`),'person-1:person-2')
 const replacement=await prepared();await apply(replacement)
 const rollback=await prepared(promoted.target,'rollback');await apply(rollback)
 assert.equal((await pointer()).id,promoted.target.id)
 await denied(apply(rollback))
})
await test('no barrier, missing control guard, stale material, expired evidence and revoked lease deny without pointer change',async()=>{
 const noBarrier=await prepared();await denied(call('op_controller','apply_fund_transition',args(noBarrier)))
 for(const table of ['consumer_inbox','effect_outbox']) {
  const guard=await prepared();await admin(`ALTER TABLE ${table} DISABLE TRIGGER kafka_source_row_guard;`)
  try{await denied(apply(guard))}finally{await admin(`ALTER TABLE ${table} ENABLE ALWAYS TRIGGER kafka_source_row_guard;`)}
 }
 const stale=await prepared(),before=await pointer()
 await admin(`UPDATE fund_balance_projections SET balance=balance+0.0001 WHERE "organizationId"='org-a' AND "projectionVersion"=${stale.target.version} AND "buildKey"=${q(stale.target.key)} AND "fundId"='fund-a';`)
 await denied(apply(stale));assert.deepEqual(await pointer(),before)
 const expired=await prepared();await owned(`UPDATE ld_kafka_operator.fund_verified_evidence SET valid_until=clock_timestamp()-interval '1 second' WHERE request_id=${q(expired.id)};`);await denied(apply(expired))
 const revoked=await prepared();await call('op_controller','revoke',`${q(revoked.id)},${q(revoked.hash)}`);await denied(apply(revoked))
})
await test('subsequent canonical source write invalidates verified material',async()=>{
 const f=await prepared(),before=await pointer()
 await admin("UPDATE funds SET name='Synthetic transition drift' WHERE id='fund-a';")
 await denied(apply(f));assert.deepEqual(await pointer(),before)
})
await test('same pointer version concurrent candidates have exactly one committed winner',async()=>{
 const a=await prepared(),b=await prepared()
 const results=await Promise.allSettled([apply(a),apply(b)])
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1)
 assert.match(results.find(r=>r.status==='rejected').reason.message,/P0001|55P03/)
 assert.ok([a.target.id,b.target.id].includes((await pointer()).id))
})
await test('held final barrier denies source/checkpoint/inbox writes and wrong controller cannot transition',async()=>{
 const f=await prepared(),connection=fixtureConnection('op_controller',{sanitizedDiagnostics:true})
 await denied(call('op_controller2','apply_fund_transition',args(f)))
 try{
  await connection.command(`BEGIN;SET LOCAL statement_timeout='5s';SET LOCAL lock_timeout='2s';SELECT set_config('app.org_id',${q(f.plan.organizationId)},true);SELECT ld_kafka_operator.acquire_source_barrier(${args(f)});`)
  await denied(admin("UPDATE funds SET name='Synthetic blocked transition writer' WHERE id='fund-a';"))
  // Target is ready, so the original checkpoint guard also denies mutations.
  await assert.rejects(admin(`UPDATE projection_checkpoints SET "sourceOffset"="sourceOffset"+1 WHERE "buildId"=${q(f.target.id)};`),/P0001|23514/)
  await denied(admin(`INSERT INTO consumer_inbox("organizationId","consumerName","consumerVersion","eventId","eventType","payloadHash","sourceTopic","sourcePartition","sourceOffset") SELECT "organizationId",'unrelated-fixture',1,id,"eventType",repeat('a',64),'ld.staging.finance.events.v1',0,0 FROM domain_events WHERE "organizationId"='org-a' LIMIT 1;`))
  await connection.command(`SELECT ld_kafka_operator.apply_fund_transition(${args(f)});COMMIT;`)
 }finally{await connection.close()}
})
await test('actual final evidence expiry at COMMIT rolls back pointer/build/event/settlement',async()=>{
 const f=await prepared(),before=await pointer(),connection=fixtureConnection('op_controller',{sanitizedDiagnostics:true})
 await owned(`UPDATE ld_kafka_operator.fund_verified_evidence SET valid_until=clock_timestamp()+interval '3 seconds' WHERE request_id=${q(f.id)};`)
 let staged=false
 try{
  await connection.command(`BEGIN;SET LOCAL statement_timeout='5s';SET LOCAL lock_timeout='2s';SELECT set_config('app.org_id',${q(f.plan.organizationId)},true);SELECT ld_kafka_operator.acquire_source_barrier(${args(f)});`)
  const version=await connection.command(`SELECT ld_kafka_operator.apply_fund_transition(${args(f)});`)
  staged=version===String(BigInt(before.version)+1n)
  await connection.command('SELECT pg_sleep(4);');await denied(connection.command('COMMIT;'))
 }finally{await connection.close()}
 assert.equal(staged,true);assert.deepEqual(await pointer(),before)
 assert.equal(await admin(`SELECT status FROM projection_builds WHERE id=${q(f.target.id)};`),'ready')
 assert.equal(await admin(`SELECT count(*) FROM projection_promotion_events WHERE "requestKey"=${q(f.id)};`),'0')
 assert.equal(await owned(`SELECT status FROM ld_kafka_operator.requests WHERE id=${q(f.id)};`),'consumed')
 assert.equal(await owned(`SELECT count(*) FROM ld_kafka_operator.fund_transition_commits WHERE request_id=${q(f.id)};`),'0')
})
await test('controller cannot self-register verifier evidence or directly mutate business pointers',async()=>{
 await assert.rejects(fixtureSql('op_controller','SELECT * FROM ld_kafka_operator.fund_verified_evidence;'),/42501/)
 await assert.rejects(fixtureSql('op_controller','DELETE FROM ld_kafka_operator.fund_verified_evidence;'),/42501/)
 await assert.rejects(fixtureSql('op_controller','UPDATE projection_activations SET "activationVersion"="activationVersion"+1;'),/42501/)
})

await test('retained actual build with expired rollback window cannot replace current pointer',async()=>{
 const first=await prepared();await apply(first)
 const second=await prepared();await apply(second)
 const rollback=await prepared(first.target,'rollback'),before=await pointer()
 await owned(`UPDATE ld_kafka_operator.fund_verified_evidence SET retained_until=clock_timestamp()-interval '1 second' WHERE request_id=${q(rollback.id)};`)
 await denied(apply(rollback));assert.deepEqual(await pointer(),before)
})

await test('PG16 deferred guard rights expose only exact live-barrier target and cannot change its effect fence',async()=>{
 const f=await prepared()
 assert.equal(await fixtureSql('op_controller',`BEGIN;SET LOCAL statement_timeout='5s';SET LOCAL lock_timeout='2s';SELECT set_config('app.org_id','org-a',true);SELECT count(*) FROM projection_builds WHERE id=${q(f.target.id)};COMMIT;`),'org-a\n0')
 const connection=fixtureConnection('op_controller',{sanitizedDiagnostics:true})
 try{
  await connection.command(`BEGIN;SET LOCAL statement_timeout='5s';SET LOCAL lock_timeout='2s';SELECT set_config('app.org_id','org-a',true);SELECT ld_kafka_operator.acquire_source_barrier(${args(f)});`)
  assert.equal(await connection.command(`SELECT count(*) FROM projection_builds WHERE id=${q(f.target.id)};`),'1')
  assert.equal(await connection.command(`SELECT count(*) FROM projection_builds WHERE id<>${q(f.target.id)};`),'0')
  await connection.command('ROLLBACK;')
 }finally{await connection.close()}
 await assert.rejects(fixtureSql('op_controller',`BEGIN;SET LOCAL statement_timeout='5s';SET LOCAL lock_timeout='2s';SELECT set_config('app.org_id','org-a',true);SELECT ld_kafka_operator.acquire_source_barrier(${args(f)});UPDATE projection_builds SET "effectsFenced"=false WHERE id=${q(f.target.id)};COMMIT;`),/23514/)
 await assert.rejects(fixtureSql('op_controller','SET session_replication_role=replica;'),/42501/)
 await assert.rejects(fixtureSql('op_controller','ALTER TABLE projection_builds DISABLE TRIGGER projection_builds_state_machine_trigger;'),/42501/)
 await assert.rejects(fixtureSql('op_controller',`UPDATE projection_builds SET status='failed' WHERE id=${q(f.target.id)};`),/42501/)
 assert.equal(await admin(`SELECT "effectsFenced" FROM projection_builds WHERE id=${q(f.target.id)};`),'t')
 await apply(f)
})

await test('named independent verifier registers one immutable generation and cannot read or change private/source state',async()=>{
 const f=await prepared(undefined,'promote',{skipRegistration:true})
 await assert.rejects(register(f.registration,'op_controller'),/42501/)
 await assert.rejects(register(f.registration,'op_requester'),/42501/)
 await register(f.registration)
 await assert.rejects(register(f.registration),/23505/)
 assert.equal(await owned(`SELECT verifier::text||':'||verifier_principal FROM ld_kafka_operator.fund_evidence_registrations WHERE request_id=${q(f.id)};`),'op_final_verifier:fund-verifier-1')
 assert.equal(await owned(`SELECT actor::text FROM ld_kafka_operator.audit WHERE request_id=${q(f.id)} AND transition='fund-evidence-registered';`),'op_final_verifier')
 for(const sql of ['SELECT * FROM ld_kafka_operator.fund_verified_evidence;','DELETE FROM ld_kafka_operator.fund_evidence_registrations;','UPDATE funds SET name=name;','UPDATE projection_activations SET "activationVersion"="activationVersion"+1;']) await assert.rejects(fixtureSql('op_final_verifier',sql),/42501/)
 await apply(f)
})
await test('registration rejects wrong generation/hash/raw/previous/expiry and does not create evidence',async()=>{
 const f=await prepared(undefined,'promote',{skipRegistration:true})
 for(const edit of [{generation:String(BigInt(f.generation)+1n)},{planHash:'f'.repeat(64)},{raw:f.registration.raw+' '},{previousBuildId:f.target.id},{materialHash:'invalid'},{provenanceHash:'invalid'},{validUntil:new Date(Date.now()-1000).toISOString()},{validUntil:new Date(Date.now()+120000).toISOString()},{retainedUntil:new Date(Date.now()-1000).toISOString()}]) await denied(register({...f.registration,...edit}))
 assert.equal(await owned(`SELECT count(*) FROM ld_kafka_operator.fund_verified_evidence WHERE request_id=${q(f.id)};`),'0')
 await denied(apply(f));await register(f.registration);await apply(f)
})
await test('verifier tenant, capability, membership, revocation and remapping are checked again at transition',async()=>{
 const f=await prepared(),before=await pointer()
 for(const [change,restore]of [
 ["organization_id='org-b'","organization_id='org-a'"],["enabled=false","enabled=true"],["may_request=true","may_request=false"],["principal_id='changed-verifier'","principal_id='fund-verifier-1'"],["valid_until=clock_timestamp()-interval '1 second'","valid_until=clock_timestamp()+interval '1 hour'"]]){
  await owned(`UPDATE ld_kafka_operator.identities SET ${change} WHERE login_name='op_final_verifier';`)
  try{await denied(apply(f));await denied(call('op_final_verifier','read_fund_verification_request',q(f.id)))}finally{await owned(`UPDATE ld_kafka_operator.identities SET ${restore} WHERE login_name='op_final_verifier';`)}
 }
 await admin('GRANT ld_kafka_operator_observer TO op_final_verifier;')
 try{await denied(apply(f))}finally{await admin('REVOKE ld_kafka_operator_observer FROM op_final_verifier;')}
 assert.deepEqual(await pointer(),before);await apply(f)
})
await test('registration staged by verifier rolls back on revocation at COMMIT, including evidence and audit',async()=>{
 const f=await prepared(undefined,'promote',{skipRegistration:true}),connection=fixtureConnection('op_final_verifier')
 try{
  await connection.command(`BEGIN;SELECT ld_kafka_operator.register_fund_evidence(${registrationArgs(f.registration)});`)
  await owned("UPDATE ld_kafka_operator.identities SET enabled=false WHERE login_name='op_final_verifier';")
  await denied(connection.command('COMMIT;'))
 }finally{await connection.close();await owned("UPDATE ld_kafka_operator.identities SET enabled=true WHERE login_name='op_final_verifier';")}
 for(const table of ['fund_verified_evidence','fund_evidence_registrations']) assert.equal(await owned(`SELECT count(*) FROM ld_kafka_operator.${table} WHERE request_id=${q(f.id)};`),'0')
 assert.equal(await owned(`SELECT count(*) FROM ld_kafka_operator.audit WHERE request_id=${q(f.id)} AND transition='fund-evidence-registered';`),'0')
 await register(f.registration);await apply(f)
})
await test('verifier identity expiry after staged pointer transition rolls back all final effects',async()=>{
 const f=await prepared(),before=await pointer(),connection=fixtureConnection('op_controller')
 await owned("UPDATE ld_kafka_operator.identities SET valid_until=clock_timestamp()+interval '3 seconds' WHERE login_name='op_final_verifier';")
 try{
  await connection.command(`BEGIN;SET LOCAL statement_timeout='5s';SET LOCAL lock_timeout='2s';SELECT set_config('app.org_id','org-a',true);SELECT ld_kafka_operator.acquire_source_barrier(${args(f)});`)
  assert.equal(await connection.command(`SELECT ld_kafka_operator.apply_fund_transition(${args(f)});`),String(BigInt(before.version)+1n))
  await connection.command('SELECT pg_sleep(4);');await denied(connection.command('COMMIT;'))
 }finally{await connection.close();await owned("UPDATE ld_kafka_operator.identities SET valid_until=clock_timestamp()+interval '1 hour' WHERE login_name='op_final_verifier';")}
 assert.deepEqual(await pointer(),before)
 assert.equal(await admin(`SELECT status FROM projection_builds WHERE id=${q(f.target.id)};`),'ready')
 assert.equal(await admin(`SELECT count(*) FROM projection_promotion_events WHERE "requestKey"=${q(f.id)};`),'0')
 assert.equal(await owned(`SELECT status FROM ld_kafka_operator.requests WHERE id=${q(f.id)};`),'consumed')
})

await test('material fingerprint rejects oversized fixture scopes and encoded bytes before hashing',async()=>{
 const f=await prepared(),before=await pointer()
 const hash=()=>fixtureSql('op_final_reader',`BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;SET LOCAL statement_timeout='5s';SELECT set_config('app.org_id','org-a',true);SELECT coalesce(ld_kafka_operator.fund_material_hash('org-a',${q(f.target.id)}),'DENIED');COMMIT;`)
 await admin(`INSERT INTO funds(id,"organizationId",name,currency,"currentBalance") SELECT 'operator-cap-'||g,'org-a','Synthetic cap probe','AZN',0.0000 FROM generate_series(1,201) g;`)
 try{assert.equal(await hash(),'org-a\nDENIED');await denied(apply(f))}finally{await admin("DELETE FROM funds WHERE id LIKE 'operator-cap-%';")}
 await admin("UPDATE funds SET name=repeat('x',1048577) WHERE id='fund-a';")
 try{assert.equal(await hash(),'org-a\nDENIED');await denied(apply(f))}finally{await admin("UPDATE funds SET name='Synthetic material-budget restored' WHERE id='fund-a';")}
 assert.deepEqual(await pointer(),before)
})

await test('DB provenance registry rejects missing, duplicate and remapped signed-purpose keys',async()=>{
 const f=await prepared(undefined,'promote',{skipRegistration:true}),records=JSON.parse(f.registration.provenanceRaw)
 for(const entries of [[],records.map((r,i)=>i===6?records[0]:r),records.map((r,i)=>i===0?{...r,keyHash:'f'.repeat(64)}:r)]){
  const provenanceRaw=JSON.stringify(entries)
  await denied(register({...f.registration,provenanceRaw,provenanceHash:createHash('sha256').update(provenanceRaw).digest('hex')}))
 }
 const key=f.signing.keys.stop
 await owned(`UPDATE ld_kafka_operator.fund_provenance_keys SET organization_id='org-b' WHERE key_id=${q(key.keyId)};`)
 try{await denied(register(f.registration))}finally{await owned(`UPDATE ld_kafka_operator.fund_provenance_keys SET organization_id='org-a' WHERE key_id=${q(key.keyId)};`)}
 await assert.rejects(fixtureSql('op_final_verifier','UPDATE ld_kafka_operator.fund_provenance_keys SET enabled=true;'),/42501/)
 await register(f.registration);await apply(f)
})
await test('signed-key revocation after staging is checked at final COMMIT and rolls pointer/build/event back',async()=>{
 const f=await prepared(),before=await pointer(),connection=fixtureConnection('op_controller'),key=f.signing.keys.stop
 try{
  await connection.command(`BEGIN;SET LOCAL statement_timeout='5s';SET LOCAL lock_timeout='2s';SELECT set_config('app.org_id','org-a',true);SELECT ld_kafka_operator.acquire_source_barrier(${args(f)});`)
  assert.equal(await connection.command(`SELECT ld_kafka_operator.apply_fund_transition(${args(f)});`),String(BigInt(before.version)+1n))
  await owned(`UPDATE ld_kafka_operator.fund_provenance_keys SET enabled=false WHERE key_id=${q(key.keyId)};`)
  await denied(connection.command('COMMIT;'))
 }finally{await connection.close();await owned(`UPDATE ld_kafka_operator.fund_provenance_keys SET enabled=true WHERE key_id=${q(key.keyId)};`)}
 assert.deepEqual(await pointer(),before)
 assert.equal(await admin(`SELECT status FROM projection_builds WHERE id=${q(f.target.id)};`),'ready')
 assert.equal(await admin(`SELECT count(*) FROM projection_promotion_events WHERE "requestKey"=${q(f.id)};`),'0')
 assert.equal(await owned(`SELECT status FROM ld_kafka_operator.requests WHERE id=${q(f.id)};`),'consumed')
})
