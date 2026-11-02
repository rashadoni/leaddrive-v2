// Actual pg_dump/pg_restore of own disposable fixture into a NEW isolated DB.
// Canonical parity/read-role proof, not production PITR/encrypted archive/WORM.
import test from 'node:test'
import assert from 'node:assert/strict'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {randomUUID,createHash} from 'node:crypto'
import {mkdtemp,readFile,stat,chmod,writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {fixtureSql,fixtureDatabase,fixtureRestoredDatabase,quoteFixture as q} from './operator-postgres-client.fixture.mjs'
import {collectFundRecoveryDatabaseSnapshot} from './operator-fund-snapshot.mjs'
const admin=sql=>fixtureSql('control_test_admin',sql)
// Original transport admission occurs BEFORE any dump/restore/DDL.
assert.equal(await admin('SELECT current_database();'),'kafka_operator_test')
assert.ok(process.env.RUNNER_TEMP?.startsWith('/'))
const modulePath=process.env.LD_OPERATOR_REDUCER_MODULE
assert.ok(modulePath?.startsWith(process.env.RUNNER_TEMP+'/'))
const{reduceFundBalance}=await import(modulePath)
const databaseName='kafka_operator_restore_'+randomUUID().replaceAll('-','')
const directory=await mkdtemp(join(process.env.RUNNER_TEMP,'operator-restore-')),archive=join(directory,'fund.dump')
const env={PATH:process.env.PATH,PGHOST:process.env.PGHOST,PGPORT:process.env.PGPORT,PGUSER:'control_test_admin',PGPASSWORD:'operator-fixture-only',PGCONNECT_TIMEOUT:'5',PGOPTIONS:'-c statement_timeout=10000 -c lock_timeout=2000'}
const execute=promisify(execFile)
async function command(binary,args){try{return await execute(binary,args,{env,timeout:30000,maxBuffer:1048576})}catch{throw new Error('DISPOSABLE_RESTORE_COMMAND_FAILED')}}
const sql=statement=>command('psql',['-X','-qAt','-v','ON_ERROR_STOP=1','--dbname',databaseName,'-c',statement])
const scope=JSON.parse(await admin(`SELECT json_build_object('organizationId',b."organizationId",'buildId',b.id,'buildKey',b."buildKey",'projectionVersion',b."projectionVersion",'codeSha',b."codeSha",'expectedReaderRole','op_final_reader','environment','staging','fundIds',(SELECT json_agg(f.id ORDER BY f.id) FROM funds f WHERE f."organizationId"='org-a')) FROM projection_builds b JOIN projection_activations p ON p."activeBuildId"=b.id AND p."organizationId"=b."organizationId" WHERE p."organizationId"='org-a';`))
const original=()=>collectFundRecoveryDatabaseSnapshot(fixtureDatabase('op_final_reader'),scope,reduceFundBalance)
const sourceHash=()=>fixtureSql('op_final_reader',`BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;SELECT set_config('app.org_id','org-a',true);SELECT ld_kafka_operator.fund_material_hash('org-a',${q(scope.buildId)});COMMIT;`)
const before=await sourceHash(),snapshot=await original()
assert.match(before,/^org-a\n[0-9a-f]{64}$/)
let created=false,role=false,archiveDigest
let failed=false
async function scenario(name,work){await test(name,async()=>{try{await work()}catch(error){failed=true;throw error}})}
try{
 await scenario('pg_dump archive is real bounded readable bytes pinned by SHA before isolated restore',async()=>{
  await command('pg_dump',['--dbname','kafka_operator_test','--format','custom','--no-owner','--no-privileges','--file',archive])
  const size=(await stat(archive)).size;assert.ok(size>0&&size<=16777216)
  await chmod(archive,0o400)
  const digest=createHash('sha256').update(await readFile(archive)).digest('hex');archiveDigest=digest
  await command('pg_restore',['--list',archive])
  assert.equal(createHash('sha256').update(await readFile(archive)).digest('hex'),digest)
  await admin(`CREATE DATABASE "${databaseName}";`);created=true
  await command('pg_restore',['--dbname',databaseName,'--no-owner','--no-privileges','--single-transaction','--exit-on-error',archive])
  assert.equal(await sourceHash(),before)
 })
 await admin("CREATE ROLE op_restore_reader LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB NOREPLICATION PASSWORD 'operator-fixture-only';");role=true
 await sql(`REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public,ld_kafka_operator FROM PUBLIC;
 GRANT USAGE ON SCHEMA public,ld_kafka_operator TO op_restore_reader;
 GRANT SELECT ON funds,fund_transactions,domain_events,event_outbox,event_aggregate_heads,fund_balance_projections,projection_builds,projection_checkpoints,consumer_inbox,effect_outbox TO op_restore_reader;
 GRANT EXECUTE ON FUNCTION public.event_platform_jsonb_sha256(jsonb),public.digest(bytea,text),public.digest(text,text),ld_kafka_operator.fund_material_hash(text,uuid) TO op_restore_reader;`)
 for(const table of ['funds','fund_transactions','domain_events','event_outbox','event_aggregate_heads','fund_balance_projections','projection_builds','projection_checkpoints','consumer_inbox','effect_outbox'])await sql(`CREATE POLICY operator_restore_tenant ON ${table} AS RESTRICTIVE TO op_restore_reader USING("organizationId"='org-a');`)
 for(const[table,condition]of Object.entries({projection_builds:`id=${q(scope.buildId)}::uuid`,projection_checkpoints:`"buildId"=${q(scope.buildId)}::uuid`,consumer_inbox:`"consumerName"=${q('fund-shadow:'+scope.buildId)} AND "consumerVersion"=1`,fund_balance_projections:`(status='active' AND "projectionVersion"=1 OR "projectionVersion"=${scope.projectionVersion} AND "buildKey"=${q(scope.buildKey)})`}))await sql(`CREATE POLICY operator_restore_build ON ${table} AS RESTRICTIVE TO op_restore_reader USING(${condition});`)
 let restoredHash
 const restored=()=>collectFundRecoveryDatabaseSnapshot(fixtureRestoredDatabase(databaseName,{afterQuery:async(statement,tx)=>{
  if(statement.includes('AS snapshot'))restoredHash=(await tx.$queryRawUnsafe('SELECT ld_kafka_operator.fund_material_hash($1,$2::uuid) AS hash','org-a',scope.buildId))[0].hash
 }}),{...scope,expectedReaderRole:'op_restore_reader'},reduceFundBalance)
 await scenario('independent restricted restore login reproduces exact canonical histories/states/checkpoints/material',async()=>{
  const value=await restored()
  for(const key of ['source','shadow','checkpoints'])assert.deepEqual(value[key],snapshot[key])
  assert.equal('org-a\n'+restoredHash,before)
  assert.equal(await sourceHash(),before)
 })
 await scenario('partial restored visibility denies certification and source archive/database stay unchanged',async()=>{
  await sql(`CREATE POLICY operator_restore_missing ON funds AS RESTRICTIVE TO op_restore_reader USING(id<>${q(scope.fundIds[0])});`)
  try{await assert.rejects(restored(),{message:'FUND_RECOVERY_SNAPSHOT_INVALID'})}finally{await sql('DROP POLICY operator_restore_missing ON funds;')}
  assert.deepEqual((await restored()).source,snapshot.source)
  assert.equal(await sourceHash(),before)
 })
 assert.equal(failed,false,'every physical drill scenario must succeed before issuing receipt')
 await writeFile(join(directory,'restore-receipt.json'),JSON.stringify({apiVersion:'event-platform.leaddrive.io/v1',kind:'IsolatedFundRestoreReceipt',scope:'disposable-pg-dump',observedAt:new Date().toISOString(),archiveSha256:archiveDigest,materialHash:before.split('\n')[1],organizationId:scope.organizationId,buildId:scope.buildId,fixtureBuildCodeSha:scope.codeSha,source:snapshot.source,shadow:snapshot.shadow,checkpoints:snapshot.checkpoints,verified:true,productionPitrEncryptionWormProven:false}),{flag:'wx',mode:0o600})
 console.log('operator_independent_restore=PASS; scope=disposable-pg-dump; canonical_exact_parity=PASS; source_unchanged=PASS; production_pitr_encryption_worm=NOT_PROVEN')
}finally{
 if(created)await admin(`DROP DATABASE "${databaseName}";`)
 if(role)await admin('DROP ROLE op_restore_reader;')
}
