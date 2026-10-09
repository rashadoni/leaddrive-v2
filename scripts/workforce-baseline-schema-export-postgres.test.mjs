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
  let cleanupSql,ownsPrivateSchema=false,ownsReaderRole=false,originalFailure
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
    const sql=(text,queryEnv=env)=>{
      try {return execFileSync('psql',['-X','-qAt','--no-password','-v','ON_ERROR_STOP=1','-v','VERBOSITY=sqlstate'],
        {input:text,encoding:'utf8',env:queryEnv,timeout:20000,maxBuffer:65536,stdio:['pipe','pipe','pipe']}).trim()}
      catch(failure){const error=new Error('C12_BASELINE_FIXTURE_QUERY_FAILED')
        const state=String(failure.stderr??'').match(/ERROR:\s+([A-Z0-9]{5})\b/)?.[1]
        error.sqlState=['2BP01','25006','42501','42601','42703','42704','42804','42883','42P01','55P03','57014'].includes(state)?state:null;throw error}
    }
    cleanupSql=sql
    receipt.sourceBindings=bindings()
    assert.equal(sql("SELECT current_database()='hrm_baseline_export_test' AND (SELECT rolsuper FROM pg_roles WHERE rolname=current_user);"),'t')
    // Require a fresh owned service, including non-table namespace objects.
    // Never reset a pre-existing namespace or role just to make a fixture fit.
    assert.equal(sql(`SELECT to_regnamespace('private_fixture') IS NULL
      AND NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='wf_baseline_catalog_reader')
      AND NOT EXISTS (SELECT 1 FROM pg_depend
        WHERE refclassid='pg_namespace'::regclass AND refobjid='public'::regnamespace)
      AND NOT EXISTS (SELECT 1 FROM pg_class WHERE relnamespace='public'::regnamespace)
      AND NOT EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace='public'::regnamespace)
      AND NOT EXISTS (SELECT 1 FROM pg_type WHERE typnamespace='public'::regnamespace);`),'t')
    receipt.admission={freshPublicNamespace:true,privateNamespaceAbsent:true,readerRoleAbsent:true}
    privateDir=fs.mkdtempSync(resolve(tmpdir(),'c12-baseline-cli-'))
    fs.chmodSync(privateDir,0o700)
    const password=randomBytes(24).toString('hex'),role='wf_baseline_catalog_reader'
    sql('CREATE SCHEMA private_fixture;');ownsPrivateSchema=true
    sql(`CREATE ROLE ${role} LOGIN PASSWORD '${password}' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT;`)
    ownsReaderRole=true
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
    const reset=()=>sql(`DROP SCHEMA private_fixture CASCADE; CREATE SCHEMA private_fixture;
      DROP TABLE IF EXISTS public.api_keys,public._prisma_migrations CASCADE;
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
              const principal=sql("SELECT current_user='wf_baseline_catalog_reader' AND current_user=session_user AND NOT rolsuper AND NOT rolbypassrls AND NOT has_table_privilege(current_user,'public.api_keys','SELECT') AND has_table_privilege(current_user,'public._prisma_migrations','SELECT') FROM pg_roles WHERE rolname=current_user;",readerEnv)
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
  }catch(error){originalFailure=error;receipt.status='FAIL';receipt.failure={code:error.message==='C12_BASELINE_FIXTURE_QUERY_FAILED'?error.message:'ASSERTION_FAILED',sqlState:error.sqlState??null}}
  finally{
    const cleanup=(action,fn)=>{
      try{fn();receipt.cleanup.push({action,status:'PASS'})}
      catch(error){receipt.status='FAIL';receipt.cleanup.push({action,status:'FAIL',code:'OWNED_FIXTURE_CLEANUP_FAILED',sqlState:error.sqlState??null})
        if(!originalFailure)originalFailure=new Error('C12_BASELINE_OWNED_FIXTURE_CLEANUP_FAILED')}
    }
    if(ownsPrivateSchema)cleanup('owned-schema-and-tables',()=>cleanupSql('DROP SCHEMA IF EXISTS private_fixture CASCADE; DROP TABLE IF EXISTS public.api_keys,public._prisma_migrations CASCADE;'))
    if(ownsReaderRole)cleanup('owned-reader-role',()=>cleanupSql('REVOKE ALL ON SCHEMA public FROM wf_baseline_catalog_reader; DROP ROLE wf_baseline_catalog_reader;'))
    if(privateDir)cleanup('owned-private-fixture-directory',()=>fs.rmSync(privateDir,{recursive:true,force:true}))
    if(process.env.C12_BASELINE_RECEIPT){
      try{fs.writeFileSync(process.env.C12_BASELINE_RECEIPT,JSON.stringify(receipt,null,2)+'\n',{mode:0o600,flag:'wx'})}
      catch{if(!originalFailure)originalFailure=new Error('C12_BASELINE_RECEIPT_WRITE_FAILED')}
    }
  }
  if(originalFailure)throw originalFailure
})
