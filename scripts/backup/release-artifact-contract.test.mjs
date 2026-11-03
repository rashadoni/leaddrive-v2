// The release artifact in object storage is what makes a full restore
// independent of GitHub. These tests run the upload and the restore against a
// stub `aws` backed by a real directory, so the round trip is exercised: bytes
// in, bytes out, digests compared. Asserting the shape of the aws calls would
// only prove we sent what we meant to send.
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const upload = readFileSync('scripts/backup/release-artifact-upload.sh', 'utf8');
const restore = readFileSync('scripts/backup/release-artifact-restore.sh', 'utf8');
const deployScript = readFileSync('scripts/server-deploy.sh', 'utf8');
const check = readFileSync('scripts/backup/wal-archive-check.sh', 'utf8');
const envExample = readFileSync('ops/backup/wal-archive.env.example', 'utf8');

// A stub `aws` over a directory: cp both ways, head-object from a sidecar
// written at upload time, list-objects-v2, rm. Enough to be a bucket — and a
// VERSIONED one, because that is the property the pruning depends on: live
// bytes in objects/, superseded bytes in noncurrent/, delete markers in
// markers/. A stub without versions would have called hiding an object
// "freeing space", which is exactly the mistake that tripped the storage cap
// on production.
const STUB = `#!/usr/bin/env bash
set -Eeuo pipefail
bucket_dir="$FAKE_BUCKET"
args=("$@")
svc="\${args[0]}"
op="\${args[1]}"
key_of() { printf '%s' "\${1#s3://*/}"; }
stash_current() {
  local k="\$1" vid
  [ -f "\$bucket_dir/objects/\$k" ] || return 0
  vid="\$(date -u +%s%N)-\$RANDOM"
  mkdir -p "\$bucket_dir/noncurrent/\$k"
  mv -- "\$bucket_dir/objects/\$k" "\$bucket_dir/noncurrent/\$k/\$vid"
  rm -f -- "\$bucket_dir/meta/\$k" "\$bucket_dir/meta/\$k.when"
}
mark_deleted() {
  local k="\$1"
  mkdir -p "\$(dirname "\$bucket_dir/markers/\$k")"
  : > "\$bucket_dir/markers/\$k"
}
get_opt() {
  local want="$1"; shift
  local i
  for ((i = 0; i < \${#args[@]}; i++)); do
    if [ "\${args[i]}" = "--\$want" ]; then printf '%s' "\${args[i+1]}"; return 0; fi
  done
  return 1
}
if [ "\$svc" = s3 ] && [ "\$op" = cp ]; then
  src="\${args[2]}"; dst="\${args[3]}"
  if [ "\${src#s3://}" != "\$src" ]; then
    k="\$(key_of "\$src")"
    [ -f "\$bucket_dir/objects/\$k" ] || { echo "NoSuchKey \$k" >&2; exit 1; }
    mkdir -p "\$(dirname "\$dst")"; cp -- "\$bucket_dir/objects/\$k" "\$dst"
  else
    k="\$(key_of "\$dst")"
    stash_current "\$k"
    rm -f -- "\$bucket_dir/markers/\$k"
    mkdir -p "\$(dirname "\$bucket_dir/objects/\$k")" "\$(dirname "\$bucket_dir/meta/\$k")"
    cp -- "\$src" "\$bucket_dir/objects/\$k"
    meta="\$(get_opt metadata || true)"
    printf '%s' "\$meta" > "\$bucket_dir/meta/\$k"
    date -u +%FT%T.000Z > "\$bucket_dir/meta/\$k.when"
  fi
  exit 0
fi
if [ "\$svc" = s3api ] && [ "\$op" = head-object ]; then
  k="\$(get_opt key)"
  [ -f "\$bucket_dir/objects/\$k" ] || { echo "Not Found" >&2; exit 254; }
  size="\$(stat -c %s -- "\$bucket_dir/objects/\$k")"
  [ -z "\${FAKE_HEAD_SIZE:-}" ] || size="\$FAKE_HEAD_SIZE"
  meta="\$(cat "\$bucket_dir/meta/\$k" 2>/dev/null || true)"
  sha="\$(printf '%s' "\$meta" | tr ',' '\\n' | awk -F= '\$1=="sha256"{print \$2}')"
  dsha="\$(printf '%s' "\$meta" | tr ',' '\\n' | awk -F= '\$1=="deploysha"{print \$2}')"
  [ -z "\${FAKE_HEAD_SHA:-}" ] || sha="\$FAKE_HEAD_SHA"
  printf '{"ContentLength": %s, "Metadata": {"sha256": "%s", "deploysha": "%s"}}\\n' "\$size" "\$sha" "\$dsha"
  exit 0
fi
if [ "\$svc" = s3api ] && [ "\$op" = list-objects-v2 ]; then
  prefix="\$(get_opt prefix)"
  printf '{"Contents": ['
  first=1
  while IFS= read -r f; do
    k="\${f#\$bucket_dir/objects/}"
    case "\$k" in "\$prefix"*) ;; *) continue ;; esac
    when="\$(cat "\$bucket_dir/meta/\$k.when" 2>/dev/null || echo 1970-01-01T00:00:00.000Z)"
    [ "\$first" = 1 ] || printf ','
    printf '{"Key": "%s", "LastModified": "%s"}' "\$k" "\$when"
    first=0
  done < <(find "\$bucket_dir/objects" -type f 2>/dev/null | sort)
  printf ']}\\n'
  exit 0
fi
if [ "\$svc" = s3 ] && [ "\$op" = rm ]; then
  k="\$(key_of "\${args[2]}")"
  stash_current "\$k"
  mark_deleted "\$k"
  exit 0
fi
if [ "\$svc" = s3api ] && [ "\$op" = list-object-versions ]; then
  [ -z "\${FAKE_NO_VERSIONS:-}" ] || { echo "AccessDenied" >&2; exit 254; }
  prefix="\$(get_opt prefix || true)"
  printf '{"Versions": ['
  first=1
  while IFS= read -r f; do
    k="\${f#\$bucket_dir/objects/}"
    case "\$k" in "\$prefix"*) ;; *) continue ;; esac
    [ "\$first" = 1 ] || printf ','
    printf '{"Key": "%s", "VersionId": "current", "IsLatest": true, "Size": %s}' \
      "\$k" "\$(stat -c %s -- "\$f")"
    first=0
  done < <(find "\$bucket_dir/objects" -type f 2>/dev/null | sort)
  while IFS= read -r f; do
    rel="\${f#\$bucket_dir/noncurrent/}"
    k="\${rel%/*}"
    vid="\${rel##*/}"
    case "\$k" in "\$prefix"*) ;; *) continue ;; esac
    [ "\$first" = 1 ] || printf ','
    printf '{"Key": "%s", "VersionId": "%s", "IsLatest": false, "Size": %s}' \
      "\$k" "\$vid" "\$(stat -c %s -- "\$f")"
    first=0
  done < <(find "\$bucket_dir/noncurrent" -type f 2>/dev/null | sort)
  printf '], "DeleteMarkers": ['
  first=1
  while IFS= read -r f; do
    k="\${f#\$bucket_dir/markers/}"
    case "\$k" in "\$prefix"*) ;; *) continue ;; esac
    [ "\$first" = 1 ] || printf ','
    printf '{"Key": "%s", "VersionId": "marker", "IsLatest": true}' "\$k"
    first=0
  done < <(find "\$bucket_dir/markers" -type f 2>/dev/null | sort)
  printf ']}\\n'
  exit 0
fi
if [ "\$svc" = s3api ] && [ "\$op" = delete-object ]; then
  k="\$(get_opt key)"
  vid="\$(get_opt version-id || true)"
  case "\$vid" in
    '') stash_current "\$k"; mark_deleted "\$k" ;;
    current) rm -f -- "\$bucket_dir/objects/\$k" "\$bucket_dir/meta/\$k" "\$bucket_dir/meta/\$k.when" ;;
    marker) rm -f -- "\$bucket_dir/markers/\$k" ;;
    *)
      [ -f "\$bucket_dir/noncurrent/\$k/\$vid" ] || { echo "NoSuchVersion" >&2; exit 254; }
      rm -f -- "\$bucket_dir/noncurrent/\$k/\$vid"
      ;;
  esac
  exit 0
fi
if [ "\$svc" = s3 ] && [ "\$op" = ls ]; then
  find "\$bucket_dir/objects" -type f 2>/dev/null | sed "s|\$bucket_dir/objects/||"
  exit 0
fi
echo "stub aws: unsupported \$svc \$op" >&2
exit 2
`;

