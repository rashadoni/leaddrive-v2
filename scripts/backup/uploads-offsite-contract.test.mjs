// The offsite copy of client files: what must travel, what must never travel,
// and what must happen when the destination says no.
//
// The script is run for real against a temporary tree. Two stubs stand in for
// the outside world: `aws`, backed by a directory, and `age`, which is
// base64 — reversible on purpose, so these tests can decode what was uploaded
// and compare it to the original byte for byte. Proving that age itself
// encrypts is not our job; proving that OUR pipeline carries the exact bytes
// is, and a one-way stub could not.
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const script = 'scripts/backup/uploads-offsite-mirror.sh';
const installer = 'scripts/backup/uploads-offsite-install.sh';
const source = readFileSync(script, 'utf8');
const RECIPIENT = `age1${'q'.repeat(58)}`;

const AWS_STUB = `#!/usr/bin/env bash
set -Eeuo pipefail
for ((i=1;i<=$#;i++)); do [ "\${!i}" = cp ] && { n=$((i+2)); dst="\${!n}"; }; done
[ -n "\${FAKE_FAIL:-}" ] && { cat >/dev/null; echo "stub: refused" >&2; exit 1; }
key="\${dst#s3://*/}"
mkdir -p "$FAKE_BUCKET/$(dirname "$key")"
cat > "$FAKE_BUCKET/$key"
`;

// Reversible stand-in for age, so the test can read back what was sent.
const AGE_STUB = `#!/usr/bin/env bash
set -Eeuo pipefail
[ "$1" = -r ] || { echo "stub age: expected -r RECIPIENT, got $*" >&2; exit 2; }
printf '%s\\n' "$2" >> "$FAKE_RECIPIENTS"
base64 -w0
`;

function world({ files = {}, fail = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'leaddrive-offsite-'));
  const src = join(dir, 'uploads');
  const bin = join(dir, 'bin');
  mkdirSync(join(dir, 'bucket'), { recursive: true });
  mkdirSync(bin, { recursive: true });
  for (const [rel, body] of Object.entries(files)) {
    const target = join(src, rel);
    mkdirSync(join(target, '..'), { recursive: true });
    writeFileSync(target, body);
  }
  mkdirSync(src, { recursive: true });
  for (const [name, body] of [['aws', AWS_STUB], ['age', AGE_STUB]]) {
    writeFileSync(join(bin, name), body);
    chmodSync(join(bin, name), 0o755);
  }
  writeFileSync(
    join(dir, 'env'),
    ['WAL_REPO_BUCKET=b', 'WAL_REPO_ENDPOINT=e', 'WAL_REPO_REGION=r', 'WAL_REPO_PATH=/pgbackrest', 'WAL_REPO_KEY=k', 'WAL_REPO_KEY_SECRET=s', ''].join('\n'),
  );
  return { dir, src, bin, bucket: join(dir, 'bucket'), env: join(dir, 'env'), fail };
}

function run(w, args, extraEnv = {}) {
  const result = spawnSync('bash', [script, ...args], {
    encoding: 'utf8',
    timeout: 60_000,
    env: {
      ...process.env,
      PATH: `${w.bin}:${process.env.PATH}`,
      UPLOADS_OFFSITE_SOURCE_ROOT: w.src,
      UPLOADS_OFFSITE_ALLOW_TEST_ROOT: '1',
      UPLOADS_OFFSITE_STATE_ROOT: join(w.dir, 'state'),
      WAL_ENV_FILE: w.env,
      FAKE_BUCKET: w.bucket,
      FAKE_RECIPIENTS: join(w.dir, 'recipients'),
      ...(w.fail ? { FAKE_FAIL: '1' } : {}),
      ...extraEnv,
    },
  });
  return { status: result.status, out: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

const summary = (out) => Object.fromEntries(
  (out.split('\n').find((line) => line.startsWith('SUMMARY uploads-offsite')) ?? '')
    .split(' ')
    .filter((pair) => pair.includes('='))
    .map((pair) => [pair.slice(0, pair.indexOf('=')), pair.slice(pair.indexOf('=') + 1)]),
);

const objects = (w) => {
  const found = [];
  const walk = (dir, prefix) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(join(dir, entry.name), `${prefix}${entry.name}/`);
      else found.push(`${prefix}${entry.name}`);
    }
  };
  if (existsSync(w.bucket)) walk(w.bucket, '');
  return found.sort();
};

const state = (w) => Object.fromEntries(
  readFileSync(join(w.dir, 'state/state'), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]),
);

