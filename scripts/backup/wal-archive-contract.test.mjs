// The WAL archive is proved end to end by scripts/backup/wal-pitr-drill.sh,
// which restores a real cluster to a point between two rows. This file guards
// the wiring around that proof: the settings that make a restore possible at
// all, and the ones that decide whether anybody hears about a broken archive.
import { readFileSync, mkdtempSync, writeFileSync, rmSync, chmodSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const envExample = readFileSync('ops/backup/wal-archive.env.example', 'utf8');
const install = readFileSync('scripts/backup/wal-archive-install.sh', 'utf8');
const check = readFileSync('scripts/backup/wal-archive-check.sh', 'utf8');
const drill = readFileSync('scripts/backup/wal-pitr-drill.sh', 'utf8');
const snapshot = readFileSync('scripts/backup/snapshot-secrets.sh', 'utf8');
const service = readFileSync('ops/systemd/leaddrive-wal-check.service', 'utf8');
const timer = readFileSync('ops/systemd/leaddrive-wal-check.timer', 'utf8');
const backup = readFileSync('scripts/backup/wal-archive-backup.sh', 'utf8');
const backupService = readFileSync('ops/systemd/leaddrive-wal-backup.service', 'utf8');
const backupTimer = readFileSync('ops/systemd/leaddrive-wal-backup.timer', 'utf8');

// The scheduler's only real decision is full or differential, and it is a pure
// function of what the repository already holds. Run it for each case against a
// stub pgbackrest rather than asserting the shape of the call.
function decide(infoJson) {
  const dir = mkdtempSync(join(tmpdir(), 'leaddrive-wal-backup-'));
  try {
    const stub = join(dir, 'pgbackrest');
    writeFileSync(stub, '#!/bin/sh\ncat "$FAKE_INFO"\n');
    chmodSync(stub, 0o755);
    const info = join(dir, 'info.json');
    writeFileSync(info, infoJson);
    const env = join(dir, 'env');
    writeFileSync(
      env,
      `WAL_STANZA=leaddrive\nWAL_PG_USER=${userInfo().username}\n` +
        `WAL_FULL_INTERVAL_DAYS=7\nWAL_BACKUP_LOCK_FILE=${join(dir, 'lock')}\n`,
    );
    const out = execFileSync('bash', ['scripts/backup/wal-archive-backup.sh'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        WAL_ENV_FILE: env,
        PGBACKREST_BIN: stub,
        FAKE_INFO: info,
        WAL_BACKUP_DECIDE_ONLY: '1',
      },
    });
    const line = out.trim().split('\n').pop();
    assert.match(line, /^DECISION (full|diff) /, `unexpected scheduler output: ${out}`);
    return line.split(' ')[1];
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function stanzaWithFull(ageSeconds) {
  const stop = Math.floor(Date.now() / 1000) - ageSeconds;
  return JSON.stringify([{ backup: [{ type: 'full', timestamp: { stop } }] }]);
}

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

test('an empty repository gets a full backup, not a differential', () => {
  // A differential against nothing is a pgBackRest error, and the repository
  // would stay without the base every restore replays from.
  assert.equal(decide('[]'), 'full');
  assert.equal(decide(JSON.stringify([{ backup: [] }])), 'full');
});

test('a fresh full backup is followed by differentials', () => {
  assert.equal(decide(stanzaWithFull(3600)), 'diff');
  assert.equal(decide(stanzaWithFull(6 * 86400)), 'diff');
});

test('a full backup older than its interval is renewed', () => {
  // At the interval exactly, not a day later: the restore replay window is
  // what this bounds.
  assert.equal(decide(stanzaWithFull(7 * 86400 + 60)), 'full');
  assert.equal(decide(stanzaWithFull(30 * 86400)), 'full');
});

test('an unreadable repository asks for a full backup instead of skipping', () => {
  // Skipping would leave a broken repository broken until somebody looked. A
  // full backup is the one command that repairs a repository with no usable
  // backup set.
  assert.equal(decide('not json at all'), 'full');
  assert.equal(decide(''), 'full');
});

test('the scheduler runs often enough that the watch is a backstop, not the notice', () => {
  // The watch warns when the newest backup passes 48h. A schedule sparser than
  // daily would make that warning the normal state of a healthy system.
  assert.match(backupTimer, /^OnCalendar=\*-\*-\* \d\d:\d\d:\d\d UTC$/m);
  assert.match(backupTimer, /^Persistent=true$/m);
  assert.match(check, /backup_age.*-gt 172800/);
});

test('a stale full backup is noticed even while differentials keep succeeding', () => {
  // Differentials succeeding while fulls fail keeps the newest backup fresh,
  // so without this the replay chain grows with nothing complaining.
  assert.match(check, /full_age.*WAL_FULL_INTERVAL_DAYS \* 172800/);
  assert.match(check, /newest full backup is .*old \(interval/);
});

test('the scheduler does not report on itself', () => {
  // It is judged by the repository state the watch reads, not by its own exit
  // status: a job that alerts on success is the gate that greens on its own
  // failure.
  assert.doesNotMatch(backup, /WAL_ALERT_COMMAND/);
  assert.doesNotMatch(backupService, /^OnFailure=/m);
});

test('the backup unit runs the release-owned scheduler and keeps the pgBackRest log', () => {
  assert.match(
    backupService,
    /^ExecStart=\/usr\/local\/lib\/leaddrive-v2\/ops\/current\/backup\/wal-archive-backup\.sh$/m,
  );
  // Under ProtectSystem=strict the log directory is read-only unless named,
  // and a failed backup is diagnosed from that log.
  assert.match(backupService, /^ReadWritePaths=.*\/var\/log\/pgbackrest/m);
  assert.match(service, /^ReadWritePaths=.*\/var\/log\/pgbackrest/m);
});

test('a backup in flight is never killed by a timeout or a second run', () => {
  // A killed full backup leaves the repository without the new base while the
  // WAL chain keeps growing from the older one.
  assert.match(backupService, /^TimeoutStartSec=4h$/m);
  assert.match(backup, /flock -n 9 \|\| \{/);
  assert.match(backup, /exit 0/);
});

test('the full backup interval is configured, not hardcoded', () => {
  assert.match(envExample, /^WAL_FULL_INTERVAL_DAYS=7$/m);
  assert.match(backup, /\$\{WAL_FULL_INTERVAL_DAYS:=7\}/);
});