function makeWorld() {
  const dir = mkdtempSync(join(tmpdir(), 'leaddrive-artifact-'));
  const bucket = join(dir, 'bucket');
  for (const sub of ['objects', 'meta', 'noncurrent', 'markers']) {
    mkdirSync(join(bucket, sub), { recursive: true });
  }
  const stub = join(dir, 'aws');
  writeFileSync(stub, STUB);
  chmodSync(stub, 0o755);
  const env = join(dir, 'env');
  writeFileSync(
    env,
    [
      'WAL_REPO_BUCKET=test-bucket',
      'WAL_REPO_ENDPOINT=s3.example.invalid',
      'WAL_REPO_REGION=eu-central-003',
      'WAL_REPO_PATH=/pgbackrest',
      'WAL_REPO_KEY=key',
      'WAL_REPO_KEY_SECRET=secret',
      'WAL_ARTIFACT_PREFIX=artifacts',
      'WAL_ARTIFACT_KEEP=2',
      '',
    ].join('\n'),
  );
  return { dir, bucket, stub, env };
}

function makeTarball(dir, name, content) {
  const path = join(dir, name);
  const payload = join(dir, `${name}.payload`);
  writeFileSync(payload, content);
  execFileSync('bash', ['-c', `gzip -c -- "${payload}" > "${path}"`]);
  return path;
}

