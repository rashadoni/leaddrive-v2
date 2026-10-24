import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseManifest, parseState, admitCandidate, admitRollback, emitAdmission, databaseStateScript, bookingSchemaHash, activationSql } from './release-contract.mjs';

const sha = 'a'.repeat(40), hash = 'b'.repeat(64);
const manifest = (phase='compatibility') => ({version:1,contract:'booking-canonical-writer/v1',artifactSha:sha,schemaHash:hash,phase});
const state = (overrides={}) => ({expanded:false,canonicalCount:0,enforced:false,readOnly:true,rlsUnfiltered:true,...overrides});

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
BOOKING_RELEASE_CONTROLLER=reviewed-controller
BOOKING_RELEASE_CANDIDATE_FILE=reviewed-candidate
BOOKING_RELEASE_FIRST_EXPANSION=true
BOOKING_RELEASE_AUTO_RECOVERY_BLOCKED=false
MIGRATION_DATABASE_URL=synthetic-fixture-only
EXPECTED_DEPLOY_SHA_ARG='${sha}'
HANDOFF_STARTED=true
STANDALONE_REPLACED=true
log() { :; }
persist_event_platform_pm2_stop_fence() { printf 'stop\\n' >> '${trace}'; }
node() { printf 'check:%s\\n' "$*" >> '${trace}'; return ${accepted?0:1}; }
safe_remove_tree() { rm -rf -- "$1"; }
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

test('recovery runs current-main admission before any historical artifact is copied to production', () => {
  const workflow = readFileSync('.github/workflows/deploy.yml','utf8');
  const recovery = workflow.slice(workflow.indexOf('  recovery:'));
  assert.ok(recovery.indexOf('Preserve current-main booking admission') < recovery.indexOf('Checkout deployment script from the recovered revision'));
  assert.ok(recovery.indexOf('Admit retained booking backend with current-main code') < recovery.indexOf('Stage exact retained recovery artifact on production disk'));
  assert.match(recovery,/node "\$RUNNER_TEMP\/booking-current-main-admission\/scripts\/booking\/release-contract.mjs"/);
  assert.match(workflow,/artifact="\/tmp\/leaddrive-deploy-artifact\/leaddrive-prod-\$\{DEPLOY_TARGET_SHA\}\.tar.gz"/);
});

test('emitted current-main admission and state scripts parse and never load historical code', () => {
  const emitted = emitAdmission(sha,JSON.stringify(manifest('workspace')));
  assert.equal(spawnSync('bash',['-n'],{input:emitted}).status,0);
  assert.equal(spawnSync('bash',['-n'],{input:databaseStateScript()}).status,0);
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
    held.stdin.end("BEGIN; INSERT INTO bookings VALUES ('late-commit',1); SELECT pg_sleep(4); COMMIT;");
    let busy=false;
    for (let attempt=0;attempt<20;attempt++) {
      const probe=spawnSync('bash',['-s'],{input:databaseStateScript(true),encoding:'utf8',timeout:5000,
        env:{...env,BOOKING_RELEASE_DB_URL:scratch.toString()}});
      if (probe.stdout.trim()==='BOOKING_WRITERS_BUSY') {busy=true;break;}
    }
    assert.equal(busy,true,'a pending canonical commit must block the zero-count proof');
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
