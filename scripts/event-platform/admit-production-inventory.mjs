/** Main-only read-only admission CLI. stdout is ONLY the verified release SHA. */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { constants, closeSync, fstatSync, lstatSync, openSync, readSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { INVENTORY, admitInventory, validateInventoryInputs } from './inventory-admission.mjs'

const fail = code => { throw new Error(`INVENTORY_ADMISSION_${code}`) }
function localGit(args) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_')))
  const result = spawnSync('git', args, { cwd: process.cwd(), env, encoding: 'utf8', timeout: 5000, maxBuffer: 8192 })
  if (result.error || result.status !== 0) fail('LOCAL_CHECKOUT_INVALID')
  return result.stdout
}
export function readLocalInspector(checkoutSha) {
  try {
    if (localGit(['rev-parse', 'HEAD']).trim() !== checkoutSha) fail('LOCAL_CHECKOUT_INVALID')
    const tracked = localGit(['ls-tree', '-z', 'HEAD', '--', INVENTORY.script])
    const match = /^(100644|100755) blob ([0-9a-f]{40})\tscripts\/event-platform\/inspect-production\.sh\0$/.exec(tracked)
    if (!match) fail('LOCAL_CHECKOUT_INVALID')
    for (const path of ['scripts', 'scripts/event-platform']) {
      const stat = lstatSync(path)
      if (!stat.isDirectory() || stat.isSymbolicLink()) fail('LOCAL_CHECKOUT_INVALID')
    }
    const before = lstatSync(INVENTORY.script)
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size < 1 || before.size > INVENTORY.maxScriptBytes) fail('LOCAL_CHECKOUT_INVALID')
    const fd = openSync(INVENTORY.script, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    try {
      const opened = fstatSync(fd), buffer = Buffer.alloc(INVENTORY.maxScriptBytes + 1)
      let size = 0
      while (size < buffer.length) {
        const count = readSync(fd, buffer, size, buffer.length - size, null)
        if (count === 0) break
        size += count
      }
      const after = fstatSync(fd)
      if (!opened.isFile() || before.dev !== opened.dev || before.ino !== opened.ino || before.mode !== opened.mode
        || before.size !== opened.size || before.mtimeMs !== opened.mtimeMs || before.ctimeMs !== opened.ctimeMs
        || opened.size !== size || size < 1 || size > INVENTORY.maxScriptBytes || opened.mode !== after.mode
        || opened.size !== after.size || opened.mtimeMs !== after.mtimeMs || opened.ctimeMs !== after.ctimeMs
        || opened.nlink !== 1 || after.nlink !== 1) fail('LOCAL_CHECKOUT_INVALID')
      const mode = (opened.mode & 0o111) === 0 ? '100644' : '100755'
      const sha = createHash('sha1').update(`blob ${size}\0`).update(buffer.subarray(0, size)).digest('hex')
      if (sha !== match[2] || mode !== match[1]) fail('LOCAL_CHECKOUT_INVALID')
      return Object.freeze({ sha, mode, size })
    } finally { closeSync(fd) }
  } catch { fail('LOCAL_CHECKOUT_INVALID') }
}
function githubJson(endpoint) {
  // Fixed repo-only GET endpoints are built by admitInventory, never copied
  // from API response URLs or workflow input. No pagination/retry/fallback.
  const { GH_DEBUG: ignoredDebug, ...env } = process.env
  void ignoredDebug
  const result = spawnSync('gh', ['api', '--method', 'GET', '-H', 'Accept: application/vnd.github+json',
    '-H', 'X-GitHub-Api-Version: 2022-11-28', endpoint], { env: { ...env, GH_HOST: 'github.com', GH_PROMPT_DISABLED: '1' },
    encoding: 'utf8', timeout: 15000, maxBuffer: 2 * 1024 * 1024 })
  if (result.error || result.status !== 0) fail('API_FAILED')
  try { return JSON.parse(result.stdout) } catch { fail('API_FAILED') }
}
export function runInventoryAdmission(env = process.env, dependencies = {}) {
  // Admission is deliberately before even Git/file acquisition or gh spawn.
  const input = validateInventoryInputs(env)
  const local = (dependencies.readLocal ?? readLocalInspector)(input.checkoutSha)
  return admitInventory(env, local, dependencies.fetchJson ?? githubJson)
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 2) fail('INPUT_INVALID')
    process.stdout.write(`${runInventoryAdmission()}\n`)
  } catch (error) {
    const safe = /^INVENTORY_ADMISSION_(?:INPUT_INVALID|CURRENT_MAIN_REQUIRED|REPOSITORY_INVALID|WORKFLOW_INVALID|RUN_INVALID|JOBS_INVALID|ANCESTRY_INVALID|TREE_INVALID|SCRIPT_INVALID|RUN_CHANGED|LOCAL_CHECKOUT_INVALID|API_FAILED)$/.test(error?.message ?? '')
    process.stderr.write(`${safe ? error.message : 'INVENTORY_ADMISSION_FAILED'}\n`)
    process.exitCode = 1
  }
}
