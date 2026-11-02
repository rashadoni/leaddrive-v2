import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
const read = path => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')
const workflow = read('.github/workflows/event-platform-readiness.yml')
const contract = read('scripts/event-platform/inventory-admission.mjs')
const cli = read('scripts/event-platform/admit-production-inventory.mjs')
const script = read('scripts/event-platform/inspect-production.sh')

test('actual named input-validation step refuses malformed values before route API, admission or SSH acquisition', () => {
  const validation = workflow.indexOf('name: Validate inputs before any network or production access')
  const protection = workflow.indexOf('name: Require protected production route')
  const admission = workflow.indexOf('id: admission')
  const setup = workflow.indexOf('name: Setup pinned production SSH')
  assert.ok(validation > 0 && protection > validation && admission > protection && setup > admission)
  const step = workflow.slice(validation, protection)
  assert.doesNotMatch(step, /GH_TOKEN|secrets\.|gh api|\bssh\b/)
  for (const [variable, input] of [['INSPECTION_ADMISSION_MODE', 'admission_mode'],
    ['INSPECTION_DEPLOYED_SHA', 'deployed_sha'], ['INSPECTION_DEPLOY_RUN_ID', 'deploy_run_id']]) {
    const binding = `${variable}: \${{ inputs.${input} }}`
    assert.ok(step.includes(binding))
    assert.equal(workflow.split(binding).length - 1, 2, 'early and full admission must use identical input bindings')
  }
  const command = /node --input-type=module -e '([^'\n]+)'/.exec(step)?.[1]
  assert.ok(command, 'execute the actual workflow validation code, not a duplicate validator')
  const env = { PATH: '/nonexistent', GITHUB_ACTIONS: 'true', GITHUB_EVENT_NAME: 'workflow_dispatch',
    GITHUB_REPOSITORY: 'rashadoni/leaddrive-v2', GITHUB_REPOSITORY_ID: '1362346481',
    GITHUB_REF: 'refs/heads/main', GITHUB_SHA: 'a'.repeat(40) }
  const deployed = { INSPECTION_ADMISSION_MODE: 'deployed-release', INSPECTION_DEPLOYED_SHA: 'b'.repeat(40), INSPECTION_DEPLOY_RUN_ID: '39173487040' }
  for (const input of [{}, deployed]) {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', command], { env: { ...env, ...input }, encoding: 'utf8', timeout: 5000 })
    assert.equal(result.status, 0); assert.equal(result.stdout, ''); assert.equal(result.stderr, '')
  }
  for (const input of [
    { ...deployed, INSPECTION_DEPLOYED_SHA: "'; touch must-not-run; #" },
    { ...deployed, INSPECTION_DEPLOY_RUN_ID: '1\n' },
    { ...deployed, INSPECTION_DEPLOY_RUN_ID: '' },
    { ...deployed, INSPECTION_ADMISSION_MODE: 'current-main' },
    { INSPECTION_ADMISSION_MODE: 'unknown' },
  ]) {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', command], { env: { ...env, ...input }, encoding: 'utf8', timeout: 5000 })
    assert.equal(result.status, 1); assert.equal(result.stdout, '')
    assert.equal(result.stderr, 'INVENTORY_ADMISSION_INPUT_INVALID\n')
  }
})

test('inventory retains the exact production lock at job level with maximum pending queue and no cancellations', () => {
  assert.doesNotMatch(workflow, /^concurrency:/m)
  assert.match(workflow, /^    concurrency:\n      group: production-deploy\n      cancel-in-progress: false\n      queue: max$/m)
  assert.equal((workflow.match(/group: production-deploy/g) ?? []).length, 1)
  assert.equal((workflow.match(/queue: max/g) ?? []).length, 1)
  assert.doesNotMatch(workflow, /cancel-in-progress: true|actions\/runs.*cancel|gh run cancel/)
})
test('default is current-main, permissions are read-only, and protected main/checkout checks apply to both modes', () => {
  assert.match(workflow, /options: \[current-main, deployed-release\]\n        default: current-main/)
  assert.match(workflow, /^permissions:\n  contents: read\n  actions: read$/m)
  assert.match(workflow, /environment: production/)
  assert.match(workflow, /uses: \.\/\.github\/actions\/assert-production-environment-protection/)
  assert.match(contract, /env\.GITHUB_REF === 'refs\/heads\/main'/)
  assert.match(contract, /ref\.object\.sha === input\.checkoutSha/)
  assert.equal((contract.match(/validateCurrentMain\(get\('git\/ref\/heads\/main'\), input\)/g) ?? []).length, 2)
  assert.match(cli, /localGit\(\['rev-parse', 'HEAD'\]\)\.trim\(\) !== checkoutSha/)
})
test('verified output alone supplies EXPECTED_DEPLOY_SHA before pinned SSH material and current-script execution', () => {
  const admission = workflow.indexOf('id: admission'), setup = workflow.indexOf('name: Setup pinned production SSH')
  const inspect = workflow.indexOf('name: Inspect aggregate readiness')
  assert.ok(admission > 0 && setup > admission && inspect > setup)
  assert.match(workflow, /EXPECTED_DEPLOY_SHA="\$\(node scripts\/event-platform\/admit-production-inventory\.mjs\)"/)
  assert.match(workflow, /EXPECTED_DEPLOY_SHA: \$\{\{ steps\.admission\.outputs\.expected_deploy_sha \}\}/)
  assert.doesNotMatch(workflow, /EXPECTED_DEPLOY_SHA: \$\{\{ (?:inputs|github)\./)
  assert.match(workflow, /uses: \.\/\.github\/actions\/setup-production-ssh/)
  assert.match(workflow, /< scripts\/event-platform\/inspect-production\.sh/)
  assert.match(workflow, /persist-credentials: false/)
  const setupAction = read('.github/actions/setup-production-ssh/action.yml')
  assert.match(setupAction, /EXPECTED_PRODUCTION_HOST: "13\.140\.132\.245"/)
  assert.match(setupAction, /StrictHostKeyChecking yes/)
})
test('read-only marker/SQL protections remain, no server-source/history/production mutation fallback is introduced', () => {
  assert.match(script, /\[ "\$deployed_sha" = "\$EXPECTED_DEPLOY_SHA" \]/)
  assert.match(script, /root:root/)
  assert.match(script, /BEGIN TRANSACTION READ ONLY/)
  assert.match(script, /default_transaction_read_only=on/)
  assert.match(cli, /constants\.O_NOFOLLOW/)
  assert.match(cli, /INVENTORY\.maxScriptBytes \+ 1/)
  assert.match(cli, /GH_HOST: 'github\.com'/)
  assert.match(cli, /'--method', 'GET'/)
  assert.match(cli, /timeout: 15000, maxBuffer: 2 \* 1024 \* 1024/)
  assert.doesNotMatch(cli + contract, /git fetch|git checkout|git reset|--paginate|gh run (?:rerun|cancel)|spawnSync\('ssh'/)
  assert.doesNotMatch(workflow, /pull_request_target|git fetch|git checkout|gh workflow run/)
})
