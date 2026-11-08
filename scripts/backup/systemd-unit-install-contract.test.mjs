// Until 2026-11-08 nothing on the deploy path compared /etc/systemd/system with
// the release. The deploy hashed the artifact against the release tree it had
// just written — which always matched — while the units systemd actually loads
// were whatever the last pair of hands had installed.
//
// That is not hypothetical. Commit 1281f9e7e (2026-11-01 21:32) taught the WAL
// archive watch to report a warning as exit 10 and a critical verdict as 20,
// and changed leaddrive-wal-check.service away from `SuccessExitStatus=0 1 2`.
// The deploy shipped the new script to ops/current/backup/ the same evening;
// the unit on the host was dated 21:24 and stayed. For a week systemd read
// every critical verdict as the watch itself crashing and fired OnFailure, and
// not one deploy said a word.
//
// So this file tests the comparison that was missing, by running the deploy's
// own functions against staged directories — not by asserting the shape of a
// call. Two of its cases are structural on purpose, and say so.
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync, statSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const deploy = readFileSync('scripts/server-deploy.sh', 'utf8')

/** The text of a shell function in scripts/server-deploy.sh, braces included. */
function functionBody(name) {
  const start = deploy.indexOf(`${name}() {`)
  assert.ok(start > -1, `${name} must exist in scripts/server-deploy.sh`)
  const end = deploy.indexOf('\n}\n', start)
  assert.ok(end > start, `${name} must be a complete function`)
  return `${deploy.slice(start, end)}\n}`
}

/** The literal text of an array assignment, so tests use the real lists. */
function arrayAssignment(name) {
  const start = deploy.indexOf(`${name}=(`)
  assert.ok(start > -1, `${name} must exist in scripts/server-deploy.sh`)
  const end = deploy.indexOf('\n)', start)
  assert.ok(end > start, `${name} must be a complete array`)
  return `${deploy.slice(start, end)}\n)`
}

function arrayEntries(name) {
  return arrayAssignment(name)
    .replace(/^[A-Z_]+=\(/, '')
    .replace(/\)$/, '')
    .split('\n')
    .map((line) => line.replace(/#.*$/, '').trim())
    .filter(Boolean)
    .flatMap((line) => line.split(/\s+/))
    .filter((entry) => entry.endsWith('.service') || entry.endsWith('.timer'))
}

function runShell(lines) {
  const result = spawnSync('bash', ['-c', ['set -euo pipefail', ...lines].join('\n')], {
    encoding: 'utf8',
  })
  return { status: result.status, out: `${result.stdout}${result.stderr}` }
}

/**
 * A host: an /etc/systemd/system with whatever units are installed on it, and
 * a release tree with the units this deploy carries.
 */
function stageHost({ installed = {}, release = {} } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'leaddrive-systemd-units-'))
  const etc = join(root, 'etc')
  const releaseRoot = join(root, 'release')
  mkdirSync(etc, { recursive: true })
  mkdirSync(join(releaseRoot, 'systemd'), { recursive: true })
  for (const [name, body] of Object.entries(installed)) writeFileSync(join(etc, name), body)
  for (const [name, body] of Object.entries(release)) writeFileSync(join(releaseRoot, 'systemd', name), body)
  return { root, etc, releaseRoot, cleanup: () => rmSync(root, { recursive: true, force: true }) }
}

/** Every unit of the release, identical on host and in the release. */
function matchingEverywhere(extra = {}) {
  const installed = {}
  const release = {}
  for (const unit of allUnits) {
    installed[unit] = `# ${unit}\n`
    release[unit] = `# ${unit}\n`
  }
  return { installed: { ...installed, ...extra.installed }, release: { ...release, ...extra.release } }
}

const ceremonyUnits = arrayEntries('OPERATIONS_SYSTEMD_UNITS')
const managedUnits = arrayEntries('OPERATIONS_RELEASE_MANAGED_UNITS')
const allUnits = [...ceremonyUnits, ...managedUnits]

