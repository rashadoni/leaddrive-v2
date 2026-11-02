/** Read-only readiness admission only. Never deploy, replay or execute old source. */
export const INVENTORY = Object.freeze({
  repository: 'rashadoni/leaddrive-v2', repositoryId: 1362346481,
  workflowId: 353805356, workflowPath: '.github/workflows/deploy.yml', workflowName: 'Deploy to Production',
  script: 'scripts/event-platform/inspect-production.sh', maxScriptBytes: 32768,
  requiredJobs: Object.freeze(['Quality & security gates', 'Production build & publish artifact', 'Deploy to production & post-deploy smoke']),
})
const deny = code => { throw new Error(`INVENTORY_ADMISSION_${code}`) }
const require = (value, code) => { if (!value) deny(code) }
const sha = value => typeof value === 'string' && value.length === 40 && /^[0-9a-f]{40}$/.test(value)
const integer = value => Number.isSafeInteger(value) && value > 0
const blank = value => value === undefined || value === ''

export function validateInventoryInputs(env) {
  require(env && typeof env === 'object', 'INPUT_INVALID')
  require(env.GITHUB_ACTIONS === 'true' && env.GITHUB_EVENT_NAME === 'workflow_dispatch', 'INPUT_INVALID')
  require(env.GITHUB_REPOSITORY === INVENTORY.repository && env.GITHUB_REPOSITORY_ID === String(INVENTORY.repositoryId), 'INPUT_INVALID')
  require(env.GITHUB_REF === 'refs/heads/main' && sha(env.GITHUB_SHA), 'CURRENT_MAIN_REQUIRED')
  const mode = blank(env.INSPECTION_ADMISSION_MODE) ? 'current-main' : env.INSPECTION_ADMISSION_MODE
  require(['current-main', 'deployed-release'].includes(mode), 'INPUT_INVALID')
  if (mode === 'current-main') {
    require(blank(env.INSPECTION_DEPLOYED_SHA) && blank(env.INSPECTION_DEPLOY_RUN_ID), 'INPUT_INVALID')
    return Object.freeze({ mode, checkoutSha: env.GITHUB_SHA, releaseSha: env.GITHUB_SHA })
  }
  const releaseSha = env.INSPECTION_DEPLOYED_SHA, runId = env.INSPECTION_DEPLOY_RUN_ID
  require(sha(releaseSha) && typeof runId === 'string' && runId.length <= 16 && /^[1-9][0-9]*$/.test(runId)
    && integer(Number(runId)) && String(Number(runId)) === runId, 'INPUT_INVALID')
  return Object.freeze({ mode, checkoutSha: env.GITHUB_SHA, releaseSha, runId })
}
export function validateRepository(repo) {
  require(repo?.id === INVENTORY.repositoryId && repo.full_name === INVENTORY.repository, 'REPOSITORY_INVALID')
}
export function validateCurrentMain(ref, input) {
  require(ref?.ref === 'refs/heads/main' && ref.object?.type === 'commit' && ref.object.sha === input.checkoutSha, 'CURRENT_MAIN_REQUIRED')
}
export function validateWorkflow(workflow) {
  require(workflow?.id === INVENTORY.workflowId && workflow.path === INVENTORY.workflowPath && workflow.name === INVENTORY.workflowName && workflow.state === 'active', 'WORKFLOW_INVALID')
}
export function validateDeployRun(run, input) {
  require(run?.id === Number(input.runId) && run.workflow_id === INVENTORY.workflowId && run.path === INVENTORY.workflowPath && run.name === INVENTORY.workflowName, 'RUN_INVALID')
  for (const repo of [run.repository, run.head_repository]) validateRepository(repo)
  require(run.event === 'push' && run.head_branch === 'main' && run.head_sha === input.releaseSha && integer(run.run_attempt)
    && run.status === 'completed' && run.conclusion === 'success', 'RUN_INVALID')
  return run.run_attempt
}
export function validateDeployJobs(response, input, attempt) {
  require(Array.isArray(response?.jobs) && integer(response.total_count) && response.total_count <= 100 && response.total_count === response.jobs.length, 'JOBS_INVALID')
  const ids = new Set()
  for (const job of response.jobs) {
    require(integer(job?.id) && !ids.has(job.id) && job.run_id === Number(input.runId) && job.run_attempt === attempt && job.head_sha === input.releaseSha
      && job.head_branch === 'main' && job.workflow_name === INVENTORY.workflowName, 'JOBS_INVALID')
    ids.add(job.id)
  }
  for (const name of INVENTORY.requiredJobs) {
    const jobs = response.jobs.filter(job => job.name === name)
    require(jobs.length === 1 && jobs[0].status === 'completed' && jobs[0].conclusion === 'success', 'JOBS_INVALID')
  }
}
export function validateAncestor(compare, input) {
  require(compare?.base_commit?.sha === input.releaseSha && compare.merge_base_commit?.sha === input.releaseSha
    && compare.behind_by === 0 && Number.isSafeInteger(compare.ahead_by) && compare.ahead_by >= 0
    && (compare.status === 'identical' && compare.ahead_by === 0 || compare.status === 'ahead' && compare.ahead_by > 0), 'ANCESTRY_INVALID')
}
export function inventoryTreeEntry(tree, requestedSha, path, directory) {
  require(tree?.sha === requestedSha && tree.truncated === false && Array.isArray(tree.tree) && tree.tree.length > 0 && tree.tree.length <= 5000, 'TREE_INVALID')
  const entries = tree.tree.filter(entry => entry?.path === path)
  require(entries.length === 1 && sha(entries[0].sha), 'TREE_INVALID')
  const entry = entries[0]
  require(directory ? entry.type === 'tree' && entry.mode === '040000'
    : entry.type === 'blob' && ['100644', '100755'].includes(entry.mode) && integer(entry.size) && entry.size <= INVENTORY.maxScriptBytes, 'TREE_INVALID')
  return Object.freeze({ sha: entry.sha, mode: entry.mode, size: entry.size })
}
export function validateInspectorBlobs(current, deployed, local) {
  for (const blob of [current, deployed, local]) {
    require(blob && sha(blob.sha) && ['100644', '100755'].includes(blob.mode) && integer(blob.size) && blob.size <= INVENTORY.maxScriptBytes, 'SCRIPT_INVALID')
    require(blob.sha === current.sha && blob.mode === current.mode && blob.size === current.size, 'SCRIPT_INVALID')
  }
}

