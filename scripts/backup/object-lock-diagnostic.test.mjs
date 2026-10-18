import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

const root = new URL('../../', import.meta.url)
const source = readFileSync(new URL('scripts/backup/report-production-readiness.sh', root), 'utf8')
const functions = [...source.matchAll(/^read_object_lock_diagnostic\(\) \{\n[\s\S]*?^\}/gm)]
assert.equal(functions.length, 1, 'exercise exactly the actual read-only probe, never source the operational script')
const probe = functions[0][0]
const canaries = [
  'SYNTHETIC_LOCK_ENDPOINT.invalid', 'synthetic-lock-bucket-canary',
  'SYNTHETIC_LOCK_ACCESS', 'SYNTHETIC_LOCK_SECRET', 'SYNTHETIC_REQUEST_ID',
]
const privateText = canaries.join(' ')
const compliant = 'Enabled\tCOMPLIANCE\t14\n'

function execute({ stdout = '', stderr = '', status = 0, sleepSeconds = 0,
  ignoreTerm = false, deadlines, expectedFunctionStatus = 0 } = {}) {
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'leaddrive-object-lock-diagnostic-'))
  try {
    const aws = join(fixtureRoot, 'synthetic-aws')
    const receipt = join(fixtureRoot, 'invocation.json')
    const program = `#!/usr/bin/python3
import base64, json, os, signal, sys, time
with open(${JSON.stringify(receipt)}, "x") as target:
    json.dump({"args": sys.argv[1:], "env": dict(os.environ), "pid": os.getpid()}, target)
if ${ignoreTerm ? 'True' : 'False'}:
    signal.signal(signal.SIGTERM, signal.SIG_IGN)
sys.stdout.buffer.write(base64.b64decode("${Buffer.from(stdout).toString('base64')}"))
sys.stdout.buffer.flush()
sys.stderr.buffer.write(base64.b64decode("${Buffer.from(stderr).toString('base64')}"))
sys.stderr.buffer.flush()
time.sleep(${sleepSeconds})
sys.exit(${status})
`
    writeFileSync(aws, program, { mode: 0o700, flag: 'wx' })
    chmodSync(aws, 0o700)
    // Rescale ONLY the literal deadlines in these two real-timeout fixtures.
    // The production command/bounds are separately asserted unchanged below.
    const subject = deadlines ? probe
      .replace('timeout --kill-after=5 45', `timeout --kill-after=0.1 ${deadlines.cli}`)
      .replace('timeout --kill-after=5 55', `timeout --kill-after=0.1 ${deadlines.parser}`) : probe
    const result = spawnSync('/bin/bash', ['--noprofile', '--norc', '-c', `
set -euo pipefail
AWS_BIN="$1"
declare -A CONFIG=(
  [BACKUP_S3_ENDPOINT]='https://SYNTHETIC_LOCK_ENDPOINT.invalid'
  [BACKUP_S3_REGION]='synthetic-region'
  [BACKUP_S3_BUCKET]='synthetic-lock-bucket-canary'
  [AWS_ACCESS_KEY_ID]='SYNTHETIC_LOCK_ACCESS'
  [AWS_SECRET_ACCESS_KEY]='SYNTHETIC_LOCK_SECRET'
)
${subject}
read_object_lock_diagnostic
`, 'object-lock-diagnostic-test', aws], {
      cwd: fixtureRoot,
      encoding: 'utf8',
      timeout: 8_000,
      maxBuffer: 16_384,
      // Never inherit production variables, a shell startup hook or credentials.
      env: { PATH: '/usr/bin:/bin', LC_ALL: 'C', AWS_PROFILE: 'synthetic-must-not-propagate' },
    })
    assert.ifError(result.error)
    assert.equal(result.signal, null)
    assert.equal(result.status, expectedFunctionStatus, 'the expected real path must execute, not an absent dependency')
    assert.equal(result.stderr, '', 'private CLI errors must not escape the pipe')
    for (const canary of canaries) {
      assert.equal(result.stdout.includes(canary), false, 'never print endpoint, bucket, keys or request IDs')
      assert.equal(result.stderr.includes(canary), false)
    }
    const invocation = JSON.parse(readFileSync(receipt, 'utf8'))
    assert.throws(() => process.kill(invocation.pid, 0), { code: 'ESRCH' }, 'the exact synthetic CLI process must not survive the probe')
    assert.deepEqual(invocation.args, [
      's3api', 'get-object-lock-configuration',
      '--endpoint-url', 'https://SYNTHETIC_LOCK_ENDPOINT.invalid',
      '--region', 'synthetic-region', '--no-cli-pager',
      '--bucket', 'synthetic-lock-bucket-canary',
      '--query', 'ObjectLockConfiguration.[ObjectLockEnabled,Rule.DefaultRetention.Mode,Rule.DefaultRetention.Days]',
      '--output', 'text',
    ], 'one exact read-only API invocation, no policy/retention/upload mutation')
    assert.equal(invocation.env.AWS_PROFILE, undefined)
    assert.equal(invocation.env.AWS_CONFIG_FILE, '/dev/null')
    assert.equal(invocation.env.AWS_SHARED_CREDENTIALS_FILE, '/dev/null')
    assert.equal(invocation.env.AWS_EC2_METADATA_DISABLED, 'true')
    assert.equal(invocation.env.AWS_MAX_ATTEMPTS, '1')
    assert.equal(invocation.env.AWS_CLI_AUTO_PROMPT, 'off')
    assert.equal(invocation.env.AWS_ACCESS_KEY_ID, 'SYNTHETIC_LOCK_ACCESS')
    assert.equal(invocation.env.AWS_SECRET_ACCESS_KEY, 'SYNTHETIC_LOCK_SECRET')
    return result.stdout.trim()
  } finally {
    // Only this exact directory, created above for disposable synthetic fixtures.
    rmSync(fixtureRoot, { recursive: true, force: true })
  }
}