/** The real drift report, run against a staged host. */
function reportDrift({ etc, releaseRoot }, { commissioned = false } = {}) {
  return runShell([
    'log() { printf "%s\\n" "$*"; }',
    'fatal() { printf "FATAL: %s\\n" "$*"; exit 1; }',
    `operations_backup_subsystem_is_commissioned() { ${commissioned ? 'return 0' : 'return 1'}; }`,
    arrayAssignment('OPERATIONS_SYSTEMD_UNITS'),
    arrayAssignment('OPERATIONS_RELEASE_MANAGED_UNITS'),
    arrayAssignment('OPERATIONS_ALL_RELEASE_UNITS'),
    'SYSTEMD_UNITS_STATUS="not-reached"',
    `SYSTEMD_UNIT_DIR=${JSON.stringify(etc)}`,
    functionBody('report_installed_systemd_unit_drift'),
    `report_installed_systemd_unit_drift ${JSON.stringify(releaseRoot)}`,
    'echo "SUMMARY systemd-units=$SYSTEMD_UNITS_STATUS"',
  ])
}

test('every unit ops/systemd ships is classified exactly once', () => {
  const shipped = readdirSync('ops/systemd').sort()
  assert.deepEqual(
    allUnits.slice().sort(),
    shipped,
    'a unit file that is in neither group is a unit nobody installs and nobody compares — ' +
      'add it to OPERATIONS_RELEASE_MANAGED_UNITS, or to the commissioning set with its reason',
  )
  const overlap = managedUnits.filter((unit) => ceremonyUnits.includes(unit))
  assert.deepEqual(overlap, [], 'a unit cannot be both release-managed and part of the ceremony')
})

test('the ceremony group is exactly the signed recovery-program set', () => {
  // The split is not invented here: ops/backup/recovery-program-set.files is
  // what an offline drill signs, so a unit in it may only be installed by the
  // commissioning ceremony, and a unit outside it is the release's to own.
  const signed = readFileSync('ops/backup/recovery-program-set.files', 'utf8')
    .split('\n')
    .filter((line) => line.startsWith('ops/systemd/'))
    .map((line) => line.replace('ops/systemd/', ''))
    .sort()
  assert.deepEqual(ceremonyUnits.slice().sort(), signed)
  for (const unit of managedUnits) {
    assert.ok(!signed.includes(unit), `${unit} is signed; the deploy must not install it outside the ceremony`)
  }
})

test('a release-managed unit that drifted on the host is replaced by the release bytes', () => {
  // The exact 2026-11-01 regression, replayed: the host carries the unit that
  // calls exit 1 and 2 success, the release carries the one that does not.
  const stale = '[Service]\nSuccessExitStatus=0 1 2\n'
  const current = '[Service]\nSuccessExitStatus=0 10 20\n'
  const host = stageHost({
    installed: { 'leaddrive-wal-check.service': stale },
    release: { 'leaddrive-wal-check.service': current },
  })
  try {
    const target = join(host.etc, 'leaddrive-wal-check.service')
    const { status, out } = runShell([
      'fatal() { printf "FATAL: %s\\n" "$*"; exit 1; }',
      // Both asserts demand uid 0; this test is not root, and what is under
      // test is the copy-and-verify, not the ownership policy.
      'assert_root_owned_nonwritable_directory() { :; }',
      'assert_root_owned_nonwritable_file() { :; }',
      functionBody('install_operations_config_file_atomically'),
      `install_operations_config_file_atomically systemd-wal-check \\
         ${JSON.stringify(join(host.releaseRoot, 'systemd/leaddrive-wal-check.service'))} \\
         ${JSON.stringify(target)}`,
    ])
    assert.equal(status, 0, out)
    assert.equal(readFileSync(target, 'utf8'), current, 'the host must end on the release definition')
    assert.equal(statSync(target).mode & 0o777, 0o644)
    // No leftovers: the staging file must not survive next to the target.
    assert.deepEqual(
      readdirSync(host.etc),
      ['leaddrive-wal-check.service'],
      'an activation staging file was left behind in the unit directory',
    )
  } finally {
    host.cleanup()
  }
})

test('a release-managed unit that still differs after installation is fatal', () => {
  // Nothing should be able to reach this: the deploy wrote the file moments
  // earlier. If it does, /etc changed under a running activation.
  const host = stageHost(
    matchingEverywhere({ installed: { 'leaddrive-wal-check.service': '# tampered\n' } }),
  )
  try {
    const { status, out } = reportDrift(host)
    assert.equal(status, 1, out)
    assert.match(out, /FATAL: release-managed systemd unit does not match the release/)
    assert.match(out, /leaddrive-wal-check\.service/)
  } finally {
    host.cleanup()
  }
})

