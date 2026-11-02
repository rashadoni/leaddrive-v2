// The help-video masters live in object storage; the bytes users stream stay
// on the production disk. These tests run the sync script for real against a
// stub `aws` backed by a directory, in both directions, and compare bytes.
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const script = 'scripts/help-videos/assets-sync.sh';
const source = readFileSync(script, 'utf8');

const STUB = `#!/usr/bin/env bash
set -Eeuo pipefail
args=("$@")
key_of() { printf '%s' "\${1#s3://*/}"; }
if [ "\${args[0]}" = s3 ] && [ "\${args[1]}" = cp ]; then
  src="\${args[2]}"; dst="\${args[3]}"
  if [ "\${src#s3://}" != "\$src" ]; then
    k="\$(key_of "\$src")"
    [ -f "\$FAKE_BUCKET/\$k" ] || { echo "NoSuchKey \$k" >&2; exit 1; }
    mkdir -p "\$(dirname "\$dst")"; cp -- "\$FAKE_BUCKET/\$k" "\$dst"; exit 0
  fi
  k="\$(key_of "\$dst")"
  mkdir -p "\$(dirname "\$FAKE_BUCKET/\$k")"; cp -- "\$src" "\$FAKE_BUCKET/\$k"; exit 0
fi
echo "stub aws: unsupported \${args[0]} \${args[1]}" >&2
exit 2
`;

const NAMES = ['boards.ru.VOICE.mp4', 'boards.en.VOICE.mp4', 'boards.ru.poster.jpg'];

function world() {
  const dir = mkdtempSync(join(tmpdir(), 'leaddrive-helpvideo-'));
  const bucket = join(dir, 'bucket');
  const local = join(dir, 'player');
  mkdirSync(bucket, { recursive: true });
  mkdirSync(local, { recursive: true });
  const stub = join(dir, 'aws');
  writeFileSync(stub, STUB);
  chmodSync(stub, 0o755);
  const env = join(dir, 'env');
  writeFileSync(
    env,
    [
      'WAL_REPO_BUCKET=b',
      'WAL_REPO_ENDPOINT=s3.example.invalid',
      'WAL_REPO_REGION=eu-central-003',
      'WAL_REPO_PATH=/pgbackrest',
      'WAL_REPO_KEY=k',
      'WAL_REPO_KEY_SECRET=s',
      'HELP_VIDEO_OBJECT_PREFIX=help-videos',
      '',
    ].join('\n'),
  );
  return { dir, bucket, local, stub, env };
}

function seedLocal(w, names = NAMES) {
  for (const n of names) writeFileSync(join(w.local, n), `байты ${n}\n`.repeat(30));
}

function run(w, args = [], extraEnv = {}) {
  try {
    return {
      status: 0,
      stdout: execFileSync('bash', [script, '--version', 'v1', '--dir', w.local, ...args], {
        encoding: 'utf8',
        env: { ...process.env, WAL_ENV_FILE: w.env, AWS_BIN: w.stub, FAKE_BUCKET: w.bucket, ...extraEnv },
      }),
    };
  } catch (error) {
    return { status: error.status ?? 1, stdout: `${error.stdout ?? ''}${error.stderr ?? ''}` };
  }
}

const digest = (p) => execFileSync('sha256sum', [p], { encoding: 'utf8' }).split(' ')[0];

test('a release that carries the masters publishes them', () => {
  const w = world();
  try {
    seedLocal(w);
    const out = run(w);
    assert.equal(out.status, 0, out.stdout);
    assert.match(out.stdout, /SUMMARY help-video-sync version=v1 action=publish files=3/);
    for (const n of NAMES) assert.ok(existsSync(join(w.bucket, 'help-videos/v1', n)), `${n} not uploaded`);
    assert.ok(existsSync(join(w.bucket, 'help-videos/v1/manifest.sha256')));
  } finally {
    rmSync(w.dir, { recursive: true, force: true });
  }
});

test('a release without the masters pulls them back byte for byte', () => {
  const w = world();
  try {
    seedLocal(w);
    assert.equal(run(w).status, 0);
    const before = Object.fromEntries(NAMES.map((n) => [n, digest(join(w.local, n))]));
    // The next release ships no videos at all.
    for (const n of NAMES) rmSync(join(w.local, n));
    const out = run(w);
    assert.equal(out.status, 0, out.stdout);
    assert.match(out.stdout, /action=pull files=3/);
    for (const n of NAMES) assert.equal(digest(join(w.local, n)), before[n], `${n} differs after the pull`);
  } finally {
    rmSync(w.dir, { recursive: true, force: true });
  }
});

test('a rotted file on disk is replaced, an intact one is not re-downloaded', () => {
  const w = world();
  try {
    seedLocal(w);
    assert.equal(run(w).status, 0);
    const good = digest(join(w.local, NAMES[1]));
    writeFileSync(join(w.local, NAMES[0]), 'мусор');
    const out = run(w);
    assert.equal(out.status, 0, out.stdout);
    assert.match(out.stdout, /action=pull files=1/, 'only the damaged file should move');
    assert.equal(digest(join(w.local, NAMES[1])), good);
    assert.notEqual(digest(join(w.local, NAMES[0])), 'мусор');
  } finally {
    rmSync(w.dir, { recursive: true, force: true });
  }
});

test('when both sides agree nothing is transferred', () => {
  const w = world();
  try {
    seedLocal(w);
    assert.equal(run(w).status, 0);
    const out = run(w);
    assert.equal(out.status, 0, out.stdout);
    assert.match(out.stdout, /action=none files=3/);
  } finally {
    rmSync(w.dir, { recursive: true, force: true });
  }
});

