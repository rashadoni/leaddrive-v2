/** Protected-main operator entry point. Never accepts key material or people. */
import { constants, closeSync, fsyncSync, lstatSync, openSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from "node:fs"
import { randomBytes, randomUUID } from "node:crypto"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import path from "node:path"
import { readIdentityArtifact } from "./release-contract.mjs"

const APP = "/opt/leaddrive-v2"
const ENV = "/etc/leaddrive/app.env"
const MIGRATION = "/etc/leaddrive/migration.env"
const KEYS = ["IDENTITY_MOBILE_SESSION_KEYS", "IDENTITY_PHONE_PROOF_KEYS"]
const fail = code => { throw new Error(code) }

export function commissionInput(mode, slug, sha, operator) {
  if (!["inspect", "prepare-keys", "enable-company"].includes(mode)
    || !/^[a-z0-9][a-z0-9-]{0,99}$/.test(slug ?? "") || !/^[a-f0-9]{40}$/.test(sha ?? "")
    || !/^[A-Za-z0-9_-]{1,40}$/.test(operator ?? "")) fail("IDENTITY_COMMISSION_INPUT_INVALID")
  return { mode, slug, sha, operator }
}

/** Literal dotenv values only. Never source/eval a root environment file. */
export function envValue(source, key) {
  const found = source.split(/\r?\n/).flatMap(line => {
    const match = line.trim().match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/)
    if (!match || match[1] !== key) return []
    let value = match[2].trim()
    if (value.length >= 2 && ["'", '"'].includes(value[0]) && value.at(-1) === value[0]) value = value.slice(1, -1)
    return [value]
  })
  if (found.length > 1) fail("IDENTITY_COMMISSION_ENV_DUPLICATE")
  return found[0]
}

export function parseRings(values) {
  if (values.length !== 2) fail("IDENTITY_COMMISSION_KEYS_INVALID")
  if (values.every(value => value === undefined)) return null
  const material = new Set()
  return values.map(raw => {
    try {
      if (typeof raw !== "string" || raw.length > 1024) throw new Error()
      const ring = JSON.parse(raw)
      if (!ring || Array.isArray(ring) || Object.keys(ring).sort().join() !== "active,keys"
        || typeof ring.active !== "string" || !ring.keys || Array.isArray(ring.keys) || typeof ring.keys !== "object") throw new Error()
      const entries = Object.entries(ring.keys)
      if (entries.length < 1 || entries.length > 3 || !Object.hasOwn(ring.keys, ring.active)) throw new Error()
      for (const [id, bytes] of entries) {
        if (!/^[A-Za-z0-9_-]{1,40}$/.test(id) || typeof bytes !== "string" || !/^[a-f0-9]{64}$/.test(bytes)
          || /^0+$/.test(bytes) || material.has(bytes)) throw new Error()
        material.add(bytes)
      }
      return { active: ring.active, keys: Object.fromEntries(entries.sort(([a], [b]) => a.localeCompare(b))) }
    } catch { fail("IDENTITY_COMMISSION_KEYS_INVALID") }
  })
}

export function planKeyPreparation(source, state, runningValues) {
  const current = parseRings(KEYS.map(key => envValue(source, key)))
  if (current) return { source, created: false }
  // Missing durable authority must never be repaired by generating replacement
  // secrets after any proof/account has existed, even with the tenant flag off.
  if (state.canonicalCount !== 0 || state.proofCount !== 0 || runningValues.some(value => value !== undefined)) {
    fail("IDENTITY_COMMISSION_RESTORE_KEYS_REQUIRED")
  }
  const rings = ["mobile-v1", "proof-v1"].map(id => JSON.stringify({ active: id, keys: { [id]: randomBytes(32).toString("hex") } }))
  parseRings(rings)
  return { source: source + "\n" + KEYS.map((key, index) => `${key}='${rings[index]}'`).join("\n") + "\n", created: true }
}

