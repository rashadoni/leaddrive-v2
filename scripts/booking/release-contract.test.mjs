import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseManifest, parseState, admitCandidate, admitRollback, emitAdmission, databaseStateScript, bookingSchemaHash, activationSql, releaseProof, parseLineage, releasedSchemaLineage, compatibleSchemaHashes, additiveMigration } from './release-contract.mjs';

const sha = 'a'.repeat(40), hash = 'b'.repeat(64);
const manifest = (phase='compatibility') => ({version:1,contract:'booking-canonical-writer/v1',artifactSha:sha,schemaHash:hash,phase});
const state = (overrides={}) => ({expanded:false,canonicalCount:0,enforced:false,readOnly:true,rlsUnfiltered:true,...overrides});
const entry = (schemaHash,migration,bookingAdditive) => ({schemaHash,migration,bookingAdditive,note:'fixture'});

test('a historical artifact is distinct from a malformed or revision-mismatched contract', () => {
  assert.equal(parseManifest('',sha),null);
  assert.deepEqual(parseManifest(JSON.stringify(manifest()),sha),manifest());
  for (const value of [null,[],{}, {...manifest(),artifactSha:'c'.repeat(40)}, {...manifest(),phase:'enabled'},
    {...manifest(),schemaHash:'x'}, {...manifest(),extra:'unexpected'}, {...manifest(),version:2}]) {
    assert.throws(()=>parseManifest(JSON.stringify(value),sha));
  }
  assert.throws(()=>parseManifest('x'.repeat(1025),sha));
  assert.throws(()=>parseManifest('',"'$(unsafe)"));
});

test('release state must be bounded, unfiltered and actually read-only', () => {
  assert.deepEqual(parseState(JSON.stringify(state())),state());
  for (const overrides of [{readOnly:false},{rlsUnfiltered:false},{canonicalCount:1},
    {enforced:true},{canonicalCount:-1},{canonicalCount:0.2},{expanded:'true'}, {extra:1}]) {
    assert.throws(()=>parseState(JSON.stringify(state(overrides))));
  }
});

test('first expansion preserves the original writer; UI activation requires a compatible predecessor', () => {
  assert.deepEqual(admitCandidate(state(),manifest(),null),{firstExpansion:true});
  assert.deepEqual(admitCandidate(state({expanded:true}),manifest(),null),{firstExpansion:true});
  assert.deepEqual(admitCandidate(state({expanded:true,canonicalCount:1}),manifest(),null),{firstExpansion:false});
  assert.doesNotThrow(()=>admitCandidate(state(),null,null));
  assert.throws(()=>admitCandidate(state(),manifest('workspace'),null));
  assert.throws(()=>admitCandidate(state({expanded:true}),manifest('workspace'),null));
  assert.throws(()=>admitCandidate(state({expanded:true}),manifest('workspace'),{...manifest(),schemaHash:'c'.repeat(64)}));
  assert.doesNotThrow(()=>admitCandidate(state({expanded:true,canonicalCount:2}),manifest('workspace'),manifest()));
});

test('external recovery can never restore a legacy writer after expansion, even before the first canonical row', () => {
  for (const count of [0,1,100]) {
    assert.throws(()=>admitCandidate(state({expanded:true,canonicalCount:count}),null,manifest()));
  }
  // A is the supported recovery target even when the live app is already broken.
  assert.doesNotThrow(()=>admitCandidate(state({expanded:true,canonicalCount:2,enforced:true}),manifest(),null));
});

test('internal rollback to legacy requires first-expansion identity, a drained process and no canonical writes', () => {
  const expanded = state({expanded:true});
  assert.doesNotThrow(()=>admitRollback(expanded,null,manifest(),true,true));
  assert.doesNotThrow(()=>admitRollback(state(),null,manifest(),false,false));
  for (const [s,candidate,first,quiesced] of [
    [expanded,manifest(),false,true], [expanded,manifest(),true,false],
    [state({expanded:true,canonicalCount:1}),manifest(),true,true],
    [state({expanded:true,enforced:true}),manifest(),true,true],
    [expanded,manifest('workspace'),true,true], [expanded,null,true,true]
  ]) assert.throws(()=>admitRollback(s,null,candidate,first,quiesced));
});