function run(script, args, world, extraEnv = {}) {
  try {
    const stdout = execFileSync('bash', [script, ...args], {
      encoding: 'utf8',
      env: {
        ...process.env,
        WAL_ENV_FILE: world.env,
        AWS_BIN: world.stub,
        FAKE_BUCKET: world.bucket,
        ...extraEnv,
      },
    });
    return { status: 0, stdout };
  } catch (error) {
    return { status: error.status ?? 1, stdout: `${error.stdout ?? ''}${error.stderr ?? ''}` };
  }
}

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);
const SHA_C = 'c'.repeat(40);

test('an uploaded artifact comes back byte for byte', () => {
  const world = makeWorld();
  try {
    const tar = makeTarball(world.dir, 'release.tar.gz', 'это содержимое релиза\n'.repeat(400));
    const up = run('scripts/backup/release-artifact-upload.sh', ['--tarball', tar, '--sha', SHA_A], world);
    assert.equal(up.status, 0, up.stdout);
    assert.match(up.stdout, /SUMMARY artifact-upload sha=a{40} bytes=\d+ removed=0/);

    const dest = join(world.dir, 'fetched.tar.gz');
    const down = run('scripts/backup/release-artifact-restore.sh', ['--dest', dest], world);
    assert.equal(down.status, 0, down.stdout);
    // No --sha given: it must follow the pointer production wrote.
    assert.match(down.stdout, /pointer names a{40}/);
    assert.match(down.stdout, /verified against the pointer recorded at upload/);
    assert.equal(statSync(dest).size, statSync(tar).size);
    assert.equal(
      execFileSync('sha256sum', [dest], { encoding: 'utf8' }).split(' ')[0],
      execFileSync('sha256sum', [tar], { encoding: 'utf8' }).split(' ')[0],
    );
  } finally {
    rmSync(world.dir, { recursive: true, force: true });
  }
});

test('an upload that stored something else fails instead of reporting success', () => {
  // The whole point of reading the object back: a restore must not discover a
  // truncated artifact at the worst possible moment.
  const world = makeWorld();
  try {
    const tar = makeTarball(world.dir, 'release.tar.gz', 'x'.repeat(5000));
    const bad = run('scripts/backup/release-artifact-upload.sh', ['--tarball', tar, '--sha', SHA_A], world, {
      FAKE_HEAD_SIZE: '12',
    });
    assert.notEqual(bad.status, 0);
    assert.match(bad.stdout, /size mismatch/);

    const wrongDigest = run('scripts/backup/release-artifact-upload.sh', ['--tarball', tar, '--sha', SHA_A], world, {
      FAKE_HEAD_SHA: 'f'.repeat(64),
    });
    assert.notEqual(wrongDigest.status, 0);
    assert.match(wrongDigest.stdout, /sha256 metadata differs/);
  } finally {
    rmSync(world.dir, { recursive: true, force: true });
  }
});