test('requires successful CLI and exact Enabled/COMPLIANCE/minimum14 response', () => {
  for (const stdout of [compliant, 'Enabled\tCOMPLIANCE\t400\n', 'Enabled\tCOMPLIANCE\t14\r\n']) {
    assert.equal(execute({ stdout }), 'verified')
  }
  for (const stdout of ['Enabled\tCOMPLIANCE\t13\n', 'Enabled\tGOVERNANCE\t400\n',
    'Disabled\tCOMPLIANCE\t14\n', 'Enabled\tNone\tNone\n', 'Enabled\tCOMPLIANCE\t-14\n',
    'Enabled\tCOMPLIANCE\t1e2\n', 'Enabled\tCOMPLIANCE\t99999999999999999999\n']) {
    assert.equal(execute({ stdout }), 'policy_mismatch')
  }
})

test('rejects empty, malformed, multi-line and success-looking failed responses', () => {
  for (const stdout of ['', 'Enabled COMPLIANCE 14\n', 'Enabled\tCOMPLIANCE\t14\textra\n',
    `${compliant}${compliant}`, `${compliant}${privateText}\n`]) {
    assert.equal(execute({ stdout }), 'invalid_response')
  }
  assert.equal(execute({ stdout: compliant, status: 254 }), 'service_error_format_unrecognized')
  assert.equal(execute({ stdout: compliant, status: 255 }), 'unknown_failure')
  assert.equal(execute({ stdout: compliant, status: 124 }), 'request_timeout')
  assert.equal(execute({ stdout: `${compliant}\0LEADDRIVE_CLI_EXIT=0\0`, status: 254 }), 'service_error_format_unrecognized')
})

test('emits only allowlisted reported service categories without error body', () => {
  const cases = [
    ['AccessDenied', 'access_denied'], ['InvalidAccessKeyId', 'credentials_rejected'],
    ['SignatureDoesNotMatch', 'credentials_rejected'], ['ExpiredToken', 'credentials_rejected'],
    ['NoSuchBucket', 'bucket_not_found'],
    ['ObjectLockConfigurationNotFoundError', 'lock_configuration_missing'],
    ['NotImplemented', 'operation_unsupported'], ['UnsupportedOperation', 'operation_unsupported'],
    ['AuthorizationHeaderMalformed', 'auth_request_rejected'],
    ['AuthorizationQueryParametersError', 'auth_request_rejected'],
    ['RequestTimeTooSkewed', 'request_time_rejected'],
    ['IncorrectEndpoint', 'routing_rejected'], ['IllegalLocationConstraintException', 'routing_rejected'],
    ['PermanentRedirect', 'routing_rejected'], ['TemporaryRedirect', 'routing_rejected'],
    ['InvalidRequest', 'request_rejected'], ['InvalidArgument', 'request_rejected'],
    ['InvalidBucketState', 'bucket_state_rejected'], ['InternalError', 'provider_failure'],
    ['ServiceUnavailable', 'provider_failure'], ['SlowDown', 'throttled'],
    ['UnknownSensitiveCode', 'service_code_unrecognized'],
    // Even a secret-looking unknown code must never be printed verbatim.
    ['SYNTHETICLOCKSECRET', 'service_code_unrecognized'],
  ]
  for (const [code, expected] of cases) {
    const stderr = `\nAn error occurred (${code}) when calling the GetObjectLockConfiguration operation: ${privateText}\n`
    const output = execute({ stderr, status: 254 })
    assert.equal(output, expected)
    assert.equal(output.includes(code), false)
  }
  for (const stderr of [
    `An error occurred (AccessDenied) when calling the PutObject operation: ${privateText}`,
    `prefix An error occurred (AccessDenied) when calling the GetObjectLockConfiguration operation: ${privateText}`,
    `An error occurred (InternalError\nAccessDenied) when calling the GetObjectLockConfiguration operation: ${privateText}`,
    `An error occurred (AccessDenied) when calling the GetObjectLockConfiguration\noperation: ${privateText}`,
    privateText,
  ]) assert.equal(execute({ stderr, status: 254 }), 'service_error_format_unrecognized')
})

