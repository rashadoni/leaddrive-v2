import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createHash, randomBytes } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..')
const paths=['scripts/workforce-baseline-schema-export.sql','scripts/workforce-baseline-schema-export.mjs',
  'scripts/workforce-baseline-schema-export.test.mjs','scripts/workforce-baseline-schema-export-postgres.test.mjs',
  '.github/workflows/workforce-baseline-schema-export.yml']
const hash=bytes=>createHash('sha256').update(bytes).digest('hex')
const bindings=()=>paths.map(path=>{const b=fs.readFileSync(resolve(root,path));return {path,bytes:b.length,sha256:hash(b)}})
const marker='PRIVATE_BASELINE_CANARY_94c251'

test('actual isolated baseline CLI refuses unsupported relation populations', {skip:!process.env.C12_BASELINE_TEST_DATABASE_URL}, async context=>{
  const receipt={status:'RUNNING',stage:'admission',sourceSha:process.env.C12_EXPECTED_HEAD_SHA,
    fixture:'SYNTHETIC_SELECTED_DDL_NOT_RESTORED_BASELINE',productionObserved:false,historicalReplay:false,
    cases:[],sourceBindings:[],failure:null,cleanup:[]}
  let privateDir
  try {
    assert.equal(process.env.GITHUB_ACTIONS,'true');assert.equal(process.env.CI,'true')
    assert.match(receipt.sourceSha,/^[a-f0-9]{40}$/)
    assert.equal(execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),receipt.sourceSha)
    const url=new URL(process.env.C12_BASELINE_TEST_DATABASE_URL)
    assert.equal(url.protocol,'postgresql:');assert.equal(url.hostname,'127.0.0.1')
    assert.equal(url.pathname,'/hrm_baseline_export_test');assert.equal(url.username,'postgres')
    assert.equal(url.search,'');assert.equal(url.hash,'')
    const env={PATH:'/usr/local/bin:/usr/bin:/bin',LC_ALL:'C',PGHOST:'127.0.0.1',PGPORT:url.port||'5432',
      PGDATABASE:'hrm_baseline_export_test',PGUSER:'postgres',PGPASSWORD:decodeURIComponent(url.password),
      PGPASSFILE:'/dev/null',PGCONNECT_TIMEOUT:'5'}
    const sql=text=>{
      try {return execFileSync('psql',['-X','-qAt','--no-password','-v','ON_ERROR_STOP=1','-v','VERBOSITY=sqlstate'],
        {input:text,encoding:'utf8',env,timeout:20000,maxBuffer:65536,stdio:['pipe','pipe','pipe']}).trim()}
      catch(failure){const error=new Error('C12_BASELINE_FIXTURE_QUERY_FAILED')
        const state=String(failure.stderr??'').match(/ERROR:\s+([A-Z0-9]{5})\b/)?.[1]
        error.sqlState=['2BP01','25006','42501','42601','42703','42704','42804','42883','42P01','55P03','57014'].includes(state)?state:null;throw error}
    }
    receipt.sourceBindings=bindings()
    assert.equal(sql("SELECT current_database()='hrm_baseline_export_test' AND (SELECT rolsuper FROM pg_roles WHERE rolname=current_user);"),'t')
    assert.equal(sql("SELECT count(*) FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind IN ('r','p','v','f');"),'0')
    privateDir=fs.mkdtempSync(resolve(tmpdir(),'c12-baseline-cli-'))
    fs.chmodSync(privateDir,0o700)
    const password=randomBytes(24).toString('hex'),role='wf_baseline_catalog_reader'
    sql(`CREATE ROLE ${role} LOGIN PASSWORD '${password}' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT;`)
    const servicePath=resolve(privateDir,'pg_service.conf')
    fs.writeFileSync(servicePath,`[c12_isolated]\nhost=127.0.0.1\nport=${env.PGPORT}\ndbname=hrm_baseline_export_test\nuser=${role}\npassword=${password}\nconnect_timeout=5\n`,{mode:0o600,flag:'wx'})
    const readerEnv={PATH:env.PATH,LC_ALL:'C',PGSERVICEFILE:servicePath,PGSERVICE:'c12_isolated',PGPASSFILE:'/dev/null'}
    const provenancePath=resolve(privateDir,'provenance.json')
    fs.writeFileSync(provenancePath,JSON.stringify({sourceKind:'ISOLATED_RESTORED_COPY',backupArtifactSha256:'a'.repeat(64),
      restoreReceiptSha256:'b'.repeat(64),sourceRevision:receipt.sourceSha,restoredAt:'2026-10-09T00:00:00Z'}),{mode:0o600,flag:'wx'})
    const migrationName=fs.readdirSync(resolve(root,'prisma/migrations'),{withFileTypes:true}).filter(x=>x.isDirectory()).map(x=>x.name).sort()[0]
    assert.match(migrationName,/^[a-zA-Z0-9_]+$/)
    const checksum=hash(fs.readFileSync(resolve(root,'prisma/migrations',migrationName,'migration.sql')))
    const apiColumns='id text PRIMARY KEY,"keyHash" text NOT NULL,"keyPrefix" text NOT NULL,"isActive" boolean NOT NULL DEFAULT true'
    const ledgerColumns='id text PRIMARY KEY,checksum text NOT NULL,finished_at timestamptz,migration_name text NOT NULL,logs text,rolled_back_at timestamptz,started_at timestamptz NOT NULL,applied_steps_count integer NOT NULL'
    const fillApi=table=>`INSERT INTO ${table} VALUES ('fixture-api','${marker}','${marker}',true);`
    const fillLedger=table=>`INSERT INTO ${table} VALUES ('fixture-migration','${checksum}',NULL,'${migrationName}','${marker}',NULL,'2026-10-09T00:00:00Z',0);`
    const reset=()=>sql(`DROP SCHEMA public CASCADE; DROP SCHEMA IF EXISTS private_fixture CASCADE; CREATE SCHEMA public; CREATE SCHEMA private_fixture;
      CREATE TABLE public.api_keys (${apiColumns}); CREATE TABLE public._prisma_migrations (${ledgerColumns});
      ${fillApi('public.api_keys')}${fillLedger('public._prisma_migrations')}`)
    const grant=()=>sql(`GRANT USAGE ON SCHEMA public TO ${role}; GRANT SELECT ON public._prisma_migrations TO ${role};`)
    const snapshotFacts=()=>({
      api:sql("SELECT to_regclass('public.api_keys') IS NOT NULL;")==='t'
        ?sql("SELECT md5(COALESCE(string_agg(row_to_json(t)::text,'' ORDER BY id),'')) FROM public.api_keys t;"):null,
      ledger:sql("SELECT md5(COALESCE(string_agg(row_to_json(t)::text,'' ORDER BY id),'')) FROM public._prisma_migrations t;"),
    })
    let caseNumber=0
    const cases=[
      ['ordinary schema private output',()=>{},'PARTIAL_SCHEMA_EVIDENCE'],
      ['api_keys absent',()=>sql('DROP TABLE public.api_keys'),'API_KEYS_ABSENT'],
      ['api_keys parent with descendant',()=>sql(`CREATE TABLE private_fixture.api_child () INHERITS(public.api_keys);`),null],
      ['api_keys inheriting child',()=>sql(`CREATE TABLE private_fixture.api_parent (${apiColumns}); ALTER TABLE public.api_keys INHERIT private_fixture.api_parent`),null],
      ['ledger parent with descendant',()=>sql(`CREATE TABLE private_fixture.ledger_child () INHERITS(public._prisma_migrations); ${fillLedger('private_fixture.ledger_child')}`),null],
      ['ledger inheriting child',()=>sql(`CREATE TABLE private_fixture.ledger_parent (${ledgerColumns}); ALTER TABLE public._prisma_migrations INHERIT private_fixture.ledger_parent`),null],
      ['api_keys partition leaf',()=>sql(`DROP TABLE public.api_keys; CREATE TABLE private_fixture.api_root (${apiColumns}) PARTITION BY HASH(id); CREATE TABLE public.api_keys PARTITION OF private_fixture.api_root FOR VALUES WITH(MODULUS 1,REMAINDER 0); ${fillApi('public.api_keys')}`),null],
      ['ledger partition leaf',()=>sql(`DROP TABLE public._prisma_migrations; CREATE TABLE private_fixture.ledger_root (${ledgerColumns}) PARTITION BY HASH(id); CREATE TABLE public._prisma_migrations PARTITION OF private_fixture.ledger_root FOR VALUES WITH(MODULUS 1,REMAINDER 0); ${fillLedger('public._prisma_migrations')}`),null],
      ['api_keys partition root',()=>sql(`DROP TABLE public.api_keys; CREATE TABLE public.api_keys (${apiColumns}) PARTITION BY HASH(id);`),null],
      ['ledger partition root',()=>sql(`DROP TABLE public._prisma_migrations; CREATE TABLE public._prisma_migrations (${ledgerColumns}) PARTITION BY HASH(id);`),null],
      ['filtered ledger',()=>sql('ALTER TABLE public._prisma_migrations ENABLE ROW LEVEL SECURITY; ALTER TABLE public._prisma_migrations FORCE ROW LEVEL SECURITY; CREATE POLICY narrowed_fixture ON public._prisma_migrations USING(false)'),null],
    ]
    for(const [name,setup,expected] of cases){
      receipt.stage=name
      await context.test(name,()=>{
        try{
          reset();setup();grant()
          const before=snapshotFacts(),outputPath=resolve(privateDir,`result-${++caseNumber}.json`)
          const result=spawnSync(process.execPath,[resolve(root,'scripts/workforce-baseline-schema-export.mjs'),provenancePath,outputPath,root],
            {cwd:root,env:readerEnv,encoding:'utf8',timeout:35000,maxBuffer:4096})
          const outputCreated=fs.existsSync(outputPath),after=snapshotFacts()
          assert.deepEqual(before,after)
          const observed=result.status===0&&outputCreated?'OUTPUT_CREATED':'REFUSED'
          receipt.cases.push({name,status:'RUNNING',cliExit:result.status,outputCreated,observed,ledgerFingerprintUnchanged:true,
            ledgerFingerprintBefore:before,ledgerFingerprintAfter:after})
          const entry=receipt.cases.at(-1)
          if(expected){
            assert.equal(result.status,0);assert.equal(result.stderr,'');assert.equal(outputCreated,true)
            const bytes=fs.readFileSync(outputPath),value=JSON.parse(bytes)
            assert.equal(value.status,expected);assert.equal(value.completeness.executableBaseline,false)
            assert.equal(value.provenanceVerification,'OPERATOR_SUPPLIED_NOT_VERIFIED')
            assert.equal(fs.statSync(outputPath).mode&0o777,0o600)
            assert.doesNotMatch(bytes.toString(),new RegExp(marker))
            if(expected==='PARTIAL_SCHEMA_EVIDENCE'){
              const principal=execFileSync('psql',['-X','-qAt','--no-password','-v','ON_ERROR_STOP=1'],{input:"SELECT current_user=session_user AND NOT rolsuper AND NOT rolbypassrls AND NOT has_table_privilege(current_user,'public.api_keys','SELECT') AND has_table_privilege(current_user,'public._prisma_migrations','SELECT') FROM pg_roles WHERE rolname=current_user;",env:readerEnv,encoding:'utf8',timeout:10000,stdio:['pipe','pipe','pipe']}).trim()
              assert.equal(principal,'t');entry.nonsuperLedgerOnlyService=true
            }
            const again=spawnSync(process.execPath,[resolve(root,'scripts/workforce-baseline-schema-export.mjs'),provenancePath,outputPath,root],{cwd:root,env:readerEnv,encoding:'utf8',timeout:35000,maxBuffer:4096})
            assert.equal(again.status,1);assert.equal(again.stdout,'');assert.equal(again.stderr.trim(),'WORKFORCE_BASELINE_EXPORT_REFUSED')
            assert.deepEqual(fs.readFileSync(outputPath),bytes)
            entry.exclusiveOutputAnd0600=true;entry.canaryAbsent=true
          }else{
            assert.equal(result.status,1,'unsupported relation layout must refuse')
            assert.equal(result.stdout,'');assert.equal(result.stderr.trim(),'WORKFORCE_BASELINE_EXPORT_REFUSED')
            assert.equal(outputCreated,false)
          }
          entry.status='PASS'
        }catch(error){const entry=receipt.cases.at(-1)
          if(entry?.name===name&&entry.status==='RUNNING')entry.status='FAIL'
          else receipt.cases.push({name,status:'FAIL',code:'FIXTURE_OR_ASSERTION_FAILED',sqlState:error.sqlState??null})
          throw error}
      })
    }
    assert.equal(sql(`SELECT NOT rolsuper AND NOT rolbypassrls AND NOT has_table_privilege('${role}','public.api_keys','SELECT') FROM pg_roles WHERE rolname='${role}';`),'t')
    assert.deepEqual(bindings(),receipt.sourceBindings)
    assert.equal(receipt.cases.length,cases.length);assert.ok(receipt.cases.every(c=>c.status==='PASS'))
    receipt.status='PASS_ISOLATED_BASELINE_EXPORT_ADMISSION_ONLY'
  }catch(error){receipt.status='FAIL';receipt.failure={code:error.message==='C12_BASELINE_FIXTURE_QUERY_FAILED'?error.message:'ASSERTION_FAILED',sqlState:error.sqlState??null};throw error}
  finally{
    if(privateDir){fs.rmSync(privateDir,{recursive:true,force:true});receipt.cleanup.push({action:'owned-private-fixture-directory',status:'PASS'})}
    if(process.env.C12_BASELINE_RECEIPT)fs.writeFileSync(process.env.C12_BASELINE_RECEIPT,JSON.stringify(receipt,null,2)+'\n',{mode:0o600,flag:'wx'})
  }
})