test('backend A remains a writable rollback target after strict B without rolling back data', () => {
  const strict = state({expanded:true,canonicalCount:2,enforced:true});
  assert.doesNotThrow(()=>admitRollback(strict,manifest(),manifest('workspace'),false,true));
  assert.throws(()=>admitRollback(strict,{...manifest(),schemaHash:'c'.repeat(64)},manifest('workspace'),false,true));
  assert.throws(()=>admitRollback(state(),manifest(),manifest(),false,true));
});

test('only an artifact-bound workspace release can generate a monotonic activation', () => {
  assert.equal(activationSql(manifest()),'');
  const sql = activationSql(manifest('workspace'));
  assert.match(sql,new RegExp(sha));
  assert.match(sql,/WHERE id=1 AND NOT enforced/);
  assert.doesNotMatch(sql,/enforced=false/);
  assert.throws(()=>activationSql({...manifest('workspace'),artifactSha:"';unsafe"}));
});

test('post-deploy proof binds the actual artifact, storage and active mode without changing customer data', () => {
  const expanded = state({expanded:true});
  assert.equal(releaseProof(expanded,manifest(),manifest(),sha).status,'PASS_BOOKING_RELEASE');
  assert.throws(()=>releaseProof(expanded,manifest('workspace'),manifest('workspace'),sha));
  assert.equal(releaseProof(state({expanded:true,enforced:true}),manifest('workspace'),manifest('workspace'),sha).phase,'workspace');
  assert.throws(()=>releaseProof(expanded,manifest(),{...manifest(),artifactSha:'c'.repeat(40)},sha));
  assert.throws(()=>releaseProof(state(),manifest(),manifest(),sha));
});

test('a forward booking schema is admissible only where the lineage proves the previous artifact can still serve', () => {
  const strict = state({expanded:true,canonicalCount:2,enforced:true});
  const next = 'd'.repeat(64), unlisted = 'e'.repeat(64);
  const candidate = {...manifest('workspace'),schemaHash:next}, live = manifest('workspace');
  const compatible = [next,hash];
  assert.doesNotThrow(()=>admitCandidate(strict,candidate,live,compatible));
  // The automatic rollback keeps its target: that is what the equal-hash rule
  // used to take away from any booking schema change.
  assert.doesNotThrow(()=>admitRollback(strict,live,candidate,false,true,compatible));
  // No list, a list that forgot the candidate, or one that forgot the running
  // artifact: equality is demanded again, so a stale list never widens anything.
  for (const list of [undefined,[],[hash],[next,unlisted]]) {
    assert.throws(()=>admitCandidate(strict,candidate,live,list));
    assert.throws(()=>admitRollback(strict,live,candidate,false,true,list));
  }
  const stranger = {...manifest('workspace'),schemaHash:unlisted};
  assert.throws(()=>admitCandidate(strict,candidate,stranger,compatible));
  assert.throws(()=>admitRollback(strict,stranger,candidate,false,true,compatible));
  // The cutover it was written for is untouched: the expanded schema, a real
  // predecessor and a candidate are all still required.
  assert.throws(()=>admitCandidate(state(),candidate,live,compatible));
  assert.throws(()=>admitCandidate(strict,candidate,null,compatible));
  assert.throws(()=>admitCandidate(strict,null,live,compatible));
  assert.throws(()=>admitRollback(state(),live,candidate,false,true,compatible));
  assert.throws(()=>admitRollback(strict,live,null,false,true,compatible));
});