test('distinguishes local TLS/network/CLI/timeout failures without inventing a cause', () => {
  assert.equal(execute({ stderr: `SSL validation failed for https://${privateText}`, status: 255 }), 'tls_error')
  for (const prefix of ['Could not connect to the endpoint URL:', 'Connect timeout on endpoint URL:', 'Read timeout on endpoint URL:']) {
    assert.equal(execute({ stderr: `${prefix} https://${privateText}`, status: 255 }), 'endpoint_unreachable')
  }
  for (const [status, expected] of [[2, 'cli_usage_error'], [252, 'cli_usage_error'],
    [253, 'cli_configuration_error'], [124, 'request_timeout'], [137, 'process_killed'],
    [1, 'unknown_failure'], [255, 'unknown_failure']]) {
    assert.equal(execute({ stderr: privateText, status }), expected)
  }
  assert.equal(execute({ stderr: `SSL validation failed for ${privateText}`, status: 254 }), 'service_error_format_unrecognized')
})

test('bounds retained output and never leaks oversized stdout or stderr', () => {
  const large = privateText.repeat(2_000)
  assert.equal(execute({ stdout: `${compliant}${large}` }), 'oversized_response')
  assert.equal(execute({ stderr: large, status: 254 }), 'oversized_response')
})

test('real GNU timeout terminates a slow CLI and force-kills one that ignores TERM', () => {
  for (const [ignoreTerm, expected] of [[false, 'request_timeout'], [true, 'process_killed']]) {
    assert.equal(execute({ stdout: privateText, stderr: privateText,
      // Leave a full second for fixture startup even on a cold hosted runner.
      sleepSeconds: 10, ignoreTerm, deadlines: { cli: 1, parser: 3 } }), expected)
  }
})

test('real classifier timeout is nonzero, quiet and leaves no synthetic CLI process', () => {
  assert.equal(execute({ stdout: privateText, stderr: privateText, sleepSeconds: 10,
    deadlines: { cli: 2, parser: 1 }, expectedFunctionStatus: 124 }), '')
})

test('actual report handler fails closed on missing, failed or untrusted classifier output', () => {
  const handlers = [...source.matchAll(/^  if lock_diagnostic="\$\(read_object_lock_diagnostic\)"; then\n[\s\S]*?^  fi/gm)]
  assert.equal(handlers.length, 1)
  for (const [value, status, expectedIssues, expectedMessage] of [
    ['verified', 0, 0, 'PASS: bucket default Object Lock is COMPLIANCE'],
    ['policy_mismatch', 0, 1, 'FAIL: bucket default Object Lock is not COMPLIANCE'],
    ['access_denied', 0, 1, 'diagnostic=access_denied; values redacted'],
    ...['auth_request_rejected', 'request_time_rejected', 'routing_rejected', 'request_rejected',
      'bucket_state_rejected', 'provider_failure', 'throttled', 'service_code_unrecognized',
      'service_error_format_unrecognized'].map(value => [value, 0, 1, `diagnostic=${value}; values redacted`]),
    ['verified', 124, 1, 'diagnostic=unavailable; values redacted'],
    ['', 127, 1, 'diagnostic=unavailable; values redacted'],
    [privateText, 0, 1, 'diagnostic=unavailable; values redacted'],
    [`verified\n${privateText}`, 0, 1, 'diagnostic=unavailable; values redacted'],
    [privateText, 1, 1, 'diagnostic=unavailable; values redacted'],
  ]) {
    const result = spawnSync('/bin/bash', ['--noprofile', '--norc', '-c', `
set -euo pipefail
ISSUES=0
pass() { printf 'PASS: %s\\n' "$*"; }
fail() { ISSUES=$((ISSUES + 1)); printf 'FAIL: %s\\n' "$*"; }
read_object_lock_diagnostic() { printf '%s' "$TEST_CLASS"; return "$TEST_STATUS"; }
${handlers[0][0]}
printf 'RESULT_ISSUES=%s\\n' "$ISSUES"
`], {
      encoding: 'utf8', timeout: 2_000, maxBuffer: 4_096,
      env: { PATH: '/usr/bin:/bin', LC_ALL: 'C', TEST_CLASS: value, TEST_STATUS: String(status) },
    })
    assert.ifError(result.error)
    assert.equal(result.status, 0)
    assert.equal(result.stderr, '')
    assert.ok(result.stdout.includes(expectedMessage))
    assert.ok(result.stdout.includes(`RESULT_ISSUES=${expectedIssues}\n`))
    for (const canary of canaries) assert.equal(result.stdout.includes(canary), false)
  }
})