test('every client file travels, and the bytes that arrive are the bytes on disk', () => {
  const w = world({ files: { 'contracts/org1/a.pdf': 'LDFE\u0001запечатанный', 'mtm/photo.jpg': 'снимок' } });
  try {
    const out = run(w, ['--run', '--recipient', RECIPIENT]);
    assert.equal(out.status, 0, out.out);
    assert.deepEqual(summary(out.out).sent_files, '2');
    assert.deepEqual(objects(w), ['uploads-offsite/contracts/org1/a.pdf.age', 'uploads-offsite/mtm/photo.jpg.age']);
    for (const rel of ['contracts/org1/a.pdf', 'mtm/photo.jpg']) {
      const sent = Buffer.from(readFileSync(join(w.bucket, `uploads-offsite/${rel}.age`), 'utf8'), 'base64');
      assert.deepEqual(sent, readFileSync(join(w.src, rel)), `${rel} arrived changed`);
    }
    // Encrypted to the recipient it was given, every time.
    assert.deepEqual([...new Set(readFileSync(join(w.dir, 'recipients'), 'utf8').split('\n').filter(Boolean))], [RECIPIENT]);
  } finally {
    rmSync(w.dir, { recursive: true, force: true });
  }
});

test('call recordings do not travel, and that is a decision, not an omission', () => {
  // The owner set a 90-day retention and a cron enforces it. An offsite copy
  // kept for ever would overturn that quietly.
  const w = world({ files: { 'call-recordings/org1/1.wav': 'звонок', 'contracts/x.pdf': 'договор' } });
  try {
    const out = run(w, ['--run', '--recipient', RECIPIENT]);
    assert.equal(out.status, 0, out.out);
    assert.deepEqual(objects(w), ['uploads-offsite/contracts/x.pdf.age']);
    assert.match(source, /Deliberately NOT copied: uploads\/call-recordings/);
    assert.match(source, /90-day retention/);
  } finally {
    rmSync(w.dir, { recursive: true, force: true });
  }
});

test('--plan says what is there and sends nothing', () => {
  const w = world({ files: { 'a/sealed.bin': 'LDFE\u0001...', 'a/legacy.bin': 'плоский', 'call-recordings/x.wav': 'звонок' } });
  try {
    const out = run(w, ['--plan']);
    assert.equal(out.status, 0, out.out);
    const got = summary(out.out);
    assert.equal(got.files, '2', 'call recordings must not be counted');
    assert.equal(got.pending_files, '2');
    assert.equal(got.pending_unsealed, '1', 'the LDFE envelope is how sealed is told from legacy');
    assert.equal(got.recipient, 'MISSING');
    assert.deepEqual(objects(w), [], '--plan uploaded something');
  } finally {
    rmSync(w.dir, { recursive: true, force: true });
  }
});

test('a second run sends nothing, a changed file goes again', () => {
  const w = world({ files: { 'a/f.bin': 'один' } });
  try {
    assert.equal(run(w, ['--run', '--recipient', RECIPIENT]).status, 0);
    assert.equal(summary(run(w, ['--run', '--recipient', RECIPIENT]).out).sent_files, '0');
    writeFileSync(join(w.src, 'a/f.bin'), 'другой и длиннее');
    const again = run(w, ['--run', '--recipient', RECIPIENT]);
    assert.equal(summary(again.out).sent_files, '1', 'a rewritten file must be copied again');
    assert.deepEqual(
      Buffer.from(readFileSync(join(w.bucket, 'uploads-offsite/a/f.bin.age'), 'utf8'), 'base64').toString(),
      'другой и длиннее',
    );
  } finally {
    rmSync(w.dir, { recursive: true, force: true });
  }
});

test('a run is bounded, and the rest waits for the next night', () => {
  const w = world({ files: Object.fromEntries(Array.from({ length: 5 }, (_, i) => [`a/f${i}.bin`, 'x'.repeat(400)])) });
  try {
    const out = run(w, ['--run', '--recipient', RECIPIENT, '--max-bytes', '500']);
    assert.equal(out.status, 0, out.out);
    const got = summary(out.out);
    assert.equal(got.stopped, 'max-bytes');
    assert.ok(Number(got.sent_files) >= 1 && Number(got.sent_files) < 5, `sent ${got.sent_files} of 5`);
    assert.equal(Number(got.pending_files), 5 - Number(got.sent_files));
    assert.equal(state(w).offsite_stopped, 'max-bytes');
  } finally {
    rmSync(w.dir, { recursive: true, force: true });
  }
});

