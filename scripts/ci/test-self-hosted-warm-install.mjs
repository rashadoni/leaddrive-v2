#!/usr/bin/env node
// Small, isolated cache-contract tests: no dependency install, Prisma build,
// database, network or existing runner workspace is touched.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

const script = resolve('scripts/ci/self-hosted-warm-install.sh');

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'leaddrive-warm-test-'));
  const bin = join(root, 'bin');
  mkdirSync(bin);
  writeFileSync(join(root, 'package.json'), '{}');
  writeFileSync(join(root, 'package-lock.json'), '{}');
  writeFileSync(join(root, 'schema.prisma'), 'fixture schema');
  const executable = (name, body) => writeFileSync(join(bin, name), '#!/usr/bin/env bash\nset -eu\n' + body, { mode: 0o755 });
  executable('npm', `
if [ "\$1" = --version ]; then echo "\${TEST_NPM_VERSION:-10.0.0}"; exit; fi
printf '%s\\n' "npm \$*" >> calls
[ "\${TEST_FAIL_NPM:-0}" = 0 ] || exit 17
test "\$1" = ci
mkdir -p node_modules/prisma
printf '{"version":"1.0.0"}' > node_modules/prisma/package.json
`);
  executable('npx', `
printf '%s\\n' "npx \$*" >> calls
[ "\${TEST_FAIL_PRISMA:-0}" = 0 ] || exit 19
[ "\${TEST_NO_OUTPUT:-0}" = 0 ] || exit 0
mkdir -p "\$TEST_OUT"
echo generated > "\$TEST_OUT/index.js"
`);
  executable('node', `
if [ "\$*" = '-p process.version + "/" + process.platform + "/" + process.arch' ] && [ -n "\${TEST_RUNTIME:-}" ]; then
  echo "\$TEST_RUNTIME"; exit
fi
exec "\$REAL_NODE" "\$@"
`);
  const out = 'node_modules/.prisma/client';
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, REAL_NODE: process.execPath,
    RUNNER_ENVIRONMENT: 'self-hosted', TEST_OUT: out };
  return {
    root, out,
    write: (name, body) => writeFileSync(join(root, name), body),
    count: () => existsSync(join(root, 'calls')) ? readFileSync(join(root, 'calls'), 'utf8').trim().split('\n').length : 0,
    run(args, extra = {}, expected = 0) {
      const result = spawnSync('bash', [script, ...args], { cwd: root, env: { ...env, ...extra }, encoding: 'utf8' });
      assert.equal(result.status, expected, `${result.stdout}\n${result.stderr}`);
      return result.stdout;
    },
    clean: () => rmSync(root, { recursive: true, force: true }),
  };
}

test('dependency reuse invalidates package, lockfile, npmrc, npm, runtime and npm environment', () => {
  const f = fixture();
  try {
    f.run(['deps']);
    f.run(['deps']);
    assert.equal(f.count(), 1);
    for (const file of ['package.json', 'package-lock.json', '.npmrc']) {
      f.write(file, file === '.npmrc' ? 'legacy-peer-deps=true' : '{"changed":true}');
      const before = f.count();
      f.run(['deps']);
      f.run(['deps']);
      assert.equal(f.count(), before + 1, file);
    }
    for (const extra of [{ TEST_NPM_VERSION: '11.0.0' }, { TEST_RUNTIME: 'v99/linux/arm64' }, { npm_config_registry: 'https://registry.example.invalid' }]) {
      const before = f.count();
      f.run(['deps'], extra);
      f.run(['deps'], extra);
      assert.equal(f.count(), before + 1);
    }
    rmSync(join(f.root, 'node_modules'), { recursive: true });
    f.run(['deps']);
    assert.ok(existsSync(join(f.root, 'node_modules/.leaddrive-warm-install')));
  } finally { f.clean(); }
});

test('failed npm install cannot leave a valid cache marker', () => {
  const f = fixture();
  try {
    f.run(['deps']);
    f.write('package-lock.json', '{"changed":true}');
    f.run(['deps'], { TEST_FAIL_NPM: '1' }, 17);
    assert.equal(existsSync(join(f.root, 'node_modules/.leaddrive-warm-install')), false);
    f.run(['deps']);
    assert.equal(f.count(), 3);
  } finally { f.clean(); }
});

test('Prisma reuse invalidates schema, dependency inputs, version and missing output', () => {
  const f = fixture();
  try {
    f.run(['deps']);
    const args = ['prisma', 'schema.prisma', f.out];
    f.run(args); f.run(args);
    assert.equal(f.count(), 2);
    for (const [file, body] of [['schema.prisma', 'new schema'], ['package-lock.json', '{"changed":true}'], ['node_modules/prisma/package.json', '{"version":"2.0.0"}']]) {
      f.write(file, body);
      const before = f.count();
      f.run(args); f.run(args);
      assert.equal(f.count(), before + 1, file);
    }
    rmSync(join(f.root, f.out), { recursive: true });
    f.run(args);
    assert.ok(existsSync(join(f.root, f.out, '.leaddrive-warm-generate')));
  } finally { f.clean(); }
});

test('failed Prisma and missing generated output cannot be certified', () => {
  const f = fixture();
  try {
    f.run(['deps']);
    const args = ['prisma', 'schema.prisma', f.out];
    f.run(args);
    f.write('schema.prisma', 'changed schema');
    f.run(args, { TEST_FAIL_PRISMA: '1' }, 19);
    assert.equal(existsSync(join(f.root, f.out, '.leaddrive-warm-generate')), false);
    rmSync(join(f.root, f.out), { recursive: true });
    f.run(args, { TEST_NO_OUTPUT: '1' }, 1);
    assert.equal(existsSync(join(f.root, f.out, '.leaddrive-warm-generate')), false);
    f.run(args);
    assert.ok(existsSync(join(f.root, f.out, '.leaddrive-warm-generate')));
  } finally { f.clean(); }
});

test('hosted runners are rejected before any install', () => {
  const f = fixture();
  try {
    f.run(['deps'], { RUNNER_ENVIRONMENT: 'github-hosted' }, 1);
    assert.equal(f.count(), 0);
  } finally { f.clean(); }
});