test('a download that does not match the manifest is refused and not installed', () => {
  const w = world();
  try {
    seedLocal(w);
    assert.equal(run(w).status, 0);
    rmSync(join(w.local, NAMES[0]));
    // Rot the stored object, leaving the manifest as it was.
    writeFileSync(join(w.bucket, 'help-videos/v1', NAMES[0]), 'подменено');
    const out = run(w);
    assert.notEqual(out.status, 0);
    assert.match(out.stdout, /does not match the manifest/);
    assert.ok(!existsSync(join(w.local, NAMES[0])), 'a file that failed verification was installed anyway');
  } finally {
    rmSync(w.dir, { recursive: true, force: true });
  }
});

test('an empty directory never becomes an empty manifest', () => {
  // Publishing nothing would record a complete-looking empty set and make
  // every later pull a silent no-op.
  const w = world();
  try {
    const out = run(w);
    assert.notEqual(out.status, 0);
    assert.match(out.stdout, /has no help-video files/);
    assert.ok(!existsSync(join(w.bucket, 'help-videos/v1/manifest.sha256')));
  } finally {
    rmSync(w.dir, { recursive: true, force: true });
  }
});

test('only help-video names travel', () => {
  const w = world();
  try {
    seedLocal(w);
    writeFileSync(join(w.local, 'notes.txt'), 'постороннее');
    writeFileSync(join(w.local, 'boards.ru.VOICE.mp4.bak'), 'тоже постороннее');
    const out = run(w);
    assert.equal(out.status, 0, out.stdout);
    assert.match(out.stdout, /files=3/, 'strangers were counted');
    const uploaded = readdirSync(join(w.bucket, 'help-videos/v1'));
    assert.ok(!uploaded.includes('notes.txt'));
    assert.ok(!uploaded.includes('boards.ru.VOICE.mp4.bak'));
  } finally {
    rmSync(w.dir, { recursive: true, force: true });
  }
});

test('the manifest is written after the files, never before', () => {
  // Until the manifest exists a pull does not start, so an interrupted publish
  // cannot be mistaken for a complete set.
  const publish = source.slice(source.indexOf('log "publishing'));
  assert.ok(
    publish.indexOf('"s3://$WAL_REPO_BUCKET/$base/$name"') < publish.indexOf('"s3://$WAL_REPO_BUCKET/$manifest_key"'),
    'the manifest must be uploaded last',
  );
});

test('the version and prefix cannot wander out of their place', () => {
  const w = world();
  try {
    seedLocal(w);
    for (const v of ['../escape', 'v1/sub', '']) {
      const out = (() => {
        try {
          return {
            status: 0,
            stdout: execFileSync('bash', [script, '--version', v, '--dir', w.local], {
              encoding: 'utf8',
              env: { ...process.env, WAL_ENV_FILE: w.env, AWS_BIN: w.stub, FAKE_BUCKET: w.bucket },
            }),
          };
        } catch (error) {
          return { status: error.status ?? 1, stdout: `${error.stdout ?? ''}${error.stderr ?? ''}` };
        }
      })();
      assert.notEqual(out.status, 0, `version "${v}" was accepted`);
    }
    assert.match(source, /collides with the pgBackRest repo path/);
  } finally {
    rmSync(w.dir, { recursive: true, force: true });
  }
});

test('the script only moves bytes, it never mints a URL or opens a file up', () => {
  // The decision was to keep the auth posture: the application keeps streaming
  // from disk behind requireAuth, and nothing here can hand out a link or make
  // an object public. Checking the prose for the word "presign" would be a
  // test of the comments — these check the commands.
  const calls = [...source.matchAll(/"\$AWS_BIN" (s3api|s3) (\S+)/g)].map((m) => `${m[1]} ${m[2]}`);
  assert.deepEqual([...new Set(calls)], ['s3 cp'], `unexpected aws subcommands: ${calls.join(', ')}`);
  assert.doesNotMatch(source, /--acl\b/);
  assert.doesNotMatch(source, /public-read/);
});

test('the accepted filenames are the serving route\'s own pattern', () => {
  // Two copies of this shape drifting apart is how the posters-only bug
  // happened; the test compares them instead of trusting a comment.
  const serve = readFileSync('src/lib/help-videos/serve.ts', 'utf8');
  const routePattern = serve.match(/HELP_VIDEO_FILE_PATTERN = \/\^(.+)\$\//)?.[1];
  assert.ok(routePattern, 'could not read the serving pattern');
  const scriptPattern = source.match(/=~ \^(.+)\$ \]\]/)?.[1];
  assert.ok(scriptPattern, 'could not read the script pattern');
  assert.equal(scriptPattern.replace(/\\\\/g, '\\'), routePattern);
});

test('the deploy publishes outside the downtime window, and does not pull yet', () => {
  // The artifact's videos are copied into the runtime directory with PM2
  // stopped. Moving 266 MB there would add minutes of downtime to every
  // deploy, so the publish waits until the release is healthy. The pull is
  // deliberately not on the deploy path until it can stage and rename.
  const deploy = readFileSync('scripts/server-deploy.sh', 'utf8');
  const stopPoint = deploy.indexOf('cp -a "$BUNDLED_HELP_VIDEO_DIR/."');
  const publish = deploy.indexOf('Step 9c: Publish the help-video masters');
  const cleanup = deploy.indexOf('Step 10: Cleanup');
  assert.ok(stopPoint > 0 && publish > 0 && cleanup > 0);
  assert.ok(stopPoint < publish, 'the publish must not sit in the PM2-stopped window');
  assert.ok(publish < cleanup);
  const step = deploy.slice(publish, cleanup);
  assert.match(step, /WARNING: publishing the help-video masters failed/);
  assert.doesNotMatch(step, /\bfatal\b/, 'a failed publish must not fail a healthy deploy');
});