test('both required PR and deploy gates execute these exact diagnostic tests', () => {
  for (const workflow of ['pr-checks', 'deploy']) {
    const contents = readFileSync(new URL(`.github/workflows/${workflow}.yml`, root), 'utf8')
    const title = '      - name: PostgreSQL maintenance safety unit tests'
    const start = contents.indexOf(title)
    assert.notEqual(start, -1)
    const end = contents.indexOf('\n      - ', start + title.length)
    const step = contents.slice(start, end)
    assert.equal(step.split('node --test scripts/backup/object-lock-diagnostic.test.mjs').length, 2)
    assert.doesNotMatch(step, /\b(?:if|continue-on-error):|secrets\./)
  }
})

test('probe retains fixed time/output bounds and integration accepts only the enum', () => {
  assert.match(probe, /timeout --kill-after=5 45 "\$AWS_BIN" s3api get-object-lock-configuration/)
  assert.match(probe, /timeout --kill-after=5 55 python3 -I -c/)
  assert.match(probe, /limit = 16384/)
  assert.match(source, /if lock_diagnostic="\$\(read_object_lock_diagnostic\)"; then/)
  assert.match(source, /case "\$lock_diagnostic" in\n\s+verified\)/)
  assert.equal(source.includes('lock_state="$(env'), false, 'raw CLI output must no longer enter shell capture')
  assert.doesNotMatch(probe, /\b(?:put-object|delete-object|create-bucket|systemctl|pg_dump|psql|curl)\b/)
})

const freshnessFunctions = [...source.matchAll(/^check_recent_service_success\(\) \{\n[\s\S]*?^\}/gm)]
assert.equal(freshnessFunctions.length, 1, 'extract the actual freshness decision, never source operational top level')
const fixedNow = Date.parse('2026-10-18T12:00:00Z') / 1000