export function databaseEnvironment(appUrl, migrationUrl, readOnly) {
  try {
    const app = new URL(appUrl), db = new URL(migrationUrl)
    for (const url of [app, db]) if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname || url.pathname.length < 2 || url.hash) throw new Error()
    if (app.hostname !== db.hostname || (app.port || "5432") !== (db.port || "5432") || app.pathname !== db.pathname) fail("IDENTITY_COMMISSION_DATABASE_CONFIG_INVALID_TARGET")
    const env = { PATH: process.env.PATH, LANG: "C.UTF-8", PGHOST: db.hostname, PGPORT: db.port || "5432",
      PGDATABASE: decodeURIComponent(db.pathname.slice(1)), PGUSER: decodeURIComponent(db.username), PGPASSWORD: decodeURIComponent(db.password),
      PGCONNECT_TIMEOUT: "5", PGAPPNAME: "identity-runtime-commission",
      PGOPTIONS: `-c default_transaction_read_only=${readOnly ? "on" : "off"} -c statement_timeout=5000 -c lock_timeout=3000 -c search_path=public` }
    const seen = new Set()
    for (const [key, value] of db.searchParams) {
      if (seen.has(key)) fail("IDENTITY_COMMISSION_DATABASE_CONFIG_INVALID_DUPLICATE")
      seen.add(key)
      if (key === "schema" && value === "public") continue
      if (key === "sslmode" && ["disable", "allow", "prefer", "require", "verify-ca", "verify-full"].includes(value)) env.PGSSLMODE = value
      // The managed PostgreSQL deployment uses an explicit CA with verify-full.
      // Forward the root-owned configuration literally; never remove TLS
      // verification or inherit unrelated libpq overrides from the environment.
      else if (key === "sslrootcert" && path.isAbsolute(value) && value.length <= 1024 && !/[\0\r\n]/.test(value)) env.PGSSLROOTCERT = value
      else fail("IDENTITY_COMMISSION_DATABASE_CONFIG_INVALID_OPTION")
    }
    return env
  } catch (error) {
    if (/^IDENTITY_COMMISSION_DATABASE_CONFIG_INVALID_(TARGET|DUPLICATE|OPTION)$/.test(error.message ?? "")) throw error
    fail("IDENTITY_COMMISSION_DATABASE_CONFIG_INVALID")
  }
}

function safeFile(file, mode = 0o600, uid = 0, gid = 0) {
  const parent = lstatSync(path.dirname(file))
  if (!parent.isDirectory() || parent.isSymbolicLink() || parent.uid !== uid || parent.gid !== gid || (parent.mode & 0o022)) fail("IDENTITY_COMMISSION_DIRECTORY_UNSAFE")
  const stat = lstatSync(file)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== uid || stat.gid !== gid || (stat.mode & 0o777) !== mode) fail("IDENTITY_COMMISSION_FILE_UNSAFE")
  return readFileSync(file, "utf8")
}
function command(program, args, options = {}) {
  const result = spawnSync(program, args, { encoding: "utf8", timeout: 30_000, maxBuffer: 64 * 1024, ...options })
  if (result.status !== 0 || result.error) fail("IDENTITY_COMMISSION_COMMAND_FAILED")
  return result.stdout.trim()
}
function sql(input, env, parameters) {
  return command("psql", ["-X", "-qAt", "--set=ON_ERROR_STOP=1", ...Object.entries(parameters).map(([key, value]) => `--set=${key}=${value}`)], { input, env })
}
export const inventorySql = `BEGIN READ ONLY;
SET LOCAL app.rls_bypass = 'on';
SELECT json_build_object('privileged',(SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname=current_user),
 'canonicalCount',(SELECT count(*) FROM identity_accounts WHERE "cutoverAt" IS NOT NULL),
 'proofCount',(SELECT count(*) FROM identity_phone_proofs),
 'companyCount',(SELECT count(*) FROM organizations WHERE slug=:'slug' AND "isActive"),
 'flagValid',NOT EXISTS(SELECT 1 FROM mtm_settings s JOIN organizations o ON o.id=s."organizationId" WHERE o.slug=:'slug' AND s.key='identityAuthV1' AND s.value NOT IN ('{"version":1,"enabled":true}'::jsonb,'{"version":1,"enabled":false}'::jsonb)),
 'enabled',COALESCE((SELECT s.value='{"version":1,"enabled":true}'::jsonb FROM mtm_settings s JOIN organizations o ON o.id=s."organizationId" WHERE o.slug=:'slug' AND s.key='identityAuthV1'),false));
COMMIT;`

