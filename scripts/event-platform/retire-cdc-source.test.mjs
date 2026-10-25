// retire-cdc-source.sh on a real PostgreSQL 16 with a live logical consumer
// holding the slot, as Debezium holds it on production. Run it, don't read it:
// the claims are that the active slot goes, the publication goes, the CDC role
// can no longer log in (so a reconnecting connector cannot recreate the slot),
// a slot that is not ours stays, the rows stay, a safety dump exists first,
// and a second run changes nothing.
import { spawn, spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'

const BIN = '/usr/lib/postgresql/16/bin'
const SCRIPT = 'scripts/event-platform/retire-cdc-source.sh'
const asPostgres = process.getuid?.() === 0 ? ['runuser', '-u', 'postgres', '--'] : []

let root, data, sock, port, consumer
const env = () => ({ ...process.env, PGHOST: sock, PGPORT: String(port), PGUSER: 'postgres' })

function run(cmd, args, opts = {}) {
  const [bin, ...rest] = [...asPostgres, cmd, ...args]
  const r = spawnSync(bin, rest, { encoding: 'utf8', env: env(), ...opts })
  if (r.status !== 0 && !opts.allowFail) throw new Error(`${cmd} ${args.join(' ')}: ${r.stderr}${r.stdout}`)
  return r
}
const sql = (q, db = 'leaddrive_v2') => run('psql', ['-X', '-At', '-d', db, '-c', q]).stdout.trim()

function retire(mode, extra = {}) {
  // As the workflow delivers it: the script on bash's stdin, mode as argument.
  return spawnSync('bash', ['-s', '--', mode], {
    input: readFileSync(SCRIPT),
    encoding: 'utf8',
    env: { ...env(), PG_AS: asPostgres.join(' '), SAFETY_DIR: join(root, 'safety'), DAILY_BACKUP_DIR: join(root, 'daily'), APP_PING_URL: 'skip', ...extra },
  })
}

function waitFor(check, what) {
  const until = Date.now() + 15_000
  while (Date.now() < until) {
    if (check()) return
    spawnSync('sleep', ['0.2'])
  }
  throw new Error(`timed out waiting for ${what}`)
}

before(() => {
  assert.ok(existsSync(`${BIN}/initdb`), 'PostgreSQL 16 server binaries are required (ubuntu-24.04 runners ship them)')
  root = mkdtempSync(join(tmpdir(), 'retire-cdc-'))
  chmodSync(root, 0o777)
  data = join(root, 'data'); sock = root
  port = 20000 + Math.floor(Math.random() * 20000)
  run(`${BIN}/initdb`, ['-D', data, '-U', 'postgres', '--auth=trust', '-E', 'UTF8'])
  run(`${BIN}/pg_ctl`, ['-D', data, '-w', '-l', join(root, 'pg.log'), '-o',
    `-c wal_level=logical -c max_replication_slots=4 -c max_wal_senders=4 -c max_slot_wal_keep_size=256MB -c listen_addresses='' -c unix_socket_directories=${sock} -p ${port}`, 'start'])
  run('psql', ['-X', '-d', 'postgres', '-c', 'create database leaddrive_v2'])
  run('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-d', 'leaddrive_v2', '-c', `
    create table event_outbox (id bigserial primary key, payload text);
    create table domain_events (id bigserial primary key);
    insert into event_outbox (payload) values ('a'), ('b'), ('c');
    create role leaddrive_event_cdc login replication noinherit connection limit 4;
    grant select on event_outbox to leaddrive_event_cdc;
    create publication leaddrive_event_outbox for table event_outbox;`])
  // A slot cannot be created in a transaction that wrote: one call each.
  sql("select pg_create_logical_replication_slot('leaddrive_event_outbox_prod', 'pgoutput')")
  sql("select pg_create_logical_replication_slot('unrelated_slot', 'test_decoding')")
  // The consumer, as Debezium: the CDC role streaming the slot.
  const [bin, ...rest] = [...asPostgres, `${BIN}/pg_recvlogical`, '-d', 'leaddrive_v2', '-U', 'leaddrive_event_cdc',
    '-S', 'leaddrive_event_outbox_prod', '--start', '-f', '/dev/null', '-s', '1',
    '-o', 'proto_version=1', '-o', 'publication_names=leaddrive_event_outbox']
  consumer = spawn(bin, rest, { env: env(), stdio: 'ignore' })
  waitFor(() => sql("select active from pg_replication_slots where slot_name = 'leaddrive_event_outbox_prod'") === 't', 'the consumer to hold the slot')
})

after(() => {
  consumer?.kill('SIGKILL')
  if (data) run(`${BIN}/pg_ctl`, ['-D', data, '-m', 'immediate', 'stop'], { allowFail: true })
  if (root) rmSync(root, { recursive: true, force: true })
})