test('the committed lineage names the released booking schema and walks back only through additive steps', () => {
  const lineage = releasedSchemaLineage();
  assert.equal(lineage[lineage.length-1].schemaHash,bookingSchemaHash(readFileSync('prisma/schema.prisma','utf8')));
  assert.equal(lineage[0].migration,null);
  for (const release of lineage.slice(1)) {
    const sql = readFileSync(`prisma/migrations/${release.migration}/migration.sql`,'utf8');
    // Declaring a step non-additive is always allowed; claiming it must be proven.
    if (release.bookingAdditive) assert.equal(additiveMigration(sql),true,`${release.migration} claims bookingAdditive`);
  }
  const [a,b,c] = ['1','2','3'].map(character=>character.repeat(64));
  assert.deepEqual(compatibleSchemaHashes([entry(a,null,false)]),[a]);
  assert.deepEqual(compatibleSchemaHashes([entry(a,null,false),entry(b,'20260101000000_one',true)]),[b,a]);
  assert.deepEqual(compatibleSchemaHashes([entry(a,null,false),entry(b,'20260101000000_one',false)]),[b]);
  assert.deepEqual(compatibleSchemaHashes([entry(a,null,false),entry(b,'20260101000000_one',false),
    entry(c,'20260101000001_two',true)]),[c,b]);
  const many = Array.from({length:12},(ignored,index)=>entry(String(index).padStart(64,'a'),
    index?`2026010100000${index%10}_step`:null,Boolean(index)));
  assert.equal(compatibleSchemaHashes(many).length,8);
  for (const releases of [[],[{...entry(a,null,false),extra:1}],[entry(a,'20260101000000_one',false)],
    [entry(a,null,true)],[entry(a,null,false),entry(a,'20260101000000_one',true)],
    [entry(a,null,false),entry(b,'Not A Migration',true)],[entry('short',null,false)],
    [{...entry(a,null,false),note:''}],[{...entry(a,null,false),bookingAdditive:'false'}]]) {
    assert.throws(()=>parseLineage(JSON.stringify({version:1,releases})),/INVALID_BOOKING_SCHEMA_LINEAGE/);
  }
  assert.throws(()=>parseLineage(JSON.stringify({version:2,releases:[entry(a,null,false)]})));
  assert.throws(()=>parseLineage(JSON.stringify({version:1,releases:{}})));
});

test('the migration classifier answers no to every statement it has not reviewed', () => {
  for (const sql of [
    'ALTER TABLE "booking_pages" ADD COLUMN "price" DECIMAL(14, 2);',
    'ALTER TABLE "booking_pages" ADD COLUMN "a" TEXT, ADD COLUMN "b" INTEGER;',
    `ALTER TABLE "booking_pages" ADD COLUMN "a" TEXT NOT NULL DEFAULT 'x';`,
    'ALTER TABLE IF EXISTS "bookings" ADD COLUMN IF NOT EXISTS "a" TEXT;',
    'CREATE INDEX "i" ON "booking_pages"("category");',
    `-- a comment\nSET lock_timeout = '3s';\nALTER TABLE "bookings" ADD COLUMN "a" TEXT;`,
  ]) assert.equal(additiveMigration(sql),true,sql);
  for (const sql of ['','-- nothing but a comment',
    'ALTER TABLE "booking_pages" ADD COLUMN "a" TEXT NOT NULL;',
    'ALTER TABLE "booking_pages" DROP COLUMN "price";',
    'ALTER TABLE "booking_pages" RENAME COLUMN "price" TO "cost";',
    'ALTER TABLE "booking_pages" ALTER COLUMN "price" TYPE TEXT;',
    'ALTER TABLE "booking_pages" ADD COLUMN "a" TEXT, DROP COLUMN "b";',
    'ALTER TABLE "booking_pages" ADD CONSTRAINT "c" CHECK (price > 0);',
    'ALTER TABLE "bookings" ADD COLUMN "o" TEXT REFERENCES "orgs"("id");',
    'ALTER TABLE "bookings" ADD COLUMN "v" INTEGER GENERATED ALWAYS AS IDENTITY;',
    'CREATE UNIQUE INDEX "i" ON "booking_pages"("category");',
    'DROP TABLE "booking_pages";','TRUNCATE "bookings";','UPDATE "bookings" SET version = 0;',
    'DO $$ BEGIN ALTER TABLE "bookings" ADD COLUMN "x" TEXT; END $$;',
    'ALTER TABLE "booking_pages" ADD COLUMN "a" TEXT; DROP TABLE "bookings";',
  ]) assert.equal(additiveMigration(sql),false,sql);
});