export function assertInventory(state) {
  if (!state || state.privileged !== true || state.flagValid !== true || state.companyCount !== 1 || typeof state.enabled !== "boolean"
    || ![state.canonicalCount, state.proofCount].every(value => Number.isSafeInteger(value) && value >= 0)) fail("IDENTITY_COMMISSION_INVENTORY_REFUSED")
}
function processes() {
  // Match scripts/server-deploy.sh, including under the sanitized root worker.
  const raw = command("pm2", ["pid", "leaddrive-v2"], {
    env: { PATH: process.env.PATH, LANG: "C.UTF-8", HOME: "/root", PM2_HOME: "/root/.pm2" },
  })
  const ids = raw.split(/\s+/)
  if (!ids.length || ids.length > 16 || ids.some(id => !/^[1-9][0-9]{0,9}$/.test(id))) fail("IDENTITY_COMMISSION_PROCESS_UNAVAILABLE")
  return ids.map(id => {
    const cwd = realpathSync(`/proc/${id}/cwd`)
    const cmd = readFileSync(`/proc/${id}/cmdline`, "utf8").split("\0")
    if (![APP, `${APP}/.next/standalone`].includes(cwd) || path.basename(realpathSync(`/proc/${id}/exe`)) !== "node"
      || !cmd.some(arg => arg.endsWith("server.js") || /^next-server \(v[0-9][A-Za-z0-9.+-]*\)$/.test(arg))) fail("IDENTITY_COMMISSION_PROCESS_UNEXPECTED")
    const entries = readFileSync(`/proc/${id}/environ`, "utf8").split("\0").filter(Boolean)
    if (entries.filter(entry => entry === "PORT=3001").length !== 1) fail("IDENTITY_COMMISSION_PROCESS_UNEXPECTED")
    return KEYS.map(key => {
      const matches = entries.filter(entry => entry.startsWith(`${key}=`))
      if (matches.length > 1) fail("IDENTITY_COMMISSION_PROCESS_UNEXPECTED")
      return matches[0]?.slice(key.length + 1)
    })
  })
}
export function assertLiveKeys(source, live) {
  const expected = parseRings(KEYS.map(key => envValue(source, key)))
  if (!expected || !live.length || live.some(values => JSON.stringify(parseRings(values)) !== JSON.stringify(expected))) fail("IDENTITY_COMMISSION_REDEPLOY_REQUIRED")
}
// File/owner injection is for isolated filesystem tests only. The root CLI
// always calls this with its fixed production path and root ownership.
export function replaceEnvironment(before, after, { file = ENV, uid = 0, gid = 0 } = {}) {
  const directory = path.dirname(file), stat = lstatSync(directory)
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== uid || stat.gid !== gid || (stat.mode & 0o022)) fail("IDENTITY_COMMISSION_DIRECTORY_UNSAFE")
  const staged = `${directory}/.identity-env-${randomUUID()}`
  let fd, owned = false
  try {
    fd = openSync(staged, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
    owned = true
    writeFileSync(fd, after); fsyncSync(fd); closeSync(fd); fd = undefined
    if (safeFile(file, 0o600, uid, gid) !== before) fail("IDENTITY_COMMISSION_ENV_CHANGED")
    renameSync(staged, file)
    const directoryFd = openSync(directory, constants.O_RDONLY)
    try { fsyncSync(directoryFd) } finally { closeSync(directoryFd) }
  } finally {
    if (fd !== undefined) closeSync(fd)
    if (owned) try { unlinkSync(staged) } catch (error) { if (error.code !== "ENOENT") throw error }
  }
}
function backup() {
  // Existing reviewed encrypted/remote verified secret backup. Never upload
  // stdout, stderr, the source environment, or plaintext keys as CI artifacts.
  command("bash", [fileURLToPath(new URL("../backup/snapshot-secrets.sh", import.meta.url))], {
    timeout: 300_000, maxBuffer: 1024 * 1024, env: { PATH: process.env.PATH, LANG: "C.UTF-8" },
  })
}
// Fixed psql program: its metacommands and lock never pass through Prisma.
export const enableSql = readFileSync(new URL("./commission-enable.sql", import.meta.url), "utf8")

