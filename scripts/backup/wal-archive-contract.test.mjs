// The WAL archive is proved end to end by scripts/backup/wal-pitr-drill.sh,
// which restores a real cluster to a point between two rows. This file guards
// the wiring around that proof: the settings that make a restore possible at
// all, and the ones that decide whether anybody hears about a broken archive.
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const envExample = readFileSync('ops/backup/wal-archive.env.example', 'utf8');
const install = readFileSync('scripts/backup/wal-archive-install.sh', 'utf8');
const check = readFileSync('scripts/backup/wal-archive-check.sh', 'utf8');
const drill = readFileSync('scripts/backup/wal-pitr-drill.sh', 'utf8');
const snapshot = readFileSync('scripts/backup/snapshot-secrets.sh', 'utf8');
const service = readFileSync('ops/systemd/leaddrive-wal-check.service', 'utf8');
const timer = readFileSync('ops/systemd/leaddrive-wal-check.timer', 'utf8');

test('every variable the installer requires exists in the template', () => {
  const required = [...install.matchAll(/^require_var (\w+) /gm)].map((m) => m[1]);
  assert.ok(required.length >= 15, `expected the installer to validate its inputs, found ${required.length}`);
  for (const name of required) {
    assert.match(envExample, new RegExp(`^${name}=`, 'm'), `${name} is missing from wal-archive.env.example`);
  }
});

test('the repository passphrase is in the encrypted secrets snapshot', () => {
  // Without this file the archive is a pile of unreadable blocks: the host
  // that holds the passphrase is exactly the host the archive exists for.
  assert.match(snapshot, /^\s*\/etc\/leaddrive\/wal-archive\.env$/m);
});

test('the repository is encrypted and bounded', () => {
  assert.match(install, /repo1-cipher-type=aes-256-cbc/);
  assert.match(install, /repo1-cipher-pass=\$WAL_REPO_CIPHER_PASS/);
  assert.match(install, /repo1-retention-full=\$WAL_RETENTION_FULL/);
  assert.doesNotMatch(install, /repo1-cipher-type=none/);
});

test('asynchronous archiving always comes with a spool and a bounded queue', () => {
  // archive-async without spool-path is a pgBackRest error, and without
  // archive-push-queue-max a repository outage fills the data disk.
  const config = install.slice(install.indexOf('render_conf()'), install.indexOf('render_pg_conf()'));
  assert.match(config, /archive-async=y/);
  assert.match(config, /spool-path=\$WAL_SPOOL_PATH/);
  assert.match(config, /archive-push-queue-max=\$WAL_ARCHIVE_QUEUE_MAX/);
});

test('the archive_command the installer writes is the command pgBackRest expects', () => {
  assert.match(install, /expected_archive_command="pgbackrest --stanza=\$WAL_STANZA archive-push %p"/);
  assert.match(install, /archive_command = '\$expected_archive_command'/);
  assert.match(install, /archive_mode = on/);
});

test('the installer never lowers wal_level', () => {
  // Production runs wal_level=logical for the Kafka CDC slot. Writing
  // `replica` into the drop-in would disable logical decoding at the next
  // restart — the restart this very script asks for.
  const dropin = install.slice(install.indexOf('render_pg_conf()'), install.indexOf('pg_dropin='));
  assert.doesNotMatch(dropin, /^wal_level/m);
  assert.match(install, /replica \| logical\) ;;/);
  assert.match(install, /archiving needs at least replica/);
});

test('the installer never logs a secret', () => {
  const secrets = ['WAL_REPO_CIPHER_PASS', 'WAL_REPO_KEY_SECRET', 'WAL_REPO_KEY'];
  for (const line of install.split('\n')) {
    if (!/^\s*(log|echo|printf|fatal)\b/.test(line)) continue;
    for (const secret of secrets) {
      assert.ok(!line.includes(secret), `secret ${secret} reaches a log line: ${line.trim()}`);
    }
  }
});

test('the watch asks pgBackRest for info in a way that actually prints', () => {
  // The production config sets log-level-console=warn, and at warn the info
  // command prints nothing at all — the watch would read an empty repository
  // report as a healthy one. Found by running it, not by reading it.
  for (const match of check.matchAll(/pgbackrest [^"']*\binfo\b/g)) {
    assert.match(match[0], /--log-level-console=info/, `info call without an explicit console level: ${match[0]}`);
  }
});

test('the watch treats an unusable archive as critical, not as a warning', () => {
  assert.match(check, /note crit "no full backup in the repository/);
  assert.match(check, /note crit "pgBackRest dropped WAL/);
  assert.match(check, /note crit "archive_command is failing/);
  assert.match(check, /note crit "nothing has ever been archived/);
  assert.match(check, /^\s*crit\) exit 2 ;;|\*\) exit 2 ;;/m);
});

test('the watch alarms only after two bad runs and says when it recovers', () => {
  assert.match(check, /streak" -ge 2/);
  assert.match(check, /снова в порядке/);
});

test('a warning does not make systemd shout over the script', () => {
  assert.match(service, /^SuccessExitStatus=0 1 2$/m);
  assert.match(service, /^OnFailure=leaddrive-wal-check-failed\.service$/m);
  assert.match(timer, /OnCalendar=\*:0\/5/);
});

test('the drill proves recovery to a point, not merely that a cluster starts', () => {
  // A restore that brings back both rows is a restore to "latest" — it would
  // pass a weaker assertion while proving nothing about point-in-time.
  assert.match(drill, /--type=time --target="\$target_time"/);
  assert.match(drill, /\[ "\$rows" = "1" \]/);
  assert.match(drill, /--target-action=promote/);
  assert.match(drill, /repo1-cipher-type=aes-256-cbc/);
  assert.match(drill, /archive-async=y/);
});

test('the drill refuses to run as root and cleans up after itself', () => {
  assert.match(drill, /\[ "\$\(id -u\)" -ne 0 \] \|\| fatal/);
  assert.match(drill, /trap cleanup EXIT/);
});

test('no backticks inside the unquoted heredocs', () => {
  // render_pg_conf and render_conf interpolate variables, so their heredocs
  // are unquoted and the shell runs anything in backticks. A prose comment
  // with `logical` in it executed on the first production run.
  const rendered = install.slice(install.indexOf('render_conf()'), install.indexOf('pg_dropin='));
  assert.ok(!rendered.includes('`'), 'a backtick inside an unquoted heredoc is executed by the shell');
});

test('a failed stanza-create is fatal, not swallowed', () => {
  assert.doesNotMatch(install, /stanza-create[^\n]*\|\| true/);
  assert.match(install, /fatal "stanza-create failed/);
});
