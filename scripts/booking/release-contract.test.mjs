import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseManifest, parseState, admitCandidate, admitRollback, emitAdmission, databaseStateScript } from './release-contract.mjs';

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
test('actual read-only release-state SQL handles old schema, expansion and strict activation', {skip:!postgres}, () => {
  const parsed = new URL(postgres);
  assert.ok(['127.0.0.1','localhost'].includes(parsed.hostname));
  assert.equal(parsed.search,'');
  const database = `booking_release_contract_${process.pid}`;
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
  try {
    assert.deepEqual(inspect(),state());
    assert.equal(sql('CREATE TABLE bookings(id text,version integer NOT NULL DEFAULT 0); CREATE TABLE _prisma_migrations(migration_name text,finished_at timestamp,rolled_back_at timestamp);').status,0);
    assert.deepEqual(inspect(),state({expanded:true}));
    assert.throws(()=>admitCandidate(inspect(),null,manifest()));
    assert.equal(sql("INSERT INTO bookings VALUES ('synthetic',1)").status,0);
    assert.equal(inspect().canonicalCount,1);
    assert.throws(()=>admitRollback(inspect(),null,manifest(),true,true));
    assert.equal(sql("INSERT INTO _prisma_migrations VALUES ('20261102110000_booking_workspace_enforcement',CURRENT_TIMESTAMP,NULL)").status,0);
    assert.equal(inspect().enforced,true);
    assert.doesNotThrow(()=>admitRollback(inspect(),manifest(),manifest('workspace'),false,true));
  } finally {
    assert.equal(sql(`DROP DATABASE ${database} WITH (FORCE)`,env.PGDATABASE).status,0);
  }
});