test('a corrupted download is refused, not handed to the operator', () => {
  const world = makeWorld();
  try {
    const tar = makeTarball(world.dir, 'release.tar.gz', 'настоящий релиз\n'.repeat(200));
    assert.equal(run('scripts/backup/release-artifact-upload.sh', ['--tarball', tar, '--sha', SHA_A], world).status, 0);
    // Rot the stored object, leaving the pointer intact.
    writeFileSync(join(world.bucket, 'objects/artifacts', `${SHA_A}.tar.gz`), 'мусор');
    const down = run('scripts/backup/release-artifact-restore.sh', ['--dest', join(world.dir, 'out.tar.gz')], world);
    assert.notEqual(down.status, 0);
    assert.match(down.stdout, /sha256 differs from the pointer/);
  } finally {
    rmSync(world.dir, { recursive: true, force: true });
  }
});

// How many bytes the bucket still holds in one area. The question pruning has
// to answer is about bytes, not about what a listing shows.
function areaBytes(bucket, area) {
  const out = execFileSync(
    'bash',
    ['-c', `find ${join(bucket, area)} -type f -printf '%s\\n' 2>/dev/null | awk '{s+=$1} END {print s+0}'`],
    { encoding: 'utf8' },
  );
  return Number(out.trim());
}

function areaFiles(bucket, area) {
  return execFileSync('bash', ['-c', `find ${join(bucket, area)} -type f 2>/dev/null | sort`], { encoding: 'utf8' });
}

test('pruning keeps the newest artifacts and never touches the pointer', () => {
  const world = makeWorld();
  try {
    for (const sha of [SHA_A, SHA_B, SHA_C]) {
      const tar = makeTarball(world.dir, `r-${sha.slice(0, 3)}.tar.gz`, `release ${sha}\n`.repeat(50));
      const up = run('scripts/backup/release-artifact-upload.sh', ['--tarball', tar, '--sha', sha], world);
      assert.equal(up.status, 0, up.stdout);
      execFileSync('sleep', ['1.1']);
    }
    const listing = execFileSync('bash', ['-c', `ls ${join(world.bucket, 'objects/artifacts')}`], { encoding: 'utf8' });
    // WAL_ARTIFACT_KEEP=2, so the oldest tarball is gone and current.env stays.
    assert.ok(listing.includes('current.env'), `pointer was pruned: ${listing}`);
    assert.ok(!listing.includes(`${SHA_A}.tar.gz`), `oldest artifact survived: ${listing}`);
    assert.ok(listing.includes(`${SHA_C}.tar.gz`), `newest artifact missing: ${listing}`);
    // And the pointer still resolves to the newest upload.
    const dest = join(world.dir, 'newest.tar.gz');
    const down = run('scripts/backup/release-artifact-restore.sh', ['--dest', dest], world);
    assert.equal(down.status, 0, down.stdout);
    assert.match(down.stdout, new RegExp(`pointer names ${SHA_C}`));
  } finally {
    rmSync(world.dir, { recursive: true, force: true });
  }
});