test('on an uncommissioned host a stale ceremony unit is named, counted, and not fatal', () => {
  // This is production today: leaddrive-log-ship.service and two more are
  // dated 2026-09-05 and differ. The deploy deliberately does not own those
  // files — their timers are disabled and their bytes are signed — so it must
  // report them and carry on, not freeze the release line over inert files.
  const host = stageHost(
    matchingEverywhere({ installed: { 'leaddrive-log-ship.service': '# from an earlier life\n' } }),
  )
  try {
    const { status, out } = reportDrift(host, { commissioned: false })
    assert.equal(status, 0, out)
    assert.match(out, /WARNING: .*leaddrive-log-ship\.service differs from this release/)
    assert.match(out, /is NOT being updated/)
    assert.match(out, /SUMMARY systemd-units=.*\bstale=1\b/)
  } finally {
    host.cleanup()
  }
})

test('on a commissioned host the same stale ceremony unit is fatal', () => {
  const host = stageHost(
    matchingEverywhere({ installed: { 'leaddrive-log-ship.service': '# from an earlier life\n' } }),
  )
  try {
    const { status, out } = reportDrift(host, { commissioned: true })
    assert.equal(status, 1, out)
    assert.match(out, /FATAL: commissioned backup systemd unit does not match the release/)
  } finally {
    host.cleanup()
  }
})

test('a ceremony unit that is absent is counted, not called a fault', () => {
  // leaddrive-runtime-files-snapshot.service and .timer are not on the host at
  // all, and that is the documented state of an uncommissioned box: the deploy
  // refuses to install them, and docs/BACKUP_RUNBOOK.md says why. Absent must
  // read differently from stale, or the report stops being read.
  const staged = matchingEverywhere()
  delete staged.installed['leaddrive-runtime-files-snapshot.service']
  delete staged.installed['leaddrive-runtime-files-snapshot.timer']
  const host = stageHost(staged)
  try {
    const { status, out } = reportDrift(host)
    assert.equal(status, 0, out)
    assert.match(out, /SUMMARY systemd-units=.*\babsent=2\b/)
    assert.ok(!/stale=/.test(out), `an absent unit must not be reported as stale: ${out}`)
  } finally {
    host.cleanup()
  }
})

test('a leaddrive unit the release does not ship is reported, the host-owned one is not', () => {
  const staged = matchingEverywhere()
  staged.installed['leaddrive-daily-backup.service'] = '# the owner’s own nightly dump\n'
  staged.installed['leaddrive-daily-backup.timer'] = '# 03:30 local\n'
  staged.installed['leaddrive-hand-placed.timer'] = '# somebody scp-ed this\n'
  const host = stageHost(staged)
  try {
    const { status, out } = reportDrift(host)
    assert.equal(status, 0, out)
    assert.match(out, /SUMMARY systemd-units=.*\bunowned=1\b/)
    assert.match(out, /leaddrive-hand-placed\.timer is not shipped by this release/)
    assert.ok(
      !/leaddrive-daily-backup/.test(out),
      `the owner's own backup timer must not be reported as drift: ${out}`,
    )
  } finally {
    host.cleanup()
  }
})

test('a host where everything matches says so and warns about nothing', () => {
  const host = stageHost(matchingEverywhere())
  try {
    const { status, out } = reportDrift(host)
    assert.equal(status, 0, out)
    assert.match(out, new RegExp(`SUMMARY systemd-units=release=${managedUnits.length}\\+${ceremonyUnits.length}$`, 'm'))
    assert.ok(!/WARNING/.test(out), out)
  } finally {
    host.cleanup()
  }
})

/**
 * Run the activation's real unit-install section. The surrounding function
 * takes locks, moves the stable pointer and reloads systemd, so the section is
 * lifted out by its own anchors and driven with a recording stub instead.
 */