/** The workflow holds the canonical app-env lock and production-deploy group. */
export function commission(input) {
  if ((process.getuid?.() !== 0 || process.getgid?.() !== 0)) fail("IDENTITY_COMMISSION_ROOT_REQUIRED")
  const artifact = readIdentityArtifact(`${APP}/.next/standalone`)
  if (!artifact || artifact.artifactSha !== input.sha) fail("IDENTITY_COMMISSION_DEPLOYED_SHA_MISMATCH")
  const source = safeFile(ENV), migration = safeFile(MIGRATION)
  const appUrl = envValue(source, "DATABASE_URL"), migrationUrl = envValue(migration, "MIGRATION_DATABASE_URL")
  const state = JSON.parse(sql(inventorySql, databaseEnvironment(appUrl, migrationUrl, true), { slug: input.slug }))
  assertInventory(state)
  const configured = parseRings(KEYS.map(key => envValue(source, key))) !== null
  if (input.mode === "inspect") return { ...state, configured, sourceSha: input.sha, mutation: false }
  const live = processes()
  if (input.mode === "prepare-keys") {
    const plan = planKeyPreparation(source, state, live.flat())
    if (plan.created) replaceEnvironment(source, plan.source)
    backup() // On failure retain durable keys; never rotate/revert on retry.
    return { sourceSha: input.sha, keysCreated: plan.created, encryptedBackup: true, normalRedeployRequired: true, companyEnabled: state.enabled }
  }
  assertLiveKeys(source, live)
  backup()
  // Repeat artifact admission after backup; no account/proof/credential write.
  if (readIdentityArtifact(`${APP}/.next/standalone`)?.artifactSha !== input.sha) fail("IDENTITY_COMMISSION_DEPLOYED_SHA_MISMATCH")
  sql(enableSql, databaseEnvironment(appUrl, migrationUrl, false), { slug: input.slug, sha: input.sha, operator: input.operator,
    setting_id: randomUUID(), audit_id: randomUUID() })
  const after = JSON.parse(sql(inventorySql, databaseEnvironment(appUrl, migrationUrl, true), { slug: input.slug }))
  assertInventory(after)
  if (!after.enabled) fail("IDENTITY_COMMISSION_ENABLE_NOT_CONFIRMED")
  return { sourceSha: input.sha, companyEnabled: true, encryptedBackup: true, peopleConvertedByOperation: 0 }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 6) fail("IDENTITY_COMMISSION_INPUT_INVALID")
    const result = commission(commissionInput(...process.argv.slice(2)))
    process.stdout.write(JSON.stringify(result) + "\n")
  } catch (error) {
    const code = /^IDENTITY_COMMISSION_[A-Z_]+$/.test(error.message ?? "") ? error.message : "IDENTITY_COMMISSION_FAILED"
    process.stderr.write(code + "\n"); process.exitCode = 1
  }
}
