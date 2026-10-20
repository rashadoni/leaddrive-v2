import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

const controller = readFileSync(new URL('./commission-production-backup.sh', import.meta.url), 'utf8')
const workflow = readFileSync(new URL('../../.github/workflows/commission-production-backup.yml', import.meta.url), 'utf8')
function extract(name) {
  const matches = [...controller.matchAll(new RegExp('^' + name + '\\(\\) \\{\\n[\\s\\S]*?^\\}', 'gm'))]
  assert.equal(matches.length, 1, name)
  return matches[0][0]
}
function run(script, values = {}) {
  return spawnSync('bash', ['-c', 'set -Eeuo pipefail\n' + script], {
    env: { PATH: '/usr/bin:/bin', LC_ALL: 'C', ...values }, encoding: 'utf8', timeout: 10000,
  })
}
const globals = `
EXPECTED_RECIPIENT_SHA256='' KEY_CUSTODY_ATTESTATION='' EVIDENCE_REF='' EVIDENCE_AT_UTC=''
OFFLINE_OPERATOR='' EXPECTED_CANDIDATE_SHA256='' OWNER_RECIPIENT=''
INCOMING_EVIDENCE_BUNDLE="$TEST_ROOT/evidence" INCOMING_ALLOWED_SIGNERS="$TEST_ROOT/signers"
INCOMING_MONITORING_CONFIG="$TEST_ROOT/monitoring" INCOMING_B2_WRITER_CONFIG="$TEST_ROOT/writer"
WORKFLOW_SHA=${'a'.repeat(40)} CODE_STAGE="$TEST_ROOT" CONFIRMATION=CHECK_NATIVE_SCRATCH_TEMPLATE_ON_13_140_132_245
`

test('native preflight executes only empty-template lifecycle and proves preservation before success', () => {
  for (const mode of ['normal', 'source-drift', 'configuration-drift', 'drop-failure', 'stop-failure', 'template-failure']) {
    const root = mkdtempSync(join(tmpdir(), 'leaddrive-native-preflight-'))
    try {
      const result = run([extract('fatal'), extract('log'), extract('assert_confirmation'), extract('probe_native_scratch_template'), globals, `
trace() { echo "$1" >>"$TEST_ROOT/trace"; }
assert_root_file() { :; }
assert_backup_env() { trace env; }
cat() { echo "$WORKFLOW_SHA"; }
lock_native_preflight_runners() { trace locks; }
prepare_commission_code() { trace code; }
native_preflight_preservation_digest() {
  if [ "$TEST_MODE" = configuration-drift ] && [ -f "$TEST_ROOT/stopped" ]; then echo ${'b'.repeat(64)}; else echo ${'a'.repeat(64)}; fi
}
scratch_connection_query() {
  case "$2" in
    *pg_postmaster_start_time*) echo '123456789|2026-10-20 12:00:00+00';;
    *) if [ "$TEST_MODE" = source-drift ]; then echo 0; else echo 1; fi;;
  esac
}
node() { echo 'SELECT 1'; }
start_commission_scratch() { trace start; }
prepare_commission_scratch_template() { trace template; [ "$TEST_MODE" != template-failure ] || fatal 'expected template failure'; }
drop_commission_scratch_template() { trace drop; [ "$TEST_MODE" != drop-failure ]; }
stop_commission_scratch() { trace stop; touch "$TEST_ROOT/stopped"; [ "$TEST_MODE" != stop-failure ]; }
assert_owner_source_boundary() { trace boundary; }
release_backup_locks() { trace release; }
probe_native_scratch_template
`].join('\n'), { TEST_ROOT: root, TEST_MODE: mode })
      assert.equal(result.status === 0, mode === 'normal', result.stderr)
      assert.equal(result.stdout.includes('NATIVE_SCRATCH_PREFLIGHT=passed'), mode === 'normal')
      const steps = readFileSync(join(root, 'trace'), 'utf8').trim().split('\n')
      assert.deepEqual(steps.slice(0, 5), ['env', 'locks', 'code', 'start', 'template'])
      if (mode === 'normal') assert.deepEqual(steps, ['env', 'locks', 'code', 'start', 'template', 'drop', 'stop', 'boundary', 'release'])
      if (mode === 'drop-failure' || mode === 'template-failure') assert(!steps.includes('release'))
    } finally { rmSync(root, { recursive: true, force: true }) }
  }
})