test('pruning frees the bytes; hiding the object would not', () => {
  // 2026-11-03: `s3 rm` in a versioned bucket only hides, and a day of deploys
  // left 6.05 GiB of hidden tarballs against 0.86 GiB live. The account's
  // storage cap tripped and production could not archive WAL for three hours.
  // So the assertion is about the bytes the bucket still holds, not about what
  // a listing shows.
  const world = makeWorld();
  try {
    let last = null;
    for (const sha of [SHA_A, SHA_B, SHA_C]) {
      const tar = makeTarball(world.dir, `r-${sha.slice(0, 3)}.tar.gz`, `release ${sha}\n`.repeat(50));
      last = run('scripts/backup/release-artifact-upload.sh', ['--tarball', tar, '--sha', sha], world);
      assert.equal(last.status, 0, last.stdout);
      execFileSync('sleep', ['1.1']);
    }
    // The run that pruned says how much it actually took back.
    const summary = last.stdout.match(/SUMMARY artifact-upload .*versions=(\d+) freed=(\d+)/);
    assert.ok(summary, `no versions/freed in the summary: ${last.stdout}`);
    assert.ok(Number(summary[1]) >= 1, `nothing was purged: ${last.stdout}`);
    assert.ok(Number(summary[2]) > 0, `nothing was freed: ${last.stdout}`);

    assert.equal(areaBytes(world.bucket, 'noncurrent'), 0, `bytes stayed hidden: ${areaFiles(world.bucket, 'noncurrent')}`);
    assert.equal(areaFiles(world.bucket, 'markers'), '', 'a delete marker was left behind instead of purging');
    const live = areaFiles(world.bucket, 'objects');
    assert.ok(!live.includes(`${SHA_A}.tar.gz`), `oldest artifact survived: ${live}`);
    assert.ok(live.includes(`${SHA_C}.tar.gz`) && live.includes('current.env'), `wrong survivors: ${live}`);
  } finally {
    rmSync(world.dir, { recursive: true, force: true });
  }
});

test('the pointer does not pile up its own superseded versions', () => {
  // current.env is rewritten on every deploy, so it leaks at exactly the same
  // rate as the artifacts — 29 dead copies by 2026-11-03 — and the live one
  // must still be the live one afterwards.
  const world = makeWorld();
  try {
    for (const sha of [SHA_A, SHA_B, SHA_C]) {
      const tar = makeTarball(world.dir, `p-${sha.slice(0, 3)}.tar.gz`, `release ${sha}\n`.repeat(20));
      assert.equal(run('scripts/backup/release-artifact-upload.sh', ['--tarball', tar, '--sha', sha], world).status, 0);
      execFileSync('sleep', ['1.1']);
    }
    const hidden = areaFiles(world.bucket, 'noncurrent');
    assert.ok(!hidden.includes('current.env'), `superseded pointers kept their bytes: ${hidden}`);
    const down = run('scripts/backup/release-artifact-restore.sh', ['--dest', join(world.dir, 'newest.tar.gz')], world);
    assert.equal(down.status, 0, down.stdout);
    assert.match(down.stdout, new RegExp(`pointer names ${SHA_C}`));
  } finally {
    rmSync(world.dir, { recursive: true, force: true });
  }
});

test('a bucket that will not list versions still gets the old artifact out of the way', () => {
  // Fallback, and it has to be loud: a kept artifact is a wrong restore, while
  // hidden bytes are a slow leak towards the cap. Both are worse in silence.
  const world = makeWorld();
  try {
    let last = null;
    for (const [index, sha] of [SHA_A, SHA_B, SHA_C].entries()) {
      const tar = makeTarball(world.dir, `f-${sha.slice(0, 3)}.tar.gz`, `release ${sha}\n`.repeat(30));
      const extra = index === 2 ? { FAKE_NO_VERSIONS: '1' } : {};
      last = run('scripts/backup/release-artifact-upload.sh', ['--tarball', tar, '--sha', sha], world, extra);
      assert.equal(last.status, 0, last.stdout);
      execFileSync('sleep', ['1.1']);
    }
    assert.match(last.stdout, /WARNING hid artifacts\/a{40}\.tar\.gz without purging its versions/);
    assert.match(last.stdout, /SUMMARY artifact-upload .*removed=1 versions=0 freed=0/);
    const live = areaFiles(world.bucket, 'objects');
    assert.ok(!live.includes(`${SHA_A}.tar.gz`), `the old artifact is still restorable: ${live}`);
    assert.ok(areaFiles(world.bucket, 'noncurrent').includes(`${SHA_A}.tar.gz`), 'the fallback lost the bytes silently');
  } finally {
    rmSync(world.dir, { recursive: true, force: true });
  }
});