test('inspect reports the live CDC and changes nothing', () => {
  const r = retire('inspect')
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /cdc_slots=1 active=1/)
  assert.match(r.stdout, /other_slots=1/)
  assert.match(r.stdout, /publication=1/)
  assert.match(r.stdout, /cdc_role=login/)
  assert.match(r.stdout, /event_rows domain_events=0 event_outbox=3/)
  assert.match(r.stdout, /latest_daily_backup=none/)
  assert.equal(sql("select count(*) from pg_replication_slots"), '2')
  assert.ok(!existsSync(join(root, 'safety')), 'inspect must not dump')
})

test('apply drops the held slot and publication, locks the role, keeps the rest', () => {
  const r = retire('apply')
  assert.equal(r.status, 0, r.stderr + r.stdout)
  assert.match(r.stdout, /PASS/)
  assert.equal(sql("select string_agg(slot_name, ',') from pg_replication_slots"), 'unrelated_slot')
  assert.equal(sql("select count(*) from pg_publication"), '0')
  assert.equal(sql("select rolcanlogin from pg_roles where rolname = 'leaddrive_event_cdc'"), 'f')
  assert.equal(sql("select count(*) from event_outbox"), '3')
  const dumps = readdirSync(join(root, 'safety'))
  assert.equal(dumps.length, 1)
  assert.match(dumps[0], /^leaddrive_v2-retire-cdc-\d{8}T\d{6}Z\.dump$/)
  // The dump holds the data.
  const listed = spawnSync(`${BIN}/pg_restore`, ['-l', join(root, 'safety', dumps[0])], { encoding: 'utf8' })
  assert.match(listed.stdout, /TABLE DATA public event_outbox/)
})

test('a connector coming back cannot log in, so cannot recreate the slot', () => {
  const r = run('psql', ['-X', '-U', 'leaddrive_event_cdc', '-d', 'leaddrive_v2', '-c', 'select 1'], { allowFail: true })
  assert.notEqual(r.status, 0)
  assert.match(r.stderr, /not permitted to log in/)
})

test('a second apply is a no-op and still verifies', () => {
  const r = retire('apply')
  assert.equal(r.status, 0, r.stderr + r.stdout)
  assert.match(r.stdout, /already retired/)
  assert.equal(readdirSync(join(root, 'safety')).length, 1, 'no second dump')
  assert.equal(sql("select count(*) from pg_replication_slots where slot_name = 'unrelated_slot'"), '1')
})

test('restore lets a connector back in: it logs in, recreates its slot and streams new rows', () => {
  const r = retire('restore')
  assert.equal(r.status, 0, r.stderr + r.stdout)
  assert.match(r.stdout, /RESTORED/)
  assert.equal(sql("select rolcanlogin from pg_roles where rolname = 'leaddrive_event_cdc'"), 't')
  assert.equal(sql("select string_agg(schemaname || '.' || tablename, ',') from pg_publication_tables where pubname = 'leaddrive_event_outbox'"), 'public.event_outbox')
  assert.equal(sql("select pubinsert::text || pubupdate::text || pubdelete::text from pg_publication where pubname = 'leaddrive_event_outbox'"), 'truefalsefalse')
  assert.equal(sql("select count(*) from pg_replication_slots where slot_name = 'leaddrive_event_outbox_prod'"), '0', 'restore itself pins no WAL')
  // As Debezium on start: the CDC role creates the missing slot and reads a new row through the publication.
  const cdc = (args) => run(`${BIN}/pg_recvlogical`, ['-d', 'leaddrive_v2', '-U', 'leaddrive_event_cdc', '-S', 'leaddrive_event_outbox_prod', ...args])
  cdc(['--create-slot', '-P', 'pgoutput'])
  sql("insert into event_outbox (payload) values ('after-restore')")
  const peek = sql("select count(*) from pg_logical_slot_peek_binary_changes('leaddrive_event_outbox_prod', null, null, 'proto_version', '1', 'publication_names', 'leaddrive_event_outbox')")
  assert.ok(Number(peek) > 0, 'the new slot sees the new outbox row')
  assert.equal(sql("select count(*) from event_outbox"), '4')
  assert.equal(sql("select count(*) from pg_replication_slots where slot_name = 'unrelated_slot'"), '1')
})

test('a second restore is a no-op', () => {
  const r = retire('restore')
  assert.equal(r.status, 0, r.stderr + r.stdout)
  assert.equal(sql("select count(*) from pg_publication where pubname = 'leaddrive_event_outbox'"), '1')
})

test('anything but inspect, apply or restore is refused', () => {
  const r = retire('drop')
  assert.notEqual(r.status, 0)
  assert.match(r.stderr, /usage: inspect\|apply\|restore/)
})
