import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { INVENTORY, admitInventory, validateInventoryInputs } from './inventory-admission.mjs'
import { readLocalInspector, runInventoryAdmission } from './admit-production-inventory.mjs'

const cli = fileURLToPath(new URL('./admit-production-inventory.mjs', import.meta.url))
const main = 'a'.repeat(40), live = 'b'.repeat(40), scripts = 'c'.repeat(40), events = 'd'.repeat(40)
const bytes = Buffer.from('#!/bin/bash\n# public synthetic inspector fixture\n')
const blob = { sha: createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'), mode: '100644', size: bytes.length }
function environment(mode = 'deployed-release') {
  return { GITHUB_ACTIONS: 'true', GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REPOSITORY: INVENTORY.repository,
    GITHUB_REPOSITORY_ID: String(INVENTORY.repositoryId), GITHUB_REF: 'refs/heads/main', GITHUB_SHA: main,
    INSPECTION_ADMISSION_MODE: mode, ...(mode === 'deployed-release' ? { INSPECTION_DEPLOYED_SHA: live, INSPECTION_DEPLOY_RUN_ID: '39173487040' } : {}) }
}
function fixture(mode = 'deployed-release') {
  const env = environment(mode), calls = [], repo = { id: INVENTORY.repositoryId, full_name: INVENTORY.repository }
  const run = { id: Number(env.INSPECTION_DEPLOY_RUN_ID), workflow_id: INVENTORY.workflowId, path: INVENTORY.workflowPath,
    name: INVENTORY.workflowName, repository: { ...repo }, head_repository: { ...repo }, event: 'push', head_branch: 'main',
    head_sha: live, run_attempt: 1, status: 'completed', conclusion: 'success' }
  const names = [...INVENTORY.requiredJobs, 'Recover verified retained production artifact', 'Approve historical bootstrap-resume build', 'Validate manual deployment inputs', 'Cap retained deploy artifacts']
  const jobs = { total_count: 7, jobs: names.map((name, index) => ({ id: 100 + index, name, run_id: run.id, run_attempt: 1,
    head_sha: live, head_branch: 'main', workflow_name: INVENTORY.workflowName, status: 'completed', conclusion: index > 2 && index < 6 ? 'skipped' : 'success' })) }
  const workflow = { id: INVENTORY.workflowId, path: INVENTORY.workflowPath, name: INVENTORY.workflowName, state: 'active' }
  const ref = { ref: 'refs/heads/main', object: { type: 'commit', sha: main } }
  const compare = { base_commit: { sha: live }, merge_base_commit: { sha: live }, status: 'ahead', ahead_by: 10, behind_by: 0 }
  const tree = (sha, path, entry) => ({ sha, truncated: false, tree: [{ path, ...entry }] })
  const roots = { [main]: tree(main, 'scripts', { type: 'tree', mode: '040000', sha: scripts }),
    [live]: tree(live, 'scripts', { type: 'tree', mode: '040000', sha: scripts }) }
  const scriptTree = tree(scripts, 'event-platform', { type: 'tree', mode: '040000', sha: events })
  const eventTree = tree(events, 'inspect-production.sh', { type: 'blob', ...blob })
  let runReads = 0, refReads = 0
  const f = { env, local: { ...blob }, repo, run, jobs, workflow, ref, compare, roots, scriptTree, eventTree, calls }
  function fetchJson(endpoint) {
    calls.push(endpoint)
    const prefix = `repos/${INVENTORY.repository}`
    let result
    if (endpoint === prefix) result = repo
    else if (endpoint === `${prefix}/git/ref/heads/main`) result = ++refReads === 2 && f.finalRef ? f.finalRef : ref
    else if (endpoint === `${prefix}/actions/workflows/deploy.yml`) result = workflow
    else if (endpoint === `${prefix}/actions/runs/${env.INSPECTION_DEPLOY_RUN_ID}`) result = ++runReads === 2 && f.finalRun ? f.finalRun : run
    else if (endpoint === `${prefix}/actions/runs/${env.INSPECTION_DEPLOY_RUN_ID}/attempts/${run.run_attempt}/jobs?per_page=100&page=1`) result = jobs
    else if (endpoint === `${prefix}/compare/${env.INSPECTION_DEPLOYED_SHA}...${main}?per_page=1&page=1`) result = compare
    else if (endpoint.startsWith(`${prefix}/git/trees/`)) {
      const sha = endpoint.slice(`${prefix}/git/trees/`.length)
      result = sha === scripts ? scriptTree : sha === events ? eventTree : roots[sha]
    }
    assert.ok(result, 'unexpected or unbounded endpoint')
    return structuredClone(result)
  }
  return { ...f, fetchJson, state: f }
}
const admit = f => admitInventory(f.env, f.local, f.fetchJson)

test('default current-main remains strict and never requests workflow/deploy/compare evidence', () => {
  const f = fixture('current-main'); delete f.env.INSPECTION_ADMISSION_MODE
  assert.equal(admit(f), main)
  assert.equal(f.calls.length, 6)
  assert.ok(f.calls.every(path => !/actions\/|compare\//.test(path)))
})
test('verified normal live release is admitted only with bounded fixed GET evidence and unchanged source', () => {
  const f = fixture(); assert.equal(admit(f), live)
  assert.equal(f.calls.length, 14)
  assert.ok(f.calls.every(path => path.startsWith(`repos/${INVENTORY.repository}/`) || path === `repos/${INVENTORY.repository}`))
  assert.equal(f.calls.filter(path => path.endsWith(`/actions/runs/${f.env.INSPECTION_DEPLOY_RUN_ID}`)).length, 2)
})
test('matching regular executable Git blobs are supported without allowing symlinks', () => {
  const f = fixture(); f.local.mode = '100755'; f.eventTree.tree[0].mode = '100755'
  assert.equal(admit(f), live)
})
test('pure admission sanitizes transport failures instead of exposing provider details', () => {
  const f = fixture()
  assert.throws(() => admitInventory(f.env, f.local, () => { throw new Error('private-provider-details') }), { message: 'INVENTORY_ADMISSION_API_FAILED' })
})
const invalidInputs = {
  'non Actions': { GITHUB_ACTIONS: 'false' }, 'wrong event': { GITHUB_EVENT_NAME: 'push' },
  'foreign slug': { GITHUB_REPOSITORY: 'someone/else' }, 'foreign repo ID': { GITHUB_REPOSITORY_ID: '1' },
  'feature ref': { GITHUB_REF: 'refs/heads/codex/test' }, 'tag ref': { GITHUB_REF: 'refs/tags/main' },
  'missing checkout SHA': { GITHUB_SHA: '' }, 'unknown mode': { INSPECTION_ADMISSION_MODE: 'rollback' },
  'missing release': { INSPECTION_DEPLOYED_SHA: '' }, 'missing receipt': { INSPECTION_DEPLOY_RUN_ID: '' },
  'short release': { INSPECTION_DEPLOYED_SHA: '421260026' }, 'uppercase release': { INSPECTION_DEPLOYED_SHA: 'A'.repeat(40) },
  'run injection': { INSPECTION_DEPLOY_RUN_ID: '../1' }, 'leading-zero run': { INSPECTION_DEPLOY_RUN_ID: '01' },
  'newline run': { INSPECTION_DEPLOY_RUN_ID: '1\n' }, 'CRLF run': { INSPECTION_DEPLOY_RUN_ID: '1\r\n' },
  'trailing-space run': { INSPECTION_DEPLOY_RUN_ID: '1 ' }, 'leading-space run': { INSPECTION_DEPLOY_RUN_ID: ' 1' },
  'negative run': { INSPECTION_DEPLOY_RUN_ID: '-1' },
  'unsafe numeric run': { INSPECTION_DEPLOY_RUN_ID: '9007199254740992' },
  'current with receipt': { INSPECTION_ADMISSION_MODE: 'current-main' },
}
for (const [name, patch] of Object.entries(invalidInputs)) test(`input refusal before any Git/file/API acquisition: ${name}`, () => {
  let acquired = 0
  assert.throws(() => runInventoryAdmission({ ...environment(), ...patch }, { readLocal() { acquired++ }, fetchJson() { acquired++ } }), /INVENTORY_ADMISSION_/)
  assert.equal(acquired, 0)
  const f = fixture(); Object.assign(f.env, patch)
  assert.throws(() => admit(f), /INVENTORY_ADMISSION_/); assert.equal(f.calls.length, 0)
})
test('current mode refuses either stray receipt field independently', () => {
  for (const patch of [{ INSPECTION_DEPLOYED_SHA: live }, { INSPECTION_DEPLOY_RUN_ID: '39173487040' }]) {
    assert.throws(() => validateInventoryInputs({ ...environment('current-main'), ...patch }), /INPUT_INVALID/)
  }
})
const corrupt = {
  'repo ID': f => f.repo.id++, 'repo slug': f => f.repo.full_name = 'other/repo',
  'old main checkout': f => f.ref.object.sha = live, 'noncommit main': f => f.ref.object.type = 'tag',
  'wrong workflow ID': f => f.workflow.id++, 'wrong workflow path': f => f.workflow.path = '.github/workflows/other.yml',
  'disabled workflow': f => f.workflow.state = 'disabled_manually', 'wrong run ID': f => f.run.id++,
  'foreign run repo': f => f.run.repository.id++, 'foreign head repo': f => f.run.head_repository.id++,
  'foreign head slug': f => f.run.head_repository.full_name = 'other/repo', 'wrong run workflow ID': f => f.run.workflow_id++,
  'wrong run workflow path': f => f.run.path = 'other.yml', 'manual run': f => f.run.event = 'workflow_dispatch',
  'non-main run': f => f.run.head_branch = 'feature', 'wrong release': f => f.run.head_sha = main,
  'pending run': f => f.run.status = 'in_progress', 'cancelled run': f => f.run.conclusion = 'cancelled',
  'no attempt': f => f.run.run_attempt = 0, 'truncated jobs': f => f.jobs.jobs.pop(),
  'pagination overflow': f => f.jobs.total_count = 101, 'no jobs': f => { f.jobs.total_count = 0; f.jobs.jobs = [] },
  'duplicate job ID': f => f.jobs.jobs[1].id = f.jobs.jobs[0].id,
  'foreign job run': f => f.jobs.jobs[0].run_id++, 'old job attempt': f => f.jobs.jobs[0].run_attempt++,
  'different job head': f => f.jobs.jobs[0].head_sha = main, 'different job branch': f => f.jobs.jobs[0].head_branch = 'other',
  'different job workflow': f => f.jobs.jobs[0].workflow_name = 'Other',
  'wrong compare base': f => f.compare.base_commit.sha = main, 'not ancestor': f => f.compare.merge_base_commit.sha = main,
  'behind head': f => f.compare.behind_by = 1, 'diverged': f => f.compare.status = 'diverged',
  'impossible identical': f => f.compare.status = 'identical',
  'truncated root': f => f.roots[main].truncated = true, 'wrong tree identity': f => f.roots[main].sha = live,
  'scripts symlink': f => f.roots[main].tree[0].mode = '120000', 'scripts blob': f => f.roots[main].tree[0].type = 'blob',
  'event dir symlink': f => f.scriptTree.tree[0].mode = '120000', 'event dir blob': f => f.scriptTree.tree[0].type = 'blob',
  'missing leaf': f => f.eventTree.tree[0].path = 'other.sh', 'duplicate leaf': f => f.eventTree.tree.push({ ...f.eventTree.tree[0] }),
  'leaf symlink': f => f.eventTree.tree[0].mode = '120000', 'leaf submodule': f => f.eventTree.tree[0].type = 'commit',
  'unbounded blob': f => f.eventTree.tree[0].size = INVENTORY.maxScriptBytes + 1,
  'empty blob': f => f.eventTree.tree[0].size = 0, 'local bytes differ': f => f.local.sha = main,
  'local mode differs': f => f.local.mode = '100755', 'local size differs': f => f.local.size++,
  'main moved during proof': f => f.state.finalRef = { ...f.ref, object: { type: 'commit', sha: live } },
  'rerun during proof': f => f.state.finalRun = { ...f.run, run_attempt: 2 },
}
for (const [name, change] of Object.entries(corrupt)) test(`fail closed on ${name}`, () => {
  const f = fixture(); change(f); assert.throws(() => admit(f), /INVENTORY_ADMISSION_/)
})
for (let index = 0; index < 3; index++) for (const condition of ['skipped', 'failure', 'missing', 'duplicate', 'in_progress']) {
  test(`required job ${index} cannot be ${condition}`, () => {
    const f = fixture(), job = f.jobs.jobs[index]
    if (condition === 'missing') { f.jobs.jobs.splice(index, 1); f.jobs.total_count-- }
    else if (condition === 'duplicate') { f.jobs.jobs.push({ ...job, id: 999 }); f.jobs.total_count++ }
    else if (condition === 'in_progress') job.status = condition
    else job.conclusion = condition
    assert.throws(() => admit(f), /JOBS_INVALID/)
  })
}
test('deployed tree cannot replace the inspector despite unchanged current tree/local file', () => {
  const f = fixture(), oldScripts = 'e'.repeat(40), oldEvents = 'f'.repeat(40)
  f.roots[live].tree[0].sha = oldScripts
  const read = f.fetchJson
  const fetch = endpoint => endpoint.endsWith(`/git/trees/${oldScripts}`)
    ? { sha: oldScripts, truncated: false, tree: [{ path: 'event-platform', type: 'tree', mode: '040000', sha: oldEvents }] }
    : endpoint.endsWith(`/git/trees/${oldEvents}`)
      ? { sha: oldEvents, truncated: false, tree: [{ path: 'inspect-production.sh', type: 'blob', ...blob, sha: live }] } : read(endpoint)
  assert.throws(() => admitInventory(f.env, f.local, fetch), /SCRIPT_INVALID/)
})
test('actual local checker verifies current HEAD, index blob, bounded regular bytes and mode without API', () => {
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  const local = readLocalInspector(head)
  assert.equal(local.mode, '100644'); assert.ok(local.size > 0 && local.size <= INVENTORY.maxScriptBytes)
  assert.throws(() => readLocalInspector(live), /LOCAL_CHECKOUT_INVALID/)
})

test('child CLI refuses malformed input before gh; API failures never disclose provider stderr/stdout', () => {
  const directory = mkdtempSync(resolve(tmpdir(), 'ld-inventory-admission-test-'))
  try {
    const sentinel = resolve(directory, 'gh-called')
    writeFileSync(resolve(directory, 'gh'), `#!${process.execPath}\nrequire('node:fs').writeFileSync(process.env.TEST_SENTINEL,'called');process.stdout.write('private-provider-response');process.stderr.write('private-provider-error');process.exit(2)\n`, { mode: 0o700 })
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
    const env = { ...environment(), GITHUB_SHA: head, PATH: `${directory}:${process.env.PATH}`, TEST_SENTINEL: sentinel }
    for (const patch of Object.values(invalidInputs)) {
      const result = spawnSync(process.execPath, [cli], { encoding: 'utf8', env: { ...env, ...patch }, timeout: 5000 })
      assert.notEqual(result.status, 0); assert.equal(result.stdout, '')
      assert.match(result.stderr, /^INVENTORY_ADMISSION_[A-Z_]+\n$/); assert.equal(existsSync(sentinel), false)
    }
    const result = spawnSync(process.execPath, [cli], { encoding: 'utf8', env, timeout: 5000 })
    assert.notEqual(result.status, 0); assert.equal(result.stdout, '')
    assert.equal(result.stderr, 'INVENTORY_ADMISSION_API_FAILED\n'); assert.equal(existsSync(sentinel), true)
  } finally { rmSync(directory, { recursive: true, force: true }) }
})
test('child rejects symlink/changed/executable-mismatched local source before gh', () => {
  for (const kind of ['symlink', 'changed', 'mode', 'valid']) {
    const directory = mkdtempSync(resolve(tmpdir(), 'ld-inventory-local-test-'))
    try {
      const bin = resolve(directory, 'bin'), target = resolve(directory, INVENTORY.script), sentinel = resolve(directory, 'gh-called')
      mkdirSync(bin); mkdirSync(resolve(directory, 'scripts/event-platform'), { recursive: true })
      writeFileSync(resolve(bin, 'git'), `#!${process.execPath}\nprocess.stdout.write(process.argv[2]==='rev-parse'?process.env.TEST_HEAD+'\\n':Buffer.from(process.env.TEST_ENTRY,'base64'))\n`, { mode: 0o700 })
      writeFileSync(resolve(bin, 'gh'), `#!${process.execPath}\nrequire('node:fs').writeFileSync(process.env.TEST_SENTINEL,'called');process.exit(2)\n`, { mode: 0o700 })
      if (kind === 'symlink') { writeFileSync(resolve(directory, 'other.sh'), bytes); symlinkSync(resolve(directory, 'other.sh'), target) }
      else writeFileSync(target, kind === 'changed' ? Buffer.from('changed') : bytes, { mode: 0o644 })
      const entry = `${kind === 'mode' ? '100755' : '100644'} blob ${blob.sha}\t${INVENTORY.script}\0`
      const result = spawnSync(process.execPath, [cli], { cwd: directory, encoding: 'utf8', timeout: 5000, env: {
        ...environment(), PATH: `${bin}:${process.env.PATH}`, TEST_SENTINEL: sentinel, TEST_HEAD: main, TEST_ENTRY: Buffer.from(entry).toString('base64'),
      } })
      assert.notEqual(result.status, 0); assert.equal(result.stdout, '')
      assert.equal(result.stderr, kind === 'valid' ? 'INVENTORY_ADMISSION_API_FAILED\n' : 'INVENTORY_ADMISSION_LOCAL_CHECKOUT_INVALID\n')
      assert.equal(existsSync(sentinel), kind === 'valid')
    } finally { rmSync(directory, { recursive: true, force: true }) }
  }
})