test('a file bigger than the whole budget still travels', () => {
  // The budget is checked BEFORE each file on purpose: checking after would
  // leave any file larger than a night's budget uncopied for ever.
  const w = world({ files: { 'a/big.bin': 'x'.repeat(5000) } });
  try {
    const out = run(w, ['--run', '--recipient', RECIPIENT, '--max-bytes', '100']);
    assert.equal(summary(out.out).sent_files, '1');
  } finally {
    rmSync(w.dir, { recursive: true, force: true });
  }
});

test('a destination that refuses is an alarm, and the file is retried', () => {
  const w = world({ files: { 'a/f.bin': 'один' }, fail: true });
  try {
    const refused = run(w, ['--run', '--recipient', RECIPIENT]);
    assert.equal(refused.status, 1, 'a run that sent nothing must fail the unit');
    assert.equal(summary(refused.out).status, 'crit');
    assert.equal(state(w).offsite_status, 'crit');
    assert.deepEqual(objects(w), []);
    // Nothing was written to the ledger, so the next run tries again.
    w.fail = false;
    assert.equal(summary(run(w, ['--run', '--recipient', RECIPIENT]).out).sent_files, '1');
  } finally {
    rmSync(w.dir, { recursive: true, force: true });
  }
});

test('three refusals in a row stop the run instead of hammering', () => {
  const w = world({ files: Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`a/f${i}.bin`, 'x'])), fail: true });
  try {
    const out = run(w, ['--run', '--recipient', RECIPIENT]);
    assert.equal(summary(out.out).stopped, 'failures');
    assert.equal(summary(out.out).failures, '3');
  } finally {
    rmSync(w.dir, { recursive: true, force: true });
  }
});