function runInstallSection({ commissioned }) {
  const install = functionBody('install_release_owned_operations')
  const from = install.indexOf('  if operations_backup_subsystem_is_commissioned; then\n    for unit in "${OPERATIONS_SYSTEMD_UNITS[@]}"')
  assert.ok(from > -1, 'the commissioning-gated ceremony install loop must exist')
  const to = install.indexOf('  for rotate in "${OPERATIONS_LOGROTATE_FILES[@]}"', from)
  assert.ok(to > from, 'the unit install section must end at the logrotate loop')
  return runShell([
    'fatal() { printf "FATAL: %s\\n" "$*"; exit 1; }',
    `operations_backup_subsystem_is_commissioned() { ${commissioned ? 'return 0' : 'return 1'}; }`,
    // Record what the activation asks to be installed, rather than writing it.
    'install_operations_config_file_atomically() { printf "INSTALL %s\\n" "$1"; }',
    arrayAssignment('OPERATIONS_SYSTEMD_UNITS'),
    arrayAssignment('OPERATIONS_RELEASE_MANAGED_UNITS'),
    'release_root=/nonexistent/release',
    'SYSTEMD_UNIT_DIR=/nonexistent/etc',
    install.slice(from, to),
  ])
}

test('the release-managed units are installed whether or not the host is commissioned', () => {
  // The whole point of the split: these seven run programs this activation is
  // switching, so leaving them to a pair of hands is what rotted
  // leaddrive-wal-check.service for a week. The ceremony's eight must stay
  // gated — src/__tests__/server-deploy-uncommissioned-backup-units.test.ts
  // owns that half of the invariant.
  const plain = runInstallSection({ commissioned: false })
  assert.equal(plain.status, 0, plain.out)
  const plainInstalled = [...plain.out.matchAll(/^INSTALL systemd-(.+)$/gm)].map((m) => m[1])
  assert.deepEqual(plainInstalled.slice().sort(), managedUnits.slice().sort())

  const commissioned = runInstallSection({ commissioned: true })
  assert.equal(commissioned.status, 0, commissioned.out)
  const allInstalled = [...commissioned.out.matchAll(/^INSTALL systemd-(.+)$/gm)].map((m) => m[1])
  assert.deepEqual(allInstalled.slice().sort(), allUnits.slice().sort())
})

test('the report runs before every path out of the activation', () => {
  // Structural: the function returns in three places — bootstrap,
  // uncommissioned, commissioned — and a report placed after one of them
  // would be silent on the other two.
  const install = functionBody('install_release_owned_operations')
  const reportAt = install.indexOf('report_installed_systemd_unit_drift "$release_root"')
  assert.ok(reportAt > -1, 'the activation must report the installed units')
  assert.ok(
    !/\n  return 0\n/.test(install.slice(0, reportAt)),
    'the activation must not be able to return before the unit report',
  )
})

test('the staged ExecStart rebinding covers every release-managed service', () => {
  // systemd-analyze runs against throwaway copies whose ExecStart is rebound
  // from the stable pointer to this release. A service missing from that case
  // statement fatals as "unexpected immutable operations systemd unit", so the
  // mapping has to carry the arguments too — uploads-offsite takes --run.
  const staged = functionBody('validate_staged_operations_systemd_units')
  for (const unit of managedUnits.filter((name) => name.endsWith('.service'))) {
    assert.ok(staged.includes(`${unit})`), `${unit} has no ExecStart mapping`)
  }
  assert.match(staged, /leaddrive-uploads-offsite\.service\) script="uploads-offsite-mirror\.sh"; args=" --run"/)
  for (const unit of managedUnits.filter((name) => name.endsWith('.service'))) {
    const body = readFileSync(join('ops/systemd', unit), 'utf8')
    const execStart = body.split('\n').filter((line) => line.startsWith('ExecStart='))
    assert.equal(execStart.length, 1, `${unit} must declare exactly one ExecStart`)
    if (unit === 'leaddrive-wal-check-failed.service') continue
    assert.match(
      execStart[0],
      /^ExecStart=\/usr\/local\/lib\/leaddrive-v2\/ops\/current\/backup\//,
      `${unit} must run its program through the stable release pointer`,
    )
  }
})

test('the SUMMARY line carries the unit state', () => {
  const summary = deploy.split('\n').find((line) => line.includes('log "SUMMARY commit='))
  assert.ok(summary, 'the deploy must print a SUMMARY line')
  assert.match(summary, /systemd-units=\$SYSTEMD_UNITS_STATUS/)
})