/** All data comes from fixed GitHub endpoints, not operator-supplied JSON/URLs.
 * fetchJson is the bounded trusted transport; injection exists for pure tests.
 */
export function admitInventory(env, local, fetchJson) {
  const input = validateInventoryInputs(env)
  validateInspectorBlobs(local, local, local)
  const prefix = `repos/${INVENTORY.repository}`
  const get = path => {
    try { return fetchJson(path ? `${prefix}/${path}` : prefix) }
    catch { deny('API_FAILED') }
  }
  validateRepository(get(''))
  validateCurrentMain(get('git/ref/heads/main'), input)
  let attempt
  if (input.mode === 'deployed-release') {
    validateWorkflow(get('actions/workflows/deploy.yml'))
    attempt = validateDeployRun(get(`actions/runs/${input.runId}`), input)
    validateDeployJobs(get(`actions/runs/${input.runId}/attempts/${attempt}/jobs?per_page=100&page=1`), input, attempt)
    validateAncestor(get(`compare/${input.releaseSha}...${input.checkoutSha}?per_page=1&page=1`), input)
  }
  function scriptAt(commit) {
    const scripts = inventoryTreeEntry(get(`git/trees/${commit}`), commit, 'scripts', true)
    const events = inventoryTreeEntry(get(`git/trees/${scripts.sha}`), scripts.sha, 'event-platform', true)
    return inventoryTreeEntry(get(`git/trees/${events.sha}`), events.sha, 'inspect-production.sh', false)
  }
  const current = scriptAt(input.checkoutSha)
  const deployed = input.releaseSha === input.checkoutSha ? current : scriptAt(input.releaseSha)
  validateInspectorBlobs(current, deployed, local)
  if (attempt !== undefined) require(validateDeployRun(get(`actions/runs/${input.runId}`), input) === attempt, 'RUN_CHANGED')
  // Reject a main movement during admission as well as an old initial checkout.
  validateCurrentMain(get('git/ref/heads/main'), input)
  return input.releaseSha
}