test('no copy of a client file is left behind on this host', () => {
  // Streamed through age into the bucket: a run that dies must not leave a
  // plaintext or a ciphertext copy on the production disk.
  const w = world({ files: { 'a/f.bin': 'тайна' } });
  try {
    assert.equal(run(w, ['--run', '--recipient', RECIPIENT]).status, 0);
    assert.deepEqual(readdirSync(join(w.dir, 'state')).sort(), ['ledger.tsv', 'mirror.lock', 'state']);
    assert.ok(!readFileSync(join(w.dir, 'state/ledger.tsv'), 'utf8').includes('тайна'));
    assert.match(source, /no plaintext copy and no\n# +ciphertext copy ever touches a disk here/);
  } finally {
    rmSync(w.dir, { recursive: true, force: true });
  }
});

test('the source root cannot be pointed somewhere else', () => {
  // The script holds a root key and a write key. An overridable source is how a
  // backup job becomes an exfiltration tool.
  const w = world({ files: { 'a/f.bin': 'x' } });
  try {
    const out = run(w, ['--run', '--recipient', RECIPIENT], { UPLOADS_OFFSITE_ALLOW_TEST_ROOT: '' });
    assert.equal(out.status, 1);
    assert.match(out.out, /UPLOADS_OFFSITE_SOURCE_ROOT override is forbidden/);
    assert.deepEqual(objects(w), []);
  } finally {
    rmSync(w.dir, { recursive: true, force: true });
  }
});

test('nothing is sent without a real recipient', () => {
  const w = world({ files: { 'a/f.bin': 'x' } });
  try {
    for (const bad of [[], ['--recipient', 'age1short'], ['--recipient', 'not-an-age-key']]) {
      const out = run(w, ['--run', ...bad]);
      assert.equal(out.status, 1, out.out);
      assert.match(out.out, /age recipient is required|an age recipient/);
      assert.deepEqual(objects(w), []);
    }
  } finally {
    rmSync(w.dir, { recursive: true, force: true });
  }
});

test('the prefix stays out of the pgBackRest repository', () => {
  const w = world({ files: { 'a/f.bin': 'x' } });
  try {
    const collide = run(w, ['--run', '--recipient', RECIPIENT], { UPLOADS_OFFSITE_PREFIX: 'pgbackrest' });
    assert.equal(collide.status, 1);
    assert.match(collide.out, /collides with the pgBackRest repository path/);
    const nested = run(w, ['--run', '--recipient', RECIPIENT], { UPLOADS_OFFSITE_PREFIX: 'a/b' });
    assert.equal(nested.status, 1);
    assert.match(nested.out, /single path segment/);
  } finally {
    rmSync(w.dir, { recursive: true, force: true });
  }
});

test('the state the watch reads is flat and carries what it needs', () => {
  const w = world({ files: { 'a/f.bin': 'x' } });
  try {
    assert.equal(run(w, ['--run', '--recipient', RECIPIENT]).status, 0);
    const got = state(w);
    assert.equal(got.offsite, 'present');
    assert.ok(Number(got.offsite_ran_at) > 0);
    assert.equal(got.offsite_status, 'ok');
    assert.equal(got.offsite_pending, '0');
    // A value with a space would break the watch's key=value parser.
    for (const [key, value] of Object.entries(got)) assert.doesNotMatch(value, /\s/, `${key} has whitespace`);
    assert.equal(statSync(join(w.dir, 'state/state')).mode & 0o777, 0o640);
  } finally {
    rmSync(w.dir, { recursive: true, force: true });
  }
});

test('the installer refuses to pretend, and never touches the fenced units', () => {
  const text = readFileSync(installer, 'utf8');
  assert.match(text, /--recipient must be an age public key/);
  assert.match(text, /wal-archive\.env is missing/);
  assert.match(text, /run as root on production/);
  assert.match(text, /is missing — deploy first/);
  for (const fenced of ['leaddrive-postgres-backup', 'leaddrive-secrets-snapshot', 'leaddrive-runtime-files-snapshot', 'leaddrive-log-ship']) {
    assert.ok(!text.includes(fenced), `the installer must not touch ${fenced}`);
  }
  const unit = readFileSync('ops/systemd/leaddrive-uploads-offsite.service', 'utf8');
  assert.match(unit, /ExecStart=\/usr\/local\/lib\/leaddrive-v2\/ops\/current\/backup\/uploads-offsite-mirror\.sh --run/);
  assert.match(unit, /ProtectSystem=strict/);
  assert.match(unit, /ReadOnlyPaths=.*\/var\/lib\/leaddrive-v2\/uploads/);
  const timer = readFileSync('ops/systemd/leaddrive-uploads-offsite.timer', 'utf8');
  assert.match(timer, /OnCalendar=\*-\*-\* 05:20:00 UTC/);
  assert.match(timer, /Persistent=true/, 'a night the host was down must still be caught up');
});

test('the box-side wrapper takes the owner\'s key, never the dev box\'s', () => {
  // Production holds two age recipients. The owner's is the one the host's
  // nightly backup script encrypts to — his private half is on his Mac alone.
  // BACKUP_AGE_RECIPIENT in /etc/leaddrive/backup.env is the dev box's, and its
  // private half sits on the dev box beside the copies of the backups, so a
  // copy encrypted to it protects nothing. Measured on 2026-11-02: those two
  // files hold exactly those two different keys.
  const wrapper = readFileSync('scripts/ops/uploads-offsite-remote.sh', 'utf8');
  assert.match(wrapper, /OWNER_KEY_SOURCE=\/usr\/local\/sbin\/leaddrive-backup\.sh/);
  // The recipient used for --install comes from that one file, and nowhere else.
  const chooser = wrapper.slice(wrapper.indexOf('find_recipient()'), wrapper.indexOf('show_keys()'));
  assert.match(chooser, /\$OWNER_KEY_SOURCE/);
  assert.doesNotMatch(chooser, /backup\.env|\/etc\/leaddrive\//, 'the chooser must not look at the dev box key');
  // Ambiguity is a refusal, not a guess.
  assert.match(wrapper, /Не могу выбрать ключ сам/);
});

test('the mirror never deletes anything in the bucket', () => {
  for (const forbidden of [/s3 rm/, /delete-object/, /--delete\b/]) {
    assert.doesNotMatch(source, forbidden, `the mirror must not contain ${forbidden}`);
  }
  assert.match(source, /It never deletes anything in the bucket/);
});

test('real age, when it is here: the copy decrypts back to the original', { skip: process.env.LEADDRIVE_OWNER_AGE_INTEGRATION !== '1' }, () => {
  const w = world({ files: { 'a/f.bin': 'настоящий договор' } });
  try {
    rmSync(join(w.bin, 'age'));
    const identity = join(w.dir, 'identity.agekey');
    execFileSync('age-keygen', ['-o', identity], { encoding: 'utf8', stdio: 'pipe' });
    const recipient = execFileSync('age-keygen', ['-y', identity], { encoding: 'utf8' }).trim();
    assert.equal(run(w, ['--run', '--recipient', recipient]).status, 0);
    const back = execFileSync('age', ['-d', '-i', identity], {
      input: readFileSync(join(w.bucket, 'uploads-offsite/a/f.bin.age')),
      encoding: 'buffer',
    });
    assert.deepEqual(back, readFileSync(join(w.src, 'a/f.bin')));
  } finally {
    rmSync(w.dir, { recursive: true, force: true });
  }
});