test('the artifact prefix can never collide with the pgBackRest repository', () => {
  // Pruning artifacts inside the pgBackRest path would delete WAL, which is
  // the one thing in that bucket nothing can rebuild.
  const world = makeWorld();
  try {
    writeFileSync(
      world.env,
      readFileSync(world.env, 'utf8').replace('WAL_ARTIFACT_PREFIX=artifacts', 'WAL_ARTIFACT_PREFIX=pgbackrest'),
    );
    const tar = makeTarball(world.dir, 'release.tar.gz', 'x'.repeat(100));
    const up = run('scripts/backup/release-artifact-upload.sh', ['--tarball', tar, '--sha', SHA_A], world);
    assert.notEqual(up.status, 0);
    assert.match(up.stdout, /collides with the pgBackRest repo path/);
  } finally {
    rmSync(world.dir, { recursive: true, force: true });
  }
});

test('nonsense arguments are refused before anything is uploaded', () => {
  const world = makeWorld();
  try {
    const tar = makeTarball(world.dir, 'release.tar.gz', 'x'.repeat(100));
    assert.notEqual(run('scripts/backup/release-artifact-upload.sh', ['--tarball', tar, '--sha', 'нет'], world).status, 0);
    assert.notEqual(run('scripts/backup/release-artifact-upload.sh', ['--tarball', '/nope', '--sha', SHA_A], world).status, 0);
    assert.notEqual(run('scripts/backup/release-artifact-restore.sh', ['--sha', 'нет'], world).status, 0);
    const listing = execFileSync('bash', ['-c', `ls ${join(world.bucket, 'objects')} 2>/dev/null || true`], { encoding: 'utf8' });
    assert.equal(listing.trim(), '', `something was uploaded despite bad arguments: ${listing}`);
  } finally {
    rmSync(world.dir, { recursive: true, force: true });
  }
});

test('the deploy copies the artifact after the health checks and before the cleanup', () => {
  // Order is the whole design: after the checks so the backup holds what
  // actually served traffic, before Step 10 so the tarball still exists.
  const step = deployScript.indexOf('Step 9b: Keep a runnable artifact outside GitHub');
  const cleanup = deployScript.indexOf('Step 10: Cleanup');
  const rollback = deployScript.indexOf('Step 7: Rollback if unhealthy');
  assert.ok(step > 0 && cleanup > 0 && rollback > 0);
  assert.ok(rollback < step, 'the artifact must be copied after the health gate');
  assert.ok(step < cleanup, 'the artifact must be copied before the tarball is deleted');
  assert.match(deployScript, /ARTIFACT_UPLOAD_SCRIPT="\$OPS_CURRENT_LINK\/backup\/release-artifact-upload\.sh"/);
});

test('a failed copy does not fail the deploy but is not silent either', () => {
  // The release is healthy; the backup copy is a separate concern. It is the
  // watch that must notice, by state, that the bucket has no artifact.
  const step = deployScript.slice(
    deployScript.indexOf('Step 9b: Keep a runnable artifact outside GitHub'),
    deployScript.indexOf('Step 10: Cleanup'),
  );
  assert.match(step, /WARNING: copying the release artifact to object storage failed/);
  assert.doesNotMatch(step, /\bfatal\b/);
  assert.match(check, /no release artifact in the bucket for the live release/);
  assert.match(check, /note warn "no release artifact/);
});

test('the watch gives a fresh release time to be copied', () => {
  // The deploy copies minutes after the swap; warning inside that window would
  // make the alarm normal, and a normal alarm is ignored.
  assert.match(check, /WAL_ARTIFACT_GRACE_SECONDS:=1800/);
  assert.match(check, /release_age" -ge "\$WAL_ARTIFACT_GRACE_SECONDS/);
  assert.match(envExample, /^WAL_ARTIFACT_GRACE_SECONDS=1800$/m);
  assert.match(envExample, /^WAL_ARTIFACT_PREFIX=artifacts$/m);
  assert.match(envExample, /^WAL_ARTIFACT_KEEP=5$/m);
});

test('the restore script never writes to the bucket', () => {
  // A restore runs in the worst hour; it must not be able to make things worse.
  assert.doesNotMatch(restore, /\bs3 rm\b/);
  assert.doesNotMatch(restore, /\bs3 mv\b/);
  assert.doesNotMatch(restore, /s3 cp "[^"]*" "s3:/);
  assert.match(restore, /gzip -t/);
});