test('the build refuses a booking schema change the lineage does not record', () => {
  const root = mkdtempSync(path.join(tmpdir(),'booking-lineage-'));
  try {
    const script = new URL('./release-contract.mjs',import.meta.url).pathname;
    const marker = path.join(root,'.booking-backend-contract.json');
    const schema = readFileSync('prisma/schema.prisma','utf8');
    mkdirSync(path.join(root,'prisma'),{recursive:true});
    mkdirSync(path.join(root,'src/lib/booking'),{recursive:true});
    writeFileSync(path.join(root,'src/lib/booking/release-phase.json'),readFileSync('src/lib/booking/release-phase.json'));
    writeFileSync(path.join(root,'prisma/schema.prisma'),schema);
    assert.equal(spawnSync(process.execPath,[script,'--write-manifest',root,sha],{cwd:root}).status,0);
    rmSync(marker);
    writeFileSync(path.join(root,'prisma/schema.prisma'),schema.replace('model Booking {','model Booking {\n unrecorded String?'));
    const stale = spawnSync(process.execPath,[script,'--write-manifest',root,sha],{cwd:root,encoding:'utf8'});
    assert.equal(stale.status,1,'an unrecorded booking schema must not produce an artifact marker');
    assert.match(stale.stderr,/BOOKING_RELEASE_CONTRACT_BLOCKED/);
    assert.equal(existsSync(marker),false);
  } finally { rmSync(root,{recursive:true,force:true}); }
});

test('the booking schema contract does not freeze unrelated application schema releases', () => {
  const schema = readFileSync('prisma/schema.prisma','utf8');
  assert.equal(bookingSchemaHash(schema),bookingSchemaHash(schema+'\nmodel UnrelatedFixture {\n id String @id\n}\n'));
  assert.notEqual(bookingSchemaHash(schema),bookingSchemaHash(schema.replace('model Booking {','model Booking {\n fixture String?')));
});

function deployFunction(name) {
  const source = readFileSync('scripts/server-deploy.sh','utf8');
  const start = source.indexOf(name+'() {');
  assert.ok(start>=0);
  const end = source.indexOf('\n}',start);
  return source.slice(start,end+2);
}