test('native probe rejects all evidence/recipient input before any database or storage action', () => {
  const root = mkdtempSync(join(tmpdir(), 'leaddrive-native-input-'))
  try {
    for (const field of ['EXPECTED_RECIPIENT_SHA256', 'KEY_CUSTODY_ATTESTATION', 'EVIDENCE_REF', 'EVIDENCE_AT_UTC',
      'OFFLINE_OPERATOR', 'EXPECTED_CANDIDATE_SHA256', 'OWNER_RECIPIENT']) {
      const result = run([extract('fatal'), extract('assert_confirmation'), extract('probe_native_scratch_template'), globals,
        `${field}=unexpected\nprobe_native_scratch_template`].join('\n'), { TEST_ROOT: root })
      assert.notEqual(result.status, 0)
      assert(result.stderr.includes('accepts no keys'))
    }
    writeFileSync(join(root, 'evidence'), 'not private fixture')
    const result = run([extract('fatal'), extract('assert_confirmation'), extract('probe_native_scratch_template'), globals,
      'probe_native_scratch_template'].join('\n'), { TEST_ROOT: root })
    assert.notEqual(result.status, 0)
    assert(result.stderr.includes('unrelated protected inputs'))
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('preflight refuses active recovery writers and takes no schedule repair or storage route', () => {
  const result = run([extract('fatal'), extract('lock_native_preflight_runners'), `
BACKUP_SERVICE=a SECRETS_SERVICE=b RUNTIME_FILES_SERVICE=c LOG_SERVICE=d
assert_owner_source_boundary() { :; }
systemctl() { echo active; }
lock_native_preflight_runners
`].join('\n'))
  assert.notEqual(result.status, 0)
  assert(result.stderr.includes('inactive recovery services'))
  const preflight = extract('probe_native_scratch_template'), locks = extract('lock_native_preflight_runners')
  assert(!/run_verified_backup|run_transient_backup_unit|prove_object_lock|run_aws|pg_dump|pg_restore|verify_owner_key_proof|fence_backup_runner/.test(preflight))
  assert(!/systemctl (start|stop|enable|disable|mask|unmask)|install |mkdir |chmod /.test(locks))
  assert(locks.includes('flock -n "$fd"'))
  assert(locks.includes('/proc/$$/fd/$fd'))
  assert(extract('cleanup').includes('[ "$OPERATION" != probe-native-scratch ]'))
  assert(controller.includes('[ "$OPERATION" = configure-b2-writer ] || [ "$OPERATION" = probe-native-scratch ]'))
})

test('protected dispatch is current-main bound and serialized; only probe has a shorter ceiling', () => {
  for (const required of ['- probe-native-scratch', 'CHECK_NATIVE_SCRATCH_TEMPLATE_ON_13_140_132_245',
    'environment: production', 'group: production-deploy', 'cancel-in-progress: false', 'queue: max',
    'inputs.operation == \'probe-native-scratch\' && 15 || 300', '[ "$GITHUB_SHA" = "$CURRENT_MAIN_SHA" ]',
    '[ "$EXPECTED_MAIN_SHA" = "$CURRENT_MAIN_SHA" ]', '|| [ "$IN_OPERATION" = "probe-native-scratch" ]']) assert(workflow.includes(required), required)
  const launch = extract('start_commission_scratch')
  assert(launch.includes('runtime_seconds=14520'))
  assert(launch.includes('[ "$OPERATION" != probe-native-scratch ] || runtime_seconds=600'))
})

test('actual hosted preflight program syntax is parsed without starting services on DEV', () => {
  const fixture = readFileSync(new URL('./scratch-service.test.mjs', import.meta.url), 'utf8')
  const literal = fixture.match(/writeFileSync\(preflight, (`[\s\S]*?`)\)/)[1]
  const program = new Function('definitions', 'extra', 'globals', `return ${literal}`)('', '', '')
  const result = spawnSync('bash', ['-n'], { input: program, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
})