function freshness({ load = 'loaded', result = 'success', status = '0', timestamp = 'Sun 2026-10-18 11:00:00 UTC',
  epoch = String(fixedNow - 3_600), dateStatus = 0, swap = '0', systemctlStatus = 0,
  realDate = false } = {}) {
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'leaddrive-service-freshness-'))
  const parseReceipt = join(fixtureRoot, 'parse-calls')
  try {
    const child = spawnSync('/bin/bash', ['--noprofile', '--norc', '-c', `
set -euo pipefail
ISSUES=0
pass() { printf 'PASS: %s\\n' "$*"; }
fail() { ISSUES=$((ISSUES + 1)); printf 'FAIL: %s\\n' "$*"; }
systemctl() {
  [ "$#" -eq 4 ] && [ "$1" = show ] && [ "$3" = --value ] && [ "$4" = synthetic.service ] || return 97
  case "$2" in
    --property=LoadState) printf '%s\\n' "$MOCK_LOAD" ;;
    --property=Result) printf '%s\\n' "$MOCK_RESULT" ;;
    --property=ExecMainStatus) printf '%s\\n' "$MOCK_STATUS" ;;
    --property=ExecMainExitTimestamp) printf '%s\\n' "$MOCK_TIMESTAMP" ;;
    --property=MemorySwapMax) printf '%s\\n' "$MOCK_SWAP" ;;
    *) return 98 ;;
  esac
  # Nonzero calls deliberately also emit plausible stdout: it must be discarded.
  return "$MOCK_SYSTEMCTL_STATUS"
}
date() {
  if [ "$#" -eq 2 ] && [ "$1" = -u ] && [ "$2" = +%s ]; then
    printf '%s\\n' "$MOCK_NOW"
  elif [ "$#" -eq 4 ] && [ "$1" = -u ] && [ "$2" = -d ] && [ "$4" = +%s ]; then
    printf 'parse\\n' >> "$PARSE_RECEIPT"
    if [ "$MOCK_REAL_DATE" = yes ]; then
      /usr/bin/date -u -d "$3" +%s
    else
      # Empty timestamps intentionally produce a plausible fresh midnight here,
      # reproducing GNU date's dangerous default independently of today's date.
      printf '%s\\n' "$MOCK_EPOCH"
      return "$MOCK_DATE_STATUS"
    fi
  else
    return 99
  fi
}
${freshnessFunctions[0][0]}
check_recent_service_success synthetic.service synthetic-backup 93600
printf 'RESULT_ISSUES=%s\\n' "$ISSUES"
`], {
      cwd: fixtureRoot, encoding: 'utf8', timeout: 2_000, maxBuffer: 4_096,
      env: { PATH: '/usr/bin:/bin', LC_ALL: 'C', TZ: 'UTC',
        MOCK_LOAD: load, MOCK_RESULT: result, MOCK_STATUS: status, MOCK_TIMESTAMP: timestamp,
        MOCK_EPOCH: epoch, MOCK_DATE_STATUS: String(dateStatus), MOCK_SWAP: swap,
        MOCK_SYSTEMCTL_STATUS: String(systemctlStatus), MOCK_NOW: String(fixedNow),
        MOCK_REAL_DATE: realDate ? 'yes' : 'no', PARSE_RECEIPT: parseReceipt },
    })
    assert.ifError(child.error)
    assert.equal(child.status, 0)
    assert.equal(child.stderr, '')
    for (const value of [...canaries, 'SYNTHETICLOCKSECRET']) {
      assert.equal(child.stdout.includes(value), false)
    }
    let parses = 0
    try { parses = readFileSync(parseReceipt, 'utf8').trim().split('\n').length } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
    return { output: child.stdout, parses }
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true })
  }
}

test('freshness cannot use empty metadata or an absent unit as a successful-run receipt', () => {
  for (const options of [
    { timestamp: '', epoch: String(fixedNow - 43_200) },
    { timestamp: '   \t\n' },
    ...['not-found', 'error', ''].map(load => ({ load })),
  ]) {
    const observed = freshness(options)
    assert.match(observed.output, /FAIL: synthetic-backup last run failed, never completed, or is stale/)
    assert.match(observed.output, /RESULT_ISSUES=1\n/)
    assert.equal(observed.parses, 0, 'empty/unloaded metadata must never reach date parsing')
    assert.doesNotMatch(observed.output, /last successful run is fresh/)
  }
  const failedMetadata = freshness({ systemctlStatus: 1 })
  assert.match(failedMetadata.output, /RESULT_ISSUES=2\n/)
  assert.equal(failedMetadata.parses, 0, 'reject plausible partial output from a failed systemctl call')
})

test('freshness keeps real date parsing, result/age/skew boundaries and the independent swap fence', () => {
  const valid = freshness({ realDate: true })
  assert.match(valid.output, /PASS: synthetic-backup last successful run is fresh/)
  assert.match(valid.output, /RESULT_ISSUES=0\n/)
  assert.equal(valid.parses, 1)
  for (const epoch of [String(fixedNow - 93_600), String(fixedNow + 300)]) {
    assert.match(freshness({ epoch }).output, /RESULT_ISSUES=0\n/)
  }
  for (const options of [
    { timestamp: privateText, realDate: true }, { dateStatus: 1 },
    ...['', '0', '-1', 'not-an-epoch', String(fixedNow - 93_601), String(fixedNow + 301)].map(epoch => ({ epoch })),
    { result: 'failed' }, { result: '' }, { status: '1' }, { status: '' },
  ]) {
    const observed = freshness(options)
    assert.match(observed.output, /FAIL: synthetic-backup last run failed, never completed, or is stale/)
    assert.match(observed.output, /RESULT_ISSUES=1\n/)
    assert.doesNotMatch(observed.output, /last successful run is fresh/)
  }
  const swapFailure = freshness({ swap: 'infinity' })
  assert.match(swapFailure.output, /PASS: synthetic-backup last successful run is fresh/)
  assert.match(swapFailure.output, /FAIL: synthetic-backup does not enforce MemorySwapMax=0/)
  assert.match(swapFailure.output, /RESULT_ISSUES=1\n/)
})