test('actual restore controller drains before proof and preserves candidate bytes on a rejected rollback', () => {
  for (const accepted of [false,true]) {
    const root = mkdtempSync(path.join(tmpdir(),'booking-restore-controller-'));
    try {
      const app = path.join(root,'app'); const backup = path.join(root,'backup');
      mkdirSync(path.join(app,'.next/standalone'),{recursive:true});
      mkdirSync(path.join(backup,'standalone'),{recursive:true});
      writeFileSync(path.join(app,'.next/standalone/identity'),'candidate');
      writeFileSync(path.join(backup,'standalone/identity'),'previous');
      const trace = path.join(root,'trace');
      // Paths originate only from owned mkdtemp, never caller input.
      const shell = `set -euo pipefail
APP_DIR='${app}'
BACKUP_PATH='${backup}'
IDENTITY_RELEASE_CONTROLLER=""
IDENTITY_RELEASE_AUTO_RECOVERY_BLOCKED=false
BOOKING_RELEASE_CONTROLLER=reviewed-controller
BOOKING_RELEASE_CANDIDATE_FILE=reviewed-candidate
BOOKING_RELEASE_FIRST_EXPANSION=true
BOOKING_RELEASE_AUTO_RECOVERY_BLOCKED=false
MIGRATION_ENV_FILE=synthetic-fixture-env
load_dotenv_file() { MIGRATION_DATABASE_URL=synthetic-fixture-only; MIGRATION_EXPECTED_DB_ROLE=fixture-role; }
require_env() { test -n "\${!1:-}"; }
EXPECTED_DEPLOY_SHA_ARG='${sha}'
HANDOFF_STARTED=true
STANDALONE_REPLACED=true
log() { :; }
persist_event_platform_pm2_stop_fence() { printf 'stop\\n' >> '${trace}'; }
node() { printf 'check:%s\\n' "$*" >> '${trace}'; return ${accepted?0:1}; }
safe_remove_tree() { rm -rf -- "$1"; }
${deployFunction('with_booking_release_database')}
${deployFunction('ensure_identity_rollback_compatible')}
${deployFunction('ensure_booking_rollback_compatible')}
${deployFunction('restore_standalone_before_pm2')}
if restore_standalone_before_pm2; then printf 'accepted'; else printf 'blocked'; fi
printf ':%s' "$BOOKING_RELEASE_AUTO_RECOVERY_BLOCKED"
`;
      const result = spawnSync('bash',['-s'],{input:shell,encoding:'utf8'});
      assert.equal(result.status,0);
      assert.equal(result.stdout,accepted?'accepted:false':'blocked:true');
      assert.equal(readFileSync(path.join(app,'.next/standalone/identity'),'utf8'),accepted?'previous':'candidate');
      const lines = readFileSync(trace,'utf8').trim().split('\n');
      assert.equal(lines[0],'stop');
      assert.match(lines[1],/--check-rollback .* true true$/);
    } finally { rmSync(root,{recursive:true,force:true}); }
  }
});

test('the production controller is staged with every file the contract reads beside it', () => {
  // The controller runs on production from a copy staged out of the artifact by
  // an explicit file list. A file read through import.meta.url but left out of
  // that list fails closed on production and nowhere earlier — which is how the
  // lineage was missed on the first release that needed it.
  const contract = readFileSync('scripts/booking/release-contract.mjs','utf8');
  const needed = [...contract.matchAll(/new URL\('\.\/([^']+)', import\.meta\.url\)/g)].map(match=>match[1]);
  assert.ok(needed.includes('schema-lineage.json'),'the lineage is read beside the controller');
  assert.ok(needed.includes('release-state.sql'));
  const deploy = readFileSync('scripts/server-deploy.sh','utf8');
  const staged = deploy.slice(deploy.indexOf('for booking_control_file in'));
  const list = staged.slice(0,staged.indexOf('; do'));
  for (const file of needed) assert.ok(list.includes(`scripts/booking/${file}`),`${file} must be staged with the controller`);
});

test('actual booking deploy commands reload credentials after unset without leaking to app children', () => {
  const source = readFileSync('scripts/server-deploy.sh','utf8');
  for (const command of ['--check-admission','--check-rollback','--assert-activated']) {
    const line = source.slice(0,source.indexOf(command)).split('\n').slice(-3).join('\n');
    assert.match(line,/with_booking_release_database node/);
  }
  assert.match(source,/with_booking_release_database npx prisma db execute/);
  const shell = `set -euo pipefail
MIGRATION_ENV_FILE=synthetic-fixture-env
DATABASE_URL=application-fixture
load_dotenv_file() {
  [ "$1" = "$MIGRATION_ENV_FILE" ] && [ "$2" = migration ] || return 1
  MIGRATION_DATABASE_URL=synthetic-fixture-only
  MIGRATION_EXPECTED_DB_ROLE=fixture-role
}
require_env() { test -n "\${!1:-}"; }
node() { [ "$BOOKING_RELEASE_DB_URL" = synthetic-fixture-only ] && [ "$DATABASE_URL" = synthetic-fixture-only ]; }
npx() { node; }
${deployFunction('with_booking_release_database')}
unset MIGRATION_DATABASE_URL MIGRATION_EXPECTED_DB_ROLE
with_booking_release_database node reviewed-controller --check-admission
with_booking_release_database npx prisma db execute
with_booking_release_database node reviewed-controller --assert-activated
with_booking_release_database node reviewed-controller --check-rollback
[ -z "\${MIGRATION_DATABASE_URL+x}" ] && [ -z "\${MIGRATION_EXPECTED_DB_ROLE+x}" ]
[ -z "\${BOOKING_RELEASE_DB_URL+x}" ] && [ "$DATABASE_URL" = application-fixture ]
load_dotenv_file() { return 7; }
if with_booking_release_database node; then exit 81; fi
load_dotenv_file() { :; }
if with_booking_release_database node; then exit 82; fi
printf 'isolated'
`;
  const result = spawnSync('bash',['-s'],{input:shell,encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  assert.equal(result.stdout,'isolated');
});

test('recovery runs current-main admission before any historical artifact is copied to production', () => {
  const workflow = readFileSync('.github/workflows/deploy.yml','utf8');
  const recovery = workflow.slice(workflow.indexOf('  recovery:'));
  assert.ok(recovery.indexOf('Preserve current-main booking admission') < recovery.indexOf('Checkout deployment script from the recovered revision'));
  assert.ok(recovery.indexOf('Admit retained booking backend with current-main code') < recovery.indexOf('Stage exact retained recovery artifact on production disk'));
  assert.match(recovery,/node "\$RUNNER_TEMP\/booking-current-main-admission\/scripts\/booking\/release-contract.mjs"/);
  // The preserved admission decides compatibility from the lineage, so it has
  // to travel with the code: without the file it cannot admit anything at all.
  assert.match(workflow,/scripts\/booking\/schema-lineage.json "\$admission\/scripts\/booking\/"/);
  assert.match(workflow,/cp -r scripts\/booking\/\. \.next\/standalone\/scripts\/booking\//);
  assert.match(workflow,/artifact="\/tmp\/leaddrive-deploy-artifact\/leaddrive-prod-\$\{DEPLOY_TARGET_SHA\}\.tar.gz"/);
});

test('emitted current-main admission and state scripts parse and never load historical code', () => {
  const emitted = emitAdmission(sha,JSON.stringify(manifest('workspace')));
  assert.equal(spawnSync('bash',['-n'],{input:emitted}).status,0);
  assert.equal(spawnSync('bash',['-n'],{input:databaseStateScript()}).status,0);
  const proof = emitAdmission(sha,JSON.stringify(manifest('workspace')),true);
  assert.equal(spawnSync('bash',['-n'],{input:proof}).status,0);
  const proofJs = proof.split("node <<'BOOKING_ADMISSION_JS'\n")[1].split('\nBOOKING_ADMISSION_JS')[0];
  assert.equal(spawnSync(process.execPath,['--check'],{input:proofJs}).status,0);

  assert.match(emitted,/PRE_CANONICAL_RECOVERY_FORBIDDEN/);
  assert.match(emitted,/default_transaction_read_only=on/);
  assert.doesNotMatch(emitted,/require\([^\n]*node_modules/);
  const js = emitted.split("node <<'BOOKING_ADMISSION_JS'\n")[1].split('\nBOOKING_ADMISSION_JS')[0];
  assert.equal(spawnSync(process.execPath,['--check'],{input:js}).status,0);
});

test('build stamps the actual revision and phase; marker overwrite and invalid CLI fail closed', () => {
  const directory = mkdtempSync(path.join(tmpdir(),'booking-contract-'));
  try {
    const script = new URL('./release-contract.mjs',import.meta.url).pathname;
    const result = spawnSync(process.execPath,[script,'--write-manifest',directory,sha],{encoding:'utf8'});
    assert.equal(result.status,0);
    const actual = parseManifest(readFileSync(path.join(directory,'.booking-backend-contract.json'),'utf8'),sha);
    assert.equal(actual.phase,JSON.parse(readFileSync('src/lib/booking/release-phase.json','utf8')).mode);
    assert.equal(actual.schemaHash.length,64);
    assert.equal(spawnSync(process.execPath,[script,'--write-manifest',directory,sha]).status,1);
    writeFileSync(path.join(directory,'private.txt'),'DO_NOT_ECHO');
    const invalid = spawnSync(process.execPath,[script,'--unknown',path.join(directory,'private.txt')],{encoding:'utf8'});
    assert.equal(invalid.status,1);
    assert.doesNotMatch(invalid.stderr+invalid.stdout,/DO_NOT_ECHO/);
  } finally { rmSync(directory,{recursive:true,force:true}); }
});

const postgres = process.env.BOOKING_RELEASE_TEST_DATABASE_URL;
test('actual read-only release-state SQL handles old schema, draining, expansion and strict activation', {skip:!postgres}, async () => {
  const parsed = new URL(postgres);
  assert.ok(['127.0.0.1','localhost'].includes(parsed.hostname));
  assert.equal(parsed.search,'');
  const database = `booking_release_contract_${process.pid}`;
  const webRole = `booking_release_web_${process.pid}`;
  const env = Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('PG')));
  Object.assign(env,{PGHOST:parsed.hostname,PGPORT:parsed.port||'5432',PGUSER:decodeURIComponent(parsed.username),
    PGPASSWORD:decodeURIComponent(parsed.password),PGDATABASE:decodeURIComponent(parsed.pathname.slice(1))});
  const sql = (input,db=database)=>spawnSync('psql',['-X','-qAt','-v','ON_ERROR_STOP=1'],
    {input,encoding:'utf8',env:{...env,PGDATABASE:db},timeout:15000});
  assert.equal(sql(`CREATE DATABASE ${database}`,env.PGDATABASE).status,0);
  const scratch = new URL(parsed); scratch.pathname='/'+database;
  const inspect = () => {
    const result = spawnSync('bash',['-s'],{input:databaseStateScript(),encoding:'utf8',timeout:50000,
      env:{...env,BOOKING_RELEASE_DB_URL:scratch.toString()}});
    assert.equal(result.status,0,'real read-only inspector must succeed');
    return parseState(result.stdout.trim());
  };
  let held, heldExit;
  const rollbackFixture = mkdtempSync(path.join(tmpdir(),'booking-late-commit-'));
  try {
    assert.deepEqual(inspect(),state());
    const migration = readFileSync('prisma/migrations/20261102100000_booking_commands/migration.sql','utf8');
    const stateDdl = migration.split('-- BEGIN BOOKING RELEASE STATE')[1].split('-- END BOOKING RELEASE STATE')[0];
    assert.equal(sql('CREATE TABLE bookings(id text,version integer NOT NULL DEFAULT 0); CREATE TABLE tasks(id text);'+stateDdl).status,0);
    assert.deepEqual(inspect(),state({expanded:true}));
    assert.throws(()=>admitCandidate(inspect(),null,manifest()));
    assert.equal(sql(`CREATE ROLE ${webRole} NOSUPERUSER NOBYPASSRLS NOLOGIN NOINHERIT`).status,0);
    assert.equal(sql(`SET ROLE ${webRole}; SELECT enforced FROM public.booking_workspace_release`).stdout.trim(),'f');
    const denied = sql(`SET ROLE ${webRole}; UPDATE public.booking_workspace_release SET enforced=true,\"activatedArtifactSha\"='${sha}',\"activatedAt\"=CURRENT_TIMESTAMP`);
    assert.notEqual(denied.status,0);
    assert.match(denied.stderr,/permission denied|row-level security/i);
    // A role default must not reuse a snapshot taken before the writer commits.
    assert.equal(sql(`ALTER ROLE CURRENT_USER IN DATABASE ${database} SET default_transaction_isolation='repeatable read'`).status,0);
    held = spawn('psql',['-X','-qAt','-v','ON_ERROR_STOP=1'],{
      env:{...env,PGDATABASE:database},stdio:['pipe','ignore','ignore']
    });
    heldExit = new Promise(resolve=>{held.once('exit',resolve);held.once('error',()=>resolve(-1));});
    await new Promise((resolve,reject)=>{held.once('spawn',resolve);held.once('error',reject);});
    await new Promise((resolve,reject)=>{
      held.stdin.once('error',reject);
      held.stdin.end("BEGIN; INSERT INTO bookings VALUES ('late-commit',1); SELECT pg_sleep(4); COMMIT;",resolve);
    });
    let writerReady=false;
    for (let attempt=0;attempt<40;attempt++) {
      const locks=sql("SELECT count(*) FROM pg_locks WHERE relation='public.bookings'::regclass AND database=(SELECT oid FROM pg_database WHERE datname=current_database()) AND mode='RowExclusiveLock' AND pid<>pg_backend_pid()");
      assert.equal(locks.status,0,'independent writer readiness query must succeed');
      if (Number(locks.stdout.trim())>0) {writerReady=true;break;}
      await new Promise(resolve=>setTimeout(resolve,25));
    }
    assert.equal(writerReady,true,'fixture writer must hold its table lock before testing admission');
    const probe=spawnSync('bash',['-s'],{input:databaseStateScript(true),encoding:'utf8',timeout:5000,
      env:{...env,BOOKING_RELEASE_DB_URL:scratch.toString()}});
    assert.equal(probe.status,0,'read-only writer drain query must succeed');
    assert.equal(probe.stdout.trim(),'BOOKING_WRITERS_BUSY','a pending canonical commit must block the zero-count proof');
    const candidateFile=path.join(rollbackFixture,'candidate.json');
    writeFileSync(candidateFile,JSON.stringify(manifest()));
    const started=Date.now();
    const lateRollback=spawnSync(process.execPath,[
      new URL('./release-contract.mjs',import.meta.url).pathname,'--check-rollback',
      rollbackFixture,candidateFile,sha,'true','true'
    ],{encoding:'utf8',timeout:20000,env:{...env,BOOKING_RELEASE_DB_URL:scratch.toString()}});
    assert.equal(lateRollback.status,1,'the committed row must forbid legacy rollback');
    assert.ok(Date.now()-started>=1000,'admission must wait for the commit');
    assert.equal(await heldExit,0);
    assert.equal(inspect().canonicalCount,1);
    assert.equal(sql("INSERT INTO bookings VALUES ('synthetic',1)").status,0);
    assert.equal(inspect().canonicalCount,2);
    assert.throws(()=>admitRollback(inspect(),null,manifest(),true,true));
    assert.notEqual(sql('UPDATE public.booking_workspace_release SET enforced=true,\"activatedAt\"=CURRENT_TIMESTAMP').status,0,'activation must carry a valid artifact SHA');
    assert.equal(sql(activationSql(manifest('workspace'))).status,0);
    assert.equal(inspect().enforced,true);
    assert.equal(sql(activationSql(manifest('workspace'))).status,0,'activation replay must be a no-op');
    assert.notEqual(sql('UPDATE public.booking_workspace_release SET enforced=false,"activatedArtifactSha"=NULL,"activatedAt"=NULL').status,0);
    assert.notEqual(sql('DELETE FROM public.booking_workspace_release').status,0);
    assert.notEqual(sql('TRUNCATE public.booking_workspace_release').status,0);
    assert.doesNotThrow(()=>admitRollback(inspect(),manifest(),manifest('workspace'),false,true));
  } finally {
    held?.kill();
    if (heldExit) await heldExit;
    rmSync(rollbackFixture,{recursive:true,force:true});
    assert.equal(sql(`DROP DATABASE ${database} WITH (FORCE)`,env.PGDATABASE).status,0);
    sql(`DROP ROLE IF EXISTS ${webRole}`,env.PGDATABASE);
  }
});
